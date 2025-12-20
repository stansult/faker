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

function normalizeWord(w) {
  // Keep it simple: trim, collapse spaces
  return String(w || "")
    .trim()
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
  const wordsIn = payload.words;

  if (!roomCode) return json(400, { error: "roomCode is required" });
  if (!playerId) return json(400, { error: "playerId is required" });
  if (!Array.isArray(wordsIn)) return json(400, { error: "words must be an array" });

  // You said 3–4 per player; enforce that strictly:
  if (wordsIn.length < 3 || wordsIn.length > 4) {
    return json(400, { error: "Submit 3–4 words" });
  }

  // Normalize + validate words
  const words = wordsIn.map(normalizeWord).filter(Boolean);

  if (words.length !== wordsIn.length) {
    return json(400, { error: "Words cannot be empty" });
  }

  // Avoid absurdly long entries
  for (const w of words) {
    if (w.length > 40) return json(400, { error: "Word too long (max 40 chars)" });
  }

  connectLambda(event);
  const store = getStore("faker-rooms");

  const room = await store.get(roomCode, { type: "json" });
  if (!room) return json(404, { error: "Room not found" });

  room.players = Array.isArray(room.players) ? room.players : [];
  const player = room.players.find(p => p.playerId === playerId);
  if (!player) return json(404, { error: "Player not found in room" });

  if (room.locked) return json(409, { error: "Room is locked" });

  // Save player words
  player.words = words;

  // Rebuild wordPool from all players (simple + safe)
  const poolSet = new Set();
  for (const p of room.players) {
    if (Array.isArray(p.words)) {
      for (const w of p.words) poolSet.add(normalizeWord(w));
    }
  }
  room.wordPool = Array.from(poolSet);

  const now = new Date().toISOString();
  room.updatedAt = now;

  await store.setJSON(roomCode, room);

  return json(200, {
    ok: true,
    wordPoolSize: room.wordPool.length
  });
}
