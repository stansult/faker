function $(id) {
  return document.getElementById(id);
}

/* ===== logging + fetch ===== */

function nowStamp() {
  return new Date().toLocaleString();
}

function renderLogEntry(entry, out, prepend = true) {
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

  if (prepend && out.firstChild) {
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
    renderLogEntry(logBuffer[i], out, false);
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

function cancelJoinInFlight() {
  if (!joinInFlight) return;
  joinAttemptId += 1;
  joinInFlight = null;
  joinInFlightStartedAt = 0;
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
    data = { error: getUiError("NON_JSON_RESPONSE", "Non-JSON response") };
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
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function renderSelfMarker(direction) {
  const arrow = direction === "right" ? "you&nbsp;→" : "←&nbsp;you";
  return `<span class="you-marker">${arrow}</span>`;
}

function getRoomLanguage() {
  return lastRoomStatus?.language === "ru" ? "ru" : "en";
}

function getLanguageLabel(language) {
  return language === "ru" ? "Russian" : "English";
}

const VALIDATION_CONSTANTS =
  typeof window !== "undefined" && window.VALIDATION_CONSTANTS
    ? window.VALIDATION_CONSTANTS
    : {};
const MAX_WORD_LENGTH = Number.isInteger(VALIDATION_CONSTANTS.MAX_WORD_LENGTH)
  ? VALIDATION_CONSTANTS.MAX_WORD_LENGTH
  : 50;
const MAX_NAME_LENGTH = Number.isInteger(VALIDATION_CONSTANTS.MAX_NAME_LENGTH)
  ? VALIDATION_CONSTANTS.MAX_NAME_LENGTH
  : 24;
const ROOM_CODE_LENGTH = Number.isInteger(VALIDATION_CONSTANTS.ROOM_CODE_LENGTH)
  ? VALIDATION_CONSTANTS.ROOM_CODE_LENGTH
  : 6;
const VOTE_TOTAL_SECONDS = Number.isInteger(VALIDATION_CONSTANTS.VOTE_TOTAL_SECONDS)
  ? VALIDATION_CONSTANTS.VOTE_TOTAL_SECONDS
  : 30;
const VOTE_FINAL_SECONDS = Number.isInteger(VALIDATION_CONSTANTS.VOTE_FINAL_SECONDS)
  ? VALIDATION_CONSTANTS.VOTE_FINAL_SECONDS
  : 5;
const UI_ERRORS =
  typeof window !== "undefined" && window.UI_ERRORS ? window.UI_ERRORS : {};
const getUiError = (key, fallback) => UI_ERRORS[key] || fallback;

function isAllowedWord(word) {
  const language = getRoomLanguage();
  const value = String(word || "");
  if (language === "ru") {
    return /^[а-яё'-]+$/i.test(value);
  }
  return /^[a-z'-]+$/i.test(value);
}

function getWordRuleHint() {
  const language = getRoomLanguage();
  return language === "ru"
    ? "Use Russian letters only (including ё), hyphens, apostrophes."
    : "Use English letters only, hyphens, apostrophes.";
}

function isWithinWordLength(word) {
  return String(word || "").length <= MAX_WORD_LENGTH;
}

const copiedTimers = {};

function flashCopied(id, message, durationMs = 2500) {
  const el = $(id);
  if (!el) return;
  if (message) el.textContent = message;
  el.classList.add("show");
  if (copiedTimers[id]) clearTimeout(copiedTimers[id]);
  copiedTimers[id] = setTimeout(() => {
    el.classList.remove("show");
  }, durationMs);
}

const MOVE_ALERT_SECONDS = 30;
const MOVE_VIBRATE_INTERVAL_SECONDS = 10;

/* ===== view helpers ===== */

const views = ["viewLobby", "viewRoom", "viewGame"];
let currentView = "viewLobby";
const LOBBY_SUBTITLE =
  "Join a room, submit your words, and try to spot the faker. Legit players share the secret word, the faker must bluff their way through.";

function setView(activeId) {
  currentView = activeId;
  hideTooltip();
  for (const id of views) {
    const el = $(id);
    if (!el) continue;
    if (id === activeId) el.classList.add("active");
    else el.classList.remove("active");
  }
  const subheading = $("subheading");
  if (subheading) {
    subheading.classList.toggle("hidden", activeId === "viewGame");
    if (activeId === "viewLobby") {
      subheading.textContent = LOBBY_SUBTITLE;
    }
  }
  updatePlayerBadge();
  const gameBadge = $("playerBadgeGame");
  if (gameBadge) gameBadge.classList.toggle("hidden", activeId !== "viewGame");
  updateTitle();
}

function updateTitle() {
  const base = "Faker";
  const rs = lastRoomStatus;
  const game = lastGameState?.game || rs?.game || null;
  const matchEnded = !!rs?.matchEnded;
  const roomCode = rs?.roomCode || getRoomCode();
  const locked = !!rs?.locked;

  if (currentView === "viewLobby") {
    document.title = `${base} — Lobby`;
    return;
  }

  if (matchEnded) {
    document.title = `${base} — Match Over`;
    return;
  }

  if (currentView === "viewRoom") {
    const suffix = locked ? " (locked)" : "";
    document.title = roomCode
      ? `${base} — Room ${roomCode}${suffix}`
      : `${base} — Room${suffix}`;
    return;
  }

  if (currentView === "viewGame") {
    const votePhase = game?.votePhase || null;
    if (votePhase?.startedAt) {
      document.title = `${base} — Voting`;
      return;
    }
    const saved = getSaved(getRoomCode());
    const myNumber = saved?.playerNumber ?? null;
    const nextPlayer = game?.nextPlayerNumber ?? null;
    const isYourTurn = myNumber != null && nextPlayer != null && myNumber === nextPlayer;
    const turnSuffix = isYourTurn ? " — Your move!" : "";
    const gamesTotal = Number.isInteger(rs?.gamesTotal) ? rs.gamesTotal : null;
    const gamesPlayed = Number.isInteger(rs?.gamesPlayed) ? rs.gamesPlayed : 0;
    const ended = !!game?.endedAt;
    const gameActive = !!(game?.gameId && !ended);
    if (gamesTotal) {
      const current = gameActive ? gamesPlayed + 1 : Math.max(1, gamesPlayed);
      document.title = `${base} — Game ${current}/${gamesTotal}${turnSuffix}`;
      return;
    }
    document.title = `${base} — Game${turnSuffix}`;
    return;
  }

  document.title = base;
}

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text || "";
}

const tooltipState = {
  el: null,
  timer: null,
  target: null,
  shownAt: 0,
  lockedUntil: 0
};

function getTooltipEl() {
  if (!tooltipState.el) {
    tooltipState.el = $("tooltip");
  }
  return tooltipState.el;
}

function hideTooltip() {
  const tip = getTooltipEl();
  if (!tip) return;
  if (tooltipState.timer) {
    clearTimeout(tooltipState.timer);
    tooltipState.timer = null;
  }
  tip.classList.remove("show", "tooltip--above", "tooltip--below");
  tip.classList.add("hidden");
  tooltipState.target = null;
  tooltipState.lockedUntil = 0;
}

function showTooltip(target, text, autoHide = false) {
  const tip = getTooltipEl();
  if (!tip || !target || !text) return;
  if (tooltipState.timer) {
    clearTimeout(tooltipState.timer);
    tooltipState.timer = null;
  }

  tip.textContent = text;
  tip.classList.remove("hidden", "tooltip--above", "tooltip--below");
  tip.classList.add("show");

  const rect = target.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  const margin = 8;

  let top = rect.top - tipRect.height - 10;
  let placement = "tooltip--above";
  if (top < margin) {
    top = rect.bottom + 10;
    placement = "tooltip--below";
  }

  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  const maxLeft = window.innerWidth - tipRect.width - margin;
  if (left < margin) left = margin;
  if (left > maxLeft) left = maxLeft;

  tip.style.top = `${Math.round(top)}px`;
  tip.style.left = `${Math.round(left)}px`;
  tip.style.setProperty("--arrow-x", `${Math.round(rect.left + rect.width / 2 - left)}px`);
  tip.classList.add(placement);

  tooltipState.target = target;
  tooltipState.shownAt = Date.now();
  if (autoHide) {
    tooltipState.lockedUntil = tooltipState.shownAt + TOOLTIP_DURATION_MS;
    tooltipState.timer = setTimeout(hideTooltip, TOOLTIP_DURATION_MS);
  }
}

function isHoverCapable() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function getTableScrollInner(container) {
  if (!container) return null;
  return container.querySelector(".table-scroll__inner") || container;
}

function setTableScrollableFlag(container) {
  if (!container) return;
  const scrollEl = getTableScrollInner(container);
  if (!scrollEl) return;
  const scrollable = scrollEl.scrollWidth - scrollEl.clientWidth > 1;
  container.dataset.scrollable = scrollable ? "true" : "false";
}

function refreshTableScrollableFlags() {
  const tables = document.querySelectorAll(".table-scroll");
  for (const table of tables) {
    setTableScrollableFlag(table);
  }
}

function updateScrollableContainer(container, html) {
  if (!container) return;
  if (container.dataset.lastHtml === html) return;
  const prevScroll = getTableScrollInner(container)?.scrollLeft || 0;
  container.dataset.lastHtml = html;
  container.innerHTML = html;
  const scrollEl = getTableScrollInner(container);
  if (!scrollEl) return;
  requestAnimationFrame(() => {
    const maxScroll = Math.max(0, scrollEl.scrollWidth - scrollEl.clientWidth);
    scrollEl.scrollLeft = Math.min(prevScroll, maxScroll);
    setTableScrollableFlag(container);
  });
  setTimeout(() => setTableScrollableFlag(container), 0);
}

function clearMoveAlerts(panel) {
  if (moveAlertTimer) {
    clearTimeout(moveAlertTimer);
    moveAlertTimer = null;
  }
  if (moveVibrateTimer) {
    clearInterval(moveVibrateTimer);
    moveVibrateTimer = null;
  }
  if (panel) panel.classList.remove("your-turn-alert");
}

function triggerMoveVibration() {
  if (navigator.vibrate) {
    navigator.vibrate([120, 60, 120]);
  }
}

function setMoveTurnActive(panel, active) {
  if (!panel) return;
  if (!active) {
    moveTurnActive = false;
    moveTurnStartedAt = null;
    clearMoveAlerts(panel);
    panel.classList.remove("your-turn");
    return;
  }

  panel.classList.add("your-turn");
  if (!moveTurnActive) {
    moveTurnActive = true;
    moveTurnStartedAt = Date.now();
  }

  if (moveAlertTimer || panel.classList.contains("your-turn-alert")) return;

  const elapsed = Date.now() - (moveTurnStartedAt ?? Date.now());
  const remaining = Math.max(0, MOVE_ALERT_SECONDS * 1000 - elapsed);
  moveAlertTimer = setTimeout(() => {
    panel.classList.add("your-turn-alert");
    triggerMoveVibration();
    if (!moveVibrateTimer) {
      moveVibrateTimer = setInterval(() => {
        triggerMoveVibration();
      }, MOVE_VIBRATE_INTERVAL_SECONDS * 1000);
    }
  }, remaining);
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

function getInviteUrl(roomCode) {
  const value = sanitizeRoomCode(roomCode || "");
  if (!value) return "";
  const base = window.location.origin || "https://faker-game.netlify.app";
  return `${base}/?room=${value}`;
}

function sanitizeRoomCode(raw) {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  return String(raw || "")
    .toUpperCase()
    .split("")
    .filter(ch => alphabet.includes(ch))
    .slice(0, ROOM_CODE_LENGTH)
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
    roomInput.readOnly = locked && currentView !== "viewLobby";
  }

  const nameInput = $("playerName");
  if (nameInput) {
    const locked = !!(saved && saved.playerId && saved.playerNumber);
    nameInput.disabled = locked && currentView !== "viewLobby";
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

function getRevealedWord() {
  return (
    lastGameState?.game?.revealedWord ||
    lastRoomStatus?.game?.revealedWord ||
    null
  );
}

function getUsedWords() {
  const used = lastGameState?.game?.usedWords || lastRoomStatus?.usedWords || [];
  return Array.isArray(used) ? used : [];
}

async function updateMyWords(words) {
  const roomCode = getRoomCode();
  if (!roomCode) return;
  const saved = getSaved(roomCode);
  if (!saved?.playerId) return;

  const payload = {
    roomCode,
    playerId: saved.playerId,
    words
  };

  const { status, data } = await postJSON("/.netlify/functions/updateWords", payload);
  log({ status, ...data }, "updateWords");
  if (status !== 200) {
    const message = data?.error ? String(data.error) : `Update failed (${status})`;
    setSubmitWordsError(message);
    return;
  }

  if (Array.isArray(data.words)) {
    setAcceptedWords(roomCode, data.words);
  }

  await roomStatus("roomStatus (after updateWords)", { silent: true });
}

async function kickPlayer(playerId) {
  if (kickInFlight) return;
  const roomCode = getRoomCode();
  if (!roomCode) return;
  const saved = getSaved(roomCode);
  if (!saved?.playerId) return;
  kickInFlight = true;
  const { status, data } = await postJSON("/.netlify/functions/kickPlayer", {
    roomCode,
    hostPlayerId: saved.playerId,
    targetPlayerId: playerId
  });
  log({ status, ...data }, "kickPlayer");
  if (status !== 200) {
    setActionError(true, data?.error ? String(data.error) : `Kick failed (${status})`);
  }
  await roomStatus("roomStatus (after kick)", { silent: true });
  kickInFlight = false;
}

async function markWordsDone() {
  const roomCode = getRoomCode();
  if (!roomCode) return;
  const saved = getSaved(roomCode);
  if (!saved?.playerId) return;

  const ok = await new Promise(resolve => {
    showOverlayChoice(
      "Are you ready to lock your words?\nYou can’t change them later, even for typos.",
      "Ready!",
      () => resolve(true),
      "Check again",
      () => resolve(false),
      () => resolve(false),
      null
    );
  });
  hideOverlay();
  if (!ok) return;

  const { status, data } = await postJSON("/.netlify/functions/markWordsDone", {
    roomCode,
    playerId: saved.playerId
  });
  log({ status, ...data }, "markWordsDone");
  if (status !== 200) {
    const message = data?.error ? String(data.error) : `Done failed (${status})`;
    setSubmitWordsError(message);
    return;
  }

  await roomStatus("roomStatus (after markWordsDone)", { silent: true });
}

function showGameOverOverlay(game) {
  if (!game?.endedAt || !game?.gameId) return;
  if (!hasActiveGameSession) return;
  const key = `${game.gameId}:${game.endedAt}`;
  if (key === lastGameOverKey) return;
  lastGameOverKey = key;
  gameOverOverlay = { gameId: game.gameId, shownAt: Date.now() };

  const winner = String(game.winner || "");
  const endReason = String(game.endReason || "");
  const revealed = getRevealedWord();
  const role = roleState?.role || null;
  const fakerName = formatName(game.fakerName) || null;
  const fakerNumber = game.fakerPlayerNumber || null;
  const fakerLabel = fakerName
    ? `player #${fakerNumber != null ? fakerNumber : "?"} (${fakerName})`
    : (fakerNumber != null ? `player #${fakerNumber}` : "the faker");

  let message = "Game over.";
  if (winner === "faker" && endReason === "faker_said_secret_word_on_turn") {
    if (role === "faker") {
      message = revealed
        ? `Yes, the secret word was "${revealed}".\nYou won! 🎉🎉`
        : "You won! 🎉🎉";
    } else {
      message = revealed
        ? `Oh no, faker guessed "${revealed}" and won!\nIt was ${fakerLabel} 😢😢`
        : `Oh no, ${fakerLabel} won! 😢😢`;
    }
  } else if (endReason.startsWith("voting_")) {
    if (winner === "faker") {
      message = role === "faker"
        ? "Votes are in — you won! 🎉🎉"
        : `${fakerLabel.startsWith("player ")
            ? `Player ${fakerLabel.slice("player ".length)} was the faker.`
            : "The faker was revealed."}\nVotes are in — the faker won! 😢😢`;
    } else if (winner === "legits") {
      message = role === "faker"
        ? "Votes are in — you lost! 😢😢"
        : `Votes are in — we won!\n${fakerLabel.startsWith("player ")
            ? `We caught the faker, it was Player ${fakerLabel.slice("player ".length)}!`
            : "We caught the faker!"} 🎉🎉`;
    }
  } else if (winner === "faker") {
    message = role === "faker" ? "You won!" : `${fakerLabel} won!`;
  } else if (winner === "legits") {
    message = role === "faker"
      ? "Legit players won!"
      : `Legit players won! ${fakerLabel} was caught.`;
  }

  if (role === "faker" && revealed) {
    if (endReason === "faker_said_secret_word_on_turn") {
      message = `Yes, the secret word was "${revealed}".\nYou won! 🎉🎉`;
    } else if (endReason.startsWith("voting_")) {
      message = `The secret word was "${revealed}".\n${message}`;
    }
  }

  setOverlayTheme(role);
  const close = () => {
    hideOverlay();
    gameOverOverlay = null;
    if (gameOverDismissTimer) {
      clearTimeout(gameOverDismissTimer);
      gameOverDismissTimer = null;
    }
    if (lastRoomStatus?.matchEnded && !matchEndShown) {
      showMatchEndOverlay();
    }
  };
  showOverlay(message, "Close", close, close, false);
  clearActiveGameSession();
}

function setMoveError(message = "") {
  const el = $("moveError");
  if (!el) return;
  el.textContent = message || "";
  el.style.display = message ? "block" : "none";
}

function ordinalPlace(n) {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  const last = n % 10;
  if (last === 1) return `${n}st`;
  if (last === 2) return `${n}nd`;
  if (last === 3) return `${n}rd`;
  return `${n}th`;
}

function buildMatchSummaryHtml() {
  const players = Array.isArray(lastRoomStatus?.players) ? lastRoomStatus.players : [];
  const gamesTotal = Number.isInteger(lastRoomStatus?.gamesTotal) ? lastRoomStatus.gamesTotal : null;
  const sorted = players
    .slice()
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (a.playerNumber ?? 0) - (b.playerNumber ?? 0));

  const placeCounts = new Map();
  const rows = [];
  let lastScore = null;
  let place = 0;

  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const score = Number.isInteger(p.score) ? p.score : 0;
    if (lastScore === null || score < lastScore) {
      place = i + 1;
      lastScore = score;
    }
    placeCounts.set(place, (placeCounts.get(place) || 0) + 1);
    const name = formatName(p.name) || "Unknown";
    rows.push({ place, name, score });
  }

  const bodyRows = rows
    .map(row => {
      const tie = (placeCounts.get(row.place) || 0) > 1 ? " (tie)" : "";
      return `
        <tr>
          <td>${esc(row.name)}</td>
          <td class="mono">${row.score}</td>
          <td>${ordinalPlace(row.place)} place${tie}</td>
        </tr>
      `;
    })
    .join("");

  let reasonNote = "";
  if (lastRoomStatus?.matchEndReason === "insufficient_players") {
    reasonNote = `<div class="mini match-note">Match ended early: not enough players to continue.</div>`;
  }

  const totalText =
    gamesTotal != null && Number.isInteger(lastRoomStatus?.gamesPlayed)
      ? (lastRoomStatus.gamesPlayed >= gamesTotal
          ? `Total games: ${gamesTotal}`
          : `Played ${lastRoomStatus.gamesPlayed} / ${gamesTotal} games`)
      : `Total games: ${gamesTotal != null ? gamesTotal : "?"}`;

  return `
    <div class="overlay-title">Match over.</div>
    <div class="table-scroll table-scroll--plain">
      <div class="table-scroll__inner">
        <table class="status-table match-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Score</th>
              <th>Place</th>
            </tr>
          </thead>
          <tbody>
            ${bodyRows}
          </tbody>
        </table>
      </div>
    </div>
    ${reasonNote}
    <div class="mini match-total">${totalText}</div>
  `;
}

function showMatchEndOverlay() {
  if (matchEndShown) return;
  matchEndShown = true;
  setOverlayTheme(null);
  showOverlay("", "", null, null, false);
  const msg = $("overlayMessage");
  if (msg) {
    msg.innerHTML = buildMatchSummaryHtml();
  }
  const waitForRoom = () => {
    const room = $("viewRoom");
    if (room && room.classList.contains("active")) {
      showOverlay("", "Leave room", leaveRoomAfterMatchEnd, null, false);
      const refreshed = $("overlayMessage");
      if (refreshed) refreshed.innerHTML = buildMatchSummaryHtml();
      return;
    }
    setTimeout(waitForRoom, 200);
  };
  setTimeout(waitForRoom, 200);
}

function renderAcceptedWords(roomCode) {
  const el = $("submittedWordsLine");
  if (!el) return;
  const words = getAcceptedWords(roomCode)
    .slice()
    .sort((a, b) => a.length - b.length);
  if (!words.length) {
    el.textContent = "";
    return;
  }
  const usedSet = new Set(getUsedWords().map(w => normalizeWord(w)));
  const rendered = words.map(word => {
    if (usedSet.size && usedSet.has(normalizeWord(word))) {
      return `<span class="word-used">${esc(word)}</span>`;
    }
    return esc(word);
  });
  el.innerHTML = `<span class="meta-label">Submitted words:</span> <span class="meta-value">${rendered.join(", ")}</span>`;
}

function renderEditableWords(roomCode) {
  const container = $("submittedWordsEditor");
  if (!container) return;
  const words = getAcceptedWords(roomCode);
  const gameActive = !!(lastRoomStatus?.game?.gameId && !lastRoomStatus?.game?.endedAt);
  const gamesPlayed = Number.isInteger(lastRoomStatus?.gamesPlayed) ? lastRoomStatus.gamesPlayed : 0;
  const meDone = !!(lastRoomStatus?.players || []).find(p => p.playerId === getSaved(roomCode)?.playerId)?.doneWords;

  if (gameActive || gamesPlayed > 0 || meDone || !words.length) {
    container.textContent = "";
    return;
  }

  const chips = words.map(word => {
    const safe = esc(word);
    const raw = encodeURIComponent(word);
    return `
      <span class="word-chip">
        <span class="word-text">${safe}</span>
        <button type="button" class="word-action word-edit icon-btn" data-tip-hover="${TOOLTIP_EDIT_WORD}" data-word="${raw}" aria-label="Edit ${safe}">✏️</button>
        <button type="button" class="word-action word-delete icon-btn" data-tip-hover="${TOOLTIP_DELETE_WORD}" data-word="${raw}" aria-label="Delete ${safe}">❌</button>
      </span>
    `;
  });
  container.innerHTML = chips.join("");
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
let joinInFlightStartedAt = 0;
let joinAttemptId = 0;
let lastJoinError = null;
let lobbyMode = null;
let logBuffer = [];
let voteTimerInterval = null;
let createInFlight = false;
let createState = { roomCode: null, retries: 0 };
let createAbort = false;
let overlayMode = "progress";
let overlayDismiss = null;
let lastGameOverKey = null;
let startInFlight = false;
let hasActiveGameSession = false;
let voteTriggerInFlight = false;
let hasSeenRoomStatus = false;
let lastSeenGameId = null;
let startOverlay = null;
let startOverlayPending = false;
let gameOverOverlay = null;
let gameOverDismissTimer = null;
let matchEndShown = false;
let submitWordsInFlight = false;
let submitMoveInFlight = false;
let kickInFlight = false;
let moveTurnActive = false;
let moveTurnStartedAt = null;
let moveAlertTimer = null;
let moveVibrateTimer = null;

const CREATE_TIMEOUT_MS = 12000;
const POST_ACTION_DELAY_MS = 200;
const ACTIVE_GAME_KEY = "faker:activeGameId";
const APP_VERSION = "1.0";
const START_OVERLAY_MIN_MS = 1000;
const GAME_OVER_MIN_MS = 1000;
const TOOLTIP_DURATION_MS = 2200;
const TOOLTIP_COPY_CODE = "Copy room code";
const TOOLTIP_COPY_LINK = "Copy invite link";
const TOOLTIP_CODE_COPIED = "Room code copied!";
const TOOLTIP_LINK_COPIED = "Invite link copied!";
const TOOLTIP_ROOM_LOCKED = "Room locked";
const TOOLTIP_WAITING_MOVE = "Waiting for move";
const TOOLTIP_READY_VOTE = "Ready to vote";
const TOOLTIP_KICK_PLAYER = "Remove player";
const TOOLTIP_EDIT_WORD = "Edit word";
const TOOLTIP_DELETE_WORD = "Delete word";

function restoreActiveGameSession() {
  try {
    hasActiveGameSession = !!sessionStorage.getItem(ACTIVE_GAME_KEY);
  } catch {
    hasActiveGameSession = false;
  }
}

function setActiveGameSession(gameId) {
  if (!gameId) return;
  hasActiveGameSession = true;
  try {
    sessionStorage.setItem(ACTIVE_GAME_KEY, String(gameId));
  } catch {
    // Ignore storage failures
  }
}

function clearActiveGameSession() {
  hasActiveGameSession = false;
  try {
    sessionStorage.removeItem(ACTIVE_GAME_KEY);
  } catch {
    // Ignore storage failures
  }
}

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
    if (!opts.silent) {
      log(
        { error: getUiError("ENTER_ROOM_CODE_FIRST", "Enter room code first") },
        label
      );
    }
    return null;
  }

  const { status, data } = await postJSON("/.netlify/functions/roomStatus", { roomCode });
  if (!opts.silent) log({ status, ...data }, label);

  if (status === 200) renderRoomStatus(data);
  if (status === 200) {
    const saved = getSaved(data?.roomCode || roomCode);
    if (saved?.playerId && currentView === "viewLobby") {
      setView("viewRoom");
    }
  }
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
  const matchEnded = !!status?.matchEnded;

  const gameEnded = !!status?.game?.endedAt;
  const gameStarted = !!status?.game?.gameId;
  const gameActive = gameStarted && !gameEnded;
  const locked = !!status?.locked && !gameEnded;
  const gamesPlayed = Number.isInteger(status?.gamesPlayed) ? status.gamesPlayed : 0;
  const preMatch = gamesPlayed === 0 && !gameActive;

  const isHost = !!saved && saved.playerNumber === 1;
  const canStart =
    !gameActive && !matchEnded && allJoined && allReady;
  const currentPlayers =
    status?.currentPlayers ??
    (Array.isArray(status?.players) ? status.players.length : 0);
  const canStartShort =
    !gameActive &&
    !locked &&
    !allJoined &&
    allJoinedReady &&
    isHost &&
    currentPlayers >= 3 &&
    !matchEnded &&
    preMatch;

  btnStart.disabled = startInFlight || !canStart;

  if (btnStartShort) {
    btnStartShort.disabled = startInFlight || !canStartShort;
    btnStartShort.classList.toggle(
      "hidden",
      !isHost || allJoined || currentPlayers < 3 || matchEnded || locked || !preMatch
    );
  }
}

function renderRoomStatus(rs) {
  lastRoomStatus = rs;
  if (!rs.matchEnded) matchEndShown = false;
  const nextGameId = rs?.game?.gameId || null;
  const ended = !!rs?.game?.endedAt;
  const shouldStartOverlay =
    hasSeenRoomStatus &&
    nextGameId &&
    !ended &&
    nextGameId !== lastSeenGameId;
  lastSeenGameId = nextGameId;
  hasSeenRoomStatus = true;

  setRoomCode(rs.roomCode || "");

  const players = Array.isArray(rs.players) ? rs.players : [];
  const maxPlayers = Number.isInteger(rs.maxPlayers) ? rs.maxPlayers : null;
  const effectiveMaxPlayers = Number.isInteger(rs.effectiveMaxPlayers)
    ? rs.effectiveMaxPlayers
    : maxPlayers;
  const wordsRequired = Number.isInteger(rs.wordsRequired) ? rs.wordsRequired : null;
  const roundsPerGame = Number.isInteger(rs.roundsPerGame) ? rs.roundsPerGame : null;
  const gamesTotal = Number.isInteger(rs.gamesTotal) ? rs.gamesTotal : null;
  const gamesPlayed = Number.isInteger(rs.gamesPlayed) ? rs.gamesPlayed : 0;
  const gameActive = !!(rs.game && rs.game.gameId && !rs.game.endedAt);
  const locked = !!rs.locked;
  const lockIcon = $("roomLockIcon");
  if (lockIcon) {
    lockIcon.textContent = locked ? "🔒" : "";
    lockIcon.classList.toggle("hidden", !locked);
    if (locked) {
      lockIcon.dataset.tipHover = TOOLTIP_ROOM_LOCKED;
      lockIcon.dataset.tipTap = TOOLTIP_ROOM_LOCKED;
    } else {
      delete lockIcon.dataset.tipHover;
      delete lockIcon.dataset.tipTap;
    }
  }
  const totalSlots =
    effectiveMaxPlayers ??
    (Number.isInteger(rs.playerCount) ? rs.playerCount : null) ??
    players.length;

  let saved = getSaved(rs.roomCode || getRoomCode());
  const myPlayerId = saved?.playerId || null;
  if (saved?.playerId) {
    const me = players.find(p => p.playerId === saved.playerId);
    if (!me) {
      handleKicked(rs.roomCode || getRoomCode());
      return;
    }
    if (me && me.playerNumber && me.playerNumber !== saved.playerNumber) {
      setSaved(rs.roomCode || getRoomCode(), {
        ...saved,
        playerNumber: me.playerNumber,
        name: me.name || saved.name
      });
      saved = getSaved(rs.roomCode || getRoomCode());
    }
  }
  const isHost = !!saved && saved.playerNumber === 1;

  const displayMaxPlayers = effectiveMaxPlayers;
  const metaParts = [];
  metaParts.push(metaPair(
    "Players:",
    `${players.length}${displayMaxPlayers ? " / " + displayMaxPlayers : ""}`
  ));
  if (gamesTotal != null) {
    const currentGameNumber = gameActive ? gamesPlayed + 1 : gamesPlayed;
    if (gamesPlayed === 0 && !gameActive) {
      metaParts.push(metaPair("Games:", String(gamesTotal)));
    } else {
      metaParts.push(metaPair("Games:", `${currentGameNumber} / ${gamesTotal}`));
    }
  }
  if (roundsPerGame) metaParts.push(metaPair("Rounds per game:", String(roundsPerGame)));
  const roomMeta = $("roomMeta");
  if (roomMeta) roomMeta.innerHTML = metaJoin(metaParts);

  const subheading = $("subheading");
  if (subheading && currentView === "viewRoom") {
    if (gamesPlayed === 0 && !gameActive) {
      let text =
        "You are in the room where you are going to play. Submit your words to the pool that will be used for the games. Once all players submitted their words, anyone can start the first game!";
      if (isHost) {
        text += "\n\n As a host, you can start the game without waiting for those who are not ready, and even kick the players (be fair).";
      }
      subheading.textContent = text;
    } else {
      let text = "The game is on! Try to get the highest score!";
      if (isHost) {
        text += "\n\n As a host, you can kick the players (be fair).";
      }
      subheading.textContent = text;
    }
  }

  const el = $("playersList");
  if (el) {
    const showWordsColumn = !(gamesPlayed > 0 || gameActive);
    const showScoreColumn = gamesPlayed > 0 || gameActive;
    const byNumber = new Map(
      players.map(p => [p.playerNumber, p])
    );
    const rows = Array.from({ length: totalSlots }, (_, i) => i + 1)
      .map(n => {
        const p = byNumber.get(n);
        if (!p) {
          return `
        <tr class="row-muted">
          <td class="mono col-num">${n}</td>
          <td></td>
          ${showScoreColumn ? '<td class="mono col-score">-</td>' : ""}
          ${showWordsColumn ? '<td class="mono col-words">-</td>' : ""}
          <td class="mini">Not joined</td>
          ${isHost ? "<td></td>" : ""}
        </tr>
      `;
        }
        const canKick = isHost && p.playerNumber !== 1;
        const isMe = myPlayerId && p.playerId === myPlayerId;
        return `
        <tr${isMe ? ' class="is-me-row"' : ""}>
          <td class="mono col-num">${p.playerNumber}</td>
          <td>${esc(formatName(p.name) || "")}</td>
          ${showScoreColumn ? `<td class="mono col-score">${Number.isInteger(p.score) ? p.score : 0}</td>` : ""}
          ${showWordsColumn ? `<td class="mono col-words">${
            p.doneWords &&
            Number.isInteger(p.wordsRequired) &&
            Number.isInteger(p.wordsSubmitted) &&
            p.wordsSubmitted >= p.wordsRequired
              ? `<span class="ok-check">&#9989;</span>`
              : `${p.wordsSubmitted}/${p.wordsRequired}`
          }</td>` : ""}
          <td>${p.ready ? "Ready" : "Not ready"}</td>
          <td class="mini">${
            canKick
              ? `<button class="icon-btn kick-player" data-tip-hover="${TOOLTIP_KICK_PLAYER}" data-player-id="${p.playerId}" data-player-number="${p.playerNumber}" data-player-name="${esc(formatName(p.name) || "")}" type="button" aria-label="Kick player">❌</button>`
              : (isMe ? renderSelfMarker("left") : "")
          }</td>
        </tr>
      `;
      })
      .join("");

    const scoreHeader = showScoreColumn ? '<th class="col-score">Score</th>' : "";
    const wordHeader = showWordsColumn ? '<th class="col-words">Words</th>' : "";
    const kickHeader = "<th></th>";
    const html = `
      <div class="table-scroll__inner">
        <table class="status-table room-table">
          <thead>
            <tr>
              <th class="col-num">#</th>
              <th>Name</th>
              ${scoreHeader}
              ${wordHeader}
              <th>Status</th>
              ${kickHeader}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
    updateScrollableContainer(el, html);
  }

  updateWordsProgress(rs);
  const languageLabel = getLanguageLabel(getRoomLanguage());
  const wordLanguageHint = $("wordLanguageHint");
  if (wordLanguageHint) {
    const parts = [
      metaPair("Language:", languageLabel),
      wordsRequired != null ? metaPair("Words required:", String(wordsRequired)) : null
    ].filter(Boolean);
    wordLanguageHint.innerHTML = metaJoin(parts);
  }
  applyRoomStatus(rs);
  updatePlayerBadge();

  if (rs.game?.gameId && lastGameState?.game?.gameId && lastGameState.game.gameId !== rs.game.gameId) {
    lastGameState = null;
  }

  if (rs.game?.gameId && roleState.gameId !== rs.game.gameId) {
    roleState = { role: null, secretWord: null, gameId: rs.game.gameId };
    updateGameUI();
  }

  updateViewState(rs);

  if (rs.game?.gameId) {
    if (!roleState.role) fetchRole({ silent: true });
    fetchGameState({ silent: true });
  }

  if (shouldStartOverlay || (startOverlayPending && nextGameId && !ended)) {
    startOverlayPending = false;
    scheduleStartOverlayAfterGameOver(nextGameId);
  }

  if (rs.game?.endedAt) {
    showGameOverOverlay(rs.game);
  }

  if (rs.matchEnded && !gameOverOverlay && !matchEndShown) {
    showMatchEndOverlay();
  }

  updateTitle();
}

function updateWordsProgress(rs) {
  const saved = getSaved(rs.roomCode || getRoomCode());
  const me = saved?.playerId
    ? (rs.players || []).find(p => p.playerId === saved.playerId)
    : null;

  const required = Number.isInteger(rs.wordsRequired) ? rs.wordsRequired : null;
  const submitted = Number.isInteger(me?.wordsSubmitted) ? me.wordsSubmitted : 0;
  const remaining = required != null ? Math.max(0, required - submitted) : null;
  const doneWords = !!me?.doneWords;
  const gameActive = !!(rs?.game?.gameId && !rs?.game?.endedAt);
  const gamesPlayed = Number.isInteger(rs?.gamesPlayed) ? rs.gamesPlayed : 0;

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
  if (input) input.disabled = remaining === 0 || doneWords;
  if (btn) btn.disabled = remaining === 0 || doneWords;

  const doneBtn = $("btnDoneWords");
  if (doneBtn) doneBtn.classList.toggle("hidden", doneWords || remaining !== 0);

  const panel = $("submitWordsPanel");
  if (panel) panel.classList.toggle("hidden", gameActive || gamesPlayed > 0 || doneWords);
  renderAcceptedWords(rs.roomCode || getRoomCode());
  renderEditableWords(rs.roomCode || getRoomCode());
  if (remaining === 0) setSubmitWordsError("");
}

function updateViewState(rs) {
  const roomCode = rs?.roomCode || getRoomCode();
  const saved = roomCode ? getSaved(roomCode) : null;

  if (!saved?.playerId) {
    setView("viewLobby");
    return;
  }

  const currentGameId = rs?.game?.gameId || null;
  const ended = !!(
    rs?.game?.endedAt ||
    (currentGameId &&
      lastGameState?.game?.gameId === currentGameId &&
      lastGameState?.game?.endedAt)
  );

  if (currentGameId && !ended) {
    setActiveGameSession(currentGameId);
    setView("viewGame");
  } else {
    setView("viewRoom");
  }

  updateLobbyMode(null);
  applyRoleTheme();
}

function renderGameState(gs) {
  lastGameState = gs;

  if (gs?.game?.gameId && !gs?.game?.endedAt) {
    setActiveGameSession(gs.game.gameId);
  }

  renderRoundsTable();
  renderVoteTable();

  updateGameUI();
  maybeHideStartOverlay();
  if (gs?.game?.endedAt) showGameOverOverlay(gs.game);
}

function renderRoundsTable() {
  const container = $("roundsTable");
  if (!container) return;

  const players = Array.isArray(lastRoomStatus?.players) ? lastRoomStatus.players : [];
  const sortedPlayers = players.slice().sort((a, b) => (a.playerNumber ?? 0) - (b.playerNumber ?? 0));
  const saved = getSaved(getRoomCode());
  const myId = saved?.playerId || null;

  const moves = Array.isArray(lastGameState?.game?.moves) ? lastGameState.game.moves : [];
  const roundsTotal =
    Number.isInteger(lastGameState?.game?.roundsTotal)
      ? lastGameState.game.roundsTotal
      : (Number.isInteger(lastRoomStatus?.roundsPerGame) ? lastRoomStatus.roundsPerGame : 0);

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
    .map(p => {
      const isSelf = myId && p.playerId === myId;
      const headerClass = isSelf ? "player-head self-col" : "player-head";
      return `<th class="${headerClass}"><span class="player-name">${esc(formatName(p.name) || "")}</span></th>`;
    })
    .join("");

  const gameActive = !!(lastGameState?.game?.gameId && !lastGameState?.game?.endedAt);
  const voteActive = !!lastGameState?.game?.votePhase?.active;
  const activePlayerNumber = lastGameState?.game?.nextPlayerNumber ?? null;
  const canShowHourglass = gameActive && !voteActive;
  const rows = [];
  for (let r = 1; r <= roundsTotal; r++) {
    const cells = sortedPlayers
      .map(p => {
        const key = `${r}:${p.playerNumber}`;
        const word = cellMap.get(key) || "";
        const showHourglass =
          canShowHourglass &&
          !word &&
          activePlayerNumber === p.playerNumber &&
          lastGameState?.game?.round === r;
        const isSelf = myId && p.playerId === myId;
        const hourglassClass = isSelf ? "cell-emoji self-col" : "cell-emoji";
        const wordClass = isSelf ? ' class="self-col"' : "";
        if (showHourglass) {
          return `<td class="${hourglassClass}"><span data-tip-hover="${TOOLTIP_WAITING_MOVE}" data-tip-tap="${TOOLTIP_WAITING_MOVE}">⏳</span></td>`;
        }
        return `<td${wordClass}>${esc(word)}</td>`;
      })
      .join("");
    rows.push(`<tr><td class="mono col-round">${r}</td>${cells}</tr>`);
  }

  const triggers = Array.isArray(lastGameState?.game?.votePhase?.triggers)
    ? lastGameState.game.votePhase.triggers
    : [];
  if (triggers.length) {
    const triggerSet = new Set(triggers.map(String));
    const cells = sortedPlayers
      .map(p => {
        const isSelf = myId && p.playerId === myId;
        const cellClass = isSelf ? ' class="cell-emoji self-col"' : ' class="cell-emoji"';
        const content = triggerSet.has(String(p.playerId))
          ? `<span data-tip-hover="${TOOLTIP_READY_VOTE}" data-tip-tap="${TOOLTIP_READY_VOTE}">👍</span>`
          : "";
        return `<td${cellClass}>${content}</td>`;
      })
      .join("");
    rows.push(`<tr><td class="col-round"><strong>Vote?</strong></td>${cells}</tr>`);
  }

  const html = `
    <div class="table-scroll__inner">
      <table class="status-table room-table">
        <thead>
          <tr>
            <th class="col-round">Round</th>
            ${headerCells}
          </tr>
        </thead>
        <tbody>
          ${rows.join("")}
        </tbody>
      </table>
    </div>
  `;
  updateScrollableContainer(container, html);
}

function renderVoteTable() {
  const container = $("voteTable");
  if (!container) return;

  const players = Array.isArray(lastRoomStatus?.players) ? lastRoomStatus.players : [];
  const sortedPlayers = players.slice().sort((a, b) => (a.playerNumber ?? 0) - (b.playerNumber ?? 0));

  const votePhase = lastGameState?.game?.votePhase || null;
  if (!votePhase || (!votePhase.active && !votePhase.startedAt)) {
    const html = `
      <div class="table-scroll__inner">
        Voting will start once enough players are ready.
      </div>
    `;
    updateScrollableContainer(container, html);
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
        ? `${votedFor.playerNumber}. ${esc(formatName(votedFor.name) || "")}`
        : (showVote ? "-" : "");

      const isSelf = myId && p.playerId === myId;
      const checked = myVote && myVote === p.playerId;
      const disabled = !votePhase.active || isSelf;
      const checkbox = isSelf
        ? renderSelfMarker("right")
        : `<input type="checkbox" class="vote-choice" data-target="${p.playerId}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} />`;
      const targetClass = disabled && !isSelf ? "vote-target disabled" : "vote-target";
      const rowClass = isSelf ? "vote-row-self" : "";

      return `
        <tr class="${rowClass}">
          <td class="vote-player">
            <span class="vote-choice-slot">${checkbox}</span>
            <span class="${targetClass}" data-target="${p.playerId}">
              ${p.playerNumber}. ${esc(formatName(p.name) || "")}
            </span>
          </td>
          <td class="vote-status">${votedText}</td>
          <td class="vote-target-name">${targetText}</td>
        </tr>
      `;
    })
    .join("");

  const html = `
    <div class="table-scroll__inner">
      <table class="status-table room-table">
        <thead>
          <tr>
            <th>Players</th>
            <th></th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
  updateScrollableContainer(container, html);
}

function isGameViewActive() {
  const view = $("viewGame");
  return !!view && view.classList.contains("active");
}

function applyRoleTheme() {
  const body = document.body;
  if (!body) return;
  body.classList.remove("role-neutral", "role-legit", "role-faker");

  const game = lastGameState?.game || lastRoomStatus?.game || null;
  const active = !!game?.gameId && !game?.endedAt;
  const roleMatchesGame = !roleState.gameId || roleState.gameId === game?.gameId;
  const inGameView = isGameViewActive();

  let theme = "role-neutral";
  if (inGameView && active && roleMatchesGame && roleState.role === "faker") {
    theme = "role-faker";
  } else if (inGameView && active && roleMatchesGame && roleState.role === "player") {
    theme = "role-legit";
  }

  body.classList.add(theme);
}

function updateGameUI() {
  const roleEl = $("roleLabel");
  const secretEl = $("secretWord");
  const secretRow = $("secretWordRow");
  const secretLabel = $("secretWordLabel");
  const turnEl = $("turnStatus");
  const moveHeader = $("moveHeader");
  const moveInstruction = $("moveInstruction");
  const moveHint = $("moveHint");
  const input = $("moveWord");
  const btn = $("btnSubmitMove");
  const movePanel = $("movePanel");
  const moveEntryPanel = $("moveEntryPanel");
  const gameHeader = $("gameHeader");
  const voteStatus = $("voteStatus");
  const voteTimer = $("voteTimer");
  const triggerBtn = $("btnTriggerVote");
  const voteReadyPanel = $("voteReadyPanel");
  const movesPanel = $("movesPanel");
  const voteSection = $("voteSection");

  const saved = getSaved(getRoomCode());
  const playerNumber = saved?.playerNumber ?? null;

  const role = roleState.role;
  const secret = roleState.secretWord;

  if (roleEl) {
    if (!role) roleEl.textContent = "Waiting for role...";
    else if (role === "faker") roleEl.textContent = "You are the faker";
    else roleEl.textContent = "You are legit";
  }

  if (secretEl) {
    if (!role) {
      if (secretRow) secretRow.classList.add("hidden");
      secretEl.textContent = "";
      secretEl.classList.remove("secret-plain", "label-inline");
      secretEl.classList.add("pill", "mono");
      if (secretLabel) secretLabel.textContent = "Secret word:";
    } else if (role === "faker") {
      if (secretRow) secretRow.classList.remove("hidden");
      if (secretLabel) secretLabel.textContent = "";
      secretEl.textContent = "You do not know the word.";
      secretEl.classList.add("label-inline");
      secretEl.classList.remove("pill", "mono", "secret-plain");
    } else {
      if (secretRow) secretRow.classList.remove("hidden");
      if (secretLabel) secretLabel.textContent = "Secret word:";
      secretEl.textContent = secret || "(waiting for secret word)";
      secretEl.classList.remove("secret-plain", "label-inline");
      secretEl.classList.add("pill", "mono");
    }
  }

  if (moveInstruction) {
    if (role === "faker") {
      moveInstruction.textContent =
        "Blend in. Use a word that could fit the secret.";
    } else if (role === "player") {
      moveInstruction.textContent =
        "Use a word close to the secret so legit players recognize you. Don't be too close, or the faker guesses!";
    } else {
      moveInstruction.textContent = "One word only.";
    }
  }
  const moveLanguage = $("moveLanguageHint");
  if (moveLanguage) {
    moveLanguage.innerHTML = `<span class="meta-label">Language:</span> <span class="meta-value">${esc(getLanguageLabel(getRoomLanguage()))}</span>`;
  }

  const game = lastGameState?.game || lastRoomStatus?.game || null;
  const ended = !!game?.endedAt;
  const nextPlayerNumber = game?.nextPlayerNumber ?? null;
  const votePhase = game?.votePhase || null;
  const gamesTotal = Number.isInteger(lastRoomStatus?.gamesTotal) ? lastRoomStatus.gamesTotal : null;
  const gamesPlayed = Number.isInteger(lastRoomStatus?.gamesPlayed) ? lastRoomStatus.gamesPlayed : 0;
  const gameActive = !!(game?.gameId && !ended);

  if (gameHeader) {
    if (gamesTotal) {
      const currentGameNumber = gameActive ? gamesPlayed + 1 : Math.max(1, gamesPlayed);
      gameHeader.textContent = `Game #${currentGameNumber} of ${gamesTotal}`;
    } else {
      gameHeader.textContent = "";
    }
  }

  if (turnEl) {
    turnEl.textContent = "";
    turnEl.style.display = "none";
  }

  const voteActive = !!votePhase?.active;
  const voteStarted = !!votePhase?.startedAt;
  const voteLive = voteStarted && !votePhase?.endedAt;

  if (movePanel) movePanel.classList.toggle("hidden", voteStarted);
  if (moveEntryPanel) moveEntryPanel.classList.toggle("hidden", voteStarted);
  if (voteReadyPanel) voteReadyPanel.classList.toggle("hidden", voteStarted);
  if (movesPanel) movesPanel.classList.remove("hidden");
  if (voteSection) {
    voteSection.classList.toggle("your-turn", voteLive);
    voteSection.classList.toggle("your-turn-alert", voteLive);
  }

  const isYourTurn =
    !!role &&
    !ended &&
    !voteActive &&
    nextPlayerNumber != null &&
    playerNumber != null &&
    nextPlayerNumber === playerNumber;

  if (submitMoveInFlight && !isYourTurn) {
    submitMoveInFlight = false;
  }

  const canMove = isYourTurn && !submitMoveInFlight;
  setMoveTurnActive(moveEntryPanel, isYourTurn);

  if (input) input.disabled = !canMove;
  if (btn) btn.disabled = !canMove;
  if (moveHeader) {
    if (isYourTurn) {
      moveHeader.textContent = "Your move!";
    } else if (nextPlayerNumber != null) {
      const players = Array.isArray(lastRoomStatus?.players) ? lastRoomStatus.players : [];
      const next = players.find(p => p.playerNumber === nextPlayerNumber);
      const name = next?.name ? ` ${formatName(next.name)}` : "";
      moveHeader.textContent = `Waiting for player #${nextPlayerNumber}${name}`;
    } else {
      moveHeader.textContent = "Your move";
    }
  }
  if (moveHint) {
    moveHint.textContent = canMove
      ? ""
      : (voteActive ? "Voting is in progress." : "");
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
      voteStatus.textContent = "Voting in progress.";
    } else {
      voteStatus.textContent = "Voting complete.";
    }
  }

  const voteDetails = $("voteDetails");
  if (voteDetails) {
    const showDetails = !!votePhase?.startedAt;
    voteDetails.classList.toggle("hidden", !showDetails);
  }

  if (triggerBtn) {
    const saved = getSaved(getRoomCode());
    const myId = saved?.playerId || null;
    const triggers = Array.isArray(votePhase?.triggers) ? votePhase.triggers : [];
    const alreadyTriggered = myId ? triggers.includes(myId) : false;
    triggerBtn.disabled = voteTriggerInFlight || !!votePhase?.active || !!ended || alreadyTriggered;
    triggerBtn.classList.toggle("pressed", alreadyTriggered || voteTriggerInFlight);
    if (role === "faker") {
      triggerBtn.textContent = "I'm ready to accuse";
    } else {
      triggerBtn.textContent = "I know who's faker!";
    }
  }

  const voteReadyHint = $("voteReadyHint");
  if (voteReadyHint) {
    const saved = getSaved(getRoomCode());
    const myId = saved?.playerId || null;
    const triggers = Array.isArray(votePhase?.triggers) ? votePhase.triggers : [];
    const alreadyTriggered = myId ? triggers.includes(myId) : false;
    voteReadyHint.textContent = alreadyTriggered
      ? "Voting will start once enough players are ready."
      : "Click if you are ready to vote early!";
  }

  const voteChangeHint = $("voteChangeHint");
  if (voteChangeHint) {
    const saved = getSaved(getRoomCode());
    const myId = saved?.playerId || null;
    const myVote = myId ? votePhase?.votes?.[myId] || null : null;
    voteChangeHint.textContent =
      voteActive && myVote ? "There's still time to change your mind!" : "";
  }

  updateVoteTimer(votePhase);
  applyRoleTheme();
  updateTitle();
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

