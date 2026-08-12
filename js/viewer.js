/* ================================================================
   VIEWER.JS — Page publique en lecture seule, mises à jour live
   ================================================================ */

import { store } from './state.js';
import { renderPoule, renderBracket } from './render.js';
import { computeStandings, splitQualifiers } from './tournament.js';
import { $, $$, el, clear, onReady, timeAgo } from './app.js';

const LS_CURRENT = 'xapi-current-public-tournament';

let activeBracketTab = 'gold';
let activeViewerSubTab = 'poules';
let lastHistoryLength = 0;

onReady(() => {
  // === Onglets principaux (live / schedule) ===
  $$('.v-tab').forEach((t) => {
    t.addEventListener('click', () => {
      $$('.v-tab').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      const target = t.dataset.viewerTab;
      $$('.tab-content').forEach((c) => {
        c.style.display = 'none';
        c.classList.remove('active');
      });
      const tabEl = $('#tab-' + target);
      if (tabEl) {
        tabEl.style.display = '';
        tabEl.classList.add('active');
      }
    });
  });

  // === Sous-onglets Poules / Phase finale / Classement final ===
  $$('.tab[data-viewer-subtab]').forEach((t) => {
    t.addEventListener('click', () => {
      $$('.tab[data-viewer-subtab]').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      activeViewerSubTab = t.dataset.viewerSubtab;
      $$('[id^="viewer-subtab-"]').forEach((x) => x.style.display = 'none');
      $('#viewer-subtab-' + activeViewerSubTab).style.display = '';
    });
  });

  // === Onglets des brackets Or / Consolante ===
  $$('.tab[data-bracket-tab]').forEach((t) => {
    t.addEventListener('click', () => {
      $$('[data-bracket-tab]').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      activeBracketTab = t.dataset.bracketTab;
      renderKnockout();
    });
  });

  // === Feed live : toggle ===
  const aside = $('#live-feed-aside');
  const toggle = $('#live-feed-toggle');
  const close = $('#live-feed-close');
  if (toggle && aside) {
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      aside.classList.toggle('collapsed');
    });
  }
  if (close && aside) {
    close.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      aside.classList.add('collapsed');
    });
  }

  // === Subscribe ===
  store.subscribe(() => {
    renderTournamentSelector();
    renderAll();
    updateFeedBadge();
  });
  renderTournamentSelector();
  renderAll();
  updateFeedBadge();
});

function renderTournamentSelector() {
  const container = $('#tournament-selector');
  const section = $('#tournament-selector-section');
  if (!container || !section) return;

  const publics = store.listPublicTournaments();
  clear(container);

  if (publics.length === 0) {
    section.style.display = 'none';
    return;
  }

  if (publics.length === 1) {
    setViewerCurrentTournament(publics[0].id);
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  const currentId = getViewerCurrentTournamentId();
  if (!currentId || !publics.some((t) => t.id === currentId)) {
    setViewerCurrentTournament(publics[0].id);
  }
  const sel = getViewerCurrentTournamentId();

  container.appendChild(el('div', { class: 'tournament-selector-label' }, '📂 Sélectionnez un tournoi :'));
  const grid = el('div', { class: 'tournament-selector-grid' });
  publics.forEach((t) => {
    const card = el('button', {
      class: 'tournament-selector-card' + (t.id === sel ? ' active' : ''),
      onclick: () => {
        setViewerCurrentTournament(t.id);
        renderTournamentSelector();
        renderAll();
      },
    },
      el('div', { class: 'tournament-selector-name' }, t.name),
      t.date ? el('div', { class: 'tournament-selector-date' }, '📅 ' + new Date(t.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })) : null,
      t.location ? el('div', { class: 'tournament-selector-location' }, '📍 ' + t.location) : null,
      el('div', { class: 'tournament-selector-meta muted' },
        `${t.teams.length} équipes · ${t.matches.length + (t.bracketMatches?.length || 0)} matchs`),
    );
    grid.appendChild(card);
  });
  container.appendChild(grid);
}

