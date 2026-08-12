/* ================================================================
   SCHEDULE.JS — Page planning global (multi-tournois + multi-terrains)
   ================================================================ */

import { store } from './state.js';
import { generateSchedule, detectScheduleConflicts, detectAllConflicts, autoResolveConflicts } from './tournament.js';
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
// VUE PLANNING (centree sur les TERRAINS)
// ================================================================
function renderScheduleView() {
  const container = $('#global-schedule-container');
  const conflictPanel = $('#conflict-panel');
  if (!container) return;
  clear(container); clear(conflictPanel);
  renderTerrainView();
}

/**
 * Vue principale : grille Terrain x Creneau avec TOUS les matchs de TOUS les tournois.
 * Pas de selection preliminaire : tout est melange.
 */
function renderTerrainView() {
  const container = $('#global-schedule-container');
  const ts = store.listTournaments().filter((t) => !t.archived);

  // === Collecte globale ===
  const allSchedules = [];
  const allMatches = new Map();
  const teamsByTour = new Map();
  const cfg = getGlobalConfig();
  const nbTerrains = Math.max(
    cfg.nbTerrains || 8,
    ...ts.flatMap((t) => (t.schedule || []).map((s) => s.terrain))
  );

  ts.forEach((t) => {
    (t.schedule || []).forEach((s) => {
      allSchedules.push({ ...s, _tournament: t.name, _tournamentId: t.id });
    });
    t.matches.forEach((m) => { if (!allMatches.has(m.id)) allMatches.set(m.id, { ...m, _tName: t.name }); });
    (t.bracketMatches || []).forEach((m) => { if (!allMatches.has(m.id)) allMatches.set(m.id, { ...m, _tName: t.name }); });
    teamsByTour.set(t.id, t.teams);
  });

  // === Toolbar : actions globales ===
  const toolbar = el('div', { class: 'terrain-toolbar' },
    el('button', { class: 'btn btn-primary',
      onclick: () => generateAllSchedules(ts, cfg)
    }, '🎲 Générer le planning global'),
    el('button', { class: 'btn',
      style: { background: 'var(--color-warning)', color: '#fff' },
      onclick: () => resolveAllConflicts(ts, cfg)
    }, '🛠️ Résoudre les conflits'),
    el('span', { class: 'muted', style: { marginLeft: 'auto' } },
      `${allSchedules.length} créneaux planifiés · ${ts.length} tournoi${ts.length > 1 ? 's' : ''}`),
  );
  container.appendChild(toolbar);

  // === Conflits ===
  const conflicts = detectAllConflicts(allSchedules, [...allMatches.values()],
    [...teamsByTour.values()].flat());
  const totalConflicts = conflicts.terrain.length + conflicts.equipe.length;
  const conflictPanel = $('#conflict-panel');
  if (totalConflicts > 0) {
    conflictPanel.appendChild(el('div', { class: 'alert alert-warn' },
      el('strong', {}, `⚠️ ${totalConflicts} conflit${totalConflicts > 1 ? 's' : ''} détecté${totalConflicts > 1 ? 's' : ''} :`),
      conflicts.terrain.length > 0 ? el('div', {}, `  · ${conflicts.terrain.length} conflit(s) de terrain`) : null,
      conflicts.equipe.length > 0 ? el('div', {}, `  · ${conflicts.equipe.length} conflit(s) d'équipe`) : null,
      el('div', { style: { marginTop: '8px' } },
        'Clique sur "🛠️ Résoudre les conflits" pour les corriger automatiquement.',
      ),
    ));
  } else if (allSchedules.length > 0) {
    conflictPanel.appendChild(el('div', { class: 'alert alert-info' },
      '✅ Aucun conflit détecté.'));
  }

  // === Tableau principal : lignes=créneaux, colonnes=terrains ===
  if (allSchedules.length === 0) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '📅'),
      el('h3', {}, 'Aucun planning généré'),
      el('p', { class: 'muted' }, 'Clique sur "🎲 Générer le planning global" pour créer les créneaux multi-terrains.')));
    return;
  }

  // Group par date puis par créneau (date+time)
  const byDate = new Map();
  allSchedules.forEach((s) => {
    if (!byDate.has(s.date)) byDate.set(s.date, new Map());
    const byTime = byDate.get(s.date);
    if (!byTime.has(s.time)) byTime.set(s.time, []);
    byTime.get(s.time).push(s);
  });

  Array.from(byDate.entries()).sort(([a],[b]) => a.localeCompare(b)).forEach(([date, daySlots]) => {
    container.appendChild(el('h3', { class: 'terrain-day-title' },
      '📅 ' + new Date(date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })));
    const table = el('table', { class: 'standings-table terrain-grid' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', { style: { minWidth: '80px' } }, 'Heure'),
      ...Array.from({ length: nbTerrains }, (_, i) => el('th', { style: { textAlign: 'center' } }, `T${i + 1}`)),
    )));
    const tb = el('tbody');
    // Trier les créneaux par heure
    const sortedTimes = Array.from(daySlots.entries()).sort(([a],[b]) => a.localeCompare(b));
    sortedTimes.forEach(([time, slots]) => {
      const tr = el('tr');
      tr.appendChild(el('td', { class: 'terrain-time', style: { fontWeight: 700, verticalAlign: 'top', background: 'var(--color-surface-2)' } }, time));
      for (let t = 1; t <= nbTerrains; t++) {
        const slot = slots.find((s) => s.terrain === t);
        if (!slot) {
          tr.appendChild(el('td', { class: 'terrain-cell-empty', style: { color: '#ccc', textAlign: 'center' } }, '—'));
          continue;
        }
        const m = allMatches.get(slot.matchId);
        if (!m) {
          tr.appendChild(el('td', {}, '?'));
          continue;
        }
        const teamObj = [...teamsByTour.values()].flat();
        const tA = teamObj.find((x) => x.id === (m.slotA || m.teamA));
        const tB = teamObj.find((x) => x.id === (m.slotB || m.teamB));
        const aWins = m.winnerSlot === 'A';
        const bWins = m.winnerSlot === 'B';
        const cell = el('td', { class: 'terrain-cell' },
          el('div', { class: 'terrain-cell-tour' }, slot._tournament),
          el('div', { class: aWins ? 'winner' : '' }, (tA?.name || '?').substring(0, 16)),
          el('div', { class: 'muted', style: { fontSize: '0.75rem', textAlign: 'center' } }, 'vs'),
          el('div', { class: bWins ? 'winner' : '' }, (tB?.name || '?').substring(0, 16)),
          m.scoreA != null ? el('div', { class: 'terrain-cell-score' }, `${m.scoreA} - ${m.scoreB}`) : null,
          slot._reassigned ? el('div', { class: 'terrain-cell-badge' }, '🔄 déplacé') : null,
        );
        tr.appendChild(cell);
      }
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    container.appendChild(table);
  });
}

