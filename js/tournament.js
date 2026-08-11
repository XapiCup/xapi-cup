/* ================================================================
   TOURNAMENT.JS — Algorithmes : poules aléatoires, classements,
   génération des arbres Or + Consolante.
   ================================================================ */

// ---------- Tirage des poules ----------
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
 * Renvoie [{id, teamA, teamB}] (scores à 0 par défaut).
 */
export function generatePouleMatches(pouleIdx, teams) {
  const matches = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      matches.push({
        id: `m_p${pouleIdx}_${i}_${j}_${Date.now().toString(36)}`,
        pouleIdx,
        teamA: teams[i].id,
        teamB: teams[j].id,
        scoreA: null,
        scoreB: null,
        finished: false,
      });
    }
  }
  // Mélanger pour ne pas avoir toujours les mêmes adversaires en premier
  return matches.sort(() => Math.random() - 0.5);
}

// ---------- Classement d'une poule ----------
/**
 * Calcule le classement d'une poule à partir de ses matchs.
 * Règles : Victoire = 3 pts, Nul = 1 pt, Défaite = 0 pt.
 * Goal-average particulier : en cas d'égalité aux points, on départage par
 * (buts pour - buts contre), puis par buts pour, puis par confrontation directe.
 */
export function computeStandings(pouleTeams, matches) {
  const stats = {};
  pouleTeams.forEach((t) => {
    stats[t.id] = {
      team: t,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      gf: 0,
      ga: 0,
      gd: 0,
      points: 0,
    };
  });
  matches.forEach((m) => {
    if (m.scoreA == null || m.scoreB == null) return;
    const a = stats[m.teamA], b = stats[m.teamB];
    if (!a || !b) return;
    a.played++; b.played++;
    a.gf += m.scoreA; a.ga += m.scoreB;
    b.gf += m.scoreB; b.ga += m.scoreA;
    if (m.scoreA > m.scoreB) {
      a.wins++; a.points += 3; b.losses++;
    } else if (m.scoreA < m.scoreB) {
      b.wins++; b.points += 3; a.losses++;
    } else {
      a.draws++; b.draws++;
      a.points += 1; b.points += 1;
    }
  });
  Object.values(stats).forEach((s) => { s.gd = s.gf - s.ga; });

  return Object.values(stats).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.gd !== a.gd) return b.gd - a.gd;
    if (b.gf !== a.gf) return b.gf - a.gf;
    // Confrontation directe
    const head2head = matches.find(
      (m) =>
        (m.teamA === a.team.id && m.teamB === b.team.id) ||
        (m.teamA === b.team.id && m.teamB === a.team.id)
    );
    if (head2head && head2head.scoreA != null && head2head.scoreB != null) {
      const aIsA = head2head.teamA === a.team.id;
      const aScore = aIsA ? head2head.scoreA : head2head.scoreB;
      const bScore = aIsA ? head2head.scoreB : head2head.scoreA;
      if (aScore !== bScore) return bScore - aScore;
    }
    return a.team.name.localeCompare(b.team.name);
  });
}

// ---------- Génération des arbres (bracket) ----------
/**
 * Construit un arbre à élimination directe.
 * `seededTeams` : équipes triées par force (meilleur en premier).
 * Retourne { rounds: [[match, ...], ...] } où rounds[0] = 1er tour.
 *
 * Le bracket est "byes-aware" : si le nombre d'équipes n'est pas une puissance de 2,
 * on attribue des byes aux meilleurs seeds pour équilibrer.
 */
