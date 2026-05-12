import validationConstants from "../../shared/validationConstants.cjs";

const { ROOM_ACTIVE_TTL_HOURS } = validationConstants;

function parseEnvNumber(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export const ROOM_ACTIVE_TTL_HOURS_EFFECTIVE = parseEnvNumber(
  "ROOM_ACTIVE_TTL_HOURS",
  ROOM_ACTIVE_TTL_HOURS
);

export function roomExpiredError() {
  return { error: "Room expired" };
}

export function getRoomActivityTime(room) {
  const raw = room?.updatedAt || room?.createdAt || null;
  if (!raw) return null;
  const time = Date.parse(raw);
  return Number.isFinite(time) ? time : null;
}

export function isActiveRoomExpired(room, nowMs = Date.now()) {
  if (!room || room.matchEnded) return false;
  const activityTime = getRoomActivityTime(room);
  if (!activityTime) return true;
  const ttlMs = ROOM_ACTIVE_TTL_HOURS_EFFECTIVE * 60 * 60 * 1000;
  return nowMs - activityTime > ttlMs;
}
