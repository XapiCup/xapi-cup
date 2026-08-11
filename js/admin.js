/* ================================================================
   ADMIN.JS — Logique complète de la page administrateur
   ================================================================ */

import { store } from './state.js';
import {
  generatePoules, generatePouleMatches, computeStandings,
  buildBracket, setBracketWinner, splitQualifiers,
} from './tournament.js';
import { renderPoule, renderBracket } from './render.js';
import { $, $$, el, clear, toast, downloadFile, onReady, teamColor } from './app.js';
import { exportElementAsImage } from './export.js';
import {
  isAuthenticated, renderLoginScreen, bindLogoutButton,
} from './auth.js';

// ================================================================
// STATE LOCAL (UI state only, pas métier)
// ================================================================
let activeBracketTab = 'gold';
let pendingQualifierOverride = null; // édition manuelle des qualifiés

// ================================================================
// ENTRY POINT
// ================================================================
onReady(() => {
  // Vérifier la session
  if (!isAuthenticated()) {
    // Affiche l'écran de login, cache tout le reste
    document.getElementById('admin-header').style.display = 'none';
    document.getElementById('auth-banner').style.display = 'none';
    document.getElementById('admin-content').style.display = 'none';
    document.body.style.overflow = 'hidden';

    renderLoginScreen(document.body, () => {
      // Succès : on recharge la page pour démarrer proprement
      location.reload();
    });
    return;
  }

  // Session valide : afficher le contenu admin
  document.getElementById('admin-header').style.display = '';
  document.getElementById('auth-banner').style.display = 'flex';
  document.getElementById('admin-content').style.display = '';
  document.body.style.overflow = '';

  // Timer de session
  updateSessionTimer();
  setInterval(updateSessionTimer, 60_000);

  bindUI();
  bindLogoutButton();
  bindPasswordChange();

  // Rendu à chaque changement d'état
  store.subscribe((state) => {
    renderTeamsList(state);
    renderPoulesSection(state);
    renderQualifiersSection(state);
    renderKnockoutSection(state);
    syncSelectsWithState(state);
  });
  // Premier render
  renderTeamsList(store.state);
  renderPoulesSection(store.state);
  renderQualifiersSection(store.state);
  renderKnockoutSection(store.state);
  syncSelectsWithState(store.state);
});

function updateSessionTimer() {
  const el = document.getElementById('session-timer');
  if (!el) return;
  if (!isAuthenticated()) {
    el.textContent = '(session expirée)';
    return;
  }
  try {
    const raw = localStorage.getItem('xapi-cup-session-v1');
    const s = JSON.parse(raw);
    const ms = s.expiresAt - Date.now();
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    el.textContent = `· session expire dans ${h}h${String(m).padStart(2,'0')}`;
  } catch (e) {
    el.textContent = '';
  }
}

function bindPasswordChange() {
  const modal = document.getElementById('password-modal');
  const open = () => {
    document.getElementById('pwd-current').value = '';
    document.getElementById('pwd-new').value = '';
    document.getElementById('pwd-new2').value = '';
    document.getElementById('pwd-error').innerHTML = '';
    modal.classList.add('show');
    setTimeout(() => document.getElementById('pwd-current').focus(), 50);
  };
  const close = () => modal.classList.remove('show');

  document.getElementById('change-pwd-btn').addEventListener('click', open);
  document.getElementById('pwd-cancel').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  document.getElementById('pwd-save').addEventListener('click', async () => {
    const cur = document.getElementById('pwd-current').value;
    const n1 = document.getElementById('pwd-new').value;
    const n2 = document.getElementById('pwd-new2').value;
    const errSlot = document.getElementById('pwd-error');
    errSlot.innerHTML = '';

    if (!cur || !n1 || !n2) {
      errSlot.innerHTML = '<div class="alert alert-danger" style="margin-top:10px;">Tous les champs sont requis.</div>';
      return;
    }
    if (n1 !== n2) {
      errSlot.innerHTML = '<div class="alert alert-danger" style="margin-top:10px;">Les deux nouveaux mots de passe ne correspondent pas.</div>';
      return;
    }
    if (n1.length < 6) {
      errSlot.innerHTML = '<div class="alert alert-danger" style="margin-top:10px;">6 caractères minimum.</div>';
      return;
    }
    try {
      const { changePassword } = await import('./auth.js');
      await changePassword(cur, n1);
      close();
      toast('Mot de passe mis à jour avec succès.', 'success');
    } catch (e) {
      errSlot.innerHTML = `<div class="alert alert-danger" style="margin-top:10px;">${e.message}</div>`;
    }
  });
}