export function buildBracket(seededTeams) {
  const n = seededTeams.length;
  if (n < 2) return null;

  // Puissance de 2 >= n
  const size = Math.pow(2, Math.ceil(Math.log2(n)));
  const byes = size - n;

  // Standard seeding 1..n puis on remplit avec des byes
  // L'ordre de placement classique : 1 vs 16, 8 vs 9, 4 vs 13, etc.
  const slots = standardSeedingOrder(size);
  const seededSlots = slots.map((seedNum) =>
    seedNum <= n ? seededTeams[seedNum - 1] : null
  );

  // Construire les rounds
  const rounds = [];
  let current = seededSlots;
  let roundIdx = 0;
  const totalRounds = Math.log2(size);

  while (current.length > 1) {
    const matches = [];
    for (let i = 0; i < current.length; i += 2) {
      matches.push({
        id: `b_r${roundIdx}_m${i / 2}_${Date.now().toString(36)}`,
        round: roundIdx,
        slotA: current[i],       // teamId or null (bye)
        slotB: current[i + 1],
        scoreA: null,
        scoreB: null,
        winnerSlot: null,        // 'A' | 'B' | null si bye
        finished: false,
      });
    }
    // Résoudre les byes au 1er tour : l'équipe présente gagne par forfait
    if (roundIdx === 0) {
      matches.forEach((m) => {
        if (m.slotA && !m.slotB) { m.winnerSlot = 'A'; m.scoreA = 0; m.scoreB = 0; m.finished = true; m.bye = true; }
        if (!m.slotA && m.slotB) { m.winnerSlot = 'B'; m.scoreA = 0; m.scoreB = 0; m.finished = true; m.bye = true; }
      });
    }
    rounds.push(matches);
    // Préparer le round suivant avec les vainqueurs (placeholders)
    const next = [];
    for (let i = 0; i < matches.length; i++) {
      const w = matches[i].winnerSlot;
      if (w === 'A') next.push(matches[i].slotA);
      else if (w === 'B') next.push(matches[i].slotB);
      else next.push(null);
      // on double les positions pour le prochain round
      if (i === matches.length - 1 || true) {
        // pas de doublement : on stocke juste les vainqueurs
      }
    }
    current = next;
    roundIdx++;
    if (roundIdx >= totalRounds) break;
  }
  return { rounds, size, totalRounds, byes };
}

/**
 * Ordre de seeding classique pour un bracket de taille `size` (puissance de 2).
 * Renvoie un tableau de seeds [1, 16, 8, 9, 4, 13, ...] pour size=16.
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
 * Propage un vainqueur vers le round suivant et retourne le bracket mis à jour.
 */
export function setBracketWinner(bracket, roundIdx, matchIdx, winnerSlot) {
  const newBracket = structuredClone(bracket);
  const match = newBracket.rounds[roundIdx][matchIdx];
  match.winnerSlot = winnerSlot;
  match.finished = true;

  // Propager au round suivant si applicable
  if (roundIdx < newBracket.rounds.length - 1) {
    const nextRound = newBracket.rounds[roundIdx + 1];
    const nextMatchIdx = Math.floor(matchIdx / 2);
    const nextMatch = nextRound[nextMatchIdx];
    const winnerId = winnerSlot === 'A' ? match.slotA : match.slotB;
    if (matchIdx % 2 === 0) {
      nextMatch.slotA = winnerId;
    } else {
      nextMatch.slotB = winnerId;
    }
  }
  return newBracket;
}

/**
 * Sépare les équipes qualifiées en deux listes : Or et Consolante.
 * On prend les `qualifiersPerPool` meilleurs de chaque poule, et le reste va en consolante.
 * Si le nombre d'équipes n'est pas adapté, on ajuste (rappel : la consolante n'est pas
 * obligatoire, l'admin peut la désactiver).
 */
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

/**
 * Trouve le nom du round ("Finale", "Demi-finales", "Quarts", "Huitièmes", etc.)
 */
export function getRoundLabel(roundIdx, totalRounds) {
  const fromEnd = totalRounds - 1 - roundIdx;
  if (fromEnd === 0) return 'Finale';
  if (fromEnd === 1) return 'Demi-finales';
  if (fromEnd === 2) return 'Quarts de finale';
  if (fromEnd === 3) return 'Huitièmes de finale';
  if (fromEnd === 4) return 'Seizièmes de finale';
  return `Tour ${roundIdx + 1}`;
}
