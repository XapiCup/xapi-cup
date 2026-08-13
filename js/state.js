/* ================================================================
   STATE.JS — Source de vérité + persistance + multi-tournois
   + sync multi-onglets/multi-machines
   ================================================================ */

const STORAGE_KEY = 'xapi-cup-state-v2';
const CHANNEL_NAME = 'xapi-cup-sync';

// ---------- Defaults ----------
const DEFAULT_CONFIG = {
  nbPoules: 4,
  qualifiersPerPool: 2,
  includeConsolante: true,
  // Planning
  nbTerrains: 2,
  matchDurationMin: 20,
  breakBetweenMin: 5,
  lunchBreakMin: 60,
  startTime: '09:00',
  endTime: '18:00',
  splitDays: false,        // étaler sur plusieurs jours
  days: [],                 // [{date, startTime, endTime}] si splitDays
};

const DEFAULT_TOURNAMENT = () => ({
  id: 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
  name: 'Nouveau tournoi',
  date: null,                // date ISO du tournoi (yyyy-mm-dd), utilisé pour détecter les chevauchements
  endDate: null,             // date de fin (optionnel, si tournoi multi-jours)
  location: '',              // lieu du tournoi
  public: true,              // visible côté public (viewer)
  allowParallel: true,       // autoriser le chevauchement avec d'autres tournois (sinon le planning auto decale)
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  teams: [],
  players: [],                // [{id, teamId, number, name}] — v5
  config: { ...DEFAULT_CONFIG },
  poules: [],
  matches: [],                 // matchs de poule
  brackets: { gold: null, silver: null },
  bracketMatches: [],          // tous les matchs bracket (Or + Consolante) — pour l'historique
  schedule: [],                // planning : [{matchId, datetime, terrain, type, ...}]
  history: [],                 // journal : [{at, type, label, data}]
  phase: 'setup',              // 'setup' | 'poules' | 'finished-pool' | 'knockout' | 'finished'
  archived: false,
});

const DEFAULT_STATE = {
  version: 5,
  tournaments: [],
  currentTournamentId: null,
  meta: { updatedAt: null },
};

class Store {
  constructor() {
    this.state = this._load();
    this.listeners = new Set();
    this.channel = null;
    this._initChannel();
    this._initStorageListener();
    // Migration si pas de tournois
    if (!this.state.tournaments?.length) {
      this._migrateV1();
    }
    // Migration v2 -> v3 : champs date / public
    if (this.state.version < 3) {
      this.state.tournaments.forEach((t) => {
        if (t.date === undefined) t.date = null;
        if (t.endDate === undefined) t.endDate = null;
        if (t.location === undefined) t.location = '';
        if (t.public === undefined) t.public = true;
      });
      this.state.version = 3;
      this._save();
    }
    // Migration v3 -> v4 : allowParallel (default true)
    if (this.state.version < 4) {
      this.state.tournaments.forEach((t) => {
        if (t.allowParallel === undefined) t.allowParallel = true;
      });
      this.state.version = 4;
      this._save();
    }
    // Migration v4 -> v5 : joueurs (players par team) + buteurs/MVP (goals/mvp par match)
    if (this.state.version < 5) {
      this.state.tournaments.forEach((t) => {
        if (!t.players) t.players = []; // joueurs indexés par team_id
        (t.teams || []).forEach((tm) => {
          if (tm && !tm.players) tm.players = [];
        });
        (t.matches || []).forEach((m) => {
          if (!m.goals) m.goals = { A: [], B: [] }; // [{playerId, minute?}]
          if (m.mvp === undefined) m.mvp = null;    // playerId ou null
        });
        (t.bracketMatches || []).forEach((m) => {
          if (!m.goals) m.goals = { A: [], B: [] };
          if (m.mvp === undefined) m.mvp = null;
        });
      });
      this.state.version = 5;
      this._save();
    }
  }

