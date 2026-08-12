/* ================================================================
   ADMIN.JS — Logique complète de la page administrateur
   - Multi-tournois
   - Poules, qualification, arbres
   - Planning
   - Historique
   ================================================================ */

import { store, DEFAULT_TOURNAMENT } from './state.js';
import {
  generatePoules, generatePouleMatches, computeStandings,
  buildBracket, setBracketScore, setBracketWinner, splitQualifiers,
  generateSchedule, detectScheduleConflicts,
} from './tournament.js';
import { renderPoule, renderBracket } from './render.js';
import { $, $$, el, clear, toast, downloadFile, onReady } from './app.js';
import { exportElementAsImage } from './export.js';
import {
  isAuthenticated, renderLoginScreen, bindLogoutButton,
} from './auth.js';

// ================================================================
// STATE LOCAL (UI)
// ================================================================
let activeBracketTab = 'gold';
let activeScheduleTab = 'poules';

// ================================================================
// ENTRY POINT
// ================================================================
onReady(() => {
  if (!isAuthenticated()) {
    document.getElementById('admin-header').style.display = 'none';
    document.getElementById('auth-banner').style.display = 'none';
    document.getElementById('admin-content').style.display = 'none';
    document.body.style.overflow = 'hidden';
    renderLoginScreen(document.body, () => location.reload());
    return;
  }

  document.getElementById('admin-header').style.display = '';
  document.getElementById('auth-banner').style.display = 'flex';
  document.getElementById('admin-content').style.display = '';
  document.body.style.overflow = '';

  updateSessionTimer();
  setInterval(updateSessionTimer, 60_000);

  bindUI();
  bindLogoutButton();
  bindPasswordChange();
  bindTournamentUI();

  store.subscribe(() => {
    renderTournamentSelector();
    renderAll();
  });
  renderTournamentSelector();
  renderAll();
});

function updateSessionTimer() {
  const slot = $('#session-timer');
  if (!slot) return;
  if (!isAuthenticated()) { slot.textContent = '(session expirée)'; return; }
  try {
    const raw = localStorage.getItem('xapi-cup-session-v1');
    const s = JSON.parse(raw);
    const ms = s.expiresAt - Date.now();
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    slot.textContent = `· session expire dans ${h}h${String(m).padStart(2,'0')}`;
  } catch (e) { slot.textContent = ''; }
}

// ================================================================
// TOURNAMENT SELECTOR (en haut de l'admin)
// ================================================================
function bindTournamentUI() {
  // Sélecteur principal
  const sel = $('#tournament-select');
  if (sel) {
    sel.addEventListener('change', (e) => {
      store.switchTournament(e.target.value);
      toast('Tournoi chargé.', 'success');
    });
  }
  // Bouton "Nouveau"
  const newBtn = $('#tournament-new-btn');
  if (newBtn) {
    newBtn.addEventListener('click', () => {
      const name = prompt('Nom du nouveau tournoi :', `Xapi Cup ${new Date().getFullYear()}`);
      if (!name) return;
      const t = store.createTournament(name.trim());
      toast(`Tournoi "${t.name}" créé.`, 'success');
    });
  }
  // Bouton "Dupliquer"
  const dupBtn = $('#tournament-duplicate-btn');
  if (dupBtn) {
    dupBtn.addEventListener('click', () => {
      const t = store.currentTournament();
      if (!t) return;
      const copy = store.duplicateTournament(t.id);
      if (copy) toast(`"${t.name}" dupliqué.`, 'success');
    });
  }
  // Bouton "Renommer"
  const renBtn = $('#tournament-rename-btn');
  if (renBtn) {
    renBtn.addEventListener('click', () => {
      const t = store.currentTournament();
      if (!t) return;
      const name = prompt('Nouveau nom :', t.name);
      if (name && name.trim()) {
        store.renameTournament(t.id, name.trim());
        toast('Renommé.', 'success');
      }
    });
  }
  // Bouton "Archiver"
  const archBtn = $('#tournament-archive-btn');
  if (archBtn) {
    archBtn.addEventListener('click', () => {
      const t = store.currentTournament();
      if (!t) return;
      store.archiveTournament(t.id);
      toast(t.archived ? 'Archivé.' : 'Désarchivé.', 'success');
      renderTournamentSelector();
    });
  }
  // Bouton "Supprimer"
  const delBtn = $('#tournament-delete-btn');
  if (delBtn) {
    delBtn.addEventListener('click', () => {
      const t = store.currentTournament();
      if (!t) return;
      if (!confirm(`Supprimer définitivement "${t.name}" ?`)) return;
      store.deleteTournament(t.id);
      toast('Supprimé.', 'warn');
    });
  }
  // Bouton "Gérer" (modal liste des tournois)
  const manageBtn = $('#tournament-manage-btn');
  if (manageBtn) {
    manageBtn.addEventListener('click', () => {
      renderTournamentManager();
      $('#tournament-modal').classList.add('show');
    });
  }
  $('#tournament-modal-close')?.addEventListener('click', () => {
    $('#tournament-modal').classList.remove('show');
  });
}

