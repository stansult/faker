import { connectLambda, getStore } from "@netlify/blobs";
import { initVotePhase, ensureScores } from "./_vote.js";

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

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

const RETRY_START_DELAY_MS = 150;
const RETRY_MAX_DELAY_MS = 700;
const RETRY_BACKOFF = 1.25;
const RETRY_MAX_ATTEMPTS = 12;
const VERIFY_MAX_ATTEMPTS = 12;
const VERIFY_SLEEP_MIN_MS = 120;
const VERIFY_SLEEP_JITTER_MS = 120;

function makeId(length = 12) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
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
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
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
  const startShort = !!payload.startShort;

  if (!roomCode) return json(400, { error: "roomCode is required" });
  if (!playerId) return json(400, { error: "playerId is required" });

  connectLambda(event);
  const store = getStore("faker-rooms");

  // Only this endpoint starts the game.
  // Small retry loop because room visibility can lag (eventual consistency).
  let delay = RETRY_START_DELAY_MS;

  for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
    const room = await store.get(roomCode, { type: "json" });
    if (!room) return json(404, { error: "Room not found" });

    room.players = Array.isArray(room.players) ? room.players : [];
    room.wordPool = Array.isArray(room.wordPool) ? room.wordPool : [];
    room.game = room.game || null;

    // Idempotent: if already started and not ended, just return
    if (room.game && room.game.gameId && !room.game.endedAt) {
      return json(200, { ok: true, alreadyStarted: true, gameId: room.game.gameId });
    }

    const starter = room.players.find(p => p.playerId === playerId);
    if (!starter) return json(404, { error: "Player not found in room" });

    // Require all players joined (unless startShort)
    const maxPlayers = Number.isInteger(room.maxPlayers)
      ? room.maxPlayers
      : (Number.isInteger(room.playerCount) ? room.playerCount : null);
    const effectiveMaxPlayers = Number.isInteger(room.effectiveMaxPlayers)
      ? room.effectiveMaxPlayers
      : (room.locked ? room.players.length : maxPlayers);

    if (!effectiveMaxPlayers) return json(500, { error: "Room is missing player count" });

    if (room.locked && room.players.length < 3) {
      room.matchEnded = true;
      room.matchEndReason = "insufficient_players";
      room.updatedAt = new Date().toISOString();
      await store.setJSON(roomCode, room);
      return json(409, { error: "Not enough players to continue match" });
    }

    if (room.players.length < effectiveMaxPlayers) {
      if (!startShort) {
        return json(409, { error: `Need ${effectiveMaxPlayers} players to start` });
      }

      // Short start: host-only, lock roster to current players
      if (starter.playerNumber !== 1) {
        return json(403, { error: "Only host (player 1) can start short" });
      }
      room.effectiveMaxPlayers = room.players.length;
    }

    // Require all players have submitted required words
    const required = Number.isInteger(room.wordsPerPlayer) ? room.wordsPerPlayer : 4;

    const missing = [];
    for (const p of room.players) {
      const ws = Array.isArray(p.words) ? p.words : [];
      const normalized = ws.map(normalizeWord).filter(Boolean);
      const unique = uniqPreserve(normalized);
      if (!p.doneWords || unique.length < required) missing.push(p.playerNumber);
    }

    if (missing.length) {
      return json(409, {
        error: "Not all players submitted words",
        missingPlayerNumbers: missing,
        required
      });
    }

    // Build authoritative pool from players (unique)
    const allWords = [];
    for (const p of room.players) {
      const ws = Array.isArray(p.words) ? p.words : [];
      for (const w of ws) allWords.push(normalizeWord(w));
    }
    const usedWords = Array.isArray(room.usedWords)
      ? room.usedWords.map(normalizeWord).filter(Boolean)
      : [];
    const usedSet = new Set(usedWords);
    room.wordPool = uniqPreserve(allWords.filter(Boolean)).filter(w => !usedSet.has(w));

    const gamesTotal = Number.isInteger(room.gamesTotal) ? room.gamesTotal : null;
    const gamesPlayed = Number.isInteger(room.gamesPlayed) ? room.gamesPlayed : 0;
    if (gamesTotal != null && gamesPlayed >= gamesTotal) {
      room.matchEnded = true;
      room.locked = true;
      room.effectiveMaxPlayers = room.players.length;
      room.updatedAt = new Date().toISOString();
      await store.setJSON(roomCode, room);
      return json(409, { error: "Match already ended" });
    }

    if (room.wordPool.length < 2) {
      return json(409, { error: "Word pool too small to start" });
    }

    // Pick secret + faker
    const secretWord = pick(room.wordPool);
    const faker = pick(room.players).playerId;

    const now = new Date().toISOString();
    const roundsTotal = Number.isInteger(room.roundsPerGame)
      ? room.roundsPerGame
      : (Number.isInteger(room.rounds) ? room.rounds : 3);

    ensureScores(room.players);

    const updatedUsed = uniqPreserve([...usedWords, secretWord]);
    room.usedWords = updatedUsed;
    room.wordPool = room.wordPool.filter(w => w !== secretWord);

    const sortedPlayers = room.players
      .slice()
      .sort((a, b) => (a.playerNumber || 0) - (b.playerNumber || 0));
    const nextStarterNumber = Number.isInteger(room.nextStarterNumber)
      ? room.nextStarterNumber
      : 1;
    const starterIndex = sortedPlayers.findIndex(p => p.playerNumber === nextStarterNumber);
    const turnIndex = starterIndex >= 0 ? starterIndex : 0;
    const nextStarter =
      sortedPlayers.length > 0
        ? sortedPlayers[(turnIndex + 1) % sortedPlayers.length]
        : null;

    room.game = {
      gameId: makeId(16),
      startedAt: now,
      round: 1,
      roundsTotal,
      secretWord,
      fakerPlayerId: faker,
      turnIndex,
      moves: [],
      votePhase: initVotePhase()
    };

    room.locked = true;
    room.effectiveMaxPlayers = room.players.length;
    room.nextStarterNumber = nextStarter?.playerNumber ?? 1;
    room.updatedAt = now;

    await store.setJSON(roomCode, room);

    // Verify visibility (eventual consistency)
    let verified = false;
    for (let v = 0; v < VERIFY_MAX_ATTEMPTS; v++) {
      const verify = await store.get(roomCode, { type: "json" });
      if (verify?.game?.gameId) {
        verified = true;
        break;
      }
      await sleep(VERIFY_SLEEP_MIN_MS + Math.floor(Math.random() * VERIFY_SLEEP_JITTER_MS));
    }

    if (verified) {
      return json(200, { ok: true, started: true, gameId: room.game.gameId });
    }

    await sleep(delay + Math.floor(Math.random() * 100));
    delay = Math.min(RETRY_MAX_DELAY_MS, Math.floor(delay * RETRY_BACKOFF));
  }

  return json(503, { error: "Game start not visible yet, please retry" });
}
