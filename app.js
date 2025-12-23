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

  out.scrollTop = out.scrollHeight;
}

function roomKey(roomCode) {
  return `faker:${roomCode}`;
}

function getRoomCode() {
  return String($("roomCode").value || "").trim().toUpperCase();
}

function getSaved(roomCode) {
  const raw = localStorage.getItem(roomKey(roomCode));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
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

function wordsFromTextarea() {
  const lines = String($("words").value || "")
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);
  return lines;
}

async function createRoom() {
  const playerCount = Number($("playerCount").value);
  const rounds = Number($("rounds").value);

  const { status, data } = await postJSON("/.netlify/functions/createRoom", { playerCount, rounds });
  log({ status, ...data }, "createRoom");

  if (!data.roomCode) return;

  $("roomCode").value = data.roomCode;
  renderLocal(data.roomCode);

  // Try to observe the room becoming readable
  let becameVisible = false;

  for (let i = 0; i < (data.pending ? 25 : 3); i++) {
    await new Promise(r => setTimeout(r, data.pending ? 200 : 120));
    const res = await postJSON("/.netlify/functions/roomStatus", { roomCode: data.roomCode });

    if (res.status === 200) {
      log({ status: res.status, ...res.data }, "roomStatus (auto)");

      // Auto-join the creator once the room is visible
      if (!getSaved(data.roomCode)) {
        await joinRoom();
      }

      becameVisible = true;
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

async function joinRoom() {
  const roomCode = getRoomCode();
  if (!roomCode) return log({ error: "Enter room code first" }, "joinRoom");

  // If already joined on this browser profile, reuse
  const existing = getSaved(roomCode);
  if (existing) {
    log(existing, "joinRoom (reused local identity)");
    return;
  }

  const { status, data } = await postJSON("/.netlify/functions/joinRoom", { roomCode });
  log({ status, ...data }, "joinRoom");

  if (data.playerId && data.playerNumber) {
    setSaved(roomCode, { playerId: data.playerId, playerNumber: data.playerNumber });

    // Debug/help: give storage a moment to settle, then show current room count
    await new Promise(r => setTimeout(r, 200));
    await roomStatus();
  }
}

async function submitWords() {
  const roomCode = getRoomCode();
  if (!roomCode) return log({ error: "Enter room code first" }, "submitWords");

  const saved = getSaved(roomCode);
  if (!saved) return log({ error: "Not joined on this browser yet" }, "submitWords");

  const words = wordsFromTextarea();
  const { status, data } = await postJSON("/.netlify/functions/submitWords", {
    roomCode,
    playerId: saved.playerId,
    words
  });
  log({ status, ...data }, "submitWords");
}

async function roomStatus() {
  const roomCode = getRoomCode();
  if (!roomCode) return log({ error: "Enter room code first" }, "roomStatus");

  const { status, data } = await postJSON("/.netlify/functions/roomStatus", { roomCode });
  log({ status, ...data }, "roomStatus");
}

async function startGame() {
  const roomCode = getRoomCode();
  if (!roomCode) return log({ error: "Enter room code first" }, "startGame");

  const { status, data } = await postJSON("/.netlify/functions/startGame", { roomCode });
  log({ status, ...data }, "startGame");
}

async function getRole() {
  const roomCode = getRoomCode();
  if (!roomCode) return log({ error: "Enter room code first" }, "getRole");

  const saved = getSaved(roomCode);
  if (!saved) return log({ error: "Not joined on this browser yet" }, "getRole");

  const { status, data } = await postJSON("/.netlify/functions/getRole", {
    roomCode,
    playerId: saved.playerId
  });
  log({ status, ...data }, "getRole");
}

function wireUI() {
  $("btnCreateRoom").addEventListener("click", createRoom);
  $("btnJoinRoom").addEventListener("click", joinRoom);
  $("btnSubmitWords").addEventListener("click", submitWords);
  $("btnRoomStatus").addEventListener("click", roomStatus);
  $("btnStartGame").addEventListener("click", startGame);
  $("btnGetRole").addEventListener("click", getRole);
  $("btnGameState").addEventListener("click", gameState);
  $("btnSubmitMove").addEventListener("click", submitMove);

  $("btnClearLocal").addEventListener("click", () => {
    const roomCode = getRoomCode();
    if (!roomCode) return log({ error: "Enter room code first" }, "clearLocal");
    clearSaved(roomCode);
    log({ ok: true }, "clearLocal");
  });

  $("btnClearOutput").addEventListener("click", () => {
    $("output").textContent = "";
  });

  $("roomCode").addEventListener("input", () => renderLocal(getRoomCode()));

  renderLocal(getRoomCode());
}

async function gameState() {
  const roomCode = getRoomCode();
  if (!roomCode) return log({ error: "Enter room code first" }, "gameState");

  const { status, data } = await postJSON("/.netlify/functions/roomStatus", { roomCode });

  // roomStatus already hides secretWord/faker; we just present "game" portion
  const view = {
    status,
    locked: data.locked,
    playerCount: data.playerCount,
    missingWordsCount: data.missingWordsCount,
    wordPoolSize: data.wordPoolSize,
    game: data.game || null
  };

  log(view, "gameState");
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

wireUI();
