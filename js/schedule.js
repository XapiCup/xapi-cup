/* ================================================================
   SCHEDULE.JS — Page planning global (centree TERRAINS + multi-tournois)
   ================================================================ */

import { store } from './state.js';
import { generateSchedule, detectScheduleConflicts, detectAllConflicts, autoResolveConflicts } from './tournament.js';
import { $, $$, el, clear, toast, downloadFile, onReady } from './app.js';
import { exportElementAsImage } from './export.js';
import { isAuthenticated, renderLoginScreen, bindLogoutButton } from './auth.js';

// ================================================================
// STATE LOCAL
// ================================================================
let editingSlot = null;

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
    startTime: '09:00',
    endTime: '18:00',
  };
}
function saveGlobalConfig(cfg) {
  localStorage.setItem(GLOBAL_CONFIG_KEY, JSON.stringify(cfg));
  toast('Config sauvegardée.', 'success');
}
function readConfigFromInputs() {
  return {
    nbTerrains: parseInt($('#nb-terrains').value, 10) || 2,
    matchDurationMin: parseInt($('#match-duration').value, 10) || 20,
    breakBetweenMin: parseInt($('#break-between').value, 10) || 5,
    startTime: $('#start-time').value || '09:00',
    endTime: $('#end-time').value || '18:00',
  };
}
function renderConfigInputs() {
  const cfg = getGlobalConfig();
  const setVal = (id, v) => { const e = $(`#${id}`); if (e) e.value = v; };
  setVal('nb-terrains', cfg.nbTerrains);
  setVal('match-duration', cfg.matchDurationMin);
  setVal('break-between', cfg.breakBetweenMin);
  setVal('start-time', cfg.startTime);
  setVal('end-time', cfg.endTime);
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
  store.subscribe(() => renderScheduleView());
  renderScheduleView();
});

function bindUI() {
  // Toggle config (collapse)
  $('#toggle-config-btn')?.addEventListener('click', () => {
    const cfg = $('#schedule-config');
    if (!cfg) return;
    cfg.style.display = cfg.style.display === 'none' ? 'block' : 'none';
  });

  // Sauvegarder config
  $('#save-global-config-btn')?.addEventListener('click', () => {
    const cfg = readConfigFromInputs();
    saveGlobalConfig(cfg);
    // Propager a tous les tournois
    store.setCurrent((s) => {
      s.config.nbTerrains = cfg.nbTerrains;
      s.config.matchDurationMin = cfg.matchDurationMin;
      s.config.breakBetweenMin = cfg.breakBetweenMin;
      s.config.startTime = cfg.startTime;
      s.config.endTime = cfg.endTime;
    });
    renderScheduleView();
  });

  // Generer le planning global
  $('#generate-all-btn')?.addEventListener('click', () => {
    const ts = store.listTournaments().filter((t) => !t.archived);
    if (!ts.length) { toast('Aucun tournoi.', 'warn'); return; }
    generateAllSchedules(ts, getGlobalConfig());
    renderScheduleView();
  });

  // Resoudre les conflits
  $('#resolve-conflicts-btn')?.addEventListener('click', () => {
    const ts = store.listTournaments().filter((t) => !t.archived);
    if (!ts.length) { toast('Aucun tournoi.', 'warn'); return; }
    resolveAllConflicts(ts, getGlobalConfig());
    renderScheduleView();
  });

  // Export
  $('#export-global-schedule-btn')?.addEventListener('click', async () => {
    const node = $('#global-schedule-container');
    if (!node) return;
    try {
      await exportElementAsImage(node, 'xapi-cup-planning-global', 'png', 2);
      toast('Planning exporté !', 'success');
    } catch (e) { toast('Erreur : ' + e.message, 'danger'); }
  });

  // Edit modal
  $('#se-cancel')?.addEventListener('click', closeEditModal);
  $('#schedule-edit-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'schedule-edit-modal') closeEditModal();
  });
  $('#se-save')?.addEventListener('click', saveEditModal);
}

