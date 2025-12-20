import { getStore } from "@netlify/blobs";

function json(statusCode, bodyObj) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Basic CORS for local testing and mobile browsers
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "content-type"
    },
    body: JSON.stringify(bodyObj)
  };
}

function makeRoomCode(length = 6) {
  // Crockford-ish base32 alphabet (no I/L/O/U) to avoid confusion
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let out = "";
  // crypto is available in Node runtimes used by Netlify Functions
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
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
  const rounds = payload.rounds == null ? null : Number(payload.rounds);

  if (!Number.isInteger(playerCount) || playerCount < 3 || playerCount > 20) {
    return json(400, { error: "playerCount must be an integer between 3 and 20" });
  }
  if (rounds != null && (!Number.isInteger(rounds) || rounds < 1 || rounds > 20)) {
    return json(400, { error: "rounds must be an integer between 1 and 20 (or omit it)" });
  }

  const store = getStore("faker-rooms"); // one store for all rooms :contentReference[oaicite:2]{index=2}

  // Try a few times to avoid rare collisions
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
      rounds,               // optional; can be null
      locked: false,

      // Filled later:
      players: [],          // [{ playerId, joinedAt, words: [] }]
      wordPool: [],         // flattened words (optional convenience)
      secretWord: null,
      impostorPlayerId: null
    };

    await store.setJSON(roomCode, roomState);

    return json(200, { roomCode });
  }

  return json(500, { error: "Failed to create unique room code. Try again." });
}
