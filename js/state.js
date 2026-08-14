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
  version: 6,
  tournaments: [],
  currentTournamentId: null,
  meta: { updatedAt: null },
  planning: {
    visible: false,
    config: { terrains: 2, startTime: '09:00', matchDuration: 20, breakDuration: 5, days: [] },
    matches: [],
    breaks: [],
  },
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
    // Migration v5 -> v6 : planning global multi-tournois
    if (this.state.version < 6) {
      if (!this.state.planning) {
        this.state.planning = {
          visible: false,
          config: {
            terrains: 2,
            startTime: '09:00',
            matchDuration: 20,
            breakDuration: 5,
            days: [],
          },
          matches: [],
          breaks: [],
        };
      }
      this.state.version = 6;
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

  // ========== PLANNING GLOBAL ==========
  setPlanningConfig(cfg) {
    this.state.planning.config = { ...this.state.planning.config, ...cfg };
    this._save(); this._notify();
  }

  setPlanningVisible(visible) {
    this.state.planning.visible = !!visible;
    this._save(); this._notify();
  }

  resetPlanning() {
    this.state.planning.matches = [];
    this.state.planning.breaks = [];
    this._save(); this._notify();
  }

  addPlanningItems(items) {
    const created = [];
    const p = this.state.planning;
    items.forEach((it) => {
      const item = { id: 'pi_' + Math.random().toString(36).slice(2, 10), ...it };
      p.matches.push(item);
      created.push(item.id);
    });
    this._save(); this._notify();
    return created;
  }

  movePlanningItem(itemId, target) {
    const p = this.state.planning;
    const item = p.matches.find((m) => m.id === itemId);
    if (!item) return null;
    // Libérer l'ancienne position avant de vérifier les collisions
    const oldDay = item.day, oldTerrain = item.terrain, oldStart = item.startMin;
    // Exclure l'item déplacé de la détection de collision
    const others = p.matches.filter((m) => m.id !== itemId);
    const conflict = others.find((m) => {
      if (m.day !== target.day || m.terrain !== target.terrain) return false;
      if (m.startMin == null) return false;
      const aStart = m.startMin, aEnd = m.startMin + m.durationMin;
      const bStart = target.startMin, bEnd = target.startMin + (target.durationMin || item.durationMin);
      return aStart < bEnd && bStart < aEnd;
    });
    if (conflict) return conflict;
    // Appliquer le déplacement
    item.day = target.day;
    item.terrain = target.terrain;
    item.startMin = target.startMin;
    item.durationMin = target.durationMin || item.durationMin;
    this._save(); this._notify();
    return null;
  }

  unplacePlanningItem(itemId) {
    const p = this.state.planning;
    const item = p.matches.find((m) => m.id === itemId);
    if (!item) return;
    item.day = null;
    item.terrain = null;
    item.startMin = null;
    this._save(); this._notify();
  }

  removePlanningItem(itemId) {
    const p = this.state.planning;
    p.matches = p.matches.filter((m) => m.id !== itemId);
    p.breaks = p.breaks.filter((b) => b.id !== itemId);
    this._save(); this._notify();
  }

  addPlanningBreak(breakItem) {
    this.state.planning.breaks.push({
      id: 'br_' + Math.random().toString(36).slice(2, 10),
      kind: 'lunch',
      ...breakItem,
    });
    this._save(); this._notify();
  }

  generatePlanning(tournamentIds, config) {
    this.setPlanningConfig(config);
    const cfg = this.state.planning.config;
    const tournaments = this.state.tournaments.filter((t) => tournamentIds.includes(t.id) && !t.archived);
    if (!tournaments.length) return { added: 0, days: [] };

    const daysSet = new Set();
    tournaments.forEach((t) => {
      if (t.date) daysSet.add(t.date);
      if (t.endDate && t.endDate !== t.date) {
        const d = new Date(t.date);
        const end = new Date(t.endDate);
        for (let cur = new Date(d); cur <= end; cur.setDate(cur.getDate() + 1)) {
          daysSet.add(cur.toISOString().slice(0, 10));
        }
      }
    });
    const days = Array.from(daysSet).sort();
    this.setPlanningConfig({ days });

    // Construire les listes de matchs par tournoi, en séparant poules et phases finales
    // Les phases finales doivent commencer APRES que toutes les poules soient terminées
    const allItems = [];
    
    // Étape 1: collecter les matchs de poule par tournoi
    const pouleMatches = []; // {tournamentId, matchRef, label}
    const finaleMatches = []; // {tournamentId, matchRef, kind, label}
    
    tournaments.forEach((t) => {
      // Inclure les matchs de poule si les poules ont été générées
      if ((t.phase === 'poules' || t.phase === 'knockout' || t.phase === 'finished-pool' || (t.phase === 'setup' && (t.matches || []).length > 0))) {
        (t.matches || []).forEach((m) => {
          pouleMatches.push({
            tournamentId: t.id,
            matchRef: m,
            label: labelForPouleMatch(t, m),
          });
        });
      }
      if (t.phase === 'knockout' && t.brackets?.gold) {
        const gold = t.brackets.gold;
        const rounds = gold.rounds || [];
        const totalRounds = rounds.length;
        rounds.forEach((round, rIdx) => {
          const fromEnd = totalRounds - rIdx;
          const roundLabel = (fromEnd === 4) ? '8e de finale'
                           : (fromEnd === 3) ? 'Quart de finale'
                           : (fromEnd === 2) ? 'Demi-finale'
                           : 'Finale';
          round.forEach((m) => {
            finaleMatches.push({
              tournamentId: t.id,
              matchRef: m,
              kind: 'bracket-placeholder',
              label: labelForBracketMatch(t, m, roundLabel),
              roundOrder: rIdx,
            });
          });
        });
        if (t.brackets.silver) {
          const silver = t.brackets.silver;
          const rounds = silver.rounds || [];
          const totalRounds = rounds.length;
          rounds.forEach((round, rIdx) => {
            const fromEnd = totalRounds - rIdx;
            const roundLabel = (fromEnd === 2) ? 'Demi-finale Consolante'
                             : 'Finale Consolante';
            round.forEach((m) => {
              finaleMatches.push({
                tournamentId: t.id,
                matchRef: m,
                kind: 'bracket-placeholder',
                label: labelForBracketMatch(t, m, roundLabel),
                roundOrder: rIdx + 100,
              });
            });
          });
          if (t.brackets.thirdPlace) {
            finaleMatches.push({
              tournamentId: t.id,
              matchRef: t.brackets.thirdPlace,
              kind: 'bracket-placeholder',
              label: labelForBracketMatch(t, t.brackets.thirdPlace, 'Petite finale'),
              roundOrder: 200,
            });
          }
        }
      }
    });

    // Étape 2: placement sur la grille
    // Utiliser un système de "slots" par jour et par terrain
    // Pour chaque jour, on maintient l'heure de fin d'utilisation de chaque terrain
    const dayTerrainEnd = new Map(); // key: "day|terrain" -> endMin
    days.forEach((d) => {
      for (let t = 1; t <= cfg.terrains; t++) {
        dayTerrainEnd.set(`${d}|${t}`, parseTimeToMin(cfg.startTime));
      }
    });

    // Trouve le terrain le plus tôt disponible pour un jour donné
    function findEarliestTerrain(day) {
      let bestT = 1, bestMin = Infinity;
      for (let t = 1; t <= cfg.terrains; t++) {
        const end = dayTerrainEnd.get(`${day}|${t}`) ?? parseTimeToMin(cfg.startTime);
        if (end < bestMin) { bestMin = end; bestT = t; }
      }
      return { terrain: bestT, startMin: bestMin };
    }

    // Vérifie si un jour est "plein" (tous les terrains ont dépassé l'heure de fin configurée)
    const SLOT = cfg.matchDuration + cfg.breakDuration;
    const MAX_HOUR = parseTimeToMin(cfg.endTime || '19:00');
    function checkDayFull(day, nbTerrains, map, slotDur) {
      let allLate = true;
      for (let t = 1; t <= nbTerrains; t++) {
        const end = map.get(`${day}|${t}`) ?? parseTimeToMin(cfg.startTime);
        if (end + slotDur <= MAX_HOUR) { allLate = false; break; }
      }
      return allLate;
    }

    // Placement des matchs de poule: on alterne entre les tournois pour l'équité
    // On groupe les matchs par tournoi, puis on prend un match de chaque tournoi à tour de rôle
    const pouleByTournament = new Map();
    pouleMatches.forEach((pm) => {
      if (!pouleByTournament.has(pm.tournamentId)) pouleByTournament.set(pm.tournamentId, []);
      pouleByTournament.get(pm.tournamentId).push(pm);
    });

    // Round-robin: prendre un match de chaque tournoi à tour de rôle
    // Priorité au premier jour: on remplit le jour 1 avant de passer au jour 2
    let placed = true;
    let dayIdx = 0;
    while (placed) {
      placed = false;
      for (const [tid, list] of pouleByTournament) {
        if (!list.length) continue;
        const pm = list.shift();
        // Priorité au premier jour: si le premier jour a encore de la place, on l'utilise
        // On ne passe au jour suivant que si le jour actuel est "plein" (tous terrains occupés)
        let day = days[dayIdx];
        // Vérifier si le jour actuel est plein (tous terrains à la même heure max)
        const dayFull = checkDayFull(day, cfg.terrains, dayTerrainEnd, SLOT);
        if (dayFull && dayIdx < days.length - 1) {
          dayIdx++;
          day = days[dayIdx];
        }
        const slot = findEarliestTerrain(day);
        allItems.push({
          ...pm,
          sourceId: pm.matchRef.id,
          tournamentId: pm.tournamentId,
          kind: 'poule',
          label: pm.label,
          day,
          terrain: slot.terrain,
          startMin: slot.startMin,
          durationMin: cfg.matchDuration,
        });
        const newEnd = slot.startMin + cfg.matchDuration + cfg.breakDuration;
        dayTerrainEnd.set(`${day}|${slot.terrain}`, newEnd);
        placed = true;
      }
    }

    // Placement des phases finales: APRES toutes les poules
    // Trouver l'heure de fin maximum des poules pour chaque jour
    if (finaleMatches.length) {
      // Trier par roundOrder (8e avant quarts avant demis avant finale)
      finaleMatches.sort((a, b) => (a.roundOrder || 0) - (b.roundOrder || 0));
      
      finaleMatches.forEach((fm) => {
        const day = days.length === 1 ? days[0] : days[days.length - 1];
        const slot = findEarliestTerrain(day);
        allItems.push({
          sourceId: fm.matchRef.id,
          tournamentId: fm.tournamentId,
          kind: fm.kind,
          label: fm.label,
          day,
          terrain: slot.terrain,
          startMin: slot.startMin,
          durationMin: cfg.matchDuration,
        });
        const newEnd = slot.startMin + cfg.matchDuration + cfg.breakDuration;
        dayTerrainEnd.set(`${day}|${slot.terrain}`, newEnd);
      });
    }

    this.resetPlanning();
    this.addPlanningItems(allItems);

    if (config.lunchBreak && config.lunchBreak.startTime) {
      const lunchStart = parseTimeToMin(config.lunchBreak.startTime);
      const lunchDur = config.lunchBreak.durationMin || 60;
      this.state.planning.matches
        .filter((m) => m.startMin >= lunchStart)
        .forEach((m) => { m.startMin += lunchDur; });
      this._save(); this._notify();
      // Pause déjeuner sur TOUS les terrains, pas juste le terrain 1
      days.forEach((d) => {
        for (let t = 1; t <= cfg.terrains; t++) {
          this.addPlanningBreak({
            day: d, terrain: t, startMin: lunchStart, durationMin: lunchDur, kind: 'lunch',
          });
        }
      });
    }

    return { added: allItems.length, days };
  }
}