function setNameError(show, message = getUiError("NAME_REQUIRED", "Name is required")) {
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
  if (raw) return raw;
  if (status === 404) return "Room not found";
  return `Join failed (${status})`;
}

function updateNameError() {
  const input = $("playerName");
  if (!input) return;
  const value = String(input.value || "").trim();
  if (value.length > MAX_NAME_LENGTH) {
    setNameError(true, `Name too long (max ${MAX_NAME_LENGTH} chars)`);
  } else if (nameTouched) {
    setNameError(!value, getUiError("NAME_REQUIRED", "Name is required"));
  } else {
    setNameError(false);
  }

  const canUse = !!value && value.length <= MAX_NAME_LENGTH;
  const btnCreate = $("btnCreateRoom");
  const btnJoin = $("btnJoinRoom");
  if (btnCreate && !createInFlight) btnCreate.disabled = !canUse;
  if (btnJoin && !createInFlight) btnJoin.disabled = !canUse;
}

function updatePlayerBadge() {
  const roomCode = getRoomCode();
  const saved = roomCode ? getSaved(roomCode) : null;
  const name = formatName(saved?.name);
  const number = Number.isInteger(saved?.playerNumber) ? saved.playerNumber : null;
  const text = name
    ? (number != null ? `Player #${number}: ${name}` : `Player: ${name}`)
    : "";

  const badges = [$("playerBadge"), $("playerBadgeGame")];
  for (const badge of badges) {
    if (!badge) continue;
    badge.textContent = text;
    badge.classList.toggle("hidden", !text);
  }
}

