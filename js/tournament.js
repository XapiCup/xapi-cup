/* ================================================================
   TOURNAMENT.JS — Algorithmes : poules, classements, brackets,
   qualification, planning de matchs.
   ================================================================ */

// ============================================================
// POULES
// ============================================================
/**
 * Répartit N équipes dans `nbPoules` poules de manière équilibrée
 * (écart max d'1 équipe entre les poules). Mélange aléatoire.
 */
export function generatePoules(teams, nbPoules) {
  if (!teams?.length) return [];
  const shuffled = [...teams].sort(() => Math.random() - 0.5);
  const baseSize = Math.floor(shuffled.length / nbPoules);
  const remainder = shuffled.length % nbPoules;
  const poules = [];
  let idx = 0;
  for (let p = 0; p < nbPoules; p++) {
    const size = baseSize + (p < remainder ? 1 : 0);
    poules.push(shuffled.slice(idx, idx + size));
    idx += size;
  }
  return poules;
}

/**
 * Génère tous les matchs "round-robin" d'une poule.
 * Renvoie [{id, teamA, teamB}] (scores null par défaut).
 */
export function generatePouleMatches(pouleIdx, teams) {
  const matches = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      matches.push({
        id: `m_p${pouleIdx}_${i}_${j}_${Date.now().toString(36)}${Math.random().toString(36).slice(2,5)}`,
        pouleIdx,
        teamA: teams[i].id,
        teamB: teams[j].id,
        scoreA: null,
        scoreB: null,
        finished: false,
        startedAt: null,
        finishedAt: null,
      });
    }
  }
  return matches.sort(() => Math.random() - 0.5);
}

// ============================================================
// CLASSEMENT
// ============================================================
/**
 * Calcule le classement d'une poule. V=3, N=1, D=0.
 * Départage : goal-average, puis buts pour, puis confrontation directe.
 */
export function computeStandings(pouleTeams, matches) {
  const stats = {};
  pouleTeams.forEach((t) => {
    stats[t.id] = {
      team: t,
      played: 0, wins: 0, draws: 0, losses: 0,
      gf: 0, ga: 0, gd: 0, points: 0,
    };
  });
  matches.forEach((m) => {
    if (m.scoreA == null || m.scoreB == null) return;
    const a = stats[m.teamA], b = stats[m.teamB];
    if (!a || !b) return;
    a.played++; b.played++;
    a.gf += m.scoreA; a.ga += m.scoreB;
    b.gf += m.scoreB; b.ga += m.scoreA;
    if (m.scoreA > m.scoreB)      { a.wins++; a.points += 3; b.losses++; }
    else if (m.scoreA < m.scoreB) { b.wins++; b.points += 3; a.losses++; }
    else                          { a.draws++; b.draws++; a.points += 1; b.points += 1; }
  });
  Object.values(stats).forEach((s) => { s.gd = s.gf - s.ga; });

  return Object.values(stats).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.gd !== a.gd)         return b.gd - a.gd;
    if (b.gf !== a.gf)         return b.gf - a.gf;
    const h2h = matches.find(
      (m) => (m.teamA === a.team.id && m.teamB === b.team.id) ||
             (m.teamA === b.team.id && m.teamB === a.team.id)
    );
    if (h2h && h2h.scoreA != null && h2h.scoreB != null) {
      const aIsA = h2h.teamA === a.team.id;
      const aScore = aIsA ? h2h.scoreA : h2h.scoreB;
      const bScore = aIsA ? h2h.scoreB : h2h.scoreA;
      if (aScore !== bScore) return bScore - aScore;
    }
    return a.team.name.localeCompare(b.team.name);
  });
}

// ============================================================
// BRACKETS (ARBRES À ÉLIMINATION DIRECTE)
// ============================================================
/**
 * Construit un arbre à élimination directe.
 * `seededTeams` : équipes triées par force (meilleur en premier).
 * Gère les byes si N n'est pas une puissance de 2.
 *
 * Renvoie { rounds: [[match, ...], ...], size, totalRounds, byes }
 * où chaque match a { id, round, slotA, slotB, scoreA, scoreB, winnerSlot, finished, nextSlot }
 *   - nextSlot : 'A' ou 'B' → dans quel slot du match suivant ce vainqueur ira
 *   - On construit TOUS les rounds d'un coup, slotA/slotB seront remplis au fil des vainqueurs.
 */
