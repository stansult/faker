import { ROOM_CODE_LENGTH } from "../../shared/validationConstants.js";

const ROOM_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function isValidRoomCode(raw) {
  const value = String(raw || "").trim().toUpperCase();
  if (value.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of value) {
    if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  }
  return true;
}
