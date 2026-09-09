/* =========================================================
   PATATA BOLLENTE — Focus at Work
   Il gioco delle parole a staffetta.

   Regole:
   - Ogni turno (round) estrae N lettere casuali (sempre "risolvibili":
     il dizionario deve contenere abbastanza parole che le includono).
   - Chi sta giocando deve scrivere una parola (min 4 lettere, presente
     nel dizionario Ruzzle) che CONTENGA tutte le lettere richieste.
   - Parola corretta  → +5 secondi al timer e la patata passa al prossimo.
   - Parola sbagliata → −5 secondi (stesso giocatore).
   - Tempo a zero     → chi tiene la patata "si scotta" (−10 pt) e si
     apre il recap: tutte le parole del turno, tutti confermano e si
     passa al turno successivo (nuove lettere).
   - A fine partita  → classifica finale.

   Backend:
   - Multiplayer: Firebase Firestore, collezione `partite` (stesse
     convenzioni di Ruzzle: matchId, stato attesa→in_corso→conclusa,
     rivincitaAccettataDa/RifiutataDa). Le transazioni rendono gli
     passaggi di turno atomici.
   - Allenamento: apri la pagina senza ?matchId → backend locale.

   Dizionario: lo stesso di Ruzzle — ../../dizionario.txt più gli
   override condivisi in Firestore (config/dizionario).
   ========================================================= */
