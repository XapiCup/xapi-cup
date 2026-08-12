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
  // Onglets principaux (live / schedule)
  $$('.v-tab').forEach((t) => {
    t.addEventListener('click', () => {
      $$('.v-tab').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      const target = t.dataset.viewerTab;
      $$('.tab-content').forEach((c) => c.classList.remove('active'));
      $('#tab-' + target)?.classList.add('active');
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

  // Feed live : toggle
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
  // Badge : compteur de nouveaux events
  let lastLen = 0;
  function updateFeedBadge() {
    const items = store.currentTournament()?.history || [];
    if (items.length > lastLen) {
      const newCount = items.length - lastLen;
      const badge = $('#live-feed-toggle-badge');
      if (badge && aside?.classList.contains('collapsed')) {
        badge.textContent = newCount > 9 ? '9+' : newCount;
        badge.style.display = 'flex';
      }
    }
    lastLen = items.length;
  }
  store.subscribe(() => {
    renderAll(store.state);
    updateFeedBadge();
  });
  renderAll(store.state);
  updateFeedBadge();
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
  if (t.config?.schedulePublic === false) {
    container.appendChild(el('div', { class: 'alert alert-info' },
      'Le planning est actuellement masqué par l\'administrateur.'));
    return;
  }

  container.appendChild(el('h2', { style: { marginTop: '0' } }, '📅 Planning'));
  container.appendChild(el('p', { class: 'muted', style: { marginTop: '4px' } },
    'Matchs simultanés joués en parallèle sur plusieurs terrains.'));

  // Group par (date, time) → slots
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

  // Group par date
  const slotsByDate = new Map();
  slots.forEach((s) => {
    if (!slotsByDate.has(s.date)) slotsByDate.set(s.date, []);
    slotsByDate.get(s.date).push(s);
  });

  // Détermine le nombre de terrains max utilisé (ou nb configuré)
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
        const tA = t.teams.find((x) => x.id === m.teamA);
        const tB = t.teams.find((x) => x.id === m.teamB);
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

// ================================================================
// ONGLETS VIEWER (live | schedule)
// ================================================================
function bindViewerTabs() {
  $$('.v-tab').forEach((t) => {
    t.addEventListener('click', () => {
      const target = t.dataset.viewerTab;
      $$('.v-tab').forEach((x) => x.classList.toggle('active', x === t));
      $$('.tab-content').forEach((c) => c.classList.toggle('active', c.id === `tab-${target}`));
    });
  });
}
