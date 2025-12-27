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

function makeId(length = 16) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function normalizeName(x) {
  const s = String(x ?? "").trim().replace(/\s+/g, " ");
  if (!s) return null;
  // optional safety: cap length
  return s.slice(0, 40);
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
  const requestedPlayerId = payload.playerId ? String(payload.playerId).trim() : null;
  const requestedName = normalizeName(payload.name);

  if (!roomCode) return json(400, { error: "roomCode is required" });
  if (!requestedPlayerId) return json(400, { error: "playerId is required" });

  connectLambda(event);
  const store = getStore("faker-rooms");

  // Read with retry (eventual consistency)
  let room = null;
  let delay = 120;

  for (let attempt = 1; attempt <= 30; attempt++) {
    room = await store.get(roomCode, { type: "json" });
    if (room) break;

    await sleep(delay + Math.floor(Math.random() * 80));
    delay = Math.min(650, Math.floor(delay * 1.25));
  }

  if (!room) return json(404, { error: "Room not found" });

  room.players = Array.isArray(room.players) ? room.players : [];
  room.game = room.game || null;

  // If this playerId already exists, treat as re-join (even if locked/game started).
  const existing = room.players.find(p => p.playerId === requestedPlayerId);
  if (existing) {
    if (!existing.name && !requestedName) {
      return json(400, { error: "name is required" });
    }
    // Allow updating name on rejoin if provided (useful when name was null earlier)
    if (requestedName && existing.name !== requestedName) {
      existing.name = requestedName;
      room.updatedAt = new Date().toISOString();
      await store.setJSON(roomCode, room);
    }

    return json(200, {
      roomCode,
      playerId: existing.playerId,
      playerNumber: existing.playerNumber,
      name: existing.name ?? null,
      rejoined: true
    });
  }

  // New joins are blocked once locked or game started
  if (room.locked || (room.game && room.game.gameId)) {
    return json(409, { error: "Room is locked" });
  }

  if (room.players.length >= room.playerCount) {
    return json(409, { error: "Room is full" });
  }

  if (!requestedName) return json(400, { error: "name is required" });

  const playerId = requestedPlayerId || makeId(16);
  const playerNumber = room.players.length + 1;
  const now = new Date().toISOString();

  room.players.push({
    playerId,
    playerNumber,
    name: requestedName, // <-- name stored here
    joinedAt: now,
    words: [],
    score: 0
  });

  room.updatedAt = now;

  await store.setJSON(roomCode, room);

  // Verify our player is actually present (defends against stale reads / lost updates)
  let vMe = null;
  for (let i = 0; i < 12; i++) {
    const verify = await store.get(roomCode, { type: "json" });
    const vPlayers = Array.isArray(verify?.players) ? verify.players : [];
    vMe = vPlayers.find(p => p.playerId === playerId);
    if (vMe) break;
    await sleep(120 + Math.floor(Math.random() * 120));
  }
  
  if (!vMe) {
    return json(503, { error: "Join contention, please retry" });
  }

  return json(200, {
    roomCode,
    playerId,
    playerNumber: vMe.playerNumber,
    name: vMe.name ?? null,
    rejoined: false
  });
}
