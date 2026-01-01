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
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const roomCode = String(payload.roomCode || "").trim().toUpperCase();
  const playerId = String(payload.playerId || "").trim();

  if (!roomCode) return json(400, { error: "roomCode is required" });
  if (!playerId) return json(400, { error: "playerId is required" });

  connectLambda(event);
  const store = getStore("faker-rooms");

  const room = await store.get(roomCode, { type: "json" });
  if (!room) return json(404, { error: "Room not found" });

  const game = room.game;
  if (game && game.gameId && !game.endedAt) {
    return json(409, { error: "Cannot leave during active game" });
  }

  const players = Array.isArray(room.players) ? room.players : [];
  const idx = players.findIndex(p => p.playerId === playerId);
  if (idx === -1) return json(404, { error: "Player not found in room" });

  players.splice(idx, 1);
  const renumbered = players
    .slice()
    .sort((a, b) => (a.playerNumber || 0) - (b.playerNumber || 0))
    .map((p, i) => ({ ...p, playerNumber: i + 1 }));

  room.players = renumbered;
  room.updatedAt = new Date().toISOString();
  if (!Number.isInteger(room.playerCount)) {
    room.playerCount = players.length;
  }
  if (room.locked) {
    room.effectiveMaxPlayers = renumbered.length;
    if (renumbered.length < 3) {
      room.matchEnded = true;
      room.matchEndReason = "insufficient_players";
    }
  }
  if (Number.isInteger(room.nextStarterNumber) && renumbered.length > 0) {
    if (room.nextStarterNumber > renumbered.length) {
      room.nextStarterNumber = 1;
    }
  }

  await store.setJSON(roomCode, room);

  return json(200, { ok: true, remainingPlayers: players.length });
}
