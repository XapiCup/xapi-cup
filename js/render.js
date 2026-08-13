/* ================================================================
   RENDER.JS — Génération du DOM pour poules, classements, arbres
   ================================================================ */

import { el, teamById, teamLabel, teamColor } from './app.js';
import { computeStandings, getRoundLabel } from './tournament.js';

// ============================================================
// POULE
// ============================================================
export function renderPoule(pouleIdx, teams, matches, qualifiersPerPool = 2, editable = false, onMatchChange = null, onGoalsClick = null) {
  const standings = computeStandings(teams, matches);
  const wrapper = el('div', { class: 'poule' });

  wrapper.appendChild(el('h3', {},
    `Poule ${String.fromCharCode(65 + pouleIdx)}`,
    el('span', { class: 'poule-size' }, `${teams.length} équipes`)
  ));

  // ----- Classement -----
  const table = el('table', { class: 'standings-table' });
  table.appendChild(el('thead', {},
    el('tr', {},
      el('th', {}, '#'),
      el('th', { style: { textAlign: 'left' } }, 'Équipe'),
      el('th', {}, 'J'),
      el('th', {}, 'G'),
      el('th', {}, 'N'),
      el('th', {}, 'P'),
      el('th', {}, 'BP'),
      el('th', {}, 'BC'),
      el('th', {}, 'Diff'),
      el('th', {}, 'Pts'),
    )
  ));
  const tbody = el('tbody');
  standings.forEach((s, idx) => {
    const isQualifie = idx < qualifiersPerPool;
    const tr = el('tr', {
      class: isQualifie ? 'qualifie' : (idx === 0 ? 'rank-1' : ''),
    });
    tr.appendChild(el('td', { class: 'rank-cell' }, String(idx + 1)));
    tr.appendChild(el('td', { class: 'team-cell' },
      el('span', {
        class: 'team-color',
        style: { background: s.team.color },
      }),
      s.team.name
    ));
    tr.appendChild(el('td', {}, String(s.played)));
    tr.appendChild(el('td', {}, String(s.wins)));
    tr.appendChild(el('td', {}, String(s.draws)));
    tr.appendChild(el('td', {}, String(s.losses)));
    tr.appendChild(el('td', {}, String(s.gf)));
    tr.appendChild(el('td', {}, String(s.ga)));
    tr.appendChild(el('td', {}, (s.gd > 0 ? '+' : '') + s.gd));
    tr.appendChild(el('td', { style: { fontWeight: 700, color: 'var(--color-primary)' } }, String(s.points)));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrapper.appendChild(table);

  // ----- Matchs -----
  if (matches.length) {
    const matchList = el('ul', { class: 'match-list' });
    matches.forEach((m) => {
      const tA = teamById({ teams }, m.teamA);
      const tB = teamById({ teams }, m.teamB);
      const finished = m.finished;
      const matchDiv = el('li', { class: 'match' + (finished ? ' finished' : '') });
      matchDiv.appendChild(el('div', { class: 'team-cell', style: { textAlign: 'right' } },
        el('span', { class: 'team-color', style: { background: tA?.color || '#999' } }),
        tA?.name || '—'
      ));
      const scoreCell = el('div', { class: 'match-score' });
      if (editable) {
        const inA = el('input', {
          type: 'number', min: '0', value: m.scoreA ?? '',
          class: 'input-sm',
          'data-match-id': m.id,
          'data-team': 'A',
        });
        const inB = el('input', {
          type: 'number', min: '0', value: m.scoreB ?? '',
          class: 'input-sm',
          'data-match-id': m.id,
          'data-team': 'B',
        });
        const handler = (e) => onMatchChange?.(m.id, e.target.dataset.team, e.target.value);
        inA.addEventListener('change', handler);
        inB.addEventListener('change', handler);
        scoreCell.appendChild(inA);
        scoreCell.appendChild(el('span', { class: 'match-vs' }, '—'));
        scoreCell.appendChild(inB);
        // Bouton buteurs/MVP — optionnel
        if (onGoalsClick) {
          const goalsBtn = el('button', { class: 'match-goals-btn',
            title: 'Saisir les buteurs et le MVP (optionnel)',
            onclick: () => onGoalsClick(m.id, 'poule'),
          }, '⚽ Buteurs');
          scoreCell.appendChild(goalsBtn);
        }
      } else {
        scoreCell.appendChild(el('span', {}, m.scoreA ?? '-'));
        scoreCell.appendChild(el('span', { class: 'match-vs' }, '—'));
        scoreCell.appendChild(el('span', {}, m.scoreB ?? '-'));
      }
      matchDiv.appendChild(scoreCell);
      matchDiv.appendChild(el('div', { class: 'team-cell' },
        el('span', { class: 'team-color', style: { background: tB?.color || '#999' } }),
        tB?.name || '—'
      ));
      matchList.appendChild(matchDiv);
    });
    wrapper.appendChild(matchList);
  }
  return wrapper;
}

// ============================================================
// ARBRE (bracket)
// ============================================================
export function renderBracket(bracket, state, opts = {}) {
  const { kind = 'gold', editable = false, onMatchClick = null, onClick = null, onWinnerSet = null } = opts;
  // Compatibilite ascendante : on accepte 'onClick' comme alias de 'onMatchClick'
  const _onMatchClick = onMatchClick || onClick;
  if (!bracket) return null;

  const wrapper = el('div', { class: 'bracket-wrapper' });

  // Titre + actions (utilise bracket.title si défini)
  const titleRow = el('div', { class: 'bracket-title' });
  const medalEmoji = kind === 'gold' ? '🥇' : '🥈';
  titleRow.appendChild(el('h2', {},
    el('span', { class: `medal ${kind === 'gold' ? 'gold' : 'silver'}` }, medalEmoji),
    bracket.title || (kind === 'gold' ? 'Tableau Or' : 'Tableau Consolante')
  ));
  const actions = el('div', { class: 'bracket-actions' });
  // Bouton renommer l'arbre (admin only)
  if (opts.editable && opts.onRenameBracket) {
    const renameBtn = el('button', {
      class: 'btn-icon',
      title: 'Renommer l\'arbre',
      onclick: (e) => { e.stopPropagation(); opts.onRenameBracket(bracket); }
    }, '✏️');
    actions.appendChild(renameBtn);
  }
  if (opts.actions) {
    opts.actions.forEach((a) => actions.appendChild(a));
  }
  titleRow.appendChild(actions);
  wrapper.appendChild(titleRow);

  const tree = el('div', { class: 'bracket' });
  const totalRounds = bracket.rounds.length;
  bracket.rounds.forEach((round, rIdx) => {
    const isFinal = rIdx === totalRounds - 1;
    const roundDiv = el('div', { class: 'bracket-round' + (isFinal ? ' bracket-round--final' : '') });
    const titleClass = isFinal ? 'bracket-round-title bracket-round-title--final' : 'bracket-round-title';
    roundDiv.appendChild(el('div', { class: titleClass }, getRoundLabel(rIdx, totalRounds)));
    round.forEach((match, mIdx) => {
      const matchClass = isFinal ? ' bracket-match--is-final' : '';
      roundDiv.appendChild(renderBracketMatch(match, state, rIdx, mIdx, editable, _onMatchClick, onWinnerSet, matchClass));
    });
    tree.appendChild(roundDiv);
  });

  // Petite finale (3e place) — affichée en bas, plus discrète que la finale.
  // Note : la finale reste le match le plus important visuellement (taille + or).
  if (bracket.thirdPlaceMatch) {
    const thirdRound = el('div', { class: 'bracket-round bracket-third' });
    thirdRound.appendChild(el('div', { class: 'bracket-round-title bracket-round-title--minor' }, '3e place'));
    const m = bracket.thirdPlaceMatch;
    const wrap = el('div', {
      class: 'bracket-match bracket-match--third'
        + (m.scoreA != null && m.scoreB != null ? ' has-score' : '')
        + (m.winnerSlot != null ? ' winner-decided' : '')
        + (m.slotA == null || m.slotB == null ? ' not-ready' : ''),
      dataset: { kind: 'third-place' },
    });
    if (editable && _onMatchClick && m.slotA != null && m.slotB != null) {
      wrap.style.cursor = 'pointer';
      wrap.addEventListener('click', () => {
        // Le onMatchClick reçoit un objet match spécial pour la 3e place
        _onMatchClick({ ...m, isThirdPlace: true, parentBracket: bracket }, -1, -1);
      });
    }
    const tA = m.slotA ? teamById(state, m.slotA) : null;
    const tB = m.slotB ? teamById(state, m.slotB) : null;
    const aW = m.winnerSlot === 'A';
    const bW = m.winnerSlot === 'B';
    wrap.appendChild(renderBracketTeam(tA, m.scoreA, aW, m.winnerSlot && !aW));
    wrap.appendChild(renderBracketTeam(tB, m.scoreB, bW, m.winnerSlot && !bW));
    thirdRound.appendChild(wrap);
    tree.appendChild(thirdRound);
  }

  wrapper.appendChild(tree);

  if (editable) {
    wrapper.appendChild(el('p', { class: 'bracket-edit-hint' },
      '💡 Cliquez sur un match pour saisir le score et désigner le vainqueur.'));
  }
  return wrapper;
}

function renderBracketMatch(match, state, rIdx, mIdx, editable, onClick, onWinnerSet, extraClass = '') {
  const tA = match.slotA ? teamById(state, match.slotA) : null;
  const tB = match.slotB ? teamById(state, match.slotB) : null;

  const hasScore = match.scoreA != null && match.scoreB != null;
  const decided = match.winnerSlot != null;

  const wrap = el('div', {
    class: 'bracket-match' + extraClass
      + (hasScore ? ' has-score' : '')
      + (decided ? ' winner-decided' : ''),
    dataset: { round: rIdx, match: mIdx, kind: 'bracket-match' },
  });
  if (editable && onClick) {
    wrap.style.cursor = 'pointer';
    wrap.addEventListener('click', (e) => {
      // Empêcher le déclenchement si on clique sur un input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
      onClick(match, rIdx, mIdx);
    });
  }

  // Slot A
  const aWinner = match.winnerSlot === 'A';
  const bWinner = match.winnerSlot === 'B';
  const aLoser = decided && !aWinner && match.slotA;
  const bLoser = decided && !bWinner && match.slotB;

  wrap.appendChild(renderBracketTeam(tA, match.scoreA, aWinner, aLoser));
  wrap.appendChild(renderBracketTeam(tB, match.scoreB, bWinner, bLoser));

  if (match.bye) {
    wrap.appendChild(el('div', {
      style: {
        fontSize: '0.7rem', textAlign: 'center',
        color: 'var(--color-muted)', padding: '2px',
        borderTop: '1px dashed var(--color-border)'
      }
    }, 'Exempt'));
  }
  return wrap;
}

function renderBracketTeam(team, score, isWinner, isLoser) {
  const div = el('div', { class: 'bracket-team' });
  if (isWinner) div.classList.add('winner');
  if (isLoser) div.classList.add('loser');
  if (!team) div.classList.add('tbd');

  if (team) {
    div.appendChild(el('span', {
      class: 'team-color',
      style: { background: team.color }
    }));
    div.appendChild(el('span', { class: 'team-name' }, team.name));
  } else {
    div.appendChild(el('span', { class: 'team-name' }, 'À déterminer'));
  }
  div.appendChild(el('span', { class: 'team-score' }, score != null ? String(score) : '—'));
  return div;
}
