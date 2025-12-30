import { connectLambda, getStore } from "@netlify/blobs";

function json(statusCode, bodyObj) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "content-type"
    },
    body: JSON.stringify(bodyObj)
  };
}

const ROOM_CODE_LENGTH = 6;
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 20;
const MIN_GAMES = 1;
const MAX_GAMES = 20;
const MIN_ROUNDS_PER_GAME = 1;
const MAX_ROUNDS_PER_GAME = 20;
const MIN_WORDS_PER_PLAYER = 1;
const MAX_WORDS_PER_PLAYER = 20;

function computeWordsPerPlayer(totalGames, totalPlayers) {
  // We require MORE total words than total games to avoid predictable end-game
  // states (e.g., "last game, I'm faker, I know my last unused word") and to
  // keep contributions even across players.
  //
  // Formula A:
  //   minimumPoolSize = totalGames + totalPlayers
  //   wordsPerPlayer = ceil(minimumPoolSize / totalPlayers)
  //
  // This guarantees:
  // 1) The actual pool (totalPlayers * wordsPerPlayer) is >= minimumPoolSize.
  // 2) Everyone submits the same number of words.
  // 3) The pool is always larger than the number of games.
  const minimumPoolSize = totalGames + totalPlayers;
  return Math.ceil(minimumPoolSize / totalPlayers);
}

function makeRoomCode(length = ROOM_CODE_LENGTH) {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let out = "";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
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

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Use POST" });
  }

  let payload;
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const playerCount = Number(payload.playerCount);
  const gamesRaw = payload.gamesTotal;
  const gamesTotal =
    gamesRaw == null || gamesRaw === ""
      ? 3
      : Number(gamesRaw);

  const roundsRaw = payload.roundsPerGame;
  const roundsPerGame =
    roundsRaw == null || roundsRaw === ""
      ? 3
      : Number(roundsRaw);

  if (
    !Number.isInteger(playerCount) ||
    playerCount < MIN_PLAYERS ||
    playerCount > MAX_PLAYERS
  ) {
    return json(400, {
      error: `playerCount must be an integer between ${MIN_PLAYERS} and ${MAX_PLAYERS}`
    });
  }
  if (!Number.isInteger(gamesTotal) || gamesTotal < MIN_GAMES || gamesTotal > MAX_GAMES) {
    return json(400, {
      error: `gamesTotal must be an integer between ${MIN_GAMES} and ${MAX_GAMES}`
    });
  }
  if (
    !Number.isInteger(roundsPerGame) ||
    roundsPerGame < MIN_ROUNDS_PER_GAME ||
    roundsPerGame > MAX_ROUNDS_PER_GAME
  ) {
    return json(400, {
      error: `roundsPerGame must be an integer between ${MIN_ROUNDS_PER_GAME} and ${MAX_ROUNDS_PER_GAME}`
    });
  }

  const wordsPerPlayer = computeWordsPerPlayer(gamesTotal, playerCount);
  if (
    !Number.isInteger(wordsPerPlayer) ||
    wordsPerPlayer < MIN_WORDS_PER_PLAYER ||
    wordsPerPlayer > MAX_WORDS_PER_PLAYER
  ) {
    return json(400, { error: "Failed to compute wordsPerPlayer" });
  }

  connectLambda(event);
  const store = getStore("faker-rooms");

  for (let attempt = 0; attempt < 5; attempt++) {
    const roomCode = makeRoomCode(ROOM_CODE_LENGTH);
    const existing = await store.get(roomCode);
    if (existing) continue;

    const now = new Date().toISOString();
    const roomState = {
      roomCode,
      createdAt: now,
      updatedAt: now,

      playerCount,
      effectiveMaxPlayers: playerCount,
      gamesTotal,
      gamesPlayed: 0,
      roundsPerGame,
      wordsPerPlayer,
      locked: false,
      matchEnded: false,
      matchEndReason: null,

      players: [],
      wordPool: [],
      usedWords: [],

      game: null
    };

    await store.setJSON(roomCode, roomState);

    let visible = false;
    for (let i = 0; i < 20; i++) {
      const probe = await store.get(roomCode, { type: "json" });
      if (probe) {
        visible = true;
        break;
      }
      await sleep(150 + Math.floor(Math.random() * 150));
    }

    return json(200, {
      roomCode,
      pending: !visible,
      wordsPerPlayer,
      gamesTotal,
      roundsPerGame
    });
  }

  return json(500, { error: "Failed to create unique room code. Try again." });
}
