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

function makeId(length = 16) {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function pickRandom(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  const idx = bytes[0] % arr.length;
  return arr[idx];
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

  // Helper: rebuild pool from players
  function rebuildPool() {
    const allWords = [];
    for (const p of players) {
      const ws = Array.isArray(p.words) ? p.words : [];
      for (const w of ws) allWords.push(normalizeWord(w));
    }
    room.players = players;
    room.wordPool = uniqPreserve(allWords.filter(Boolean));
  }

  // Helper: check if all players have submitted enough
  function allSubmittedEnough() {
    // must have full roster first
    if (!Number.isInteger(room.playerCount)) return false;
    if (players.length !== room.playerCount) return false;

    for (const p of players) {
      const ws = Array.isArray(p.words) ? p.words : [];
      const clean = ws.map(normalizeWord).filter(Boolean);
      if (clean.length < required) return false;
    }
    return true;
  }

  // If already complete, just return status (idempotent)
  if (me.words.length >= required) {
    rebuildPool();
    room.updatedAt = new Date().toISOString();
    await store.setJSON(roomCode, room);

    // If everyone is complete, auto-start here too (in case player completed earlier)
    let autoStarted = false;
    if (!room.locked && !(room.game && room.game.gameId) && allSubmittedEnough()) {
      const secretWord = pickRandom(room.wordPool);
      const fakerPlayerId = pickRandom(players)?.playerId || null;

      room.locked = true;
      room.game = {
        gameId: makeId(12),
        startedAt: new Date().toISOString(),
        round: 1,
        turnIndex: 0,
        secretWord,
        fakerPlayerId,
        moves: [] // { round, playerId, word, at }
      };
      room.updatedAt = new Date().toISOString();
      await store.setJSON(roomCode, room);
      autoStarted = true;
    }

    return json(200, {
      ok: true,
      accepted: [],
      duplicates: [],
      yourTotal: me.words.length,
      required,
      remaining: 0,
      wordPoolSize: Array.isArray(room.wordPool) ? room.wordPool.length : 0,
      note: "Already complete",
      autoStarted,
      game: room.game || null
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
  rebuildPool();

  room.updatedAt = new Date().toISOString();

  // AUTO-START if everyone is done now
  let autoStarted = false;
  if (!room.locked && !(room.game && room.game.gameId) && allSubmittedEnough()) {
    const secretWord = pickRandom(room.wordPool);
    const fakerPlayerId = pickRandom(players)?.playerId || null;

    room.locked = true;
    room.game = {
      gameId: makeId(12),
      startedAt: new Date().toISOString(),
      round: 1,
      turnIndex: 0,
      secretWord,
      fakerPlayerId,
      moves: []
    };
    autoStarted = true;
  }

  await store.setJSON(roomCode, room);

  const remaining = Math.max(0, required - me.words.length);

  return json(200, {
    ok: true,
    accepted,
    duplicates,
    yourTotal: me.words.length,
    required,
    remaining,
    wordPoolSize: Array.isArray(room.wordPool) ? room.wordPool.length : 0,
    message: remaining === 0
      ? "Words submitted (complete)"
      : `Need ${remaining} more unique word${remaining === 1 ? "" : "s"}`,
    autoStarted,
    game: room.game || null
  });
}
