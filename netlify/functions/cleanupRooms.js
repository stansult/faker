import { getRoomStore, getMaintenanceStore } from "./_roomStore.js";
import { runRoomCleanup } from "./_roomCleanup.js";

export function createCleanupHandler({
  rooms = getRoomStore,
  maintenance = getMaintenanceStore,
  run = runRoomCleanup,
  env = process.env,
  log = value => console.log(JSON.stringify(value))
} = {}) {
  return async event => {
    try {
      const result = await run({
        roomStore: rooms(event),
        maintenanceStore: maintenance(event),
        dryRun: env.ROOM_CLEANUP_DELETE_ENABLED !== "1"
      });
      log({ task: "room-cleanup", ...result });
    } catch {
      log({ task: "room-cleanup", status: "failed" });
      throw new Error("Room cleanup failed; no successful scan recorded");
    }
  };
}

export const handler = createCleanupHandler();