function updateRejoinButton() {
  const btn = $("btnRejoinRoom");
  if (!btn) return;
  const lastRoom = getLastRoomCode();
  const saved = lastRoom ? getSaved(lastRoom) : null;
  const canRejoin = !!(saved && saved.playerId && saved.playerNumber);
  btn.classList.toggle("hidden", !canRejoin);
}

function updateLobbyMode(nextMode = null) {
  if (nextMode !== null) lobbyMode = nextMode;
  if (nextMode === null) lobbyMode = null;

  const isCreate = lobbyMode === "create";
  const isJoin = lobbyMode === "join";

  const btnCreate = $("btnCreateRoom");
  const btnJoin = $("btnJoinRoom");
  const btnBack = $("btnBackLobby");
  const btnRejoin = $("btnRejoinRoom");
  const createPanel = $("createSettings");
  const joinPanel = $("joinRoomCode");

  if (btnCreate) btnCreate.classList.toggle("hidden", isJoin);
  if (btnJoin) btnJoin.classList.toggle("hidden", isCreate);
  if (btnBack) btnBack.classList.toggle("hidden", !lobbyMode);
  if (btnRejoin) btnRejoin.classList.toggle("hidden", !!lobbyMode);

  if (createPanel) createPanel.classList.toggle("hidden", !isCreate);
  if (joinPanel) joinPanel.classList.toggle("hidden", !isJoin);
  updateRejoinButton();
  setActionError(false);
}

