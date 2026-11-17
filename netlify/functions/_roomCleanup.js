import { isValidRoomCode } from "./roomCode.js";
import { getRoomActivityTime } from "./roomExpiry.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_DAYS = { weekly: 7, monthly: 30, quarterly: 90 };
export const CLEANUP_STATE_KEY = "room-cleanup-v1";
export const CLEANUP_RETENTION_MS = 7 * DAY_MS;
export const CLEANUP_SIGNIFICANT_BYTES = 1_000_000;

function initialState() {
  return { version: 1, cadence: "monthly", emptyRuns: 0, lowRuns: 0, nextRunAt: null };
}

function validateState(state) {
  if (state == null) return initialState();
  if (state.version !== 1 || !Object.hasOwn(PERIOD_DAYS, state.cadence) ||
      !Number.isInteger(state.emptyRuns) || state.emptyRuns < 0 ||
      !Number.isInteger(state.lowRuns) || state.lowRuns < 0 ||
      (state.nextRunAt !== null && !Number.isFinite(Date.parse(state.nextRunAt))) ||
      (state.leaseUntil != null && !Number.isFinite(Date.parse(state.leaseUntil)))) {
    throw new Error("Invalid cleanup maintenance state");
  }
  if (state.progress && (!Number.isFinite(Date.parse(state.progress.startedAt)) ||
      !Array.isArray(state.progress.processedKeys) || !state.progress.summary ||
      !state.progress.processedKeys.every(key => typeof key === "string") ||
      !Object.keys(emptySummary()).every(key =>
        Number.isSafeInteger(state.progress.summary[key]) && state.progress.summary[key] >= 0))) {
    throw new Error("Invalid cleanup progress");
  }
  return state;
}

export function classifyCleanupRoom(key, room, nowMs) {
  if (!isValidRoomCode(key) || key !== key.trim().toUpperCase() ||
      !room || typeof room !== "object" || Array.isArray(room) || room.roomCode !== key) {
    return "invalid";
  }
  if (room.matchEnded === true) return "completed";
  const activity = getRoomActivityTime(room);
  const created = Date.parse(room.createdAt);
  if (room.matchEnded !== false || activity == null || !Number.isFinite(created) ||
      created > activity || activity > nowMs) return "invalid";
  return nowMs - activity > CLEANUP_RETENTION_MS ? "eligible" : "retained";
}

export function nextCleanupState(state, summary, nowMs) {
  let cadence = state.cadence;
  let emptyRuns = summary.eligible === 0 ? state.emptyRuns + 1 : 0;
  let lowRuns = 0;
  if (summary.eligibleBytes > CLEANUP_SIGNIFICANT_BYTES) {
    cadence = "weekly";
    emptyRuns = 0;
  } else if (cadence === "weekly") {
    lowRuns = state.lowRuns + 1;
    if (lowRuns >= 2) {
      cadence = "monthly";
      lowRuns = 0;
      emptyRuns = 0;
    }
  } else if (summary.eligible === 0 && emptyRuns >= 2) {
    cadence = "quarterly";
  } else if (cadence === "quarterly" && summary.eligible > 0) {
    cadence = "monthly";
  }
  return {
    version: 1,
    cadence,
    emptyRuns,
    lowRuns,
    lastCompletedAt: new Date(nowMs).toISOString(),
    nextRunAt: new Date(nowMs + PERIOD_DAYS[cadence] * DAY_MS).toISOString(),
    lastSummary: summary
  };
}

function emptySummary() {
  return {
    scanned: 0, scannedBytes: 0, eligible: 0, eligibleBytes: 0,
    deleted: 0, deletedBytes: 0, completed: 0, retained: 0,
    invalid: 0, changed: 0, missing: 0, failures: 0
  };
}

