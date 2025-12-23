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
  return String(w || "")
    .trim()
    .replace(/\s+/g, " ");
}

function uniqPreserve(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
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
  const playerId = String(payload.playerId || "").trim();
  const wordsRaw = Array.isArray(payload.words) ? payload.words : null;

  if (!roomCode) return json(400, { error: "roomCode is required" });
  if (!playerId) return json(400, { error: "playerId is required" });
  if (!wordsRaw) return json(400, { error: "words must be an array" });

  // normalize + drop empties + remove duplicates within this submission
  const submitted = uniqPreserve(wordsRaw.map(normalizeWord).filter(Boolean));

  if (submitted.length === 0) return json(400, { error: "Provide at least 1 word" });

  connectLambda(event);
  const store = getStore("faker-rooms");

  const room = await store.get(roomCode, { type: "json" });
  if (!room) return json(404, { error: "Room not found" });

  if (room.locked || (room.game && room.game.gameId)) {
    return json(409, { error: "Room is locked" });
  }

  const players = Array.isArray(room.players) ? room.players : [];
  const me = players.find(p => p.playerId === playerId);
  if (!me) return json(404, { error: "Player not found in room" });

  const required = Number.isInteger(room.wordsPerPlayer) ? room.wordsPerPlayer : 4;

  me.words = Array.isArray(me.words) ? me.words : [];
  // Normalize stored words too (defensive)
  me.words = uniqPreserve(me.words.map(normalizeWord).filter(Boolean));

  // If already complete, just return status (idempotent)
  if (me.words.length >= required) {
    // rebuild pool (defensive)
    const allWords = [];
    for (const p of players) {
      const ws = Array.isArray(p.words) ? p.words : [];
      for (const w of ws) allWords.push(normalizeWord(w));
    }
    room.wordPool = uniqPreserve(allWords.filter(Boolean));
    room.updatedAt = new Date().toISOString();
    await store.setJSON(roomCode, room);

    return json(200, {
      ok: true,
      accepted: [],
      duplicates: [],
      yourTotal: me.words.length,
      required,
      remaining: 0,
      wordPoolSize: room.wordPool.length,
      note: "Already complete"
    });
  }

  // Build global set of words already in pool, EXCLUDING this player's current words.
  // This makes it legal for them to resubmit their own existing words (we just ignore).
  const global = new Set();
  for (const p of players) {
    const ws = Array.isArray(p.words) ? p.words : [];
    for (const w of ws) {
      const nw = normalizeWord(w);
      if (!nw) continue;
      if (p.playerId === playerId) continue; // exclude mine
      global.add(nw);
    }
  }

  const mySet = new Set(me.words);

  const accepted = [];
  const duplicates = [];

  let remainingBefore = required - me.words.length;

  for (const w of submitted) {
    if (remainingBefore <= 0) break;

    if (mySet.has(w)) {
      // already mine; treat as duplicate/ignored
      duplicates.push({ word: w, reason: "already_yours" });
      continue;
    }

    if (global.has(w)) {
      duplicates.push({ word: w, reason: "already_in_pool" });
      continue;
    }

    // accept
    me.words.push(w);
    mySet.add(w);
    accepted.push(w);
    remainingBefore--;
  }

  // Rebuild flattened wordPool from all players
  const allWords = [];
  for (const p of players) {
    const ws = Array.isArray(p.words) ? p.words : [];
    for (const w of ws) allWords.push(normalizeWord(w));
  }

  room.players = players;
  room.wordPool = uniqPreserve(allWords.filter(Boolean));
  room.updatedAt = new Date().toISOString();

  await store.setJSON(roomCode, room);

  const remaining = Math.max(0, required - me.words.length);

  // If they submitted some duplicates and still need more, tell them exactly.
  // This is your “one more required” message.
  return json(200, {
    ok: true,
    accepted,
    duplicates,              // includes reason: already_in_pool / already_yours
    yourTotal: me.words.length,
    required,
    remaining,
    wordPoolSize: room.wordPool.length,
    message: remaining === 0
      ? "Words submitted (complete)"
      : `Need ${remaining} more unique word${remaining === 1 ? "" : "s"}`
  });
}