// ================================================================
// VUE PLANNING (centree TERRAINS)
// ================================================================
function renderScheduleView() {
  const container = $('#global-schedule-container');
  const conflictPanel = $('#conflict-panel');
  if (!container) return;
  clear(container);
  if (conflictPanel) clear(conflictPanel);
  renderTerrainView();
}

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
      allSchedules.push({ ...s, _tournament: t.name, _tournamentId: t.id, _allowParallel: t.config?.allowParallel !== false });
    });
    t.matches.forEach((m) => { if (!allMatches.has(m.id)) allMatches.set(m.id, { ...m, _tName: t.name }); });
    (t.bracketMatches || []).forEach((m) => { if (!allMatches.has(m.id)) allMatches.set(m.id, { ...m, _tName: t.name }); });
    teamsByTour.set(t.id, t.teams);
  });

  // === Stats ===
  const stats = $('#toolbar-stats');
  if (stats) {
    stats.textContent = `${allSchedules.length} créneau${allSchedules.length > 1 ? 'x' : ''} planifié${allSchedules.length > 1 ? 's' : ''} · ${ts.length} tournoi${ts.length > 1 ? 's' : ''}`;
  }

  // === Conflits ===
  const conflicts = detectAllConflicts(allSchedules, [...allMatches.values()], [...teamsByTour.values()].flat());
  const totalConflicts = conflicts.terrain.length + conflicts.equipe.length;
  const conflictPanel = $('#conflict-panel');
  if (conflictPanel) {
    if (totalConflicts > 0) {
      conflictPanel.appendChild(el('div', { class: 'alert alert-warn' },
        el('strong', {}, `⚠️ ${totalConflicts} conflit${totalConflicts > 1 ? 's' : ''} détecté${totalConflicts > 1 ? 's' : ''} :`),
        conflicts.terrain.length > 0 ? el('div', {}, `  · ${conflicts.terrain.length} conflit(s) de terrain`) : null,
        conflicts.equipe.length > 0 ? el('div', {}, `  · ${conflicts.equipe.length} conflit(s) d'équipe`) : null,
        el('div', { style: { marginTop: '8px' } }, 'Clique sur "🛠️ Résoudre les conflits" pour les corriger automatiquement.'),
      ));
    } else if (allSchedules.length > 0) {
      conflictPanel.appendChild(el('div', { class: 'alert alert-info' }, '✅ Aucun conflit détecté.'));
    }
  }

  // === Tableau principal ===
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
    const sortedTimes = Array.from(daySlots.entries()).sort(([a],[b]) => a.localeCompare(b));
    sortedTimes.forEach(([time, slots]) => {
      const tr = el('tr');
      tr.appendChild(el('td', { class: 'terrain-time', style: { fontWeight: 700, verticalAlign: 'top', background: 'var(--color-surface-2)' } }, time));
      for (let tt = 1; tt <= nbTerrains; tt++) {
        const slot = slots.find((s) => s.terrain === tt);
        if (!slot) {
          tr.appendChild(el('td', { class: 'terrain-cell-empty', style: { color: '#ccc', textAlign: 'center' } }, '—'));
          continue;
        }
        const m = allMatches.get(slot.matchId);
        if (!m) { tr.appendChild(el('td', {}, '?')); continue; }
        const teamObj = [...teamsByTour.values()].flat();
        const tA = teamObj.find((x) => x.id === (m.slotA || m.teamA));
        const tB = teamObj.find((x) => x.id === (m.slotB || m.teamB));
        const aWins = m.winnerSlot === 'A';
        const bWins = m.winnerSlot === 'B';
        const cell = el('td', { class: 'terrain-cell', onclick: () => openEditModal(slot, m) },
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

// ================================================================
// GENERATION
// ================================================================
function generateAllSchedules(ts, cfg) {
  if (!ts.length) { toast('Aucun tournoi.', 'warn'); return; }
  let totalAdded = 0;
  store.setCurrent((s) => {
    ts.forEach((t) => {
      const allMatches = [
        ...t.matches,
        ...(t.bracketMatches || []),
      ];
      if (!allMatches.length) return;
      const newSched = generateSchedule(allMatches, cfg);
      t.schedule = newSched;
      t.config = { ...(t.config || {}), nbTerrains: cfg.nbTerrains };
      totalAdded += newSched.length;
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
}

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
}

// ================================================================
// EDIT MODAL
// ================================================================
function openEditModal(slot, match) {
  editingSlot = { ...slot, _matchId: match.id };
  $('#se-date').value = slot.date;
  $('#se-time').value = slot.time;
  $('#se-terrain').value = slot.terrain;
  $('#schedule-edit-modal').style.display = 'flex';
}
function closeEditModal() {
  editingSlot = null;
  $('#schedule-edit-modal').style.display = 'none';
}
function saveEditModal() {
  if (!editingSlot) return;
  const newDate = $('#se-date').value;
  const newTime = $('#se-time').value;
  const newTerrain = parseInt($('#se-terrain').value, 10);
  if (!newDate || !newTime || !newTerrain) { toast('Champs invalides.', 'warn'); return; }
  store.setCurrent((s) => {
    const t = s.tournaments.find((x) => x.id === editingSlot._tournamentId);
    if (!t) return;
    const sc = (t.schedule || []).find((x) => x.matchId === editingSlot._matchId && x.date === editingSlot.date && x.time === editingSlot.time && x.terrain === editingSlot.terrain);
    if (sc) {
      sc.date = newDate;
      sc.time = newTime;
      sc.terrain = newTerrain;
    }
  });
  toast('Créneau mis à jour.', 'success');
  closeEditModal();
  renderScheduleView();
}