  // ---------- Persistence ----------
  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return { ...structuredClone(DEFAULT_STATE), ...parsed };
      }
      // Essayer de migrer depuis l'ancien format
      const old = localStorage.getItem('xapi-cup-state-v1');
      if (old) {
        const parsed = JSON.parse(old);
        return { ...structuredClone(DEFAULT_STATE), tournaments: [this._v1ToTournament(parsed)], currentTournamentId: null, meta: { updatedAt: new Date().toISOString() } };
      }
      return structuredClone(DEFAULT_STATE);
    } catch (e) {
      console.warn('State load error:', e);
      return structuredClone(DEFAULT_STATE);
    }
  }

  _v1ToTournament(v1) {
    // Convertit l'ancien state v1 en un tournoi v2
    return {
      ...DEFAULT_TOURNAMENT(),
      id: 't_migrated_' + Date.now().toString(36),
      name: v1.meta?.edition || 'Tournoi importé',
      teams: v1.teams || [],
      config: { ...DEFAULT_CONFIG, ...(v1.config || {}) },
      poules: v1.poules || [],
      matches: v1.matches || [],
      brackets: v1.brackets || { gold: null, silver: null },
      phase: v1.phase || 'setup',
    };
  }

  _migrateV1() {
    const old = localStorage.getItem('xapi-cup-state-v1');
    if (old) {
      try {
        const parsed = JSON.parse(old);
        const t = this._v1ToTournament(parsed);
        this.state.tournaments = [t];
        this.state.currentTournamentId = t.id;
        this._save();
        console.info('✅ Migration v1 → v2 OK');
        return;
      } catch (e) {
        console.warn('Migration v1 error:', e);
      }
    }
    // Pas d'ancien state : créer un tournoi par défaut
    this.state.tournaments = [DEFAULT_TOURNAMENT()];
    this.state.currentTournamentId = this.state.tournaments[0].id;
    this._save();
  }

  _save() {
    this.state.meta.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    this._broadcast({ type: 'state-update' });
    if (this.ws && this.ws.readyState === 1) {
      try {
        this.ws.send(JSON.stringify({ type: 'state-update', state: this.state }));
      } catch (e) { /* ignore */ }
    }
  }

  // ---------- Multi-tab / multi-device sync ----------
  _initChannel() {
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.onmessage = (e) => {
        if (e.data?.type === 'state-update') {
          this.state = this._load();
          this._notify();
        }
      };
    }
    if (typeof WebSocket !== 'undefined' && typeof window !== 'undefined') {
      try {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${proto}//${window.location.host}`;
        const ws = new WebSocket(url);
        ws.addEventListener('open', () => { this.ws = ws; });
        ws.addEventListener('message', (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data?.type === 'state-update' && data.state) {
              this.state = { ...structuredClone(DEFAULT_STATE), ...data.state };
              this._notify();
            }
          } catch (err) { /* ignore */ }
        });
        ws.addEventListener('close', () => {
          this.ws = null;
          setTimeout(() => this._initChannel(), 3000);
        });
      } catch (e) { /* ignore */ }
    }
  }

  _initStorageListener() {
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY) {
        this.state = this._load();
        this._notify();
      }
    });
  }

  _broadcast(msg) {
    if (this.channel) {
      try { this.channel.postMessage(msg); } catch (e) { /* ignore */ }
    }
  }

  // ---------- Pub/Sub ----------
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  _notify() {
    this.listeners.forEach((fn) => {
      try { fn(this.state, this.currentTournament()); } catch (e) { console.error(e); }
    });
  }

  // ---------- Tournoi helpers ----------
  currentTournament() {
    return this.state.tournaments.find((t) => t.id === this.state.currentTournamentId) || null;
  }

  getTournament(id) {
    return this.state.tournaments.find((t) => t.id === id) || null;
  }

  listTournaments() {
    return this.state.tournaments;
  }

  switchTournament(id) {
    if (!this.getTournament(id)) return;
    this.state.currentTournamentId = id;
    this._save();
    this._notify();
  }

  createTournament(name) {
    const t = { ...DEFAULT_TOURNAMENT(), name: name || 'Nouveau tournoi' };
    this.state.tournaments.push(t);
    this.state.currentTournamentId = t.id;
    this._save();
    this._notify();
    return t;
  }

  renameTournament(id, name) {
    const t = this.getTournament(id);
    if (!t) return;
    t.name = name;
    t.updatedAt = new Date().toISOString();
    this._save();
    this._notify();
  }

  setTournamentDate(id, date, endDate = null, location = null) {
    const t = this.getTournament(id);
    if (!t) return;
    t.date = date || null;
    if (endDate !== null) t.endDate = endDate || null;
    if (location !== null) t.location = location;
    t.updatedAt = new Date().toISOString();
    this._save();
    this._notify();
  }

  setTournamentPublic(id, isPublic) {
    const t = this.getTournament(id);
    if (!t) return;
    t.public = !!isPublic;
    t.updatedAt = new Date().toISOString();
    this._save();
    this._notify();
  }

  setTournamentAllowParallel(id, allow) {
    const t = this.getTournament(id);
    if (!t) return;
    t.allowParallel = !!allow;
    t.updatedAt = new Date().toISOString();
    this._save();
    this._notify();
  }

  /**
   * Liste les tournois publics (visibles côté viewer), triés par date ASC.
   * Si un tournoi n'a pas de date, il apparaît en premier (sans tri).
   */
  listPublicTournaments() {
    return this.state.tournaments
      .filter((t) => t.public !== false)
      .filter((t) => !t.archived)
      .sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return -1;
        if (!b.date) return 1;
        return a.date.localeCompare(b.date);
      });
  }

  /**
   * Détecte les chevauchements entre 2 tournois (mêmes jour ou jours qui se chevauchent).
   * Renvoie un array de paires {a, b, type} où type ∈ 'same-day' | 'overlap'.
   */
  detectOverlaps(tournaments = this.state.tournaments) {
    const overlaps = [];
    for (let i = 0; i < tournaments.length; i++) {
      const a = tournaments[i];
      if (!a.date) continue;
      for (let j = i + 1; j < tournaments.length; j++) {
        const b = tournaments[j];
        if (!b.date) continue;
        const aStart = a.date;
        const aEnd = a.endDate || a.date;
        const bStart = b.date;
        const bEnd = b.endDate || b.date;
        // Chevauchement si [aStart, aEnd] intersecte [bStart, bEnd]
        if (aStart <= bEnd && bStart <= aEnd) {
          overlaps.push({
            a, b,
            type: aStart === bStart || aEnd === bEnd || aStart === bEnd || bStart === aEnd ? 'same-day' : 'overlap',
            range: `du ${aStart}${aEnd !== aStart ? ` au ${aEnd}` : ''} / du ${bStart}${bEnd !== bStart ? ` au ${bEnd}` : ''}`,
          });
        }
      }
    }
    return overlaps;
  }

  archiveTournament(id) {
    const t = this.getTournament(id);
    if (!t) return;
    t.archived = !t.archived;
    this._save();
    this._notify();
  }

  deleteTournament(id) {
    this.state.tournaments = this.state.tournaments.filter((t) => t.id !== id);
    if (this.state.currentTournamentId === id) {
      // Si on a supprimé le tournoi courant, prendre le 1er dispo (ou null si aucun)
      this.state.currentTournamentId = this.state.tournaments[0]?.id || null;
    }
    this._save();
    this._notify();
  }

  duplicateTournament(id) {
    const t = this.getTournament(id);
    if (!t) return null;
    const copy = JSON.parse(JSON.stringify(t));
    copy.id = 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    copy.name = t.name + ' (copie)';
    copy.archived = false;
    copy.createdAt = new Date().toISOString();
    copy.updatedAt = new Date().toISOString();
    // Reset des résultats
    copy.matches = copy.matches.map((m) => ({ ...m, scoreA: null, scoreB: null, finished: false, startedAt: null, finishedAt: null }));
    copy.brackets = { gold: null, silver: null };
    copy.bracketMatches = [];
    copy.schedule = [];
    copy.history = [];
    copy.phase = 'setup';
    this.state.tournaments.push(copy);
    this._save();
    this._notify();
    return copy;
  }

  // ---------- Mutations (toujours sur le tournoi courant) ----------
  setState(updater) {
    if (typeof updater === 'function') {
      updater(this.state);
    }
    this._save();
    this._notify();
  }

  setCurrent(updater) {
    const t = this.currentTournament();
    if (!t) return;
    if (typeof updater === 'function') {
      updater(t);
    }
    t.updatedAt = new Date().toISOString();
    this._save();
    this._notify();
  }

  // ---------- Équipe helpers (tournament scope) ----------
  addTeam(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return null;
    const t = this.currentTournament();
    if (!t) return null;
    if (t.teams.some((x) => x.name.toLowerCase() === trimmed.toLowerCase())) return null;
    const team = {
      id: 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: trimmed,
      color: randomTeamColor(),
    };
    this.setCurrent((s) => {
      s.teams.push(team);
      s.history.push(historyEntry('team-add', `Équipe "${team.name}" ajoutée`, { teamId: team.id }));
    });
    return team;
  }

  addTeamsBulk(names) {
    const added = [];
    names.forEach((n) => {
      const t = this.addTeam(n);
      if (t) added.push(t);
    });
    return added;
  }

  removeTeam(teamId) {
    this.setCurrent((s) => {
      const team = s.teams.find((x) => x.id === teamId);
      s.teams = s.teams.filter((t) => t.id !== teamId);
      s.poules = [];
      s.matches = [];
      s.brackets = { gold: null, silver: null };
      s.bracketMatches = [];
      s.schedule = [];
      s.phase = 'setup';
      if (team) s.history.push(historyEntry('team-remove', `Équipe "${team.name}" retirée`, { teamId }));
    });
  }

  renameTeam(teamId, newName) {
    const trimmed = (newName || '').trim();
    if (!trimmed) return;
    this.setCurrent((s) => {
      const t = s.teams.find((x) => x.id === teamId);
      if (t) t.name = trimmed;
    });
  }

  // ---------- Joueurs / Buteurs / MVP ----------
  // Le joueur est rattache a UNE equipe (teamId). Numero + nom.
  addPlayer(teamId, number, name) {
    const num = parseInt(number, 10);
    const trimmed = (name || '').trim();
    if (!Number.isFinite(num) || num < 1 || num > 99) return null;
    if (!trimmed) return null;
    const t = this.currentTournament();
    if (!t) return null;
    // Verifier que l'equipe existe + que le numero est libre dans cette equipe
    const team = t.teams.find((x) => x.id === teamId);
    if (!team) return null;
    if (!t.players) t.players = [];
    const collision = t.players.find((p) => p.teamId === teamId && p.number === num);
    if (collision) return null;
    const player = {
      id: 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      teamId,
      number: num,
      name: trimmed,
    };
    this.setCurrent((s) => {
      s.players.push(player);
      s.history.push(historyEntry('player-add', `Joueur ${num} ${player.name} ajouté`, { teamId, playerId: player.id }));
    });
    return player;
  }

  removePlayer(playerId) {
    this.setCurrent((s) => {
      const before = s.players.length;
      s.players = s.players.filter((p) => p.id !== playerId);
      if (s.players.length < before) {
        // Nettoyer les goals qui referencaient ce joueur
        (s.matches || []).forEach((m) => {
          m.goals.A = (m.goals.A || []).filter((g) => g.playerId !== playerId);
          m.goals.B = (m.goals.B || []).filter((g) => g.playerId !== playerId);
          if (m.mvp === playerId) m.mvp = null;
        });
        (s.bracketMatches || []).forEach((m) => {
          m.goals.A = (m.goals.A || []).filter((g) => g.playerId !== playerId);
          m.goals.B = (m.goals.B || []).filter((g) => g.playerId !== playerId);
          if (m.mvp === playerId) m.mvp = null;
        });
      }
    });
  }

  renamePlayer(playerId, newName) {
    const trimmed = (newName || '').trim();
    if (!trimmed) return;
    this.setCurrent((s) => {
      const p = s.players.find((x) => x.id === playerId);
      if (p) p.name = trimmed;
    });
  }

  // Buteur d'un match (poule OU bracket) — kind: 'poule' | 'bracket'
  // entry: {slot: 'A'|'B', playerId, minute}
  addGoal(kind, matchId, entry) {
    const slot = entry.slot;
    if (slot !== 'A' && slot !== 'B') return false;
    const t = this.currentTournament();
    if (!t) return false;
    const player = t.players.find((p) => p.id === entry.playerId);
    if (!player) return false;
    this.setCurrent((s) => {
      const arr = (kind === 'poule') ? s.matches : s.bracketMatches;
      const match = arr.find((x) => x.id === matchId);
      if (!match) return;
      if (!match.goals) match.goals = { A: [], B: [] };
      match.goals[slot].push({ playerId: player.id, minute: entry.minute ?? null });
      // Garder le score synchro (utilise par les classements en parallele)
      match[`score${slot}`] = match.goals[slot].length;
      match.finished = (match.scoreA != null && match.scoreB != null);
      if (!s.history) s.history = [];
      s.history.push(historyEntry('goal', `But ${player.name} (${slot})`, { matchId, kind, playerId: player.id, slot }));
    });
    return true;
  }

  removeGoal(kind, matchId, slot, goalIdx) {
    this.setCurrent((s) => {
      const arr = (kind === 'poule') ? s.matches : s.bracketMatches;
      const m = arr.find((x) => x.id === matchId);
      if (!m || !m.goals) return;
      if (!m.goals[slot] || !m.goals[slot][goalIdx]) return;
      m.goals[slot].splice(goalIdx, 1);
      m[`score${slot}`] = m.goals[slot].length;
      s.history.push(historyEntry('goal-remove', `But retiré`, { matchId, kind, slot, idx: goalIdx }));
    });
  }

  setMvp(kind, matchId, playerId) {
    let changed = false;
    this.setCurrent((s) => {
      const arr = (kind === 'poule') ? s.matches : s.bracketMatches;
      const m = arr.find((x) => x.id === matchId);
      if (!m) return;
      m.mvp = playerId || null;
      changed = true;
      const p = playerId ? s.players.find((x) => x.id === playerId) : null;
      s.history.push(historyEntry('mvp', p ? `MVP ${p.name}` : 'MVP retiré', { matchId, kind, playerId: m.mvp }));
    });
    return changed;
  }

  // ---------- Historique ----------
  logHistory(type, label, data = {}) {
    this.setCurrent((s) => {
      s.history.push(historyEntry(type, label, data));
      // garder les 500 derniers
      if (s.history.length > 500) s.history = s.history.slice(-500);
    });
  }

  getHistory() {
    return this.currentTournament()?.history || [];
  }

  // ---------- Reset ----------
  resetCurrent() {
    const t = this.currentTournament();
    if (!t) return;
    if (!confirm('Tout effacer pour ce tournoi ? Cette action est irréversible.')) return;
    const idx = this.state.tournaments.indexOf(t);
    if (idx >= 0) {
      this.state.tournaments[idx] = { ...DEFAULT_TOURNAMENT(), id: t.id, name: t.name, createdAt: t.createdAt };
      this._save();
      this._notify();
    }
  }

  resetAll() {
    if (!confirm('Supprimer TOUS les tournois ? Action irréversible.')) return;
    const t = DEFAULT_TOURNAMENT();
    this.state = { ...structuredClone(DEFAULT_STATE), tournaments: [t], currentTournamentId: t.id };
    this._save();
    this._notify();
  }

  exportJSON() {
    return JSON.stringify(this.state, null, 2);
  }
  importJSON(json) {
    try {
      const data = JSON.parse(json);
      if (!data || typeof data !== 'object') throw new Error('Format invalide');
      this.state = { ...structuredClone(DEFAULT_STATE), ...data };
      if (!this.state.tournaments?.length) throw new Error('Aucun tournoi dans la sauvegarde');
      this._save();
      this._notify();
      return true;
    } catch (e) {
      alert('Import impossible : ' + e.message);
      return false;
    }
  }
}

// ---------- History entry ----------
function historyEntry(type, label, data) {
  return { at: new Date().toISOString(), type, label, data };
}

// ---------- Couleurs d'équipes ----------
const TEAM_PALETTE = [
  '#c1272d', '#0f5132', '#d4a017', '#1e6091', '#7b2d8e', '#b85c00',
  '#2e7d32', '#5d4037', '#37474f', '#ad1457', '#00695c', '#bf360c',
  '#1565c0', '#558b2f', '#6a1b9a', '#00838f', '#3e2723', '#827717',
];

function randomTeamColor() {
  return TEAM_PALETTE[Math.floor(Math.random() * TEAM_PALETTE.length)];
}

export const store = new Store();
export { DEFAULT_TOURNAMENT, DEFAULT_CONFIG };
