/* ================================================================
   PLANNING.JS — Page publique du planning
   Affiche la grille si visible, sinon un message d'attente
   ================================================================ */
import { $, $$, el, clear, onReady } from './app.js';
import { store } from './state.js';

function parseTimeToMin(t) {
  if (!t) return 540;
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function formatMinToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function prettyDayFull(d) {
  const [y, m, day] = d.split('-').map(Number);
  const date = new Date(y, m - 1, day);
  const jours = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const mois = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  return `${jours[date.getDay()]} ${day} ${mois[m - 1]}`;
}

function renderPlanning() {
  const container = $('#planning-public-container');
  if (!container) return;
  clear(container);
  const p = store.state.planning;

  // Meta
  const meta = $('#planning-meta');
  if (meta) {
    if (!p.visible) {
      meta.textContent = 'Le planning n\'est pas encore publié.';
    } else {
      const days = p.config.days || [];
      const slot = (p.config.matchDuration || 20) + (p.config.breakDuration || 0);
      meta.textContent = `${days.length} jour(s) · ${p.config.terrains} terrain(s) · ${p.config.startTime} → ${p.config.endTime || '19:00'} · match ${p.config.matchDuration}min · pause ${p.config.breakDuration}min · créneau ${slot}min`;
    }
  }

  if (!p.visible) {
    container.appendChild(el('div', { class: 'empty-state', style: { padding: '60px 20px' } },
      el('div', { class: 'empty-icon', style: { fontSize: '4rem' } }, '📅'),
      el('h3', {}, 'Planning pas encore publié'),
      el('p', { class: 'muted' }, 'L\'administrateur n\'a pas encore rendu le planning visible.')));
    return;
  }

  const days = p.config.days || [];
  if (!days.length) {
    container.appendChild(el('div', { class: 'empty-state', style: { padding: '60px 20px' } },
      el('div', { class: 'empty-icon', style: { fontSize: '4rem' } }, '⚽'),
      el('h3', {}, 'Aucun jour planifié'),
      el('p', { class: 'muted' }, 'Aucun tournoi n\'a encore été planifié.')));
    return;
  }

  const terrains = p.config.terrains;
  const SLOT = (p.config.matchDuration || 20) + (p.config.breakDuration || 0);

  // Plage horaire : de l'heure de début jusqu'à l'heure de fin configurée
  const cfgStart = parseTimeToMin(p.config.startTime);
  const cfgEnd = parseTimeToMin(p.config.endTime || '19:00');
  const allEnd = p.matches.map((m) => (m.startMin || 0) + m.durationMin).filter((x) => x != null);
  const maxEnd = Math.max(cfgEnd, ...(allEnd.length ? allEnd : [cfgStart + SLOT * 6]));
  const startMin = Math.floor(cfgStart / SLOT) * SLOT;
  const endMin = Math.ceil(maxEnd / SLOT) * SLOT;
  const totalSlots = Math.round((endMin - startMin) / SLOT);

  // Heure de fin globale
  const globalEnd = allEnd.length ? Math.max(...allEnd) : null;

  // Grille publique (jours empilés verticalement, comme l'admin)
  const grid = el('div', { class: 'planning-grid', style: { display: 'flex', flexDirection: 'column', gap: '24px', padding: '12px' } });

  days.forEach((d) => {
    const dayBlock = el('div', { class: 'planning-day-block', style: { border: '1px solid var(--color-border)', borderRadius: '8px', overflow: 'hidden' } });

    // En-tête du jour avec heure de fin
    const dayMatches = p.matches.filter((m) => m.day === d && m.startMin != null);
    const dayEnd = dayMatches.length ? Math.max(...dayMatches.map((m) => m.startMin + m.durationMin)) : null;
    const headerText = dayEnd
      ? `📅 ${prettyDayFull(d)} — ${formatMinToTime(cfgStart)} → ${formatMinToTime(dayEnd)}`
      : `📅 ${prettyDayFull(d)}`;
    dayBlock.appendChild(el('div', { class: 'planning-day-header', style: { background: 'var(--color-primary)', color: 'white', padding: '10px 16px', fontWeight: '700' } },
      el('span', { style: { fontSize: '1.1rem' } }, headerText)));

    // Grille du jour
    const dayGrid = el('div', { class: 'planning-day-grid', style: { display: 'grid', gap: '1px', background: 'var(--color-border)' } });
    dayGrid.style.gridTemplateColumns = `70px repeat(${terrains}, minmax(130px, 1fr))`;
    dayGrid.style.gridAutoRows = '56px';

    // En-têtes (ligne 1)
    const hTime = el('div', { class: 'planning-grid-header', style: { gridColumn: '1', gridRow: '1' } }, 'Heure');
    dayGrid.appendChild(hTime);
    for (let t = 1; t <= terrains; t++) {
      const h = el('div', { class: 'planning-grid-header', style: { gridColumn: `${t + 1}`, gridRow: '1' } },
        el('div', {}, `Terrain ${t}`));
      dayGrid.appendChild(h);
    }

    // Indexer les matchs et pauses placés
    const placedHere = new Map();
    p.matches.forEach((m) => {
      if (m.day !== d || m.terrain == null || m.startMin == null) return;
      const slotIdx = Math.round((m.startMin - startMin) / SLOT);
      const slotCount = Math.max(1, Math.round(m.durationMin / SLOT));
      for (let r = 0; r < slotCount; r++) {
        placedHere.set(`${m.terrain}|${slotIdx + r}`, { type: 'match', data: m, isStart: r === 0, slotCount });
      }
    });
    (p.breaks || []).forEach((b) => {
      if (b.day !== d || b.terrain == null || b.startMin == null) return;
      const slotIdx = Math.round((b.startMin - startMin) / SLOT);
      const slotCount = Math.max(1, Math.round(b.durationMin / SLOT));
      for (let r = 0; r < slotCount; r++) {
        placedHere.set(`${b.terrain}|${slotIdx + r}`, { type: 'break', data: b, isStart: r === 0, slotCount });
      }
    });

    // Cellules
    for (let slot = 0; slot < totalSlots; slot++) {
      const mins = startMin + (slot * SLOT);
      const rowIdx = slot + 2;

      // Colonne heure
      const timeCell = el('div', { class: 'planning-grid-time', style: { gridColumn: '1', gridRow: `${rowIdx}` } }, formatMinToTime(mins));
      dayGrid.appendChild(timeCell);

      // Cellules par terrain
      for (let t = 1; t <= terrains; t++) {
        const key = `${t}|${slot}`;
        const placed = placedHere.get(key);
        const colIdx = t + 1;

        if (placed && placed.isStart && placed.type === 'match') {
          const cell = el('div', { class: 'planning-grid-cell has-match', style: { gridColumn: `${colIdx}`, gridRow: `${rowIdx} / span ${placed.slotCount}`, position: 'relative', overflow: 'visible', background: 'transparent', padding: '0' } });
          const matchEl = el('div', {
            class: 'planning-match' + (placed.data.kind === 'bracket-placeholder' ? ' bracket-placeholder' : ''),
            style: { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '4px 8px', overflow: 'visible' },
          },
            el('span', { class: 'match-time', style: { fontWeight: '700' } }, formatMinToTime(placed.data.startMin)),
            el('span', { class: 'match-label', style: { fontSize: '0.7rem', whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: '1.1' } }, placed.data.label),
          );
          cell.appendChild(matchEl);
          dayGrid.appendChild(cell);
        } else if (placed && placed.isStart && placed.type === 'break') {
          const cell = el('div', { class: 'planning-grid-cell has-break', style: { gridColumn: `${colIdx}`, gridRow: `${rowIdx} / span ${placed.slotCount}`, position: 'relative', overflow: 'visible', background: 'transparent', padding: '0' } });
          const breakEl = el('div', { class: 'planning-break', style: { position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', padding: '4px 8px' } },
            '🍽️ Pause déj', el('span', { class: 'muted', style: { fontSize: '0.7rem', marginLeft: 'auto' } }, formatMinToTime(placed.data.startMin)));
          cell.appendChild(breakEl);
          dayGrid.appendChild(cell);
        } else if (placed && !placed.isStart) {
          dayGrid.appendChild(el('div', { class: 'planning-grid-cell', style: { gridColumn: `${colIdx}`, gridRow: `${rowIdx}`, visibility: 'hidden' } }));
        } else {
          dayGrid.appendChild(el('div', { class: 'planning-grid-cell', style: { gridColumn: `${colIdx}`, gridRow: `${rowIdx}` } }));
        }
      }
    }

    dayBlock.appendChild(dayGrid);
    grid.appendChild(dayBlock);
  });

  // Heure de fin globale
  if (globalEnd != null) {
    grid.appendChild(el('div', { style: { textAlign: 'center', padding: '12px', fontWeight: '700', color: 'var(--color-primary)' } },
      `🏆 Fin des tournois : ${formatMinToTime(globalEnd)}`));
  }

  container.appendChild(grid);
}

onReady(() => {
  renderPlanning();
  store.subscribe(() => renderPlanning());
});