function renderTournamentSelector() {
  const sel = $('#tournament-select');
  if (!sel) return;
  const ts = store.listTournaments();
  const cur = store.state.currentTournamentId;
  sel.innerHTML = '';
  ts.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = (t.archived ? '📦 ' : '') + t.name;
    if (t.id === cur) opt.selected = true;
    sel.appendChild(opt);
  });
  const curT = store.currentTournament();
  const nameEl = $('#current-tournament-name');
  if (nameEl && curT) {
    nameEl.textContent = curT.name + (curT.archived ? ' (archivé)' : '');
  }
  const archBtn = $('#tournament-archive-btn');
  if (archBtn && curT) {
    archBtn.textContent = curT.archived ? '↩ Désarchiver' : '📦 Archiver';
  }
}

function renderTournamentManager() {
  const list = $('#tournament-list');
  if (!list) return;
  clear(list);
  store.listTournaments().forEach((t) => {
    const isCur = t.id === store.state.currentTournamentId;
    const item = el('div', {
      class: 'tournament-item' + (isCur ? ' active' : '') + (t.archived ? ' archived' : ''),
    },
      el('div', { class: 't-item-name' },
        el('strong', {}, t.name),
        isCur ? el('span', { class: 'badge' }, 'actif') : null,
        t.archived ? el('span', { class: 'badge badge-archive' }, 'archivé') : null,
        el('div', { class: 'muted', style: { fontSize: '0.85rem' } },
          `${t.teams.length} équipes · ${t.matches.length} matchs de poule · ${t.phase}`)
      ),
      el('div', { class: 't-item-actions' },
        !isCur ? el('button', {
          class: 'btn btn-sm btn-primary',
          onclick: () => { store.switchTournament(t.id); $('#tournament-modal').classList.remove('show'); toast('Chargé.', 'success'); }
        }, 'Charger') : null,
        el('button', {
          class: 'btn btn-sm btn-ghost',
          style: { background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' },
          onclick: () => {
            const n = prompt('Nouveau nom :', t.name);
            if (n) { store.renameTournament(t.id, n.trim()); renderTournamentManager(); }
          }
        }, '✏️'),
        el('button', {
          class: 'btn btn-sm btn-ghost',
          style: { background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' },
          onclick: () => { store.duplicateTournament(t.id); renderTournamentManager(); }
        }, '📋'),
        el('button', {
          class: 'btn btn-sm',
          style: { background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' },
          onclick: () => { store.archiveTournament(t.id); renderTournamentManager(); renderTournamentSelector(); }
        }, t.archived ? '↩' : '📦'),
        el('button', {
          class: 'btn btn-sm btn-danger',
          onclick: () => {
            if (confirm(`Supprimer "${t.name}" ?`)) { store.deleteTournament(t.id); renderTournamentManager(); renderTournamentSelector(); }
          }
        }, '🗑️')
      )
    );
    list.appendChild(item);
  });
}

// ================================================================
// RENDU GLOBAL
// ================================================================
function renderAll() {
  renderTeamsList();
  renderPoulesSection();
  renderQualifiersSection();
  renderKnockoutSection();
  renderScheduleSection();
  renderHistorySection();
  syncSelectsWithState();
}

// ================================================================
// BINDING UI GÉNÉRAL
// ================================================================
function bindUI() {
  $$('.admin-nav a[data-tab]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      $$('.admin-nav a').forEach((x) => x.classList.remove('active'));
      a.classList.add('active');
      const target = document.getElementById('section-' + a.dataset.tab);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  $('#nav-reset')?.addEventListener('click', (e) => {
    e.preventDefault();
    store.resetCurrent();
    toast('Tournoi réinitialisé.', 'warn');
  });

  $('#add-team-btn')?.addEventListener('click', addTeamFromInput);
  $('#team-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addTeamFromInput(); }
  });
  $('#bulk-add-btn')?.addEventListener('click', () => {
    const ta = $('#bulk-input');
    const lines = ta.value.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) { toast('Saisissez au moins un nom.', 'warn'); return; }
    const added = store.addTeamsBulk(lines);
    ta.value = '';
    toast(`${added.length} équipe(s) ajoutée(s).`, 'success');
  });
  $('#clear-teams-btn')?.addEventListener('click', () => {
    if (!confirm('Supprimer toutes les équipes ?')) return;
    store.setCurrent((s) => {
      s.teams = []; s.poules = []; s.matches = [];
      s.brackets = { gold: null, silver: null }; s.bracketMatches = [];
      s.schedule = []; s.phase = 'setup';
      s.history.push({ at: new Date().toISOString(), type: 'teams-clear', label: 'Toutes les équipes ont été supprimées' });
    });
    toast('Liste vidée.', 'warn');
  });

  $('#generate-poules-btn')?.addEventListener('click', () => {
    const t = store.currentTournament();
    if (!t) return;
    if (t.teams.length < 3) { toast('Au moins 3 équipes.', 'warn'); return; }
    const nbPoules = parseInt($('#nb-poules').value, 10);
    if (nbPoules > t.teams.length) { toast(`${nbPoules} poules pour ${t.teams.length} équipes, impossible.`, 'warn'); return; }
    if (!confirm(`Tirer ${nbPoules} poules pour ${t.teams.length} équipes ?`)) return;
    runPouleDraw();
  });

  $('#qualifiers-per-pool')?.addEventListener('change', (e) => {
    const v = parseInt(e.target.value, 10);
    store.setCurrent((s) => { s.config.qualifiersPerPool = v; });
  });
  $('#enable-consolante')?.addEventListener('change', (e) => {
    store.setCurrent((s) => { s.config.includeConsolante = e.target.checked; });
  });
  $('#launch-brackets-btn')?.addEventListener('click', launchBrackets);

  $$('.tab[data-bracket-tab]').forEach((t) => {
    t.addEventListener('click', () => {
      $$('.tab[data-bracket-tab]').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      activeBracketTab = t.dataset.bracketTab;
      renderKnockoutSection();
    });
  });

  // Schedule tabs
  $$('.tab[data-schedule-tab]').forEach((t) => {
    t.addEventListener('click', () => {
      $$('.tab[data-schedule-tab]').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      activeScheduleTab = t.dataset.scheduleTab;
      renderScheduleSection();
    });
  });
  $('#generate-schedule-btn')?.addEventListener('click', generateScheduleForCurrent);
  $('#export-schedule-btn')?.addEventListener('click', exportScheduleAsImage);
  $('#toggle-split-days')?.addEventListener('change', (e) => {
    store.setCurrent((s) => { s.config.splitDays = e.target.checked; });
    renderScheduleConfig();
  });
  $('#add-day-btn')?.addEventListener('click', () => {
    store.setCurrent((s) => {
      const nextDate = new Date();
      nextDate.setDate(nextDate.getDate() + (s.config.days?.length || 0));
      s.config.days = s.config.days || [];
      s.config.days.push({ date: nextDate.toISOString().slice(0,10), startTime: '09:00', endTime: '18:00' });
    });
    renderScheduleConfig();
  });

  // Schedule config inputs (rebind dynamically)
  ['nb-terrains','match-duration','break-between','lunch-break','start-time','end-time'].forEach((id) => {
    const k = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const map = { nbTerrains: 'nbTerrains', matchDurationMin: 'matchDurationMin', breakBetweenMin: 'breakBetweenMin', lunchBreakMin: 'lunchBreakMin', startTime: 'startTime', endTime: 'endTime' };
    const field = map[k];
    $(`#${id}`)?.addEventListener('change', (e) => {
      const v = (id === 'start-time' || id === 'end-time') ? e.target.value : parseInt(e.target.value, 10);
      store.setCurrent((s) => { s.config[field] = v; });
    });
  });

  $('#export-btn')?.addEventListener('click', handleExportImage);
  $('#export-json-btn')?.addEventListener('click', () => {
    const t = store.currentTournament();
    if (!t) return;
    const filename = `xapi-cup-${slugify(t.name)}-${dateStr()}.json`;
    downloadFile(filename, store.exportJSON());
    toast('Sauvegarde téléchargée.', 'success');
  });
  $('#import-json-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    if (store.importJSON(text)) toast('Sauvegarde restaurée.', 'success');
    e.target.value = '';
  });

  // Modal bracket
  $('#modal-cancel')?.addEventListener('click', closeBracketModal);
  $('#bracket-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'bracket-modal') closeBracketModal();
  });
  $('#modal-save')?.addEventListener('click', saveBracketModal);
}

