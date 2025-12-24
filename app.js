function $(id) {
  return document.getElementById(id);
}

function nowStamp() {
  const d = new Date();
  return d.toLocaleTimeString();
}

function log(obj, label = "log") {
  const out = $("output");
  const block =
    `[${nowStamp()}] ${label}\n` + JSON.stringify(obj, null, 2) + "\n\n";

  // latest at top
  out.textContent = block + out.textContent;
}

async function postJSON(path, bodyObj) {
  let res;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(bodyObj || {})
    });
  } catch (err) {
    return { status: 0, data: { error: String(err) } };
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = { error: "Non-JSON response" };
  }

  return { status: res.status, data };
}

function getRoomCode() {
  return String($("roomCode")?.value || "")
    .trim()
    .toUpperCase();
}

function setRoomCode(code) {
  $("roomCode").value = String(code || "").trim().toUpperCase();
}

function roomKey(roomCode) {
  return `faker:${String(roomCode || "").toUpperCase()}`;
}

function getSaved(roomCode) {
  if (!roomCode) return null;
  const raw = localStorage.getItem(roomKey(roomCode));
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}

function setSaved(roomCode, obj) {
  if (!roomCode) return;
  localStorage.setItem(roomKey(roomCode), JSON.stringify(obj || {}));
  renderLocal(roomCode);
}

function clearSaved(roomCode) {
  if (!roomCode) return;
  localStorage.removeItem(roomKey(roomCode));
  renderLocal(roomCode);
}

function renderLocal(roomCode) {
  const el = $("localPlayer");
  if (!el) return;

  const saved = getSaved(roomCode);
  if (!saved) {
    el.textContent = "(none)";
    return;
  }
  el.textContent = JSON.stringify(saved);
}

async function roomStatus(label = "roomStatus") {
  const roomCode = getRoomCode();
  if (!roomCode) return log({ error: "Enter room code first" }, label);

  const { status, data } = await postJSON("/.netlify/functions/roomStatus", { roomCode });
  log({ status, ...data }, label);

  if (status === 200) renderRoomStatus(data);
}

let lastRoomStatus = null;

function applyRoomStatus(status) {
  lastRoomStatus = status || null;

  const btnStart = $("btnStartGame");
  if (!btnStart) return;

  const roomCode = getRoomCode();
  const saved = roomCode ? getSaved(roomCode) : null;

  const isHost = !!saved && saved.playerNumber === 1;

  const maxPlayers = status?.maxPlayers ?? status?.playerCount ?? null;
  const currentPlayers = status?.currentPlayers ?? (Array.isArray(status?.players) ? status.players.length : null);

  const allJoined = !!status?.allJoined;
  const allReady = !!status?.allReady;

  // Start game only if:
  // - room is join-complete
  // - everyone has submitted enough words
  // - and you're host (for now)
  const canStart = allJoined && allReady && isHost;

  btnStart.disabled = !canStart;
  btnStart.title = canStart
    ? "Start game"
    : !isHost
      ? "Only player #1 can start (for now)"
      : !allJoined
        ? `Waiting for players (${currentPlayers ?? "?"}/${maxPlayers ?? "?"})`
        : "Waiting for words from players";
}