function parseTimeToMin(t) {
  if (!t) return 540;
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function labelForPouleMatch(t, m) {
  const tA = t.teams.find((x) => x.id === m.teamA);
  const tB = t.teams.find((x) => x.id === m.teamB);
  const pouleLabel = String.fromCharCode(65 + (m.pouleIdx || 0));
  return `${t.name} - Poule ${pouleLabel}: ${tA?.name || '?'} vs ${tB?.name || '?'}`;
}

function labelForBracketMatch(t, matchRef, roundLabel) {
  // Si le match a des équipes définies (slotA/slotB), afficher les noms
  const tA = matchRef.slotA ? t.teams.find((x) => x.id === matchRef.slotA) : null;
  const tB = matchRef.slotB ? t.teams.find((x) => x.id === matchRef.slotB) : null;
  const nameA = tA?.name || null;
  const nameB = tB?.name || null;

  if (matchRef.finished && matchRef.winnerSlot) {
    // Match terminé : afficher le résultat
    const winner = matchRef.winnerSlot === 'A' ? nameA : nameB;
    const loser = matchRef.winnerSlot === 'A' ? nameB : nameA;
    const scoreA = matchRef.scoreA ?? 0;
    const scoreB = matchRef.scoreB ?? 0;
    return `${roundLabel} - ${t.name}: ${winner} ${scoreA}-${scoreB} ${loser} ✓`;
  } else if (nameA && nameB) {
    // Match à venir avec équipes connues
    return `${roundLabel} - ${t.name}: ${nameA} vs ${nameB}`;
  } else if (nameA && !nameB) {
    return `${roundLabel} - ${t.name}: ${nameA} vs (à déterminer)`;
  } else if (!nameA && nameB) {
    return `${roundLabel} - ${t.name}: (à déterminer) vs ${nameB}`;
  } else {
    // Équipes pas encore déterminées
    return `${roundLabel} - ${t.name} (qualifiés à déterminer)`;
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
