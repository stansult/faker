import { connectLambda, getStore } from "@netlify/blobs";
import { MAX_WORD_LENGTH } from "../../shared/validationConstants.js";
import { isValidRoomCode, roomCodeError } from "./roomCode.js";
import { wordTooLongError } from "./validationErrors.js";

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

function getWordRuleHint(language) {
  return language === "ru"
    ? "Use Russian letters only (including ё), hyphens, apostrophes."
    : "Use English letters only (a-z), hyphens, apostrophes.";
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

  connectLambda(event);
  const store = getStore("faker-rooms");

  const room = await store.get(roomCode, { type: "json" });
  if (!room) return json(404, { error: "Room not found" });

  if (room.matchEnded) {
    return json(409, { error: "Match ended" });
  }

  const language = getRoomLanguage(room);

  // Once game started, no edits allowed.
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

  const normalized = uniqPreserve(wordsRaw.map(normalizeWord).filter(Boolean));
  let hasTooLong = false;
  let hasInvalid = false;
  const submitted = normalized.filter(word => {
    if (word.length > MAX_WORD_LENGTH) {
      hasTooLong = true;
      return false;
    }
    if (!isAllowedWord(word, language)) {
      hasInvalid = true;
      return false;
    }
    return true;
  });

  if (hasTooLong) {
    return json(400, wordTooLongError());
  }

  if (hasInvalid) {
    return json(400, { error: getWordRuleHint(language) });
  }

  if (submitted.length > required) {
    return json(400, { error: `Too many words (max ${required})` });
  }

  const global = new Set();
  for (const p of players) {
    if (p.playerId === playerId) continue;
    const ws = Array.isArray(p.words) ? p.words : [];
    for (const w of ws) {
      const nw = normalizeWord(w);
      if (nw) global.add(nw);
    }
  }

  const conflict = submitted.find(w => global.has(w));
  if (conflict) {
    return json(409, { error: `Word already used by another player: ${conflict}` });
  }

  me.words = submitted;

  const usedWords = Array.isArray(room.usedWords)
    ? room.usedWords.map(normalizeWord).filter(Boolean)
    : [];
  const usedSet = new Set(usedWords);

  const allWords = [];
  for (const p of players) {
    const ws = Array.isArray(p.words) ? p.words : [];
    for (const w of ws) {
      const nw = normalizeWord(w);
      if (nw) allWords.push(nw);
    }
  }

  room.players = players;
  room.wordPool = uniqPreserve(allWords).filter(w => !usedSet.has(w));
  room.updatedAt = new Date().toISOString();
  await store.setJSON(roomCode, room);

  const remaining = Math.max(0, required - me.words.length);

  return json(200, {
    ok: true,
    words: me.words,
    yourTotal: me.words.length,
    required,
    remaining,
    wordPoolSize: Array.isArray(room.wordPool) ? room.wordPool.length : 0
  });
}