function bindPasswordChange() {
  const modal = $('#password-modal');
  if (!modal) return;
  const open = () => {
    $('#pwd-current').value = ''; $('#pwd-new').value = ''; $('#pwd-new2').value = '';
    $('#pwd-error').innerHTML = '';
    modal.classList.add('show');
    setTimeout(() => $('#pwd-current').focus(), 50);
  };
  const close = () => modal.classList.remove('show');
  $('#change-pwd-btn')?.addEventListener('click', open);
  $('#pwd-cancel')?.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  $('#pwd-save')?.addEventListener('click', async () => {
    const cur = $('#pwd-current').value, n1 = $('#pwd-new').value, n2 = $('#pwd-new2').value;
    const errSlot = $('#pwd-error');
    errSlot.innerHTML = '';
    if (!cur || !n1 || !n2) { errSlot.innerHTML = '<div class="alert alert-danger" style="margin-top:10px;">Tous les champs sont requis.</div>'; return; }
    if (n1 !== n2) { errSlot.innerHTML = '<div class="alert alert-danger" style="margin-top:10px;">Les nouveaux mots de passe ne correspondent pas.</div>'; return; }
    if (n1.length < 6) { errSlot.innerHTML = '<div class="alert alert-danger" style="margin-top:10px;">6 caractères minimum.</div>'; return; }
    try {
      const { changePassword } = await import('./auth.js');
      await changePassword(cur, n1);
      close();
      toast('Mot de passe mis à jour.', 'success');
    } catch (e) {
      errSlot.innerHTML = `<div class="alert alert-danger" style="margin-top:10px;">${e.message}</div>`;
    }
  });
}

