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

function makeRoomCode(length = 6) {
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
  const roundsRaw = payload.rounds;
  const rounds =
    roundsRaw == null || roundsRaw === ""
      ? 3
      : Number(roundsRaw);

  // NEW:
  const wordsPerPlayerRaw = payload.wordsPerPlayer;
  const wordsPerPlayer =
    wordsPerPlayerRaw == null || wordsPerPlayerRaw === ""
      ? 4 // default if omitted
      : Number(wordsPerPlayerRaw);

  if (!Number.isInteger(playerCount) || playerCount < 3 || playerCount > 20) {
    return json(400, { error: "playerCount must be an integer between 3 and 20" });
  }
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20) {
    return json(400, { error: "rounds must be an integer between 1 and 20" });
  }

  // NEW validation:
  if (!Number.isInteger(wordsPerPlayer) || wordsPerPlayer < 1 || wordsPerPlayer > 20) {
    return json(400, { error: "wordsPerPlayer must be an integer between 1 and 20" });
  }

  connectLambda(event);
  const store = getStore("faker-rooms");

  for (let attempt = 0; attempt < 5; attempt++) {
    const roomCode = makeRoomCode(6);
    const existing = await store.get(roomCode);
    if (existing) continue;

    const now = new Date().toISOString();
    const roomState = {
      roomCode,
      createdAt: now,
      updatedAt: now,

      playerCount,
      rounds,
      wordsPerPlayer, // NEW
      locked: false,

      players: [],
      wordPool: [],

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

    return json(200, { roomCode, pending: !visible, wordsPerPlayer });
  }

  return json(500, { error: "Failed to create unique room code. Try again." });
}