// ================================================================
// BINDING UI
// ================================================================
function bindUI() {
  // ---- Navigation latérale (scroll to section) ----
  $$('.admin-nav a[data-tab]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      $$('.admin-nav a').forEach((x) => x.classList.remove('active'));
      a.classList.add('active');
      const target = document.getElementById('section-' + a.dataset.tab);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // ---- Reset ----
  $('#nav-reset').addEventListener('click', (e) => {
    e.preventDefault();
    store.resetAll();
    toast('Tout a été réinitialisé.', 'warn');
  });

  // ---- Ajout équipe ----
  $('#add-team-btn').addEventListener('click', addTeamFromInput);
  $('#team-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addTeamFromInput(); }
  });

  // ---- Ajout en masse ----
  $('#bulk-add-btn').addEventListener('click', () => {
    const ta = $('#bulk-input');
    const lines = ta.value.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) { toast('Saisissez au moins un nom.', 'warn'); return; }
    const added = store.addTeamsBulk(lines);
    ta.value = '';
    toast(`${added.length} équipe(s) ajoutée(s).`, 'success');
  });

  // ---- Vider la liste ----
  $('#clear-teams-btn').addEventListener('click', () => {
    if (!confirm('Supprimer toutes les équipes ?')) return;
    store.setState((s) => {
      s.teams = [];
      s.poules = [];
      s.matches = [];
      s.brackets = { gold: null, silver: null };
      s.phase = 'setup';
    });
    toast('Liste vidée.', 'warn');
  });

  // ---- Tirage des poules ----
  $('#generate-poules-btn').addEventListener('click', () => {
    const state = store.state;
    if (state.teams.length < 3) {
      toast('Il faut au moins 3 équipes pour faire des poules.', 'warn');
      return;
    }
    const nbPoules = parseInt($('#nb-poules').value, 10);
    if (nbPoules > state.teams.length) {
      toast(`Impossible : ${nbPoules} poules pour ${state.teams.length} équipes.`, 'warn');
      return;
    }
    if (!confirm(`Tirer ${nbPoules} poules à partir de ${state.teams.length} équipes ?`)) return;
    runPouleDraw();
  });

  // ---- Sélecteurs qualification ----
  $('#qualifiers-per-pool').addEventListener('change', (e) => {
    const v = parseInt(e.target.value, 10);
    store.setState((s) => { s.config.qualifiersPerPool = v; });
  });
  $('#enable-consolante').addEventListener('change', (e) => {
    store.setState((s) => { s.config.includeConsolante = e.target.checked; });
  });

  // ---- Lancer les arbres ----
  $('#launch-brackets-btn').addEventListener('click', launchBrackets);

  // ---- Tabs phase finale ----
  $$('.tab[data-bracket-tab]').forEach((t) => {
    t.addEventListener('click', () => {
      $$('.tab[data-bracket-tab]').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      activeBracketTab = t.dataset.bracketTab;
      renderKnockoutSection(store.state);
    });
  });

  // ---- Export ----
  $('#export-btn').addEventListener('click', handleExportImage);
  $('#export-json-btn').addEventListener('click', () => {
    const edition = store.state.meta.edition || 'tournoi';
    const filename = `xapi-cup-${slugify(edition)}-${dateStr()}.json`;
    downloadFile(filename, store.exportJSON());
    toast('Sauvegarde téléchargée.', 'success');
  });
  $('#import-json-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    if (store.importJSON(text)) {
      toast('Sauvegarde restaurée.', 'success');
    }
    e.target.value = '';
  });

  // ---- Modal ----
  $('#modal-cancel').addEventListener('click', closeBracketModal);
  $('#bracket-modal').addEventListener('click', (e) => {
    if (e.target.id === 'bracket-modal') closeBracketModal();
  });
  $('#modal-save').addEventListener('click', saveBracketModal);
}