// ================================================================
// TEAMS
// ================================================================
function addTeamFromInput() {
  const input = $('#team-input');
  const t = store.addTeam(input.value);
  if (!t) { toast('Nom invalide ou déjà présent.', 'warn'); return; }
  input.value = ''; input.focus();
}
function renderTeamsList() {
  const list = $('#teams-list');
  if (!list) return;
  clear(list);
  const t = store.currentTournament();
  $('#teams-count').textContent = t ? t.teams.length : 0;
  if (!t || !t.teams.length) {
    list.appendChild(el('li', { class: 'muted', style: { gridColumn: '1 / -1', textAlign: 'center', padding: '20px' } },
      'Aucune équipe inscrite pour l\'instant.'));
    return;
  }
  t.teams.forEach((tm) => {
    list.appendChild(el('li', { class: 'team-item' },
      el('span', { class: 'team-color', style: { background: tm.color } }),
      el('span', { class: 'team-name', title: tm.name }, tm.name),
      el('button', {
        class: 'team-remove', title: 'Supprimer',
        onclick: () => { if (confirm(`Retirer "${tm.name}" ?`)) store.removeTeam(tm.id); }
      }, '×')
    ));
  });
}

// ================================================================
// POULES
// ================================================================
function runPouleDraw() {
  const t = store.currentTournament();
  if (!t) return;
  const nbPoules = parseInt($('#nb-poules').value, 10);
  const poules = generatePoules(t.teams, nbPoules);
  const matches = [];
  poules.forEach((p, idx) => matches.push(...generatePouleMatches(idx, p)));
  store.setCurrent((s) => {
    s.poules = poules; s.matches = matches;
    s.brackets = { gold: null, silver: null }; s.bracketMatches = [];
    s.schedule = [];
    s.phase = 'poules';
    s.config.nbPoules = nbPoules;
    s.history.push({ at: new Date().toISOString(), type: 'poules-draw', label: `Tirage : ${nbPoules} poules, ${matches.length} matchs` });
  });
  toast(`${nbPoules} poules générées · ${matches.length} matchs.`, 'success');
  $('#section-poules')?.scrollIntoView({ behavior: 'smooth' });
}

function renderPoulesSection() {
  const container = $('#poules-container');
  const alertSlot = $('#poules-alert-slot');
  if (!container || !alertSlot) return;
  clear(container); clear(alertSlot);
  const t = store.currentTournament();
  if (!t || !t.poules.length) {
    if (t?.teams.length) {
      alertSlot.appendChild(el('div', { class: 'alert alert-info' },
        '👆 Cliquez sur « Générer les poules » pour démarrer le tournoi.'));
    } else {
      alertSlot.appendChild(el('div', { class: 'alert alert-warn' },
        '⚠ Inscrivez d\'abord vos équipes dans la section 1.'));
    }
    return;
  }
  const grid = el('div', { class: 'poules-grid' });
  t.poules.forEach((pouleTeams, idx) => {
    const matches = t.matches.filter((m) => m.pouleIdx === idx);
    grid.appendChild(renderPoule(idx, t.teams, matches, t.config.qualifiersPerPool, true, handlePouleMatchChange));
  });
  container.appendChild(grid);
}

function handlePouleMatchChange(matchId, teamKey, value) {
  const v = value === '' ? null : parseInt(value, 10);
  if (v != null && (isNaN(v) || v < 0)) { toast('Score invalide.', 'warn'); return; }
  store.setCurrent((s) => {
    const m = s.matches.find((x) => x.id === matchId);
    if (!m) return;
    if (teamKey === 'A') m.scoreA = v;
    else m.scoreB = v;
    const wasFinished = m.finished;
    m.finished = (m.scoreA != null && m.scoreB != null);
    if (!wasFinished && m.finished) {
      m.finishedAt = new Date().toISOString();
      const tA = s.teams.find((x) => x.id === m.teamA);
      const tB = s.teams.find((x) => x.id === m.teamB);
      s.history.push({ at: m.finishedAt, type: 'match-finished', label: `${tA?.name || '?'} ${m.scoreA}-${m.scoreB} ${tB?.name || '?'}`, data: { matchId: m.id, kind: 'poule' } });
    }
  });
}

