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

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function sameStringArray(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (String(a[i]) !== String(b[i])) return false;
  return true;
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

  // Merge-safe write with verification (helps with eventual consistency + concurrent writes)
  // We retry by re-reading the latest room, applying the same change, and verifying it sticks.
  let delay = 120;

  for (let attempt = 1; attempt <= 12; attempt++) {
    const room = await store.get(roomCode, { type: "json" });
    if (!room) return json(404, { error: "Room not found" });

    room.players = Array.isArray(room.players) ? room.players : [];
    room.wordPool = Array.isArray(room.wordPool) ? room.wordPool : [];
    room.game = room.game || null;

    if (room.locked || (room.game && room.game.gameId)) {
      return json(409, { error: "Room is locked" });
    }

    const player = room.players.find(p => p.playerId === playerId);
    if (!player) return json(404, { error: "Player not found in room" });

    // Apply change
    player.words = words;

    // Rebuild wordPool from all players
    const poolSet = new Set();
    for (const p of room.players) {
      if (Array.isArray(p.words)) {
        for (const w of p.words) poolSet.add(normalizeWord(w));
      }
    }
    room.wordPool = Array.from(poolSet);

    room.updatedAt = new Date().toISOString();

    // Write
    await store.setJSON(roomCode, room);

    // Verify with a few reads (stale reads happen)
    let verified = false;
    for (let v = 0; v < 10; v++) {
      const verify = await store.get(roomCode, { type: "json" });
      const vPlayers = Array.isArray(verify?.players) ? verify.players : [];
      const vMe = vPlayers.find(p => p.playerId === playerId);

      if (vMe && sameStringArray(vMe.words, words)) {
        verified = true;
        break;
      }
      await sleep(120 + Math.floor(Math.random() * 120));
    }

    if (verified) {
      return json(200, {
        ok: true,
        wordPoolSize: room.wordPool.length
      });
    }

    // Backoff then try again (re-read and re-apply)
    await sleep(delay + Math.floor(Math.random() * 80));
    delay = Math.min(600, Math.floor(delay * 1.25));
  }

  return json(503, { error: "Submit words not visible yet, please retry" });
}
