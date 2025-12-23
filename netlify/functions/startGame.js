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

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function makeId(length = 12) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function randInt(n) {
  const bytes = new Uint8Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] % n;
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

  if (!roomCode) return json(400, { error: "roomCode is required" });
  if (!playerId) return json(400, { error: "playerId is required" });

  connectLambda(event);
  const store = getStore("faker-rooms");

  let delay = 150;

  for (let attempt = 1; attempt <= 12; attempt++) {
    const room = await store.get(roomCode, { type: "json" });
    if (!room) return json(404, { error: "Room not found" });

    room.players = Array.isArray(room.players) ? room.players : [];
    room.wordPool = Array.isArray(room.wordPool) ? room.wordPool : [];
    room.game = room.game || null;

    // If already started, just return current game summary
    if (room.game && room.game.gameId) {
      return json(200, {
        ok: true,
        alreadyStarted: true,
        gameId: room.game.gameId
      });
    }

    // Must be a player in the room to start
    const starter = room.players.find(p => p.playerId === playerId);
    if (!starter) return json(404, { error: "Player not found in room" });

    // Preconditions
    const maxPlayers = room.playerCount;
    if (!Number.isInteger(maxPlayers) || maxPlayers < 3) {
      return json(400, { error: "Invalid room configuration" });
    }

    if (room.players.length < maxPlayers) {
      return json(400, { error: "Need all players to join first" });
    }

    const missing = room.players.filter(p => !Array.isArray(p.words) || p.words.length === 0);
    if (missing.length > 0) {
      return json(400, { error: "Not all players submitted words" });
    }

    if (room.wordPool.length < 2) {
      return json(400, { error: "Need at least 2 distinct words in pool" });
    }

    // Pick secret word
    const secretWord = room.wordPool[randInt(room.wordPool.length)];

    // Pick faker (impostor) player
    const fakerPlayer = room.players[randInt(room.players.length)];

    // Init game
    const now = new Date().toISOString();
    const rounds = Number.isInteger(room.rounds) && room.rounds > 0 ? room.rounds : 3;

    room.game = {
      gameId: makeId(12),
      startedAt: now,
      round: 1,
      roundsTotal: rounds,

      secretWord,
      fakerPlayerId: fakerPlayer.playerId,

      // Turn order is playerNumber ascending
      turnIndex: 0,

      // moves: [{ round, playerId, playerNumber, word, at }]
      moves: []
    };

    // Lock the room (no new joins)
    room.locked = true;
    room.updatedAt = now;

    await store.setJSON(roomCode, room);

    // Verify we can read the started game (stale reads happen)
    let verified = false;
    for (let v = 0; v < 12; v++) {
      const verify = await store.get(roomCode, { type: "json" });
      if (verify?.game?.gameId) {
        verified = true;
        break;
      }
      await sleep(120 + Math.floor(Math.random() * 120));
    }

    if (verified) {
      return json(200, {
        ok: true,
        started: true,
        gameId: room.game.gameId
      });
    }

    await sleep(delay + Math.floor(Math.random() * 100));
    delay = Math.min(700, Math.floor(delay * 1.25));
  }

  return json(503, { error: "Game start not visible yet, please retry" });
}