// ================================================================
// QUALIFICATION
// ================================================================
function renderQualifiersSection() {
  const preview = $('#qualifiers-preview');
  const actions = $('#qualifiers-actions');
  const alertSlot = $('#qualifiers-alert-slot');
  if (!preview) return;
  clear(preview); clear(alertSlot);
  const t = store.currentTournament();
  if (!t || !t.poules.length) {
    alertSlot.appendChild(el('div', { class: 'alert alert-warn' }, '⚠ Générez d\'abord les poules (section 2).'));
    actions.style.display = 'none';
    return;
  }
  const unfinished = t.matches.filter((m) => !m.finished).length;
  if (unfinished > 0 && !t.brackets.gold) {
    alertSlot.appendChild(el('div', { class: 'alert alert-info' },
      `ℹ️ ${unfinished} match(s) de poule restant(s). Les qualifiés sont calculés en temps réel.`));
  } else if (t.brackets.gold) {
    alertSlot.appendChild(el('div', { class: 'alert alert-success' }, '✅ Arbres générés. Voir section 4.'));
  }

  const allStandings = t.poules.map((p, idx) => {
    const matches = t.matches.filter((m) => m.pouleIdx === idx);
    return computeStandings(t.teams.filter((tm) => p.includes(tm.id)), matches);
  });
  const includeConsolante = t.config.includeConsolante !== false;
  const { gold, consolante } = splitQualifiers(allStandings, t.config.qualifiersPerPool, includeConsolante);

  const grid = el('div', { class: 'poules-grid' });
  allStandings.forEach((standings, idx) => {
    const wrap = el('div', { class: 'poule' });
    wrap.appendChild(el('h3', {}, `Poule ${String.fromCharCode(65 + idx)}`,
      el('span', { class: 'poule-size' }, `${standings.length} équipes`)));
    const table = el('table', { class: 'standings-table' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', { style: { width: '30px' } }, '#'),
      el('th', { style: { textAlign: 'left' } }, 'Équipe'),
      el('th', {}, 'Pts'))));
    const tb = el('tbody');
    standings.forEach((s, sIdx) => {
      const isQual = sIdx < t.config.qualifiersPerPool;
      const tr = el('tr', { class: isQual ? 'qualifie' : '' });
      tr.appendChild(el('td', { class: 'rank-cell' }, String(sIdx + 1)));
      tr.appendChild(el('td', { class: 'team-cell' },
        el('span', { class: 'team-color', style: { background: s.team.color } }),
        s.team.name));
      tr.appendChild(el('td', {}, String(s.points)));
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    wrap.appendChild(table);
    grid.appendChild(wrap);
  });
  preview.appendChild(grid);

  const recap = el('div', { class: 'alert alert-info', style: { marginTop: '16px' } },
    el('strong', {}, `🏆 Qualifiés Or (${gold.length}) : `),
    el('span', {}, gold.map((x) => x.name).join(', ') || 'aucun'),
    (includeConsolante && consolante.length) ? el('div', {},
      el('strong', {}, `🥈 Consolante (${consolante.length}) : `),
      el('span', {}, consolante.map((x) => x.name).join(', '))) : null);
  preview.appendChild(recap);

  actions.style.display = gold.length >= 2 ? '' : 'none';
}

function launchBrackets() {
  const t = store.currentTournament();
  if (!t) return;
  const allStandings = t.poules.map((p, idx) => {
    const matches = t.matches.filter((m) => m.pouleIdx === idx);
    return computeStandings(t.teams.filter((tm) => p.includes(tm.id)), matches);
  });
  const includeConsolante = t.config.includeConsolante !== false;
  const { gold, consolante } = splitQualifiers(allStandings, t.config.qualifiersPerPool, includeConsolante);

  if (gold.length < 2) { toast('Pas assez de qualifiés.', 'warn'); return; }

  const goldBracket = buildBracket(gold);
  const silverBracket = (includeConsolante && consolante.length >= 2) ? buildBracket(consolante) : null;

  // Aplatir tous les matchs bracket pour le planning
  const allBracketMatches = [];
  [goldBracket, silverBracket].forEach((br) => {
    if (!br) return;
    br.rounds.forEach((round) => round.forEach((m) => allBracketMatches.push({
      ...m, _bracket: br === goldBracket ? 'gold' : 'silver'
    })));
  });

  store.setCurrent((s) => {
    s.brackets = { gold: goldBracket, silver: silverBracket };
    s.bracketMatches = allBracketMatches;
    s.phase = 'knockout';
    s.history.push({ at: new Date().toISOString(), type: 'brackets-launched',
      label: `Arbres générés : ${gold.length} en Or${silverBracket ? `, ${consolante.length} en Consolante` : ''}`,
      data: { gold: gold.length, consolante: consolante.length } });
  });
  toast(`Arbres générés : ${gold.length} en Or.`, 'success');
  $('#section-knockout')?.scrollIntoView({ behavior: 'smooth' });
  activeBracketTab = 'gold';
  $$('.tab[data-bracket-tab]').forEach((t) => t.classList.toggle('active', t.dataset.bracketTab === 'gold'));
}

// ================================================================
// PHASE FINALE
// ================================================================
function renderKnockoutSection() {
  const container = $('#knockout-container');
  if (!container) return;
  clear(container);
  const t = store.currentTournament();
  if (!t || (!t.brackets.gold && !t.brackets.silver)) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '🏆'),
      el('h3', {}, 'Aucun arbre généré pour l\'instant.'),
      el('p', {}, 'Complétez la section 3 pour lancer la phase finale.')));
    return;
  }
  if (activeBracketTab === 'gold' && t.brackets.gold) {
    container.appendChild(renderBracket(t.brackets.gold, t, {
      title: 'Tableau Or', kind: 'gold', editable: true, onClick: openBracketModal,
    }));
  } else if (activeBracketTab === 'silver' && t.brackets.silver) {
    container.appendChild(renderBracket(t.brackets.silver, t, {
      title: 'Consolante', kind: 'silver', editable: true, onClick: openBracketModal,
    }));
  } else if (activeBracketTab === 'silver' && !t.brackets.silver) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '🥈'),
      el('h3', {}, 'Consolante désactivée.')));
  }
}