function setLobbyDisabled(disabled) {
  const ids = ["btnCreateRoom", "btnJoinRoom", "btnBackLobby", "btnRejoinRoom"];
  for (const id of ids) {
    const el = $(id);
    if (el) el.disabled = disabled;
  }
  const nameInput = $("playerName");
  if (nameInput) nameInput.disabled = disabled;
  const roomInput = $("roomCode");
  if (roomInput) roomInput.disabled = disabled;
}

function setOverlayTheme(role) {
  const overlay = $("overlay");
  if (!overlay) return;
  overlay.classList.remove("role-neutral", "role-legit", "role-faker");
  let theme = "role-neutral";
  if (role === "faker") theme = "role-faker";
  else if (role === "player") theme = "role-legit";
  overlay.classList.add(theme);
}

function showStartOverlay(gameId) {
  if (!gameId) return;
  if (!startOverlay || (startOverlay.gameId && startOverlay.gameId !== gameId)) {
    startOverlay = { gameId, startedAt: Date.now() };
  } else if (!startOverlay.gameId) {
    startOverlay.gameId = gameId;
  }
  setOverlayTheme(null);
  showOverlay("Starting game...", "", null, null, false);
  setTimeout(() => {
    maybeHideStartOverlay();
  }, START_OVERLAY_MIN_MS);
}

