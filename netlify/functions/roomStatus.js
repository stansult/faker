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
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const roomCode = String(payload.roomCode || "").trim().toUpperCase();
  if (!roomCode) return json(400, { error: "roomCode is required" });

  connectLambda(event);
  const store = getStore("faker-rooms");

  const room = await store.get(roomCode, { type: "json" });
  if (!room) return json(404, { error: "Room not found" });

  const maxPlayers = Number.isInteger(room.playerCount) ? room.playerCount : 0;
  const wordsRequired = Number.isInteger(room.wordsPerPlayer) ? room.wordsPerPlayer : 4;

  const players = Array.isArray(room.players) ? room.players : [];

  // Normalize words defensively so counts match what submitWords expects.
  for (const p of players) {
    p.words = Array.isArray(p.words) ? p.words.map(normalizeWord).filter(Boolean) : [];
  }

  // Joined players list (sorted by playerNumber)
  const playersView = players
    .slice()
    .sort((a, b) => (a.playerNumber ?? 0) - (b.playerNumber ?? 0))
    .map(p => {
      const wordsSubmitted = Array.isArray(p.words) ? p.words.length : 0;
      return {
        playerId: p.playerId,
        playerNumber: p.playerNumber,
        name: p.name || null,
        wordsSubmitted,
        wordsRequired,
        ready: wordsSubmitted >= wordsRequired
      };
    });

  const currentPlayers = playersView.length;

  // Missing readiness among joined players
  const missingWordsPlayers = playersView
    .filter(p => !p.ready)
    .map(p => ({
      playerId: p.playerId,
      playerNumber: p.playerNumber,
      name: p.name || null,
      missing: Math.max(0, wordsRequired - p.wordsSubmitted)
    }));

  // Missing join slots (if room expects a fixed roster)
  const joinedNums = new Set(playersView.map(p => p.playerNumber));
  const missingJoinNumbers = [];
  if (maxPlayers > 0) {
    for (let n = 1; n <= maxPlayers; n++) {
      if (!joinedNums.has(n)) missingJoinNumbers.push(n);
    }
  }

  const allJoined = maxPlayers > 0 && currentPlayers === maxPlayers;
  const allReady = allJoined && missingWordsPlayers.length === 0;

  const game =
    room.game && room.game.gameId
      ? {
          gameId: room.game.gameId,
          round: room.game.round,
          startedAt: room.game.startedAt,
          turnIndex: room.game.turnIndex ?? 0
        }
      : null;

  return json(200, {
    roomCode,
    locked: !!room.locked,
    maxPlayers,
    currentPlayers,
    wordsRequired,
    wordPoolSize: Array.isArray(room.wordPool) ? room.wordPool.length : 0,

    players: playersView,

    // convenience fields for UI
    missingJoinNumbers,
    missingWordsPlayers,
    allJoined,
    allReady,
    canStart: !room.locked && !game && allReady,

    game
  });
}