export async function runRoomCleanup({
  roomStore, maintenanceStore, dryRun = true, now = Date.now, budgetMs = 20_000
}) {
  const started = now();
  const stored = await maintenanceStore.getWithMetadata(CLEANUP_STATE_KEY, { type: "json" });
  if (stored && !stored.data) throw new Error("Invalid cleanup maintenance state");
  const state = validateState(stored?.data);
  if (state.leaseUntil && (!Number.isFinite(Date.parse(state.leaseUntil)) ||
      Date.parse(state.leaseUntil) > started)) return { status: "busy", dryRun };
  if (!state.progress && state.nextRunAt && Date.parse(state.nextRunAt) > started) {
    return { status: "not-due", dryRun, nextRunAt: state.nextRunAt };
  }

  let leaseEtag;
  if (!dryRun) {
    if (stored && !stored.etag) throw new Error("Missing cleanup state ETag");
    const lease = await maintenanceStore.setJSON(CLEANUP_STATE_KEY, {
      ...state, leaseUntil: new Date(started + 5 * 60_000).toISOString()
    }, stored ? { onlyIfMatch: stored.etag } : { onlyIfNew: true });
    if (!lease.modified) return { status: "busy", dryRun };
    if (!lease.etag) throw new Error("Missing cleanup lease ETag");
    leaseEtag = lease.etag;
  }

  const progress = !dryRun && state.progress ? state.progress : {
    startedAt: new Date(started).toISOString(), processedKeys: [], summary: emptySummary()
  };
  const cutoffTime = Date.parse(progress.startedAt);
  const summary = { ...progress.summary };
  const processed = new Set(progress.processedKeys);
  let complete = true;
  try {
    for await (const page of roomStore.list({ paginate: true })) {
      for (const { key } of page.blobs) {
        if (now() - started >= budgetMs) {
          complete = false;
          break;
        }
        if (processed.has(key)) continue;
        try {
          const entry = await roomStore.getWithMetadata(key, { type: "text" });
          if (!entry) {
            summary.missing += 1;
            processed.add(key);
            continue;
          }
          const bytes = Buffer.byteLength(entry.data, "utf8");
          let room;
          try {
            room = JSON.parse(entry.data);
          } catch {
            room = null;
          }
          const classification = classifyCleanupRoom(key, room, cutoffTime);
          let changed = false;
          if (classification === "eligible" && !dryRun) {
            const current = await roomStore.getWithMetadata(key, { type: "text" });
            if (!entry.etag || !current?.etag || current.etag !== entry.etag ||
                current.data !== entry.data ||
                classifyCleanupRoom(key, JSON.parse(current.data), now()) !== "eligible") {
              changed = true;
            } else {
              await roomStore.delete(key);
              summary.deleted += 1;
              summary.deletedBytes += bytes;
            }
          }
          summary.scanned += 1;
          summary.scannedBytes += bytes;
          if (changed) {
            summary.changed += 1;
          } else {
            summary[classification] += 1;
            if (classification === "eligible") summary.eligibleBytes += bytes;
          }
          processed.add(key);
        } catch {
          summary.failures += 1;
          complete = false;
        }
      }
      if (now() - started >= budgetMs) {
        complete = false;
        break;
      }
    }
  } catch {
    summary.failures += 1;
    complete = false;
  }

  const finished = now();
  const next = complete ? nextCleanupState(state, summary, finished) : {
    ...state,
    leaseUntil: null,
    progress: { startedAt: progress.startedAt, processedKeys: [...processed], summary }
  };
  if (!dryRun) {
    const saved = await maintenanceStore.setJSON(CLEANUP_STATE_KEY, next, { onlyIfMatch: leaseEtag });
    if (!saved.modified) throw new Error("Cleanup checkpoint changed concurrently");
  }
  return {
    status: complete ? "complete" : "incomplete", dryRun, ...summary,
    remainingMeasuredBytes: summary.scannedBytes - summary.deletedBytes,
    cadence: dryRun ? state.cadence : next.cadence,
    nextRunAt: dryRun ? state.nextRunAt : next.nextRunAt
  };
}
