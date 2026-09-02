import assert from "node:assert/strict";

import { test } from "./helpers/testHarness.mjs";
import {
  getRoomActivityTime,
  isActiveRoomExpired,
  roomExpiredError
} from "../netlify/functions/roomExpiry.js";

const now = Date.parse("2026-01-02T00:00:00.000Z");

function hoursAgo(hours) {
  return new Date(now - hours * 60 * 60 * 1000).toISOString();
}

test("uses updatedAt before createdAt for room activity", () => {
  const room = {
    createdAt: hoursAgo(30),
    updatedAt: hoursAgo(1)
  };

  assert.equal(getRoomActivityTime(room), Date.parse(room.updatedAt));
  assert.equal(isActiveRoomExpired(room, now), false);
});

test("expires active non-ended rooms after the configured inactivity window", () => {
  assert.equal(isActiveRoomExpired({ updatedAt: hoursAgo(25) }, now), true);
  assert.equal(isActiveRoomExpired({ updatedAt: hoursAgo(23) }, now), false);
});

test("never expires match-ended result rooms through the active-room rule", () => {
  assert.equal(isActiveRoomExpired({ matchEnded: true, updatedAt: hoursAgo(500) }, now), false);
  assert.equal(isActiveRoomExpired({ matchEnded: true }, now), false);
});

test("treats missing or invalid timestamps as expired for non-ended rooms", () => {
  assert.equal(isActiveRoomExpired({}, now), true);
  assert.equal(isActiveRoomExpired({ updatedAt: "not-a-date" }, now), true);
});

test("returns stable expired-room error shape", () => {
  assert.deepEqual(roomExpiredError(), { error: "Room expired" });
});
