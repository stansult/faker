function $(id) {
  return document.getElementById(id);
}

/* ===== logging + fetch ===== */

function nowStamp() {
  return new Date().toLocaleTimeString();
}

function renderLogEntry(entry, out) {
  const details = document.createElement("details");
  details.open = false;

  const summary = document.createElement("summary");
  summary.textContent = `[${entry.time}] ${entry.label}`;

  const pre = document.createElement("pre");
  pre.className = "mono";
  pre.textContent = JSON.stringify(entry.data, null, 2);
  pre.addEventListener("click", async () => {
    try {
      const header = summary.textContent || "";
      const body = pre.textContent || "";
      await navigator.clipboard.writeText(`${header}\n${body}`);
    } catch {
      // Ignore clipboard failures (e.g., permissions)
    }
  });

  details.appendChild(summary);
  details.appendChild(pre);

  if (out.firstChild) {
    out.insertBefore(details, out.firstChild);
  } else {
    out.appendChild(details);
  }
}

function renderLogBuffer() {
  const out = $("output");
  if (!out) return;
  out.textContent = "";
  for (let i = logBuffer.length - 1; i >= 0; i--) {
    renderLogEntry(logBuffer[i], out);
  }
}

function log(obj, label = "log") {
  const entry = { time: nowStamp(), label, data: obj };
  logBuffer.push(entry);

  const out = $("output");
  if (!out) return;
  renderLogEntry(entry, out);
}

async function postJSON(path, bodyObj) {
  let res;
  const controller = new AbortController();
  const timeoutMs = 8000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(bodyObj || {}),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const isAbort = err && (err.name === "AbortError" || err.code === 20);
    if (isAbort) {
      return { status: 0, data: { error: `Request timed out (${timeoutMs}ms)` } };
    }
    return { status: 0, data: { error: String(err) } };
  }
  clearTimeout(timeoutId);

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = { error: "Non-JSON response" };
  }

  return { status: res.status, data };
}

function normalizeWord(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeName(raw) {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, " ");
}

/* ===== view helpers ===== */

const views = ["viewLanding", "viewLobby", "viewGame"];

function setView(activeId) {
  for (const id of views) {
    const el = $(id);
    if (!el) continue;
    if (id === activeId) el.classList.add("active");
    else el.classList.remove("active");
  }
}

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text || "";
}

/* ===== room code ===== */

function getRoomCode() {
  return sanitizeRoomCode($("roomCode")?.value || "");
}

function setRoomCode(code) {
  const value = sanitizeRoomCode(code || "");
  const el = $("roomCode");
  if (el) el.value = value;
  setText("roomCodeDisplay", value);
  setText("roomCodeGame", value);
}

function sanitizeRoomCode(raw) {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  return String(raw || "")
    .toUpperCase()
    .split("")
    .filter(ch => alphabet.includes(ch))
    .join("")
    .trim();
}

/* ===== localStorage identity ===== */

function roomKey(roomCode) {
  return `faker:${String(roomCode || "").toUpperCase()}`;
}

function lastRoomKey() {
  return "faker:lastRoom";
}

function getLastRoomCode() {
  return String(localStorage.getItem(lastRoomKey()) || "").trim().toUpperCase() || null;
}

function setLastRoomCode(roomCode) {
  if (!roomCode) return;
  localStorage.setItem(lastRoomKey(), String(roomCode).trim().toUpperCase());
}