function maybeHideStartOverlay() {
  if (!startOverlay) return;
  const ready = lastGameState?.game?.gameId === startOverlay.gameId;
  const elapsed = Date.now() - startOverlay.startedAt;
  if (ready && elapsed >= START_OVERLAY_MIN_MS) {
    hideOverlay();
    startOverlay = null;
    startOverlayPending = false;
  }
}

function scheduleStartOverlayAfterGameOver(nextGameId) {
  if (!gameOverOverlay) {
    showStartOverlay(nextGameId);
    return;
  }
  if (gameOverDismissTimer) clearTimeout(gameOverDismissTimer);
  const elapsed = Date.now() - gameOverOverlay.shownAt;
  const delay = Math.max(0, GAME_OVER_MIN_MS - elapsed);
  gameOverDismissTimer = setTimeout(() => {
    gameOverDismissTimer = null;
    if (gameOverOverlay) {
      hideOverlay();
      gameOverOverlay = null;
    }
    showStartOverlay(nextGameId);
  }, delay);
}

function showOverlay(
  message,
  actionLabel = "",
  actionFn = null,
  cancelFn = cancelCreate,
  showCancel = true
) {
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
  if (cancel) {
    if (showCancel) {
      cancel.classList.remove("hidden");
      cancel.onclick = () => cancelFn && cancelFn();
    } else {
      cancel.classList.add("hidden");
      cancel.onclick = null;
    }
  }
}