// === Génère le planning global (tous tournois confondus) ===
function generateAllSchedules(ts, cfg) {
  if (!ts.length) { toast('Aucun tournoi.', 'warn'); return; }
  let totalAdded = 0;
  store.setCurrent((s) => {
    // Reset schedule global (celui du 1er tournoi — convention)
    // En fait, chaque tournoi a son propre schedule.
    // Pour la vue globale, on va generer pour CHAQUE tournoi.
    ts.forEach((t) => {
      // Source : poules + bracket si dispo
      const allMatches = [
        ...t.matches,
        ...(t.bracketMatches || []),
      ];
      if (!allMatches.length) return;
      const newSched = generateSchedule(allMatches, cfg);
      // On vide l'ancien schedule et on met le nouveau
      t.schedule = newSched;
      t.config = { ...(t.config || {}), nbTerrains: cfg.nbTerrains };
      totalAdded += newSched.length;
      // History sur le 1er tournoi (convention)
      if (t.id === ts[0].id) {
        s.history.push({
          at: new Date().toISOString(),
          type: 'schedule-generated',
          label: `Planning généré : ${newSched.length} matchs sur ${t.name}`,
        });
      }
    });
  });
  toast(`Planning généré : ${totalAdded} créneaux au total.`, 'success');
  renderScheduleView();
}

// === Résout automatiquement les conflits sur tous les tournois ===
function resolveAllConflicts(ts, cfg) {
  let totalResolved = 0;
  store.setCurrent((s) => {
    ts.forEach((t) => {
      const allMatches = [...t.matches, ...(t.bracketMatches || [])];
      if (!t.schedule?.length || !allMatches.length) return;
      const result = autoResolveConflicts(t.schedule, allMatches, cfg);
      if (result.resolved > 0) {
        t.schedule = result.schedule;
        totalResolved += result.resolved;
      }
    });
  });
  if (totalResolved > 0) {
    toast(`${totalResolved} conflit(s) résolu(s) automatiquement.`, 'success');
  } else {
    toast('Aucun conflit à résoudre.', 'info');
  }
  renderScheduleView();
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