function clearLastRoomCode() {
  localStorage.removeItem(lastRoomKey());
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
  const saved = getSaved(roomCode);

  const localEl = $("localPlayer");
  if (localEl) localEl.textContent = saved ? JSON.stringify(saved) : "(none)";

  const roomInput = $("roomCode");
  if (roomInput) {
    const locked = !!(saved && saved.playerId && saved.playerNumber);
    roomInput.readOnly = locked;
  }

  const nameInput = $("playerName");
  if (nameInput) {
    const locked = !!(saved && saved.playerId && saved.playerNumber);
    nameInput.disabled = locked;
    if (locked) {
      nameTouched = false;
      setNameError(false);
    }
  }

  updateNameError();
  updateRejoinButton();
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

/* ===== room status + lobby rendering ===== */

let lastRoomStatus = null;
let lastGameState = null;
let roleState = { role: null, secretWord: null, gameId: null };
let pollTimer = null;
let pollInFlight = false;
let nameTouched = false;
let joinInFlight = null;
let landingMode = null;
let logBuffer = [];

async function roomStatus(label = "roomStatus", opts = {}) {
  const roomCode = getRoomCode();
  if (!roomCode) {
    if (!opts.silent) log({ error: "Enter room code first" }, label);
    return null;
  }

  const { status, data } = await postJSON("/.netlify/functions/roomStatus", { roomCode });
  if (!opts.silent) log({ status, ...data }, label);

  if (status === 200) renderRoomStatus(data);
  return { status, data };
}

async function fetchGameState(opts = {}) {
  const roomCode = getRoomCode();
  if (!roomCode) return null;

  const saved = getSaved(roomCode);
  const payload = { roomCode };
  if (saved?.playerId) payload.playerId = saved.playerId;

  const { status, data } = await postJSON("/.netlify/functions/gameState", payload);
  if (!opts.silent) log({ status, ...data }, opts.label || "gameState");

  if (status === 200) {
    lastGameState = data;
    renderGameState(data);
  }
  return { status, data };
}

async function fetchRole(opts = {}) {
  const roomCode = getRoomCode();
  if (!roomCode) return null;

  const saved = getSaved(roomCode);
  if (!saved?.playerId) return null;

  const { status, data } = await postJSON("/.netlify/functions/getRole", {
    roomCode,
    playerId: saved.playerId
  });
  if (!opts.silent) log({ status, ...data }, "getRole");

  if (status === 200) {
    roleState = {
      role: data.role || null,
      secretWord: data.secretWord || null,
      gameId: lastRoomStatus?.game?.gameId || null
    };
    updateGameUI();
  }
  return { status, data };
}

function applyRoomStatus(status) {
  lastRoomStatus = status || null;

  const btnStart = $("btnStartGame");
  const btnStartShort = $("btnStartShortGame");
  if (!btnStart) return;

  const roomCode = getRoomCode();
  const saved = roomCode ? getSaved(roomCode) : null;

  const allJoined = !!status?.allJoined;
  const allReady = !!status?.allReady;
  const allJoinedReady = !!status?.allJoinedReady;

  const gameStarted = !!status?.game?.gameId;
  const locked = !!status?.locked;

  const isHost = !!saved && saved.playerNumber === 1;
  const canStart = !gameStarted && !locked && allJoined && allReady;
  const canStartShort =
    !gameStarted && !locked && !allJoined && allJoinedReady && isHost;

  btnStart.disabled = !canStart;

  if (btnStartShort) {
    btnStartShort.disabled = !canStartShort;
    btnStartShort.classList.toggle("hidden", !isHost || allJoined);
  }

  const statusEl = $("lobbyStatus");
  if (!statusEl) return;

  if (gameStarted) {
    statusEl.textContent = "Game already started.";
    return;
  }
  if (locked) {
    statusEl.textContent = "Room is locked.";
    return;
  }
  if (!allJoined) {
    const maxPlayers = status?.maxPlayers ?? status?.playerCount ?? "?";
    const currentPlayers =
      status?.currentPlayers ??
      (Array.isArray(status?.players) ? status.players.length : "?");
    if (allJoinedReady) {
      statusEl.textContent = `All joined players are ready. Waiting for more (${currentPlayers}/${maxPlayers}).`;
    } else {
      statusEl.textContent = `Waiting for players (${currentPlayers}/${maxPlayers}).`;
    }
    return;
  }
  if (!allReady) {
    statusEl.textContent = "Waiting for words from players.";
    return;
  }

  statusEl.textContent = "Everyone is ready. Start the game.";
}

function renderRoomStatus(rs) {
  lastRoomStatus = rs;

  setRoomCode(rs.roomCode || "");

  const players = Array.isArray(rs.players) ? rs.players : [];
  const maxPlayers = Number.isInteger(rs.maxPlayers) ? rs.maxPlayers : null;
  const wordsRequired = Number.isInteger(rs.wordsRequired) ? rs.wordsRequired : null;
  const rounds = Number.isInteger(rs.rounds) ? rs.rounds : null;

  const metaParts = [];
  metaParts.push(`Players: ${players.length}${maxPlayers ? " / " + maxPlayers : ""}`);
  if (wordsRequired) metaParts.push(`Words each: ${wordsRequired}`);
  if (rounds) metaParts.push(`Rounds: ${rounds}`);
  setText("roomMeta", metaParts.join(" • "));

  const el = $("playersList");
  if (el) {
    const rows = players
      .slice()
      .sort((a, b) => (a.playerNumber ?? 0) - (b.playerNumber ?? 0))
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
      .join("");

    el.innerHTML = `
      <table class="status-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th>Words</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  updateWordsProgress(rs);
  applyRoomStatus(rs);
  updateViewState(rs);

  if (rs.game?.gameId) {
    if (roleState.gameId !== rs.game.gameId) {
      roleState = { role: null, secretWord: null, gameId: rs.game.gameId };
      updateGameUI();
      fetchRole({ silent: true });
    }
    fetchGameState({ silent: true });
  }
}

function updateWordsProgress(rs) {
  const saved = getSaved(rs.roomCode || getRoomCode());
  const me = saved?.playerId
    ? (rs.players || []).find(p => p.playerId === saved.playerId)
    : null;

  const required = Number.isInteger(rs.wordsRequired) ? rs.wordsRequired : null;
  const submitted = Number.isInteger(me?.wordsSubmitted) ? me.wordsSubmitted : 0;
  const remaining = required != null ? Math.max(0, required - submitted) : null;

  const progress = $("wordsProgress");
  if (!progress) return;

  if (required == null) {
    progress.textContent = "";
    return;
  }

  if (remaining === 0) {
    progress.textContent = `All ${required} words submitted.`;
  } else {
    progress.textContent = `Submitted ${submitted}/${required} words. ${remaining} to go.`;
  }

  const input = $("wordInput");
  const btn = $("btnSubmitWords");
  if (input) input.disabled = remaining === 0;
  if (btn) btn.disabled = remaining === 0;
}

function updateViewState(rs) {
  const roomCode = rs?.roomCode || getRoomCode();
  const saved = roomCode ? getSaved(roomCode) : null;

  if (!saved?.playerId) {
    setView("viewLanding");
    return;
  }

  if (rs?.game?.gameId) {
    setView("viewGame");
  } else {
    setView("viewLobby");
  }

  updateLandingMode(null);
}

function renderGameState(gs) {
  lastGameState = gs;

  const movesRaw = Array.isArray(gs?.game?.lastMoves) ? gs.game.lastMoves : [];
  const moves = movesRaw.slice().reverse();
  const list = $("movesList");
  if (list) {
    if (!moves.length) {
      list.textContent = "No moves yet.";
    } else {
      const nameByNumber = new Map();
      const players = Array.isArray(lastRoomStatus?.players) ? lastRoomStatus.players : [];
      for (const p of players) {
        if (p.playerNumber != null) nameByNumber.set(p.playerNumber, p.name || "");
      }
      list.innerHTML = `
        <table class="status-table">
          <thead>
            <tr>
              <th>Round</th>
              <th>#</th>
              <th>Name</th>
              <th>Word</th>
            </tr>
          </thead>
          <tbody>
            ${moves
              .map(
                m => `
              <tr>
                <td>${m.round}</td>
                <td class="mono">${m.playerNumber}</td>
                <td>${esc(nameByNumber.get(m.playerNumber) || "")}</td>
                <td>${esc(m.word || "")}</td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
      `;
    }
  }

  updateGameUI();
}

function updateGameUI() {
  const roleEl = $("roleLabel");
  const playerLabel = $("playerLabel");
  const secretEl = $("secretWord");
  const turnEl = $("turnStatus");
  const moveHint = $("moveHint");
  const input = $("moveWord");
  const btn = $("btnSubmitMove");

  const saved = getSaved(getRoomCode());
  const playerNumber = saved?.playerNumber ?? null;

  const role = roleState.role;
  const secret = roleState.secretWord;

  if (playerLabel) {
    const name = saved?.name || "Unknown";
    const num = playerNumber != null ? `#${playerNumber}` : "?";
    playerLabel.textContent = `Player ${num}: ${name}`;
  }

  if (roleEl) {
    if (!role) roleEl.textContent = "Waiting for role...";
    else if (role === "faker") roleEl.textContent = "You are the faker";
    else roleEl.textContent = "You are legit";
  }

  if (secretEl) {
    if (!role) secretEl.textContent = "";
    else if (role === "faker") secretEl.textContent = "You do not know the word.";
    else secretEl.textContent = secret || "(waiting for secret word)";
  }

  const game = lastGameState?.game || lastRoomStatus?.game || null;
  const ended = !!game?.endedAt;
  const nextPlayerNumber = game?.nextPlayerNumber ?? null;

  let statusText = "";
  if (!game?.gameId) {
    statusText = "Game has not started.";
  } else if (ended) {
    const winner = game?.winner ? `Winner: ${game.winner}.` : "";
    statusText = `Game ended. ${winner}`.trim();
  } else if (!role) {
    statusText = "Fetching your role...";
  } else if (nextPlayerNumber == null || playerNumber == null) {
    statusText = "Waiting for turn order...";
  } else if (nextPlayerNumber === playerNumber) {
    statusText = "Your turn to play.";
  } else {
    statusText = `Waiting for player #${nextPlayerNumber}.`;
  }

  if (turnEl) turnEl.textContent = statusText;

  const canMove =
    !!role &&
    !ended &&
    nextPlayerNumber != null &&
    playerNumber != null &&
    nextPlayerNumber === playerNumber;

  if (input) input.disabled = !canMove;
  if (btn) btn.disabled = !canMove;
  if (moveHint) {
    moveHint.textContent = canMove
      ? ""
      : "Moves unlock once your role is known and it is your turn.";
  }
}

/* ===== actions ===== */

function setNameError(show, message = "Name is required to join.") {
  const el = $("nameError");
  if (!el) return;
  el.textContent = message;
  el.style.display = show ? "block" : "none";
}

function setActionError(show, message = "") {
  const el = $("actionError");
  if (!el) return;
  el.textContent = message;
  el.style.display = show ? "block" : "none";
}

function friendlyJoinError(data, status) {
  const raw = String(data?.error || "");
  if (raw === "Room is full") return "This room is full.";
  if (raw === "Room is locked") return "This room is locked and can’t accept new players.";
  if (raw === "Room not found" || status === 404) return "Room not found.";
  if (raw) return raw;
  return `Join failed (${status})`;
}

function updateNameError() {
  const input = $("playerName");
  if (!input) return;
  const value = String(input.value || "").trim();
  if (nameTouched) setNameError(!value, "Name is required to join.");
  else setNameError(false);

  const canUse = !!value;
  const btnCreate = $("btnCreateRoom");
  const btnJoin = $("btnJoinRoom");
  if (btnCreate) btnCreate.disabled = !canUse;
  if (btnJoin) btnJoin.disabled = !canUse;
}

function updateRejoinButton() {
  const btn = $("btnRejoinRoom");
  if (!btn) return;
  const lastRoom = getLastRoomCode();
  const saved = lastRoom ? getSaved(lastRoom) : null;
  const canRejoin = !!(saved && saved.playerId && saved.playerNumber);
  btn.classList.toggle("hidden", !canRejoin);
}

function updateLandingMode(nextMode = null) {
  if (nextMode !== null) landingMode = nextMode;
  if (nextMode === null) landingMode = null;

  const isCreate = landingMode === "create";
  const isJoin = landingMode === "join";

  const btnCreate = $("btnCreateRoom");
  const btnJoin = $("btnJoinRoom");
  const btnBack = $("btnBackLanding");
  const btnRejoin = $("btnRejoinRoom");
  const createPanel = $("createSettings");
  const joinPanel = $("joinRoomCode");

  if (btnCreate) btnCreate.classList.toggle("hidden", isJoin);
  if (btnJoin) btnJoin.classList.toggle("hidden", isCreate);
  if (btnBack) btnBack.classList.toggle("hidden", !landingMode);
  if (btnRejoin) btnRejoin.classList.toggle("hidden", !!landingMode);

  if (createPanel) createPanel.classList.toggle("hidden", !isCreate);
  if (joinPanel) joinPanel.classList.toggle("hidden", !isJoin);
  updateRejoinButton();
  setActionError(false);
}

async function joinRoom(options = {}) {
  const roomCode = getRoomCode();
  const name = normalizeName($("playerName")?.value || "");
  const skipLandingGate = !!options.skipLandingGate;
  const allowNameMismatch = !!options.allowNameMismatch;

  if (joinInFlight) {
    log({ note: "Join already in progress; ignoring extra click" }, "joinRoom");
    return;
  }

  if (!skipLandingGate && landingMode !== "join") {
    updateLandingMode("join");
    $("roomCode")?.focus();
    return;
  }

  if (!roomCode) {
    setActionError(true, "Enter a room code to join.");
    $("roomCode")?.focus();
    return;
  }

  if (!skipLandingGate && !name) {
    nameTouched = true;
    updateNameError();
    setActionError(true, "Enter your name to join.");
    $("playerName")?.focus();
    return;
  }

  const precheck = await postJSON("/.netlify/functions/roomStatus", { roomCode });
  if (precheck.status === 404) {
    setActionError(true, "Room not found.");
    log({ status: precheck.status, ...precheck.data }, "joinRoom");
    return;
  }
  setActionError(false);

  joinInFlight = (async () => {
    try {
      const saved = ensureLocalIdentity(roomCode);

      // If already joined on this browser profile, reuse (do not update name)
      if (saved.playerId && saved.playerNumber) {
        const savedName = normalizeName(saved.name || "");
        if (!allowNameMismatch && savedName && name && savedName !== name) {
          setNameError(true, "Name does not match saved player for this room.");
          $("playerName")?.focus();
          log({ error: "Name does not match saved player for this room" }, "joinRoom");
          return;
        }
        setLastRoomCode(roomCode);
        log({ roomCode, ...getSaved(roomCode) }, "joinRoom (reused local identity)");
        await roomStatus("roomStatus (already joined)");
        startPolling();
        return;
      }

      if (!name) {
        nameTouched = true;
        updateNameError();
        $("playerName")?.focus();
        log({ error: "Name is required" }, "joinRoom");
        return;
      }

      updateNameError();

      const payload = {
        roomCode,
        // stable id per room/browser (backend will treat it as requestedPlayerId)
        playerId: saved.playerId || saved.clientId
      };
      if (name) payload.name = name;

  const { status, data } = await postJSON("/.netlify/functions/joinRoom", payload);

  log({ status, ...data }, "joinRoom");

  if (status === 200 && data.playerId && data.playerNumber) {
    setActionError(false);
    setSaved(roomCode, {
      ...saved,
      playerId: data.playerId,
      playerNumber: data.playerNumber,
      name: data.name || name || saved.name || null
    });
    setLastRoomCode(roomCode);

    await roomStatus("roomStatus (after join)");
    startPolling();
  } else if (status !== 200) {
    setActionError(true, friendlyJoinError(data, status));
  }
    } catch (err) {
      log({ error: String(err), stack: err?.stack || null }, "joinRoom (exception)");
    } finally {
      joinInFlight = null;
    }
  })();
}

async function createRoom() {
  const name = String($("playerName")?.value || "").trim();
  if (!name) {
    nameTouched = true;
    updateNameError();
    $("playerName")?.focus();
    log({ error: "Name is required" }, "createRoom");
    return;
  }

  if (landingMode !== "create") {
    updateLandingMode("create");
    return;
  }

  const playerCount = Number($("playerCount")?.value);
  const rounds = Number($("rounds")?.value);
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
        await joinRoom({ skipLandingGate: true });
      } else {
        await roomStatus("roomStatus (after create)");
        startPolling();
      }
      break;
    }
  }

  if (!becameVisible) {
    log(
      {
        note:
          "Room code was created, but roomStatus did not become readable yet. Try Join room now, or refresh status shortly.",
        roomCode: data.roomCode
      },
      "createRoom (visibility)"
    );
  }
}

