import { connectLambda, getStore } from "@netlify/blobs";
import { ensureScores, finalizeGameEnd, initVotePhase, VOTE_TOTAL_SECONDS } from "./_vote.js";

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

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

const MOVE_ID_LENGTH = 12;
const MAX_WORD_LENGTH = 40;
const RETRY_START_DELAY_MS = 150;
const RETRY_MAX_DELAY_MS = 700;
const RETRY_BACKOFF = 1.25;
const RETRY_MAX_ATTEMPTS = 12;
const VERIFY_MAX_ATTEMPTS = 12;
const VERIFY_SLEEP_MIN_MS = 120;
const VERIFY_SLEEP_JITTER_MS = 120;

function makeId(length = MOVE_ID_LENGTH) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function normalizeWord(w) {
  return String(w || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isAllowedWord(word) {
  return /^[a-z'-]+$/.test(String(word || ""));
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
  const word = normalizeWord(payload.word);

  if (!roomCode) return json(400, { error: "roomCode is required" });
  if (!playerId) return json(400, { error: "playerId is required" });
  if (!word) return json(400, { error: "word is required" });
  if (!isAllowedWord(word)) {
    return json(400, { error: "One word only - letters, hyphens, apostrophes." });
  }
  if (word.length > MAX_WORD_LENGTH) {
    return json(400, { error: `Word too long (max ${MAX_WORD_LENGTH} chars)` });
  }

  connectLambda(event);
  const store = getStore("faker-rooms");

  const moveId = makeId(MOVE_ID_LENGTH);

  // Merge-safe update with verification (helps with eventual consistency / concurrent writes)
  let delay = RETRY_START_DELAY_MS;

  for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
    const room = await store.get(roomCode, { type: "json" });
    if (!room) return json(404, { error: "Room not found" });

    room.players = Array.isArray(room.players) ? room.players : [];
    room.game = room.game || null;

    if (!room.game || !room.game.gameId) {
      return json(409, { error: "Game has not started" });
    }

    const game = room.game;
    const voteActive = !!game.votePhase?.active;
    if (voteActive) {
      return json(409, { error: "Voting in progress" });
    }

    if (game.endedAt) {
      return json(409, {
        error: "Game already ended",
        endedAt: game.endedAt,
        winner: game.winner || null,
        endReason: game.endReason || null
      });
    }

    const players = room.players.slice().sort((a, b) => (a.playerNumber || 0) - (b.playerNumber || 0));
    const me = players.find(p => p.playerId === playerId);
    if (!me) return json(404, { error: "Player not found in room" });

    const secretWord = String(game.secretWord || "");
    const fakerPlayerId = String(game.fakerPlayerId || "");
    if (!secretWord || !fakerPlayerId) {
      return json(500, { error: "Game state incomplete (missing secretWord/fakerPlayerId)" });
    }

    // Enforce turn order
    const turnIndex = Number.isInteger(game.turnIndex) ? game.turnIndex : 0;
    const current = players[turnIndex % players.length];

    if (!current || current.playerId !== playerId) {
      return json(409, {
        error: "Not your turn",
        currentPlayerNumber: current?.playerNumber ?? null
      });
    }

    const isFaker = playerId === fakerPlayerId;

    // Rule: non-faker cannot say the secret word
    if (!isFaker && word === secretWord) {
      return json(400, { error: "You cannot use the secret word" });
    }

    const now = new Date().toISOString();

    game.moves = Array.isArray(game.moves) ? game.moves : [];
    const prev = game.moves.find(m => normalizeWord(m.word) === word);
    if (prev) {
      const samePlayer = String(prev.playerId) === playerId;
      return json(409, {
        error: samePlayer
          ? "You already used that word"
          : "Another player already used that word"
      });
    }

    // Prevent accidental double-submit on same turn (same player twice in a row)
    const lastMove = game.moves.length ? game.moves[game.moves.length - 1] : null;
    if (lastMove && lastMove.playerId === playerId) {
      return json(409, { error: "You already submitted a move for your current turn" });
    }

    // Record move
    game.moves.push({
      moveId,
      round: game.round,
      playerId,
      playerNumber: me.playerNumber,
      word,
      at: now
    });

    // If faker says secret word ON THEIR TURN -> immediate win
    if (isFaker && word === secretWord) {
      game.endedAt = now;
      game.winner = "faker";
      game.endReason = "faker_said_secret_word_on_turn";
      ensureScores(room.players);
      const fakerPlayer = room.players.find(p => p.playerId === fakerPlayerId);
      if (fakerPlayer) fakerPlayer.score += 1;
      finalizeGameEnd(room, now);

      await store.setJSON(roomCode, room);

      // Verify the move made it in
      let verified = false;
      for (let v = 0; v < VERIFY_MAX_ATTEMPTS; v++) {
        const verify = await store.get(roomCode, { type: "json" });
        const vMoves = Array.isArray(verify?.game?.moves) ? verify.game.moves : [];
        if (vMoves.some(m => m.moveId === moveId)) {
          verified = true;
          break;
        }
        await sleep(VERIFY_SLEEP_MIN_MS + Math.floor(Math.random() * VERIFY_SLEEP_JITTER_MS));
      }

      if (verified) {
        return json(200, {
          ok: true,
          moveAccepted: true,
          ended: true,
          winner: "faker",
          endReason: game.endReason
        });
      }

      await sleep(delay + Math.floor(Math.random() * VERIFY_SLEEP_JITTER_MS));
      delay = Math.min(RETRY_MAX_DELAY_MS, Math.floor(delay * RETRY_BACKOFF));
      continue;
    }

    // Advance turn
    const nextTurnIndex = (turnIndex + 1) % players.length;
    const starterNumber = Number.isInteger(game.starterPlayerNumber)
      ? game.starterPlayerNumber
      : players[0]?.playerNumber ?? null;
    const nextTurnPlayerNumber = players[nextTurnIndex]?.playerNumber ?? null;
    const wrapped = starterNumber != null && nextTurnPlayerNumber === starterNumber;

    if (wrapped) {
      const nextRound = Number.isInteger(game.round) ? game.round + 1 : 2;
      const roundsTotal = Number.isInteger(game.roundsTotal) ? game.roundsTotal : 3;

      if (nextRound > roundsTotal) {
        // Normal voting starts automatically once all rounds are done.
        if (!game.votePhase?.active && !game.votePhase?.startedAt) {
          game.votePhase = initVotePhase();
          game.votePhase.active = true;
          game.votePhase.startedAt = now;
          game.votePhase.endsAt = new Date(
            Date.parse(now) + VOTE_TOTAL_SECONDS * 1000
          ).toISOString();
        }
        game.round = roundsTotal;
      } else {
        game.round = nextRound;
      }
    }

    game.turnIndex = nextTurnIndex;

    room.updatedAt = now;
    await store.setJSON(roomCode, room);

    // Verify the move exists in stored state (stale reads happen)
    let verified = false;
    let ended = false;
    let endReason = null;
    let nextPlayerNumber = players[nextTurnIndex]?.playerNumber ?? null;
    let round = game.round;

    for (let v = 0; v < VERIFY_MAX_ATTEMPTS; v++) {
      const verify = await store.get(roomCode, { type: "json" });
      const vGame = verify?.game;
      const vMoves = Array.isArray(vGame?.moves) ? vGame.moves : [];
      if (vMoves.some(m => m.moveId === moveId)) {
        verified = true;
        ended = !!vGame?.endedAt;
        endReason = vGame?.endReason || null;
        round = vGame?.round ?? round;

        // recompute next player number from stored turnIndex if present
        const vTurn = Number.isInteger(vGame?.turnIndex) ? vGame.turnIndex : nextTurnIndex;
        const vPlayers = Array.isArray(verify?.players) ? verify.players.slice().sort((a, b) => (a.playerNumber || 0) - (b.playerNumber || 0)) : players;
        nextPlayerNumber = vPlayers[vTurn % vPlayers.length]?.playerNumber ?? nextPlayerNumber;

        break;
      }
      await sleep(VERIFY_SLEEP_MIN_MS + Math.floor(Math.random() * VERIFY_SLEEP_JITTER_MS));
    }

    if (verified) {
      return json(200, {
        ok: true,
        moveAccepted: true,
        ended,
        endReason,
        round,
        nextPlayerNumber
      });
    }

    await sleep(delay + Math.floor(Math.random() * VERIFY_SLEEP_JITTER_MS));
    delay = Math.min(RETRY_MAX_DELAY_MS, Math.floor(delay * RETRY_BACKOFF));
  }

  return json(503, { error: "Move not visible yet, please retry" });
}
