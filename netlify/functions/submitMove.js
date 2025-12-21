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
    return { statusCode: 204, headers: { "access-control-allow-origin": "*" }, body: "" };
  }
  if (event.httpMethod !== "POST") return json(405, { error: "Use POST" });

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON body" }); }

  const roomCode = String(payload.roomCode || "").trim().toUpperCase();
  const playerId = String(payload.playerId || "").trim();
  const word = String(payload.word || "").trim();

  if (!roomCode) return json(400, { error: "roomCode is required" });
  if (!playerId) return json(400, { error: "playerId is required" });
  if (!word) return json(400, { error: "word is required" });
  if (word.length > 40) return json(400, { error: "Word too long" });

  connectLambda(event);
  const store = getStore("faker-rooms");
  const room = await store.get(roomCode, { type: "json" });

  if (!room) return json(404, { error: "Room not found" });
  if (!room.game) return json(409, { error: "Game not started" });
  if (room.game.gameOver) return json(409, { error: "Game already over" });

  const players = room.players || [];
  const player = players.find(p => p.playerId === playerId);
  if (!player) return json(404, { error: "Player not found" });

  // Initialize move state if missing
  room.game.currentTurn ??= 1;
  room.game.round ??= 1;
  room.game.moves ??= [];

  if (player.playerNumber !== room.game.currentTurn) {
    return json(409, { error: "Not your turn" });
  }

  // Prevent multiple moves in same round
  if (room.game.moves.some(m =>
    m.round === room.game.round && m.playerId === playerId
  )) {
    return json(409, { error: "Already moved this round" });
  }

  const isFaker = room.game.fakerPlayerId === playerId;
  const secret = room.game.secretWord;

  if (!isFaker && word.toLowerCase() === secret.toLowerCase()) {
    return json(409, { error: "You cannot say the secret word" });
  }

  const now = new Date().toISOString();

  // Instant win condition
  if (isFaker && word.toLowerCase() === secret.toLowerCase()) {
    room.game.gameOver = true;
    room.game.winner = "FAKER";
    room.game.winningPlayerNumber = player.playerNumber;

    room.game.moves.push({
      round: room.game.round,
      playerNumber: player.playerNumber,
      playerId,
      word,
      at: now,
      instantWin: true
    });

    await store.setJSON(roomCode, room);
    return json(200, { ok: true, gameOver: true, winner: "FAKER" });
  }

  // Record normal move
  room.game.moves.push({
    round: room.game.round,
    playerNumber: player.playerNumber,
    playerId,
    word,
    at: now
  });

  // Advance turn
  if (room.game.currentTurn === players.length) {
    room.game.currentTurn = 1;
    room.game.round += 1;
  } else {
    room.game.currentTurn += 1;
  }

  await store.setJSON(roomCode, room);

  return json(200, {
    ok: true,
    nextTurn: room.game.currentTurn,
    round: room.game.round
  });
}