function getSingleWordSubmission() {
  const input = $("wordInput");
  if (!input) return [];
  const word = normalizeWord(input.value);
  return word ? [word] : [];
}

function getBulkWordSubmission() {
  const raw = String($("words")?.value || "");
  return raw.split(/\r?\n/).map(s => normalizeWord(s)).filter(Boolean);
}

async function submitWords() {
  const roomCode = getRoomCode();
  if (!roomCode) return log({ error: "Enter room code first" }, "submitWords");

  const saved = getSaved(roomCode);
  if (!saved?.playerId) return log({ error: "Not joined on this browser yet" }, "submitWords");

  const words = getSingleWordSubmission();
  if (!words.length) {
    return log({ error: "Enter a word" }, "submitWords");
  }

  const { status, data } = await postJSON("/.netlify/functions/submitWords", {
    roomCode,
    playerId: saved.playerId,
    words
  });
  log({ status, ...data }, "submitWords");

  if (status === 200) {
    const input = $("wordInput");
    if (input && data.accepted?.length) input.value = "";
    await roomStatus("roomStatus (after submitWords)");
  }
}

async function submitWordsBulk() {
  const roomCode = getRoomCode();
  if (!roomCode) return log({ error: "Enter room code first" }, "submitWordsBulk");

  const saved = getSaved(roomCode);
  if (!saved?.playerId) return log({ error: "Not joined on this browser yet" }, "submitWordsBulk");

  const words = getBulkWordSubmission();
  if (!words.length) {
    return log({ error: "Enter at least one word" }, "submitWordsBulk");
  }

  const { status, data } = await postJSON("/.netlify/functions/submitWords", {
    roomCode,
    playerId: saved.playerId,
    words
  });
  log({ status, ...data }, "submitWordsBulk");

  if (status === 200) {
    const input = $("words");
    if (input && data.accepted?.length) input.value = "";
    await roomStatus("roomStatus (after submitWordsBulk)");
  }
}

