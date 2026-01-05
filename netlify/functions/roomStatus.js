import { connectLambda, getStore } from "@netlify/blobs";
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
  if (!isValidRoomCode(roomCode)) {
    return json(400, roomCodeError());
  }

  connectLambda(event);
  const store = getStore("faker-rooms");

  const room = await store.get(roomCode, { type: "json" });
  if (!room) return json(404, { error: "Room not found" });

  const maxPlayers = Number.isInteger(room.playerCount) ? room.playerCount : 0;
  const roundsPerGame = Number.isInteger(room.roundsPerGame)
    ? room.roundsPerGame
    : (Number.isInteger(room.rounds) ? room.rounds : 3);
  const wordsRequired = Number.isInteger(room.wordsPerPlayer) ? room.wordsPerPlayer : 4;
  const gamesTotal = Number.isInteger(room.gamesTotal) ? room.gamesTotal : null;
  const gamesPlayed = Number.isInteger(room.gamesPlayed) ? room.gamesPlayed : 0;
  const matchEnded = !!room.matchEnded;
  const matchEndReason = room.matchEndReason || null;
  const language = room.language === "ru" ? "ru" : "en";

  const players = Array.isArray(room.players) ? room.players : [];
  const effectiveMaxPlayers = Number.isInteger(room.effectiveMaxPlayers)
    ? room.effectiveMaxPlayers
    : (room.locked ? players.length : maxPlayers);

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
      const doneWords = !!p.doneWords;
      return {
        playerId: p.playerId,
        playerNumber: p.playerNumber,
        name: p.name || null,
        score: Number.isInteger(p.score) ? p.score : 0,
        wordsSubmitted,
        wordsRequired,
        doneWords,
        ready: doneWords && wordsSubmitted >= wordsRequired
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
  if (effectiveMaxPlayers > 0) {
    for (let n = 1; n <= effectiveMaxPlayers; n++) {
      if (!joinedNums.has(n)) missingJoinNumbers.push(n);
    }
  }

  const allJoined = effectiveMaxPlayers > 0 && currentPlayers === effectiveMaxPlayers;
  const allReady = allJoined && missingWordsPlayers.length === 0;
  const allJoinedReady = currentPlayers > 0 && missingWordsPlayers.length === 0;

  const game =
    room.game && room.game.gameId
      ? {
          gameId: room.game.gameId,
          round: room.game.round,
          startedAt: room.game.startedAt,
          turnIndex: room.game.turnIndex ?? 0,
          endedAt: room.game.endedAt || null,
          winner: room.game.winner || null,
          endReason: room.game.endReason || null,
          revealedWord: room.game.endedAt ? room.game.secretWord || null : null,
          fakerName: room.game.endedAt
            ? (players.find(p => p.playerId === room.game.fakerPlayerId)?.name || null)
            : null,
          fakerPlayerNumber: room.game.endedAt
            ? (players.find(p => p.playerId === room.game.fakerPlayerId)?.playerNumber || null)
            : null
        }
      : null;

  return json(200, {
    roomCode,
    locked: !!room.locked,
    maxPlayers,
    effectiveMaxPlayers,
    currentPlayers,
    roundsPerGame,
    wordsRequired,
    wordPoolSize: Array.isArray(room.wordPool) ? room.wordPool.length : 0,
    usedWords: Array.isArray(room.usedWords) ? room.usedWords : [],
    gamesTotal,
    gamesPlayed,
    matchEnded,
    matchEndReason,
    language,

    players: playersView,

    // convenience fields for UI
    missingJoinNumbers,
    missingWordsPlayers,
    allJoined,
    allReady,
    allJoinedReady,
    canStart: (!game || game.endedAt) && allReady && !matchEnded,

    game
  });
}
