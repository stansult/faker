function $(id) {
  return document.getElementById(id);
}

function now() {
  return new Date().toLocaleTimeString();
}

function log(obj, label = "") {
  const out = $("output");
  const header = `[${now()}] ${label}`.trim();
  out.textContent =
    (header ? header + "\n" : "") +
    JSON.stringify(obj, null, 2) +
    "\n\n" +
    out.textContent;
}

function getRoomCode() {
  return String($("roomCode").value || "").trim().toUpperCase();
}

function roomKey(roomCode) {
  return `faker:${roomCode}:player`;
}

function getSaved(roomCode) {
  try {
    const raw = localStorage.getItem(roomKey(roomCode));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setSaved(roomCode, savedObj) {
  localStorage.setItem(roomKey(roomCode), JSON.stringify(savedObj));
  renderLocal(roomCode);
}

function clearSaved(roomCode) {
  localStorage.removeItem(roomKey(roomCode));
  renderLocal(roomCode);
}

function renderLocal(roomCode) {
  const saved = roomCode ? getSaved(roomCode) : null;
  $("localPlayer").textContent = saved
    ? `playerNumber=${saved.playerNumber} playerId=${saved.playerId}`
    : "(none)";
}

async function postJSON(path, bodyObj) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(bodyObj)
  });

  let data;
  try {
    data = await res.json();
  } catch {
    data = { error: `Non-JSON response (status ${res.status})` };
  }

  return { status: res.status, data };
}

async function createRoom() {
  const playerCount = Number($("playerCount").value);
  const rounds = Number($("rounds").value);
  const wordsPerPlayer = Number($("wordsPerPlayer").value);

  const { status, data } = await postJSON("/.netlify/functions/createRoom", {
    playerCount,
    rounds,
    wordsPerPlayer
  });
  log({ status, ...data }, "createRoom");

  if (!data.roomCode) return;

  $("roomCode").value = data.roomCode;
  renderLocal(data.roomCode);

  // Wait until the room becomes readable (eventual consistency).
  // IMPORTANT: we don't treat "200 but stale snapshot" as authoritative; we only use this
  // to know the key exists, then we join and re-check.
  let becameVisible = false;

  const tries = data.pending ? 30 : 5;
  for (let i = 0; i < tries; i++) {
    await new Promise(r => setTimeout(r, data.pending ? 200 : 120));
    const res = await postJSON("/.netlify/functions/roomStatus", { roomCode: data.roomCode });

    if (res.status === 200) {
      becameVisible = true;

      // Auto-join the creator once the room key exists
      if (!getSaved(data.roomCode)) {
        await joinRoom();
      } else {
        // Already joined in this browser; still show a fresh status
        await roomStatus("roomStatus (after create)");
      }

      break;
    }
  }

  if (!becameVisible) {
    log(
      {
        note:
          "Room code was created, but roomStatus did not become readable yet. Try Join room now, or click Room status again in a moment.",
        roomCode: data.roomCode
      },
      "createRoom (visibility)"
    );
  }
}

async function roomStatus(label = "roomStatus") {
  const roomCode = getRoomCode();
  if (!roomCode) return log({ error: "Enter room code first" }, label);

  const { status, data } = await postJSON("/.netlify/functions/roomStatus", { roomCode });

  // Convenience: if server provides max/current, keep them visible in logs
  const merged = { status, ...data };
  log(merged, label);
}

function makeClientId(length = 16) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function getOrCreateLocalIdentity(roomCode) {
  let saved = getSaved(roomCode);
  if (saved && saved.playerId) return saved;

  // Create a stable playerId immediately, BEFORE calling the backend.
  saved = { playerId: makeClientId(16), playerNumber: null };
  setSaved(roomCode, saved);
  return saved;
}

let joinInFlight = null;

async function joinRoom() {
  const roomCode = getRoomCode();
  if (!roomCode) return log({ error: "Enter room code first" }, "joinRoom");

  // Prevent double-click / auto-join race in the same tab
  if (joinInFlight) return joinInFlight;

  joinInFlight = (async () => {
    const saved = getOrCreateLocalIdentity(roomCode);

    // If we already have a number, we consider ourselves joined (and just show status)
    if (saved.playerNumber) {
      log({ roomCode, ...saved }, "joinRoom (reused local identity)");
      await roomStatus("roomStatus (already joined)");
      return;
    }

    const { status, data } = await postJSON("/.netlify/functions/joinRoom", {
      roomCode,
      playerId: saved.playerId
    });

    log({ status, ...data }, "joinRoom");

    if (data.playerId && data.playerNumber) {
      setSaved(roomCode, { playerId: data.playerId, playerNumber: data.playerNumber });
      await new Promise(r => setTimeout(r, 250));
      await roomStatus("roomStatus (after join)");
    }
  })();

  try {
    await joinInFlight;
  } finally {
    joinInFlight = null;
  }
}

