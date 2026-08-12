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