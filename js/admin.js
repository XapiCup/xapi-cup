/* ================================================================
   ADMIN.JS — Logique page administrateur
   - Vue Dashboard (cards de tournois)
   - Vue Tournoi (onglets : Équipes / Poules / Arbres / Planning / Historique / Export)
   - Multi-tournois, planning éditable, fix bug poules, etc.
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
import { isAuthenticated, renderLoginScreen, bindLogoutButton } from './auth.js';

// ================================================================
// STATE LOCAL
// ================================================================
let view = 'dashboard';     // 'dashboard' | 'tournament'
let activeTab = 'teams';    // onglet dans la vue tournament
let activeBracketTab = 'gold';
let activeScheduleTab = 'poules';
let editingSlot = null;     // {matchId, original} pour la modal d'édition planning

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
  bindDashboardUI();

  store.subscribe(() => {
    // Si le tournoi courant a été supprimé et qu'on était sur sa vue, retour dashboard
    if (view === 'tournament' && !store.currentTournament()) {
      showDashboardView();
      return;
    }
    if (view === 'dashboard') renderDashboard();
    else renderTournamentPage();
  });

  // Décide la vue initiale selon l'URL
  const params = new URLSearchParams(location.search);
  const tid = params.get('t');
  if (tid && store.getTournament(tid)) {
    store.switchTournament(tid);
    showTournamentView();
  } else {
    showDashboardView();
  }
});

// ================================================================
// SESSION TIMER
// ================================================================
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
// NAVIGATION ENTRE VUES
// ================================================================
function showDashboardView() {
  view = 'dashboard';
  $('#view-dashboard').style.display = '';
  $('#view-tournament').style.display = 'none';
  // Update URL
  const url = new URL(location.href);
  url.searchParams.delete('t');
  history.replaceState(null, '', url.toString());
  renderDashboard();
}

function showTournamentView() {
  view = 'tournament';
  $('#view-dashboard').style.display = 'none';
  $('#view-tournament').style.display = '';
  // Update URL
  const t = store.currentTournament();
  if (t) {
    const url = new URL(location.href);
    url.searchParams.set('t', t.id);
    history.replaceState(null, '', url.toString());
  }
  renderTournamentPage();
}

// ================================================================
// BINDINGS GÉNÉRAUX
// ================================================================
function bindUI() {
  // Bouton "Retour au dashboard"
  $('#back-to-dashboard')?.addEventListener('click', showDashboardView);

  // Onglets de la page tournoi
  $$('.t-tab').forEach((t) => {
    t.addEventListener('click', () => {
      activeTab = t.dataset.tournamentTab;
      $$('.t-tab').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      $$('.t-tab-content').forEach((c) => c.classList.remove('active'));
      const target = $(`.t-tab-content[data-tournament-tab-content="${activeTab}"]`);
      if (target) target.classList.add('active');
      renderTournamentTab(activeTab);
    });
  });

  // Actions du header de page tournoi
  $('#tournament-rename-btn-page')?.addEventListener('click', () => {
    const t = store.currentTournament();
    if (!t) return;
    const n = prompt('Nouveau nom :', t.name);
    if (n && n.trim()) {
      store.renameTournament(t.id, n.trim());
      toast('Renommé.', 'success');
    }
  });
  $('#tournament-archive-btn-page')?.addEventListener('click', () => {
    const t = store.currentTournament();
    if (!t) return;
    store.archiveTournament(t.id);
    toast(t.archived ? 'Archivé.' : 'Désarchivé.', 'success');
  });
  $('#tournament-duplicate-btn-page')?.addEventListener('click', () => {
    const t = store.currentTournament();
    if (!t) return;
    const copy = store.duplicateTournament(t.id);
    if (copy) toast(`"${t.name}" dupliqué.`, 'success');
  });
  $('#tournament-delete-btn-page')?.addEventListener('click', () => {
    const t = store.currentTournament();
    if (!t) return;
    if (!confirm(`Supprimer définitivement "${t.name}" ?`)) return;
    store.deleteTournament(t.id);
    toast('Supprimé.', 'warn');
    showDashboardView();
  });

  // ===== Onglet Équipes =====
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
    if (!confirm('Supprimer toutes les équipes de ce tournoi ?')) return;
    store.setCurrent((s) => {
      s.teams = []; s.poules = []; s.matches = [];
      s.brackets = { gold: null, silver: null }; s.bracketMatches = [];
      s.schedule = []; s.phase = 'setup';
      s.history.push({ at: new Date().toISOString(), type: 'teams-clear', label: 'Toutes les équipes ont été supprimées' });
    });
    toast('Liste vidée.', 'warn');
  });

  // ===== Onglet Poules =====
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

  // ===== Onglet Arbres =====
  $$('.tab[data-bracket-tab]').forEach((t) => {
    t.addEventListener('click', () => {
      $$('.tab[data-bracket-tab]').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      activeBracketTab = t.dataset.bracketTab;
      renderKnockoutTab();
    });
  });

  // ===== Onglet Résultats : listener géré par renderResultsTab() =====

  // ===== Onglet Export =====
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
  $('#nav-reset')?.addEventListener('click', (e) => {
    e.preventDefault();
    store.resetCurrent();
    toast('Tournoi réinitialisé.', 'warn');
  });

  // ===== Modal bracket =====
  $('#modal-cancel')?.addEventListener('click', closeBracketModal);
  $('#bracket-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'bracket-modal') closeBracketModal();
  });
  $('#modal-save')?.addEventListener('click', saveBracketModal);

  // (Modale planning supprimée — déplacée sur la page schedule.html)

}

function bindDashboardUI() {
  $('#dashboard-new-btn')?.addEventListener('click', () => {
    const name = prompt('Nom du nouveau tournoi :', `Xapi Cup ${new Date().getFullYear()}`);
    if (!name) return;
    const t = store.createTournament(name.trim());
    toast(`Tournoi "${t.name}" créé.`, 'success');
    // Ouvre directement le nouveau tournoi
    setTimeout(() => showTournamentView(), 200);
  });
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
// DASHBOARD
// ================================================================
function renderDashboard() {
  const ts = store.listTournaments();
  const active = ts.filter((t) => !t.archived);
  const archived = ts.filter((t) => t.archived);

  // Stats globales
  const totalTeams = active.reduce((acc, t) => acc + t.teams.length, 0);
  const totalMatches = active.reduce((acc, t) => acc + t.matches.length + (t.bracketMatches?.length || 0), 0);
  const live = active.filter((t) => t.phase === 'poules' || t.phase === 'knockout').length;

  $('#dashboard-stats').innerHTML = '';
  $('#dashboard-stats').appendChild(el('div', { class: 'stat-card' },
    el('div', { class: 'stat-num' }, String(active.length)),
    el('div', { class: 'stat-label' }, 'Tournois actifs')
  ));
  $('#dashboard-stats').appendChild(el('div', { class: 'stat-card' },
    el('div', { class: 'stat-num' }, String(totalTeams)),
    el('div', { class: 'stat-label' }, 'Équipes')
  ));
  $('#dashboard-stats').appendChild(el('div', { class: 'stat-card' },
    el('div', { class: 'stat-num' }, String(totalMatches)),
    el('div', { class: 'stat-label' }, 'Matchs')
  ));
  $('#dashboard-stats').appendChild(el('div', { class: 'stat-card' },
    el('div', { class: 'stat-num' }, String(live)),
    el('div', { class: 'stat-label' }, 'En cours')
  ));

  // Cards actifs
  const cards = $('#tournament-cards');
  clear(cards);
  // Card "Créer"
  cards.appendChild(el('div', {
    class: 't-card t-card-create',
    onclick: () => $('#dashboard-new-btn').click(),
  },
    el('div', { class: 't-card-create-icon' }, '+'),
    el('div', { class: 't-card-create-label' }, 'Nouveau tournoi'),
  ));
  // Cards existantes
  active.forEach((t) => cards.appendChild(buildTournamentCard(t)));

  // Cards archivés
  if (archived.length) {
    $('#archived-section-title').style.display = '';
    const archCards = $('#tournament-cards-archived');
    clear(archCards);
    archived.forEach((t) => archCards.appendChild(buildTournamentCard(t)));
  } else {
    $('#archived-section-title').style.display = 'none';
  }
}

function buildTournamentCard(t) {
  const phaseLabels = {
    'setup': ['⚙️ Config', 'badge-setup'],
    'poules': ['📋 Poules', 'badge-poules'],
    'finished-pool': ['✅ Poules finies', 'badge-poules'],
    'knockout': ['🔥 Arbres', 'badge-knockout'],
    'finished': ['🏆 Terminé', 'badge-finished'],
  };
  const [label, badgeClass] = phaseLabels[t.phase] || ['—', 'badge-setup'];

  const card = el('div', { class: 't-card' + (t.archived ? ' archived' : '') },
    el('div', { class: 't-card-header' },
      el('h3', { class: 't-card-name' }, t.name),
      el('span', { class: `t-card-badge ${badgeClass}` }, label),
    ),
    el('div', { class: 't-card-stats' },
      el('div', { class: 't-card-stat' },
        el('div', { class: 't-card-stat-num' }, String(t.teams.length)),
        el('div', { class: 't-card-stat-label' }, 'Équipes')
      ),
      el('div', { class: 't-card-stat' },
        el('div', { class: 't-card-stat-num' }, String(t.poules.length)),
        el('div', { class: 't-card-stat-label' }, 'Poules')
      ),
      el('div', { class: 't-card-stat' },
        el('div', { class: 't-card-stat-num' }, String(t.matches.length + (t.bracketMatches?.length || 0))),
        el('div', { class: 't-card-stat-label' }, 'Matchs')
      ),
    ),
    el('div', { class: 't-card-actions' },
      el('button', { class: 'btn btn-sm btn-primary',
        onclick: (e) => { e.stopPropagation(); openTournament(t.id); }
      }, '📂 Ouvrir'),
      el('button', { class: 'btn btn-sm',
        style: { background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' },
        onclick: (e) => { e.stopPropagation(); duplicateTournament(t.id); }
      }, '📋'),
      el('button', { class: 'btn btn-sm',
        style: { background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' },
        onclick: (e) => { e.stopPropagation(); archiveTournament(t.id); }
      }, t.archived ? '↩' : '📦'),
      el('button', { class: 'btn btn-sm btn-danger',
        onclick: (e) => { e.stopPropagation(); deleteTournament(t.id); }
      }, '🗑️'),
    )
  );
  // Click sur la card (hors boutons) = ouvrir
  card.addEventListener('click', () => openTournament(t.id));
  return card;
}

function openTournament(id) {
  store.switchTournament(id);
  showTournamentView();
}

function duplicateTournament(id) {
  const t = store.getTournament(id);
  if (!t) return;
  const copy = store.duplicateTournament(id);
  if (copy) toast(`"${t.name}" dupliqué.`, 'success');
}

function archiveTournament(id) {
  const t = store.getTournament(id);
  if (!t) return;
  store.archiveTournament(id);
  toast(t.archived ? 'Désarchivé.' : 'Archivé.', 'info');
}

function deleteTournament(id) {
  const t = store.getTournament(id);
  if (!t) return;
  if (!confirm(`Supprimer définitivement "${t.name}" ?`)) return;
  store.deleteTournament(id);
  toast('Supprimé.', 'warn');
}

// ================================================================
// PAGE DE TOURNOI
// ================================================================
function renderTournamentPage() {
  const t = store.currentTournament();
  if (!t) {
    showDashboardView();
    return;
  }
  $('#tournament-page-title').textContent = t.name;
  const phaseLabels = {
    'setup': '⚙️ Configuration', 'poules': '📋 Phase de poules',
    'finished-pool': '✅ Poules terminées', 'knockout': '🔥 Phase finale',
    'finished': '🏆 Tournoi terminé',
  };
  $('#tournament-page-subtitle').textContent =
    `${t.teams.length} équipes · ${t.matches.length} matchs de poule · ${phaseLabels[t.phase] || ''}`;

  renderTournamentTab(activeTab);
}

function renderTournamentTab(tab) {
  switch (tab) {
    case 'teams': renderTeamsTab(); break;
    case 'poules': renderPoulesTab(); break;
    case 'knockout': renderKnockoutTab(); break;
    case 'results': renderResultsTab(); break;
    case 'history': renderHistoryTab(); break;
    case 'export': renderExportTab(); break;
  }
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
function renderTeamsTab() {
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
  syncSelectsWithState();
}

// ================================================================
// POULES + QUALIFICATION
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
  renderPoulesTab();
  renderScheduleTab();
  renderExportTab();
}

function renderPoulesTab() {
  const container = $('#poules-container');
  const alertSlot = $('#poules-alert-slot');
  if (!container || !alertSlot) return;
  clear(container); clear(alertSlot);
  const t = store.currentTournament();
  if (!t || !t.poules.length) {
    if (t?.teams.length) {
      alertSlot.appendChild(el('div', { class: 'alert alert-info' },
        '👆 Clique sur « Générer les poules » pour démarrer.'));
    } else {
      alertSlot.appendChild(el('div', { class: 'alert alert-warn' },
        '⚠ Inscris d\'abord tes équipes dans l\'onglet Équipes.'));
    }
  } else {
    const grid = el('div', { class: 'poules-grid' });
    t.poules.forEach((pouleTeams, idx) => {
      const matches = t.matches.filter((m) => m.pouleIdx === idx);
      grid.appendChild(renderPoule(idx, pouleTeams, matches, t.config.qualifiersPerPool, true, handlePouleMatchChange));
    });
    container.appendChild(grid);
  }
  renderQualifiersSection();
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

function renderQualifiersSection() {
  const preview = $('#qualifiers-preview');
  const actions = $('#qualifiers-actions');
  const alertSlot = $('#qualifiers-alert-slot');
  if (!preview) return;
  clear(preview); clear(alertSlot);
  const t = store.currentTournament();
  if (!t || !t.poules.length) {
    actions.style.display = 'none';
    return;
  }
  const unfinished = t.matches.filter((m) => !m.finished).length;
  if (unfinished > 0 && !t.brackets.gold) {
    alertSlot.appendChild(el('div', { class: 'alert alert-info' },
      `ℹ️ ${unfinished} match(s) de poule restant(s). Les qualifiés sont calculés en temps réel.`));
  } else if (t.brackets.gold) {
    alertSlot.appendChild(el('div', { class: 'alert alert-success' }, '✅ Arbres générés. Voir l\'onglet Arbres.'));
  }

  const allStandings = t.poules.map((p, idx) => {
    const matches = t.matches.filter((m) => m.pouleIdx === idx);
    return computeStandings(p, matches);
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
    return computeStandings(p, matches);
  });
  const includeConsolante = t.config.includeConsolante !== false;
  const { gold, consolante } = splitQualifiers(allStandings, t.config.qualifiersPerPool, includeConsolante);

  if (gold.length < 2) { toast('Pas assez de qualifiés.', 'warn'); return; }

  const goldBracket = buildBracket(gold);
  const silverBracket = (includeConsolante && consolante.length >= 2) ? buildBracket(consolante) : null;

  const allBracketMatches = [];
  [goldBracket, silverBracket].forEach((br) => {
    if (!br) return;
    br.rounds.forEach((round) => round.forEach((m) => allBracketMatches.push({ ...m })));
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
  // Switch auto sur l'onglet Arbres
  activeTab = 'knockout';
  $$('.t-tab').forEach((t) => t.classList.toggle('active', t.dataset.tournamentTab === 'knockout'));
  $$('.t-tab-content').forEach((c) => c.classList.toggle('active', c.dataset.tournamentTabContent === 'knockout'));
  renderKnockoutTab();
}

// ================================================================
// ARBRES
// ================================================================
function renderKnockoutTab() {
  const container = $('#knockout-container');
  if (!container) return;
  clear(container);
  const t = store.currentTournament();
  if (!t || (!t.brackets.gold && !t.brackets.silver)) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '🏆'),
      el('h3', {}, 'Aucun arbre généré pour l\'instant.'),
      el('p', {}, 'Termine les poules, puis clique sur "Lancer les arbres" dans l\'onglet Poules.')));
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
  // Petite finale : match.isThirdPlace === true
  if (match.isThirdPlace) {
    if (match.slotA == null || match.slotB == null) {
      toast('Les perdants des demi-finales ne sont pas encore déterminés.', 'warn');
      return;
    }
  } else {
    if (match.slotA == null || match.slotB == null) {
      toast('Les deux équipes ne sont pas encore déterminées.', 'warn');
      return;
    }
  }
  modalContext = { kind: activeBracketTab, rIdx, mIdx, match, isThirdPlace: !!match.isThirdPlace };
  const t = store.currentTournament();
  const tA = t.teams.find((x) => x.id === match.slotA);
  const tB = t.teams.find((x) => x.id === match.slotB);
  $('#modal-title').textContent = (match.isThirdPlace ? '🥉 Petite finale : ' : '') + `${tA?.name || '?'} vs ${tB?.name || '?'}`;
  const body = $('#modal-body');
  clear(body);
  const row = el('div', { class: 'form-row', style: { alignItems: 'end' } });
  row.appendChild(el('div', { class: 'form-group', style: { flex: 1 } },
    el('label', {}, tA?.name || '?'),
    el('input', { type: 'number', min: '0', class: 'input', id: 'modal-scoreA', value: match.scoreA ?? 0 })));
  row.appendChild(el('div', { class: 'form-group', style: { flex: 1 } },
    el('label', {}, tB?.name || '?'),
    el('input', { type: 'number', min: '0', class: 'input', id: 'modal-scoreB', value: match.scoreB ?? 0 })));
  body.appendChild(row);
  body.appendChild(el('p', { class: 'help' }, match.isThirdPlace ? 'Match pour la 3e place.' : 'Saisis les scores. Vainqueur désigné automatiquement.'));
  $('#modal-save').textContent = 'Valider le score';
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
  if (isNaN(scoreA) || isNaN(scoreB) || scoreA < 0 || scoreB < 0) { toast('Scores invalides.', 'warn'); return; }
  const { kind, rIdx, mIdx, isThirdPlace } = modalContext;

  // Petite finale : cas spécial
  if (isThirdPlace) {
    store.setCurrent((s) => {
      const br = s.brackets[kind];
      const m = br.thirdPlaceMatch;
      m.scoreA = scoreA; m.scoreB = scoreB;
      if (scoreA > scoreB) m.winnerSlot = 'A';
      else if (scoreB > scoreA) m.winnerSlot = 'B';
      else m.winnerSlot = null;
      m.finished = m.winnerSlot != null;
      m.finishedAt = new Date().toISOString();
      const tA = s.teams.find((x) => x.id === m.slotA);
      const tB = s.teams.find((x) => x.id === m.slotB);
      s.history.push({
        at: m.finishedAt, type: 'match-finished',
        label: `🥉 Petite finale : ${tA?.name || '?'} ${scoreA}-${scoreB} ${tB?.name || '?'}`,
        data: { matchId: m.id, kind: 'third-place' }
      });
    });
    closeBracketModal();
    toast('Petite finale enregistrée.', 'success');
    return;
  }

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
    // Propagation manuelle (mêmes règles que setBracketScore mais aussi la petite finale)
    for (let r = 0; r < br.rounds.length - 1; r++) {
      const round = br.rounds[r];
      round.forEach((match, mi) => {
        if (!match.finished) return;
        const winnerId = match.winnerSlot === 'A' ? match.slotA : match.slotB;
        if (!winnerId) return;
        const nextMatch = br.rounds[r + 1][match.nextMatchIdx];
        if (match.nextSlot === 'A') nextMatch.slotA = winnerId;
        else nextMatch.slotB = winnerId;
      });
    }
    // Petite finale
    if (br.thirdPlaceMatch && br.rounds.length >= 2) {
      const semis = br.rounds[br.rounds.length - 2];
      if (semis.length >= 2 && semis[0].finished && semis[1].finished) {
        br.thirdPlaceMatch.slotA = semis[0].winnerSlot === 'A' ? semis[0].slotB : semis[0].slotA;
        br.thirdPlaceMatch.slotB = semis[1].winnerSlot === 'A' ? semis[1].slotB : semis[1].slotA;
      }
    }
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
// RÉSULTATS (vue synthétique des matchs terminés)
// ================================================================
function renderResultsTab() {
  const container = $('#results-container');
  if (!container) return;
  clear(container);
  const t = store.currentTournament();
  if (!t) return;

  // Matchs terminés (poules + bracket + petite finale)
  const finishedPoules = t.matches.filter((m) => m.finished);
  const finishedBrackets = (t.bracketMatches || []).filter((m) => m.finished);
  const finishedThird = [];
  if (t.brackets.gold?.thirdPlaceMatch?.finished) finishedThird.push(t.brackets.gold.thirdPlaceMatch);
  if (t.brackets.silver?.thirdPlaceMatch?.finished) finishedThird.push(t.brackets.silver.thirdPlaceMatch);
  const all = [...finishedPoules, ...finishedBrackets, ...finishedThird];

  if (!all.length) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '📋'),
      el('h3', {}, 'Aucun résultat pour l\'instant.'),
      el('p', {}, 'Les matchs terminés apparaîtront ici.')));
    return;
  }

  // Tri par date de fin décroissante
  all.sort((a, b) => (b.finishedAt || '').localeCompare(a.finishedAt || ''));

  const list = el('div', { class: 'results-list' });
  all.forEach((m) => {
    const tA = t.teams.find((x) => x.id === m.slotA);
    const tB = t.teams.find((x) => x.id === m.slotB);
    const aWins = m.winnerSlot === 'A';
    const bWins = m.winnerSlot === 'B';
    const isThird = m.label === 'Petite finale';
    const d = new Date(m.finishedAt || Date.now());

    list.appendChild(el('div', {
      class: 'result-item'
        + (aWins ? ' winner-a' : '')
        + (bWins ? ' winner-b' : '')
        + (isThird ? ' third-place' : '')
    },
      isThird ? el('div', { class: 'result-label' }, '🥉 Petite finale')
             : (m.pouleIdx != null ? el('div', { class: 'result-label' },
                `Poule ${String.fromCharCode(65 + m.pouleIdx)} · `,
                el('span', { class: 'muted' }, `Match ${(m.matchIdx || 0) + 1}`))
                                   : el('div', { class: 'result-label' }, '🏆 Phase finale')),
      el('div', { class: 'result-score' },
        el('span', { class: 'result-team' + (aWins ? ' winner' : '') }, tA?.name || '?'),
        el('span', { class: 'result-numbers' },
          el('span', {}, String(m.scoreA ?? '-')),
          el('span', { class: 'dash' }, ' - '),
          el('span', {}, String(m.scoreB ?? '-'))),
        el('span', { class: 'result-team' + (bWins ? ' winner' : '') }, tB?.name || '?')
      ),
      el('div', { class: 'result-time muted' }, d.toLocaleString('fr-FR')),
    ));
  });
  container.appendChild(list);

  // Résumé par tournoi
  const total = all.length;
  const winnerA = all.filter((m) => m.winnerSlot === 'A').length;
  container.appendChild(el('div', { class: 'alert alert-info', style: { marginTop: '20px' } },
    el('strong', {}, `${total} matchs terminés`),
    el('span', {}, ` · ${winnerA} victoires à gauche, ${total - winnerA} à droite.`)));
}

// ================================================================
// HISTORIQUE
// ================================================================
function renderHistoryTab() {
  const list = $('#history-list');
  if (!list) return;
  clear(list);
  const t = store.currentTournament();
  if (!t) return;
  const items = [...(t.history || [])].reverse().slice(0, 100);
  if (!items.length) {
    list.appendChild(el('p', { class: 'muted text-center' }, 'Aucun événement pour l\'instant.'));
    return;
  }
  const typeIcons = {
    'team-add': '➕', 'team-remove': '➖', 'teams-clear': '🧹',
    'poules-draw': '🎲', 'brackets-launched': '🚀',
    'match-finished': '⚽', 'schedule-generated': '📅', 'schedule-edited': '✏️',
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
// EXPORT
// ================================================================
function renderExportTab() {
  // Pas de rendu spécifique, juste laisser les inputs visibles
}
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