let modalContext = null;
function openBracketModal(match, rIdx, mIdx) {
  if (match.slotA == null || match.slotB == null) {
    toast('Les deux équipes ne sont pas encore déterminées.', 'warn');
    return;
  }
  modalContext = { kind: activeBracketTab, rIdx, mIdx, match };
  const t = store.currentTournament();
  const tA = t.teams.find((x) => x.id === match.slotA);
  const tB = t.teams.find((x) => x.id === match.slotB);
  $('#modal-title').textContent = `${tA.name} vs ${tB.name}`;
  const body = $('#modal-body');
  clear(body);
  const row = el('div', { class: 'form-row', style: { alignItems: 'end' } });
  row.appendChild(el('div', { class: 'form-group', style: { flex: 1 } },
    el('label', {}, tA.name),
    el('input', { type: 'number', min: '0', class: 'input', id: 'modal-scoreA', value: match.scoreA ?? 0 })));
  row.appendChild(el('div', { class: 'form-group', style: { flex: 1 } },
    el('label', {}, tB.name),
    el('input', { type: 'number', min: '0', class: 'input', id: 'modal-scoreB', value: match.scoreB ?? 0 })));
  body.appendChild(row);
  body.appendChild(el('p', { class: 'help' },
    'Saisissez les scores. Vainqueur désigné automatiquement (en cas d\'égalité, on vous demandera).'));
  $('#modal-save').textContent = 'Valider le vainqueur';
  $('#bracket-modal').classList.add('show');
  $('#modal-scoreA').focus(); $('#modal-scoreA').select();
}
function closeBracketModal() {
  $('#bracket-modal').classList.remove('show');
  modalContext = null;
}
function saveBracketModal() {
  if (!modalContext) return;
  const scoreA = parseInt($('#modal-scoreA').value, 10);
  const scoreB = parseInt($('#modal-scoreB').value, 10);
  if (isNaN(scoreA) || isNaN(scoreB) || scoreA < 0 || scoreB < 0) {
    toast('Scores invalides.', 'warn'); return;
  }
  const { kind, rIdx, mIdx } = modalContext;
  let winner = null;
  if (scoreA > scoreB) winner = 'A';
  else if (scoreB > scoreA) winner = 'B';
  else {
    const choice = prompt('Égalité ! Qui se qualifie ? Tapez A ou B.', 'A');
    if (choice === 'A' || choice === 'a') winner = 'A';
    else if (choice === 'B' || choice === 'b') winner = 'B';
    else { toast('Annulé.', 'warn'); return; }
  }
  store.setCurrent((s) => {
    const br = s.brackets[kind];
    if (!br) return;
    const m = br.rounds[rIdx][mIdx];
    m.scoreA = scoreA; m.scoreB = scoreB;
    m.winnerSlot = winner; m.finished = true;
    m.finishedAt = new Date().toISOString();
    // Propage via la fonction importée
    const updated = setBracketScore(br, rIdx, mIdx, scoreA, scoreB);
    s.brackets[kind] = updated;
    // Re-applique le winnerSlot car setBracketScore peut l'avoir recalculé
    updated.rounds[rIdx][mIdx].winnerSlot = winner;
    updated.rounds[rIdx][mIdx].finished = true;
    // Re-propage à la main pour s'assurer
    const winnerId = winner === 'A' ? m.slotA : m.slotB;
    if (rIdx < updated.rounds.length - 1) {
      const nextRound = updated.rounds[rIdx + 1];
      const nextMatch = nextRound[Math.floor(mIdx / 2)];
      if (Math.floor(mIdx / 2) === Math.floor(mIdx / 2)) {
        if (mIdx % 2 === 0) nextMatch.slotA = winnerId;
        else nextMatch.slotB = winnerId;
      }
    }
    // Historique
    const tA = s.teams.find((x) => x.id === m.slotA);
    const tB = s.teams.find((x) => x.id === m.slotB);
    s.history.push({
      at: m.finishedAt, type: 'match-finished',
      label: `${tA?.name || '?'} ${scoreA}-${scoreB} ${tB?.name || '?'}`,
      data: { matchId: m.id, kind: 'bracket', bracket: kind }
    });
  });
  closeBracketModal();
  toast('Score enregistré.', 'success');
}