function getViewerCurrentTournamentId() {
  try { return localStorage.getItem(LS_CURRENT); } catch { return null; }
}
function setViewerCurrentTournament(id) {
  try { localStorage.setItem(LS_CURRENT, id); } catch {}
}

function getViewerTournament() {
  const publics = store.listPublicTournaments();
  if (publics.length === 0) {
    return store.state.tournaments.find((t) => !t.archived) || store.currentTournament();
  }
  if (publics.length === 1) return publics[0];
  const sel = getViewerCurrentTournamentId();
  return publics.find((t) => t.id === sel) || publics[0];
}

function renderAll() {
  const t = getViewerTournament();
  if (t && t.id !== store.state.currentTournamentId) {
    store.state.currentTournamentId = t.id;
  }
  renderHeader(t);
  renderPoules(t);
  renderKnockout();
  renderFinalRanking(t);
  renderHistory(t);
  renderSchedule(t);
}

function renderHeader(t) {
  const ls = $('#live-status');
  if (ls) {
    clear(ls);
    if (!t) {
      ls.appendChild(el('div', { class: 'live-pill' }, '⏸ En attente'));
    } else {
      const phaseLabels = {
        'setup': '⚙️ Configuration', 'poules': '📋 Phase de poules',
        'finished-pool': '✅ Poules terminées', 'knockout': '🔥 Phase finale',
        'finished': '🏆 Tournoi terminé',
      };
      ls.appendChild(el('div', { class: 'live-pill' }, phaseLabels[t.phase] || 'En cours'));
    }
  }
  const title = $('#page-title');
  if (title) title.textContent = t ? t.name : 'Xapi Cup';
  const sub = $('#page-subtitle');
  if (sub) sub.textContent = t ? (t.location || 'Suivez les poules et les phases finales en direct.') : 'Aucun tournoi public disponible.';
}

function renderPoules(t) {
  const container = $('#poules-container');
  if (!container) return;
  clear(container);
  if (!t || !t.poules.length) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '⏳'),
      el('h3', {}, 'Le tournoi n\'a pas encore commencé.'),
      el('p', {}, 'Les poules seront générées très bientôt. Restez connectés !')));
    return;
  }
  const grid = el('div', { class: 'poules-grid' });
  t.poules.forEach((pouleTeams, idx) => {
    const matches = t.matches.filter((m) => m.pouleIdx === idx);
    grid.appendChild(renderPoule(idx, t.teams, matches, t.config.qualifiersPerPool, false));
  });
  container.appendChild(grid);
}

function renderKnockout() {
  const container = $('#knockout-container');
  if (!container) return;
  clear(container);
  const t = getViewerTournament();
  if (!t || (!t.brackets.gold && !t.brackets.silver)) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '🏆'),
      el('h3', {}, 'La phase finale n\'a pas encore commencé.')));
    return;
  }
  if (activeBracketTab === 'gold' && t.brackets.gold) {
    container.appendChild(renderBracket(t.brackets.gold, t, { kind: 'gold', editable: false }));
  } else if (activeBracketTab === 'silver' && t.brackets.silver) {
    container.appendChild(renderBracket(t.brackets.silver, t, { kind: 'silver', editable: false }));
  } else if (activeBracketTab === 'silver' && !t.brackets.silver) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '🥈'),
      el('h3', {}, 'Pas de consolante cette fois.')));
  }
}

/**
 * Classement final : combine poules + bracket pour donner un ordre final.
 * Ordre de priorite :
 *  1. Vainqueur Or
 *  2. Finaliste Or
 *  3. 3e Or (gagnant petite finale)
 *  4. 4e Or (perdant petite finale)
 *  5. Vainqueur Consolante
 *  6. Finaliste Consolante
 *  7. 3e Consolante
 *  8. 4e Consolante
 *  9. Eliminés en demi (par classement dans leur poule)
 * 10. Eliminés en poule (par classement dans leur poule)
 */