// ================================================================
// TEAMS
// ================================================================
function addTeamFromInput() {
  const input = $('#team-input');
  const name = input.value.trim();
  if (!name) return;
  const t = store.addTeam(name);
  if (!t) { toast(`"${name}" est déjà inscrit.`, 'warn'); return; }
  input.value = '';
  input.focus();
  toast(`Équipe "${t.name}" ajoutée.`, 'success');
}

function renderTeamsList(state) {
  const list = $('#teams-list');
  clear(list);
  $('#teams-count').textContent = state.teams.length;
  if (!state.teams.length) {
    list.appendChild(el('li', {
      class: 'muted',
      style: { gridColumn: '1 / -1', textAlign: 'center', padding: '20px' }
    }, 'Aucune équipe inscrite pour l\'instant.'));
    return;
  }
  state.teams.forEach((t) => {
    const li = el('li', { class: 'team-item' });
    li.appendChild(el('span', { class: 'team-color', style: { background: t.color } }));
    li.appendChild(el('span', { class: 'team-name', title: t.name }, t.name));
    const removeBtn = el('button', {
      class: 'team-remove',
      title: 'Supprimer',
      onclick: () => {
        if (confirm(`Retirer "${t.name}" ?`)) {
          store.removeTeam(t.id);
          toast(`"${t.name}" a été retirée.`, 'warn');
        }
      }
    }, '×');
    li.appendChild(removeBtn);
    list.appendChild(li);
  });
}

// ================================================================
// POULES
// ================================================================
function runPouleDraw() {
  const state = store.state;
  const nbPoules = parseInt($('#nb-poules').value, 10);
  const poules = generatePoules(state.teams, nbPoules);
  const matches = [];
  poules.forEach((p, idx) => {
    matches.push(...generatePouleMatches(idx, p));
  });
  store.setState((s) => {
    s.poules = poules;
    s.matches = matches;
    s.brackets = { gold: null, silver: null };
    s.phase = 'poules';
    s.config.nbPoules = nbPoules;
  });
  toast(`${nbPoules} poules générées · ${matches.length} matchs.`, 'success');
  // scroll vers la section
  $('#section-poules').scrollIntoView({ behavior: 'smooth' });
}

function renderPoulesSection(state) {
  const container = $('#poules-container');
  const alertSlot = $('#poules-alert-slot');
  clear(container);
  clear(alertSlot);

  if (!state.poules.length) {
    if (state.teams.length) {
      alertSlot.appendChild(el('div', { class: 'alert alert-info' },
        '👆 Cliquez sur « Générer les poules » pour démarrer le tournoi.'));
    } else {
      alertSlot.appendChild(el('div', { class: 'alert alert-warn' },
        '⚠ Inscrivez d\'abord vos équipes dans la section 1.'));
    }
    return;
  }

  const grid = el('div', { class: 'poules-grid' });
  state.poules.forEach((pouleTeams, idx) => {
    const matches = state.matches.filter((m) => m.pouleIdx === idx);
    grid.appendChild(renderPoule(
      idx, pouleTeams, matches, state.config.qualifiersPerPool,
      true, // editable
      handlePouleMatchChange
    ));
  });
  container.appendChild(grid);
}