// ================================================================
// PLANNING
// ================================================================
function renderScheduleConfig() {
  const t = store.currentTournament();
  if (!t) return;
  const cfg = t.config;
  // Inputs principaux
  const setVal = (id, v) => { const el = $(`#${id}`); if (el) el.value = v; };
  setVal('nb-terrains', cfg.nbTerrains);
  setVal('match-duration', cfg.matchDurationMin);
  setVal('break-between', cfg.breakBetweenMin);
  setVal('lunch-break', cfg.lunchBreakMin);
  setVal('start-time', cfg.startTime);
  setVal('end-time', cfg.endTime);
  setVal('toggle-split-days', cfg.splitDays);

  // Days
  const daysContainer = $('#days-container');
  if (daysContainer) {
    clear(daysContainer);
    if (cfg.splitDays) {
      cfg.days = cfg.days || [];
      cfg.days.forEach((day, idx) => {
        const row = el('div', { class: 'form-row', style: { marginBottom: '8px', alignItems: 'end' } },
          el('div', { class: 'form-group', style: { flex: 1 } },
            el('label', {}, `Jour ${idx + 1}`),
            el('input', { type: 'date', class: 'input', value: day.date,
              onchange: (e) => store.setCurrent((s) => { s.config.days[idx].date = e.target.value; }) })),
          el('div', { class: 'form-group', style: { flex: 1 } },
            el('label', {}, 'Début'),
            el('input', { type: 'time', class: 'input', value: day.startTime,
              onchange: (e) => store.setCurrent((s) => { s.config.days[idx].startTime = e.target.value; }) })),
          el('div', { class: 'form-group', style: { flex: 1 } },
            el('label', {}, 'Fin'),
            el('input', { type: 'time', class: 'input', value: day.endTime,
              onchange: (e) => store.setCurrent((s) => { s.config.days[idx].endTime = e.target.value; }) })),
          el('div', { class: 'form-group', style: { flex: 0 } },
            el('button', { class: 'btn btn-sm btn-danger',
              onclick: () => store.setCurrent((s) => { s.config.days.splice(idx, 1); renderScheduleConfig(); })
            }, '🗑️'))
        );
        daysContainer.appendChild(row);
      });
    }
  }
}

function renderScheduleSection() {
  const t = store.currentTournament();
  if (!t) return;
  renderScheduleConfig();
  const container = $('#schedule-container');
  if (!container) return;
  clear(container);
  if (!t.poules.length && !t.brackets.gold) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '📅'),
      el('h3', {}, 'Aucun planning pour l\'instant.'),
      el('p', {}, 'Génère d\'abord les poules (section 2) ou les arbres (section 3).')));
    return;
  }
  // Tabs : planning poules / planning phase finale
  const tabNav = el('div', { class: 'tabs' },
    el('button', { class: 'tab' + (activeScheduleTab === 'poules' ? ' active' : ''),
      'data-schedule-tab': 'poules', onclick: (e) => { activeScheduleTab = 'poules'; renderScheduleSection(); }
    }, `Poules (${t.matches.length})`),
    el('button', { class: 'tab' + (activeScheduleTab === 'knockout' ? ' active' : ''),
      'data-schedule-tab': 'knockout', onclick: (e) => { activeScheduleTab = 'knockout'; renderScheduleSection(); }
    }, `Phase finale (${t.bracketMatches?.length || 0})`));
  container.appendChild(tabNav);

  // Source des matchs
  const sourceMatches = activeScheduleTab === 'poules' ? t.matches : (t.bracketMatches || []);
  const alreadyScheduled = t.schedule.filter((s) => sourceMatches.some((m) => m.id === s.matchId));

  if (!sourceMatches.length) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('p', {}, activeScheduleTab === 'poules' ? 'Pas de matchs de poule.' : 'Lance d\'abord la phase finale (section 3).')));
    return;
  }

  // Tableau du planning
  if (alreadyScheduled.length) {
    container.appendChild(el('h3', {}, `Planning ${activeScheduleTab === 'poules' ? 'des poules' : 'de la phase finale'}`));
    container.appendChild(renderScheduleTable(alreadyScheduled, sourceMatches, t));
    // Conflits
    const conflicts = detectScheduleConflicts(alreadyScheduled, sourceMatches, t.teams);
    if (conflicts.length) {
      container.appendChild(el('div', { class: 'alert alert-warn', style: { marginTop: '12px' } },
        el('strong', {}, '⚠ ' + conflicts.length + ' conflit(s) détecté(s)'),
        el('ul', { style: { marginTop: '8px' } },
          ...conflicts.map((c) => el('li', {}, `${c.team} — ${c.reason}`))
        )));
    }
  } else {
    container.appendChild(el('div', { class: 'empty-state' },
      el('p', {}, 'Aucun planning généré pour cette catégorie.')));
  }
}