function renderFinalRanking(t) {
  const container = $('#ranking-container');
  if (!container) return;
  clear(container);
  if (!t || !t.teams.length) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '🏆'),
      el('h3', {}, 'Aucune équipe participante.')));
    return;
  }

  const ranked = [];

  // 1. Vainqueurs / finalistes bracket
  const placeBracket = (br, kind, baseRank) => {
    if (!br || !br.rounds?.length) return;
    const lastRound = br.rounds[br.rounds.length - 1];
    const final = lastRound[0];
    if (!final || !final.finished) return;
    const winnerId = final.winnerSlot === 'A' ? final.slotA : final.slotB;
    const runnerId = final.winnerSlot === 'A' ? final.slotB : final.slotA;
    if (winnerId) ranked.push({ rank: baseRank, team: t.teams.find((x) => x.id === winnerId), label: kind === 'gold' ? '🥇 Vainqueur' : '🥇 Vainqueur Consolante' });
    if (runnerId) ranked.push({ rank: baseRank + 1, team: t.teams.find((x) => x.id === runnerId), label: kind === 'gold' ? '🥈 Finaliste' : '🥈 Finaliste Consolante' });
    // Petite finale
    if (br.thirdPlaceMatch && br.thirdPlaceMatch.finished) {
      const tpm = br.thirdPlaceMatch;
      const w3 = tpm.winnerSlot === 'A' ? tpm.slotA : tpm.slotB;
      const l3 = tpm.winnerSlot === 'A' ? tpm.slotB : tpm.slotA;
      if (w3) ranked.push({ rank: baseRank + 2, team: t.teams.find((x) => x.id === w3), label: '🥉 3e' });
      if (l3) ranked.push({ rank: baseRank + 3, team: t.teams.find((x) => x.id === l3), label: '4e' });
    }
  };

  placeBracket(t.brackets.gold, 'gold', 1);
  placeBracket(t.brackets.silver, 'silver', 100);

  // 2. Eliminés en demi (les demi-finalistes non classés)
  const alreadyRanked = new Set(ranked.map((r) => r.team?.id).filter(Boolean));
  const demis = new Set();
  if (t.brackets.gold && t.brackets.gold.rounds.length >= 2) {
    const semis = t.brackets.gold.rounds[t.brackets.gold.rounds.length - 2];
    semis.forEach((m) => {
      if (m.finished) {
        const lA = m.winnerSlot === 'A' ? m.slotB : m.slotA;
        const lB = m.winnerSlot === 'A' ? m.slotA : m.slotB;
        // Le perdant (non qualifie) est éliminé en demi
        const loser = m.winnerSlot === 'A' ? m.slotB : m.slotA;
        if (loser && !alreadyRanked.has(loser)) {
          demis.add(loser);
          alreadyRanked.add(loser);
        }
      }
    });
  }

  // 3. Classement complet des poules (pour trier les éliminés)
  const allStandings = [];
  if (t.poules.length) {
    t.poules.forEach((p, idx) => {
      const matches = t.matches.filter((m) => m.pouleIdx === idx);
      const standings = computeStandings(p, matches);
      standings.forEach((s, sIdx) => {
        if (!alreadyRanked.has(s.team.id) && !demis.has(s.team.id)) {
          allStandings.push({ team: s.team, points: s.points, diff: s.goalDiff, scored: s.goalsFor, sIdx, pouleIdx: idx });
        }
      });
    });
  }

  // 4. Classer : demis d'abord (par classement dans leur poule), puis non-qualifiés
  const includeConsolante = t.config?.includeConsolante !== false;
  const qualifiersPerPool = t.config?.qualifiersPerPool || 2;
  const { gold, consolante } = t.poules.length
    ? splitQualifiers(t.poules.map((p, idx) => computeStandings(p, t.matches.filter((m) => m.pouleIdx === idx))), qualifiersPerPool, includeConsolante)
    : { gold: [], consolante: [] };
  const qualifiesSet = new Set([...gold, ...consolante].map((x) => x.id));

  // Demis : déjà exclus, déjà ajoutés à alreadyRanked
  // Qualifiés non encore classés : les ajouter entre les bracket et les "éliminés en poule"
  const qualifiedNotRanked = [];
  const notQualified = [];
  allStandings.forEach((s) => {
    if (qualifiesSet.has(s.team.id)) {
      qualifiedNotRanked.push(s);
    } else {
      notQualified.push(s);
    }
  });

  // Trier chaque groupe par points, diff, scored
  const sortF = (a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.diff !== a.diff) return b.diff - a.diff;
    if (b.scored !== a.scored) return b.scored - a.scored;
    return a.team.name.localeCompare(b.team.name);
  };
  qualifiedNotRanked.sort(sortF);
  notQualified.sort(sortF);

  // Demis : on n'a pas leur classement dans les poules, on les classe par défaut après les qualifiés
  // En fait un demi-finaliste a forcément été qualifié, donc il a un classement dans sa poule
  // S'il est déjà dans ranked, ok. Sinon, c'est qu'il n'a pas été trouvé dans le bracket (pas joué).

  // Construire le classement final
  const final = [...ranked];
  let nextRank = ranked.length > 0 ? Math.max(...ranked.map((r) => r.rank)) + 1 : 1;
  qualifiedNotRanked.forEach((s) => {
    final.push({ rank: nextRank++, team: s.team, label: 'Qualifié non classé' });
  });
  notQualified.forEach((s) => {
    final.push({ rank: nextRank++, team: s.team, label: 'Éliminé en poule' });
  });

  // Render
  container.appendChild(el('h2', { style: { marginTop: '0' } }, '🏆 Classement final'));
  container.appendChild(el('p', { class: 'muted' }, 'Combinaison des phases de poules et des phases finales.'));

  const table = el('table', { class: 'standings-table final-ranking-table' });
  table.appendChild(el('thead', {}, el('tr', {},
    el('th', { style: { width: '60px' } }, '#'),
    el('th', { style: { textAlign: 'left' } }, 'Équipe'),
    el('th', { style: { textAlign: 'left' } }, 'Statut'),
  )));
  const tb = el('tbody');
  final.forEach((r) => {
    if (!r.team) return;
    const medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : '';
    const tr = el('tr', { class: r.rank <= 4 ? 'final-podium' : '' },
      el('td', { class: 'rank-cell', style: { fontWeight: 700, fontSize: '1.1em' } }, medal ? `${medal} ${r.rank}` : String(r.rank)),
      el('td', { class: 'team-cell' },
        el('span', { class: 'team-color', style: { background: r.team.color } }),
        r.team.name,
      ),
      el('td', { class: 'muted' }, r.label),
    );
    tb.appendChild(tr);
  });
  table.appendChild(tb);
  container.appendChild(table);
}

