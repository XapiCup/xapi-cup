/* ================================================================
   STATE.JS — Source de vérité unique + persistance localStorage
   + sync multi-onglets/multi-machines via BroadcastChannel + storage event
   ================================================================ */

const STORAGE_KEY = 'xapi-cup-state-v1';
const CHANNEL_NAME = 'xapi-cup-sync';

// État par défaut
const DEFAULT_STATE = {
  version: 1,
  meta: {
    edition: '',          // ex: "Xapi Cup 2026"
    createdAt: null,
    updatedAt: null,
  },
  teams: [],              // [{id, name, color}]
  config: {
    nbPoules: 4,
    qualifiersPerPool: 2, // nombre d'équipes qualifiées par poule
    includeConsolante: true,
  },
  poules: [],             // [[teamId, teamId, ...], ...]
  matches: [],            // matchs de poule : {id, pouleIdx, teamA, teamB, scoreA, scoreB, finished}
  brackets: {
    gold: null,           // arbre Or : {rounds: [[match, ...], ...]}
    silver: null,         // arbre Consolante
  },
  phase: 'setup',         // 'setup' | 'poules' | 'finished-pool' | 'knockout' | 'finished'
};

class Store {
  constructor() {
    this.state = this._load();
    this.listeners = new Set();
    this.channel = null;
    this._initChannel();
    this._initStorageListener();
  }

  // ---------- Persistence ----------
  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(DEFAULT_STATE);
      const parsed = JSON.parse(raw);
      // merge avec defaults pour rétrocompat
      return { ...structuredClone(DEFAULT_STATE), ...parsed };
    } catch (e) {
      console.warn('State load error:', e);
      return structuredClone(DEFAULT_STATE);
    }
  }

  _save() {
    this.state.meta.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    this._broadcast({ type: 'state-update' });
    // Notifier aussi le serveur WebSocket
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
    // WebSocket optionnel : si on est servi par server/sync-server.js
    // (ou qu'un autre serveur tourne sur le même host), on s'y connecte
    // pour synchroniser entre machines.
    if (typeof WebSocket !== 'undefined' && typeof window !== 'undefined') {
      try {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${proto}//${window.location.host}`;
        const ws = new WebSocket(url);
        ws.addEventListener('open', () => {
          this.ws = ws;
        });
        ws.addEventListener('message', (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data?.type === 'state-update' && data.state) {
              // Recharge depuis le payload distant (le serveur relaie)
              this.state = { ...structuredClone(DEFAULT_STATE), ...data.state };
              this._notify();
            }
          } catch (err) { /* ignore */ }
        });
        // Reconnexion auto en cas de perte
        ws.addEventListener('close', () => {
          this.ws = null;
          setTimeout(() => this._initChannel(), 3000);
        });
      } catch (e) { /* ignore si pas de serveur WS */ }
    }
  }

  _initStorageListener() {
    // l'event 'storage' ne se déclenche PAS dans l'onglet qui a écrit,
    // donc on a besoin de BroadcastChannel pour le même onglet aussi.
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
      try { fn(this.state); } catch (e) { console.error(e); }
    });
  }

  // ---------- Mutations ----------
  setState(updater) {
    if (typeof updater === 'function') {
      updater(this.state);
    } else if (updater && typeof updater === 'object') {
      Object.assign(this.state, updater);
    }
    this._save();
    this._notify();
  }

  // ---------- Équipe helpers ----------
  addTeam(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return null;
    if (this.state.teams.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())) {
      return null; // déjà présente
    }
    const team = {
      id: 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: trimmed,
      color: randomTeamColor(),
    };
    this.setState((s) => {
      s.teams.push(team);
      if (!s.meta.createdAt) s.meta.createdAt = new Date().toISOString();
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
    this.setState((s) => {
      s.teams = s.teams.filter((t) => t.id !== teamId);
      s.poules = [];
      s.matches = [];
      s.brackets = { gold: null, silver: null };
      s.phase = 'setup';
    });
  }

  renameTeam(teamId, newName) {
    const trimmed = (newName || '').trim();
    if (!trimmed) return;
    this.setState((s) => {
      const t = s.teams.find((x) => x.id === teamId);
      if (t) t.name = trimmed;
    });
  }

  // ---------- Reset ----------
  resetAll() {
    if (!confirm('Tout effacer ? Cette action est irréversible.')) return;
    this.state = structuredClone(DEFAULT_STATE);
    this._save();
    this._notify();
  }

  // Import / Export
  exportJSON() {
    return JSON.stringify(this.state, null, 2);
  }
  importJSON(json) {
    try {
      const data = JSON.parse(json);
      if (!data || typeof data !== 'object' || !Array.isArray(data.teams)) {
        throw new Error('Format invalide');
      }
      this.state = { ...structuredClone(DEFAULT_STATE), ...data };
      this._save();
      this._notify();
      return true;
    } catch (e) {
      alert('Import impossible : ' + e.message);
      return false;
    }
  }
}

// ---------- Couleurs d'équipes (palette basque + variantes) ----------
const TEAM_PALETTE = [
  '#c1272d', // rouge basque
  '#0f5132', // vert basque
  '#d4a017', // or
  '#1e6091', // bleu profond
  '#7b2d8e', // violet
  '#b85c00', // orange brûlé
  '#2e7d32', // vert feuille
  '#5d4037', // brun
  '#37474f', // ardoise
  '#ad1457', // framboise
  '#00695c', // sarcelle
  '#bf360c', // terre cuite
  '#1565c0', // azur
  '#558b2f', // olive
  '#6a1b9a', // pourpre
  '#00838f', // paon
  '#3e2723', // chocolat
  '#827717', // mousse
];

function randomTeamColor() {
  return TEAM_PALETTE[Math.floor(Math.random() * TEAM_PALETTE.length)];
}

// Singleton
export const store = new Store();
