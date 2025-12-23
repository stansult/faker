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
  const playerId = payload.playerId ? String(payload.playerId).trim() : null;

  if (!roomCode) return json(400, { error: "roomCode is required" });

  connectLambda(event);
  const store = getStore("faker-rooms");

  const room = await store.get(roomCode, { type: "json" });
  if (!room) return json(404, { error: "Room not found" });

  const players = Array.isArray(room.players) ? room.players : [];
  const maxPlayers = Number.isInteger(room.playerCount) ? room.playerCount : null;
  const currentPlayers = players.length;

  const me = playerId ? players.find(p => p.playerId === playerId) : null;

  const game = room.game && room.game.gameId ? room.game : null;

  // Public game summary (safe for everyone)
  let gameSummary = null;
  if (game) {
    const sortedPlayers = players
      .slice()
      .sort((a, b) => (a.playerNumber || 0) - (b.playerNumber || 0));

    const turnIndex = Number.isInteger(game.turnIndex) ? game.turnIndex : 0;
    const nextPlayer = sortedPlayers.length
      ? sortedPlayers[turnIndex % sortedPlayers.length]
      : null;

    const moves = Array.isArray(game.moves) ? game.moves : [];
    const round = Number.isInteger(game.round) ? game.round : 1;

    const lastMoves = moves
      .slice(-20)
      .map(m => ({
        round: m.round,
        playerNumber: m.playerNumber,
        word: m.word,
        at: m.at
      }));

    const movesThisRound = moves
      .filter(m => m.round === round)
      .map(m => ({
        playerNumber: m.playerNumber,
        word: m.word,
        at: m.at
      }));

    gameSummary = {
      gameId: game.gameId,
      startedAt: game.startedAt || null,

      round,
      roundsTotal: Number.isInteger(game.roundsTotal) ? game.roundsTotal : null,

      nextPlayerNumber: nextPlayer ? nextPlayer.playerNumber : null,

      endedAt: game.endedAt || null,
      winner: game.winner || null,
      endReason: game.endReason || null,

      movesThisRound,
      lastMoves
    };
  }

  // Private info: only for faker
  // (We do NOT reveal faker identity to others.)
  let yourRole = null;
  let secretWord = null;

  if (game && me) {
    const fakerPlayerId = String(game.fakerPlayerId || "");
    const secret = String(game.secretWord || "");
    const isFaker = fakerPlayerId && me.playerId === fakerPlayerId;

    yourRole = isFaker ? "faker" : "player";
    secretWord = isFaker ? secret : null;
  }

  return json(200, {
    roomCode,
    locked: !!room.locked,
    maxPlayers,
    currentPlayers,

    you: me
      ? {
          playerId: me.playerId,
          playerNumber: me.playerNumber
        }
      : null,

    yourRole,     // null if playerId not provided or game not started
    secretWord,   // only for faker, otherwise null

    game: gameSummary
  });
}