(function (global) {
  'use strict';

  /* ---------------- COSTANTI ---------------- */
  const MIN_WORD_LENGTH = 4;
  const TIME_BONUS = 5000;        // +5 s per parola corretta
  const WRONG_PENALTY = 5000;     // −5 s per parola sbagliata
  const PATATA_PENALTY = 10;      // −10 pt per la scottatura
  const TIMEOUT_GRACE = 2500;     // tolleranza prima di dichiarare la scottatura
  const LETTER_THRESHOLD = 12;    // min parole nel dizionario per una combo valida
  const TICK_MS = 250;

  // Frequenza (approssimativa) delle lettere italiane, senza Q (→ QU)
  const LETTER_WEIGHTS = {
    A: 8, E: 12, I: 9, O: 10, U: 3, L: 7, R: 6, N: 5, T: 5, S: 4, C: 4,
    M: 4, D: 3, P: 3, B: 2, G: 2, F: 1, V: 1, Z: 1, H: 1
  };

  function pointsFor(len) {
    if (len <= 4) return 1;
    if (len === 5) return 2;
    if (len === 6) return 3;
    if (len === 7) return 5;
    return 11;
  }

  /* ---------------- RNG DETERMINISTICO (schema Ruzzle) ---------------- */
  function cyrb128(str) {
    let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (let i = 0, k; i < str.length; i++) {
      k = str.charCodeAt(i);
      h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
      h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
      h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
      h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h1 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h2 >>> 19), 2716044179);
    return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
  }

  function sfc32(a, b, c, d) {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    return function () {
      let t = (a + b) | 0;
      a = b ^ (b >>> 9);
      b = (b + c) | 0;
      c = (c << 21 | c >>> 11);
      d = (d + 1) | 0;
      t = (t + d) | 0;
      c = (c + t) | 0;
      return ((t = (t + d) | 0) >>> 0) / 4294967296;
    };
  }

  /* ---------------- DIZIONARIO ---------------- */
  function normalizeWord(raw) {
    return (raw || '')
      .trim()
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z]/g, '');
  }

  const PC8 = new Uint8Array(256);
  for (let i = 1; i < 256; i++) PC8[i] = PC8[i >> 1] + (i & 1);
  function pc32(v) {
    return PC8[v & 255] + PC8[(v >>> 8) & 255] + PC8[(v >>> 16) & 255] + PC8[(v >>> 24) & 255];
  }

  /**
   * Indice a bitset per lettera: permette di contare in O(parole/32)
   * quante parole del dizionario contengono TUTTE le lettere date.
   */
  class LetterIndex {
    constructor(words) {
      this.n = words.length;
      this.wordsPer = Math.ceil(this.n / 32) || 1;
      this.bits = {};
      for (const l of Object.keys(LETTER_WEIGHTS)) {
        this.bits[l] = new Uint32Array(this.wordsPer);
      }
      const seen = new Int32Array(26);
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        seen.fill(-1);
        for (let j = 0; j < w.length; j++) {
          const ci = w.charCodeAt(j) - 65;
          if (ci < 0 || ci > 25 || seen[ci] === i) continue;
          seen[ci] = i;
          const b = this.bits[String.fromCharCode(65 + ci)];
          if (b) b[i >>> 5] |= 1 << (i & 31);
        }
      }
    }
    /** Numero di parole che contengono tutte le lettere in `letters`. */
    countFor(letters) {
      const sets = [];
      for (const l of letters) {
        const b = this.bits[l];
        if (b) sets.push(b);
      }
      if (!sets.length) return 0;
      const pop = (arr) => {
        let c = 0;
        for (let i = 0; i < arr.length; i++) c += pc32(arr[i]);
        return c;
      };
      sets.sort((x, y) => pop(x) - pop(y));
      let acc = null;
      for (const s of sets) {
        if (acc === null) acc = s.slice();
        else for (let i = 0; i < acc.length; i++) acc[i] &= s[i];
      }
      return pop(acc);
    }
  }

  function weightedLetter(rand) {
    const entries = Object.entries(LETTER_WEIGHTS);
    let total = 0;
    for (const e of entries) total += e[1];
    let r = rand() * total;
    for (const [l, w] of entries) {
      r -= w;
      if (r < 0) return l;
    }
    return entries[0][0];
  }

  /**
   * Estrae DETERMINISTICAMENTE le lettere di un round (stesso seed + round
   → stessa combinazione su tutti i client, senza scritture extra).
   * Garantisce "non impossibili": la combo deve avere >= LETTER_THRESHOLD
   * parole valide nel dizionario; in caso contrario (quasi mai) usa la
   * combinazione più ricca incontrata.
   */
  function pickLetters(seed, round, nLetters, index) {
    const rand = sfc32(...cyrb128(seed + '::patata::' + round));
    const chosen = [];
    let best = null;
    let bestCount = -1;
    for (let attempt = 0; attempt < 600 && chosen.length < nLetters; attempt++) {
      const letter = weightedLetter(rand);
      if (chosen.indexOf(letter) !== -1) continue;
      const cand = chosen.concat(letter);
      const count = index ? index.countFor(cand) : Infinity;
      if (count > bestCount) {
        bestCount = count;
        best = cand.slice();
      }
      if (count >= LETTER_THRESHOLD) chosen.push(letter);
    }
    if (chosen.length === nLetters) return chosen;
    if (best && best.length >= 2) return best.slice();
    return chosen.length ? chosen.slice() : ['A', 'E'];
  }

  /* ---------------- UPDATE A PUNTEGGIATO (dot-path + ops) ---------------- */
  // Ops: {__op:'union', items:[...]}  →  arrayUnion
  //      {__op:'delete'}              →  FieldValue.delete()
  function setPath(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    const last = parts[parts.length - 1];
    if (value && value.__op === 'delete') delete cur[last];
    else if (value && value.__op === 'union') {
      if (!Array.isArray(cur[last])) cur[last] = [];
      for (const it of value.items) {
        const sig = JSON.stringify(it);
        if (!cur[last].some((x) => JSON.stringify(x) === sig)) cur[last].push(it);
      }
    } else cur[last] = value;
  }
  function applyPartial(obj, up) {
    for (const k of Object.keys(up)) setPath(obj, k, up[k]);
  }
  // fsMod = il modulo compat firebase.firestore (esposto .FieldValue)
  function toFirestoreUpdate(up, fsMod) {
    const out = {};
    for (const k of Object.keys(up)) {
      const v = up[k];
      if (v && v.__op === 'delete') out[k] = fsMod.FieldValue.delete();
      else if (v && v.__op === 'union') out[k] = fsMod.FieldValue.arrayUnion(...v.items);
      else out[k] = v;
    }
    return out;
  }

  /* ---------------- HELPERS DI STATO ---------------- */
  function roundOrderFor(partecipanti, roundNum) {
    const N = partecipanti.length;
    if (!N) return [];
    const start = ((roundNum - 1) % N + N) % N;
    const ord = [];
    for (let i = 0; i < N; i++) ord.push(partecipanti[(start + i) % N]);
    return ord;
  }
  function nextPlayer(state, nome) {
    const ord = roundOrderFor(state.partecipanti, state.round || 1);
    const i = ord.indexOf(nome);
    if (i === -1 || ord.length < 2) return nome;
    return ord[(i + 1) % ord.length];
  }
  function usedWords(state) {
    const s = new Set();
    (state.storia || []).forEach((e) => s.add(e.w));
    return s;
  }
  function findWordAuthor(state, word) {
    const parlate = state.roundData ? state.roundData.parlate : null;
    if (!parlate) return null;
    for (const p of Object.keys(parlate)) {
      const hit = (parlate[p] || []).find((x) => x.w === word);
      if (hit) return { author: p, entry: hit };
    }
    return null;
  }
  function flagThreshold(state) {
    return Math.max(1, Math.ceil((state.partecipanti.length - 1) / 2));
  }
  function flagsByOthers(state, word) {
    const flags = (state.roundData && state.roundData.flags) || {};
    const found = findWordAuthor(state, word);
    const who = flags[word] || [];
    if (!found) return [];
    return who.filter((n) => n !== found.author);
  }
  function flagResolved(state, word) {
    return flagsByOthers(state, word).length >= flagThreshold(state);
  }

  /* ---------------- VALIDAZIONE PAROLA (pura) ---------------- */
  function validateWord(raw, letters, used, dict) {
    const w = normalizeWord(raw);
    if (w.length === 0) return { ok: false, err: 'EMPTY' };
    if (w.length < MIN_WORD_LENGTH) return { ok: false, err: 'SHORT' };
    const missing = letters.filter((l) => w.indexOf(l) === -1);
    if (missing.length) return { ok: false, err: 'MISSING', missing };
    if (used.has(w)) return { ok: false, err: 'USED' };
    if (!dict.has(w)) return { ok: false, err: 'NOT_FOUND' };
    return { ok: true, w, p: pointsFor(w.length) };
  }

  /* ---------------- MUTATORS (puri: state+ctx → update|{__error}|null) ---------------- */
  function mutReady(state, ctx) {
    if (state.stato !== 'attesa') return null;
    if (state.pronti.indexOf(ctx.me) !== -1) return null;
    return { pronti: { __op: 'union', items: [ctx.me] } };
  }

  function mutStart(state, ctx) {
    if (state.stato !== 'attesa' || state.round) return null;
    if (state.pronti.length < state.partecipanti.length) return null;
    const parlate = {};
    const punteggi = {};
    const patate = {};
    state.partecipanti.forEach((p) => {
      parlate[p] = [];
      punteggi[p] = 0;
      patate[p] = 0;
    });
    const t = state.opzioni.tempo * 1000;
    return {
      stato: 'in_corso',
      round: 1,
      punteggi,
      patate,
      storia: [],
      roundData: { fase: 'giochi', parlate, patata: null, flags: {}, rimosse: [] },
      turno: {
        inizio: ctx.now,
        riferimento: ctx.now,
        deadline: ctx.now + t,
        giocatore: state.partecipanti[0],
        ultimo: null
      },
      confermaTurno: []
    };
  }

  function mutSubmitWord(state, ctx) {
    if (state.stato !== 'in_corso' || !state.roundData || !state.turno) return null;
    if (state.roundData.fase !== 'giochi') return { __error: { code: 'NOT_PLAYING' } };
    if (state.turno.giocatore !== ctx.me) return { __error: { code: 'NOT_YOUR_TURN' } };
    const v = validateWord(ctx.word, ctx.letters, ctx.used, ctx.dict);
    if (!v.ok) return { __error: { code: 'INVALID', detail: v.err } };
    const next = nextPlayer(state, ctx.me);
    return {
      'turno.deadline': Math.max(state.turno.deadline, ctx.now) + TIME_BONUS,
      'turno.riferimento': ctx.now,
      'turno.giocatore': next,
      'turno.ultimo': { nome: ctx.me, w: v.w, p: v.p, ok: true, ts: ctx.now },
      ['roundData.parlate.' + ctx.me]: { __op: 'union', items: [{ w: v.w, p: v.p }] },
      ['punteggi.' + ctx.me]: (state.punteggi[ctx.me] || 0) + v.p,
      'storia': { __op: 'union', items: [{ w: v.w, round: state.round, nome: ctx.me, p: v.p }] }
    };
  }

  function mutWrongWord(state, ctx) {
    if (state.stato !== 'in_corso' || !state.roundData || !state.turno) return null;
    if (state.roundData.fase !== 'giochi') return null;
    if (state.turno.giocatore !== ctx.me) return { __error: { code: 'NOT_YOUR_TURN' } };
    const ultimo = state.turno.ultimo;
    if (ultimo && ultimo.nome === ctx.me && ctx.now - ultimo.ts < 1000) return null;
    const w = normalizeWord(ctx.word);
    if (!w) return null;
    return {
      'turno.deadline': Math.max(state.turno.deadline, ctx.now) - WRONG_PENALTY,
      'turno.riferimento': ctx.now,
      'turno.ultimo': { nome: ctx.me, w, ok: false, ts: ctx.now }
    };
  }

  function mutTimeout(state, ctx) {
    if (state.stato !== 'in_corso' || !state.roundData || !state.turno) return null;
    if (state.roundData.fase !== 'giochi') return null;
    if (ctx.now <= state.turno.deadline + TIMEOUT_GRACE) return null;
    const holder = state.turno.giocatore;
    return {
      'roundData.fase': 'recap',
      'roundData.patata': holder,
      ['punteggi.' + holder]: (state.punteggi[holder] || 0) - PATATA_PENALTY,
      ['patate.' + holder]: (state.patate[holder] || 0) + 1,
      'turno.ultimo': { nome: holder, ok: false, patata: true, ts: ctx.now },
      'confermaTurno': []
    };
  }

  function mutConferma(state, ctx) {
    if (state.stato !== 'in_corso' || !state.roundData || state.roundData.fase !== 'recap') return null;
    if (state.confermaTurno.indexOf(ctx.me) !== -1) return null;
    return { confermaTurno: { __op: 'union', items: [ctx.me] } };
  }

  function mutFlag(state, ctx) {
    if (state.stato !== 'in_corso' || !state.roundData || state.roundData.fase !== 'recap') return null;
    const flags = state.roundData.flags || {};
    if ((flags[ctx.word] || []).indexOf(ctx.me) !== -1) return null;
    if (!findWordAuthor(state, ctx.word)) return null;
    return { ['roundData.flags.' + ctx.word]: { __op: 'union', items: [ctx.me] } };
  }

  function mutResolveFlag(state, ctx) {
    if (state.stato !== 'in_corso' || !state.roundData || state.roundData.fase !== 'recap') return null;
    const found = findWordAuthor(state, ctx.word);
    if (!found) return null;
    if (flagsByOthers(state, ctx.word).length < flagThreshold(state)) return null;
    const remaining = (state.roundData.parlate[found.author] || []).filter((x) => x.w !== ctx.word);
    return {
      ['roundData.parlate.' + found.author]: remaining,
      ['punteggi.' + found.author]: (state.punteggi[found.author] || 0) - found.entry.p,
      'roundData.rimosse': { __op: 'union', items: [ctx.word] },
      ['roundData.flags.' + ctx.word]: { __op: 'delete' }
    };
  }

  function mutNextRound(state, ctx) {
    if (state.stato !== 'in_corso' || !state.roundData || state.roundData.fase !== 'recap') return null;
    if (state.confermaTurno.length < state.partecipanti.length) return null;
    if (state.round >= state.opzioni.turni) return { stato: 'conclusa' };
    const parlate = {};
    state.partecipanti.forEach((p) => { parlate[p] = []; });
    const nextRound = state.round + 1;
    const starter = roundOrderFor(state.partecipanti, nextRound)[0];
    return {
      round: nextRound,
      roundData: { fase: 'giochi', parlate, patata: null, flags: {}, rimosse: [] },
      turno: {
        inizio: ctx.now,
        riferimento: ctx.now,
        deadline: ctx.now + state.opzioni.tempo * 1000,
        giocatore: starter,
        ultimo: null
      },
      confermaTurno: []
    };
  }

  /* ---------------- NORMALIZZAZIONE (Firestore → state) ---------------- */
  function normState(d) {
    const op = d.opzioni || {};
    return {
      partecipanti: d.partecipanti || [],
      opzioni: {
        tempo: Math.max(5, parseInt(op.tempo, 10) || 60),
        turni: Math.max(1, parseInt(op.turni, 10) || 3),
        lettere: Math.min(4, Math.max(2, parseInt(op.lettere, 10) || 3)),
        seed: op.seed || 'SEED001',
        mode: op.mode || 'classic'
      },
      punteggi: d.punteggi || {},
      patate: d.patate || {},
      stato: d.stato || 'attesa',
      pronti: d.pronti || [],
      round: d.round || 0,
      roundData: d.roundData || null,
      turno: d.turno || null,
      confermaTurno: d.confermaTurno || [],
      storia: d.storia || [],
      prossimaPartita: d.prossimaPartita || null,
      prossimaPartitaCreataDa: d.prossimaPartitaCreataDa || null,
      rivincitaAccettataDa: d.rivincitaAccettataDa || [],
      rivincitaRifiutataDa: d.rivincitaRifiutataDa || []
    };
  }

  /* ---------------- BACKEND LOCALE (allenamento solo) ---------------- */
  class SoloBackend {
    constructor(me, opzioni, opts) {
      this.me = me;
      this.clock = (opts && opts.clock) || (() => Date.now());
      this._subs = new Set();
      this.state = normState({
        partecipanti: [me],
        opzioni,
        punteggi: {},
        pronti: [me]
      });
    }
    subscribe(cb) {
      this._subs.add(cb);
      cb(this.snapshot());
      return () => this._subs.delete(cb);
    }
    snapshot() {
      return Object.assign({}, this.state);
    }
    _emit() {
      this._subs.forEach((cb) => cb(this.snapshot()));
    }
    _ctx(extra) {
      return Object.assign({ me: this.me, now: this.clock() }, extra || {});
    }
    transact(mutator) {
      const up = mutator(this.state, this._ctx());
      if (!up) return { aborted: true };
      if (up.__error) return { aborted: true, error: up.__error };
      applyPartial(this.state, up);
      this._emit();
      return { ok: true };
    }
    stop() {}
  }

  /* ---------------- BACKEND FIREBASE (multiplayer) ---------------- */
  class FirebaseBackend {
    // fsMod: modulo compat firebase.firestore (per FieldValue); il db deriva da fsMod()
    constructor(fsMod, matchId, me) {
      this.fs = fsMod;
      this.db = fsMod();
      this.ref = this.db.collection('partite').doc(matchId);
      this.me = me;
      this.state = null;
      this._subs = new Set();
      this.unsub = null;
      this.onDead = null; // doc rimosso → callback (redirect)
    }
    start() {
      this.unsub = this.ref.onSnapshot(
        (snap) => {
          if (!snap.exists()) {
            if (this.onDead) this.onDead();
            return;
          }
          this.state = normState(snap.data());
          this._subs.forEach((cb) => cb(this.state));
        },
        (err) => {
          console.error('[Patata] errore listener:', err);
          if (this.onError) this.onError(err);
        }
      );
      return this;
    }
    subscribe(cb) {
      this._subs.add(cb);
      if (this.state) cb(this.state);
      return () => this._subs.delete(cb);
    }
    transact(mutator) {
      return this.db.runTransaction(async (t) => {
        const snap = await t.get(this.ref);
        if (!snap.exists()) return { aborted: true };
        const state = normState(snap.data());
        const up = mutator(state, { me: this.me, now: Date.now() });
        if (!up) return { aborted: true };
        if (up.__error) return { aborted: true, error: up.__error };
        t.update(this.ref, toFirestoreUpdate(up, this.fs));
        return { ok: true };
      }).catch((e) => {
        console.error('[Patata] errore transazione:', e);
        return { failed: true, error: { code: e && e.code ? e.code : 'NET', message: e && e.message } };
      });
    }
    stop() {
      if (this.unsub) this.unsub();
    }
  }

  /* ---------------- ESPOSIZIONE PER TEST ---------------- */
  const core = {
    MIN_WORD_LENGTH, TIME_BONUS, WRONG_PENALTY, PATATA_PENALTY, TIMEOUT_GRACE,
    LETTER_THRESHOLD, LETTER_WEIGHTS,
    cyrb128, sfc32, normalizeWord, LetterIndex, pickLetters, weightedLetter,
    pointsFor, applyPartial, setPath, roundOrderFor, nextPlayer, usedWords,
    findWordAuthor, flagThreshold, flagsByOthers, flagResolved, validateWord,
    mutReady, mutStart, mutSubmitWord, mutWrongWord, mutTimeout, mutConferma,
    mutFlag, mutResolveFlag, mutNextRound, normState, SoloBackend, FirebaseBackend,
    toFirestoreUpdate
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  if (global) global.__PATATA_CORE = core;

  /* =========================================================
     SEZIONE BROWSER (solo se c'è un DOM)
     ========================================================= */
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const $ = (id) => document.getElementById(id);

  /* ---------------- STATO APPLICATIVO ---------------- */
  const urlParams = new URLSearchParams(window.location.search);
  const matchId = urlParams.get('matchId');
  const solo = !matchId;
  const me = solo
    ? (localStorage.getItem('mioNome') || 'GIOCATORE')
    : (localStorage.getItem('mioNome') || '');

  const G = {
    solo,
    matchId,
    me,
    dict: null,          // Set di parole
    index: null,         // LetterIndex
    backend: null,
    db: null,
    state: null,
    soundOn: localStorage.getItem('patata_suono') !== 'off',
    letterCache: new Map(),
    busy: false,
    prevTurn: null,
    prevUltimoTs: 0,
    prevRound: 0,
    lastWholeSec: -1,
    statsSaved: false,
    redirected: false,
    lastFeedbackTimer: null
  };

  /* ---------------- ELEMENTI DOM ---------------- */
  const el = {};
  ['screen-loading', 'load-status', 'load-count', 'app', 'round-badge', 'btn-suono',
   'screen-lobby', 'cfg-tempo', 'cfg-turni', 'cfg-lettere', 'lobby-players',
   'lobby-status', 'lobby-status-text', 'btn-start-solo', 'lobby-hint',
   'screen-game', 'letter-tiles', 'letters-avail', 'ring-fill', 'timer-sec',
   'turn-banner', 'game-players', 'input-card', 'word-input', 'btn-invia',
   'input-hint', 'feedback', 'scoreboard', 'feed', 'feed-count',
   'overlay-recap', 'recap-round', 'recap-patata', 'recap-body',
   'conf-progress', 'btn-conferma',
   'overlay-fine', 'fine-emoji', 'fine-title', 'fine-sub', 'podio', 'fine-stats',
   'btn-rivincita', 'banner', 'toast'
  ].forEach((id) => { el[id] = $(id); });
  const ringWrap = document.querySelector('.timer-wrap');

  /* ---------------- UTILITY UI ---------------- */
  const AVATAR_COLORS = ['#ffc94d', '#4cc9f0', '#34d399', '#ff8fa3', '#c084fc', '#ff9e2c', '#7dd3fc', '#f9a8d4'];
  function avatarColor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  function highlightWord(word, letters) {
    const marks = new Array(word.length).fill(false);
    letters.forEach((l) => {
      const i = word.indexOf(l);
      if (i >= 0) marks[i] = true;
    });
    let html = '';
    for (let i = 0; i < word.length; i++) {
      html += marks[i] ? '<mark>' + esc(word[i]) + '</mark>' : esc(word[i]);
    }
    return html;
  }
  function vibrate(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* noop */ }
  }
  function toast(msg, kind) {
    el.toast.textContent = msg;
    el.toast.className = 'toast' + (kind ? ' ' + kind : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.toast.className = 'toast hidden'; }, 2600);
  }
  let bannerTimer = null;
  function banner(opts) {
    el.banner.innerHTML =
      '<span class="b-emoji">' + (opts.icon || '🥔') + '</span>' +
      '<div class="b-text"><div class="b-title">' + esc(opts.title) + '</div>' +
      (opts.subtitle ? '<div class="b-sub">' + esc(opts.subtitle) + '</div>' : '') + '</div>' +
      '<div class="b-actions">' +
      (opts.spinner ? '<span class="spinner"></span>' : '') +
      (opts.buttons || []).map((b) =>
        '<button class="btn ' + (b.kind || 'btn-ghost') + '" data-bid="' + b.id + '">' + esc(b.label) + '</button>'
      ).join('') +
      '</div>';
    el.banner.classList.remove('hidden');
    (opts.buttons || []).forEach((b) => {
      const btn = el.banner.querySelector('[data-bid="' + b.id + '"]');
      if (btn) btn.addEventListener('click', () => b.fn());
    });
    clearTimeout(bannerTimer);
    if (opts.sticky !== true) bannerTimer = setTimeout(() => { el.banner.classList.add('hidden'); }, 6000);
  }
  function hideBanner() {
    clearTimeout(bannerTimer);
    el.banner.classList.add('hidden');
  }

  /* ---------------- AUDIO (WebAudio, nessun asset) ---------------- */
  let actx = null;
  function audio() {
    if (!G.soundOn) return null;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      return actx;
    } catch (e) { return null; }
  }
  function beep(freq, dur, type, gain, when) {
    const a = audio();
    if (!a) return;
    const t0 = a.currentTime + (when || 0);
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.12, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(a.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
  const SFX = {
    turn: () => { beep(523, 0.09, 'sine', 0.12); beep(784, 0.12, 'sine', 0.12, 0.09); },
    ok: () => { beep(659, 0.08, 'sine', 0.14); beep(880, 0.13, 'sine', 0.14, 0.07); },
    err: () => beep(150, 0.2, 'sawtooth', 0.1),
    patata: () => { beep(392, 0.12, 'square', 0.09); beep(262, 0.14, 'square', 0.09, 0.13); beep(131, 0.32, 'square', 0.09, 0.28); },
    tick: () => beep(1000, 0.035, 'square', 0.045),
    confirm: () => beep(700, 0.09, 'sine', 0.1),
    win: () => { [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.16, 'sine', 0.13, i * 0.13)); }
  };

  /* ---------------- CONFETTI ---------------- */
  function confetti() {
    const colors = ['#ffc94d', '#ff9e2c', '#ff5f1f', '#4cc9f0', '#34d399', '#ffffff'];
    for (let i = 0; i < 140; i++) {
      const p = document.createElement('div');
      p.className = 'confetti-p';
      const size = 5 + Math.random() * 8;
      p.style.width = size + 'px';
      p.style.height = size * (Math.random() > 0.5 ? 1 : 0.5) + 'px';
      p.style.background = colors[(Math.random() * colors.length) | 0];
      p.style.left = Math.random() * 100 + 'vw';
      p.style.top = '-3vh';
      document.body.appendChild(p);
      const drift = (Math.random() - 0.5) * 340;
      const rot = (Math.random() - 0.5) * 1200;
      const dur = 2200 + Math.random() * 2600;
      p.animate([
        { transform: 'translate(0,0) rotate(0)', opacity: 1 },
        { transform: 'translate(' + drift * 0.3 + 'px,' + window.innerHeight * 0.45 + 'px) rotate(' + rot * 0.5 + 'deg)', opacity: 1, offset: 0.45 },
        { transform: 'translate(' + drift + 'px,' + (window.innerHeight + 60) + 'px) rotate(' + rot + 'deg) scale(0.4)', opacity: 0 }
      ], { duration: dur, easing: 'cubic-bezier(0.25,0.46,0.45,0.94)', delay: Math.random() * 700 })
        .onfinish = () => p.remove();
    }
  }

  /* ---------------- DIZIONARIO ---------------- */
  function setLoadStatus(msg, isErr) {
    el['load-status'].textContent = msg;
    el['load-status'].style.color = isErr ? 'var(--danger)' : '';
  }
  async function fetchWithTimeout(url, timeout) {
    return Promise.race([
      fetch(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout di rete')), timeout))
    ]);
  }
  async function loadDictionary() {
    setLoadStatus('Scarico il dizionario…');
    let text;
    try {
      const res = await fetchWithTimeout('../../dizionario.txt', 20000);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      text = await res.text();
    } catch (e) {
      throw e;
    }
    const words = new Set();
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const w = normalizeWord(lines[i]);
      if (w.length >= MIN_WORD_LENGTH) words.add(w);
      if (i % 40000 === 0 && i > 0) {
        el['load-count'].textContent = i.toLocaleString('it-IT') + ' / ' + lines.length.toLocaleString('it-IT') + ' parole';
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    el['load-count'].textContent = words.size.toLocaleString('it-IT') + ' parole nel dizionario';
    setLoadStatus('Carico le parole condivise…');

    // Override Firebase (extra/excluded) — stessi dati di Ruzzle, best effort
    if (G.db) {
      try {
        const fb = G.db;
        const doc = await Promise.race([
          fb.collection('config').doc('dizionario').get(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('fb timeout')), 5000))
        ]);
        if (doc.exists) {
          const d = doc.data() || {};
          (d.extra || []).forEach((w) => {
            const n = normalizeWord(w);
            if (n.length >= MIN_WORD_LENGTH) words.add(n);
          });
          (d.excluded || []).forEach((w) => words.delete(normalizeWord(w)));
        }
      } catch (e) {
        console.warn('[Patata] override dizionario Firebase non disponibili:', e.message);
      }
    }

    G.dict = words;
    G.index = new LetterIndex(Array.from(words));
    setLoadStatus('Dizionario pronto: ' + G.dict.size.toLocaleString('it-IT') + ' parole');
  }

  /* ---------------- DERIVATI ---------------- */
  function lettersFor(state) {
    const key = state.opzioni.seed + ':' + state.round;
    if (!G.letterCache.has(key)) {
      G.letterCache.set(key, pickLetters(state.opzioni.seed, state.round, state.opzioni.lettere, G.index));
    }
    return G.letterCache.get(key);
  }
  function availFor(letters) {
    return G.index ? G.index.countFor(letters) : 0;
  }

  /* ---------------- LOGICA (tick) ---------------- */
  function ctxFor(extra) {
    const s = G.state;
    return Object.assign({
      me: G.me,
      now: Date.now(),
      letters: s ? lettersFor(s) : [],
      used: s ? usedWords(s) : new Set(),
      dict: G.dict
    }, extra || {});
  }

  async function logicaTick() {
    const s = G.state;
    if (!s || G.busy) return;
    G.busy = true;
    try {
      if (s.stato === 'attesa') {
        if (G.solo) return;
        if (s.pronti.indexOf(G.me) === -1) {
          await G.backend.transact(mutReady);
          return;
        }
        if (s.pronti.length >= s.partecipanti.length) {
          await G.backend.transact(mutStart);
        }
        return;
      }
      if (s.stato !== 'in_corso' || !s.roundData) return;

      if (s.roundData.fase === 'giochi' && s.turno) {
        if (Date.now() > s.turno.deadline + TIMEOUT_GRACE) {
          await G.backend.transact(mutTimeout);
        }
        return;
      }

      if (s.roundData.fase === 'recap') {
        // Risolvi le contestazioni raggiunte (maggioranza di chi non è l'autore)
        const flags = s.roundData.flags || {};
        for (const word of Object.keys(flags)) {
          if (flagResolved(s, word)) {
            const r = await G.backend.transact((st) => mutResolveFlag(st, { word }));
            if (r && r.ok) toast('🚩 "' + word + '" contestata: punti rimossi', 'ok');
          }
        }
        if (s.confermaTurno.length >= s.partecipanti.length) {
          await G.backend.transact(mutNextRound);
        }
      }
    } catch (e) {
      console.error('[Patata] tick:', e);
    } finally {
      G.busy = false;
    }
  }

  /* ---------------- RENDER: LOBBY ---------------- */
  function renderLobby(s) {
    const op = s.opzioni;
    el['cfg-tempo'].textContent = op.tempo + 's';
    el['cfg-turni'].textContent = op.turni;
    el['cfg-lettere'].textContent = op.lettere;

    el['lobby-players'].innerHTML = s.partecipanti.map((p) =>
      '<span class="pchip">' +
      '<span class="avatar" style="background:' + avatarColor(p) + '">' + esc(p.slice(0, 2).toUpperCase()) + '</span>' +
      esc(p) + (p === G.me ? ' (TU)' : '') +
      (s.pronti.indexOf(p) !== -1 ? '<span class="ready-dot" title="pronto"></span>' : '') +
      '</span>'
    ).join('');

    const pronti = s.pronti.length;
    const tot = s.partecipanti.length;
    if (G.solo) {
      el['lobby-status'].classList.add('hidden');
      el['btn-start-solo'].classList.remove('hidden');
      el['lobby-hint'].innerHTML = 'Allenamento personale: la patata scotta lo stesso. 🫠';
    } else {
      el['btn-start-solo'].classList.add('hidden');
      if (pronti >= tot) {
        el['lobby-status-text'].textContent = 'Tutti pronti: inizio immediato!';
      } else {
        el['lobby-status'].classList.remove('hidden');
        el['lobby-status-text'].textContent = 'In attesa di tutti (' + pronti + '/' + tot + ' pronti)…';
      }
    }
  }

  /* ---------------- RENDER: GIOCO ---------------- */
  function renderLetters(s) {
    if (!s.roundData) return;
    const letters = lettersFor(s);
    el['letter-tiles'].innerHTML = letters.map((l) => '<span class="ltile">' + esc(l) + '</span>').join('');
    const n = availFor(letters);
    el['letters-avail'].innerHTML =
      n > 0 ? '<b>' + n.toLocaleString('it-IT') + '</b> parole valide nel dizionario per questo turno' : '…';
    updateInputHint();
  }

  function renderPlayersGame(s) {
    const order = roundOrderFor(s.partecipanti, s.round || 1);
    const active = (s.roundData && s.roundData.fase === 'giochi') ? s.turno && s.turno.giocatore : null;
    el['game-players'].innerHTML = order.map((p) =>
      '<span class="pchip' + (p === active ? ' active' : '') + (p === G.me ? ' mine' : '') + '">' +
      (p === active ? '<span class="potato">🥔</span>' : '') +
      '<span class="avatar" style="background:' + avatarColor(p) + '">' + esc(p.slice(0, 2).toUpperCase()) + '</span>' +
      esc(p) + (p === G.me ? ' (TU)' : '') +
      (s.patate[p] ? '<span class="scottato">🔥×' + s.patate[p] + '</span>' : '') +
      '</span>'
    ).join('');

    // Turn banner
    if (s.roundData && s.roundData.fase === 'giochi' && s.turno) {
      el['turn-banner'].classList.remove('hidden');
      if (s.turno.giocatore === G.me) {
        el['turn-banner'].textContent = '🔥 TOCCA A TE — SCRIVI UNA PAROLA!';
        el['turn-banner'].classList.add('mine');
      } else {
        el['turn-banner'].textContent = 'TOCCA A ' + s.turno.giocatore.toUpperCase();
        el['turn-banner'].classList.remove('mine');
      }
    } else {
      el['turn-banner'].classList.add('hidden');
    }

    // Input abilitato solo al mio turno
    const myTurn = s.roundData && s.roundData.fase === 'giochi' && s.turno && s.turno.giocatore === G.me;
    el['word-input'].disabled = !myTurn;
    el['btn-invia'].disabled = !myTurn;
    if (myTurn) {
      el['word-input'].classList.add('ready');
      el['word-input'].placeholder = 'Scrivi la parola… (INVIO)';
      if (document.hasFocus()) el['word-input'].focus({ preventScroll: true });
    } else {
      el['word-input'].classList.remove('ready');
      const next = s.turno ? s.turno.giocatore : (s.partecipanti[0] || '');
      el['word-input'].placeholder = next === G.me ? 'Preparati…' : 'In attesa di ' + next + '…';
    }
  }

  function updateInputHint() {
    const s = G.state;
    if (!s || !s.roundData) return;
    const letters = lettersFor(s);
    const val = el['word-input'].value ? normalizeWord(el['word-input'].value) : '';
    el['input-hint'].innerHTML =
      '<span>deve contenere:</span>' +
      letters.map((l) =>
        '<span class="mini-letter' + (val.indexOf(l) !== -1 ? ' hit' : '') + '">' + esc(l) + '</span>'
      ).join('');
  }

  function renderFeed(s) {
    if (!s.roundData) return;
    const entries = (s.storia || []).filter((e) => e.round === s.round);
    const rimosse = (s.roundData.rimosse || []);
    el['feed-count'].textContent = entries.length ? '(' + entries.length + ')' : '';
    if (!entries.length) {
      el.feed.innerHTML = '<div class="feed-empty">Nessuna parola ancora. Siate pronti! ⚡</div>';
      return;
    }
    const letters = lettersFor(s);
    el.feed.innerHTML = entries.map((e) =>
      '<div class="feed-item' + (rimosse.indexOf(e.w) !== -1 ? ' removed' : '') + '">' +
      '<span class="avatar" style="background:' + avatarColor(e.nome) + '">' + esc(e.nome.slice(0, 2).toUpperCase()) + '</span>' +
      '<span class="fname">' + esc(e.nome) + '</span>' +
      '<span class="fword">' + highlightWord(e.w, letters) + '</span>' +
      '<span class="fpts">' + (rimosse.indexOf(e.w) !== -1 ? '0' : '+' + e.p) + '</span>' +
      '</div>'
    ).join('');
    el.feed.scrollTop = el.feed.scrollHeight;
  }

  function renderScoreboard(s) {
    const rows = s.partecipanti
      .map((p) => ({ p, pts: s.punteggi[p] || 0, patate: s.patate[p] || 0 }))
      .sort((a, b) => b.pts - a.pts || a.p.localeCompare(b.p));
    el.scoreboard.innerHTML = rows.map((r, i) =>
      '<div class="srow' + (r.p === G.me ? ' mine' : '') + '">' +
      '<span class="rank">' + (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1)) + '</span>' +
      '<span class="avatar" style="background:' + avatarColor(r.p) + '">' + esc(r.p.slice(0, 2).toUpperCase()) + '</span>' +
      '<span class="sname">' + esc(r.p) + (r.p === G.me ? ' (TU)' : '') + '</span>' +
      (r.patate ? '<span class="spat">🥔×' + r.patate + '</span>' : '') +
      '<span class="spts' + (r.pts < 0 ? ' neg' : '') + '">' + r.pts + '</span>' +
      '</div>'
    ).join('');
  }

  function renderRecap(s) {
    const rd = s.roundData;
    el['recap-round'].textContent = s.round + '/' + s.opzioni.turni;
    el['recap-patata'].innerHTML =
      '<span class="rp-emoji">🥔</span>' +
      '<span><b>' + esc(rd.patata) + '</b> ha tenuto la patata bollente</span>' +
      '<span class="rp-penalty">−' + PATATA_PENALTY + ' pt</span>';

    const letters = lettersFor(s);
    const rimosse = rd.rimosse || [];
    const flags = rd.flags || {};

    el['recap-body'].innerHTML = s.partecipanti.map((p) => {
      const words = rd.parlate[p] || [];
      let total = 0;
      words.forEach((x) => { if (rimosse.indexOf(x.w) === -1) total += x.p; });
      if (rd.patata === p) total -= PATATA_PENALTY;
      const wasPatata = rd.patata === p;
      const wordsHtml = words.length
        ? words.map((x) => {
            const removed = rimosse.indexOf(x.w) !== -1;
            const fl = (flags[x.w] || []).filter((n) => n !== p);
            const threshold = flagThreshold(s);
            const iFlagged = (flags[x.w] || []).indexOf(G.me) !== -1;
            return '<span class="rp-word' + (removed ? ' removed' : '') + '">' +
              highlightWord(x.w, letters) +
              ' <span class="rw-pts">' + (removed ? '0' : '+' + x.p) + '</span>' +
              '<button class="flag-btn" data-word="' + esc(x.w) + '"' +
                (iFlagged || removed ? ' disabled' : '') +
                ' title="Contesta: non è una parola">🚩</button>' +
              (fl.length ? '<span class="flag-count">🚩' + fl.length + '/' + threshold + '</span>' : '') +
              '</span>';
          }).join('')
        : '<span class="rp-none">nessuna parola</span>';
      return '<div class="recap-player' + (wasPatata ? ' was-patata' : '') + '">' +
        '<div class="rp-head">' +
        '<span class="avatar" style="background:' + avatarColor(p) + '">' + esc(p.slice(0, 2).toUpperCase()) + '</span>' +
        '<span class="rp-name">' + esc(p) + (p === G.me ? ' (TU)' : '') + (wasPatata ? ' <span class="rp-patata">🥔 SCOTTATO</span>' : '') + '</span>' +
        '<span class="rp-total">' + total + ' pt</span>' +
        '</div>' +
        '<div class="rp-words">' + wordsHtml + '</div>' +
        '</div>';
    }).join('');

    // Pulsanti flag (delegazione)
    el['recap-body'].querySelectorAll('.flag-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const word = btn.getAttribute('data-word');
        const r = await G.backend.transact((st) => mutFlag(st, { word, me: G.me }));
        if (r && r.ok) toast('🚩 Contestazione inviata per "' + word + '"');
      });
    });

    // Conferma
    const tot = s.partecipanti.length;
    const k = s.confermaTurno.length;
    const iDone = s.confermaTurno.indexOf(G.me) !== -1;
    const lastRound = s.round >= s.opzioni.turni;
    el['conf-progress'].innerHTML =
      (iDone ? '✔ Hai confermato — ' : 'Attendendo conferme: ') + '<b>' + k + '/' + tot + '</b>' +
      '<div class="conf-bar"><i style="width:' + Math.round((k / tot) * 100) + '%"></i></div>';
    el['btn-conferma'].disabled = iDone;
    el['btn-conferma'].textContent = iDone
      ? '⏳ IN ATTESA DEGLI ALTRI…'
      : (lastRound ? '✔ CONFERMA E CHIUDI PARTITA' : '✔ CONFERMA E PROSEGUI');
  }

  function computeRanking(s) {
    return s.partecipanti
      .map((p) => ({
        p,
        pts: s.punteggi[p] || 0,
        patate: s.patate[p] || 0,
        parole: (s.storia || []).filter((e) => e.nome === p).length
      }))
      .sort((a, b) => b.pts - a.pts || a.patate - b.patate || a.p.localeCompare(b.p));
  }

  function renderFine(s) {
    const ranking = computeRanking(s);
    const best = ranking[0];
    const winners = ranking.filter((r) => r.pts === best.pts);
    const iWon = winners.some((w) => w.p === G.me);

    el['fine-emoji'].textContent = winners.length > 1 ? '🤝' : '🏆';
    if (winners.length > 1) {
      el['fine-title'].textContent = 'PAREGGIO!';
      el['fine-sub'].textContent = winners.map((w) => w.p).join(' e ') + ' vincono con ' + best.pts + ' punti';
    } else if (iWon && s.partecipanti.length > 1) {
      el['fine-title'].textContent = 'HAI VINTO!';
      el['fine-sub'].textContent = 'Patata bollente superata con ' + best.pts + ' punti 🎉';
    } else if (iWon) {
      el['fine-title'].textContent = 'ALLENAMENTO COMPLETATO';
      el['fine-sub'].textContent = 'Punteggio finale: ' + best.pts + ' punti';
    } else {
      el['fine-title'].textContent = 'HA VINTO ' + best.p.toUpperCase();
      el['fine-sub'].textContent = 'Con ' + best.pts + ' punti. Rivedi la patata e riprova!';
    }

    const top = ranking.slice(0, 3);
    const cls = { 1: 'p1', 0: 'p2', 2: 'p3' }; // layout: 2°, 1°, 3°
    const order = [top[1], top[0], top[2]].filter(Boolean);
    el.podio.innerHTML = order.map((r) => {
      const idx = top.indexOf(r);
      const medals = ['🥇', '', '🥉'];
      return '<div class="pod-col ' + cls[idx] + '">' +
        '<span class="pod-medal">' + medals[idx] + '</span>' +
        '<span class="avatar" style="background:' + avatarColor(r.p) + '">' + esc(r.p.slice(0, 2).toUpperCase()) + '</span>' +
        '<span class="pod-name">' + esc(r.p) + (r.p === G.me ? ' (TU)' : '') + '</span>' +
        '<div class="pod-bar">' + r.pts + '</div>' +
        '<span class="pod-sub">' + r.parole + ' parole' + (r.patate ? ' · 🥔×' + r.patate : '') + '</span>' +
        '</div>';
    }).join('');

    const storia = s.storia || [];
    let longest = null;
    storia.forEach((e) => { if (!longest || e.w.length > longest.w.length) longest = e; });
    const totalPatate = s.partecipanti.reduce((acc, p) => acc + (s.patate[p] || 0), 0);
    let worst = null;
    s.partecipanti.forEach((p) => {
      if (!worst || (s.patate[p] || 0) > (s.patate[worst] || 0)) worst = p;
    });
    el['fine-stats'].innerHTML =
      '<div class="fs-item"><div class="fs-val">' + storia.length + '</div><div class="fs-lab">PAROLE TOTALI</div></div>' +
      '<div class="fs-item"><div class="fs-val">' + (longest ? esc(longest.w) + ' (' + longest.w.length + ')' : '—') + '</div><div class="fs-lab">PAROLA PIÙ LUNGA</div></div>' +
      '<div class="fs-item"><div class="fs-val">' + totalPatate + (totalPatate > 1 && worst ? ' · peggior: ' + esc(worst) : '') + '</div><div class="fs-lab">SCOTTATURE TOTALI</div></div>';

    // Statistiche giornalieri (stesso store dell'hub)
    if (!G.statsSaved) {
      G.statsSaved = true;
      try {
        const KEY = 'funatwork_daily_stats';
        const today = new Date().toISOString().split('T')[0];
        const stats = JSON.parse(localStorage.getItem(KEY) || '{"days":{},"totals":{}}');
        if (!stats.days[today]) stats.days[today] = {};
        stats.days[today].patata = (stats.days[today].patata || 0) + 1;
        stats.totals.patata = (stats.totals.patata || 0) + 1;
        localStorage.setItem(KEY, JSON.stringify(stats));
      } catch (e) { /* noop */ }
    }

    if (iWon && s.partecipanti.length > 1) {
      confetti();
      SFX.win();
      vibrate([60, 40, 120]);
    }

    // Rivincita (multiplayer)
    el['btn-rivincita'].classList.toggle('hidden', G.solo);
    renderRematch(s);
  }

  /* ---------------- RIVINCITA ---------------- */
  async function creaRivincita() {
    const s = G.state;
    if (!s || s.stato !== 'conclusa') return;
    if (G.solo || !G.db) { toast('Rivincita disponibile solo in sfida'); return; }
    if (s.prossimaPartita) { toast('Rivincita già creata, in attesa…'); return; }
    try {
      const newId = await G.db.runTransaction(async (t) => {
        const snap = await t.get(G.backend.ref);
        if (!snap.exists()) return null;
        const st = normState(snap.data());
        if (st.stato !== 'conclusa') return null;
        if (st.prossimaPartita) return st.prossimaPartita;
        const ref = G.db.collection('partite').doc();
        const punteggi = {};
        const parole = {};
        st.partecipanti.forEach((p) => { punteggi[p] = 0; parole[p] = []; });
        t.set(ref, {
          gioco: 'patata',
          partecipanti: st.partecipanti,
          punteggi,
          parole,
          pronti: [],
          stato: 'attesa',
          rivincitaAccettataDa: [],
          rivincitaRifiutataDa: [],
          dataOra: new Date().toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
          timestamp: Date.now(),
          opzioni: {
            tempo: String(st.opzioni.tempo),
            turni: String(st.opzioni.turni),
            lettere: String(st.opzioni.lettere),
            mode: st.opzioni.mode,
            seed: Math.random().toString(36).substring(7).toUpperCase()
          }
        });
        t.update(G.backend.ref, {
          prossimaPartita: ref.id,
          prossimaPartitaCreataDa: G.me,
          rivincitaAccettataDa: [],
          rivincitaRifiutataDa: []
        });
        return ref.id;
      });
      if (!newId) { toast('Non è più possibile creare la rivincita'); return; }
      hideBanner();
    } catch (e) {
      console.error('[Patata] rivincita:', e);
      toast('Errore nella creazione della rivincita', 'err');
    }
  }
  function accettaRivincita() {
    G.backend.ref.update({ rivincitaAccettataDa: G.fs.FieldValue.arrayUnion(G.me) }).catch(() => {});
    SFX.confirm();
  }
  function rifiutaRivincita() {
    G.backend.ref.update({ rivincitaRifiutataDa: G.fs.FieldValue.arrayUnion(G.me) }).catch(() => {});
  }
  function renderRematch(s) {
    const N = s.partecipanti.length;
    const rifiutanti = s.rivincitaRifiutataDa || [];
    const accettanti = s.rivincitaAccettataDa || [];
    const id = s.prossimaPartita;

    if (!id) {
      if (s.stato === 'conclusa' && !G.solo) el['btn-rivincita'].disabled = rifiutanti.length > 0;
      return;
    }
    if (rifiutanti.length > 0) {
      el['btn-rivincita'].disabled = true;
      el['btn-rivincita'].textContent = '🔁 RIVINCITA RIFIUTATA';
      banner({
        icon: '👋', title: 'RIVINCITA RIFIUTATA',
        subtitle: rifiutanti.join(', ') + ' ha rifiutato la rivincita',
        buttons: [{ id: 'home', label: '🏠 HOME', kind: 'btn-ghost', fn: () => { hideBanner(); } }]
      });
      return;
    }
    if (accettanti.length >= N - 1) {
      if (!G.redirected) {
        G.redirected = true;
        el['btn-rivincita'].disabled = true;
        el['btn-rivincita'].textContent = '🔄 REINDIRIZZAMENTO…';
        banner({
          icon: '✅', title: 'RIVINCITA ACCETTATA DA TUTTI!',
          subtitle: 'Ripartenza imminente…', spinner: true, sticky: true
        });
        setTimeout(() => { window.location.href = 'index.html?matchId=' + id; }, 1600);
      }
      return;
    }
    if (s.prossimaPartitaCreataDa === G.me) {
      el['btn-rivincita'].disabled = true;
      el['btn-rivincita'].textContent = '⏳ RIVINCITA IN ATTESA…';
      banner({
        icon: '🔁', title: 'RIVINCITA CREATA',
        subtitle: 'In attesa di ' + s.partecipanti.filter((p) => p !== G.me && accettanti.indexOf(p) === -1).join(', ') + '…',
        sticky: true,
        buttons: []
      });
      return;
    }
    if (accettanti.indexOf(G.me) !== -1) {
      el['btn-rivincita'].disabled = true;
      el['btn-rivincita'].textContent = '⏳ HAI ACCETTATO…';
      banner({
        icon: '✅', title: 'RIVINCITA ACCETTATA',
        subtitle: 'In attesa che tutti accettino…', sticky: true, buttons: []
      });
      return;
    }
    banner({
      icon: '🔁', title: 'RIVINCITA PROPOSTA',
      subtitle: s.prossimaPartitaCreataDa + ' vuole rifare la partita',
      sticky: true,
      buttons: [
        { id: 'acc', label: '✅ ACCETTA', kind: 'btn-fire', fn: accettaRivincita },
        { id: 'rif', label: '❌ RIFIUTA', kind: 'btn-ghost', fn: rifiutaRivincita }
      ]
    });
  }

  /* ---------------- RENDER PRINCIPALE ---------------- */
  function render(s) {
    G.state = s;
    if (!s) return;

    // Schermate
    el.app.classList.remove('hidden');
    const showLobby = s.stato === 'attesa';
    const showGame = s.stato !== 'attesa';
    el['screen-lobby'].classList.toggle('hidden', !showLobby);
    el['screen-game'].classList.toggle('hidden', !showGame);
    el['overlay-recap'].classList.toggle('hidden', !(showGame && s.roundData && s.roundData.fase === 'recap'));
    el['overlay-fine'].classList.toggle('hidden', s.stato !== 'conclusa');
    el['btn-suono'].textContent = G.soundOn ? '🔊' : '🔇';

    if (showLobby) {
      hideBanner();
      renderLobby(s);
      return;
    }

    if (s.round) {
      el['round-badge'].classList.remove('hidden');
      el['round-badge'].textContent = 'TURNO ' + s.round + '/' + s.opzioni.turni;
    }

    // Cambio round: reset animazioni/feedback
    if (s.round !== G.prevRound && s.round > 0) {
      G.prevRound = s.round;
      G.prevTurn = null;
      G.prevUltimoTs = 0;
      G.lastWholeSec = -1;
      el.feedback.className = 'feedback';
      el.feedback.textContent = '';
      el['word-input'].value = '';
      if (s.roundData && s.roundData.fase === 'giochi') {
        toast('🔤 Nuove lettere per il turno ' + s.round + '!');
      }
    }

    renderLetters(s);
    renderPlayersGame(s);
    renderFeed(s);
    renderScoreboard(s);

    if (s.roundData && s.roundData.fase === 'recap') {
      renderRecap(s);
    }
    if (s.stato === 'conclusa') {
      renderFine(s);
    }

    // Eventi di turno / ultima azione
    if (s.roundData && s.roundData.fase === 'giochi' && s.turno) {
      if (s.turno.giocatore !== G.prevTurn) {
        const wasMyTurn = G.prevTurn === G.me;
        G.prevTurn = s.turno.giocatore;
        if (!wasMyTurn && s.turno.giocatore === G.me && G.prevRound === s.round) {
          SFX.turn();
          vibrate([40, 40, 40]);
          el['turn-banner'].classList.remove('flash');
          void el['turn-banner'].offsetWidth;
          el['turn-banner'].classList.add('flash');
        }
      }
      const ultimo = s.turno.ultimo;
      if (ultimo && ultimo.ts > G.prevUltimoTs) {
        G.prevUltimoTs = ultimo.ts;
        onUltimo(ultimo, s);
      }
    }
  }

  function onUltimo(ultimo, s) {
    if (ultimo.ok) {
      showFeedback('ok', '✅ ' + ultimo.w + '  +' + ultimo.p + ' pt — passa a ' + nextPlayer(s, ultimo.nome).toUpperCase());
      SFX.ok();
      el['word-input'].value = '';
    } else if (ultimo.patata) {
      showFeedback('err', '💥 SCOTTATURA: ' + ultimo.nome.toUpperCase() + ' −' + PATATA_PENALTY + ' pt');
      SFX.patata();
      vibrate([120, 60, 120]);
    } else if (ultimo.nome === G.me) {
      showFeedback('err', '❌ ' + ultimo.w + ' — parola non valida (−5 s)');
      SFX.err();
    }
  }

  function showFeedback(kind, msg) {
    el.feedback.className = 'feedback ' + kind;
    el.feedback.textContent = msg;
    clearTimeout(G.lastFeedbackTimer);
    G.lastFeedbackTimer = setTimeout(() => {
      el.feedback.className = 'feedback';
      el.feedback.textContent = '';
    }, 3200);
  }

  /* ---------------- TIMER RING (rAF) ---------------- */
  const RING_C = 2 * Math.PI * 88;
  function ringFrame() {
    const s = G.state;
    const attivo = s && s.stato === 'in_corso' && s.roundData && s.roundData.fase === 'giochi' && s.turno;
    if (attivo) {
      const now = Date.now();
      const remaining = Math.max(0, s.turno.deadline - now);
      const ref = s.turno.riferimento || s.turno.inizio || s.turno.deadline - 1;
      const span = Math.max(1, s.turno.deadline - ref);
      const frac = Math.min(1, Math.max(0, remaining / span));
      el['ring-fill'].style.strokeDashoffset = String(RING_C * (1 - frac));
      const sec = Math.ceil(remaining / 1000);
      const danger = sec <= 10;
      el['ring-fill'].classList.toggle('danger', danger);
      el['timer-sec'].classList.toggle('danger', danger);
      ringWrap.classList.toggle('urgent', danger && remaining > 0);
      if (sec !== G.lastWholeSec) {
        G.lastWholeSec = sec;
        el['timer-sec'].textContent = String(sec);
        if (danger && sec > 0) SFX.tick();
      }
    } else if (s && s.stato === 'in_corso') {
      el['timer-sec'].textContent = '—';
      el['ring-fill'].style.strokeDashoffset = '0';
    }
    requestAnimationFrame(ringFrame);
  }

  /* ---------------- INVIATA PAROLA ---------------- */
  function msgForErr(v) {
    if (v.err === 'SHORT') return '❌ Minimo ' + MIN_WORD_LENGTH + ' lettere (−5 s)';
    if (v.err === 'MISSING') return '❌ Manca: ' + v.missing.join(' + ') + ' (−5 s)';
    return '❌ Non è nel dizionario (−5 s)';
  }
  async function inviaParola() {
    const s = G.state;
    if (!s) return;
    if (s.stato !== 'in_corso' || !s.roundData || s.roundData.fase !== 'giochi') return;
    if (!s.turno || s.turno.giocatore !== G.me) {
      toast('Non è il tuo turno ⏳');
      return;
    }
    const raw = el['word-input'].value;
    const ctx = ctxFor({ word: raw });
    const v = validateWord(raw, ctx.letters, ctx.used, ctx.dict);
    if (!v.ok) {
      if (v.err === 'EMPTY') { toast('Scrivi una parola…'); return; }
      if (v.err === 'USED') {
        showFeedback('err', '❌ Parola già usata in questa partita');
        SFX.err();
        return;
      }
      showFeedback('err', msgForErr(v));
      SFX.err();
      vibrate([60]);
      const r = await G.backend.transact((st) => mutWrongWord(st, ctx));
      if (r && r.error && r.error.code === 'NOT_YOUR_TURN') toast('È già passato il turno!');
      return;
    }
    el['word-input'].value = '';
    updateInputHint();
    const r = await G.backend.transact((st) => mutSubmitWord(st, ctx));
    if (!r) return;
    if (r.error) {
      if (r.error.code === 'NOT_YOUR_TURN') { toast('È già passato il turno!'); showFeedback('err', '⏳ Il turno è già passato'); }
      else if (r.error.code === 'NOT_PLAYING') { toast('Il tempo è scaduto! 🥔'); }
      else { toast('Ops, riprova…', 'err'); }
      return;
    }
    if (r.failed) {
      toast('Connessione instabile, riprova', 'err');
      return;
    }
    SFX.ok();
  }

  /* ---------------- CONFERMA RECAP ---------------- */
  async function confermaTurno() {
    const r = await G.backend.transact(mutConferma);
    if (r && r.ok) {
      SFX.confirm();
      toast('✔ Turno confermato');
    }
  }

  /* ---------------- DEBUG/HOOK (usato anche dai test E2E) ---------------- */
  global.__PATATA = {
    get state() { return G.state; },
    get dict() { return G.dict; },
    lettersFor,
    validate: (w) => validateWord(w, lettersFor(G.state), usedWords(G.state), G.dict)
  };

  /* ---------------- BOOT ---------------- */
  function startSolo() {
    G.backend.transact(mutStart);
  }

  async function boot() {
    // Suono toggle
    el['btn-suono'].addEventListener('click', () => {
      G.soundOn = !G.soundOn;
      localStorage.setItem('patata_suono', G.soundOn ? 'on' : 'off');
      el['btn-suono'].textContent = G.soundOn ? '🔊' : '🔇';
      if (G.soundOn) SFX.confirm();
    });
    // Input
    el['word-input'].addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); inviaParola(); }
    });
    el['word-input'].addEventListener('input', updateInputHint);
    el['btn-invia'].addEventListener('click', inviaParola);
    el['btn-conferma'].addEventListener('click', confermaTurno);
    el['btn-start-solo'].addEventListener('click', startSolo);
    el['btn-rivincita'].addEventListener('click', creaRivincita);

    // Multiplayer: login obbligatorio
    if (!G.solo && !G.me) {
      alert('Effettua il login per giocare in multiplayer.');
      window.location.href = '../../index.html';
      return;
    }

    // Firebase: modulo compat + istanza (servono anche per gli override del dizionario)
    if (typeof firebase !== 'undefined' && window.FAW_REQUIRE_FIREBASE_CONFIG) {
      try {
        const cfg = window.FAW_REQUIRE_FIREBASE_CONFIG();
        if (cfg && !G.db) {
          firebase.initializeApp(cfg);
          G.fs = firebase.firestore;
          G.db = G.fs();
        }
      } catch (e) {
        console.warn('[Patata] init Firebase non riuscito:', e.message);
      }
    }

    try {
      await loadDictionary();
    } catch (e) {
      console.error('[Patata] errore dizionario:', e);
      setLoadStatus('❌ Errore caricamento dizionario: ' + e.message, true);
      el['load-count'].className = 'load-count error';
      el['load-count'].innerHTML =
        '<button class="btn btn-fire load-retry" onclick="location.reload()">🔄 RIPROVA</button>';
      return;
    }

    el['screen-loading'].classList.add('hidden');

    if (G.solo) {
      // Allenamento: opzioni personalizzabili via URL (?tempo=60&turni=3&lettere=3)
      G.backend = new SoloBackend(G.me, {
        tempo: Math.max(5, parseInt(urlParams.get('tempo'), 10) || 60),
        turni: Math.min(10, Math.max(1, parseInt(urlParams.get('turni'), 10) || 3)),
        lettere: Math.min(4, Math.max(2, parseInt(urlParams.get('lettere'), 10) || 3)),
        mode: 'classic',
        seed: 'SOLO' + Math.random().toString(36).slice(2, 9).toUpperCase()
      });
    } else {
      if (!G.db || !G.fs) {
        setLoadStatus('❌ Firebase non disponibile: impossibile giocare in multiplayer', true);
        el['screen-loading'].classList.remove('hidden');
        return;
      }
      G.backend = new FirebaseBackend(G.fs, G.matchId, G.me);
      G.backend.onDead = () => {
        alert('Partita rimossa.');
        window.location.href = '../../index.html';
      };
      G.backend.onError = (e) => {
        toast('Errore di connessione a Firebase', 'err');
        console.error(e);
      };
      G.backend.start();
    }

    G.backend.subscribe(render);
    setInterval(logicaTick, TICK_MS);
    requestAnimationFrame(ringFrame);

    if (G.solo) {
      // L'allenamento parte al click di INIZIA (stato 'attesa' con 1 pronto)
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
