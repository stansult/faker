import assert from "node:assert/strict";

import { test } from "./helpers/testHarness.mjs";
import { isValidRoomCode, roomCodeError } from "../netlify/functions/roomCode.js";

test("validates room codes against the public room-code alphabet", () => {
  assert.equal(isValidRoomCode("ABC123"), true);
  assert.equal(isValidRoomCode("abc123"), true);
  assert.equal(isValidRoomCode(" ABC123 "), true);

  assert.equal(isValidRoomCode("ABC12"), false);
  assert.equal(isValidRoomCode("ABC1234"), false);
  assert.equal(isValidRoomCode("ABC12I"), false);
  assert.equal(isValidRoomCode("ABC12O"), false);
});

test("returns stable room-code validation error shape", () => {
  assert.deepEqual(roomCodeError(), { error: "Invalid room code." });
});
