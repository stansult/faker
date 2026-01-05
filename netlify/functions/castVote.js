import { connectLambda, getStore } from "@netlify/blobs";
import { isValidRoomCode } from "./roomCode.js";
import { VOTE_FINAL_SECONDS, resolveVoteIfEnded } from "./_vote.js";

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
  const targetPlayerId = payload.targetPlayerId == null ? null : String(payload.targetPlayerId).trim();

  if (!roomCode) return json(400, { error: "roomCode is required" });
  if (!isValidRoomCode(roomCode)) {
    return json(400, { error: "Invalid room code." });
  }
  if (!playerId) return json(400, { error: "playerId is required" });

  connectLambda(event);
  const store = getStore("faker-rooms");

  const room = await store.get(roomCode, { type: "json" });
  if (!room) return json(404, { error: "Room not found" });

  const players = Array.isArray(room.players) ? room.players : [];
  const me = players.find(p => p.playerId === playerId);
  if (!me) return json(404, { error: "Player not found in room" });

  const game = room.game;
  if (!game || !game.gameId || game.endedAt) {
    return json(409, { error: "Game has not started" });
  }

  const vote = game.votePhase;
  if (!vote || !vote.active) {
    return json(409, { error: "Voting is not active" });
  }

  if (targetPlayerId && targetPlayerId === playerId) {
    return json(400, { error: "You cannot vote for yourself" });
  }

  if (targetPlayerId && !players.find(p => p.playerId === targetPlayerId)) {
    return json(404, { error: "Target player not found" });
  }

  const nowIso = new Date().toISOString();
  vote.votes = vote.votes && typeof vote.votes === "object" ? vote.votes : {};
  vote.votes[playerId] = targetPlayerId;

  // If everyone voted early, shorten to final seconds
  const votedCount = players.filter(p => vote.votes[p.playerId] != null).length;
  if (votedCount === players.length && vote.endsAt) {
    const remainingMs = Date.parse(vote.endsAt) - Date.now();
    if (remainingMs > VOTE_FINAL_SECONDS * 1000) {
      vote.endsAt = new Date(Date.now() + VOTE_FINAL_SECONDS * 1000).toISOString();
    }
  }

  resolveVoteIfEnded(room, nowIso);

  room.updatedAt = nowIso;
  await store.setJSON(roomCode, room);

  return json(200, {
    ok: true,
    votedFor: targetPlayerId,
    endsAt: vote.endsAt
  });
}