async function startGame() {
  const roomCode = getRoomCode();
  if (!roomCode) return log({ error: "Enter room code first" }, "startGame");

  const saved = getSaved(roomCode);
  if (!saved?.playerId) return log({ error: "Not joined" }, "startGame");

  const { status, data } = await postJSON("/.netlify/functions/startGame", {
    roomCode,
    playerId: saved.playerId
  });
  log({ status, ...data }, "startGame");

  await new Promise(r => setTimeout(r, 200));
  await roomStatus("roomStatus (after startGame)");
}

async function startShortGame() {
  const roomCode = getRoomCode();
  if (!roomCode) return log({ error: "Enter room code first" }, "startShortGame");

  const saved = getSaved(roomCode);
  if (!saved?.playerId) return log({ error: "Not joined" }, "startShortGame");

  const currentPlayers =
    lastRoomStatus?.currentPlayers ??
    (Array.isArray(lastRoomStatus?.players) ? lastRoomStatus.players.length : null);
  const maxPlayers = lastRoomStatus?.maxPlayers ?? null;

  let counts = "";
  if (currentPlayers != null || maxPlayers != null) {
    const left = currentPlayers != null ? String(currentPlayers) : "?";
    const right = maxPlayers != null ? String(maxPlayers) : "?";
    counts = ` (${left}/${right})`;
  }

  const ok = confirm(
    `Start with current players${counts}? Late players will be locked out.`
  );
  if (!ok) return;

  const { status, data } = await postJSON("/.netlify/functions/startGame", {
    roomCode,
    playerId: saved.playerId,
    startShort: true
  });
  log({ status, ...data }, "startShortGame");

  await new Promise(r => setTimeout(r, 200));
  await roomStatus("roomStatus (after startShortGame)");
}

