import { connectLambda, getStore } from "@netlify/blobs";
import { isValidRoomCode } from "./roomCode.js";

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "content-type"
    },
    body: JSON.stringify(obj)
  };
}

function normalizeWord(w) {
  return String(w || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST,OPTIONS",
        "access-control-allow-headers": "content-type"
      },
      body: ""
    };
  }

  if (event.httpMethod !== "POST") return json(405, { error: "Use POST" });

  let payload;
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const roomCode = String(payload.roomCode || "").trim().toUpperCase();
  const playerId = String(payload.playerId || "").trim();

  if (!roomCode) return json(400, { error: "roomCode is required" });
  if (!isValidRoomCode(roomCode)) {
    return json(400, { error: "Invalid room code." });
  }
  if (!playerId) return json(400, { error: "playerId is required" });

  connectLambda(event);
  const store = getStore("faker-rooms");

  const room = await store.get(roomCode, { type: "json" });
  if (!room) return json(404, { error: "Room not found" });

  if (room.matchEnded) {
    return json(409, { error: "Match ended" });
  }

  if (room.locked || (room.game && room.game.gameId)) {
    return json(409, { error: "Room is locked" });
  }

  const players = Array.isArray(room.players) ? room.players : [];
  const me = players.find(p => p.playerId === playerId);
  if (!me) return json(404, { error: "Player not found in room" });

  const required = Number.isInteger(room.wordsPerPlayer) ? room.wordsPerPlayer : 4;
  const words = Array.isArray(me.words)
    ? me.words.map(normalizeWord).filter(Boolean)
    : [];

  if (words.length < required) {
    return json(409, { error: "Not enough words yet" });
  }

  me.doneWords = true;
  room.players = players;
  room.updatedAt = new Date().toISOString();
  await store.setJSON(roomCode, room);

  return json(200, { ok: true, doneWords: true });
}
