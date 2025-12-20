import { connectLambda, getStore } from "@netlify/blobs";

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

function makeId(length = 10) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
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
  if (!roomCode) return json(400, { error: "roomCode is required" });

  connectLambda(event);
  const store = getStore("faker-rooms");

  const room = await store.get(roomCode, { type: "json" });
  if (!room) return json(404, { error: "Room not found" });

  room.players = Array.isArray(room.players) ? room.players : [];

  if (room.locked) return json(409, { error: "Room already started/locked" });
  if (room.players.length < 3) return json(400, { error: "Need at least 3 players" });

  const pool = Array.isArray(room.wordPool) ? room.wordPool : [];
  if (pool.length === 0) return json(400, { error: "No words submitted yet" });

  // Ensure every player has submitted words (optional but good)
  for (const p of room.players) {
    if (!Array.isArray(p.words) || p.words.length === 0) {
      return json(400, { error: "Not all players submitted words" });
    }
  }

  const secretWord = pickRandom(pool);
  const fakerPlayer = pickRandom(room.players);

  const gameId = makeId(8);
  const now = new Date().toISOString();

  room.locked = true;
  room.game = {
    gameId,
    startedAt: now,
    secretWord,
    fakerPlayerId: fakerPlayer.playerId,
    round: 1
  };
  room.updatedAt = now;

  await store.setJSON(roomCode, room);

  // Don't return secretWord here (server-side only)
  return json(200, { ok: true, gameId });
}
