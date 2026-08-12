/* ================================================================
   SCHEDULE.JS — Page planning global (centree TERRAINS + multi-tournois + multi-jours)
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

const GLOBAL_CONFIG_KEY = 'xapi-cup-schedule-config-v2';
const DEFAULT_CONFIG = {
  nbTerrains: 4,
  matchDurationMin: 20,
  breakBetweenMin: 5,
  startTime: '09:00',
  endTime: '18:00',
  splitDays: false,
  phase: 'poules',     // 'poules' (par defaut) ou 'all' ou 'knockout'
  days: [], // [{date, startTime, endTime}] -- active uniquement si splitDays=true
};

function getGlobalConfig() {
  try {
    const raw = localStorage.getItem(GLOBAL_CONFIG_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch (e) {}
  return { ...DEFAULT_CONFIG };
}
function saveGlobalConfig(cfg) {
  localStorage.setItem(GLOBAL_CONFIG_KEY, JSON.stringify(cfg));
  toast('Config sauvegardée.', 'success');
}
function resetConfig() {
  localStorage.removeItem(GLOBAL_CONFIG_KEY);
  toast('Config réinitialisée.', 'info');
}
function readConfigFromInputs() {
  return {
    nbTerrains: parseInt($('#nb-terrains').value, 10) || 4,
    matchDurationMin: parseInt($('#match-duration').value, 10) || 20,
    breakBetweenMin: parseInt($('#break-between').value, 10) || 5,
    startTime: $('#start-time').value || '09:00',
    endTime: $('#end-time').value || '18:00',
    splitDays: $('#toggle-multidays').checked,
    days: readDaysFromInputs(),
  };
}
function readDaysFromInputs() {
  if (!$('#toggle-multidays').checked) return [];
  const nb = parseInt($('#nb-days').value, 10) || 1;
  const startDate = $('#start-date').value;
  const days = [];
  const baseStart = $('#start-time').value || '09:00';
  const baseEnd = $('#end-time').value || '18:00';
  for (let i = 0; i < nb; i++) {
    const d = $(`#day-${i}-date`)?.value
      || (startDate ? addDays(startDate, i) : null);
    const s = $(`#day-${i}-start`)?.value || baseStart;
    const e = $(`#day-${i}-end`)?.value || baseEnd;
    days.push({ date: d, startTime: s, endTime: e });
  }
  return days;
}
function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function renderConfigInputs() {
  const cfg = getGlobalConfig();
  const setVal = (id, v) => { const e = $(`#${id}`); if (e) e.value = v; };
  setVal('nb-terrains', cfg.nbTerrains);
  setVal('match-duration', cfg.matchDurationMin);
  setVal('break-between', cfg.breakBetweenMin);
  setVal('start-time', cfg.startTime);
  setVal('end-time', cfg.endTime);
  const tg = $('#toggle-multidays');
  if (tg) tg.checked = !!cfg.splitDays;
  toggleDaysConfig();
  renderDaysList();
}
function toggleDaysConfig() {
  const tg = $('#toggle-multidays');
  const dc = $('#days-config');
  if (tg && dc) dc.style.display = tg.checked ? 'block' : 'none';
}
function renderDaysList() {
  const list = $('#days-list');
  if (!list) return;
  clear(list);
  if (!$('#toggle-multidays').checked) return;
  const nb = parseInt($('#nb-days').value, 10) || 1;
  const startDate = $('#start-date').value || new Date().toISOString().slice(0,10);
  const baseStart = $('#start-time').value || '09:00';
  const baseEnd = $('#end-time').value || '18:00';
  const cfg = getGlobalConfig();
  for (let i = 0; i < nb; i++) {
    const existing = cfg.days?.[i];
    const row = el('div', { class: 'form-row', style: { marginBottom: '8px', alignItems: 'end' } },
      el('div', { class: 'form-group', style: { flex: 1 } },
        el('label', {}, `Jour ${i + 1}`),
        el('input', { type: 'date', class: 'input', id: `day-${i}-date`, value: existing?.date || addDays(startDate, i) })),
      el('div', { class: 'form-group', style: { flex: 1 } },
        el('label', {}, 'Début'),
        el('input', { type: 'time', class: 'input', id: `day-${i}-start`, value: existing?.startTime || baseStart })),
      el('div', { class: 'form-group', style: { flex: 1 } },
        el('label', {}, 'Fin'),
        el('input', { type: 'time', class: 'input', id: `day-${i}-end`, value: existing?.endTime || baseEnd })),
    );
    list.appendChild(row);
  }
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

  // Toggle multi-days
  $('#toggle-multidays')?.addEventListener('change', () => {
    toggleDaysConfig();
    renderDaysList();
  });
  $('#nb-days')?.addEventListener('change', renderDaysList);
  $('#start-date')?.addEventListener('change', renderDaysList);

  // Sauvegarder config
    $('#save-config-btn')?.addEventListener('click', () => {
      const cfg = readConfigFromInputs();
      saveGlobalConfig(cfg);
      store.setCurrent((s) => {
        s.config.nbTerrains = cfg.nbTerrains;
        s.config.matchDurationMin = cfg.matchDurationMin;
        s.config.breakBetweenMin = cfg.breakBetweenMin;
        s.config.startTime = cfg.startTime;
        s.config.endTime = cfg.endTime;
        s.config.splitDays = cfg.splitDays;
        s.config.days = cfg.days;
        s.config.phase = cfg.phase;
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

    // Integrer les phases finales (une fois les poules terminees)
    $('#integrate-knockout-btn')?.addEventListener('click', () => {
      const ts = store.listTournaments().filter((t) => !t.archived);
      if (!ts.length) { toast('Aucun tournoi.', 'warn'); return; }
      const cfgWithKnockout = { ...getGlobalConfig(), phase: 'knockout' };
      generateAllSchedules(ts, cfgWithKnockout);
      renderScheduleView();
    });

    // Integrer toutes les phases (poules + finales d'un coup)
    $('#integrate-all-btn')?.addEventListener('click', () => {
      const ts = store.listTournaments().filter((t) => !t.archived);
      if (!ts.length) { toast('Aucun tournoi.', 'warn'); return; }
      const cfgAll = { ...getGlobalConfig(), phase: 'all' };
      generateAllSchedules(ts, cfgAll);
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

  const allSchedules = [];
  const allMatches = new Map();
  const teamsByTour = new Map();
  const cfg = getGlobalConfig();
  const nbTerrains = Math.max(
    cfg.nbTerrains || 4,
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

  const stats = $('#toolbar-stats');
  if (stats) {
    stats.textContent = `${allSchedules.length} créneau${allSchedules.length > 1 ? 'x' : ''} planifié${allSchedules.length > 1 ? 's' : ''} · ${ts.length} tournoi${ts.length > 1 ? 's' : ''}`;
  }

  // Conflits
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

    // Prévisualisation : phases finales non intégrées
    const totalBracket = ts.reduce((acc, t) => acc + (t.bracketMatches?.length || 0), 0);
    const plannedBracket = new Set();
    ts.forEach((t) => (t.schedule || []).forEach((s) => {
      if ((t.bracketMatches || []).some((bm) => bm.id === s.matchId)) plannedBracket.add(s.matchId + '@' + t.id);
    }));
    const unPlannedBracket = ts.reduce((acc, t) => acc + (t.bracketMatches || []).filter((m) => !plannedBracket.has(m.id + '@' + t.id)).length, 0);
    if (totalBracket > 0 && unPlannedBracket > 0) {
      conflictPanel.appendChild(el('div', { class: 'alert alert-info' },
        el('strong', {}, '🎯 Phase finale : '),
        `${totalBracket - unPlannedBracket}/${totalBracket} match(s) intégré(s) au planning. `,
        el('div', { style: { marginTop: '8px' } },
          `${unPlannedBracket} match(s) en attente. `,
          el('button', {
            class: 'btn btn-primary btn-sm',
            style: { marginLeft: '8px' },
            onclick: () => { $('#integrate-knockout-btn')?.click(); },
          }, '📅 Intégrer au planning'),
        ),
      ));
    }
  }

  if (allSchedules.length === 0) {
    // Pas de creneaux : proposer l'integration des phases finales s'il y en a
    const totalBracket = ts.reduce((acc, t) => acc + (t.bracketMatches?.length || 0), 0);
    const totalPool = ts.reduce((acc, t) => acc + t.matches.length, 0);
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '📅'),
      el('h3', {}, 'Aucun planning généré'),
      el('p', { class: 'muted' }, 'Clique sur "🎲 Générer le planning global" pour créer les créneaux des matchs de poules.')));
    if (totalPool > 0) {
      const preview = el('div', { class: 'alert alert-info' },
        el('strong', {}, '🎯 Matchs à planifier :'),
        el('div', { style: { marginTop: '8px' } },
          el('div', {}, `📋 ${totalPool} match(s) de poules (clique sur "🎲 Générer le planning global")`),
        ),
      );
      if (totalBracket > 0) {
        preview.appendChild(el('div', {}, `🏆 ${totalBracket} match(s) de phase finale (générés après les poules)`));
      }
      container.appendChild(preview);
    }
    return;
  }

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

  const phase = cfg.phase || 'poules';
  let totalAdded = 0;
  let totalBracketSkipped = 0;

  // 1) Filtrer les matchs selon la phase demandee
  const pool = [];
  const matchToTournament = new Map();
  ts.forEach((t) => {
    const allMatches = [...t.matches, ...(t.bracketMatches || [])];
    if (!allMatches.length) return;
    allMatches.forEach((m) => {
      const isBracket = !('pouleIdx' in m) && !m.pouleIdx && m.slotA && m.slotA.length > 8;
      // Heuristique : un match de bracket a un id type 'semi1' ou 'final' (pas 'm0_1')
      // Le plus sur : on regarde si la clef est dans bracketMatches
      const inBracketList = (t.bracketMatches || []).some((bm) => bm.id === m.id);
      // Poules : match avec pouleIdx defini
      const isPoolMatch = m.pouleIdx !== undefined;
      let include = false;
      if (phase === 'poules') include = isPoolMatch && !inBracketList;
      else if (phase === 'knockout') include = inBracketList;
      else include = true;
      if (!include) {
        if (inBracketList && phase === 'poules') totalBracketSkipped++;
        return;
      }
      pool.push({ ...m, _tid: t.id });
      matchToTournament.set(m.id, t.id);
    });
  });
  if (!pool.length) { toast('Aucun match de ' + phase + ' a planifier.', 'warn'); return; }

  // 2) Generer UN planning global sur le pool (1 match / terrain / creneau, pas 2x la meme equipe)
  const matchCfg = {
    ...cfg,
    splitDays: cfg.splitDays && cfg.days?.length > 0,
    days: cfg.days || [],
  };
  const globalSched = generateSchedule(pool, matchCfg);
  if (!globalSched.length) { toast('Planning vide (verifie horaires/terrains).', 'warn'); return; }

  // 3) Auto-resolution sur le pool (cas extreme, normalement 0 conflit)
  const resolved = autoResolveConflicts(globalSched, pool, cfg);
  const finalSched = resolved.schedule;

  // 4) Regrouper par tournoi et assigner dans t.schedule (en CONSERVANT les creneaux existants non concernes)
  const byTournament = new Map();
  ts.forEach((t) => byTournament.set(t.id, []));
  finalSched.forEach((s) => {
    const tid = matchToTournament.get(s.matchId);
    if (byTournament.has(tid)) {
      const sc = { ...s };
      delete sc._tid;
      byTournament.get(tid).push(sc);
    }
  });

  store.setCurrent((s) => {
    ts.forEach((t) => {
      // Conserver les anciens creneaux qui ne sont pas dans pool (ex: bracket quand phase=poules)
      const oldKept = (t.schedule || []).filter((sc) => {
        const isBracketMatch = (t.bracketMatches || []).some((bm) => bm.id === sc.matchId);
        if (phase === 'poules' && isBracketMatch) return true;
        if (phase === 'knockout' && !isBracketMatch) return true;
        return false;
      });
      const newKept = byTournament.get(t.id) || [];
      // Fusionner sans doublons (par matchId)
      const seen = new Set();
      const merged = [];
      oldKept.forEach((x) => { if (!seen.has(x.matchId)) { seen.add(x.matchId); merged.push(x); } });
      newKept.forEach((x) => { if (!seen.has(x.matchId)) { seen.add(x.matchId); merged.push(x); } });
      t.schedule = merged;
      t.config = { ...(t.config || {}), nbTerrains: cfg.nbTerrains };
      totalAdded += newKept.length;
    });
    if (ts[0]) {
      s.history.push({
        at: new Date().toISOString(),
        type: 'schedule-generated',
        label: `Planning ${phase} genere : ${finalSched.length} matchs sur ${ts.length} tournois`,
      });
    }
  });
  let msg = `Planning ${phase} : ${totalAdded} creneaux sur ${ts.length} tournoi${ts.length > 1 ? 's' : ''}.`;
  if (phase === 'poules' && totalBracketSkipped > 0) {
    msg += ` (${totalBracketSkipped} match(s) de phase finale non integres, generes apres les poules)`;
  }
  toast(msg, 'success');
}

function resolveAllConflicts(ts, cfg) {
  // Meme logique : pool global puis repartition
  let totalResolved = 0;

  const pool = [];
  const matchToTournament = new Map();
  ts.forEach((t) => {
    if (!t.schedule?.length) return;
    const allMatches = [...t.matches, ...(t.bracketMatches || [])];
    allMatches.forEach((m) => {
      pool.push(m);
      matchToTournament.set(m.id, t.id);
    });
  });
  if (!pool.length || !ts.some((t) => t.schedule?.length)) {
    toast('Aucun planning à analyser.', 'info');
    return;
  }

  // Reconstruire le planning global a partir des schedules individuels
  const globalSched = [];
  ts.forEach((t) => {
    (t.schedule || []).forEach((s) => globalSched.push({ ...s }));
  });
  const result = autoResolveConflicts(globalSched, pool, cfg);
  totalResolved = result.resolved;

  // Repartir
  const byTournament = new Map();
  ts.forEach((t) => byTournament.set(t.id, []));
  result.schedule.forEach((s) => {
    const tid = matchToTournament.get(s.matchId);
    if (byTournament.has(tid)) byTournament.get(tid).push(s);
  });

  store.setCurrent((s) => {
    ts.forEach((t) => {
      t.schedule = byTournament.get(t.id) || [];
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
