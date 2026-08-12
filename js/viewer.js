/* ================================================================
   VIEWER.JS — Page publique en lecture seule, mises à jour live
   ================================================================ */

import { store } from './state.js';
import { renderPoule, renderBracket } from './render.js';
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

  // === Sous-onglets Poules / Phase finale ===
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

/**
 * Si plusieurs tournois publics existent, on affiche un sélecteur.
 * Sinon, on n'affiche rien (le viewer pointe directement sur le seul tournoi public).
 */
function renderTournamentSelector() {
  const container = $('#tournament-selector');
  const section = $('#tournament-selector-section');
  if (!container || !section) return;

  const publics = store.listPublicTournaments();
  clear(container);

  if (publics.length === 0) {
    section.style.display = 'none';
    // Si on a supprimé le tournoi courant côté viewer, on ne montre rien
    return;
  }

  if (publics.length === 1) {
    // Un seul tournoi public : on le définit comme courant côté viewer
    setViewerCurrentTournament(publics[0].id);
    section.style.display = 'none';
    return;
  }

  // Plusieurs tournois publics : on affiche le sélecteur
  section.style.display = '';
  const currentId = getViewerCurrentTournamentId();
  if (!currentId || !publics.some((t) => t.id === currentId)) {
    // Sélectionner le premier par défaut
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

/**
 * Récupère le tournoi "viewer courant" :
 *  - celui choisi via le sélecteur (s'il y en a plusieurs publics)
 *  - sinon le seul tournoi public
 *  - sinon le premier tournoi non archivé
 */
function getViewerTournament() {
  const publics = store.listPublicTournaments();
  if (publics.length === 0) {
    // Aucun tournoi public — fallback sur le 1er non archivé
    return store.state.tournaments.find((t) => !t.archived) || store.currentTournament();
  }
  if (publics.length === 1) return publics[0];
  // Plusieurs publics : respecter la sélection
  const sel = getViewerCurrentTournamentId();
  return publics.find((t) => t.id === sel) || publics[0];
}

function renderAll() {
  const t = getViewerTournament();
  // Synchroniser le store (pour que renderHeader/etc utilisent le bon)
  if (t && t.id !== store.state.currentTournamentId) {
    store.state.currentTournamentId = t.id;
  }
  renderHeader(t);
  renderPoules(t);
  renderKnockout();
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

// Badge : compteur de nouveaux events
function updateFeedBadge() {
  const aside = $('#live-feed-aside');
  const badge = $('#live-feed-toggle-badge');
  if (!badge) return;
  const t = getViewerTournament();
  const items = t?.history || [];
  // Compteur de différence par rapport au render précédent
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