function renderHistory(t) {
  const list = $('#live-feed');
  if (!list) return;
  clear(list);
  if (!t) {
    list.appendChild(el('p', { class: 'muted text-center' }, 'Aucun événement.'));
    return;
  }
  const items = [...(t.history || [])].reverse().slice(0, 12);
  if (!items.length) {
    list.appendChild(el('p', { class: 'muted text-center' }, 'Aucun événement pour l\'instant.'));
    return;
  }
  const typeIcons = {
    'team-add': '➕', 'team-remove': '➖', 'teams-clear': '🧹',
    'poules-draw': '🎲', 'brackets-launched': '🚀',
    'match-finished': '⚽', 'schedule-generated': '📅',
  };
  items.forEach((h) => {
    const isNew = lastHistoryLength && items.length > lastHistoryLength && items[0] === h;
    const item = el('div', { class: 'feed-item' + (isNew ? ' feed-new' : '') },
      el('span', { class: 'feed-icon' }, typeIcons[h.type] || '•'),
      el('div', { class: 'feed-body' },
        el('div', { class: 'feed-label' }, h.label),
        el('div', { class: 'feed-time muted' }, timeAgo(new Date(h.at)))
      )
    );
    list.appendChild(item);
  });
  lastHistoryLength = items.length;
}

