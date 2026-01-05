import { connectLambda, getStore } from "@netlify/blobs";
import { MAX_WORD_LENGTH } from "../../shared/validationConstants.js";
import { isValidRoomCode, roomCodeError } from "./roomCode.js";

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

function getRoomLanguage(room) {
  return room?.language === "ru" ? "ru" : "en";
}

function isAllowedWord(word, language) {
  const value = String(word || "");
  if (language === "ru") {
    return /^[а-яё'-]+$/i.test(value);
  }
  return /^[a-z'-]+$/i.test(value);
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
  if (!isValidRoomCode(roomCode)) {
    return json(400, roomCodeError());
  }
  if (!playerId) return json(400, { error: "playerId is required" });
  if (!wordsRaw) return json(400, { error: "words must be an array" });

  // normalize + drop empties + remove dupes within this submission
  connectLambda(event);
  const store = getStore("faker-rooms");

  const room = await store.get(roomCode, { type: "json" });
  if (!room) return json(404, { error: "Room not found" });

  if (room.matchEnded) {
    return json(409, { error: "Match ended" });
  }

  const language = getRoomLanguage(room);

  const invalid = [];
  const submitted = uniqPreserve(wordsRaw.map(normalizeWord).filter(Boolean)).filter(word => {
    if (word.length > MAX_WORD_LENGTH) {
      invalid.push({ word, reason: "too_long" });
      return false;
    }
    if (!isAllowedWord(word, language)) {
      invalid.push({ word, reason: "invalid_format" });
      return false;
    }
    return true;
  });

  // Once game started, no more word submissions
  if (room.locked || (room.game && room.game.gameId)) {
    return json(409, { error: "Room is locked" });
  }

  const players = Array.isArray(room.players) ? room.players : [];
  const me = players.find(p => p.playerId === playerId);
  if (!me) return json(404, { error: "Player not found in room" });

  if (me.doneWords) {
    return json(409, { error: "Words are locked" });
  }

  const required = Number.isInteger(room.wordsPerPlayer) ? room.wordsPerPlayer : 4;

  if (submitted.length === 0) {
    if (invalid.length > 0) {
      return json(200, {
        ok: true,
        accepted: [],
        duplicates: invalid.map(item => ({ word: item.word, reason: item.reason })),
        yourTotal: me.words.length,
        required,
        remaining: Math.max(0, required - me.words.length),
        wordPoolSize: Array.isArray(room.wordPool) ? room.wordPool.length : 0,
        note: "No valid words"
      });
    }
    return json(400, { error: "Provide at least 1 word" });
  }

  me.words = Array.isArray(me.words) ? me.words : [];
  // Normalize stored words too (defensive)
  me.words = uniqPreserve(me.words.map(normalizeWord).filter(Boolean));

  // Helper: rebuild pool from players
  function rebuildPool() {
    const allWords = [];
    for (const p of players) {
      const ws = Array.isArray(p.words) ? p.words : [];
      for (const w of ws) {
        const nw = normalizeWord(w);
        if (nw) allWords.push(nw);
      }
    }
    room.players = players;
    room.wordPool = uniqPreserve(allWords);
  }

  // If already complete, don’t accept more; still keep pool consistent
  if (me.words.length >= required) {
    rebuildPool();
    room.updatedAt = new Date().toISOString();
    await store.setJSON(roomCode, room);

    return json(200, {
      ok: true,
      accepted: [],
      duplicates: [],
      yourTotal: me.words.length,
      required,
      remaining: 0,
      wordPoolSize: Array.isArray(room.wordPool) ? room.wordPool.length : 0,
      note: "Already complete"
    });
  }

  // Global words already used by OTHER players
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
  const duplicates = invalid.map(word => ({ word, reason: "invalid_format" }));

  let slotsLeft = required - me.words.length;

  for (const w of submitted) {
    if (slotsLeft <= 0) break;

    if (mySet.has(w)) {
      duplicates.push({ word: w, reason: "already_yours" });
      continue;
    }

    if (global.has(w)) {
      duplicates.push({ word: w, reason: "already_in_pool" });
      continue;
    }

    me.words.push(w);
    mySet.add(w);
    accepted.push(w);
    slotsLeft--;
  }

  rebuildPool();
  room.updatedAt = new Date().toISOString();
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
    message:
      remaining === 0
        ? "Words submitted (complete)"
        : `Need ${remaining} more unique word${remaining === 1 ? "" : "s"}`
  });
}