function handlePouleMatchChange(matchId, teamKey, value) {
  const v = value === '' ? null : parseInt(value, 10);
  if (v != null && (isNaN(v) || v < 0)) { toast('Score invalide.', 'warn'); return; }
  store.setState((s) => {
    const m = s.matches.find((x) => x.id === matchId);
    if (!m) return;
    if (teamKey === 'A') m.scoreA = v;
    else m.scoreB = v;
    m.finished = (m.scoreA != null && m.scoreB != null);
  });
}

// ================================================================
// QUALIFICATION
// ================================================================
function renderQualifiersSection(state) {
  const preview = $('#qualifiers-preview');
  const actions = $('#qualifiers-actions');
  const alertSlot = $('#qualifiers-alert-slot');
  clear(preview);
  clear(alertSlot);

  if (!state.poules.length) {
    alertSlot.appendChild(el('div', { class: 'alert alert-warn' },
      '⚠ Générez d\'abord les poules (section 2).'));
    actions.style.display = 'none';
    return;
  }

  // Vérifier que toutes les poules sont terminées
  const unfinished = state.matches.filter((m) => !m.finished).length;
  if (unfinished > 0 && !state.brackets.gold) {
    alertSlot.appendChild(el('div', { class: 'alert alert-info' },
      `ℹ️ ${unfinished} match(s) de poule restant(s). Les qualifiés sont calculés en temps réel ci-dessous.`));
  } else if (state.brackets.gold) {
    alertSlot.appendChild(el('div', { class: 'alert alert-success' },
      '✅ Arbres générés. Vous pouvez les gérer dans la section 4.'));
  }

  // Calculer standings par poule
  const allStandings = state.poules.map((p, idx) => {
    const matches = state.matches.filter((m) => m.pouleIdx === idx);
    return computeStandings(p, matches);
  });

  // Aperçu qualifiés Or / Consolante
  const includeConsolante = state.config.includeConsolante !== false;
  const { gold, consolante } = splitQualifiers(allStandings, state.config.qualifiersPerPool, includeConsolante);

  const grid = el('div', { class: 'poules-grid' });
  allStandings.forEach((standings, idx) => {
    const wrap = el('div', { class: 'poule' });
    wrap.appendChild(el('h3', {}, `Poule ${String.fromCharCode(65 + idx)}`,
      el('span', { class: 'poule-size' }, `${standings.length} équipes`)
    ));
    const table = el('table', { class: 'standings-table' });
    table.appendChild(el('thead', {},
      el('tr', {},
        el('th', { style: { width: '30px' } }, '#'),
        el('th', { style: { textAlign: 'left' } }, 'Équipe'),
        el('th', {}, 'Pts'),
      )
    ));
    const tb = el('tbody');
    standings.forEach((s, sIdx) => {
      const isQual = sIdx < state.config.qualifiersPerPool;
      const tr = el('tr', { class: isQual ? 'qualifie' : '' });
      tr.appendChild(el('td', { class: 'rank-cell' }, String(sIdx + 1)));
      tr.appendChild(el('td', { class: 'team-cell' },
        el('span', { class: 'team-color', style: { background: s.team.color } }),
        s.team.name
      ));
      tr.appendChild(el('td', {}, String(s.points)));
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    wrap.appendChild(table);
    grid.appendChild(wrap);
  });

  preview.appendChild(grid);

  // Récap qualifiés
  const recap = el('div', {
    class: 'alert alert-info',
    style: { marginTop: '16px' }
  },
    el('strong', {}, `🏆 Qualifiés Or (${gold.length}) : `),
    el('span', {}, gold.map((t) => t.name).join(', ') || 'aucun'),
    includeConsolante && consolante.length ? el('div', {},
      el('strong', {}, `🥈 Consolante (${consolante.length}) : `),
      el('span', {}, consolante.map((t) => t.name).join(', '))
    ) : null
  );
  preview.appendChild(recap);

  if (gold.length >= 2) {
    actions.style.display = '';
  } else {
    actions.style.display = 'none';
  }
}

function launchBrackets() {
  const state = store.state;
  const allStandings = state.poules.map((p, idx) => {
    const matches = state.matches.filter((m) => m.pouleIdx === idx);
    return computeStandings(p, matches);
  });
  const includeConsolante = state.config.includeConsolante !== false;
  const { gold, consolante } = splitQualifiers(allStandings, state.config.qualifiersPerPool, includeConsolante);

  if (gold.length < 2) { toast('Pas assez de qualifiés.', 'warn'); return; }
  if (includeConsolante && consolante.length < 2) {
    if (!confirm('Pas assez d\'équipes pour la consolante. On la désactive ?')) {
      return;
    }
  }

  const goldBracket = buildBracket(gold);
  const silverBracket = (includeConsolante && consolante.length >= 2)
    ? buildBracket(consolante) : null;

  store.setState((s) => {
    s.brackets = { gold: goldBracket, silver: silverBracket };
    s.phase = 'knockout';
  });
  toast(`Arbres générés : ${gold.length} équipes en Or, ${consolante.length} en Consolante.`, 'success');
  // scroll
  $('#section-knockout').scrollIntoView({ behavior: 'smooth' });
  // activer l'onglet gold
  activeBracketTab = 'gold';
  $$('.tab[data-bracket-tab]').forEach((t) => t.classList.toggle('active', t.dataset.bracketTab === 'gold'));
}

// ================================================================
// PHASE FINALE (knockout)
// ================================================================
function renderKnockoutSection(state) {
  const container = $('#knockout-container');
  clear(container);
  if (!state.brackets.gold && !state.brackets.silver) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '🏆'),
      el('h3', {}, 'Aucun arbre généré pour l\'instant.'),
      el('p', {}, 'Complétez la section 3 pour lancer la phase finale.')
    ));
    return;
  }
  if (activeBracketTab === 'gold' && state.brackets.gold) {
    container.appendChild(renderBracket(state.brackets.gold, state, {
      title: 'Tableau Or',
      kind: 'gold',
      editable: true,
      onClick: openBracketModal,
    }));
  } else if (activeBracketTab === 'silver' && state.brackets.silver) {
    container.appendChild(renderBracket(state.brackets.silver, state, {
      title: 'Consolante',
      kind: 'silver',
      editable: true,
      onClick: openBracketModal,
    }));
  } else if (activeBracketTab === 'silver' && !state.brackets.silver) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '🥈'),
      el('h3', {}, 'Consolante désactivée.'),
      el('p', {}, 'Activez-la dans la section 3 avant de générer les arbres.')
    ));
  }
}