export function buildBracket(seededTeams) {
  const n = seededTeams?.length || 0;
  if (n < 2) return null;

  const size = Math.pow(2, Math.ceil(Math.log2(n)));
  const byes = size - n;
  const totalRounds = Math.log2(size);
  const seedOrder = standardSeedingOrder(size);

  // Place les équipes (ou null pour bye) dans l'ordre du seeding standard
  const seedSlots = seedOrder.map((s) => (s <= n ? seededTeams[s - 1].id : null));

  // Construit tous les rounds d'un coup
  const rounds = [];
  // Round 0 : matchs directs
  const round0 = [];
  for (let i = 0; i < size; i += 2) {
    const m = {
      id: 'b_r0_m' + (i / 2) + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      round: 0,
      slotA: seedSlots[i],
      slotB: seedSlots[i + 1],
      scoreA: null,
      scoreB: null,
      winnerSlot: null,
      finished: false,
      nextSlot: (i / 2) % 2 === 0 ? 'A' : 'B', // 1er match → slotA du prochain, 2e → slotB
      // Index du match dans le round suivant
      nextMatchIdx: Math.floor((i / 2) / 2),
      bye: false,
    };
    // Résolution des byes
    if (m.slotA && !m.slotB) {
      m.winnerSlot = 'A'; m.scoreA = 0; m.scoreB = 0; m.finished = true; m.bye = true;
    } else if (!m.slotA && m.slotB) {
      m.winnerSlot = 'B'; m.scoreA = 0; m.scoreB = 0; m.finished = true; m.bye = true;
    } else if (!m.slotA && !m.slotB) {
      // Deux byes (impossible en pratique si > 0 équipes, mais safe)
      m.bye = true; m.finished = true;
    }
    round0.push(m);
  }
  rounds.push(round0);

  // Rounds suivants
  for (let r = 1; r < totalRounds; r++) {
    const prevLen = rounds[r - 1].length;
    const thisLen = prevLen / 2;
    const round = [];
    for (let m = 0; m < thisLen; m++) {
      round.push({
        id: 'b_r' + r + '_m' + m + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        round: r,
        slotA: null,
        slotB: null,
        scoreA: null,
        scoreB: null,
        winnerSlot: null,
        finished: false,
        nextSlot: m % 2 === 0 ? 'A' : 'B',
        nextMatchIdx: Math.floor(m / 2),
        bye: false,
      });
    }
    rounds.push(round);
  }

  // Propagation initiale : pour les byes, on propage déjà le vainqueur
  propagateAllByes(rounds);

  return { rounds, size, totalRounds, byes };
}

/**
 * Propage tous les vainqueurs déjà connus (byes + matchs terminés) au round suivant.
 * Appelé après chaque modification d'un score.
 */
function propagateAllByes(rounds) {
  for (let r = 0; r < rounds.length - 1; r++) {
    const round = rounds[r];
    for (let m = 0; m < round.length; m++) {
      const match = round[m];
      if (!match.finished) continue;
      const winnerId = match.winnerSlot === 'A' ? match.slotA
                     : match.winnerSlot === 'B' ? match.slotB
                     : null;
      if (!winnerId) continue;
      const nextRound = rounds[r + 1];
      if (!nextRound) continue;
      const nextMatch = nextRound[match.nextMatchIdx];
      if (!nextMatch) continue;
      // Si le match suivant a déjà une équipe, c'est qu'on a une collision — ne pas écraser
      // (en pratique, ça n'arrive pas car les vainqueurs vont dans des slots opposés)
      if (match.nextSlot === 'A') {
        nextMatch.slotA = winnerId;
      } else {
        nextMatch.slotB = winnerId;
      }
    }
  }
}

/**
 * Ordre de seeding classique pour un bracket de taille `size` (puissance de 2).
 * Renvoie [1, 16, 8, 9, 4, 13, ...] pour size=16.
 */
function standardSeedingOrder(size) {
  let order = [1, 2];
  while (order.length < size) {
    const next = [];
    const total = order.length * 2;
    for (const seed of order) {
      next.push(seed);
      next.push(total + 1 - seed);
    }
    order = next;
  }
  return order;
}

