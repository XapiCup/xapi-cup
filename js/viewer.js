/* ================================================================
   VIEWER.JS — Page publique en lecture seule, mises à jour live
   ================================================================ */

import { store } from './state.js';
import { renderPoule, renderBracket } from './render.js';
import { computeStandings, splitQualifiers } from './tournament.js';
import { $, $$, el, clear, onReady, timeAgo } from './app.js';

const LS_CURRENT = 'xapi-current-public-tournament';

// Migration : nettoyer les anciennes clés schedule du localStorage
// (la page schedule.html a été supprimée)
try {
  ['xapi-cup-schedule-config-v1', 'xapi-cup-schedule-config-v2'].forEach((k) => localStorage.removeItem(k));
} catch (e) {}

let activeBracketTab = 'gold';
let activeViewerSubTab = 'poules';
let lastHistoryLength = 0;

onReady(() => {
  $$('.tab[data-viewer-subtab]').forEach((t) => {
    t.addEventListener('click', () => {
      $$('.tab[data-viewer-subtab]').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      activeViewerSubTab = t.dataset.viewerSubtab;
      $$('[id^="viewer-subtab-"]').forEach((x) => x.style.display = 'none');
      $('#viewer-subtab-' + activeViewerSubTab).style.display = '';
    });
  });
  $$('.tab[data-bracket-tab]').forEach((t) => {
    t.addEventListener('click', () => {
      $$('[data-bracket-tab]').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      activeBracketTab = t.dataset.bracketTab;
      renderKnockout();
    });
  });
  const aside = $('#live-feed-aside');
  const toggle = $('#live-feed-toggle');
  const close = $('#live-feed-close');
  if (toggle && aside) {
    toggle.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      aside.classList.toggle('collapsed');
    });
  }
  if (close && aside) {
    close.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      aside.classList.add('collapsed');
    });
  }
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
  if (publics.length === 0) { section.style.display = 'none'; return; }
  if (publics.length === 1) { setViewerCurrentTournament(publics[0].id); section.style.display = 'none'; return; }
  section.style.display = '';
  const currentId = getViewerCurrentTournamentId();
  if (!currentId || !publics.some((t) => t.id === currentId)) setViewerCurrentTournament(publics[0].id);
  const sel = getViewerCurrentTournamentId();
  container.appendChild(el('div', { class: 'tournament-selector-label' }, '📂 Sélectionnez un tournoi :'));
  const grid = el('div', { class: 'tournament-selector-grid' });
  publics.forEach((t) => {
    const card = el('button', {
      class: 'tournament-selector-card' + (t.id === sel ? ' active' : ''),
      onclick: () => { setViewerCurrentTournament(t.id); renderTournamentSelector(); renderAll(); },
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
  renderStats(t);
  renderHistory(t);
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

// ================================================================
// HISTORIQUE / PLANNING (inchangés)
// ================================================================
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

// ============================================================
// STATS : classement des buteurs et MVP
// ============================================================
function renderStats(t) {
  const container = $('#stats-container');
  if (!container) return;
  clear(container);
  if (!t) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '🎯'),
      el('h3', {}, 'Aucun tournoi à afficher')));
    return;
  }

  const players = t.players || [];
  if (!players.length) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '⚽'),
      el('h3', {}, 'Aucun joueur enregistré'),
      el('p', { class: 'muted' }, 'L\'admin peut ajouter des joueurs via la page admin.')));
    return;
  }

  // Aggregat
  const scorerMap = new Map(); // playerId -> { playerId, goals, matches:[], teams:Set }
  const mvpMap = new Map();    // playerId -> count
  players.forEach((p) => scorerMap.set(p.id, { ...p, goals: 0, matches: new Set(), teams: new Set([p.teamId]) }));
  players.forEach((p) => mvpMap.set(p.id, 0));

  const countGoals = (m) => {
    if (!m || !m.goals) return;
    (m.goals.A || []).forEach((g) => {
      const s = scorerMap.get(g.playerId);
      if (s) { s.goals++; s.matches.add(m.id); }
    });
    (m.goals.B || []).forEach((g) => {
      const s = scorerMap.get(g.playerId);
      if (s) { s.goals++; s.matches.add(m.id); }
    });
  };
  (t.matches || []).forEach(countGoals);
  (t.bracketMatches || []).forEach(countGoals);

  const countMvp = (m) => {
    if (!m || !m.mvp) return;
    if (mvpMap.has(m.mvp)) mvpMap.set(m.mvp, mvpMap.get(m.mvp) + 1);
  };
  (t.matches || []).forEach(countMvp);
  (t.bracketMatches || []).forEach(countMvp);

  // Top buteurs
  const scorers = Array.from(scorerMap.values())
    .filter((s) => s.goals > 0)
    .sort((a, b) => b.goals - a.goals || a.number - b.number);
  // Top MVP
  const mvps = Array.from(mvpMap.entries())
    .filter(([, c]) => c > 0)
    .map(([id, count]) => ({ ...(players.find((p) => p.id === id) || {}), mvpCount: count }))
    .sort((a, b) => b.mvpCount - a.mvpCount);

  container.appendChild(el('h2', { style: { marginTop: '0' } }, `🎯 Buteurs & MVP — ${t.name}`));

  const grid = el('div', { class: 'stats-grid', style: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px',
  } });

  // === Buteurs ===
  const scorerCard = el('div', { class: 'card' },
    el('h3', { style: { marginTop: '0' } }, `⚽ Classement des buteurs (${scorers.length})`));
  if (!scorers.length) {
    scorerCard.appendChild(el('p', { class: 'muted' },
      'Aucun buteur pour le moment. L\'admin peut marquer les buteurs sur chaque match.'));
  } else {
    const table = el('table', { class: 'standings-table' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', { style: { width: '36px' } }, '#'),
      el('th', { style: { textAlign: 'left' } }, 'Joueur'),
      el('th', {}, 'Équipe'),
      el('th', {}, 'Buts'),
    )));
    const tb = el('tbody');
    scorers.forEach((s, idx) => {
      const team = (t.teams || []).find((x) => x.id === s.teamId);
      const tr = el('tr', { class: idx < 3 ? `rank-${idx + 1}` : '' });
      tr.appendChild(el('td', { class: 'rank-cell' },
        idx === 0 ? '🥇 1' : idx === 1 ? '🥈 2' : idx === 2 ? '🥉 3' : String(idx + 1)
      ));
      tr.appendChild(el('td', { class: 'team-cell' },
        el('span', { class: 'player-number' }, String(s.number)),
        el('span', { class: 'team-name' }, s.name),
      ));
      tr.appendChild(el('td', { class: 'muted', style: { fontSize: '0.85rem' } }, team?.name || '?'));
      tr.appendChild(el('td', { style: { fontWeight: 700, color: 'var(--color-accent)' } }, String(s.goals)));
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    scorerCard.appendChild(table);
  }
  grid.appendChild(scorerCard);

  // === MVP ===
  const mvpCard = el('div', { class: 'card' },
    el('h3', { style: { marginTop: '0' } }, `⭐ Joueurs MVP (${mvps.length})`));
  if (!mvps.length) {
    mvpCard.appendChild(el('p', { class: 'muted' },
      'Aucun MVP designe. L\'admin peut designer le joueur du match depuis chaque match.'));
  } else {
    const table = el('table', { class: 'standings-table' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', { style: { width: '36px' } }, '#'),
      el('th', { style: { textAlign: 'left' } }, 'Joueur'),
      el('th', {}, 'Équipe'),
      el('th', {}, 'MVP'),
    )));
    const tb = el('tbody');
    mvps.forEach((m, idx) => {
      const team = (t.teams || []).find((x) => x.id === m.teamId);
      const tr = el('tr', { class: idx < 3 ? `rank-${idx + 1}` : '' });
      tr.appendChild(el('td', { class: 'rank-cell' },
        idx === 0 ? '🥇 1' : idx === 1 ? '🥈 2' : idx === 2 ? '🥉 3' : String(idx + 1)
      ));
      tr.appendChild(el('td', { class: 'team-cell' },
        el('span', { class: 'player-number' }, String(m.number)),
        el('span', { class: 'team-name' }, m.name),
      ));
      tr.appendChild(el('td', { class: 'muted', style: { fontSize: '0.85rem' } }, team?.name || '?'));
      tr.appendChild(el('td', { style: { fontWeight: 700, color: 'var(--color-gold, #d4a017)' } }, `⭐ ${m.mvpCount}`));
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    mvpCard.appendChild(table);
  }
  grid.appendChild(mvpCard);

  container.appendChild(grid);
}