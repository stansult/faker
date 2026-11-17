import assert from "node:assert/strict";
import { test } from "./helpers/testHarness.mjs";
import { assertOk, postFunction } from "./helpers/apiClient.mjs";
import { startNetlifyDev } from "./helpers/netlifyDev.mjs";

function lastCleanupSummary(server) {
  const entries = server.logs().split("\n")
    .filter(line => line.startsWith('{"task":"room-cleanup",'));
  assert.ok(entries.length > 0, "scheduled handler must emit a structured summary");
  return JSON.parse(entries.at(-1));
}

test("scheduled cleanup uses sandbox storage and persists its due-date gate", async t => {
  const server = await startNetlifyDev({ env: { ROOM_CLEANUP_DELETE_ENABLED: "1" } });
  t.after(() => server.stop());
  const created = await postFunction(server.baseUrl, "createRoom", {
    playerCount: 3, gamesTotal: 1, roundsPerGame: 1
  });
  assertOk(assert, created, "create room before cleanup");
  const result = await postFunction(server.baseUrl, "cleanupRooms");
  assertOk(assert, result, "invoke local scheduled cleanup");
  assert.match(result.text, /scheduled function/);
  const summary = lastCleanupSummary(server);
  assert.equal(summary.status, "complete");
  assert.equal(summary.dryRun, false);
  assert.equal(summary.scanned, 1);
  assert.equal(summary.retained, 1);
  assert.equal(summary.deleted, 0);
  assert.equal(summary.cadence, "monthly");
  assert.ok(Date.parse(summary.nextRunAt) > Date.now());
  const again = await postFunction(server.baseUrl, "cleanupRooms");
  assertOk(assert, again, "invoke cleanup before due");
  assert.equal(lastCleanupSummary(server).status, "not-due");
  const roomStatus = await postFunction(server.baseUrl, "roomStatus", { roomCode: created.data.roomCode });
  assertOk(assert, roomStatus, "room remains readable after cleanup");
});