function makeClientId(length = 16) {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function ensureLocalIdentity(roomCode) {
  let saved = getSaved(roomCode);
  if (!saved) saved = {};

  // stable per browser/profile/room
  if (!saved.clientId) saved.clientId = makeClientId(16);

  setSaved(roomCode, saved);
  return saved;
}

let joinInFlight = null;

async function joinRoom() {
  const roomCode = getRoomCode();
  if (!roomCode) return log({ error: "Enter room code first" }, "joinRoom");

  if (joinInFlight) {
    log({ note: "Join already in progress; ignoring extra click" }, "joinRoom");
    return;
  }

  joinInFlight = (async () => {
    const saved = ensureLocalIdentity(roomCode);

    // If already joined on this browser profile, reuse
    if (saved.playerId && saved.playerNumber) {
      log({ roomCode, ...saved }, "joinRoom (reused local identity)");
      await roomStatus("roomStatus (already joined)");
      joinInFlight = null;
      return;
    }

    const { status, data } = await postJSON("/.netlify/functions/joinRoom", {
      roomCode,
      playerId: saved.playerId || saved.clientId
    });

    log({ status, ...data }, "joinRoom");

    if (status === 200 && data.playerId && data.playerNumber) {
      setSaved(roomCode, {
        ...saved,
        playerId: data.playerId,
        playerNumber: data.playerNumber
      });

      await roomStatus("roomStatus (after join)");
    }

    joinInFlight = null;
  })();
}

async function createRoom() {
  const playerCount = Number($("playerCount").value);
  const rounds = Number($("rounds").value);
  const wordsPerPlayer = Number($("wordsPerPlayer")?.value);

  const payload = { playerCount, rounds };
  if (Number.isInteger(wordsPerPlayer) && wordsPerPlayer >= 1 && wordsPerPlayer <= 10) {
    payload.wordsPerPlayer = wordsPerPlayer;
  }

  const { status, data } = await postJSON("/.netlify/functions/createRoom", payload);
  log({ status, ...data }, "createRoom");

  if (!data.roomCode) return;

  setRoomCode(data.roomCode);
  renderLocal(data.roomCode);

  // Wait until the room becomes readable (eventual consistency).
  let becameVisible = false;

  const tries = data.pending ? 30 : 5;
  for (let i = 0; i < tries; i++) {
    await new Promise(r => setTimeout(r, data.pending ? 200 : 120));
    const res = await postJSON("/.netlify/functions/roomStatus", { roomCode: data.roomCode });

    if (res.status === 200) {
      becameVisible = true;

      // Auto-join the creator once the room key exists
      if (!getSaved(data.roomCode)?.playerId) {
        await joinRoom();
      } else {
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

function wordsFromTextarea() {
  const raw = String($("words")?.value || "");
  // allow multi-line
  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return lines;
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

  // Refresh status so everyone sees up-to-date readiness
  if (status === 200) await roomStatus("roomStatus (after submitWords)");
}

async function startGame() {
  const roomCode = getRoomCode();
  if (!roomCode) return log({ error: "Enter room code first" }, "startGame");

  const { status, data } = await postJSON("/.netlify/functions/startGame", { roomCode });
  log({ status, ...data }, "startGame");

  await new Promise(r => setTimeout(r, 200));
  await roomStatus("roomStatus (after startGame)");
}

async function getRole() {
  const roomCode = getRoomCode();
  if (!roomCode) return log({ error: "Enter room code first" }, "getRole");

  const saved = getSaved(roomCode);
  if (!saved?.playerId) return log({ error: "Not joined" }, "getRole");

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
  if (!saved?.playerId) return log({ error: "Not joined" }, "submitMove");

  const word = String($("moveWord").value || "").trim();

  const { status, data } = await postJSON("/.netlify/functions/submitMove", {
    roomCode,
    playerId: saved.playerId,
    word
  });

  log({ status, ...data }, "submitMove");

  await new Promise(r => setTimeout(r, 200));
  await roomStatus("roomStatus (after submitMove)");
}

function wireUI() {
  $("btnCreateRoom").addEventListener("click", createRoom);
  $("btnJoinRoom").addEventListener("click", joinRoom);
  $("btnClearLocal").addEventListener("click", () => clearSaved(getRoomCode()));
  $("btnSubmitWords").addEventListener("click", submitWords);
  $("btnStartGame").addEventListener("click", startGame);
  $("btnGetRole").addEventListener("click", getRole);
  $("btnSubmitMove").addEventListener("click", submitMove);

  // IMPORTANT: don’t pass the click event into roomStatus(label)
  $("btnRoomStatus").addEventListener("click", () => roomStatus());

  $("btnClearOutput").addEventListener("click", () => {
    $("output").textContent = "";
  });

  renderLocal(getRoomCode());
  applyRoomStatus(null);
}

wireUI();

/* === lobby rendering helpers === */

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderRoomStatus(rs) {
  const el = $("playersList");
  if (!el) return;

  const players = Array.isArray(rs.players) ? rs.players : [];
  const maxPlayers = Number.isInteger(rs.maxPlayers) ? rs.maxPlayers : null;
  const wordsRequired = Number.isInteger(rs.wordsRequired) ? rs.wordsRequired : null;

  let html = "";

  html += `<div class="small">Room: <span class="mono">${esc(rs.roomCode || "")}</span></div>`;
  html += `<div class="small">Players: ${players.length}${maxPlayers ? " / " + maxPlayers : ""}${wordsRequired ? " • Words each: " + wordsRequired : ""}</div>`;
  html += `<div class="small">Ready: ${players.filter(p => p.ready).length} / ${players.length}</div>`;

  html += `<table class="ptable" style="margin-top:8px;">
    <thead>
      <tr>
        <th>#</th>
        <th>Name</th>
        <th>Words</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${players
        .map(
          p => `
        <tr>
          <td class="mono">${p.playerNumber}</td>
          <td>${esc(p.name || "")}</td>
          <td class="mono">${p.wordsSubmitted}/${p.wordsRequired}</td>
          <td>${p.ready ? "Ready" : "Not ready"}</td>
        </tr>
      `
        )
        .join("")}
    </tbody>
  </table>`;

  el.innerHTML = html;

  // also update start button enablement
  applyRoomStatus(rs);
}
