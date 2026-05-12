import { connectLambda, getStore } from "@netlify/blobs";
import { isValidRoomCode, roomCodeError } from "./roomCode.js";
import { isActiveRoomExpired, roomExpiredError } from "./roomExpiry.js";

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
  const playerId = String(payload.playerId || "").trim();

  if (!roomCode) return json(400, { error: "roomCode is required" });
  if (!isValidRoomCode(roomCode)) {
    return json(400, roomCodeError());
  }
  if (!playerId) return json(400, { error: "playerId is required" });

  connectLambda(event);
  const store = getStore("faker-rooms");

  const room = await store.get(roomCode, { type: "json" });
  if (!room) return json(404, { error: "Room not found" });
  if (isActiveRoomExpired(room)) return json(410, roomExpiredError());

  const game = room.game;
  if (!game || !game.gameId) return json(409, { error: "Game has not started" });

  const players = Array.isArray(room.players) ? room.players : [];
  const me = players.find(p => p.playerId === playerId);
  if (!me) return json(404, { error: "Player not found in room" });

  const secretWord = String(game.secretWord || "");
  const fakerPlayerId = String(game.fakerPlayerId || "");
  if (!secretWord || !fakerPlayerId) {
    return json(500, { error: "Game state incomplete" });
  }

  const isFaker = playerId === fakerPlayerId;

  return json(200, {
    ok: true,
    role: isFaker ? "faker" : "player",
    playerNumber: me.playerNumber,
    // reveal secret only to non-faker:
    secretWord: isFaker ? null : secretWord
  });
}