async function submitMove() {
  const roomCode = getRoomCode();
  if (!roomCode) return log({ error: "Enter room code first" }, "submitMove");

  const saved = getSaved(roomCode);
  if (!saved?.playerId) return log({ error: "Not joined" }, "submitMove");

  const raw = String($("moveWord")?.value || "");
  const word = normalizeWord(raw);
  if (!word) return log({ error: "Enter a word" }, "submitMove");

  if (roleState.role === "player" && roleState.secretWord) {
    const secret = normalizeWord(roleState.secretWord);
    if (word === secret) {
      return log({ error: "You cannot use the secret word" }, "submitMove");
    }
  }

  const { status, data } = await postJSON("/.netlify/functions/submitMove", {
    roomCode,
    playerId: saved.playerId,
    word
  });

  log({ status, ...data }, "submitMove");

  await new Promise(r => setTimeout(r, 200));
  await roomStatus("roomStatus (after submitMove)");
}

function leaveRoom() {
  const roomCode = getRoomCode();
  if (!roomCode) return;

  const ok = confirm("Leave room? You won't be able to rejoin.");
  if (!ok) return;

  clearSaved(roomCode);
  clearLastRoomCode();
  setRoomCode("");
  roleState = { role: null, secretWord: null, gameId: null };
  lastRoomStatus = null;
  lastGameState = null;
  stopPolling();

  setView("viewLanding");
}