let modalContext = null; // {kind, rIdx, mIdx}

function openBracketModal(match, rIdx, mIdx) {
  if (match.slotA == null || match.slotB == null) {
    toast('Les deux équipes ne sont pas encore déterminées.', 'warn');
    return;
  }
  modalContext = { kind: activeBracketTab, rIdx, mIdx, match };
  const state = store.state;
  const tA = state.teams.find((t) => t.id === match.slotA);
  const tB = state.teams.find((t) => t.id === match.slotB);
  $('#modal-title').textContent = `${tA.name} vs ${tB.name}`;
  const body = $('#modal-body');
  clear(body);

  const row = el('div', { class: 'form-row', style: { alignItems: 'end' } });
  const a = el('div', { class: 'form-group', style: { flex: 1 } },
    el('label', {}, tA.name + ' (couleur : ', el('span', {
      style: { display: 'inline-block', width: '12px', height: '12px', background: tA.color, borderRadius: '50%', verticalAlign: 'middle' }
    }), ')'),
    el('input', { type: 'number', min: '0', class: 'input', id: 'modal-scoreA', value: match.scoreA ?? 0 })
  );
  const b = el('div', { class: 'form-group', style: { flex: 1 } },
    el('label', {}, tB.name + ' (couleur : ', el('span', {
      style: { display: 'inline-block', width: '12px', height: '12px', background: tB.color, borderRadius: '50%', verticalAlign: 'middle' }
    }), ')'),
    el('input', { type: 'number', min: '0', class: 'input', id: 'modal-scoreB', value: match.scoreB ?? 0 })
  );
  row.appendChild(a);
  row.appendChild(b);
  body.appendChild(row);
  body.appendChild(el('p', { class: 'help' },
    'Saisissez les scores. Le vainqueur est désigné automatiquement (en cas d\'égalité, vous choisirez à la validation).'));

  $('#modal-save').textContent = 'Valider le vainqueur';
  $('#bracket-modal').classList.add('show');
  $('#modal-scoreA').focus();
  $('#modal-scoreA').select();
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
    toast('Scores invalides.', 'warn');
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

  const { kind, rIdx, mIdx } = modalContext;
  store.setState((s) => {
    const bracket = s.brackets[kind];
    if (!bracket) return;
    const m = bracket.rounds[rIdx][mIdx];
    m.scoreA = scoreA;
    m.scoreB = scoreB;
    m.winnerSlot = winner;
    m.finished = true;
    // propager
    if (rIdx < bracket.rounds.length - 1) {
      const next = bracket.rounds[rIdx + 1];
      const nextIdx = Math.floor(mIdx / 2);
      const nextMatch = next[nextIdx];
      const winnerId = winner === 'A' ? m.slotA : m.slotB;
      if (mIdx % 2 === 0) nextMatch.slotA = winnerId;
      else nextMatch.slotB = winnerId;
    }
  });
  closeBracketModal();
  toast('Score enregistré.', 'success');
}

