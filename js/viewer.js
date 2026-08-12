/* ================================================================
   VIEWER.JS — Page publique en lecture seule, mises à jour live
   ================================================================ */

import { store } from './state.js';
import { renderPoule, renderBracket } from './render.js';
import { $, $$, el, clear, onReady } from './app.js';
import { timeAgo } from './app.js';

let activeBracketTab = 'gold';
let lastHistoryLength = 0;

onReady(() => {
  $$('.tab[data-viewer-tab]').forEach((t) => {
    t.addEventListener('click', () => {
      $$('.tab[data-viewer-tab]').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      const target = t.dataset.viewerTab;
      $$('.tab-content').forEach((c) => c.classList.remove('active'));
      $('#tab-' + target).classList.add('active');
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
  store.subscribe(renderAll);
  renderAll(store.state);
});

function renderAll() {
  const t = store.currentTournament();
  renderHeader(t);
  renderPoules(t);
  renderKnockout();
  renderHistory(t);
  renderSchedule(t);
}

function renderHeader(t) {
  const ls = $('#live-status');
  if (!ls) return;
  clear(ls);
  if (!t) {
    ls.appendChild(el('div', { class: 'live-pill' }, '⏸ En attente'));
    return;
  }
  const phaseLabels = {
    'setup': '⚙️ Configuration', 'poules': '📋 Phase de poules',
    'finished-pool': '✅ Poules terminées', 'knockout': '🔥 Phase finale',
    'finished': '🏆 Tournoi terminé',
  };
  ls.appendChild(el('div', { class: 'live-pill' }, phaseLabels[t.phase] || 'En cours'));
  const title = $('#page-title');
  if (title) title.textContent = t.name;
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
  const t = store.currentTournament();
  if (!t || (!t.brackets.gold && !t.brackets.silver)) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '🏆'),
      el('h3', {}, 'La phase finale n\'a pas encore commencé.')));
    return;
  }
  if (activeBracketTab === 'gold' && t.brackets.gold) {
    container.appendChild(renderBracket(t.brackets.gold, t, { title: 'Tableau Or', kind: 'gold', editable: false }));
  } else if (activeBracketTab === 'silver' && t.brackets.silver) {
    container.appendChild(renderBracket(t.brackets.silver, t, { title: 'Consolante', kind: 'silver', editable: false }));
  } else if (activeBracketTab === 'silver' && !t.brackets.silver) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '🥈'),
      el('h3', {}, 'Pas de consolante cette fois.')));
  }
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
  if (!t || !t.schedule?.length) return;
  container.appendChild(el('h3', { style: { marginTop: '20px' } }, '📅 Planning'));
  // Group par date
  const byDate = {};
  t.schedule.forEach((s) => {
    if (!byDate[s.date]) byDate[s.date] = [];
    byDate[s.date].push(s);
  });
  const matchesMap = new Map();
  t.matches.forEach((m) => matchesMap.set(m.id, m));
  (t.bracketMatches || []).forEach((m) => matchesMap.set(m.id, m));
  Object.keys(byDate).sort().forEach((date) => {
    container.appendChild(el('h4', { style: { color: 'var(--color-primary)', marginTop: '12px' } },
      new Date(date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })));
    const table = el('table', { class: 'standings-table' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', {}, 'Heure'), el('th', {}, 'Terrain'), el('th', { style: { textAlign: 'left' } }, 'Match'), el('th', {}, 'Score'))));
    const tb = el('tbody');
    byDate[date].sort((a, b) => a.time.localeCompare(b.time)).forEach((s) => {
      const m = matchesMap.get(s.matchId);
      if (!m) return;
      const tA = t.teams.find((x) => x.id === m.teamA);
      const tB = t.teams.find((x) => x.id === m.teamB);
      tb.appendChild(el('tr', {},
        el('td', { style: { fontWeight: 600 } }, s.time),
        el('td', {}, 'T' + s.terrain),
        el('td', {}, (tA?.name || '?') + ' vs ' + (tB?.name || '?')),
        el('td', { class: 'text-center', style: { fontWeight: 600 } },
          (m.scoreA != null ? m.scoreA : '-') + ' - ' + (m.scoreB != null ? m.scoreB : '-'))
      ));
    });
    table.appendChild(tb);
    container.appendChild(table);
  });
}
