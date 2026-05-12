import { connectLambda, getStore } from "@netlify/blobs";
import { isValidRoomCode, roomCodeError } from "./roomCode.js";
import { VOTE_TOTAL_SECONDS, initVotePhase, resolveVoteIfEnded } from "./_vote.js";
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

  const players = Array.isArray(room.players) ? room.players : [];
  const me = players.find(p => p.playerId === playerId);
  if (!me) return json(404, { error: "Player not found in room" });

  const game = room.game;
  if (!game || !game.gameId || game.endedAt) {
    return json(409, { error: "Game has not started" });
  }

  if (!game.votePhase) game.votePhase = initVotePhase();

  if (game.votePhase.active) {
    return json(200, { ok: true, alreadyActive: true });
  }

  const triggers = Array.isArray(game.votePhase.triggers) ? game.votePhase.triggers : [];
  if (!triggers.includes(playerId)) triggers.push(playerId);
  game.votePhase.triggers = triggers;

  const threshold = Math.max(0, players.length - 1);
  if (triggers.length >= threshold) {
    const now = new Date().toISOString();
    game.votePhase.active = true;
    game.votePhase.startedAt = now;
    game.votePhase.endsAt = new Date(Date.now() + VOTE_TOTAL_SECONDS * 1000).toISOString();
    game.votePhase.endedAt = null;
    game.votePhase.votes = {};

    resolveVoteIfEnded(room, now);
  }

  room.updatedAt = new Date().toISOString();
  await store.setJSON(roomCode, room);

  return json(200, {
    ok: true,
    triggered: true,
    triggers: game.votePhase.triggers.length,
    active: !!game.votePhase.active
  });
}
