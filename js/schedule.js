/* ================================================================
   SCHEDULE.JS — Page planning global (multi-tournois + multi-terrains)
   ================================================================ */

import { store } from './state.js';
import { generateSchedule, detectScheduleConflicts } from './tournament.js';
import { $, $$, el, clear, toast, downloadFile, onReady } from './app.js';
import { exportElementAsImage } from './export.js';
import { isAuthenticated, renderLoginScreen, bindLogoutButton } from './auth.js';

// ================================================================
// STATE LOCAL
// ================================================================
let currentTournamentId = null;
let selectedTournamentIds = new Set();   // pour la vue multi-tournois
let editingSlot = null;
let activeCategory = 'all'; // 'all' | 'poules' | 'knockout'

// ================================================================
// CONFIG GLOBALE
// ================================================================
// La config par défaut est stockée dans localStorage (clé 'xapi-cup-schedule-config-v1')
// pour être partagée entre tous les tournois. Chaque tournoi garde son propre planning,
// mais les paramètres (terrains, durées, pauses) sont globaux.

const GLOBAL_CONFIG_KEY = 'xapi-cup-schedule-config-v1';

function getGlobalConfig() {
  try {
    const raw = localStorage.getItem(GLOBAL_CONFIG_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {
    nbTerrains: 2,
    matchDurationMin: 20,
    breakBetweenMin: 5,
    lunchBreakMin: 60,
    startTime: '09:00',
    endTime: '18:00',
    splitDays: false,
    days: [],
  };
}
function saveGlobalConfig(cfg) {
  localStorage.setItem(GLOBAL_CONFIG_KEY, JSON.stringify(cfg));
  toast('Config sauvegardée.', 'success');
}

// ================================================================
// ENTRY POINT
// ================================================================
onReady(() => {
  if (!isAuthenticated()) {
    document.body.style.overflow = 'hidden';
    renderLoginScreen(document.body, () => location.reload());
    return;
  }
  bindLogoutButton();
  bindUI();
  renderConfigInputs();
  renderTournamentSelector();

  // Re-render auto quand le state change (ex: brackets générés depuis l'admin)
  store.subscribe(() => {
    // Si on est en mode multi, on re-render pour prendre en compte les nouveaux creneaux
    if (selectedTournamentIds.size > 0 || currentTournamentId) {
      renderScheduleView();
    }
  });
  renderScheduleView();
});

function bindUI() {
  $('#save-global-config-btn')?.addEventListener('click', () => {
    const cfg = readConfigFromInputs();
    saveGlobalConfig(cfg);
    // Propager à tous les tournois
    store.setCurrent((s) => {
      s.config.nbTerrains = cfg.nbTerrains;
      s.config.matchDurationMin = cfg.matchDurationMin;
      s.config.breakBetweenMin = cfg.breakBetweenMin;
      s.config.lunchBreakMin = cfg.lunchBreakMin;
      s.config.startTime = cfg.startTime;
      s.config.endTime = cfg.endTime;
      s.config.splitDays = cfg.splitDays;
      s.config.days = cfg.days;
    });
    // Pour les autres tournois : on ne touche pas à leur state individuellement
    // L'utilisateur devra générer le planning par tournoi.
    renderScheduleView();
  });

  $('#export-global-schedule-btn')?.addEventListener('click', async () => {
    const node = $('#global-schedule-container');
    if (!node) return;
    try {
      await exportElementAsImage(node, 'xapi-cup-planning-global', 'png', 2);
      toast('Planning exporté !', 'success');
    } catch (e) { toast('Erreur : ' + e.message, 'danger'); }
  });

  $('#toggle-split-days')?.addEventListener('change', (e) => {
    renderDaysInputs();
  });
  $('#add-day-btn')?.addEventListener('click', () => {
    const cfg = readConfigFromInputs();
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + (cfg.days?.length || 0));
    cfg.days = cfg.days || [];
    cfg.days.push({ date: nextDate.toISOString().slice(0,10), startTime: '09:00', endTime: '18:00' });
    saveGlobalConfig(cfg);
    renderConfigInputs();
    renderDaysInputs();
  });

  $('#se-cancel')?.addEventListener('click', closeEditModal);
  $('#schedule-edit-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'schedule-edit-modal') closeEditModal();
  });
  $('#se-save')?.addEventListener('click', saveEditModal);

  // Tabs catégorie
  $$('.cat-tab').forEach((t) => {
    t.addEventListener('click', () => {
      activeCategory = t.dataset.cat;
      $$('.cat-tab').forEach((x) => x.classList.toggle('active', x === t));
      renderScheduleView();
    });
  });
}

