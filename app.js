function $(id) {
  return document.getElementById(id);
}

function now() {
  return new Date().toLocaleTimeString();
}

function log(obj, label = "") {
  const out = $("output");
  const header = `[${now()}] ${label}`.trim();
  out.textContent += (header ? header + "\n" : "") + JSON.stringify(obj, null, 2) + "\n\n";
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

  if (data.roomCode) {
    $("roomCode").value = data.roomCode;
    renderLocal(data.roomCode);
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

wireUI();