function renderScheduleTable(schedule, matches, t) {
  const table = el('table', { class: 'standings-table', style: { fontSize: '0.95rem' } });
  table.appendChild(el('thead', {}, el('tr', {},
    el('th', {}, 'Date'),
    el('th', {}, 'Heure'),
    el('th', {}, 'Terrain'),
    el('th', {}, 'Match'),
    el('th', {}, 'Score'),
    el('th', {}, ''),
  )));
  const tb = el('tbody');
  // Index par id
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const sorted = [...schedule].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  sorted.forEach((s) => {
    const m = matchById.get(s.matchId);
    if (!m) return;
    const tA = t.teams.find((x) => x.id === m.teamA);
    const tB = t.teams.find((x) => x.id === m.teamB);
    const tr = el('tr', {});
    tr.appendChild(el('td', {}, s.date));
    tr.appendChild(el('td', { style: { fontWeight: 600 } }, s.time));
    tr.appendChild(el('td', { class: 'text-center' }, '🟢 T' + s.terrain));
    tr.appendChild(el('td', {},
      (tA?.name || '?') + ' vs ' + (tB?.name || '?')
    ));
    tr.appendChild(el('td', { class: 'text-center', style: { fontWeight: 600 } },
      (m.scoreA != null ? m.scoreA : '-') + ' - ' + (m.scoreB != null ? m.scoreB : '-')));
    tb.appendChild(tr);
  });
  table.appendChild(tb);
  return table;
}

function generateScheduleForCurrent() {
  const t = store.currentTournament();
  if (!t) return;
  const which = activeScheduleTab;
  const sourceMatches = which === 'poules' ? t.matches : (t.bracketMatches || []);
  if (!sourceMatches.length) { toast('Aucun match à planifier.', 'warn'); return; }
  const newSched = generateSchedule(sourceMatches, t.config);
  store.setCurrent((s) => {
    // On remplace uniquement les créneaux de cette catégorie
    const sourceIds = new Set(sourceMatches.map((m) => m.id));
    s.schedule = s.schedule.filter((sc) => !sourceIds.has(sc.matchId));
    s.schedule.push(...newSched);
    s.history.push({
      at: new Date().toISOString(), type: 'schedule-generated',
      label: `Planning généré : ${newSched.length} matchs sur ${which === 'poules' ? 'les poules' : 'la phase finale'}`,
    });
  });
  toast(`Planning généré : ${newSched.length} matchs.`, 'success');
}

async function exportScheduleAsImage() {
  const t = store.currentTournament();
  if (!t) return;
  const el2 = $('#schedule-container');
  if (!el2) return;
  try {
    await exportElementAsImage(el2, `xapi-cup-${slugify(t.name)}-planning`, 'png', 2);
    toast('Planning exporté !', 'success');
  } catch (e) {
    toast('Erreur : ' + e.message, 'danger');
  }
}

// ================================================================
// HISTORIQUE
// ================================================================
function renderHistorySection() {
  const t = store.currentTournament();
  const list = $('#history-list');
  if (!list) return;
  clear(list);
  if (!t) return;
  const items = [...(t.history || [])].reverse().slice(0, 50);
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
    const d = new Date(h.at);
    list.appendChild(el('div', { class: 'history-item' },
      el('span', { class: 'history-icon' }, typeIcons[h.type] || '•'),
      el('div', { class: 'history-body' },
        el('div', { class: 'history-label' }, h.label),
        el('div', { class: 'history-time muted' }, d.toLocaleString('fr-FR'))
      )
    ));
  });
}

// ================================================================
// EXPORT IMAGE
// ================================================================
async function handleExportImage() {
  const mode = $('#export-select')?.value;
  const format = $('#export-format')?.value;
  const t = store.currentTournament();
  if (!t) return;
  const exportOne = async (bracket, title) => {
    const tmp = document.createElement('div');
    tmp.style.cssText = 'position:fixed;top:-99999px;left:0;background:#fff;padding:20px;width:max-content;';
    document.body.appendChild(tmp);
    const node = renderBracket(bracket, t, { title, kind: title.includes('Or') ? 'gold' : 'silver' });
    tmp.appendChild(node);
    try { await exportElementAsImage(node, `xapi-cup-${slugify(t.name)}-${slugify(title)}`, format, 2); }
    finally { document.body.removeChild(tmp); }
  };
  try {
    if (mode === 'gold' && t.brackets.gold) await exportOne(t.brackets.gold, 'Tableau Or');
    else if (mode === 'silver' && t.brackets.silver) await exportOne(t.brackets.silver, 'Consolante');
    else if (mode === 'both') {
      if (t.brackets.gold) await exportOne(t.brackets.gold, 'Tableau Or');
      if (t.brackets.silver) await exportOne(t.brackets.silver, 'Consolante');
    } else { toast('Aucun arbre à exporter.', 'warn'); return; }
    toast('Image exportée !', 'success');
  } catch (e) { toast('Erreur : ' + e.message, 'danger', 5000); }
}

// ================================================================
// UTILS
// ================================================================
function syncSelectsWithState() {
  const t = store.currentTournament();
  if (!t) return;
  const np = $('#nb-poules'); if (np) np.value = String(t.config.nbPoules);
  const qp = $('#qualifiers-per-pool'); if (qp) qp.value = String(t.config.qualifiersPerPool);
  const ec = $('#enable-consolante'); if (ec) ec.checked = t.config.includeConsolante !== false;
}
function slugify(s) {
  return (s || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'xapi-cup';
}
function dateStr() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}