// ================================================================
// CONFIG INPUTS
// ================================================================
function renderConfigInputs() {
  const cfg = getGlobalConfig();
  const setVal = (id, v) => { const e = $(`#${id}`); if (e) e.value = v; };
  setVal('nb-terrains', cfg.nbTerrains);
  setVal('match-duration', cfg.matchDurationMin);
  setVal('break-between', cfg.breakBetweenMin);
  setVal('lunch-break', cfg.lunchBreakMin);
  setVal('start-time', cfg.startTime);
  setVal('end-time', cfg.endTime);
  const split = $('#toggle-split-days'); if (split) split.checked = !!cfg.splitDays;
  renderDaysInputs();
}

function renderDaysInputs() {
  const cfg = getGlobalConfig();
  const container = $('#days-container');
  if (!container) return;
  clear(container);
  const addRow = $('#add-day-row');
  if (!$('#toggle-split-days').checked) {
    addRow.style.display = 'none';
    return;
  }
  addRow.style.display = '';
  cfg.days = cfg.days || [];
  cfg.days.forEach((day, idx) => {
    const row = el('div', { class: 'form-row', style: { marginBottom: '8px', alignItems: 'end' } },
      el('div', { class: 'form-group', style: { flex: 1 } },
        el('label', {}, `Jour ${idx + 1}`),
        el('input', { type: 'date', class: 'input', value: day.date,
          onchange: (e) => { cfg.days[idx].date = e.target.value; saveGlobalConfig(cfg); } })),
      el('div', { class: 'form-group', style: { flex: 1 } },
        el('label', {}, 'Début'),
        el('input', { type: 'time', class: 'input', value: day.startTime,
          onchange: (e) => { cfg.days[idx].startTime = e.target.value; saveGlobalConfig(cfg); } })),
      el('div', { class: 'form-group', style: { flex: 1 } },
        el('label', {}, 'Fin'),
        el('input', { type: 'time', class: 'input', value: day.endTime,
          onchange: (e) => { cfg.days[idx].endTime = e.target.value; saveGlobalConfig(cfg); } })),
      el('div', { class: 'form-group', style: { flex: 0 } },
        el('button', { class: 'btn btn-sm btn-danger',
          onclick: () => { cfg.days.splice(idx, 1); saveGlobalConfig(cfg); renderConfigInputs(); }
        }, '🗑️'))
    );
    container.appendChild(row);
  });
}

function readConfigFromInputs() {
  return {
    nbTerrains: parseInt($('#nb-terrains').value, 10) || 2,
    matchDurationMin: parseInt($('#match-duration').value, 10) || 20,
    breakBetweenMin: parseInt($('#break-between').value, 10) || 5,
    lunchBreakMin: parseInt($('#lunch-break').value, 10) || 60,
    startTime: $('#start-time').value || '09:00',
    endTime: $('#end-time').value || '18:00',
    splitDays: $('#toggle-split-days').checked,
    days: getGlobalConfig().days || [],
  };
}