/**
 * Applique un score à un match et propage le vainqueur.
 * Retourne un nouveau bracket (clone).
 */
export function setBracketScore(bracket, roundIdx, matchIdx, scoreA, scoreB) {
  const newBracket = structuredClone(bracket);
  const match = newBracket.rounds[roundIdx][matchIdx];
  if (match.slotA == null || match.slotB == null) {
    throw new Error('Les deux équipes ne sont pas encore déterminées.');
  }
  match.scoreA = scoreA;
  match.scoreB = scoreB;
  // Détermine le vainqueur
  if (scoreA > scoreB) match.winnerSlot = 'A';
  else if (scoreB > scoreA) match.winnerSlot = 'B';
  else match.winnerSlot = null; // égalité, à départager
  match.finished = match.winnerSlot != null;
  // Propage
  propagateAllByes(newBracket.rounds);
  return newBracket;
}

/**
 * Force un vainqueur en cas d'égalité.
 */
export function setBracketWinner(bracket, roundIdx, matchIdx, winnerSlot) {
  const newBracket = structuredClone(bracket);
  const match = newBracket.rounds[roundIdx][matchIdx];
  if (match.slotA == null || match.slotB == null) {
    throw new Error('Match incomplet.');
  }
  match.winnerSlot = winnerSlot;
  match.finished = true;
  propagateAllByes(newBracket.rounds);
  return newBracket;
}

// ============================================================
// QUALIFICATION
// ============================================================
export function splitQualifiers(poulesStandings, qualifiersPerPool, includeConsolante) {
  const gold = [];
  const consolante = [];
  poulesStandings.forEach((standings) => {
    standings.forEach((s, idx) => {
      if (idx < qualifiersPerPool) gold.push(s.team);
      else if (includeConsolante) consolante.push(s.team);
    });
  });
  return { gold, consolante };
}

// ============================================================
// ROUND LABELS
// ============================================================
export function getRoundLabel(roundIdx, totalRounds) {
  const fromEnd = totalRounds - 1 - roundIdx;
  if (fromEnd === 0) return 'Finale';
  if (fromEnd === 1) return 'Demi-finales';
  if (fromEnd === 2) return 'Quarts de finale';
  if (fromEnd === 3) return 'Huitièmes de finale';
  if (fromEnd === 4) return 'Seizièmes de finale';
  return `Tour ${roundIdx + 1}`;
}

// ============================================================
// PLANNING — Génération automatique
// ============================================================
/**
 * Génère un planning de matchs à partir d'une liste de matchs (poule ou bracket)
 * + paramètres (terrains, durée match, durée entre matchs, pause déj, multi-jours).
 *
 * @param {Array} matches   - liste de matchs avec {id, teamA, teamB}
 * @param {Object} config   - { nbTerrains, matchDurationMin, breakBetweenMin, lunchBreakMin,
 *                              startTime, endTime, splitDays, days: [{date, startTime, endTime}] }
 * @returns {Array} planning - [{matchId, date, time, terrain, slotIdx}]
 */
