// export const VOTE_TOTAL_SECONDS = 30; // Production
export const VOTE_TOTAL_SECONDS = 300;  // For testing
export const VOTE_FINAL_SECONDS = 5;

export function initVotePhase() {
  return {
    active: false,
    startedAt: null,
    endsAt: null,
    endedAt: null,
    triggers: [],
    votes: {}
  };
}

export function ensureScores(players) {
  for (const p of players) {
    if (!Number.isInteger(p.score)) p.score = 0;
  }
}

export function finalizeGameEnd(room, nowIso) {
  const gamesTotal = Number.isInteger(room.gamesTotal) ? room.gamesTotal : null;
  const gamesPlayed = Number.isInteger(room.gamesPlayed) ? room.gamesPlayed : 0;
  room.gamesPlayed = gamesPlayed + 1;
  if (gamesTotal != null && room.gamesPlayed >= gamesTotal) {
    room.matchEnded = true;
    room.locked = true;
  }
  room.updatedAt = nowIso;
}

export function resolveVoteIfEnded(room, nowIso) {
  const game = room.game;
  const vote = game?.votePhase;
  if (!vote || !vote.active || !vote.endsAt) return false;

  const nowMs = Date.parse(nowIso);
  const endMs = Date.parse(vote.endsAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(endMs) || nowMs < endMs) {
    return false;
  }

  const players = Array.isArray(room.players) ? room.players : [];
  ensureScores(players);

  const fakerId = String(game.fakerPlayerId || "");
  const legitPlayers = players.filter(p => String(p.playerId) !== fakerId);

  let legitsWin = legitPlayers.length > 0;
  for (const p of legitPlayers) {
    const votedFor = vote.votes?.[p.playerId] || null;
    if (votedFor !== fakerId) {
      legitsWin = false;
      break;
    }
  }

  const now = nowIso;
  vote.active = false;
  vote.endedAt = now;

  if (legitsWin) {
    game.endedAt = now;
    game.winner = "legits";
    game.endReason = "voting_legits_win";
    for (const p of legitPlayers) p.score += 1;
  } else {
    game.endedAt = now;
    game.winner = "faker";
    game.endReason = "voting_faker_win";
    const faker = players.find(p => String(p.playerId) === fakerId);
    if (faker) faker.score += 1;
  }

  finalizeGameEnd(room, now);
  return true;
}