// ================================================================
// TOURNOIS
// ================================================================
function renderTournamentSelector() {
  const ts = store.listTournaments().filter((t) => !t.archived);
  const container = $('#tournament-selector');
  if (!container) return;
  clear(container);
  if (!ts.length) {
    container.appendChild(el('div', { class: 'muted' },
      'Aucun tournoi. Va dans ', el('a', { href: 'admin.html' }, 'Admin'), ' pour en créer un.'));
    return;
  }
  container.appendChild(el('h3', { style: { margin: '0 0 8px' } }, 'Sélectionne un tournoi :'));
  const wrap = el('div', { class: 'tournament-cards' });
  ts.forEach((t) => {
    const card = el('button', {
      class: 't-card' + (t.id === currentTournamentId ? ' selected' : ''),
      onclick: () => {
        currentTournamentId = t.id;
        store.switchTournament(t.id);
        renderTournamentSelector();
        renderScheduleView();
      },
    },
      el('div', { class: 't-card-header' },
        el('h3', { class: 't-card-name' }, t.name),
        el('span', { class: 't-card-badge' }, `${t.teams.length} équipes`),
      ),
      el('div', { class: 't-card-stats' },
        el('div', { class: 't-card-stat' },
          el('div', { class: 't-card-stat-num' }, String(t.matches.length)),
          el('div', { class: 't-card-stat-label' }, 'Poules')),
        el('div', { class: 't-card-stat' },
          el('div', { class: 't-card-stat-num' }, String((t.bracketMatches || []).length)),
          el('div', { class: 't-card-stat-label' }, 'Arbres')),
        el('div', { class: 't-card-stat' },
          el('div', { class: 't-card-stat-num' }, String((t.schedule || []).length)),
          el('div', { class: 't-card-stat-label' }, 'Créneaux')),
      ),
    );
    wrap.appendChild(card);
  });
  container.appendChild(wrap);
}

// ================================================================
// VUE PLANNING
// ================================================================
function renderScheduleView() {
  const container = $('#global-schedule-container');
  const conflictPanel = $('#conflict-panel');
  if (!container) return;
  clear(container); clear(conflictPanel);
  // Pas de tournoi sélectionné : on montre le sélecteur
  if (!currentTournamentId && selectedTournamentIds.size === 0) {
    renderTournamentPicker();
    return;
  }
  // Multi-tournois : on affiche le planning consolidé
  if (selectedTournamentIds.size > 0) {
    renderMultiTournamentView();
    return;
  }
  // Sinon : vue mono-tournoi (existante)
  renderSingleTournamentView();
}

/**
 * Sélecteur de tournois (1ere visite) : liste de cards à cocher
 * pour générer un planning multi-tournois.
 */
function renderTournamentPicker() {
  const container = $('#global-schedule-container');
  const ts = store.listTournaments().filter((t) => !t.archived);
  if (!ts.length) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '🏆'),
      el('h3', {}, 'Aucun tournoi'),
      el('p', {}, 'Crée d\'abord un tournoi depuis l\'admin.')));
    return;
  }
  container.appendChild(el('div', { class: 'picker-header' },
    el('h2', {}, '📅 Sélectionnez les tournois'),
    el('p', { class: 'muted' }, 'Cochez un ou plusieurs tournois pour voir leurs plannings consolidés avec détection des conflits.')));

  const grid = el('div', { class: 'picker-grid' });
  ts.forEach((t) => {
    const card = el('label', { class: 'picker-card' + (selectedTournamentIds.has(t.id) ? ' active' : '') },
      el('input', {
        type: 'checkbox',
        checked: selectedTournamentIds.has(t.id),
        onchange: (e) => {
          if (e.target.checked) selectedTournamentIds.add(t.id);
          else selectedTournamentIds.delete(t.id);
          if (selectedTournamentIds.size === 1 && !currentTournamentId) {
            // Si 1 seul selectionne, on bascule en vue mono
            currentTournamentId = [...selectedTournamentIds][0];
            selectedTournamentIds.clear();
          }
          renderScheduleView();
        },
      }),
      el('div', { class: 'picker-card-body' },
        el('div', { class: 'picker-card-name' }, t.name),
        t.date ? el('div', { class: 'picker-card-date' }, '📅 ' + new Date(t.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })) : null,
        el('div', { class: 'picker-card-stats muted' },
          `${t.teams.length} équipes · ${t.matches.length + (t.bracketMatches?.length || 0)} matchs · ${(t.schedule || []).length} créneaux`),
      ),
    );
    grid.appendChild(card);
  });
  container.appendChild(grid);
  if (selectedTournamentIds.size > 0) {
    const btn = el('button', {
      class: 'btn btn-primary btn-lg mt-3',
      onclick: () => renderScheduleView(),
    }, `📅 Voir le planning consolidé (${selectedTournamentIds.size} tournoi${selectedTournamentIds.size > 1 ? 's' : ''})`);
    container.appendChild(btn);
  }
}

/**
 * Vue multi-tournois : fusionne les plannings et détecte les conflits cross-tournois.
 */
