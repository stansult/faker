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
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON body" }); }

  const roomCode = String(payload.roomCode || "").trim().toUpperCase();
  if (!roomCode) return json(400, { error: "roomCode is required" });

  connectLambda(event);
  const store = getStore("faker-rooms");
  const room = await store.get(roomCode, { type: "json" });
  if (!room) return json(404, { error: "Room not found" });

  const players = Array.isArray(room.players) ? room.players : [];
  const missingWords = players.filter(p => !Array.isArray(p.words) || p.words.length === 0);

  const game = room.game && room.game.gameId
    ? {
      gameId: room.game.gameId,
      round: room.game.round,
      startedAt: room.game.startedAt
    }
    : null;

  return json(200, {
    locked: !!room.locked,
    playerCount: players.length,
    missingWordsCount: missingWords.length,
    missingPlayerNumbers: missingWords.map(p => p.playerNumber),
    wordPoolSize: Array.isArray(room.wordPool) ? room.wordPool.length : 0,
    game
  });

}