/* ===== polling ===== */

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(pollTick, 4000);
  pollTick();
}

function stopPolling() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

async function pollTick() {
  if (pollInFlight) return;
  const roomCode = getRoomCode();
  const saved = getSaved(roomCode);
  if (!roomCode || !saved?.playerId) return;

  pollInFlight = true;
  try {
    await roomStatus("roomStatus (poll)", { silent: true });
    if (lastRoomStatus?.game?.gameId) {
      await fetchGameState({ silent: true, label: "gameState (poll)" });
    }
  } finally {
    pollInFlight = false;
  }
}

/* ===== wire UI ===== */

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function wireUI() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("debug") === "1") {
    document.body.classList.add("debug");
  }

  $("btnCreateRoom")?.addEventListener("click", createRoom);
  $("btnJoinRoom")?.addEventListener("click", joinRoom);
  $("btnRejoinRoom")?.addEventListener("click", async () => {
    const lastRoom = getLastRoomCode();
    const saved = lastRoom ? getSaved(lastRoom) : null;
    if (!lastRoom || !saved) return;
    setRoomCode(lastRoom);
    const nameInput = $("playerName");
    if (nameInput && saved.name) nameInput.value = saved.name;
    await joinRoom({ skipLandingGate: true, allowNameMismatch: true });
  });
  $("btnBackLanding")?.addEventListener("click", () => updateLandingMode(null));
  $("btnLeaveRoom")?.addEventListener("click", leaveRoom);
  $("btnSubmitWords")?.addEventListener("click", submitWords);
  $("btnSubmitWordsBulk")?.addEventListener("click", submitWordsBulk);
  $("btnStartGame")?.addEventListener("click", startGame);
  $("btnStartShortGame")?.addEventListener("click", startShortGame);
  $("btnGetRole")?.addEventListener("click", () => fetchRole());
  $("btnSubmitMove")?.addEventListener("click", submitMove);
  $("btnRoomStatus")?.addEventListener("click", () => roomStatus());
  $("btnClearLocal")?.addEventListener("click", () => clearSaved(getRoomCode()));
  $("btnClearOutput")?.addEventListener("click", () => {
    const out = $("output");
    if (out) out.textContent = "";
    logBuffer = [];
  });

  const debugToggle = $("debugToggle");
  if (debugToggle) {
    let tapCount = 0;
    let tapTimer = null;

    const toggleDebug = () => {
      document.body.classList.toggle("debug");
      if (document.body.classList.contains("debug")) {
        renderLogBuffer();
      }
    };

    debugToggle.addEventListener("dblclick", e => {
      if (e && e.metaKey && e.altKey) {
        toggleDebug();
      }
    });

    debugToggle.addEventListener("click", e => {
      if (e) e.preventDefault();
      tapCount += 1;
      if (tapTimer) clearTimeout(tapTimer);
      tapTimer = setTimeout(() => {
        tapCount = 0;
      }, 600);
      if (tapCount >= 5) {
        tapCount = 0;
        toggleDebug();
      }
    });
  }

  $("playerName")?.addEventListener("input", () => {
    nameTouched = true;
    updateNameError();
  });

  $("roomCode")?.addEventListener("click", async e => {
    const input = e.currentTarget;
    if (!input) return;
    input.select();
    const value = String(input.value || "").trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Ignore clipboard failures (e.g., permissions)
    }
  });

  $("roomCode")?.addEventListener("input", e => {
    const input = e.currentTarget;
    if (!input) return;
    const cleaned = sanitizeRoomCode(input.value);
    if (input.value !== cleaned) input.value = cleaned;
  });

  $("btnCopyRoomCode")?.addEventListener("click", async () => {
    const value = String($("roomCodeDisplay")?.textContent || "").trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Ignore clipboard failures (e.g., permissions)
    }
  });

  $("btnCopyRoomCodeGame")?.addEventListener("click", async () => {
    const value = String($("roomCodeGame")?.textContent || "").trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Ignore clipboard failures (e.g., permissions)
    }
  });

  renderLocal(getRoomCode());
  setView("viewLanding");
  updateLandingMode(null);
  updateNameError();
  updateRejoinButton();
  if (document.body.classList.contains("debug")) {
    renderLogBuffer();
  }

  const build = $("buildVersion");
  if (build) {
    build.textContent = "build (local)";
    fetch("./build.txt", { cache: "no-store" })
      .then(res => (res.ok ? res.text() : null))
      .then(text => {
        if (!text) return;
        build.textContent = `build ${text.trim()}`;
      })
      .catch(() => {});
  }
}

wireUI();
