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

function makeId(length = 12) {
  // URL-safe base64-ish alphabet
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
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

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  let room = null;
  for (let attempt = 1; attempt <= 6; attempt++) {
    room = await store.get(roomCode, { type: "json" });
    if (room) break;
    await sleep(80 + Math.floor(Math.random() * 120));
  }

  if (!room) return json(404, { error: "Room not found" });
  if (room.locked) return json(409, { error: "Room is locked" });

  room.players = Array.isArray(room.players) ? room.players : [];

  if (room.players.length >= room.playerCount) {
    return json(409, { error: "Room is full" });
  }

  // Create player
  const playerId = makeId(16);
  const playerNumber = room.players.length + 1;

  const now = new Date().toISOString();
  room.players.push({
    playerId,
    playerNumber,
    joinedAt: now,
    words: []
  });

  room.updatedAt = now;

  await store.setJSON(roomCode, room);
  // Verify our player is actually present (defends against stale reads / lost updates)
  const verify = await store.get(roomCode, { type: "json" });
  const vPlayers = Array.isArray(verify?.players) ? verify.players : [];
  const vMe = vPlayers.find(p => p.playerId === playerId);

  if (!vMe) {
    return json(503, { error: "Join contention, please retry" });
  }

  return json(200, { playerId, playerNumber: vMe.playerNumber });
}
