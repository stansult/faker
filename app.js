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
  if (!logBuffer.length) {
    out.textContent = "No logs yet.";
    return;
  }
  for (let i = logBuffer.length - 1; i >= 0; i--) {
    renderLogEntry(logBuffer[i], out);
  }
}

function log(obj, label = "log") {
  const entry = { time: nowStamp(), label, data: obj };
  logBuffer.push(entry);
  persistLogs();

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

function isAllowedWord(word) {
  return /^[a-z'-]+$/.test(String(word || ""));
}

const copiedTimers = {};

function flashCopied(id, durationMs = 2500) {
  const el = $(id);
  if (!el) return;
  el.classList.add("show");
  if (copiedTimers[id]) clearTimeout(copiedTimers[id]);
  copiedTimers[id] = setTimeout(() => {
    el.classList.remove("show");
  }, durationMs);
}

const VOTE_TOTAL_SECONDS = 30;
const VOTE_FINAL_SECONDS = 5;

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

function wordsKey(roomCode) {
  return `${roomKey(roomCode)}:words`;
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
  localStorage.removeItem(wordsKey(roomCode));
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

function getAcceptedWords(roomCode) {
  if (!roomCode) return [];
  const raw = localStorage.getItem(wordsKey(roomCode));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setAcceptedWords(roomCode, words) {
  if (!roomCode) return;
  const list = Array.isArray(words) ? words : [];
  localStorage.setItem(wordsKey(roomCode), JSON.stringify(list));
  renderAcceptedWords(roomCode);
}

function setSubmitWordsError(message = "") {
  const el = $("submitWordsError");
  if (!el) return;
  el.textContent = message || "";
  el.style.display = message ? "block" : "none";
}

function renderAcceptedWords(roomCode) {
  const el = $("submittedWordsLine");
  if (!el) return;
  const words = getAcceptedWords(roomCode);
  if (!words.length) {
    el.textContent = "";
    return;
  }
  el.textContent = `Submitted words: ${words.join(", ")}`;
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
let voteTimerInterval = null;
let createInFlight = false;
let createState = { roomCode: null, retries: 0 };
let createAbort = false;
let overlayMode = "progress";
let overlayDismiss = null;

const CREATE_TIMEOUT_MS = 12000;

function persistLogs() {
  try {
    sessionStorage.setItem("faker:logs", JSON.stringify(logBuffer));
  } catch {
    // Ignore storage failures
  }
}

function restoreLogs() {
  try {
    const raw = sessionStorage.getItem("faker:logs");
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) logBuffer = parsed;
  } catch {
    // Ignore storage failures
  }
}

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
  const currentPlayers =
    status?.currentPlayers ??
    (Array.isArray(status?.players) ? status.players.length : 0);
  const canStartShort =
    !gameStarted &&
    !locked &&
    !allJoined &&
    allJoinedReady &&
    isHost &&
    currentPlayers >= 3;

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
  const totalSlots =
    maxPlayers ??
    (Number.isInteger(rs.playerCount) ? rs.playerCount : null) ??
    players.length;

  const saved = getSaved(rs.roomCode || getRoomCode());
  if (saved?.playerId) {
    const me = players.find(p => p.playerId === saved.playerId);
    if (me && me.playerNumber && me.playerNumber !== saved.playerNumber) {
      setSaved(rs.roomCode || getRoomCode(), {
        ...saved,
        playerNumber: me.playerNumber,
        name: me.name || saved.name
      });
    }
  }

  const metaParts = [];
  metaParts.push(`Players: ${players.length}${maxPlayers ? " / " + maxPlayers : ""}`);
  if (wordsRequired) metaParts.push(`Words each: ${wordsRequired}`);
  if (rounds) metaParts.push(`Rounds: ${rounds}`);
  setText("roomMeta", metaParts.join(" • "));

  const el = $("playersList");
  if (el) {
    const byNumber = new Map(
      players.map(p => [p.playerNumber, p])
    );
    const rows = Array.from({ length: totalSlots }, (_, i) => i + 1)
      .map(n => {
        const p = byNumber.get(n);
        if (!p) {
          return `
        <tr class="row-muted">
          <td class="mono">${n}</td>
          <td></td>
          <td class="mono">-</td>
          <td class="mono">-</td>
          <td class="mini">Not joined</td>
        </tr>
      `;
        }
        return `
        <tr>
          <td class="mono">${p.playerNumber}</td>
          <td>${esc(p.name || "")}</td>
          <td class="mono">${Number.isInteger(p.score) ? p.score : 0}</td>
          <td class="mono">${
            Number.isInteger(p.wordsRequired) &&
            Number.isInteger(p.wordsSubmitted) &&
            p.wordsSubmitted >= p.wordsRequired
              ? `<span class="ok-check">&#9989;</span>`
              : `${p.wordsSubmitted}/${p.wordsRequired}`
          }</td>
          <td>${p.ready ? "Ready" : "Not ready"}</td>
        </tr>
      `;
      })
      .join("");

    el.innerHTML = `
      <table class="status-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th>Score</th>
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

  const panel = $("submitWordsPanel");
  if (panel) panel.classList.toggle("hidden", remaining === 0);
  renderAcceptedWords(rs.roomCode || getRoomCode());
  if (remaining === 0) setSubmitWordsError("");
}

function updateViewState(rs) {
  const roomCode = rs?.roomCode || getRoomCode();
  const saved = roomCode ? getSaved(roomCode) : null;

  if (!saved?.playerId) {
    setView("viewLanding");
    return;
  }

  const ended = !!(lastGameState?.game?.endedAt || rs?.game?.endedAt);

  if (rs?.game?.gameId && !ended) {
    setView("viewGame");
  } else {
    setView("viewLobby");
  }

  updateLandingMode(null);
}

function renderGameState(gs) {
  lastGameState = gs;

  renderRoundsTable();
  renderVoteTable();

  updateGameUI();
}

function renderRoundsTable() {
  const container = $("roundsTable");
  if (!container) return;

  const players = Array.isArray(lastRoomStatus?.players) ? lastRoomStatus.players : [];
  const sortedPlayers = players.slice().sort((a, b) => (a.playerNumber ?? 0) - (b.playerNumber ?? 0));

  const moves = Array.isArray(lastGameState?.game?.moves) ? lastGameState.game.moves : [];
  const roundsTotal =
    Number.isInteger(lastGameState?.game?.roundsTotal)
      ? lastGameState.game.roundsTotal
      : (Number.isInteger(lastRoomStatus?.rounds) ? lastRoomStatus.rounds : 0);

  if (!sortedPlayers.length) {
    container.textContent = "No players yet.";
    return;
  }

  if (!roundsTotal) {
    container.textContent = "Rounds will appear once the game starts.";
    return;
  }

  const cellMap = new Map();
  for (const m of moves) {
    if (!m || m.round == null || m.playerNumber == null) continue;
    cellMap.set(`${m.round}:${m.playerNumber}`, m.word || "");
  }

  const headerCells = sortedPlayers
    .map(p => `<th class="mono">${p.playerNumber}<span class="mini"> ${esc(p.name || "")}</span></th>`)
    .join("");

  const rows = [];
  for (let r = 1; r <= roundsTotal; r++) {
    const cells = sortedPlayers
      .map(p => {
        const key = `${r}:${p.playerNumber}`;
        const word = cellMap.get(key) || "";
        return `<td>${esc(word)}</td>`;
      })
      .join("");
    rows.push(`<tr><td class="mono">${r}</td>${cells}</tr>`);
  }

  container.innerHTML = `
    <table class="status-table">
      <thead>
        <tr>
          <th>Round</th>
          ${headerCells}
        </tr>
      </thead>
      <tbody>
        ${rows.join("")}
      </tbody>
    </table>
  `;
}

function renderVoteTable() {
  const container = $("voteTable");
  if (!container) return;

  const players = Array.isArray(lastRoomStatus?.players) ? lastRoomStatus.players : [];
  const sortedPlayers = players.slice().sort((a, b) => (a.playerNumber ?? 0) - (b.playerNumber ?? 0));

  const votePhase = lastGameState?.game?.votePhase || null;
  if (!votePhase || (!votePhase.active && !votePhase.startedAt)) {
    container.textContent = "Voting will start once enough players are ready.";
    return;
  }

  const saved = getSaved(getRoomCode());
  const myId = saved?.playerId || null;
  const myVote = myId ? votePhase.votes?.[myId] || null : null;

  const nameById = new Map();
  for (const p of sortedPlayers) {
    nameById.set(p.playerId, p);
  }

  const rows = sortedPlayers
    .map(p => {
      const votedForId = votePhase.votes?.[p.playerId] ?? null;
      const votedFor = votedForId ? nameById.get(votedForId) : null;
      const showVote = votedForId || (votePhase.endedAt && votePhase.startedAt);
      const votedText = showVote ? "voted for" : "";
      const targetText = votedFor
        ? `${votedFor.playerNumber}. ${esc(votedFor.name || "")}`
        : (showVote ? "-" : "");

      const isSelf = myId && p.playerId === myId;
      const checked = myVote && myVote === p.playerId;
      const disabled = !votePhase.active || isSelf;

      return `
        <tr>
          <td>
            ${isSelf ? "" : `<input type="checkbox" class="vote-choice" data-target="${p.playerId}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} />`}
          </td>
          <td>
            <span class="vote-target ${disabled ? "disabled" : ""}" data-target="${p.playerId}">
              ${p.playerNumber}. ${esc(p.name || "")}
            </span>
          </td>
          <td>${votedText}</td>
          <td>${targetText}</td>
        </tr>
      `;
    })
    .join("");

  container.innerHTML = `
    <table class="status-table">
      <thead>
        <tr>
          <th></th>
          <th>Voter</th>
          <th></th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function updateGameUI() {
  const roleEl = $("roleLabel");
  const playerLabel = $("playerLabel");
  const secretEl = $("secretWord");
  const turnEl = $("turnStatus");
  const moveHint = $("moveHint");
  const input = $("moveWord");
  const btn = $("btnSubmitMove");
  const voteStatus = $("voteStatus");
  const voteTimer = $("voteTimer");
  const triggerBtn = $("btnTriggerVote");

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
  const votePhase = game?.votePhase || null;

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

  const voteActive = !!votePhase?.active;

  const canMove =
    !!role &&
    !ended &&
    !voteActive &&
    nextPlayerNumber != null &&
    playerNumber != null &&
    nextPlayerNumber === playerNumber;

  if (input) input.disabled = !canMove;
  if (btn) btn.disabled = !canMove;
  if (moveHint) {
    moveHint.textContent = canMove
      ? ""
      : (voteActive ? "Voting is in progress." : "Moves unlock once your role is known and it is your turn.");
  }

  if (voteStatus) {
    const total = Array.isArray(lastRoomStatus?.players) ? lastRoomStatus.players.length : 0;
    const triggers = Array.isArray(votePhase?.triggers) ? votePhase.triggers.length : 0;
    if (!votePhase || (!votePhase.active && !votePhase.startedAt)) {
      if (triggers > 0) {
        voteStatus.textContent = `Players ready to vote: ${triggers}/${Math.max(0, total - 1)}.`;
      } else {
        voteStatus.textContent = "Voting has not started.";
      }
    } else if (votePhase.active) {
      voteStatus.textContent = `Voting in progress (${triggers}/${Math.max(0, total - 1)} ready).`;
    } else {
      voteStatus.textContent = "Voting complete.";
    }
  }

  if (triggerBtn) {
    const saved = getSaved(getRoomCode());
    const myId = saved?.playerId || null;
    const triggers = Array.isArray(votePhase?.triggers) ? votePhase.triggers : [];
    const alreadyTriggered = myId ? triggers.includes(myId) : false;
    triggerBtn.disabled = !!votePhase?.active || !!ended || alreadyTriggered;
  }

  updateVoteTimer(votePhase);
}

function formatSeconds(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = String(s % 60).padStart(2, "0");
  return `${m}:${sec}`;
}

function updateVoteTimer(votePhase) {
  const timer = $("voteTimer");
  if (!timer) return;

  if (voteTimerInterval) {
    clearInterval(voteTimerInterval);
    voteTimerInterval = null;
  }

  if (!votePhase || (!votePhase.active && !votePhase.startedAt)) {
    timer.textContent = formatSeconds(VOTE_TOTAL_SECONDS);
    timer.classList.remove("timer", "urgent");
    return;
  }

  timer.classList.add("timer");

  if (!votePhase.active && votePhase.startedAt) {
    timer.textContent = formatSeconds(0);
    timer.classList.remove("urgent");
    return;
  }

  const endsAt = votePhase.endsAt ? Date.parse(votePhase.endsAt) : null;
  if (!endsAt || !Number.isFinite(endsAt)) {
    timer.textContent = formatSeconds(VOTE_TOTAL_SECONDS);
    timer.classList.remove("urgent");
    return;
  }

  const tick = () => {
    const remainingMs = endsAt - Date.now();
    const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
    timer.textContent = formatSeconds(remainingSec);
    if (remainingSec <= VOTE_FINAL_SECONDS) {
      timer.classList.add("urgent");
    } else {
      timer.classList.remove("urgent");
    }
    if (remainingSec <= 0 && voteTimerInterval) {
      clearInterval(voteTimerInterval);
      voteTimerInterval = null;
    }
  };

  voteTimerInterval = setInterval(tick, 200);
  tick();
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
  if (raw === "Room is locked") return "This room is locked and can't accept new players.";
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
  if (btnCreate && !createInFlight) btnCreate.disabled = !canUse;
  if (btnJoin && !createInFlight) btnJoin.disabled = !canUse;
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

function setLandingDisabled(disabled) {
  const ids = ["btnCreateRoom", "btnJoinRoom", "btnBackLanding", "btnRejoinRoom"];
  for (const id of ids) {
    const el = $(id);
    if (el) el.disabled = disabled;
  }
  const nameInput = $("playerName");
  if (nameInput) nameInput.disabled = disabled;
  const roomInput = $("roomCode");
  if (roomInput) roomInput.disabled = disabled;
}

function showOverlay(message, actionLabel = "", actionFn = null) {
  const overlay = $("overlay");
  const msg = $("overlayMessage");
  const btn = $("overlayAction");
  const cancel = $("overlayCancel");
  const choice = $("overlayChoice");
  const buttons = $("overlayButtons");
  if (!overlay || !msg || !btn) return;
  msg.textContent = message || "";
  overlay.classList.remove("hidden");
  overlayMode = "progress";
  if (choice) choice.classList.add("hidden");
  if (buttons) buttons.classList.remove("hidden");
  if (actionLabel && actionFn) {
    btn.textContent = actionLabel;
    btn.classList.remove("hidden");
    btn.onclick = () => actionFn();
  } else {
    btn.classList.add("hidden");
    btn.onclick = null;
  }
  if (cancel) cancel.onclick = () => cancelCreate();
}

function showOverlayChoice(
  message,
  primaryLabel,
  primaryFn,
  secondaryLabel,
  secondaryFn,
  dismissFn = null
) {
  const overlay = $("overlay");
  const msg = $("overlayMessage");
  const primary = $("overlayPrimary");
  const secondary = $("overlaySecondary");
  const choice = $("overlayChoice");
  const buttons = $("overlayButtons");
  if (!overlay || !msg || !primary || !secondary) return;
  msg.textContent = message || "";
  overlay.classList.remove("hidden");
  overlayMode = "choice";
  overlayDismiss = dismissFn;
  if (buttons) buttons.classList.add("hidden");
  if (choice) choice.classList.remove("hidden");
  primary.textContent = primaryLabel || "OK";
  secondary.textContent = secondaryLabel || "Cancel";
  primary.onclick = () => {
    overlayDismiss = null;
    if (primaryFn) primaryFn();
  };
  secondary.onclick = () => {
    overlayDismiss = null;
    if (secondaryFn) secondaryFn();
  };
}

function hideOverlay() {
  const overlay = $("overlay");
  if (overlay) overlay.classList.add("hidden");
  const btn = $("overlayAction");
  if (btn) btn.onclick = null;
  const cancel = $("overlayCancel");
  if (cancel) cancel.onclick = null;
  const primary = $("overlayPrimary");
  const secondary = $("overlaySecondary");
  if (primary) primary.onclick = null;
  if (secondary) secondary.onclick = null;
  overlayMode = "progress";
  overlayDismiss = null;
}

function dismissOverlayChoice() {
  const dismiss = overlayDismiss;
  overlayDismiss = null;
  hideOverlay();
  if (dismiss) dismiss();
}

function initOverlayDismissal() {
  const overlay = $("overlay");
  const card = $("overlayCard");
  if (!overlay || !card) return;

  overlay.addEventListener("click", e => {
    if (overlayMode !== "choice") return;
    if (e.target === overlay) {
      dismissOverlayChoice();
    }
  });

  document.addEventListener("keydown", e => {
    if (overlayMode !== "choice") return;
    if (e.key === "Escape") dismissOverlayChoice();
  });
}

function cancelCreate() {
  createAbort = true;
  createInFlight = false;
  setLandingDisabled(false);
  hideOverlay();
  createState = { roomCode: null, retries: 0 };
}

async function joinRoom(options = {}) {
  const roomCode = getRoomCode();
  const name = normalizeName($("playerName")?.value || "");
  const skipLandingGate = !!options.skipLandingGate;
  const allowNameMismatch = !!options.allowNameMismatch;
  const ignoreExistingRoom = !!options.ignoreExistingRoom;

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

  if (!skipLandingGate && !ignoreExistingRoom) {
    const lastRoom = getLastRoomCode();
    const savedLast = lastRoom ? getSaved(lastRoom) : null;
    if (lastRoom && lastRoom !== roomCode && savedLast?.playerId) {
      const savedName = normalizeName(savedLast.name || "");
      const nameChanged = !!(savedName && name && savedName !== name);
      const baseMessage = `You're already in room ${lastRoom}`;
      const nameSuffix = nameChanged ? ` as "${savedName}"` : "";
      const message = baseMessage + nameSuffix + ".";
      const basePrimary = `Join new room (${roomCode})`;
      const primaryLabel = nameChanged ? `${basePrimary} as "${name}"` : basePrimary;
      const baseSecondary = `Re-join old room (${lastRoom})`;
      const secondaryLabel = baseSecondary + nameSuffix;
      const choice = await new Promise(resolve => {
        showOverlayChoice(
          message,
          primaryLabel,
          () => resolve("new"),
          secondaryLabel,
          () => resolve("old"),
          () => resolve(null)
        );
      });
      hideOverlay();
      if (choice === "new") {
        await leaveRoomByCode(lastRoom, savedLast.playerId);
      } else if (choice === "old") {
        setRoomCode(lastRoom);
        await joinRoom({ skipLandingGate: true, allowNameMismatch: true, ignoreExistingRoom: true });
        return;
      } else {
        return;
      }
    }
  }

  if (!skipLandingGate) {
    setLandingDisabled(true);
    showOverlay("Joining room...");
  }

  const precheck = await postJSON("/.netlify/functions/roomStatus", { roomCode });
  if (precheck.status === 404) {
    setActionError(true, "Room not found.");
    if (!skipLandingGate) {
      hideOverlay();
      setLandingDisabled(false);
    }
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
          if (!skipLandingGate) {
            hideOverlay();
            setLandingDisabled(false);
          }
          log({ error: "Name does not match saved player for this room" }, "joinRoom");
          return;
        }
        setLastRoomCode(roomCode);
        log({ roomCode, ...getSaved(roomCode) }, "joinRoom (reused local identity)");
        await roomStatus("roomStatus (already joined)");
        startPolling();
        if (!skipLandingGate) {
          setView("viewLobby");
          hideOverlay();
          setLandingDisabled(false);
        }
        return;
      }

      if (!name) {
        nameTouched = true;
        updateNameError();
        $("playerName")?.focus();
        if (!skipLandingGate) {
          hideOverlay();
          setLandingDisabled(false);
        }
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
        if (!skipLandingGate) {
          setView("viewLobby");
          hideOverlay();
          setLandingDisabled(false);
        }
      } else if (status !== 200) {
        setActionError(true, friendlyJoinError(data, status));
        if (!skipLandingGate) {
          hideOverlay();
          setLandingDisabled(false);
        }
      }
    } catch (err) {
      log({ error: String(err), stack: err?.stack || null }, "joinRoom (exception)");
      if (!skipLandingGate) {
        hideOverlay();
        setLandingDisabled(false);
      }
    } finally {
      joinInFlight = null;
    }
  })();
}

async function createRoom(options = {}) {
  const name = String($("playerName")?.value || "").trim();
  const ignoreExistingRoom = !!options.ignoreExistingRoom;
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

  if (!ignoreExistingRoom) {
    const lastRoom = getLastRoomCode();
    const savedLast = lastRoom ? getSaved(lastRoom) : null;
    if (lastRoom && savedLast?.playerId) {
      const savedName = normalizeName(savedLast.name || "");
      const nameChanged = !!(savedName && name && savedName !== name);
      const baseMessage = `You're already in room ${lastRoom}`;
      const nameSuffix = nameChanged ? ` as "${savedName}"` : "";
      const message = baseMessage + nameSuffix + ".";
      const primaryLabel = "Create new room";
      const baseSecondary = `Re-join old room (${lastRoom})`;
      const secondaryLabel = baseSecondary + nameSuffix;
      const choice = await new Promise(resolve => {
        showOverlayChoice(
          message,
          primaryLabel,
          () => resolve("new"),
          secondaryLabel,
          () => resolve("old"),
          () => resolve(null)
        );
      });
      hideOverlay();
      if (choice === "new") {
        await leaveRoomByCode(lastRoom, savedLast.playerId);
      } else if (choice === "old") {
        setRoomCode(lastRoom);
        await joinRoom({ skipLandingGate: true, allowNameMismatch: true, ignoreExistingRoom: true });
        return;
      } else {
        return;
      }
    }
  }

  if (createInFlight) return;
  createInFlight = true;
  createAbort = false;
  setLandingDisabled(true);
  showOverlay("Creating room...");

  const waitForRoom = async roomCode => {
    const deadline = Date.now() + CREATE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (createAbort) return false;
      const res = await postJSON("/.netlify/functions/roomStatus", { roomCode });
      if (res.status === 200) return true;
      await new Promise(r => setTimeout(r, 200));
    }
    return false;
  };

  const createAndWait = async reuseExisting => {
    if (createAbort) return false;
    if (!reuseExisting || !createState.roomCode) {
      const playerCount = Number($("playerCount")?.value);
      const rounds = Number($("rounds")?.value);
      const wordsPerPlayer = Number($("wordsPerPlayer")?.value);

      const payload = { playerCount, rounds };
      if (Number.isInteger(wordsPerPlayer) && wordsPerPlayer >= 1 && wordsPerPlayer <= 10) {
        payload.wordsPerPlayer = wordsPerPlayer;
      }

      const { status, data } = await postJSON("/.netlify/functions/createRoom", payload);
      log({ status, ...data }, "createRoom");

      if (!data.roomCode) {
        hideOverlay();
        setLandingDisabled(false);
        createInFlight = false;
        return false;
      }

      createState.roomCode = data.roomCode;
      setRoomCode(data.roomCode);
      renderLocal(data.roomCode);
    }

    const visible = await waitForRoom(createState.roomCode);
    if (visible) {
      if (createAbort) return false;
      if (!getSaved(createState.roomCode)?.playerId) {
        await joinRoom({ skipLandingGate: true });
      } else {
        await roomStatus("roomStatus (after create)");
        startPolling();
      }

      setView("viewLobby");
      hideOverlay();
      setLandingDisabled(false);
      createInFlight = false;
      createState = { roomCode: null, retries: 0 };
      return true;
    }

    if (createAbort) return false;
    createState.retries += 1;
    if (createState.retries === 1) {
      showOverlay("Still creating room...", "Try again", async () => {
        showOverlay("Creating room...");
        await createAndWait(true);
      });
    } else {
      showOverlay("Still having trouble.", "Create new room", async () => {
        createState = { roomCode: null, retries: 0 };
        showOverlay("Creating room...");
        await createAndWait(false);
      });
    }
    return false;
  };

  await createAndWait(false);
  return;

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
  if (!isAllowedWord(words[0])) {
    setSubmitWordsError("One word only - letters, hyphens, apostrophes.");
    return;
  }

  setSubmitWordsError("");

  const { status, data } = await postJSON("/.netlify/functions/submitWords", {
    roomCode,
    playerId: saved.playerId,
    words
  });
  log({ status, ...data }, "submitWords");

  if (status === 200) {
    const input = $("wordInput");
    if (input && data.accepted?.length) input.value = "";
    const current = getAcceptedWords(roomCode);
    const merged = [...current];
    for (const w of data.accepted || []) {
      if (!merged.includes(w)) merged.push(w);
    }
    setAcceptedWords(roomCode, merged);
    if (Array.isArray(data.duplicates) && data.duplicates.length) {
      const reasonMap = {
        invalid_format: "invalid format",
        already_yours: "already submitted",
        already_in_pool: "already used by another player"
      };
      const message = data.duplicates
        .map(item => {
          const reason = reasonMap[item.reason] || "not accepted";
          return `${item.word} (${reason})`;
        })
        .join(", ");
      setSubmitWordsError(`Not accepted: ${message}.`);
    }
    await roomStatus("roomStatus (after submitWords)");
    return;
  }
  if (data?.error) setSubmitWordsError(String(data.error));
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

  const invalid = words.filter(w => !isAllowedWord(w));
  const valid = words.filter(w => isAllowedWord(w));
  if (invalid.length) {
    setSubmitWordsError(`Not accepted: ${invalid.join(", ")} (invalid format).`);
  } else {
    setSubmitWordsError("");
  }
  if (!valid.length) {
    return;
  }

  const { status, data } = await postJSON("/.netlify/functions/submitWords", {
    roomCode,
    playerId: saved.playerId,
    words: valid
  });
  log({ status, ...data }, "submitWordsBulk");

  if (status === 200) {
    const input = $("words");
    if (input && data.accepted?.length) input.value = "";
    const current = getAcceptedWords(roomCode);
    const merged = [...current];
    for (const w of data.accepted || []) {
      if (!merged.includes(w)) merged.push(w);
    }
    setAcceptedWords(roomCode, merged);
    if (Array.isArray(data.duplicates) && data.duplicates.length) {
      const reasonMap = {
        invalid_format: "invalid format",
        already_yours: "already submitted",
        already_in_pool: "already used by another player"
      };
      const message = data.duplicates
        .map(item => {
          const reason = reasonMap[item.reason] || "not accepted";
          return `${item.word} (${reason})`;
        })
        .join(", ");
      setSubmitWordsError(`Not accepted: ${message}.`);
    }
    await roomStatus("roomStatus (after submitWordsBulk)");
    return;
  }
  if (data?.error) setSubmitWordsError(String(data.error));
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

  const ok = await new Promise(resolve => {
    showOverlayChoice(
      `Start with current players${counts}?\nLate players will be locked out.`,
      "Start now",
      () => resolve(true),
      "Cancel",
      () => resolve(false),
      () => resolve(false)
    );
  });
  hideOverlay();
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
  if (!isAllowedWord(word)) {
    return log({ error: "One word only - letters, hyphens, apostrophes." }, "submitMove");
  }

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

async function triggerVote() {
  const roomCode = getRoomCode();
  if (!roomCode) return;

  const saved = getSaved(roomCode);
  if (!saved?.playerId) return;

  const ok = confirm("Are you sure? You can't take that back.");
  if (!ok) return;

  const { status, data } = await postJSON("/.netlify/functions/triggerVote", {
    roomCode,
    playerId: saved.playerId
  });
  log({ status, ...data }, "triggerVote");
  await fetchGameState({ silent: true });
}

async function castVote(targetPlayerId) {
  const roomCode = getRoomCode();
  if (!roomCode) return;

  const saved = getSaved(roomCode);
  if (!saved?.playerId) return;

  if (!lastGameState?.game?.votePhase?.active) return;

  if (!targetPlayerId || targetPlayerId === saved.playerId) return;

  const { status, data } = await postJSON("/.netlify/functions/castVote", {
    roomCode,
    playerId: saved.playerId,
    targetPlayerId
  });
  log({ status, ...data }, "castVote");
  await fetchGameState({ silent: true });
}

async function leaveRoom() {
  const roomCode = getRoomCode();
  if (!roomCode) return;

  const ok = await new Promise(resolve => {
    showOverlayChoice(
      "Leave room? You won't be able to rejoin.",
      "Leave room",
      () => resolve(true),
      "Cancel",
      () => resolve(false),
      () => resolve(false)
    );
  });
  hideOverlay();
  if (!ok) return;

  const saved = getSaved(roomCode);

  if (saved?.playerId) {
    const { status, data } = await postJSON("/.netlify/functions/leaveRoom", {
      roomCode,
      playerId: saved.playerId
    });
    log({ status, ...data }, "leaveRoom");
  }

  clearSaved(roomCode);
  clearLastRoomCode();
  setRoomCode("");
  renderAcceptedWords(roomCode);
  setSubmitWordsError("");
  roleState = { role: null, secretWord: null, gameId: null };
  lastRoomStatus = null;
  lastGameState = null;
  stopPolling();

  setView("viewLanding");
}

async function leaveRoomByCode(roomCode, playerId) {
  if (!roomCode || !playerId) return;
  const { status, data } = await postJSON("/.netlify/functions/leaveRoom", {
    roomCode,
    playerId
  });
  log({ status, ...data }, "leaveRoom");
  clearSaved(roomCode);
  clearLastRoomCode();
  stopPolling();
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
  restoreLogs();
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
  $("btnTriggerVote")?.addEventListener("click", triggerVote);
  $("btnRoomStatus")?.addEventListener("click", () => roomStatus());
  $("btnClearLocal")?.addEventListener("click", () => clearSaved(getRoomCode()));
  $("btnClearOutput")?.addEventListener("click", () => {
    const out = $("output");
    if (out) out.textContent = "";
    logBuffer = [];
    persistLogs();
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

  $("playerName")?.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.currentTarget?.blur();
  });

  const actionHintButtons = [
    $("btnJoinRoom"),
    $("btnSubmitWords"),
    $("btnSubmitMove")
  ].filter(Boolean);
  const clearActionHints = () => {
    for (const btn of actionHintButtons) btn.classList.remove("action-hint");
  };
  const setActionHint = id => {
    clearActionHints();
    const btn = $(id);
    if (btn) btn.classList.add("action-hint");
  };

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

  $("roomCode")?.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    joinRoom();
  });

  $("roomCode")?.addEventListener("focus", () => setActionHint("btnJoinRoom"));
  $("roomCode")?.addEventListener("blur", clearActionHints);

  for (const id of ["playerCount", "rounds", "wordsPerPlayer"]) {
    $(id)?.addEventListener("keydown", e => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      createRoom();
    });
  }

  $("wordInput")?.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    submitWords();
  });

  $("wordInput")?.addEventListener("focus", () => setActionHint("btnSubmitWords"));
  $("wordInput")?.addEventListener("blur", clearActionHints);


  $("moveWord")?.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    submitMove();
  });

  $("moveWord")?.addEventListener("focus", () => setActionHint("btnSubmitMove"));
  $("moveWord")?.addEventListener("blur", clearActionHints);

  $("roomCodePill")?.addEventListener("click", async () => {
    const value = String($("roomCodeDisplay")?.textContent || "").trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      flashCopied("roomCodeCopied");
    } catch {
      // Ignore clipboard failures (e.g., permissions)
    }
  });

  $("roomCodePillGame")?.addEventListener("click", async () => {
    const value = String($("roomCodeGame")?.textContent || "").trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      flashCopied("roomCodeCopiedGame");
    } catch {
      // Ignore clipboard failures (e.g., permissions)
    }
  });

  const voteTable = $("voteTable");
  if (voteTable) {
    let lastTapTarget = null;
    let lastTapAt = 0;
    voteTable.addEventListener("click", e => {
      const target = e.target;
      if (!target) return;
      if (target.tagName === "INPUT") e.preventDefault();
      const el = target.closest?.("[data-target]");
      if (!el) return;
      const targetId = el.getAttribute("data-target");
      if (!targetId) return;

      const now = Date.now();
      if (lastTapTarget === targetId && now - lastTapAt < 450) {
        lastTapTarget = null;
        lastTapAt = 0;
        castVote(targetId);
        return;
      }
      lastTapTarget = targetId;
      lastTapAt = now;
    });
  }

  renderLocal(getRoomCode());
  setView("viewLanding");
  updateLandingMode(null);
  updateNameError();
  updateRejoinButton();
  initOverlayDismissal();
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