export function generateSchedule(matches, config) {
  if (!matches?.length) return [];
  const {
    nbTerrains = 2,
    matchDurationMin = 20,
    breakBetweenMin = 5,
    lunchBreakMin = 60,
    startTime = '09:00',
    endTime = '18:00',
    splitDays = false,
    days = [],
  } = config || {};

  const totalSlot = matchDurationMin + breakBetweenMin;
  const out = [];

  if (splitDays && days.length > 0) {
    // Multi-jours : on répartit les matchs sur les jours déclarés
    let matchIdx = 0;
    for (let dayIdx = 0; dayIdx < days.length && matchIdx < matches.length; dayIdx++) {
      const day = days[dayIdx];
      const dayStart = parseTime(day.startTime || startTime);
      const dayEnd = parseTime(day.endTime || endTime);
      const slotsPerDay = Math.floor((dayEnd - dayStart) / totalSlot);
      const matchesThisDay = Math.min(slotsPerDay * nbTerrains, matches.length - matchIdx);
      const dayDate = day.date || dayIdxToDate(dayIdx);
      const dayResult = scheduleDay(
        matches.slice(matchIdx, matchIdx + matchesThisDay),
        {
          nbTerrains, matchDurationMin, breakBetweenMin, lunchBreakMin,
          startTime: day.startTime || startTime,
          endTime: day.endTime || endTime,
          date: dayDate,
        }
      );
      out.push(...dayResult);
      matchIdx += matchesThisDay;
    }
    // Matchs restants (si on a sous-estimé) : on les met le dernier jour
    if (matchIdx < matches.length) {
      const lastDay = days[days.length - 1];
      const dayResult = scheduleDay(
        matches.slice(matchIdx),
        {
          nbTerrains, matchDurationMin, breakBetweenMin, lunchBreakMin,
          startTime: lastDay.startTime || startTime,
          endTime: lastDay.endTime || endTime,
          date: lastDay.date || dayIdxToDate(days.length - 1),
        }
      );
      out.push(...dayResult);
    }
  } else {
    // Mono-jour
    const dayResult = scheduleDay(matches, {
      nbTerrains, matchDurationMin, breakBetweenMin, lunchBreakMin,
      startTime, endTime, date: dayIdxToDate(0),
    });
    out.push(...dayResult);
  }

  return out;
}

function scheduleDay(matches, { nbTerrains, matchDurationMin, breakBetweenMin, lunchBreakMin, startTime, endTime, date }) {
  const totalSlot = matchDurationMin + breakBetweenMin;
  const dayStart = parseTime(startTime);
  const dayEnd = parseTime(endTime);
  const out = [];
  let slotIdx = 0;
  // Premier slot : startTime
  let currentTime = dayStart;
  for (let i = 0; i < matches.length; i++) {
    // Pause déj à 12h30 (midi + 30 min)
    const minutes = Math.floor(currentTime / 60);
    const lunchTrigger = 12 * 60 + 30;
    if (minutes >= lunchTrigger && minutes < lunchTrigger + lunchBreakMin) {
      currentTime = lunchTrigger + lunchBreakMin;
    }
    // Fin de journée : stop
    if (currentTime + matchDurationMin > dayEnd) {
      // on dépasse, mais on l'ajoute quand même (l'admin pourra éditer)
    }
    const terrain = (i % nbTerrains) + 1;
    out.push({
      matchId: matches[i].id,
      date,
      time: minutesToTime(currentTime),
      terrain,
      slotIdx: slotIdx++,
      durationMin: matchDurationMin,
    });
    currentTime += totalSlot;
  }
  return out;
}

function parseTime(s) {
  // "09:00" → 540
  if (!s) return 0;
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToTime(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function dayIdxToDate(idx) {
  const d = new Date();
  d.setDate(d.getDate() + idx);
  return d.toISOString().slice(0, 10);
}

// ============================================================
// CONFLITS DE PLANNING
// ============================================================
/**
 * Vérifie qu'un planning n'a pas de conflits (même équipe sur 2 terrains au même moment).
 * Retourne la liste des conflits détectés.
 */
export function detectScheduleConflicts(schedule, matches, teams) {
  const conflicts = [];
  // Index matchId → match
  const matchById = new Map(matches.map((m) => [m.id, m]));
  // Pour chaque équipe, lister ses matchs planifiés
  const teamSlots = new Map(); // teamId → [{date, time, terrain, matchId}]
  schedule.forEach((s) => {
    const m = matchById.get(s.matchId);
    if (!m) return;
    [m.teamA, m.teamB].forEach((tid) => {
      if (!tid) return;
      if (!teamSlots.has(tid)) teamSlots.set(tid, []);
      teamSlots.get(tid).push({ ...s, teamId: tid });
    });
  });
  // Vérifier qu'aucune équipe n'a 2 matchs qui se chevauchent
  teamSlots.forEach((slots, teamId) => {
    slots.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    for (let i = 0; i < slots.length - 1; i++) {
      const a = slots[i], b = slots[i + 1];
      if (a.date === b.date && a.time === b.time && a.terrain !== b.terrain) {
        const team = teams.find((t) => t.id === teamId);
        conflicts.push({
          team: team?.name || teamId,
          slot1: a, slot2: b,
          reason: 'Même équipe sur 2 terrains au même créneau',
        });
      }
    }
  });
  return conflicts;
}