function wordsFromTextarea() {
  const raw = String($("words").value || "");
  // split by newlines or commas
  return raw
    .split(/[\n,]/g)
    .map(s => s.trim())
    .filter(Boolean);
}

async function submitWords() {
  const roomCode = getRoomCode();
  if (!roomCode) return log({ error: "Enter room code first" }, "submitWords");

  const saved = getSaved(roomCode);
  if (!saved?.playerId) return log({ error: "Join room first (no local playerId)" }, "submitWords");

  // Parse textarea lines into words
  const raw = $("words").value || "";
  const words = raw
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);

  const { status, data } = await postJSON("/.netlify/functions/submitWords", {
    roomCode,
    playerId: saved.playerId,
    words
  });

  log({ status, ...data }, "submitWords");

  // If submitWords failed, don't poll
  if (status !== 200) return;

  // Now poll roomStatus until it "catches up" (bounded retry; avoids stale read confusion)
  const targetPoolSize = typeof data.wordPoolSize === "number" ? data.wordPoolSize : null;

  const maxTries = 6;
  const baseDelayMs = 180;

  for (let i = 0; i < maxTries; i++) {
    await new Promise(r => setTimeout(r, baseDelayMs + i * 60));

    const res = await postJSON("/.netlify/functions/roomStatus", { roomCode });

    if (res.status === 200) {
      log({ status: res.status, ...res.data }, "roomStatus (after submitWords)");

      const poolOk =
        targetPoolSize == null ? true : (res.data?.wordPoolSize ?? -1) >= targetPoolSize;

      const readyOk = (res.data?.missingWordsCount ?? 999) === 0;

      if (poolOk || readyOk) break;
    }
  }
}

async function startGame() {
  const roomCode = getRoomCode();
  if (!roomCode) return log({ error: "Enter room code first" }, "startGame");

  const saved = getSaved(roomCode);
  if (!saved) return log({ error: "Not joined" }, "startGame");

  const { status, data } = await postJSON("/.netlify/functions/startGame", {
    roomCode,
    playerId: saved.playerId
  });
  log({ status, ...data }, "startGame");

  await new Promise(r => setTimeout(r, 200));
  await roomStatus("roomStatus (after startGame)");
}

async function getRole() {
  const roomCode = getRoomCode();
  if (!roomCode) return log({ error: "Enter room code first" }, "getRole");

  const saved = getSaved(roomCode);
  if (!saved) return log({ error: "Not joined" }, "getRole");

  const { status, data } = await postJSON("/.netlify/functions/getRole", {
    roomCode,
    playerId: saved.playerId
  });
  log({ status, ...data }, "getRole");
}

async function submitMove() {
  const roomCode = getRoomCode();
  if (!roomCode) return log({ error: "Enter room code first" }, "submitMove");

  const saved = getSaved(roomCode);
  if (!saved) return log({ error: "Not joined" }, "submitMove");

  const word = String($("moveWord").value || "").trim();
  if (!word) return log({ error: "Enter a word" }, "submitMove");

  const { status, data } = await postJSON("/.netlify/functions/submitMove", {
    roomCode,
    playerId: saved.playerId,
    word
  });
  log({ status, ...data }, "submitMove");
}

function wireUI() {
  $("btnCreateRoom").addEventListener("click", createRoom);
  $("btnJoinRoom").addEventListener("click", joinRoom);
  $("btnClearLocal").addEventListener("click", () => clearSaved(getRoomCode()));
  $("btnSubmitWords").addEventListener("click", submitWords);
  $("btnStartGame").addEventListener("click", startGame);
  $("btnGetRole").addEventListener("click", getRole);
  $("btnSubmitMove").addEventListener("click", submitMove);
  $("btnRoomStatus").addEventListener("click", roomStatus);

  $("btnClearOutput").addEventListener("click", () => {
    $("output").textContent = "";
  });

  // initial
  renderLocal(getRoomCode());
}

wireUI();
