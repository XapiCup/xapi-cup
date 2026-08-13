/* ================================================================
   PLANNING.JS — Page publique du planning
   Affiche la grille si visible, sinon un message d'attente
   ================================================================ */
import { $, $$, el, clear, onReady } from './app.js';
import { store } from './state.js';

const STEP = 10; // granularite 10 min (meme que admin)

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

function prettyDay(d) {
  const [y, m, day] = d.split('-').map(Number);
  const date = new Date(y, m - 1, day);
  const jours = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  return `${jours[date.getDay()]} ${day}/${m}/${y}`;
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
      meta.textContent = `${days.length} jour(s) · ${p.config.terrains} terrain(s) · début ${p.config.startTime} · match ${p.config.matchDuration}min · pause ${p.config.breakDuration}min`;
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
  const allStart = p.matches.map((m) => m.startMin).filter((x) => x != null);
  const allEnd = p.matches.map((m) => (m.startMin || 0) + m.durationMin);
  const minStart = allStart.length ? Math.min(...allStart) : parseTimeToMin(p.config.startTime);
  const maxEnd = allStart.length ? Math.max(...allEnd) : minStart + 240;
  const startHour = Math.floor(minStart / 60);
  const endHour = Math.ceil(maxEnd / 60) + 1;

  const grid = el('div', { class: 'planning-grid', style: { gridTemplateColumns: `60px repeat(${terrains * days.length}, 1fr)` } });

  // Header row
  grid.appendChild(el('div', { class: 'planning-grid-header' }, 'Heure'));
  days.forEach((d) => {
    for (let t = 1; t <= terrains; t++) {
      grid.appendChild(el('div', { class: 'planning-grid-header' },
        el('div', {}, prettyDay(d)),
        el('div', { class: 'muted', style: { fontSize: '0.7rem' } }, `Terrain ${t}`)));
    }
  });

  // Time slots
  for (let hour = startHour; hour <= endHour; hour++) {
    const mins = hour * 60;
    grid.appendChild(el('div', { class: 'planning-grid-time' }, formatMinToTime(mins)));
    days.forEach((d) => {
      for (let t = 1; t <= terrains; t++) {
        grid.appendChild(el('div', { class: 'planning-grid-cell' }));
      }
    });
  }

  // Matchs
  p.matches.forEach((m) => {
    if (m.day == null || m.terrain == null || m.startMin == null) return;
    const terrainIdx = m.terrain - 1;
    const dayIdx = days.indexOf(m.day);
    if (terrainIdx < 0 || dayIdx < 0) return;
    const col = 1 + (dayIdx * terrains) + terrainIdx;
    const startHourOffset = m.startMin - startHour * 60;
    const rowSpan = Math.ceil(m.durationMin / STEP);
    const matchEl = el('div', {
      class: 'planning-match' + (m.kind === 'bracket-placeholder' ? ' bracket-placeholder' : ''),
    },
      el('span', { class: 'match-time' }, formatMinToTime(m.startMin)),
      el('span', { class: 'match-label', title: m.label }, m.label),
    );
    matchEl.style.gridColumn = `${col + 1} / span 1`;
    matchEl.style.gridRow = `${startHourOffset / STEP + 2} / span ${rowSpan}`;
    grid.appendChild(matchEl);
  });

  // Pauses
  (p.breaks || []).forEach((b) => {
    const terrainIdx = b.terrain - 1;
    const dayIdx = days.indexOf(b.day);
    if (terrainIdx < 0 || dayIdx < 0) return;
    const col = 1 + (dayIdx * terrains) + terrainIdx;
    const startHourOffset = b.startMin - startHour * 60;
    const rowSpan = Math.ceil(b.durationMin / STEP);
    const breakEl = el('div', { class: 'planning-break' },
      '🍽️ Pause', el('span', { class: 'muted', style: { fontSize: '0.7rem', marginLeft: 'auto' } }, formatMinToTime(b.startMin)));
    breakEl.style.gridColumn = `${col + 1} / span 1`;
    breakEl.style.gridRow = `${startHourOffset / STEP + 2} / span ${rowSpan}`;
    grid.appendChild(breakEl);
  });

  container.appendChild(grid);
}

onReady(() => {
  renderPlanning();
  store.subscribe(() => renderPlanning());
});