// ================================================================
// EXPORT IMAGE
// ================================================================
async function handleExportImage() {
  const mode = $('#export-select').value;
  const format = $('#export-format').value;
  const edition = slugify(store.state.meta.edition || 'tournoi');

  const exportOne = async (bracket, title) => {
    // Rendu temporaire invisible
    const tmp = document.createElement('div');
    tmp.style.position = 'fixed';
    tmp.style.top = '-99999px';
    tmp.style.left = '0';
    tmp.style.background = '#fff';
    tmp.style.padding = '20px';
    tmp.style.width = 'max-content';
    document.body.appendChild(tmp);
    const node = renderBracket(bracket, store.state, { title, kind: title.includes('Or') ? 'gold' : 'silver' });
    tmp.appendChild(node);
    try {
      await exportElementAsImage(node, `xapi-cup-${edition}-${slugify(title)}`, format, 2);
    } finally {
      document.body.removeChild(tmp);
    }
  };

  try {
    if (mode === 'gold' && store.state.brackets.gold) {
      await exportOne(store.state.brackets.gold, 'Tableau Or');
    } else if (mode === 'silver' && store.state.brackets.silver) {
      await exportOne(store.state.brackets.silver, 'Consolante');
    } else if (mode === 'both') {
      if (store.state.brackets.gold) await exportOne(store.state.brackets.gold, 'Tableau Or');
      if (store.state.brackets.silver) await exportOne(store.state.brackets.silver, 'Consolante');
    } else {
      toast('Aucun arbre à exporter pour ce mode.', 'warn');
      return;
    }
    toast('Image exportée !', 'success');
  } catch (e) {
    toast('Erreur export : ' + e.message, 'danger', 5000);
  }
}

// ================================================================
// UTILS
// ================================================================
function syncSelectsWithState(state) {
  const np = $('#nb-poules');
  if (np && parseInt(np.value, 10) !== state.config.nbPoules) {
    np.value = String(state.config.nbPoules);
  }
  const qp = $('#qualifiers-per-pool');
  if (qp && parseInt(qp.value, 10) !== state.config.qualifiersPerPool) {
    qp.value = String(state.config.qualifiersPerPool);
  }
  const ec = $('#enable-consolante');
  if (ec) ec.checked = state.config.includeConsolante !== false;
}

function slugify(s) {
  return (s || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'xapi-cup';
}

function dateStr() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
