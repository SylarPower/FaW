import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";

const ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode(n = 4) {
  let s = "";
  for (let i = 0; i < n; i++) s += ALPH[(Math.random() * ALPH.length) | 0];
  return s;
}

export function codeFromSeed(seed, n = 6) {
  let h = 2166136261;
  const txt = String(seed || "PONG");
  for (let i = 0; i < txt.length; i++) {
    h ^= txt.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let x = h >>> 0;
  let s = "";
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    s += ALPH[x % ALPH.length];
  }
  return s;
}

function uid() {
  const k = "pong-nl-uid";
  let id = localStorage.getItem(k);
  if (!id) {
    id = "p" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    localStorage.setItem(k, id);
  }
  return id;
}

export const net = {
  ready: false,
  db: null,
  app: null,
  fb: null,
  me: uid(),
  code: null,
  slot: 0,
  host: false,
  mode: "duel",
  unsub: [],
  room: null,
  inputs: {},
  snap: null,
  onRoom: null,
  onSnap: null,
  onGone: null,
  lastInputWrite: 0,
  lastSnapWrite: 0,

  async init() {
    if (!isFirebaseConfigured()) {
      this.ready = false;
      return false;
    }
    if (this.db) {
      this.ready = true;
      return true;
    }
    try {
      const appMod = await import("firebase/app");
      const dbMod = await import("firebase/database");
      this.fb = { ...appMod, ...dbMod };
      this.app = appMod.initializeApp(firebaseConfig);
      this.db = dbMod.getDatabase(this.app);
      this.ready = true;
      return true;
    } catch (e) {
      console.warn("Firebase init failed", e);
      this.ready = false;
      return false;
    }
  },

  configured() {
    return isFirebaseConfigured();
  },

  roomRef(code, path = "") {
    return this.fb.ref(this.db, `rooms/${code}${path ? "/" + path : ""}`);
  },

  async create({ mode, arenaId, nick, seats, codeHint = null, settings = {} }) {
    await this.init();
    if (!this.ready) throw new Error("Firebase non configurato");
    this.leave();
    let code = codeHint ? String(codeHint).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) : makeCode();
    if (code.length < 4) code = codeFromSeed(codeHint || Date.now());
    for (let i = 0; i < 6; i++) {
      const snap = await this.fb.get(this.roomRef(code));
      if (!snap.exists()) break;
      if (codeHint) throw new Error("Stanza già esistente");
      code = makeCode();
    }
    const now = Date.now();
    const room = {
      meta: { mode, arenaId, host: this.me, seats, status: "lobby", created: now, beat: now, settings },
      players: {
        0: { id: this.me, nick: nick || "Blu", slot: 0, cpu: false, in: true }
      },
      inputs: {},
      snap: null
    };
    await this.fb.set(this.roomRef(code), room);
    this.code = code;
    this.slot = 0;
    this.host = true;
    this.mode = mode;
    await this._bind(code);
    return code;
  },

  async join(code, nick) {
    await this.init();
    if (!this.ready) throw new Error("Firebase non configurato");
    code = (code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    if (code.length < 4) throw new Error("Codice non valido");
    this.leave();
    const snap = await this.fb.get(this.roomRef(code));
    if (!snap.exists()) throw new Error("Stanza non trovata");
    const room = snap.val();
    if (room.meta?.status === "over") throw new Error("Partita già finita");
    const seats = room.meta.seats || 2;
    const players = room.players || {};
    let slot = -1;
    for (let i = 0; i < seats; i++) {
      const p = players[i];
      if (!p || p.cpu || !p.in) { slot = i; break; }
    }
    if (slot < 0) throw new Error("Stanza piena");
    const names = ["Blu", "Rosa", "Oro"];
    await this.fb.update(this.roomRef(code), {
      [`players/${slot}`]: { id: this.me, nick: nick || names[slot], slot, cpu: false, in: true }
    });
    this.code = code;
    this.slot = slot;
    this.host = room.meta.host === this.me;
    this.mode = room.meta.mode;
    await this._bind(code);
    return { slot, room };
  },

  async _bind(code) {
    const { onValue, off, onDisconnect } = this.fb;
    const r = this.roomRef(code);
    onValue(r, (s) => {
      this.room = s.val();
      if (!this.room) {
        this.onGone?.("Stanza chiusa");
        return;
      }
      this.inputs = this.room.inputs || {};
      this.onRoom?.(this.room);
    });
    onValue(this.roomRef(code, "snap"), (s) => {
      this.snap = s.val();
      if (this.snap) this.onSnap?.(this.snap);
    });
    this.unsub = [() => off(r), () => off(this.roomRef(code, "snap"))];
    const self = this.roomRef(code, `players/${this.slot}/in`);
    onDisconnect(self).set(false);
    if (this.host) onDisconnect(this.roomRef(code, "meta/status")).set("dead");
  },

  async fillCpu(slot, nick) {
    if (!this.host || !this.code) return;
    await this.fb.update(this.roomRef(this.code), {
      [`players/${slot}`]: { id: "cpu" + slot, nick: nick || "CPU", slot, cpu: true, in: true }
    });
  },

  async start(arenaId) {
    if (!this.host || !this.code) return;
    await this.fb.update(this.roomRef(this.code), {
      "meta/status": "play",
      "meta/arenaId": arenaId,
      "meta/started": Date.now()
    });
  },

  writeInput(inp) {
    if (!this.code || !this.db) return;
    const now = performance.now();
    if (now - this.lastInputWrite < 40) return;
    this.lastInputWrite = now;
    this.fb.set(this.roomRef(this.code, `inputs/${this.slot}`), {
      axis: inp.axis || 0,
      axis2: inp.axis2 || 0,
      curveL: !!inp.curveL,
      curveR: !!inp.curveR,
      power: !!inp.power,
      powerHeld: !!inp.powerHeld,
      switch: !!inp.switch,
      t: Date.now()
    });
  },

  writeSnap(snap) {
    if (!this.host || !this.code) return;
    const now = performance.now();
    if (now - this.lastSnapWrite < 50) return;
    this.lastSnapWrite = now;
    this.fb.set(this.roomRef(this.code, "snap"), snap);
  },

  inputFor(slot) {
    return this.inputs?.[slot] || this.inputs?.[String(slot)] || null;
  },

  playersList() {
    const p = this.room?.players || {};
    return Object.keys(p).map((k) => ({ ...p[k], slot: Number(k) })).sort((a, b) => a.slot - b.slot);
  },

  async leave() {
    for (const u of this.unsub) try { u(); } catch {}
    this.unsub = [];
    if (this.code && this.db && this.fb) {
      try {
        if (this.host) await this.fb.set(this.roomRef(this.code), null);
        else await this.fb.update(this.roomRef(this.code), { [`players/${this.slot}/in`]: false });
      } catch {}
    }
    this.code = null;
    this.host = false;
    this.room = null;
    this.snap = null;
    this.inputs = {};
  }
};

export { isFirebaseConfigured };
