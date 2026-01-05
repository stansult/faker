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
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON body" }); }

  const roomCode = String(payload.roomCode || "").trim().toUpperCase();
  const playerNumber = Number(payload.playerNumber);

  if (!roomCode) return json(400, { error: "roomCode is required" });
  if (!isValidRoomCode(roomCode)) {
    return json(400, roomCodeError());
  }
  if (!Number.isInteger(playerNumber) || playerNumber < 1) {
    return json(400, { error: "playerNumber must be an integer >= 1" });
  }

  connectLambda(event);
  const store = getStore("faker-rooms");
  const room = await store.get(roomCode, { type: "json" });
  if (!room) return json(404, { error: "Room not found" });

  const players = Array.isArray(room.players) ? room.players : [];
  const p = players.find(x => x.playerNumber === playerNumber);
  if (!p) return json(404, { error: "Player number not found" });

  return json(200, { playerId: p.playerId, playerNumber: p.playerNumber });
}