function renderMultiTournamentView() {
  const container = $('#global-schedule-container');
  const conflictPanel = $('#conflict-panel');
  // Bandeau de selection
  const ts = [...selectedTournamentIds].map((id) => store.getTournament(id)).filter(Boolean);
  const header = el('div', { class: 'multi-t-header' },
    el('button', { class: 'btn btn-sm',
      style: { background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' },
      onclick: () => { selectedTournamentIds.clear(); currentTournamentId = null; renderScheduleView(); }
    }, '← Changer de tournois'),
    el('h2', { style: { margin: 0 } }, `📅 Planning consolidé · ${ts.length} tournoi${ts.length > 1 ? 's' : ''}`),
  );
  container.appendChild(header);

  // Liste des chips par tournoi
  const chips = el('div', { class: 'multi-t-chips' });
  ts.forEach((t) => {
    chips.appendChild(el('span', { class: 'multi-t-chip' },
      t.name,
      el('button', {
        class: 'multi-t-chip-x',
        title: 'Retirer',
        onclick: () => {
          selectedTournamentIds.delete(t.id);
          if (selectedTournamentIds.size === 0) renderScheduleView();
          else renderScheduleView();
        },
      }, '×'),
    ));
  });
  container.appendChild(chips);

  // === Collecte de tous les creneaux + matchs ===
  const allSchedules = [];
  const allMatches = new Map();
  const teamsByTour = new Map();
  ts.forEach((t) => {
    (t.schedule || []).forEach((s) => {
      // Annoter avec le nom du tournoi
      allSchedules.push({ ...s, _tournament: t.name, _tournamentId: t.id });
    });
    t.matches.forEach((m) => { if (!allMatches.has(m.id)) allMatches.set(m.id, { ...m, _tName: t.name }); });
    (t.bracketMatches || []).forEach((m) => { if (!allMatches.has(m.id)) allMatches.set(m.id, { ...m, _tName: t.name }); });
    teamsByTour.set(t.id, t.teams);
  });

  if (allSchedules.length === 0) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '📅'),
      el('h3', {}, 'Aucun créneau planifié'),
      el('p', { class: 'muted' }, 'Va dans l\'admin d\'un de ces tournois → onglet Planning → Génère.')));
    return;
  }

  // === Tri par datetime ===
  allSchedules.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  // === Detection conflits cross-tournois ===
  // Un conflit = meme creneau (date+time) ET meme terrain, matchs différents
  // OU meme equipe qui joue 2 matchs en meme temps
  const conflicts = [];
  // Terrain conflicts
  for (let i = 0; i < allSchedules.length; i++) {
    for (let j = i + 1; j < allSchedules.length; j++) {
      const a = allSchedules[i], b = allSchedules[j];
      if (a.date === b.date && a.time === b.time) {
        if (a.terrain === b.terrain && a.matchId !== b.matchId) {
          conflicts.push({ type: 'terrain', a, b, msg: `Terrain ${a.terrain} pris 2× à ${a.time} (${a._tournament} vs ${b._tournament})` });
        }
        // Equipes qui jouent 2 matchs en meme temps
        const ma = allMatches.get(a.matchId);
        const mb = allMatches.get(b.matchId);
        if (ma && mb) {
          const aTeams = [ma.slotA || ma.teamA, ma.slotB || ma.teamB].filter(Boolean);
          const bTeams = [mb.slotA || mb.teamA, mb.slotB || mb.teamB].filter(Boolean);
          const shared = aTeams.find((tid) => bTeams.includes(tid));
          if (shared) {
            // Resoudre le nom
            const teamObj = [...teamsByTour.values()].flat().find((x) => x.id === shared);
            conflicts.push({ type: 'equipe', a, b, msg: `Équipe "${teamObj?.name || shared}" joue 2× à ${a.time} (${a._tournament} vs ${b._tournament})` });
          }
        }
      }
    }
  }

  // === Rendu tableau consolide ===
  // Colonnes : Heure | Terrain 1..N (max terrains) | avec badge tournoi par case
  const nbTerrains = Math.max(...allSchedules.map((s) => s.terrain), 1);
  // Group par date
  const byDate = new Map();
  allSchedules.forEach((s) => {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date).push(s);
  });

  Array.from(byDate.entries()).sort(([a],[b]) => a.localeCompare(b)).forEach(([date, daySlots]) => {
    container.appendChild(el('h3', { style: { color: 'var(--color-primary)', marginTop: '20px' } },
      new Date(date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })));
    // Group par (time) pour avoir 1 ligne = 1 creneau multi-terrain
    const byTime = new Map();
    daySlots.forEach((s) => {
      if (!byTime.has(s.time)) byTime.set(s.time, []);
      byTime.get(s.time).push(s);
    });
    const table = el('table', { class: 'standings-table schedule-consolidated' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', {}, 'Heure'),
      ...Array.from({ length: nbTerrains }, (_, i) => el('th', {}, `T${i + 1}`)),
    )));
    const tb = el('tbody');
    Array.from(byTime.entries()).sort(([a],[b]) => a.localeCompare(b)).forEach(([time, slots]) => {
      const tr = el('tr');
      tr.appendChild(el('td', { style: { fontWeight: 600, verticalAlign: 'top' } }, time));
      for (let i = 0; i < nbTerrains; i++) {
        const slot = slots.find((s) => s.terrain === i + 1);
        if (!slot) { tr.appendChild(el('td', { class: 'muted', style: { color: '#aaa' } }, '—')); continue; }
        const m = allMatches.get(slot.matchId);
        if (!m) { tr.appendChild(el('td', {}, '?')); continue; }
        const tA = [...teamsByTour.values()].flat().find((x) => x.id === (m.slotA || m.teamA));
        const tB = [...teamsByTour.values()].flat().find((x) => x.id === (m.slotB || m.teamB));
        const aWins = m.winnerSlot === 'A';
        const bWins = m.winnerSlot === 'B';
        tr.appendChild(el('td', { class: 'schedule-cell' },
          el('div', { class: 'schedule-cell-tour', style: { fontSize: '0.7rem', color: 'var(--color-muted)', fontWeight: 600, textTransform: 'uppercase' } }, slot._tournament),
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

  // === Conflits ===
  if (conflicts.length) {
    conflictPanel.appendChild(el('h3', {}, '⚠ Conflits détectés entre tournois'));
    conflictPanel.appendChild(el('div', { class: 'alert alert-warn' },
      el('ul', {}, ...conflicts.map((c) => el('li', {}, c.msg)))));
  } else {
    conflictPanel.appendChild(el('div', { class: 'alert alert-info' },
      '✅ Aucun conflit détecté entre les tournois sélectionnés.'));
  }
}

/**
 * Vue mono-tournoi (existante, legerement adaptee pour rafraichir le planning brackets)
 */
function renderSingleTournamentView() {
  const container = $('#global-schedule-container');
  const conflictPanel = $('#conflict-panel');
  const t = store.currentTournament();
  if (!t || t.id !== currentTournamentId) {
    store.switchTournament(currentTournamentId);
    setTimeout(renderSingleTournamentView, 50);
    return;
  }
  // Bouton retour
  container.appendChild(el('div', { class: 'mt-2 mb-2' },
    el('button', { class: 'btn btn-sm',
      style: { background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' },
      onclick: () => { currentTournamentId = null; selectedTournamentIds.clear(); renderScheduleView(); }
    }, '← Voir tous les tournois'),
  ));

  // Tabs catégorie
  const tabNav = el('div', { class: 'tabs' },
    el('button', { class: 'cat-tab tab' + (activeCategory === 'all' ? ' active' : ''),
      dataset: { cat: 'all' } }, 'Tout'),
    el('button', { class: 'cat-tab tab' + (activeCategory === 'poules' ? ' active' : ''),
      dataset: { cat: 'poules' } }, `📋 Poules (${t.matches.length})`),
    el('button', { class: 'cat-tab tab' + (activeCategory === 'knockout' ? ' active' : ''),
      dataset: { cat: 'knockout' } }, `🏆 Phase finale (${(t.bracketMatches || []).length})`),
  );
  // Bind clicks
  container.appendChild(tabNav);
  $$('.cat-tab', tabNav).forEach((b) => {
    b.addEventListener('click', () => {
      activeCategory = b.dataset.cat;
      renderSingleTournamentView();
    });
  });

  // Bouton générer
  const genBtn = el('div', { class: 'mt-3', style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } },
    el('button', { class: 'btn btn-primary',
      onclick: () => generateScheduleForCategory(t, activeCategory)
    }, '🎲 Générer le planning'),
    el('span', { class: 'muted' },
      `${(t.schedule || []).length} créneau(x) déjà planifié(s)`),
  );
  container.appendChild(genBtn);

  // Source des matchs
  let sourceMatches = [];
  if (activeCategory === 'poules') sourceMatches = t.matches;
  else if (activeCategory === 'knockout') sourceMatches = t.bracketMatches || [];
  else sourceMatches = [...t.matches, ...(t.bracketMatches || [])];

  const scheduled = (t.schedule || []).filter((s) => sourceMatches.some((m) => m.id === s.matchId));

  if (!scheduled.length) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('p', {}, 'Aucun créneau. Clique sur "Générer le planning" pour créer les créneaux multi-terrains.')));
  } else {
    container.appendChild(renderMultiTerrainTable(scheduled, sourceMatches, t));
  }

  // Toggle visible côté public
  const publicToggle = el('label', { class: 'checkbox-group', style: { marginTop: '16px', display: 'inline-flex' } },
    el('input', { type: 'checkbox',
      checked: t.config?.schedulePublic !== false,
      onchange: (e) => {
        store.setCurrent((s) => { s.config.schedulePublic = e.target.checked; });
        toast(e.target.checked ? 'Planning visible côté public.' : 'Planning caché côté public.', 'info');
      }
    }),
    el('span', {}, 'Visible côté public'),
  );
  container.appendChild(publicToggle);

  // Conflits
  const conflicts = detectScheduleConflicts(scheduled, sourceMatches, t.teams);
  if (conflicts.length) {
    conflictPanel.appendChild(el('h3', {}, '⚠ Conflits détectés'));
    conflictPanel.appendChild(el('div', { class: 'alert alert-warn' },
      el('ul', {}, ...conflicts.map((c) => el('li', {},
        `${c.team} — ${c.reason} (T${c.slot1.terrain} et T${c.slot2.terrain} à ${c.slot1.time})`)))));
  }
}

// ================================================================
// TABLE MULTI-TERRAINS
// ================================================================
function renderMultiTerrainTable(schedule, matches, t) {
  const matchById = new Map(matches.map((m) => [m.id, m]));
  // Détermine le nombre de terrains max utilisé (ou nb configuré)
  const nbTerrains = Math.max(
    t?.config?.nbTerrains || 1,
    ...schedule.map((s) => s.terrain)
  );
  // Group par (date, time) → slots
  const slotsByDT = new Map();
  schedule.forEach((s) => {
    const key = s.date + '__' + s.time;
    if (!slotsByDT.has(key)) slotsByDT.set(key, { date: s.date, time: s.time, terrains: [] });
    slotsByDT.get(key).terrains.push(s);
  });
  const slots = Array.from(slotsByDT.values()).sort((a, b) =>
    (a.date + a.time).localeCompare(b.date + b.time)
  );

  const table = el('table', { class: 'schedule-table' });
  table.appendChild(el('thead', {}, el('tr', {},
    el('th', {}, 'Date'),
    el('th', {}, 'Heure'),
    ...Array.from({ length: nbTerrains }, (_, i) => el('th', {}, `T${i + 1}`)),
  )));
  const tb = el('tbody');
  slots.forEach((slot) => {
    const tr = el('tr', { class: 'schedule-slot' });
    tr.appendChild(el('td', {}, slot.date));
    tr.appendChild(el('td', { style: { fontWeight: 600 } }, slot.time));
    for (let i = 0; i < nbTerrains; i++) {
      const sc = slot.terrains.find((s) => s.terrain === i + 1);
      if (!sc) {
        tr.appendChild(el('td', { class: 'muted', style: { color: '#aaa' } }, '—'));
        continue;
      }
      const m = matchById.get(sc.matchId);
      if (!m) { tr.appendChild(el('td', {}, '?')); continue; }
      const tA = t.teams.find((x) => x.id === m.teamA);
      const tB = t.teams.find((x) => x.id === m.teamB);
      const aWins = m.winnerSlot === 'A';
      const bWins = m.winnerSlot === 'B';
      const cell = el('td', {
        class: 'schedule-cell editable',
        title: 'Cliquer pour modifier',
        onclick: () => openEditModal(sc),
      },
        el('div', { class: 'schedule-cell-teams' },
          el('span', { class: aWins ? 'winner' : '' }, tA?.name || '?'),
          el('span', { class: 'muted', style: { margin: '0 4px' } }, 'vs'),
          el('span', { class: bWins ? 'winner' : '' }, tB?.name || '?'),
        ),
        el('div', { class: 'schedule-cell-score' },
          m.scoreA != null ? `${m.scoreA} - ${m.scoreB}` : el('span', { class: 'muted' }, 'à jouer'))
      );
      tr.appendChild(cell);
    }
    tb.appendChild(tr);
  });
  table.appendChild(tb);
  return table;
}

// ================================================================
// GÉNÉRATION
// ================================================================
function generateScheduleForCategory(t, category) {
  let sourceMatches = [];
  if (category === 'poules') sourceMatches = t.matches;
  else if (category === 'knockout') sourceMatches = t.bracketMatches || [];
  else sourceMatches = [...t.matches, ...(t.bracketMatches || [])];
  if (!sourceMatches.length) {
    if (category === 'knockout') {
      toast('Aucun match de phase finale. Génère d\'abord les arbres depuis l\'onglet "Arbres" de l\'admin.', 'warn');
    } else {
      toast('Aucun match à planifier.', 'warn');
    }
    return;
  }
  const cfg = readConfigFromInputs();
  const newSched = generateSchedule(sourceMatches, cfg);
  store.setCurrent((s) => {
    const sourceIds = new Set(sourceMatches.map((m) => m.id));
    s.schedule = (s.schedule || []).filter((sc) => !sourceIds.has(sc.matchId));
    s.schedule.push(...newSched);
    s.history.push({
      at: new Date().toISOString(), type: 'schedule-generated',
      label: `Planning généré : ${newSched.length} matchs sur ${category}`,
    });
  });
  toast(`Planning généré : ${newSched.length} matchs.`, 'success');
  renderScheduleView();
}

/**
 * Synchronise le planning avec les matchs bracket existants.
 * A appeler après la génération des arbres (buildBracket) pour que les matchs
 * bracket apparaissent automatiquement dans le planning de la catégorie knockout.
 */
export function refreshKnockoutSchedule() {
  const t = store.currentTournament();
  if (!t) return;
  if (!t.bracketMatches || t.bracketMatches.length === 0) return;
  const cfg = getGlobalConfig();
  const newSched = generateSchedule(t.bracketMatches, cfg);
  const sourceIds = new Set(t.bracketMatches.map((m) => m.id));
  // Replacer les anciens creneaux bracket
  store.setCurrent((s) => {
    s.schedule = (s.schedule || []).filter((sc) => !sourceIds.has(sc.matchId));
    s.schedule.push(...newSched);
  });
  toast(`Planning bracket synchronisé (${newSched.length} matchs).`, 'info');
}

// ================================================================
// MODAL ÉDITION
// ================================================================
function openEditModal(slot) {
  editingSlot = slot;
  $('#se-date').value = slot.date;
  $('#se-time').value = slot.time;
  $('#se-terrain').value = slot.terrain;
  $('#se-error').innerHTML = '';
  $('#schedule-edit-modal').classList.add('show');
}
function closeEditModal() {
  $('#schedule-edit-modal').classList.remove('show');
  editingSlot = null;
}
function saveEditModal() {
  if (!editingSlot) return;
  const date = $('#se-date').value;
  const time = $('#se-time').value;
  const terrain = parseInt($('#se-terrain').value, 10);
  const err = $('#se-error');
  err.innerHTML = '';
  if (!date || !time) { err.innerHTML = '<div class="alert alert-danger" style="margin-top:8px;">Date et heure requises.</div>'; return; }
  if (isNaN(terrain) || terrain < 1) { err.innerHTML = '<div class="alert alert-danger" style="margin-top:8px;">Terrain invalide.</div>'; return; }
  store.setCurrent((s) => {
    const sc = (s.schedule || []).find((x) => x.matchId === editingSlot.matchId);
    if (sc) {
      sc.date = date; sc.time = time; sc.terrain = terrain;
      s.history.push({ at: new Date().toISOString(), type: 'schedule-edited',
        label: `Créneau modifié : ${date} ${time} T${terrain}` });
    }
  });
  closeEditModal();
  toast('Créneau modifié.', 'success');
  renderScheduleView();
}