function renderSchedule(t) {
  const container = $('#schedule-public');
  if (!container) return;
  clear(container);
  if (!t || !t.schedule?.length) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '📅'),
      el('h3', {}, 'Aucun planning publié.')));
    return;
  }
  if (t.config?.schedulePublic === false) {
    container.appendChild(el('div', { class: 'alert alert-info' },
      'Le planning est actuellement masqué par l\'administrateur.'));
    return;
  }

  container.appendChild(el('h2', { style: { marginTop: '0' } }, '📅 Planning — ' + t.name));
  container.appendChild(el('p', { class: 'muted', style: { marginTop: '4px' } },
    'Matchs simultanés joués en parallèle sur plusieurs terrains.'));

  const slotsByDT = new Map();
  t.schedule.forEach((s) => {
    const key = s.date + '__' + s.time;
    if (!slotsByDT.has(key)) slotsByDT.set(key, { date: s.date, time: s.time, terrains: [] });
    slotsByDT.get(key).terrains.push(s);
  });
  const slots = Array.from(slotsByDT.values()).sort((a, b) =>
    (a.date + a.time).localeCompare(b.date + b.time)
  );

  const matchesMap = new Map();
  t.matches.forEach((m) => matchesMap.set(m.id, m));
  (t.bracketMatches || []).forEach((m) => matchesMap.set(m.id, m));

  const slotsByDate = new Map();
  slots.forEach((s) => {
    if (!slotsByDate.has(s.date)) slotsByDate.set(s.date, []);
    slotsByDate.get(s.date).push(s);
  });

  const nbTerrains = Math.max(
    t.config?.nbTerrains || 1,
    ...t.schedule.map((s) => s.terrain)
  );

  Array.from(slotsByDate.entries()).sort(([a],[b]) => a.localeCompare(b)).forEach(([date, daySlots]) => {
    container.appendChild(el('h3', { style: { color: 'var(--color-primary)', marginTop: '20px' } },
      new Date(date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })));
    const table = el('table', { class: 'standings-table' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', {}, 'Heure'),
      ...Array.from({ length: nbTerrains }, (_, i) => el('th', {}, `T${i + 1}`)),
    )));
    const tb = el('tbody');
    daySlots.forEach((slot) => {
      const tr = el('tr');
      tr.appendChild(el('td', { style: { fontWeight: 600, verticalAlign: 'top' } }, slot.time));
      for (let i = 0; i < nbTerrains; i++) {
        const sc = slot.terrains.find((s) => s.terrain === i + 1);
        if (!sc) { tr.appendChild(el('td', { class: 'muted', style: { color: '#aaa' } }, '—')); continue; }
        const m = matchesMap.get(sc.matchId);
        if (!m) { tr.appendChild(el('td', {}, '?')); continue; }
        const tA = t.teams.find((x) => x.id === (m.slotA || m.teamA));
        const tB = t.teams.find((x) => x.id === (m.slotB || m.teamB));
        const aWins = m.winnerSlot === 'A';
        const bWins = m.winnerSlot === 'B';
        tr.appendChild(el('td', {},
          el('div', { class: aWins ? 'winner' : '' }, (tA?.name || '?').substring(0, 14)),
          el('div', { class: 'muted', style: { fontSize: '0.75rem', textAlign: 'center' } }, 'vs'),
          el('div', { class: bWins ? 'winner' : '' }, (tB?.name || '?').substring(0, 14)),
          m.scoreA != null ? el('div', { style: { fontWeight: 700, textAlign: 'center', marginTop: '4px' } },
            `${m.scoreA} - ${m.scoreB}`) : null,
        ));
      }
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    container.appendChild(table);
  });
}

function updateFeedBadge() {
  const aside = $('#live-feed-aside');
  const badge = $('#live-feed-toggle-badge');
  if (!badge) return;
  const t = getViewerTournament();
  const items = t?.history || [];
  const prev = parseInt(badge.dataset.prev || '0', 10);
  if (items.length > prev) {
    const newCount = items.length - prev;
    if (aside && aside.classList.contains('collapsed')) {
      badge.textContent = newCount > 9 ? '9+' : newCount;
      badge.style.display = 'flex';
    }
  }
  badge.dataset.prev = String(items.length);
}
