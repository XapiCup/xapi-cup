/* ================================================================
   VIEWER.JS — Page publique en lecture seule, mises à jour live
   ================================================================ */

import { store } from './state.js';
import { renderPoule, renderBracket } from './render.js';
import { $, $$, el, clear, onReady } from './app.js';

let activeBracketTab = 'gold';

onReady(() => {
  // Tabs principaux
  $$('.tab[data-viewer-tab]').forEach((t) => {
    t.addEventListener('click', () => {
      $$('.tab[data-viewer-tab]').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      const target = t.dataset.viewerTab;
      $$('.tab-content').forEach((c) => c.classList.remove('active'));
      $('#tab-' + target).classList.add('active');
    });
  });

  // Tabs brackets
  $$('.tab[data-bracket-tab]').forEach((t) => {
    t.addEventListener('click', () => {
      $$('[data-bracket-tab]').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      activeBracketTab = t.dataset.bracketTab;
      renderKnockout(store.state);
    });
  });

  // Render initial + abonnements
  store.subscribe(renderAll);
  renderAll(store.state);
});

function renderAll(state) {
  // Bandeau live
  const ls = $('#live-status');
  clear(ls);
  const phaseLabels = {
    'setup': '⚙️ Configuration',
    'poules': '📋 Phase de poules',
    'finished-pool': '✅ Poules terminées',
    'knockout': '🔥 Phase finale',
    'finished': '🏆 Tournoi terminé',
  };
  ls.appendChild(el('div', { class: 'live-pill' }, phaseLabels[state.phase] || 'En cours'));

  // Poules
  renderPoules(state);
  // Phase finale
  renderKnockout(state);
}

function renderPoules(state) {
  const container = $('#poules-container');
  clear(container);
  if (!state.poules.length) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '⏳'),
      el('h3', {}, 'Le tournoi n\'a pas encore commencé.'),
      el('p', {}, 'Les poules seront générées très bientôt. Restez connectés !')
    ));
    return;
  }
  const grid = el('div', { class: 'poules-grid' });
  state.poules.forEach((pouleTeams, idx) => {
    const matches = state.matches.filter((m) => m.pouleIdx === idx);
    grid.appendChild(renderPoule(idx, pouleTeams, matches, state.config.qualifiersPerPool, false));
  });
  container.appendChild(grid);
}

function renderKnockout(state) {
  const container = $('#knockout-container');
  clear(container);
  if (!state.brackets.gold && !state.brackets.silver) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '🏆'),
      el('h3', {}, 'La phase finale n\'a pas encore commencé.'),
      el('p', {}, 'Les arbres seront disponibles dès que les poules seront terminées.')
    ));
    return;
  }
  if (activeBracketTab === 'gold' && state.brackets.gold) {
    container.appendChild(renderBracket(state.brackets.gold, state, {
      title: 'Tableau Or',
      kind: 'gold',
      editable: false,
    }));
  } else if (activeBracketTab === 'silver' && state.brackets.silver) {
    container.appendChild(renderBracket(state.brackets.silver, state, {
      title: 'Consolante',
      kind: 'silver',
      editable: false,
    }));
  } else if (activeBracketTab === 'silver' && !state.brackets.silver) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '🥈'),
      el('h3', {}, 'Pas de consolante cette fois.'),
      el('p', {}, 'L\'administrateur ne l\'a pas activée.')
    ));
  }
}