function showOverlayChoice(
  message,
  primaryLabel,
  primaryFn,
  secondaryLabel,
  secondaryFn,
  dismissFn = null,
  themeRole = null
) {
  const overlay = $("overlay");
  const msg = $("overlayMessage");
  const primary = $("overlayPrimary");
  const secondary = $("overlaySecondary");
  const choice = $("overlayChoice");
  const buttons = $("overlayButtons");
  if (!overlay || !msg || !primary || !secondary) return;
  setOverlayTheme(themeRole);
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
  if (overlay) {
    overlay.classList.add("hidden");
    overlay.classList.remove("role-neutral", "role-legit", "role-faker");
  }
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
  setLobbyDisabled(false);
  hideOverlay();
  createState = { roomCode: null, retries: 0 };
}

async function waitForVoteTrigger(roomCode, playerId, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await fetchGameState({ silent: true });
    const triggers = lastGameState?.game?.votePhase?.triggers || [];
    if (triggers.includes(playerId)) return true;
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

async function joinRoom(options = {}) {
  const roomCode = getRoomCode();
  const name = normalizeName($("playerName")?.value || "");
  const skipLobbyGate = !!options.skipLobbyGate;
  const allowNameMismatch = !!options.allowNameMismatch;
  const ignoreExistingRoom = !!options.ignoreExistingRoom;
  const queueAfterJoin = !!options.queueAfterJoin;
  if (lastJoinError === "name_mismatch") {
    cancelJoinInFlight();
    lastJoinError = null;
    setNameError(false);
    setActionError(false);
  }
  const now = Date.now();
  if (joinInFlight && joinInFlightStartedAt && now - joinInFlightStartedAt > 9000) {
    joinInFlight = null;
    joinInFlightStartedAt = 0;
  }

  if (joinInFlight) {
    log({ note: "Join already in progress; ignoring extra click" }, "joinRoom");
    setActionError(
      true,
      getUiError("JOIN_IN_PROGRESS", "Join already in progress. Please wait.")
    );
    if (queueAfterJoin) {
      try {
        await joinInFlight;
      } catch {
        // Ignore join errors and retry
      }
      return joinRoom({ ...options, queueAfterJoin: false });
    }
    return joinInFlight;
  }

  if (!skipLobbyGate && lobbyMode !== "join") {
    updateLobbyMode("join");
    $("roomCode")?.focus();
    return;
  }

  if (!roomCode) {
    setActionError(
      true,
      getUiError("ENTER_ROOM_CODE_TO_JOIN", "Enter a room code to join.")
    );
    $("roomCode")?.focus();
    return;
  }
  if (roomCode.length !== ROOM_CODE_LENGTH) {
    setActionError(true, "Invalid room code.");
    $("roomCode")?.focus();
    return;
  }

  if (!skipLobbyGate && !name) {
    nameTouched = true;
    updateNameError();
    setActionError(true, getUiError("NAME_REQUIRED", "Name is required"));
    $("playerName")?.focus();
    return;
  }
  if (name && name.length > MAX_NAME_LENGTH) {
    const message = `Name too long (max ${MAX_NAME_LENGTH} chars)`;
    nameTouched = true;
    setNameError(true, message);
    setActionError(true, message);
    $("playerName")?.focus();
    return;
  }

  if (!skipLobbyGate && !ignoreExistingRoom) {
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
        await joinRoom({ skipLobbyGate: true, allowNameMismatch: true, ignoreExistingRoom: true });
        return;
      } else {
        return;
      }
    }
  }

  if (!skipLobbyGate) {
    setLobbyDisabled(true);
    showOverlay("Joining room...");
  }

  const precheck = await postJSON("/.netlify/functions/roomStatus", { roomCode });
  if (precheck.status === 404) {
    setActionError(true, "Room not found");
    if (!skipLobbyGate) {
      hideOverlay();
      setLobbyDisabled(false);
    }
    log({ status: precheck.status, ...precheck.data }, "joinRoom");
    return;
  }
  setActionError(false);

  const saved = ensureLocalIdentity(roomCode);
  if (saved.playerId && saved.playerNumber) {
    const savedName = normalizeName(saved.name || "");
    if (!allowNameMismatch && savedName && name && savedName !== name) {
      setNameError(true, "Name does not match saved player for this room.");
      $("playerName")?.focus();
      lastJoinError = "name_mismatch";
      if (!skipLobbyGate) {
        hideOverlay();
        setLobbyDisabled(false);
      }
      log({ error: "Name does not match saved player for this room" }, "joinRoom");
      return;
    }

    const attemptId = ++joinAttemptId;
    joinInFlightStartedAt = Date.now();
    joinInFlight = (async () => {
      try {
        setLastRoomCode(roomCode);
        log({ roomCode, ...getSaved(roomCode) }, "joinRoom (reused local identity)");
        lastJoinError = null;
        await roomStatus("roomStatus (already joined)");
        startPolling();
        setView("viewRoom");
        if (!skipLobbyGate) {
          hideOverlay();
          setLobbyDisabled(false);
        }
      } finally {
        if (attemptId === joinAttemptId) {
          joinInFlight = null;
          joinInFlightStartedAt = 0;
        }
      }
    })();
    return joinInFlight;
  }

  const attemptId = ++joinAttemptId;
  joinInFlightStartedAt = Date.now();
  joinInFlight = (async () => {
    try {
      const isStale = () => attemptId !== joinAttemptId;

      if (!name) {
        if (isStale()) return;
        nameTouched = true;
        updateNameError();
        $("playerName")?.focus();
        if (!skipLobbyGate) {
          hideOverlay();
          setLobbyDisabled(false);
        }
        log(
          { error: getUiError("NAME_REQUIRED", "Name is required") },
          "joinRoom"
        );
        return;
      }
      if (name.length > MAX_NAME_LENGTH) {
        if (isStale()) return;
        const message = `Name too long (max ${MAX_NAME_LENGTH} chars)`;
        nameTouched = true;
        setNameError(true, message);
        setActionError(true, message);
        $("playerName")?.focus();
        log({ error: message }, "joinRoom");
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
        if (isStale()) return;
        setActionError(false);
        lastJoinError = null;
        setSaved(roomCode, {
          ...saved,
          playerId: data.playerId,
          playerNumber: data.playerNumber,
          name: data.name || name || saved.name || null
        });
        setLastRoomCode(roomCode);

        await roomStatus("roomStatus (after join)");
        startPolling();
        setView("viewRoom");
        if (!skipLobbyGate) {
          hideOverlay();
          setLobbyDisabled(false);
        }
      } else if (status !== 200) {
        if (isStale()) return;
        setActionError(true, friendlyJoinError(data, status));
        lastJoinError = "other";
        if (!skipLobbyGate) {
          hideOverlay();
          setLobbyDisabled(false);
        }
      }
    } catch (err) {
      log({ error: String(err), stack: err?.stack || null }, "joinRoom (exception)");
      if (!skipLobbyGate) {
        hideOverlay();
        setLobbyDisabled(false);
      }
    } finally {
      if (attemptId === joinAttemptId) {
        joinInFlight = null;
        joinInFlightStartedAt = 0;
      }
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
    log(
      { error: getUiError("NAME_REQUIRED", "Name is required") },
      "createRoom"
    );
    return;
  }
  if (name.length > MAX_NAME_LENGTH) {
    const message = `Name too long (max ${MAX_NAME_LENGTH} chars)`;
    nameTouched = true;
    setNameError(true, message);
    $("playerName")?.focus();
    log({ error: message }, "createRoom");
    return;
  }

  if (lobbyMode !== "create") {
    updateLobbyMode("create");
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
        await joinRoom({ skipLobbyGate: true, allowNameMismatch: true, ignoreExistingRoom: true });
        return;
      } else {
        return;
      }
    }
  }

  if (createInFlight) return;
  createInFlight = true;
  createAbort = false;
  setLobbyDisabled(true);
  showOverlay("Creating room...");

  const waitForRoom = async roomCode => {
    const deadline = Date.now() + CREATE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (createAbort) return false;
      const res = await postJSON("/.netlify/functions/roomStatus", { roomCode });
      if (res.status === 200) return true;
      await new Promise(r => setTimeout(r, POST_ACTION_DELAY_MS));
    }
    return false;
  };

  const createAndWait = async reuseExisting => {
    if (createAbort) return false;
    if (!reuseExisting || !createState.roomCode) {
      const playerCount = Number($("playerCount")?.value);
      const language = String($("roomLanguage")?.value || "en");
      const gamesTotal = Number($("gamesTotal")?.value);
      const roundsPerGame = Number($("roundsPerGame")?.value);

      const payload = { playerCount, language, gamesTotal, roundsPerGame };

      const { status, data } = await postJSON("/.netlify/functions/createRoom", payload);
      log({ status, ...data }, "createRoom");

      if (status !== 200) {
        const message = data?.error ? String(data.error) : `Create failed (${status})`;
        setActionError(true, message);
        hideOverlay();
        setLobbyDisabled(false);
        createInFlight = false;
        return false;
      }

      if (!data.roomCode) {
        setActionError(true, "Create failed (missing room code)");
        hideOverlay();
        setLobbyDisabled(false);
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
        await joinRoom({ skipLobbyGate: true });
      } else {
        await roomStatus("roomStatus (after create)");
        startPolling();
      }

      setView("viewRoom");
      hideOverlay();
      setLobbyDisabled(false);
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
  if (!roomCode) {
    return log(
      { error: getUiError("ENTER_ROOM_CODE_FIRST", "Enter room code first") },
      "submitWords"
    );
  }

  const saved = getSaved(roomCode);
  if (!saved?.playerId) {
    return log(
      { error: getUiError("NOT_JOINED_BROWSER", "Not joined on this browser yet") },
      "submitWords"
    );
  }
  if (submitWordsInFlight) return;

  const required = Number.isInteger(lastRoomStatus?.wordsRequired)
    ? lastRoomStatus.wordsRequired
    : null;
  const current = getAcceptedWords(roomCode);
  if (required != null && current.length >= required) {
    setSubmitWordsError("All words submitted.");
    return;
  }

  const words = getSingleWordSubmission();
  if (!words.length) {
    return log(
      { error: getUiError("ENTER_WORD", "Enter a word") },
      "submitWords"
    );
  }
  if (!isWithinWordLength(words[0])) {
    const message = `Word too long (max ${MAX_WORD_LENGTH} chars)`;
    setSubmitWordsError(message);
    return log({ error: message }, "submitWords");
  }
  if (!isAllowedWord(words[0])) {
    setSubmitWordsError(getWordRuleHint());
    return;
  }

  setSubmitWordsError("");

  const input = $("wordInput");
  const btn = $("btnSubmitWords");
  const shouldDisableAfterSubmit =
    required != null && current.length + words.length >= required;

  submitWordsInFlight = true;
  if (input) input.disabled = true;
  if (btn) btn.disabled = true;
  if (shouldDisableAfterSubmit && input) input.value = "";

  const { status, data } = await postJSON("/.netlify/functions/submitWords", {
    roomCode,
    playerId: saved.playerId,
    words
  });
  log({ status, ...data }, "submitWords");

  if (status === 200) {
    if (input && data.accepted?.length && !shouldDisableAfterSubmit) input.value = "";
    const existing = getAcceptedWords(roomCode);
    const merged = [...existing];
    for (const w of data.accepted || []) {
      if (!merged.includes(w)) merged.push(w);
    }
    const capped = Number.isInteger(data.required) ? merged.slice(0, data.required) : merged;
    setAcceptedWords(roomCode, capped);
    if (Array.isArray(data.duplicates) && data.duplicates.length) {
      const reasonMap = {
        invalid_format: "invalid format",
        too_long: "too long",
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
    if (Number.isInteger(data?.remaining) && data.remaining > 0) {
      if (input) input.disabled = false;
      if (btn) btn.disabled = false;
    }
  } else if (data?.error) {
    setSubmitWordsError(String(data.error));
    if (input) input.disabled = false;
    if (btn) btn.disabled = false;
  }

  submitWordsInFlight = false;
}

async function submitWordsBulk() {
  const roomCode = getRoomCode();
  if (!roomCode) {
    return log(
      { error: getUiError("ENTER_ROOM_CODE_FIRST", "Enter room code first") },
      "submitWordsBulk"
    );
  }

  const saved = getSaved(roomCode);
  if (!saved?.playerId) {
    return log(
      { error: getUiError("NOT_JOINED_BROWSER", "Not joined on this browser yet") },
      "submitWordsBulk"
    );
  }
  if (submitWordsInFlight) return;

  const words = getBulkWordSubmission();
  if (!words.length) {
    return log(
      { error: getUiError("ENTER_AT_LEAST_ONE_WORD", "Enter at least one word") },
      "submitWordsBulk"
    );
  }
  const tooLong = words.filter(word => !isWithinWordLength(word));
  if (tooLong.length) {
    const message = `Word too long (max ${MAX_WORD_LENGTH} chars)`;
    setSubmitWordsError(message);
    return log({ error: message }, "submitWordsBulk");
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

  submitWordsInFlight = true;
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
    const capped = Number.isInteger(data.required) ? merged.slice(0, data.required) : merged;
    setAcceptedWords(roomCode, capped);
    if (Array.isArray(data.duplicates) && data.duplicates.length) {
      const reasonMap = {
        invalid_format: "invalid format",
        too_long: "too long",
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
  } else if (data?.error) {
    setSubmitWordsError(String(data.error));
  }
  submitWordsInFlight = false;
}

async function startGame() {
  const roomCode = getRoomCode();
  if (!roomCode) {
    return log(
      { error: getUiError("ENTER_ROOM_CODE_FIRST", "Enter room code first") },
      "startGame"
    );
  }

  const saved = getSaved(roomCode);
  if (!saved?.playerId) {
    return log(
      { error: getUiError("NOT_JOINED", "Not joined") },
      "startGame"
    );
  }

  if (startInFlight) return;
  startInFlight = true;
  startOverlayPending = true;
  startOverlay = { gameId: null, startedAt: Date.now() };
  showOverlay("Starting game...", "", null, null, false);

  const { status, data } = await postJSON("/.netlify/functions/startGame", {
    roomCode,
    playerId: saved.playerId
  });
  log({ status, ...data }, "startGame");

  startInFlight = false;
  applyRoomStatus(lastRoomStatus);

  if (status !== 200 && data?.error) {
    startOverlayPending = false;
    hideOverlay();
    showOverlayChoice(
      String(data.error),
      "OK",
      () => hideOverlay(),
      "Close",
      () => hideOverlay(),
      () => hideOverlay()
    );
    return;
  }

  await new Promise(r => setTimeout(r, POST_ACTION_DELAY_MS));
  await roomStatus("roomStatus (after startGame)");
}

async function startShortGame() {
  const roomCode = getRoomCode();
  if (!roomCode) {
    return log(
      { error: getUiError("ENTER_ROOM_CODE_FIRST", "Enter room code first") },
      "startShortGame"
    );
  }

  const saved = getSaved(roomCode);
  if (!saved?.playerId) {
    return log(
      { error: getUiError("NOT_JOINED", "Not joined") },
      "startShortGame"
    );
  }

  const currentPlayers =
    lastRoomStatus?.currentPlayers ??
    (Array.isArray(lastRoomStatus?.players) ? lastRoomStatus.players.length : null);
  const maxPlayers =
    lastRoomStatus?.effectiveMaxPlayers ??
    lastRoomStatus?.maxPlayers ??
    null;

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

  if (startInFlight) return;
  startInFlight = true;
  startOverlayPending = true;
  startOverlay = { gameId: null, startedAt: Date.now() };
  showOverlay("Starting game...", "", null, null, false);

  const { status, data } = await postJSON("/.netlify/functions/startGame", {
    roomCode,
    playerId: saved.playerId,
    startShort: true
  });
  log({ status, ...data }, "startShortGame");

  startInFlight = false;
  applyRoomStatus(lastRoomStatus);

  if (status !== 200 && data?.error) {
    startOverlayPending = false;
    hideOverlay();
    showOverlayChoice(
      String(data.error),
      "OK",
      () => hideOverlay(),
      "Close",
      () => hideOverlay(),
      () => hideOverlay()
    );
    return;
  }

  await new Promise(r => setTimeout(r, POST_ACTION_DELAY_MS));
  await roomStatus("roomStatus (after startShortGame)");
}

async function submitMove() {
  const roomCode = getRoomCode();
  if (!roomCode) {
    return log(
      { error: getUiError("ENTER_ROOM_CODE_FIRST", "Enter room code first") },
      "submitMove"
    );
  }

  const saved = getSaved(roomCode);
  if (!saved?.playerId) {
    return log(
      { error: getUiError("NOT_JOINED", "Not joined") },
      "submitMove"
    );
  }
  if (submitMoveInFlight) return;

  const raw = String($("moveWord")?.value || "");
  const word = normalizeWord(raw);
  if (!word) {
    return log(
      { error: getUiError("ENTER_WORD", "Enter a word") },
      "submitMove"
    );
  }
  if (!isWithinWordLength(word)) {
    const message = `Word too long (max ${MAX_WORD_LENGTH} chars)`;
    setMoveError(message);
    return log({ error: message }, "submitMove");
  }
  if (!isAllowedWord(word)) {
    const hint = getWordRuleHint();
    setMoveError(hint);
    return log({ error: hint }, "submitMove");
  }
  setMoveError("");

  if (roleState.role === "player" && roleState.secretWord) {
    const secret = normalizeWord(roleState.secretWord);
    if (word === secret) {
      setMoveError("You cannot use the secret word.");
      return log({ error: "You cannot use the secret word" }, "submitMove");
    }
  }

  submitMoveInFlight = true;
  const input = $("moveWord");
  const btn = $("btnSubmitMove");
  if (input) input.disabled = true;
  if (btn) btn.disabled = true;

  const { status, data } = await postJSON("/.netlify/functions/submitMove", {
    roomCode,
    playerId: saved.playerId,
    word
  });

  log({ status, ...data }, "submitMove");

  const success = status === 200;

  if (!success && data?.error) {
    setMoveError(String(data.error));
    submitMoveInFlight = false;
    updateGameUI();
  } else if (success) {
    setMoveError("");
    if (input) input.value = "";
  }

  await new Promise(r => setTimeout(r, POST_ACTION_DELAY_MS));
  await roomStatus("roomStatus (after submitMove)");

  if (success) updateGameUI();
}

async function triggerVote() {
  const roomCode = getRoomCode();
  if (!roomCode) return;

  const saved = getSaved(roomCode);
  if (!saved?.playerId) return;
  if (voteTriggerInFlight) return;

  const ok = await new Promise(resolve => {
    showOverlayChoice(
      "Are you ready to vote early?\nOnce enough players are ready, voting will start",
      "I'm ready!",
      () => resolve(true),
      "No",
      () => resolve(false),
      () => resolve(false),
      roleState.role || null
    );
  });
  hideOverlay();
  if (!ok) return;

  voteTriggerInFlight = true;
  updateGameUI();
  showOverlay("Just a moment...", "", null, null, false);
  try {
    const { status, data } = await postJSON("/.netlify/functions/triggerVote", {
      roomCode,
      playerId: saved.playerId
    });
    log({ status, ...data }, "triggerVote");
    await waitForVoteTrigger(roomCode, saved.playerId);
  } finally {
    voteTriggerInFlight = false;
    hideOverlay();
    updateGameUI();
  }
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
  clearActiveGameSession();
  lastGameOverKey = null;
  matchEndShown = false;
  stopPolling();

  setView("viewLobby");
}

function handleKicked(roomCode) {
  clearSaved(roomCode);
  clearLastRoomCode();
  setRoomCode("");
  renderAcceptedWords(roomCode);
  setSubmitWordsError("");
  roleState = { role: null, secretWord: null, gameId: null };
  lastRoomStatus = null;
  lastGameState = null;
  clearActiveGameSession();
  lastGameOverKey = null;
  matchEndShown = false;
  stopPolling();
  setView("viewLobby");
}

async function leaveRoomAfterMatchEnd() {
  const roomCode = getRoomCode();
  if (!roomCode) return;

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
  clearActiveGameSession();
  lastGameOverKey = null;
  matchEndShown = false;
  stopPolling();
  hideOverlay();

  setView("viewLobby");
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
  clearActiveGameSession();
  lastGameOverKey = null;
  matchEndShown = false;
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

function metaPair(label, value) {
  return `<span class="meta-label">${esc(label)}</span> <span class="meta-value">${esc(value)}</span>`;
}

function metaJoin(parts) {
  return parts.join('<span class="meta-sep"> • </span>');
}

function formatName(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function wireUI() {
  restoreLogs();
  restoreActiveGameSession();
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
    cancelJoinInFlight();
    setRoomCode(lastRoom);
    const nameInput = $("playerName");
    if (nameInput && saved.name) nameInput.value = saved.name;
    await joinRoom({ skipLobbyGate: true, allowNameMismatch: true, queueAfterJoin: true });
  });
  $("btnBackLobby")?.addEventListener("click", () => updateLobbyMode(null));
  $("btnLeaveRoom")?.addEventListener("click", leaveRoom);
  $("btnSubmitWords")?.addEventListener("click", submitWords);
  $("btnDoneWords")?.addEventListener("click", markWordsDone);
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

  const nameInput = $("playerName");
  if (nameInput) nameInput.maxLength = MAX_NAME_LENGTH;
  nameInput?.addEventListener("input", () => {
    if (lastJoinError === "name_mismatch") {
      cancelJoinInFlight();
      lastJoinError = null;
      setNameError(false);
      setActionError(false);
    }
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

  const roomInput = $("roomCode");
  if (roomInput) roomInput.maxLength = ROOM_CODE_LENGTH;
  roomInput?.addEventListener("input", e => {
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

  for (const id of ["playerCount", "gamesTotal", "roundsPerGame"]) {
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

  const submittedEditor = $("submittedWordsEditor");
  if (submittedEditor) {
    submittedEditor.addEventListener("click", async e => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const raw = btn.getAttribute("data-word");
      if (!raw) return;
      const word = decodeURIComponent(raw);
      const roomCode = getRoomCode();
      const current = getAcceptedWords(roomCode);
      const next = current.filter(w => normalizeWord(w) !== normalizeWord(word));
      const required = Number.isInteger(lastRoomStatus?.wordsRequired)
        ? lastRoomStatus.wordsRequired
        : null;
      if (required != null && next.length < required) {
        const doneBtn = $("btnDoneWords");
        if (doneBtn) doneBtn.classList.add("hidden");
      }

      if (btn.classList.contains("word-edit")) {
        await updateMyWords(next);
        const input = $("wordInput");
        if (input) {
          input.value = word;
          input.focus();
        }
        return;
      }

      if (btn.classList.contains("word-delete")) {
        await updateMyWords(next);
      }
    });
  }

  $("wordInput")?.addEventListener("focus", () => setActionHint("btnSubmitWords"));
  $("wordInput")?.addEventListener("blur", clearActionHints);


  $("moveWord")?.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    submitMove();
  });

  $("moveWord")?.addEventListener("focus", () => setActionHint("btnSubmitMove"));
  $("moveWord")?.addEventListener("blur", clearActionHints);

  const btnCopyRoomCode = $("btnCopyRoomCode");
  if (btnCopyRoomCode) btnCopyRoomCode.dataset.tipHover = TOOLTIP_COPY_CODE;
  const btnCopyRoomLink = $("btnCopyRoomLink");
  if (btnCopyRoomLink) btnCopyRoomLink.dataset.tipHover = TOOLTIP_COPY_LINK;
  const btnCopyRoomCodeGame = $("btnCopyRoomCodeGame");
  if (btnCopyRoomCodeGame) btnCopyRoomCodeGame.dataset.tipHover = TOOLTIP_COPY_CODE;
  const btnCopyRoomLinkGame = $("btnCopyRoomLinkGame");
  if (btnCopyRoomLinkGame) btnCopyRoomLinkGame.dataset.tipHover = TOOLTIP_COPY_LINK;

  $("btnCopyRoomCode")?.addEventListener("click", async () => {
    const value = String($("roomCodeDisplay")?.textContent || "").trim();
    if (!value) return;
    showTooltip($("btnCopyRoomCode"), TOOLTIP_CODE_COPIED, true);
    try {
      await navigator.clipboard.writeText(value);
      showRoomCopyNotice("Code copied!");
    } catch {
      // Ignore clipboard failures (e.g., permissions)
    }
  });

  $("btnCopyRoomLink")?.addEventListener("click", async () => {
    const value = String($("roomCodeDisplay")?.textContent || "").trim();
    if (!value) return;
    const invite = getInviteUrl(value);
    if (!invite) return;
    showTooltip($("btnCopyRoomLink"), TOOLTIP_LINK_COPIED, true);
    try {
      await navigator.clipboard.writeText(invite);
      showRoomCopyNotice("Link copied!");
    } catch {
      // Ignore clipboard failures (e.g., permissions)
    }
  });

  $("btnCopyRoomCodeGame")?.addEventListener("click", async () => {
    const value = String($("roomCodeGame")?.textContent || "").trim();
    if (!value) return;
    showTooltip($("btnCopyRoomCodeGame"), TOOLTIP_CODE_COPIED, true);
    try {
      await navigator.clipboard.writeText(value);
      showRoomCopyNotice("Code copied!");
    } catch {
      // Ignore clipboard failures (e.g., permissions)
    }
  });

  $("btnCopyRoomLinkGame")?.addEventListener("click", async () => {
    const value = String($("roomCodeGame")?.textContent || "").trim();
    if (!value) return;
    const invite = getInviteUrl(value);
    if (!invite) return;
    showTooltip($("btnCopyRoomLinkGame"), TOOLTIP_LINK_COPIED, true);
    try {
      await navigator.clipboard.writeText(invite);
      showRoomCopyNotice("Link copied!");
    } catch {
      // Ignore clipboard failures (e.g., permissions)
    }
  });

  document.addEventListener("pointerover", event => {
    if (!isHoverCapable()) return;
    if (event.pointerType && event.pointerType !== "mouse") return;
    const target = event.target?.closest?.("[data-tip-hover]");
    if (!target) return;
    if (Date.now() < tooltipState.lockedUntil && tooltipState.target === target) return;
    showTooltip(target, target.dataset.tipHover);
  });

  document.addEventListener("pointerout", event => {
    if (!isHoverCapable()) return;
    if (event.pointerType && event.pointerType !== "mouse") return;
    const target = event.target?.closest?.("[data-tip-hover]");
    if (!target) return;
    if (Date.now() < tooltipState.lockedUntil && tooltipState.target === target) return;
    const related = event.relatedTarget;
    if (related && target.contains(related)) return;
    hideTooltip();
  });

  document.addEventListener("pointerup", event => {
    if (isHoverCapable()) return;
    const target = event.target?.closest?.("[data-tip-tap]");
    if (!target) return;
    showTooltip(target, target.dataset.tipTap, true);
  });

  const shouldSuppressHide = () => Date.now() - tooltipState.shownAt < 400;
  window.addEventListener("scroll", () => {
    if (shouldSuppressHide()) return;
    hideTooltip();
  }, true);
  window.addEventListener("resize", () => {
    if (shouldSuppressHide()) return;
    hideTooltip();
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

  const playersList = $("playersList");
  if (playersList) {
    playersList.addEventListener("click", async e => {
      const btn = e.target.closest?.(".kick-player");
      if (!btn) return;
      const playerId = btn.getAttribute("data-player-id");
      const playerNumber = btn.getAttribute("data-player-number");
      const playerName = btn.getAttribute("data-player-name");
      if (!playerId) return;
      const numberLabel = playerNumber ? `player #${playerNumber}` : "this player";
      const nameLabel = playerName ? ` (${playerName})` : "";
      const label = `Remove ${numberLabel}${nameLabel} from the room?`;
      const choice = await new Promise(resolve => {
        showOverlayChoice(
          label,
          "Kick player",
          () => resolve(true),
          "Cancel",
          () => resolve(false),
          () => resolve(false)
        );
      });
      hideOverlay();
      if (!choice) return;
      await kickPlayer(playerId);
    });
  }

  renderLocal(getRoomCode());
  refreshTableScrollableFlags();
  window.addEventListener("resize", refreshTableScrollableFlags);
  window.addEventListener("load", refreshTableScrollableFlags);
  setView("viewLobby");
  updateLobbyMode(null);
  const roomParam = params.get("room");
  if (roomParam) {
    setRoomCode(roomParam);
    updateLobbyMode("join");
  }
  updateNameError();
  updateRejoinButton();
  initOverlayDismissal();
  if (document.body.classList.contains("debug")) {
    renderLogBuffer();
  }

  const build = $("buildVersion");
  if (build) {
    build.textContent = `v${APP_VERSION} • build (local)`;
    fetch("./build.txt", { cache: "no-store" })
      .then(res => (res.ok ? res.text() : null))
      .then(text => {
        if (!text) return;
        build.textContent = `v${APP_VERSION} • build ${text.trim()}`;
      })
      .catch(() => {});
  }
}

wireUI();
