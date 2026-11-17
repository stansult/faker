import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CLEANUP_RETENTION_MS, CLEANUP_SIGNIFICANT_BYTES, CLEANUP_STATE_KEY,
  classifyCleanupRoom, nextCleanupState, runRoomCleanup
} from "../netlify/functions/_roomCleanup.js";
import { createCleanupHandler } from "../netlify/functions/cleanupRooms.js";
import { MemoryBlobStore } from "./helpers/memoryBlobStore.mjs";
import { test } from "./helpers/testHarness.mjs";

const NOW = Date.parse("2026-11-17T04:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const state = { version: 1, cadence: "monthly", emptyRuns: 0, lowRuns: 0, nextRunAt: null };

function room(key, overrides = {}) {
  return {
    roomCode: key, createdAt: new Date(NOW - 10 * DAY).toISOString(),
    updatedAt: new Date(NOW - 8 * DAY).toISOString(), matchEnded: false,
    players: [{ name: "Private Name", words: ["секрет"] }], ...overrides
  };
}

function setup(entries = {}, overrides = {}) {
  return {
    roomStore: new MemoryBlobStore(entries), maintenanceStore: new MemoryBlobStore(),
    now: () => NOW, dryRun: false, ...overrides
  };
}

async function readState(store) {
  return (await store.getWithMetadata(CLEANUP_STATE_KEY, { type: "json" }))?.data;
}

test("cleanup uses a strict seven-day cutoff and updatedAt precedence", () => {
  const key = "ABC123";
  assert.equal(classifyCleanupRoom(key, room(key), NOW), "eligible");
  assert.equal(classifyCleanupRoom(key, room(key, {
    updatedAt: new Date(NOW - CLEANUP_RETENTION_MS).toISOString()
  }), NOW), "retained");
  assert.equal(classifyCleanupRoom(key, room(key, { updatedAt: undefined }), NOW), "eligible");
  assert.equal(classifyCleanupRoom(key, room(key, {
    updatedAt: new Date(NOW - 2 * DAY).toISOString()
  }), NOW), "retained");
});

test("cleanup preserves completed results even without timestamps", () => {
  assert.equal(classifyCleanupRoom("ABC123", {
    roomCode: "ABC123", matchEnded: true
  }, NOW), "completed");
});

test("cleanup skips malformed, missing, conflicting, and future timestamps", () => {
  for (const invalid of [null, [], {}, room("XYZ789"),
    room("ABC123", { createdAt: null, updatedAt: null }),
    room("ABC123", { updatedAt: "bad" }),
    room("ABC123", { matchEnded: "false" }),
    room("ABC123", { createdAt: new Date(NOW).toISOString() }),
    room("ABC123", { updatedAt: new Date(NOW + DAY).toISOString() })]) {
    assert.equal(classifyCleanupRoom("ABC123", invalid, NOW), "invalid");
  }
  assert.equal(classifyCleanupRoom("unknown", room("unknown"), NOW), "invalid");
});

test("cleanup cadence uses eligible bytes and two low weekly runs", () => {
  const high = { eligible: 1, eligibleBytes: CLEANUP_SIGNIFICANT_BYTES + 1 };
  const low = { eligible: 1, eligibleBytes: CLEANUP_SIGNIFICANT_BYTES };
  const weekly = nextCleanupState(state, high, NOW);
  assert.equal(weekly.cadence, "weekly");
  assert.equal(Date.parse(weekly.nextRunAt), NOW + 7 * DAY);
  const first = nextCleanupState(weekly, low, NOW);
  assert.equal(first.cadence, "weekly");
  assert.equal(first.lowRuns, 1);
  const reset = nextCleanupState(first, high, NOW);
  assert.equal(reset.lowRuns, 0);
  const monthly = nextCleanupState(first, low, NOW);
  assert.equal(monthly.cadence, "monthly");
  assert.equal(Date.parse(monthly.nextRunAt), NOW + 30 * DAY);
});

test("two empty monthly scans become quarterly and any eligible data brings it back", () => {
  const empty = { eligible: 0, eligibleBytes: 0, scannedBytes: 9_000_000 };
  const first = nextCleanupState(state, empty, NOW);
  assert.equal(first.cadence, "monthly");
  const quarterly = nextCleanupState(first, empty, NOW);
  assert.equal(quarterly.cadence, "quarterly");
  assert.equal(Date.parse(quarterly.nextRunAt), NOW + 90 * DAY);
  assert.equal(nextCleanupState(quarterly, empty, NOW).cadence, "quarterly");
  assert.equal(nextCleanupState(quarterly, { eligible: 1, eligibleBytes: 10 }, NOW).cadence, "monthly");
  assert.equal(nextCleanupState(quarterly, {
    eligible: 1, eligibleBytes: CLEANUP_SIGNIFICANT_BYTES + 1
  }, NOW).cadence, "weekly");
});

test("weekly empty scans step down through monthly before quarterly", () => {
  let current = { ...state, cadence: "weekly" };
  const empty = { eligible: 0, eligibleBytes: 0 };
  current = nextCleanupState(current, empty, NOW);
  assert.equal(current.cadence, "weekly");
  current = nextCleanupState(current, empty, NOW);
  assert.equal(current.cadence, "monthly");
  assert.equal(current.emptyRuns, 0);
  current = nextCleanupState(current, empty, NOW);
  assert.equal(current.cadence, "monthly");
  assert.equal(nextCleanupState(current, empty, NOW).cadence, "quarterly");
});

test("cleanup deletes only old abandoned rooms across all pages and counts UTF-8 bytes", async () => {
  const old = room("ABC123");
  const options = setup({
    ABC123: old, DEF456: room("DEF456", { matchEnded: true }),
    GHK789: room("GHK789", { updatedAt: new Date(NOW).toISOString() }),
    JKM234: room("JKM234", { updatedAt: null, createdAt: null })
  });
  const result = await runRoomCleanup(options);
  assert.equal(result.status, "complete");
  assert.equal(result.scanned, 4);
  assert.equal(result.deleted, 1);
  assert.equal(result.eligibleBytes, Buffer.byteLength(JSON.stringify(old)));
  assert.equal(result.deletedBytes, result.eligibleBytes);
  assert.equal(result.completed, 1);
  assert.equal(result.retained, 1);
  assert.equal(result.invalid, 1);
  assert.deepEqual(options.roomStore.deletes, ["ABC123"]);
  assert.equal(await options.roomStore.getWithMetadata("ABC123", { type: "json" }), null);
  assert.ok(await options.roomStore.getWithMetadata("DEF456", { type: "json" }));
  assert.equal((await readState(options.maintenanceStore)).lastSummary.deleted, 1);
  assert.equal(JSON.stringify(result).includes("Private Name"), false);
  assert.equal(JSON.stringify(await readState(options.maintenanceStore)).includes("секрет"), false);
});

test("dry-run is the default and changes neither rooms nor maintenance state", async () => {
  const options = setup({ ABC123: room("ABC123") });
  delete options.dryRun;
  const result = await runRoomCleanup(options);
  assert.equal(result.dryRun, true);
  assert.equal(result.eligible, 1);
  assert.equal(result.deleted, 0);
  assert.equal(options.maintenanceStore.writes, 0);
  assert.deepEqual(options.roomStore.deletes, []);
});

test("not-due and leased runs do not list or read rooms", async () => {
  for (const saved of [
    { ...state, nextRunAt: new Date(NOW + DAY).toISOString() },
    { ...state, leaseUntil: new Date(NOW + DAY).toISOString() }
  ]) {
    const options = setup();
    options.maintenanceStore = new MemoryBlobStore({ [CLEANUP_STATE_KEY]: saved });
    options.roomStore.list = () => { throw new Error("Must not scan"); };
    const result = await runRoomCleanup(options);
    assert.equal(result.status, saved.leaseUntil ? "busy" : "not-due");
    assert.equal(options.maintenanceStore.writes, 0);
  }
});

test("overlapping runs cannot acquire the same maintenance lease", async () => {
  const options = setup({ ABC123: room("ABC123") });
  const results = await Promise.all([runRoomCleanup(options), runRoomCleanup(options)]);
  assert.deepEqual(results.map(result => result.status).sort(), ["busy", "complete"]);
  assert.deepEqual(options.roomStore.deletes, ["ABC123"]);
});

test("cleanup skips candidates changed or completed between its two reads", async () => {
  for (const replacement of [room("ABC123", { matchEnded: true }),
    room("ABC123", { updatedAt: new Date(NOW).toISOString() }), null]) {
    const options = setup({ ABC123: room("ABC123") });
    const read = options.roomStore.getWithMetadata.bind(options.roomStore);
    let reads = 0;
    options.roomStore.getWithMetadata = async (...args) => {
      reads += 1;
      if (reads === 2) {
        if (replacement) await options.roomStore.setJSON("ABC123", replacement);
        else await options.roomStore.delete("ABC123");
      }
      return read(...args);
    };
    const result = await runRoomCleanup(options);
    assert.equal(result.deleted, 0);
    assert.equal(result.changed, 1);
    assert.equal(result.eligible, 0);
    if (replacement) assert.deepEqual(options.roomStore.deletes, []);
  }
});

test("cleanup resumes a bounded scan without recounting processed records", async () => {
  let clock = NOW;
  const options = setup({ ABC123: room("ABC123"), DEF456: room("DEF456", { matchEnded: true }) }, {
    now: () => clock, budgetMs: 10
  });
  const read = options.roomStore.getWithMetadata.bind(options.roomStore);
  options.roomStore.getWithMetadata = async (...args) => {
    const result = await read(...args);
    clock += 6;
    return result;
  };
  const first = await runRoomCleanup(options);
  assert.equal(first.status, "incomplete");
  assert.equal(first.deleted, 1);
  assert.equal((await readState(options.maintenanceStore)).emptyRuns, 0);
  options.roomStore.getWithMetadata = read;
  const second = await runRoomCleanup(options);
  assert.equal(second.status, "complete");
  assert.equal(second.scanned, 2);
  assert.equal(second.deleted, 1);
  assert.equal(second.completed, 1);
  assert.equal((await readState(options.maintenanceStore)).progress, undefined);
});

test("read and delete failures retry without advancing an empty-scan streak", async () => {
  for (const method of ["getWithMetadata", "delete"]) {
    const options = setup({ ABC123: room("ABC123") });
    options.maintenanceStore = new MemoryBlobStore({ [CLEANUP_STATE_KEY]: { ...state, emptyRuns: 1 } });
    const original = options.roomStore[method].bind(options.roomStore);
    options.roomStore[method] = async () => { throw new Error("Private Name must not leak"); };
    const first = await runRoomCleanup(options);
    assert.equal(first.status, "incomplete");
    assert.equal(first.failures, 1);
    assert.equal((await readState(options.maintenanceStore)).emptyRuns, 1);
    assert.equal((await readState(options.maintenanceStore)).cadence, "monthly");
    assert.equal(JSON.stringify(first).includes("Private Name"), false);
    options.roomStore[method] = original;
    const second = await runRoomCleanup(options);
    assert.equal(second.status, "complete");
    assert.equal(second.deleted, 1);
    assert.equal((await readState(options.maintenanceStore)).emptyRuns, 0);
  }
});

test("listing failure is incomplete and an expired lease is recoverable", async () => {
  const options = setup();
  options.maintenanceStore = new MemoryBlobStore({
    [CLEANUP_STATE_KEY]: { ...state, emptyRuns: 1, leaseUntil: new Date(NOW - DAY).toISOString() }
  });
  options.roomStore.list = async function* () { throw new Error("Unavailable"); };
  const result = await runRoomCleanup(options);
  assert.equal(result.status, "incomplete");
  assert.equal((await readState(options.maintenanceStore)).emptyRuns, 1);
  assert.equal((await readState(options.maintenanceStore)).leaseUntil, null);
});

test("invalid maintenance state and checkpoint conflicts fail closed", async () => {
  const invalid = setup();
  invalid.maintenanceStore = new MemoryBlobStore({ [CLEANUP_STATE_KEY]: { version: 99 } });
  await assert.rejects(runRoomCleanup(invalid), /Invalid cleanup/);
  const conflict = setup();
  const write = conflict.maintenanceStore.setJSON.bind(conflict.maintenanceStore);
  conflict.maintenanceStore.setJSON = (...args) => args[2].onlyIfMatch
    ? { modified: false } : write(...args);
  await assert.rejects(runRoomCleanup(conflict), /checkpoint changed/);
});

test("malformed room JSON is skipped without blocking complete scans", async () => {
  const options = setup();
  options.roomStore.putText("ABC123", "{broken");
  const result = await runRoomCleanup(options);
  assert.equal(result.status, "complete");
  assert.equal(result.invalid, 1);
  assert.equal(result.deleted, 0);
  assert.equal(result.scannedBytes, Buffer.byteLength("{broken"));
});

test("large completed results do not accelerate cleanup", async () => {
  const options = setup({ ABC123: room("ABC123", {
    matchEnded: true, game: { word: "x".repeat(CLEANUP_SIGNIFICANT_BYTES + 1) }
  }) });
  const result = await runRoomCleanup(options);
  assert.ok(result.scannedBytes > CLEANUP_SIGNIFICANT_BYTES);
  assert.equal(result.eligibleBytes, 0);
  assert.equal(result.cadence, "monthly");
});

test("a failed empty listing cannot turn the next retry into an empty quarterly scan", async () => {
  const options = setup({ ABC123: room("ABC123") });
  options.maintenanceStore = new MemoryBlobStore({ [CLEANUP_STATE_KEY]: { ...state, emptyRuns: 1 } });
  const listing = options.roomStore.list.bind(options.roomStore);
  options.roomStore.list = async function* () { throw new Error("List unavailable"); };
  assert.equal((await runRoomCleanup(options)).status, "incomplete");
  assert.equal((await readState(options.maintenanceStore)).cadence, "monthly");
  options.roomStore.list = listing;
  const retry = await runRoomCleanup(options);
  assert.equal(retry.status, "complete");
  assert.equal(retry.deleted, 1);
  assert.equal(retry.cadence, "monthly");
});

test("cleanup refuses deletion when storage omits a candidate ETag", async () => {
  const options = setup({ ABC123: room("ABC123") });
  const read = options.roomStore.getWithMetadata.bind(options.roomStore);
  options.roomStore.getWithMetadata = async (...args) => {
    const result = await read(...args);
    return result && { ...result, etag: undefined };
  };
  const result = await runRoomCleanup(options);
  assert.equal(result.deleted, 0);
  assert.equal(result.changed, 1);
  assert.deepEqual(options.roomStore.deletes, []);
});

test("scheduled cleanup only enables deletion for the exact environment opt-in", async () => {
  for (const value of [undefined, "true", "0", "1"]) {
    let options;
    const logs = [];
    const handler = createCleanupHandler({
      rooms: () => "rooms", maintenance: () => "maintenance",
      env: { ROOM_CLEANUP_DELETE_ENABLED: value }, log: result => logs.push(result),
      run: async input => { options = input; return { status: "complete", dryRun: input.dryRun }; }
    });
    const response = await handler({});
    assert.equal(response, undefined);
    assert.equal(options.dryRun, value !== "1");
    assert.equal(options.roomStore, "rooms");
    assert.equal(options.maintenanceStore, "maintenance");
    assert.equal(logs[0].task, "room-cleanup");
  }
  const logs = [];
  const handler = createCleanupHandler({
    rooms: () => { throw new Error("secret-token"); }, log: entry => logs.push(entry)
  });
  await assert.rejects(handler({}), /Room cleanup failed/);
  assert.equal(JSON.stringify(logs).includes("secret-token"), false);
});

test("cleanup has a daily UTC schedule instead of a public destructive endpoint", async () => {
  const config = await readFile("netlify.toml", "utf8");
  assert.match(config, /\[functions\."cleanupRooms"\]\s+schedule = "0 4 \* \* \*"/);
});
