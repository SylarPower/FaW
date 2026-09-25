/* =========================================================
   PATATA BOLLENTE — Focus at Work
   Il gioco delle parole a staffetta.

   Regole:
   - Ogni turno (round) estrae N lettere casuali (sempre "risolvibili":
     il dizionario deve contenere abbastanza parole che le includono).
   - Tre modalità:
     * CLASSICA  → lettere anche staccate (ordine sparso)
     * SEQUENZA  → lettere consecutive (sottostringa)
     * MIX       → 50% CLASSICA e 50% SEQUENZA, alternanza deterministica
                   round per round (round dispari = sparso, pari = sequenza)
   - Chi sta giocando deve scrivere una parola (min 4 lettere, presente
     nel dizionario Ruzzle) che rispetti la regola del turno.
   - Punti = lunghezza della parola: 4 lettere = 4 punti, 8 = 8, ecc.
   - Parola corretta  → +secondi al timer (bonus a scalare: +5 nel primo minuto
     di turno, poi +4, +3, +2 e infine +1) e la patata passa al prossimo.
     Il timer ha un tetto: non supera mai il tempo configurato (es. 60s).
   - Si scrive SOLO al proprio turno: fuori turno la casella è disabilitata.
   - Parola sbagliata → feedback di errore, tempo invariato (nessuna penalità).
   - Tempo a zero     → la chiusura è IMMEDIATA (nessuna grazia): chi tiene la
     patata "si scotta" (−10 pt) e si apre il recap: tutte le parole del
     turno, tutti confermano e si passa al turno successivo (nuove lettere).
   - PAUSA per tutti   → chiunque può fermare il cronometro (⏸): durante la
     pausa non si gioca, non scatta la scottatura e alla ripresa il tempo
     resta esattamente quello congelato.
   - RICHIESTA PAROLA  → chi ha la patata può proporre una parola nuova nel
     vocabolario (come in Ruzzle): il gioco si mette in pausa per TUTTI finché
     tutti i giocatori non hanno votato (👍 inserisci / 👎 non inserire).
     A votazione conclusa (maggioranza di "sì") la parola entra nel dizionario
     condiviso (config/dizionario → extra) e la pausa termina.
   - POWER-UP 🚀 "PASSA LA PATATA" → a ogni turno (round) UN giocatore
     estratto in modo deterministico dal seed (come le lettere, zero scritture
     extra) riceve il power-up: al proprio turno, invece di scrivere, può
     mandare la patata al giocatore che vuoi — 0 punti, 1 solo utilizzo per
     round, mostrato da un badge 🚀 sul chip.
   - A fine partita  → classifica finale.

   Backend (Zero runTransaction):
   - Multiplayer: Firebase Firestore, modello Ruzzle (onSnapshot per
     lo stato + blind update()/applyAtomic() per scrivere). Nessuna
     lettura nelle mutazioni di gioco, zero BatchGetDocuments.
   - Allenamento: apri la pagina senza ?matchId → backend locale.

   Dizionario: lo stesso di Ruzzle — ../../dizionario.txt più gli
   override condivisi in Firestore (config/dizionario) con cache locale.
   ========================================================= */
(function (global) {
  'use strict';

  /* ---------------- COSTANTI ---------------- */
  const MIN_WORD_LENGTH = 4;
  const TIME_BONUS = 5000;        // +5 s per parola corretta (bonus pieno, primo minuto di turno)
  /* Il bonus cala di un secondo ogni minuto di TURNO: 0-60s → +5, 60-120s → +4,
     120-180s → +3, 180-240s → +2, oltre → +1. Si azzera a ogni nuovo turno
     (ogni turno riparte dal bonus pieno). */
  const TIME_BONUS_STEPS = [5, 4, 3, 2, 1];
  const TIME_BONUS_STEP_MS = 60000;
  const WRONG_PENALTY = 0;        // La parola sbagliata non toglie tempo
  const PATATA_PENALTY = 10;      // −10 pt per la scottatura
  /* Nessuna grazia: al raggiungimento dello zero la scottatura scatta SUBITO
     (il client la invoca anche dal frame rAF, senza aspettare il tick). */
  const TIMEOUT_GRACE = 0;
  const LETTER_THRESHOLD = 12;    // min parole nel dizionario per una combo valida
  const TICK_MS = 1000;           // tick logico (il timer visivo gira a parte, via rAF)
  const STUCK_FALLBACK_MS = 12000; // se chi "guida" l'azione non risponde, subentrano gli altri
  const RATE_LIMIT_BACKOFF_MIN = 4000;   // primo backoff dopo un 429
  const RATE_LIMIT_BACKOFF_MAX = 60000;  // tetto del backoff anti-429
  const ACTION_RETRY_MIN = 2000;         // primo retry di un'azione fallita
  const ACTION_RETRY_MAX = 30000;        // tetto dei retry: mai martellare Firestore
  const DICT_CACHE_KEY = 'faw_patata_dict_override';
  const DICT_CACHE_TTL = 24 * 60 * 60 * 1000; // TTL cache dizionario: 24 ore

  // Frequenza (approssimativa) delle lettere italiane, senza Q (→ QU)
  const LETTER_WEIGHTS = {
    A: 8, E: 12, I: 9, O: 10, U: 3, L: 7, R: 6, N: 5, T: 5, S: 4, C: 4,
    M: 4, D: 3, P: 3, B: 2, G: 2, F: 1, V: 1, Z: 1, H: 1
  };

  /**
   * Secondi di bonus per una parola corretta, in base a quanto è durato il
   * turno: 5 nel primo minuto, poi 4, 3, 2 e infine 1 (mai sotto 1).
   * Deterministico: stesso `now` → stesso bonus su ogni client.
   */
  function bonusPerParola(state, now) {
    /* `inizio` può valere 0 (clock di test che parte da zero): il controllo
       esplicito evita di scambiarlo per "nessun inizio". */
    const t = state && state.turno ? Number(state.turno.inizio) : NaN;
    const inizio = isFinite(t) ? t : now;
    const minuti = Math.floor(Math.max(0, now - inizio) / TIME_BONUS_STEP_MS);
    return TIME_BONUS_STEPS[Math.min(TIME_BONUS_STEPS.length - 1, minuti)];
  }

  /**
   * Punti = lunghezza EFFETTIVA della parola: 4 lettere = 4 punti,
   * 5 = 5, …, 8 = 8, ecc. (minimo 4: sotto la soglia la parola non vale).
   */
  function pointsFor(len) {
    const n = Math.floor(Number(len));
    if (!isFinite(n) || n <= 0) return MIN_WORD_LENGTH;
    return Math.max(MIN_WORD_LENGTH, n);
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
      this.words = Array.isArray(words) ? words : Array.from(words || []);
      this.n = this.words.length;
      this.wordsPer = Math.ceil(this.n / 32) || 1;
      this.bits = {};
      for (const l of Object.keys(LETTER_WEIGHTS)) {
        this.bits[l] = new Uint32Array(this.wordsPer);
      }
      const seen = new Int32Array(26);
      for (let i = 0; i < this.n; i++) {
        const w = this.words[i];
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
    /** Numero di parole che contengono tutte le lettere in `letters` (anche staccate). */
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
    /** Numero di parole che contengono la sequenza consecutiva `seq`. */
    countSequence(seq) {
      if (!this.words || !seq) return 0;
      const s = normalizeWord(seq);
      if (!s) return 0;
      let c = 0;
      for (let i = 0; i < this.words.length; i++) {
        if (this.words[i].indexOf(s) !== -1) c++;
      }
      return c;
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
   * Determina la regola del turno in modo deterministico:
   * - 'classic': lettere anche staccate (ordine sparso)
   * - 'sequenza': lettere consecutive (sottostringa)
   * - 'mix': 50% classic / 50% sequenza con ALTERNANZA GARANTITA round per
   *   round (dispari = sparso, pari = sequenza): lo stesso mix su ogni client
   *   e, su più turni, esattamente metà e metà (non un lancio casuale che
   *   potrebbe produrre sequenze strozzate).
   */
  function ruleFor(stateOrMode, round, seed) {
    let mode = 'classic';
    let rnd = 1;
    let s = 'SEED';
    if (typeof stateOrMode === 'object' && stateOrMode !== null) {
      const op = stateOrMode.opzioni || {};
      mode = op.mode || 'classic';
      rnd = stateOrMode.round || 1;
      s = op.seed || 'SEED';
    } else if (typeof stateOrMode === 'string') {
      mode = stateOrMode;
      rnd = round || 1;
      s = seed || 'SEED';
    }
    if (mode === 'sequenza') return 'sequenza';
    if (mode === 'mix') {
      return (rnd % 2 === 1) ? 'classic' : 'sequenza';
    }
    return 'classic';
  }

  /**
   * Power-up 🚀 "Passa la patata": a ogni round UN solo giocatore, estratto
   * DETERMINISTICAMENTE da seed + round (stessa identica estrazione su tutti
   * i client, zero scritture extra — stesso schema delle lettere).
   * Restituisce il nome del fortunato oppure null (partita in solo o senza
   * partecipanti): da solo non c'è nessuno a cui passarla.
   */
  function powerPassFor(state) {
    const ps = (state && state.partecipanti) || [];
    if (ps.length < 2) return null;
    const seed = (state.opzioni && state.opzioni.seed) || 'SEED';
    const rnd = state.round || 1;
    const rand = sfc32(...cyrb128(seed + '::patata-power::' + rnd));
    const idx = Math.min(ps.length - 1, Math.floor(rand() * ps.length));
    return ps[idx];
  }

  /**
   * Estrae DETERMINISTICAMENTE le lettere di un round (stesso seed + round
   * → stessa combinazione su tutti i client, senza scritture extra).
   * In modalità 'classic': estrae lettere distinte con countFor >= LETTER_THRESHOLD.
   * In modalità 'sequenza': estrae una sequenza consecutiva con countSequence >= LETTER_THRESHOLD.
   */
  function pickLetters(seed, round, nLetters, index, rule = 'classic') {
    const isSeq = rule === 'sequenza';
    if (isSeq) {
      const rand = sfc32(...cyrb128(seed + '::patata-seq::' + round));
      let best = null;
      let bestCount = -1;
      if (index && index.words && index.words.length > 0) {
        const words = index.words;
        for (let attempt = 0; attempt < 120; attempt++) {
          const wIdx = Math.floor(rand() * words.length);
          const w = words[wIdx];
          if (w.length < nLetters) continue;
          const maxStart = w.length - nLetters;
          const start = Math.floor(rand() * (maxStart + 1));
          const cand = w.slice(start, start + nLetters);
          const count = index.countSequence(cand);
          if (count > bestCount) {
            bestCount = count;
            best = cand.split('');
          }
          if (count >= LETTER_THRESHOLD) return cand.split('');
        }
      }
      if (best && best.length === nLetters) return best;
      const candLetters = [];
      for (let i = 0; i < nLetters; i++) candLetters.push(weightedLetter(rand));
      return candLetters;
    }

    // Modalità classica (anche staccate)
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

  /**
   * Compatibilità snapshot Firestore:
   * - SDK compat (v8 API, usato da hub/patata/ruzzle/...): `snap.exists` è una
   *   PROPRIETÀ booleana → `snap.exists()` lancia "snap.exists is not a function".
   * - SDK modulare (v9+) e mock dei test: `snap.exists()` è un METODO.
   * Questo helper supporta entrambi i casi.
   */
  function docExists(snap) {
    if (!snap) return false;
    if (typeof snap.exists === 'function') {
      try {
        return !!snap.exists();
      } catch (e) {
        return false;
      }
    }
    return !!snap.exists;
  }

  /**
   * Rileva gli errori di rate limit / quota Firestore (HTTP 429).
   * L'SDK compat 9.x li riporta a volte come code "unknown" con messaggio
   * "Server responded with status 429": controlliamo anche il messaggio.
   */
  function isRateLimitError(e) {
    if (!e) return false;
    const code = String(e.code || '');
    const msg = String(e.message || '');
    if (code === 'resource-exhausted') return true;
    return /429|too many requests|quota exceeded|rate ?limit/i.test(msg);
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

  /* ---- Pausa / votazione vocabolario ---- */
  /**
   * Aggiunge allo update lo sblocco del clock dopo una pausa: deadline,
   * riferimento e inizio vengono spostati in avanti della durata della pausa,
   * così né il cronometro né gli scalini del bonus conteggiano il tempo fermo.
   */
  function resumeClockUpdate(state, ctx, up) {
    if (!state.turno) return up;
    const pausaIniziata = Number(state.turno.pausaIniziata);
    const shift = isFinite(pausaIniziata) ? Math.max(0, ctx.now - pausaIniziata) : 0;
    if (shift > 0) {
      up['turno.deadline'] = Number(state.turno.deadline || ctx.now) + shift;
      if (state.turno.riferimento != null) up['turno.riferimento'] = Number(state.turno.riferimento) + shift;
      if (state.turno.inizio != null) up['turno.inizio'] = Number(state.turno.inizio) + shift;
    }
    up['turno.pausaIniziata'] = { __op: 'delete' };
    return up;
  }
  /** Pausa → riprende; ripresa → congela il clock. Solo nella fase di gioco. */
  function mutPausa(state, ctx) {
    if (state.stato !== 'in_corso' || !state.roundData || !state.turno) return null;
    if (state.roundData.fase !== 'giochi') return null;
    if (state.richiesta) return null;   // voto sul vocabolario in corso: la pausa la gestisce quello
    if (state.pausa) {
      const up = {
        pausa: false,
        pausaDa: { __op: 'delete' },
        pausaTs: { __op: 'delete' }
      };
      return resumeClockUpdate(state, ctx, up);
    }
    // Non si ferma un cronometro già scaduto: la scottatura ha la precedenza.
    if (!(ctx.now < state.turno.deadline)) return null;
    return {
      pausa: true,
      pausaDa: ctx.me,
      pausaTs: ctx.now,
      'turno.pausaIniziata': ctx.now
    };
  }

  /** Propone una parola mancante nel vocabolario: pausa per tutti + voto. */
  function mutRichiediParola(state, ctx) {
    if (state.stato !== 'in_corso' || !state.roundData || !state.turno) return { __error: { code: 'NOT_PLAYING' } };
    if (state.roundData.fase !== 'giochi') return { __error: { code: 'NOT_PLAYING' } };
    if (state.turno.giocatore !== ctx.me) return { __error: { code: 'NOT_YOUR_TURN' } };
    if (state.pausa || state.richiesta) return null;
    if (!(ctx.now < state.turno.deadline)) return null;
    if (state.partecipanti.length < 2) return { __error: { code: 'ALONE' } };
    const w = normalizeWord(ctx.word);
    if (w.length < MIN_WORD_LENGTH) return { __error: { code: 'INVALID', detail: 'SHORT' } };
    if (ctx.dict && ctx.dict.has(w)) return { __error: { code: 'ALREADY' } };
    if (ctx.used && ctx.used.has(w)) return { __error: { code: 'USED' } };
    return {
      pausa: true,
      pausaDa: ctx.me,
      pausaTs: ctx.now,
      'turno.pausaIniziata': ctx.now,
      'richiesta': { parola: w, da: ctx.me, ts: ctx.now, votiSi: [ctx.me], votiNo: [] },
      'ultimaRichiesta': { __op: 'delete' }
    };
  }

  /** Registra il voto (👍/👎). L'esito lo calcola mutRisolviRichiesta. */
  function mutVotoParola(state, ctx) {
    const rq = state.richiesta;
    if (state.stato !== 'in_corso' || !rq) return null;
    if (state.roundData && state.roundData.fase !== 'giochi') return null;
    if (state.partecipanti.indexOf(ctx.me) === -1) return null;
    const si = rq.votiSi || [], no = rq.votiNo || [];
    if (si.indexOf(ctx.me) !== -1 || no.indexOf(ctx.me) !== -1) return null;
    return ctx.votoSi
      ? { 'richiesta.votiSi': { __op: 'union', items: [ctx.me] } }
      : { 'richiesta.votiNo': { __op: 'union', items: [ctx.me] } };
  }

  /**
   * Chiude la votazione quando TUTTI hanno votato: maggioranza di "sì" →
   * la parola entra nel vocabolario (lato client referente), la pausa finisce
   * e il clock riparte da dove si era congelato.
   */
  function mutRisolviRichiesta(state, ctx) {
    const rq = state.richiesta;
    if (state.stato !== 'in_corso' || !rq) return null;
    if (state.roundData && state.roundData.fase !== 'giochi') return null;
    const si = rq.votiSi || [], no = rq.votiNo || [];
    if (si.length + no.length < state.partecipanti.length) return null;
    const inserita = si.length > no.length;
    const up = {
      pausa: false,
      pausaDa: { __op: 'delete' },
      pausaTs: { __op: 'delete' },
      'richiesta': { __op: 'delete' },
      'ultimaRichiesta': {
        parola: rq.parola, da: rq.da,
        esito: inserita ? 'inserita' : 'rifiutata',
        si: si.length, no: no.length, ts: ctx.now
      }
    };
    return resumeClockUpdate(state, ctx, up);
  }

  /** Il proponente può RITIRARE la propria proposta (sblocca tutti gli altri). */
  function mutRitiraRichiesta(state, ctx) {
    const rq = state.richiesta;
    if (state.stato !== 'in_corso' || !rq) return null;
    if (state.roundData && state.roundData.fase !== 'giochi') return null;
    if (rq.da !== ctx.me) return null;
    const si = rq.votiSi || [], no = rq.votiNo || [];
    const up = {
      pausa: false,
      pausaDa: { __op: 'delete' },
      pausaTs: { __op: 'delete' },
      'richiesta': { __op: 'delete' },
      'ultimaRichiesta': {
        parola: rq.parola, da: rq.da, esito: 'annullata',
        si: si.length, no: no.length, ts: ctx.now
      }
    };
    return resumeClockUpdate(state, ctx, up);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function highlightWord(word, letters, rule = 'classic') {
    if (!word) return '';
    const norm = normalizeWord(word);
    if (rule === 'sequenza') {
      const seq = Array.isArray(letters) ? letters.join('') : (letters || '');
      const idx = norm.indexOf(seq);
      if (idx !== -1) {
        return esc(norm.slice(0, idx)) + '<mark>' + esc(norm.slice(idx, idx + seq.length)) + '</mark>' + esc(norm.slice(idx + seq.length));
      }
    }
    const marks = new Array(norm.length).fill(false);
    (Array.isArray(letters) ? letters : [letters]).forEach((l) => {
      const i = norm.indexOf(l);
      if (i >= 0) marks[i] = true;
    });
    let html = '';
    let inMark = false;
    for (let i = 0; i < norm.length; i++) {
      if (marks[i]) {
        if (!inMark) { html += '<mark>'; inMark = true; }
        html += esc(norm[i]);
      } else {
        if (inMark) { html += '</mark>'; inMark = false; }
        html += esc(norm[i]);
      }
    }
    if (inMark) html += '</mark>';
    return html;
  }

  /* ---------------- VALIDAZIONE PAROLA (pura) ---------------- */
  function validateWord(raw, letters, used, dict, rule = 'classic') {
    const w = normalizeWord(raw);
    if (w.length === 0) return { ok: false, err: 'EMPTY' };
    if (w.length < MIN_WORD_LENGTH) return { ok: false, err: 'SHORT' };
    if (rule === 'sequenza') {
      const seq = Array.isArray(letters) ? letters.join('') : (letters || '');
      if (w.indexOf(seq) === -1) return { ok: false, err: 'NOT_SEQUENCE', seq };
    } else {
      const missing = letters.filter((l) => w.indexOf(l) === -1);
      if (missing.length) return { ok: false, err: 'MISSING', missing };
    }
    if (used && used.has(w)) return { ok: false, err: 'USED' };
    if (dict && !dict.has(w)) return { ok: false, err: 'NOT_FOUND' };
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
      confermaTurno: [],
      pausa: false
    };
  }

  function mutSubmitWord(state, ctx) {
    if (state.stato !== 'in_corso' || !state.roundData || !state.turno) return null;
    if (state.roundData.fase !== 'giochi') return { __error: { code: 'NOT_PLAYING' } };
    if (state.pausa || state.richiesta) return { __error: { code: 'PAUSED' } };
    if (state.turno.giocatore !== ctx.me) return { __error: { code: 'NOT_YOUR_TURN' } };
    const rule = ctx.rule || ruleFor(state);
    const v = validateWord(ctx.word, ctx.letters, ctx.used, ctx.dict, rule);
    if (!v.ok) return { __error: { code: 'INVALID', detail: v.err } };
    const next = nextPlayer(state, ctx.me);
    /* Bonus del turno (cala col passare dei minuti) e TETTO al tempo
       configurato: il conto alla rovescia non può mai superare, per esempio,
       i 60 secondi. */
    const bonusMs = bonusPerParola(state, ctx.now) * 1000;
    const tetto = ctx.now + state.opzioni.tempo * 1000;
    const deadline = Math.min(Math.max(state.turno.deadline, ctx.now) + bonusMs, tetto);
    return {
      'turno.deadline': deadline,
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
    if (state.pausa || state.richiesta) return null;
    if (state.turno.giocatore !== ctx.me) return { __error: { code: 'NOT_YOUR_TURN' } };
    const ultimo = state.turno.ultimo;
    if (ultimo && ultimo.nome === ctx.me && ctx.now - ultimo.ts < 1000) return null;
    const w = normalizeWord(ctx.word);
    if (!w) return null;
    return {
      // Parola sbagliata: tempo invariato (nessuna penalità in secondi)
      'turno.riferimento': ctx.now,
      'turno.ultimo': { nome: ctx.me, w, ok: false, ts: ctx.now }
    };
  }

  function mutTimeout(state, ctx) {
    if (state.stato !== 'in_corso' || !state.roundData || !state.turno) return null;
    if (state.roundData.fase !== 'giochi') return null;
    if (state.pausa || state.richiesta) return null;  // clock congelato: niente scottatura
    /* Al raggiungimento dello zero la scottatura scatta SUBITO: nessuna
       tolleranza (TIMEOUT_GRACE = 0). */
    if (!(ctx.now >= state.turno.deadline)) return null;
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

  /**
   * POWER-UP 🚀 "Passa la patata": al proprio turno, il detentore del
   * power-up del round può passare la patata a chiunque (0 punti, nessun
   * secondo aggiunto, 1 solo utilizzo per round). La rotazione successiva
   * riparte dalla posizione del ricevente (nextPlayer è già basato su indici).
   */
  function mutPassaPatata(state, ctx) {
    if (state.stato !== 'in_corso' || !state.roundData || !state.turno) return { __error: { code: 'NOT_PLAYING' } };
    if (state.roundData.fase !== 'giochi') return { __error: { code: 'NOT_PLAYING' } };
    if (state.pausa || state.richiesta) return { __error: { code: 'PAUSED' } };
    if (state.turno.giocatore !== ctx.me) return { __error: { code: 'NOT_YOUR_TURN' } };
    if (powerPassFor(state) !== ctx.me) return { __error: { code: 'NO_POWER' } };
    if (state.roundData.powerPass) return { __error: { code: 'USED' } };
    const target = ctx.target;
    if (!target || target === ctx.me || state.partecipanti.indexOf(target) === -1) {
      return { __error: { code: 'BAD_TARGET' } };
    }
    return {
      // Nessuna modifica al clock: il passaggio non aggiunge (né toglie) tempo.
      'turno.giocatore': target,
      'turno.ultimo': { nome: ctx.me, pass: true, target, ok: true, ts: ctx.now },
      'roundData.powerPass': { da: ctx.me, target, ts: ctx.now }
    };
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
    if (state.round >= state.opzioni.turni) {
      return {
        stato: 'conclusa',
        pausa: false,
        pausaDa: { __op: 'delete' },
        pausaTs: { __op: 'delete' },
        richiesta: { __op: 'delete' }
      };
    }
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
      confermaTurno: [],
      pausa: false,
      richiesta: { __op: 'delete' }
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
      pausa: !!d.pausa,
      pausaDa: d.pausaDa || null,
      pausaTs: d.pausaTs || 0,
      richiesta: d.richiesta || null,
      ultimaRichiesta: d.ultimaRichiesta || null,
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
    applyAtomic(mutator, extraCtx = {}) {
      const up = mutator(this.state, this._ctx(extraCtx));
      if (!up) return Promise.resolve({ aborted: true });
      if (up.__error) return Promise.resolve({ aborted: true, error: up.__error });
      applyPartial(this.state, up);
      this._emit();
      return Promise.resolve({ ok: true });
    }
    transact(mutator, extraCtx) { return this.applyAtomic(mutator, extraCtx); }
    stop() {}
  }

  /* ---------------- BACKEND FIREBASE (multiplayer — Zero runTransaction) ---------------- */
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
      this.onError = null;
      // Backoff anti-429: quando Firestore risponde "too many requests"
      // (quota giornaliera o traffico eccessivo) sospendiamo le azioni
      // automatiche e rallentiamo progressivamente i tentativi.
      this.rateLimitedUntil = 0;
      this.rateLimitBackoff = RATE_LIMIT_BACKOFF_MIN;
      this.rateLimitEpisode = false;
      this.onRateLimit = null; // callback UI (una volta per "episodio")
      this.onRecover = null;   // callback UI quando la connessione torna sana
    }
    isRateLimited() {
      return Date.now() < this.rateLimitedUntil;
    }
    start() {
      this.unsub = this.ref.onSnapshot(
        (snap) => {
          if (!docExists(snap)) {
            if (this.onDead) this.onDead();
            return;
          }
          this._rateLimitOk();
          this.state = normState(snap.data());
          this._subs.forEach((cb) => cb(this.state));
        },
        (err) => {
          if (isRateLimitError(err)) {
            const now = Date.now();
            this.rateLimitedUntil = now + this.rateLimitBackoff;
            this.rateLimitBackoff = Math.min(this.rateLimitBackoff * 2, RATE_LIMIT_BACKOFF_MAX);
            if (!this.rateLimitEpisode) {
              this.rateLimitEpisode = true;
              console.warn('[Patata] Firestore listener limitato (429): backoff attivo');
              if (this.onRateLimit) this.onRateLimit(this.rateLimitedUntil - now);
            }
          }
          console.error('[Patata] errore listener:', err);
          if (this.onError) this.onError(err);
        }
      );
      return this;
    }
    stop() {
      if (this.unsub) { this.unsub(); this.unsub = null; }
      this._subs.clear();
    }
    subscribe(cb) {
      this._subs.add(cb);
      if (this.state) cb(this.state);
      return () => this._subs.delete(cb);
    }
    _emit() {
      if (!this.state) return;
      this._subs.forEach((cb) => cb(this.state));
    }
    /* Scrittura atomica senza lettura (modello Ruzzle):
       riceve lo stato già in cache da onSnapshot e invia una scrittura cieca (update).
       Zero BatchGetDocuments = zero letture consumate. */
    applyAtomic(mutator, extraCtx = {}) {
      const state = this.state;
      if (!state) return Promise.resolve({ aborted: true });
      const ctx = Object.assign({ me: this.me, now: Date.now() }, extraCtx);
      const up = mutator(state, ctx);
      if (!up) return Promise.resolve({ aborted: true });
      if (up.__error) return Promise.resolve({ aborted: true, error: up.__error });
      applyPartial(state, up);   // UI aggiornata subito, senza attendere il server
      this._emit();
      return this.ref.update(toFirestoreUpdate(up, this.fs))
        .then(() => { this._rateLimitOk(); return { ok: true }; })
        .catch((e) => this._writeError(e, 'update'));
    }
    transact(mutator, extraCtx) {
      return this.applyAtomic(mutator, extraCtx);
    }
    _rateLimitOk() {
      this.rateLimitedUntil = 0;
      this.rateLimitBackoff = RATE_LIMIT_BACKOFF_MIN;
      if (this.rateLimitEpisode) {
        this.rateLimitEpisode = false;
        if (this.onRecover) this.onRecover();
      }
    }
    _writeError(e, cosa) {
      if (isRateLimitError(e)) {
        const now = Date.now();
        this.rateLimitedUntil = now + this.rateLimitBackoff;
        this.rateLimitBackoff = Math.min(this.rateLimitBackoff * 2, RATE_LIMIT_BACKOFF_MAX);
        // Un solo avviso per "episodio": i 429 arrivano a raffica e l'utente
        // non deve essere sommerso di toast.
        if (!this.rateLimitEpisode) {
          this.rateLimitEpisode = true;
          console.warn('[Patata] Firestore sta limitando le richieste (429): backoff attivo, riprovo automaticamente.');
          if (this.onRateLimit) this.onRateLimit(this.rateLimitedUntil - now);
        }
        return { failed: true, rateLimited: true, error: { code: 'RATE_LIMIT', message: e && e.message } };
      }
      console.error('[Patata] errore ' + cosa + ':', e);
      return { failed: true, error: { code: e && e.code ? e.code : 'NET', message: e && e.message } };
    }
    stop() {
      if (this.unsub) this.unsub();
    }
  }

  /* ---------------- CHI AGISCE (anti-storm) ----------------
     Le azioni di avanzamento (start, timeout, risoluzione contestazioni,
     prossimo turno) vengono tentate da UN solo client per volta:
     - il "referente" dell'azione (chi tiene la patata per il timeout,
       altrimenti il primo partecipante) agisce subito;
     - gli altri subentrano solo se la condizione resta bloccata troppo a
       lungo (referente offline), scaglionati per evitare picchi;
     - ogni tentativo fallito allunga l'attesa del singolo client
       (2s → 4s → 8s … fino a 30s): nessuno martella più Firestore. */
  class ActionGate {
    constructor(opts) {
      const o = opts || {};
      this.stuckMs = o.stuckMs || STUCK_FALLBACK_MS;
      this.minRetry = o.minRetry || ACTION_RETRY_MIN;
      this.maxRetry = o.maxRetry || ACTION_RETRY_MAX;
      this.book = {};
    }
    /** Posso provare questa azione ADESSO? (ruolo + backoff personale) */
    mayAct(key, info) {
      const now = info.now;
      const b = this.book[key] || (this.book[key] = { visti: 0, next: 0, retry: this.minRetry });
      if (!info.isReferent) {
        // Non sono il referente: subentro solo se la situazione resta ferma
        if (b.visti === 0) { b.visti = now; return false; }
        if (now - b.visti <= this.stuckMs + (info.staggerMs || 0)) return false;
      }
      if (now < b.next) return false;   // backoff dopo un tentativo fallito
      b.next = now + b.retry;           // prenotazione: un solo tentativo in volo
      return true;
    }
    ok(key) {
      const b = this.book[key];
      if (b) { b.retry = this.minRetry; b.visti = 0; }
    }
    /** Solo i fallimenti veri allungano l'attesa: un "aborted" significa che
        un altro client ha già fatto il lavoro, quindi non è un errore. */
    failed(key, res) {
      if (res && (res.ok || res.aborted)) return;
      const b = this.book[key] || (this.book[key] = { visti: 0, next: 0, retry: this.minRetry });
      b.retry = Math.min(b.retry * 2, this.maxRetry);
    }
    reset() { this.book = {}; }
  }


  /* ---------------- ESPOSIZIONE PER TEST ---------------- */
  const core = {
    MIN_WORD_LENGTH, TIME_BONUS, WRONG_PENALTY, PATATA_PENALTY, TIMEOUT_GRACE,
    LETTER_THRESHOLD, LETTER_WEIGHTS, TIME_BONUS_STEPS, TIME_BONUS_STEP_MS,
    bonusPerParola,
    cyrb128, sfc32, normalizeWord, LetterIndex, pickLetters, weightedLetter,
    pointsFor, applyPartial, setPath, roundOrderFor, nextPlayer, usedWords,
    findWordAuthor, flagThreshold, flagsByOthers, flagResolved, validateWord,
    highlightWord, ruleFor, resumeClockUpdate, powerPassFor,
    mutReady, mutStart, mutSubmitWord, mutWrongWord, mutTimeout, mutConferma,
    mutFlag, mutResolveFlag, mutNextRound, mutPausa, mutRichiediParola,
    mutVotoParola, mutRisolviRichiesta, mutRitiraRichiesta, mutPassaPatata,
    normState, SoloBackend, FirebaseBackend,
    toFirestoreUpdate, docExists, isRateLimitError, ActionGate,
    STUCK_FALLBACK_MS, ACTION_RETRY_MIN, ACTION_RETRY_MAX, TICK_MS,
    RATE_LIMIT_BACKOFF_MIN, RATE_LIMIT_BACKOFF_MAX
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
    letterCache: new Map(),
    busy: false,
    prevTurn: null,
    prevUltimoTs: 0,
    prevRound: 0,
    lastWholeSec: -1,
    lastBonus: -1,
    lastStepSec: -1,      // secondi mancanti all'ultimo scalino mostrati
    prevRichiestaTs: -1,  // ultimaRichiesta già processata (toast/dizionario)
    richiestaBooted: false, // primo render eseguito (niente toast di esiti vecchi)
    pickTarget: false,    // overlay di scelta bersaglio del power-up 🚀 aperto
    statsSaved: false,
    redirected: false,
    lastFeedbackTimer: null,
    rateLimited: false     // Firestore ha risposto 429: lo diciamo all'utente
  };

  /* ---------------- ELEMENTI DOM ---------------- */
  const el = {};
  ['screen-loading', 'load-status', 'load-count', 'app', 'round-badge', 'btn-pausa',
   'screen-lobby', 'cfg-tempo', 'cfg-turni', 'cfg-lettere', 'cfg-mode', 'lobby-players',
   'lobby-status', 'lobby-status-text', 'btn-start-solo', 'lobby-hint',
   'screen-game', 'letter-tiles', 'letters-rule-badge', 'letters-avail', 'ring-fill', 'timer-sec',
   'bonus-chip', 'bonus-val', 'bonus-fill', 'bonus-caption',
   'turn-banner', 'game-players', 'input-card', 'word-input', 'btn-invia', 'btn-richiedi', 'btn-power',
   'input-prep', 'input-hint', 'feedback', 'scoreboard', 'feed', 'feed-count',
   'overlay-recap', 'recap-round', 'recap-patata', 'recap-body',
   'conf-progress', 'btn-conferma',
   'overlay-pausa', 'pausa-emoji', 'pausa-title', 'pausa-sub', 'pausa-body',
   'overlay-target', 'target-body',
   'overlay-fine', 'fine-emoji', 'fine-title', 'fine-sub', 'podio', 'fine-stats',
   'btn-rivincita', 'banner', 'toast'
  ].forEach((id) => { el[id] = $(id); });
  const ringWrap = document.querySelector('.timer-wrap');

  /* ---------------- UTILITY UI ---------------- */
  const AVATAR_COLORS = ['#fed7aa', '#bae6fd', '#bbf7d0', '#fecdd3', '#ddd6fe', '#fde68a', '#99f6e0', '#fecaca'];
  function avatarColor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
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
        '<button class="btn ' + (b.kind || 'btn-ghost') + '" data-bid="' + b.id + '"' +
        (b.disabled ? ' disabled' : '') + (b.title ? ' title="' + esc(b.title) + '"' : '') + '>' + esc(b.label) + '</button>'
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

  /* Nessun audio in FaW: il feedback di gioco è solo visivo/tattile. */

  /**
   * Ora "di gioco": durante una pausa il tempo è congelato all'istante in cui
   * è partita (così né il cronometro né gli scalini del bonus avanzano).
   */
  function nowEff(s) {
    if (s && s.pausa && s.turno && isFinite(Number(s.turno.pausaIniziata))) {
      return Number(s.turno.pausaIniziata);
    }
    return Date.now();
  }
  /** La fase di gioco è attiva (non recap, non fine partita). */
  function inGiocoFase(s) {
    return !!(s && s.stato === 'in_corso' && s.roundData && s.roundData.fase === 'giochi' && s.turno);
  }

  /* ---------------- CONFETTI ---------------- */
  function confetti() {
    const colors = ['#ea580c', '#f59e0b', '#4f46e5', '#0ea5e9', '#16a34a', '#ec4899'];
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

  async function getSharedDictionaryOverrides(fb) {
    // 1. Cache condivisa (Ruzzle / NCC / Patata): niente lettura se è ancora valida
    if (window.FAW_READ_DICTIONARY_OVERRIDES) {
      const shared = window.FAW_READ_DICTIONARY_OVERRIDES();
      if (shared) return shared;
    }
    try {
      const cached = localStorage.getItem(DICT_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.ts && (Date.now() - parsed.ts < DICT_CACHE_TTL)) {
          return { extra: parsed.extra || [], excluded: parsed.excluded || [] };
        }
      }
    } catch (e) { /* noop */ }

    // 2. Se non in cache o scaduto, leggi da Firestore (best-effort)
    if (!fb) return { extra: [], excluded: [] };
    try {
      const doc = await Promise.race([
        fb.collection('config').doc('dizionario').get(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('fb timeout')), 5000))
      ]);
      if (docExists(doc)) {
        const d = doc.data() || {};
        const extra = d.extra || [];
        const excluded = d.excluded || [];
        if (window.FAW_WRITE_DICTIONARY_OVERRIDES) {
          window.FAW_WRITE_DICTIONARY_OVERRIDES({ extra, excluded });
        } else {
          try {
            localStorage.setItem(DICT_CACHE_KEY, JSON.stringify({ ts: Date.now(), extra, excluded }));
          } catch (e) { /* noop */ }
        }
        return { extra, excluded };
      }
    } catch (e) {
      console.warn('[Patata] override dizionario Firebase non disponibili:', e.message);
      // Se la fetch fallisce ma avevamo una vecchia cache, riusala
      try {
        const cached = localStorage.getItem(DICT_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed) return { extra: parsed.extra || [], excluded: parsed.excluded || [] };
        }
      } catch (e2) { /* noop */ }
    }
    return { extra: [], excluded: [] };
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

    // Override Firebase (extra/excluded) con cache in localStorage
    const overrides = await getSharedDictionaryOverrides(G.db);
    (overrides.extra || []).forEach((w) => {
      const n = normalizeWord(w);
      if (n.length >= MIN_WORD_LENGTH) words.add(n);
    });
    (overrides.excluded || []).forEach((w) => words.delete(normalizeWord(w)));

    G.dict = words;
    G.index = new LetterIndex(Array.from(words));
    setLoadStatus('Dizionario pronto: ' + G.dict.size.toLocaleString('it-IT') + ' parole');
  }

  /**
   * Parola approvata da tutti: la aggiunge al vocabolario.
   * - locale subito (G.dict + indice dei conteggi) → valida per TUTTI i client
   *   della partita anche prima della scittura;
   * - cache locale + Firestore `config/dizionario → extra` (best-effort) →
   *   valida anche per le partite successive.
   * Chiamata dal solo client referente che ha chiuso la votazione.
   */
  async function persistiParolaNelVocabolario(w) {
    const parola = normalizeWord(w);
    if (!parola || !G.dict) return;
    aggiungiParolaLocale(parola);
    try {
      const raw = localStorage.getItem(DICT_CACHE_KEY);
      let parsed = null;
      try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { parsed = null; }
      const extra = (parsed && Array.isArray(parsed.extra)) ? parsed.extra.slice() : [];
      if (extra.indexOf(parola) === -1) extra.push(parola);
      const excluded = (parsed && parsed.excluded) || [];
      if (window.FAW_WRITE_DICTIONARY_OVERRIDES) {
        window.FAW_WRITE_DICTIONARY_OVERRIDES({ extra, excluded });
      } else {
        localStorage.setItem(DICT_CACHE_KEY, JSON.stringify({ ts: Date.now(), extra, excluded }));
      }
    } catch (e) { /* noop */ }
    if (G.db && G.fs && G.fs.FieldValue) {
      try {
        await G.db.collection('config').doc('dizionario').set(
          { extra: G.fs.FieldValue.arrayUnion(parola) },
          { merge: true }
        );
      } catch (e) {
        console.warn('[Patata] vocabolario condiviso non aggiornato:', e && e.message);
        toast('⚠️ "' + parola + '" valida per questa partita, ma il vocabolario condiviso non è stato aggiornato', 'err');
      }
    }
  }
  /** Inserimento a caldo nel Set + ricostruzione dell'indice (conteggi). */
  function aggiungiParolaLocale(w) {
    if (!G.dict || G.dict.has(w)) return;
    G.dict.add(w);
    try { G.index = new LetterIndex(Array.from(G.dict)); }
    catch (e) { /* l'indice serve solo ai conteggi: la validazione usa G.dict */ }
  }

  /* ---------------- DERIVATI ---------------- */
  function lettersFor(state) {
    if (!state || !state.opzioni) return ['A', 'E'];
    const rule = ruleFor(state);
    const key = (state.opzioni.seed || 'SEED') + ':' + (state.round || 1) + ':' + (state.opzioni.lettere || 3) + ':' + rule;
    if (!G.letterCache.has(key)) {
      G.letterCache.set(key, pickLetters(state.opzioni.seed, state.round, state.opzioni.lettere, G.index, rule));
    }
    return G.letterCache.get(key);
  }
  function availFor(letters, rule = 'classic') {
    if (!G.index) return 0;
    if (rule === 'sequenza') {
      const seq = Array.isArray(letters) ? letters.join('') : letters;
      return G.index.countSequence ? G.index.countSequence(seq) : 0;
    }
    return G.index.countFor(letters);
  }

  /* ---------------- LOGICA (tick) ---------------- */
  function ctxFor(extra) {
    const s = G.state;
    const rule = s ? ruleFor(s) : 'classic';
    return Object.assign({
      me: G.me,
      now: Date.now(),
      rule,
      letters: s ? lettersFor(s) : [],
      used: s ? usedWords(s) : new Set(),
      dict: G.dict
    }, extra || {});
  }

  const gate = new ActionGate();
  function myStaggerMs(s) {
    const i = (s.partecipanti || []).indexOf(G.me);
    return (i < 0 ? 0 : i) * 900;
  }
  function actionKey(s, key) {
    return s.stato + ':' + (s.round || 0) + ':' + key;
  }
  function mayAct(s, key, referent) {
    return gate.mayAct(actionKey(s, key), {
      now: Date.now(),
      isReferent: referent === G.me,
      staggerMs: myStaggerMs(s)
    });
  }
  function actionOk(s, key) { gate.ok(actionKey(s, key)); }
  function actionFailed(s, key, res) { gate.failed(actionKey(s, key), res); }

  async function logicaTick() {
    const s = G.state;
    if (!s || G.busy) return;
    if (G.backend && G.backend.rateLimitedUntil > Date.now()) return; // backoff 429 attivo
    G.busy = true;
    try {
      if (s.stato === 'attesa') {
        if (G.solo) return;
        // Segnarsi pronti è un arrayUnion: scrittura diretta, nessuna lettura.
        if (s.pronti.indexOf(G.me) === -1) {
          if (mayAct(s, 'ready:' + G.me, G.me)) {
            const r = await G.backend.applyAtomic(mutReady);
            if (r && r.ok) actionOk(s, 'ready:' + G.me);
            else actionFailed(s, 'ready:' + G.me, r);
          }
          return;
        }
        // Avvio partita con blind update: 0 letture
        if (s.pronti.length >= s.partecipanti.length && mayAct(s, 'start', s.partecipanti[0])) {
          const r = await G.backend.applyAtomic(mutStart);
          if (r && r.ok) actionOk(s, 'start');
          else actionFailed(s, 'start', r);
        }
        return;
      }
      if (s.stato !== 'in_corso' || !s.roundData) return;

      if (s.roundData.fase === 'giochi' && s.turno) {
        /* Voto sul vocabolario: quando TUTTI hanno votato, un solo client
           (il referente) risolve e, se la maggioranza ha detto sì, salva la
           parola nel dizionario condiviso. */
        if (s.richiesta) {
          const rq = s.richiesta;
          const nVoti = (rq.votiSi || []).length + (rq.votiNo || []).length;
          if (nVoti >= s.partecipanti.length && mayAct(s, 'richiesta', s.partecipanti[0])) {
            const inserita = (rq.votiSi || []).length > (rq.votiNo || []).length;
            const r = await G.backend.applyAtomic(mutRisolviRichiesta);
            if (r && r.ok) {
              actionOk(s, 'richiesta');
              if (inserita) persistiParolaNelVocabolario(rq.parola);
            } else {
              actionFailed(s, 'richiesta', r);
            }
          }
          return; // voto aperto: il clock resta congelato, nient'altro scorre
        }
        if (!s.pausa && Date.now() >= s.turno.deadline) {
          // Al zero la scottatura scatta SUBITO (nessuna grazia).
          // Agisce chi tiene la patata; se è offline subentrano gli altri.
          if (mayAct(s, 'timeout', s.turno.giocatore)) {
            const r = await G.backend.applyAtomic(mutTimeout);
            if (r && r.ok) actionOk(s, 'timeout');
            else actionFailed(s, 'timeout', r);
          }
        }
        return;
      }

      if (s.roundData.fase === 'recap') {
        // Risolvi le contestazioni raggiunte (maggioranza di chi non è l'autore)
        const flags = s.roundData.flags || {};
        for (const word of Object.keys(flags)) {
          if (flagResolved(s, word) && mayAct(s, 'flag:' + word, s.partecipanti[0])) {
            const r = await G.backend.applyAtomic((st) => mutResolveFlag(st, { word }));
            if (r && r.ok) {
              actionOk(s, 'flag:' + word);
              toast('🚩 "' + word + '" contestata: punti rimossi', 'ok');
            } else {
              actionFailed(s, 'flag:' + word, r);
            }
            break; // al massimo una risoluzione per tick
          }
        }
        if (s.confermaTurno.length >= s.partecipanti.length && mayAct(s, 'next', s.partecipanti[0])) {
          const r = await G.backend.applyAtomic(mutNextRound);
          if (r && r.ok) actionOk(s, 'next');
          else actionFailed(s, 'next', r);
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
    if (el['cfg-mode']) {
      const m = op.mode || 'classic';
      el['cfg-mode'].textContent = m === 'sequenza' ? 'SEQUENZA' : m === 'mix' ? 'MIX' : 'CLASSICA';
    }

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
      el['lobby-status'].classList.remove('hidden');
      if (pronti >= tot) {
        el['lobby-status-text'].textContent = 'Tutti pronti: inizio immediato!';
      } else {
        // Nomi espliciti: così "in attesa" non resta un mistero quando
        // qualcuno non ha ancora aperto la pagina della partita.
        const manca = s.partecipanti.filter((p) => s.pronti.indexOf(p) === -1);
        el['lobby-status-text'].textContent =
          'In attesa di ' + manca.map((p) => p.toUpperCase()).join(', ') +
          ' (' + pronti + '/' + tot + ' pronti)…';
      }
      if (G.rateLimited) {
        el['lobby-status-text'].textContent +=
          ' · Connessione limitata dal server: nuovo tentativo automatico in corso.';
      }
    }
  }

  /* ---------------- RENDER: GIOCO ---------------- */
  function renderLetters(s) {
    if (!s.roundData) return;
    const letters = lettersFor(s);
    const rule = ruleFor(s);
    el['letter-tiles'].innerHTML = letters.map((l) => '<span class="ltile">' + esc(l) + '</span>').join('');

    const ruleBadge = el['letters-rule-badge'];
    if (ruleBadge) {
      if (rule === 'sequenza') {
        ruleBadge.textContent = '— di seguito (consecutive)';
        ruleBadge.className = 'letters-rule-badge badge-seq';
      } else {
        ruleBadge.textContent = '— anche staccate';
        ruleBadge.className = 'letters-rule-badge badge-classic';
      }
    }

    const n = availFor(letters, rule);
    el['letters-avail'].innerHTML =
      n > 0 ? '<b>' + n.toLocaleString('it-IT') + '</b> parole valide nel dizionario per questo turno' : '…';
    updateInputHint();
  }

  function renderPlayersGame(s) {
    const order = roundOrderFor(s.partecipanti, s.round || 1);
    const active = (s.roundData && s.roundData.fase === 'giochi') ? s.turno && s.turno.giocatore : null;
    /* Power-up 🚀 del round: badge sul chip di chi lo possiede (finché non
       lo usa — roundData.powerPass sparisce a ogni nuovo round). */
    const power = (s.roundData && s.roundData.fase === 'giochi' && !s.roundData.powerPass)
      ? powerPassFor(s) : null;
    el['game-players'].innerHTML = order.map((p) =>
      '<span class="pchip' + (p === active ? ' active' : '') + (p === G.me ? ' mine' : '') + '">' +
      (p === active ? '<span class="potato">🥔</span>' : '') +
      (p === power ? '<span class="power-badge" title="Power-up di questo round: passa la patata a chi vuoi">🚀</span>' : '') +
      '<span class="avatar" style="background:' + avatarColor(p) + '">' + esc(p.slice(0, 2).toUpperCase()) + '</span>' +
      esc(p) + (p === G.me ? ' (TU)' : '') +
      /* Round persi = teschio 💀 (non un "fuocherello" positivo). */
      (s.patate[p] ? '<span class="scottato" title="Round persi">💀×' + s.patate[p] + '</span>' : '') +
      '</span>'
    ).join('');

    // Turn banner
    if (s.roundData && s.roundData.fase === 'giochi' && s.turno) {
      el['turn-banner'].classList.remove('hidden');
      const bonusCorrente = bonusPerParola(s, nowEff(s));
      if (s.pausa || s.richiesta) {
        el['turn-banner'].textContent = s.richiesta
          ? '📖 VOTO IN CORSO — GIOCO IN PAUSA'
          : '⏸ PAUSA — IL TEMPO È FERMO';
        el['turn-banner'].classList.remove('mine');
      } else if (s.turno.giocatore === G.me) {
        el['turn-banner'].textContent = '🔥 TOCCA A TE — SCRIVI UNA PAROLA! (+' + bonusCorrente + 's)';
        el['turn-banner'].classList.add('mine');
      } else {
        el['turn-banner'].textContent = 'TOCCA A ' + s.turno.giocatore.toUpperCase() + ' · +' + bonusCorrente + 's';
        el['turn-banner'].classList.remove('mine');
      }
    } else {
      el['turn-banner'].classList.add('hidden');
    }

    aggiornaInput(s);
  }

  /**
   * Stato della casella di scrittura.
   * Si scrive SOLO quando la patata è nostra: fuori turno la casella è
   * disabilitata e vuota (nessuna parola preparata in anticipo). L'invio
   * resta possibile solo al proprio turno: il mutatore rifiuta comunque
   * qualsiasi scrittura fuori turno, questa è la parte visibile della regola.
   * Chiamata a ogni snapshot E a ogni battuta (per aggiornare l'etichetta).
   */
  function aggiornaInput(s) {
    if (!s) return;
    const inGioco = !!(s.roundData && s.roundData.fase === 'giochi' && s.turno);
    const bloccata = !!(s.pausa || s.richiesta);          // pausa o voto aperto
    const myTurn = inGioco && !bloccata && s.turno.giocatore === G.me;
    /* Fuori turno la casella si svuota; durante una PAUSA la parola già
       digitata resta (il turno non è passato: si riprende da dove si era). */
    if (!myTurn && !bloccata && el['word-input'].value) el['word-input'].value = '';
    el['word-input'].disabled = !myTurn;
    el['btn-invia'].disabled = !myTurn;
    el['word-input'].classList.toggle('ready', myTurn);
    el['btn-invia'].classList.toggle('btn-fire', myTurn);
    el['btn-invia'].classList.toggle('btn-ghost', !myTurn);
    const bonus = inGioco ? bonusPerParola(s, nowEff(s)) : 0;
    if (bloccata && inGioco) {
      el['word-input'].placeholder = s.richiesta
        ? '📖 Voto in corso sul vocabolario…'
        : '⏸ In pausa — il tempo è fermo…';
      el['btn-invia'].textContent = '⏸';
    } else if (myTurn) {
      el['word-input'].placeholder = 'Scrivi la parola… (INVIO)';
      el['btn-invia'].textContent = 'INVIA';
      if (document.hasFocus() && document.activeElement !== el['word-input']) {
        el['word-input'].focus({ preventScroll: true });
      }
    } else {
      el['word-input'].placeholder = inGioco ? '⏳ Aspetta il tuo turno…' : '—';
      el['btn-invia'].textContent = '⏳';
    }

    // Pulsante "proponi al vocabolario" (come in Ruzzle): visibile solo al
    // proprio turno, per una parola ancora assente dal dizionario.
    if (el['btn-richiedi']) {
      const w = normalizeWord(el['word-input'].value || '');
      const proponibile = !G.solo && myTurn && !G.rateLimited &&
        w.length >= MIN_WORD_LENGTH &&
        !(G.dict && G.dict.has(w)) &&
        !(s.storia || []).some((e) => e.w === w);
      el['btn-richiedi'].classList.toggle('hidden', !proponibile);
      if (proponibile) {
        el['btn-richiedi'].textContent = '📖 Proponi "' + w + '" al vocabolario';
      }
    }

    // Power-up 🚀 "passa la patata": al mio turno, se possiedo il power-up
    // del round e non è ancora stato usato.
    if (el['btn-power']) {
      const hoPower = myTurn &&
        powerPassFor(s) === G.me &&
        !(s.roundData && s.roundData.powerPass);
      el['btn-power'].classList.toggle('hidden', !hoPower);
    }

    // Striscia informativa: dice quando si può scrivere e quanto vale il bonus
    if (el['input-prep']) {
      el['input-prep'].classList.toggle('hidden', !inGioco);
      if (bloccata && inGioco) {
        el['input-prep'].innerHTML = s.richiesta
          ? '<b>📖 Parola proposta:</b> il gioco è in pausa finché <b>tutti</b> non votano ' +
            'se inserire <b>' + esc(s.richiesta.parola) + '</b> nel vocabolario.'
          : '<b>⏸ Pausa:</b> il cronometro è fermo per tutti — il tempo riprende esattamente da dove si era.';
      } else {
        el['input-prep'].innerHTML = myTurn
          ? '<b>🔥 Tocca a te:</b> invia una parola per passare la patata — ' +
            '<b>+' + bonus + 's</b> sul cronometro.'
          : '<b>⏳ Tocca a ' + esc(s.turno ? s.turno.giocatore : '') + ':</b> ' +
            'potrai scrivere solo al tuo turno. ' +
            'Ogni parola vale <b>+' + bonus + 's</b>' +
            (bonus < TIME_BONUS_STEPS[0] ? ' (il bonus cala di 1s ogni minuto di turno)' : '') + '.';
      }
    }
  }

  function updateInputHint() {
    const s = G.state;
    if (!s || !s.roundData) return;
    const letters = lettersFor(s);
    const rule = ruleFor(s);
    const val = el['word-input'].value ? normalizeWord(el['word-input'].value) : '';

    if (rule === 'sequenza') {
      const seq = letters.join('');
      const hit = val.indexOf(seq) !== -1;
      el['input-hint'].innerHTML =
        '<span>sequenza:</span>' +
        '<span class="mini-seq' + (hit ? ' hit' : '') + '">' + esc(seq) + '</span>' +
        '<span class="hint-mode-tag">(di seguito)</span>';
    } else {
      el['input-hint'].innerHTML =
        '<span>deve contenere:</span>' +
        letters.map((l) =>
          '<span class="mini-letter' + (val.indexOf(l) !== -1 ? ' hit' : '') + '">' + esc(l) + '</span>'
        ).join('') +
        '<span class="hint-mode-tag">(anche staccate)</span>';
    }
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
    const rule = ruleFor(s);
    el.feed.innerHTML = entries.map((e) =>
      '<div class="feed-item' + (rimosse.indexOf(e.w) !== -1 ? ' removed' : '') + '">' +
      '<span class="avatar" style="background:' + avatarColor(e.nome) + '">' + esc(e.nome.slice(0, 2).toUpperCase()) + '</span>' +
      '<span class="fname">' + esc(e.nome) + '</span>' +
      '<span class="fword">' + highlightWord(e.w, letters, rule) + '</span>' +
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
      (r.patate ? '<span class="spat" title="Round persi">💀×' + r.patate + '</span>' : '') +
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
    const rule = ruleFor(s);
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
              highlightWord(x.w, letters, rule) +
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
        const r = await G.backend.applyAtomic((st) => mutFlag(st, { word, me: G.me }));
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

  /* ---------------- OVERLAY: PAUSA + VOTO VOCABOLARIO ---------------- */
  function renderPausa(s) {
    const attivo = inGiocoFase(s);
    const mostra = attivo && !!(s.pausa || s.richiesta);
    el['overlay-pausa'].classList.toggle('hidden', !mostra);

    // Pulsante ⏸ nel topbar: visibile solo durante il gioco attivo
    if (el['btn-pausa']) {
      el['btn-pausa'].classList.toggle('hidden', !(attivo && !s.pausa && !s.richiesta));
    }
    if (!mostra) return;

    const body = el['pausa-body'];
    body.innerHTML = '';

    if (s.richiesta) {
      /* ---- Voto su proposta di parola (come in Ruzzle) ---- */
      const rq = s.richiesta;
      const si = rq.votiSi || [], no = rq.votiNo || [];
      const tot = s.partecipanti.length;
      const votati = si.length + no.length;
      const mioVoto = si.indexOf(G.me) !== -1 ? 'si' : (no.indexOf(G.me) !== -1 ? 'no' : null);
      el['pausa-emoji'].textContent = '📖';
      el['pausa-title'].textContent = 'PAROLA DA INSERIRE NEL VOCABOLARIO';
      el['pausa-sub'].innerHTML =
        '<b>' + esc(rq.parola) + '</b> non è nel dizionario — proposta da <b>' + esc(rq.da) + '</b>. ' +
        'Il gioco resta in pausa finché <b>tutti</b> non hanno votato.';

      const righe = s.partecipanti.map((p) => {
        const v = si.indexOf(p) !== -1 ? '<span class="pv si">👍</span>'
          : no.indexOf(p) !== -1 ? '<span class="pv no">👎</span>'
          : '<span class="pv att">…</span>';
        return '<div class="pausa-voter">' +
          '<span class="avatar" style="background:' + avatarColor(p) + '">' + esc(p.slice(0, 2).toUpperCase()) + '</span>' +
          '<span class="pv-name">' + esc(p) + (p === G.me ? ' (TU)' : '') +
          (p === rq.da ? ' <span class="pv-prop">proponente</span>' : '') + '</span>' + v + '</div>';
      }).join('');
      body.innerHTML =
        '<div class="pausa-voters">' + righe + '</div>' +
        '<div class="conf-progress pausa-progress">' +
        (mioVoto ? '✔ Hai votato — ' : 'Votazione: ') + '<b>' + votati + '/' + tot + '</b>' +
        '<div class="conf-bar"><i style="width:' + Math.round((votati / tot) * 100) + '%"></i></div></div>';

      const azioni = [];
      if (!mioVoto) {
        azioni.push({ id: 'si', label: '👍 INSERISCI', kind: 'btn-fire', fn: () => votaRichiesta(true) });
        azioni.push({ id: 'no', label: '👎 NON INSERIRE', kind: 'btn-ghost', fn: () => votaRichiesta(false) });
      } else {
        azioni.push({ id: 'attesa', label: mioVoto === 'si' ? '✔ HAI VOTATO 👍' : '✔ HAI VOTATO 👎', kind: 'btn-ghost', fn: () => {} });
      }
      if (rq.da === G.me) {
        azioni.push({ id: 'ritira', label: '✖ RITIRA LA PROPOSTA', kind: 'btn-ghost', fn: ritiraRichiesta });
      }
      azioni.forEach((b) => {
        const btn = document.createElement('button');
        btn.className = 'btn ' + b.kind;
        btn.textContent = b.label;
        if (b.id === 'attesa') btn.disabled = true;
        btn.addEventListener('click', b.fn);
        body.appendChild(btn);
      });
      body.classList.add('pausa-actions');
    } else {
      /* ---- Pausa semplice per tutti ---- */
      el['pausa-emoji'].textContent = '⏸';
      el['pausa-title'].textContent = 'PAUSA';
      const da = s.pausaDa;
      el['pausa-sub'].innerHTML = !da || da === G.me
        ? 'Hai messo in pausa il gioco per tutti: il cronometro è <b>fermo</b>.'
        : '<b>' + esc(da) + '</b> ha messo in pausa il gioco per tutti: il cronometro è <b>fermo</b>.';
      const btn = document.createElement('button');
      btn.className = 'btn btn-fire';
      btn.textContent = '▶ RIPRENDI IL GIOCO';
      btn.addEventListener('click', riprendiGioco);
      body.appendChild(btn);
      body.classList.add('pausa-actions');
    }
  }

  /* ---------------- AZIONI: PAUSA / VOTO / RICHIESTA ---------------- */

  /* ---------------- POWER-UP 🚀: SCELTA BERSAGLIO ---------------- */
  /**
   * Overlay per scegliere a chi passare la patata. Si apre con il pulsante
   * 🚀 e si chiude alla selezione, ad ANNULLA o non appena le condizioni
   * (mio turno, power-up ancora disponibili) non valgono più.
   */
  function renderTargetPicker(s) {
    if (!el['overlay-target']) return;
    if (!G.pickTarget) { el['overlay-target'].classList.add('hidden'); return; }
    const pu = powerPassFor(s);
    const puòPassare = inGiocoFase(s) && !s.pausa && !s.richiesta &&
      s.turno && s.turno.giocatore === G.me &&
      pu === G.me && !(s.roundData && s.roundData.powerPass);
    if (!puòPassare) {
      G.pickTarget = false;
      el['overlay-target'].classList.add('hidden');
      return;
    }
    const bersagli = s.partecipanti.filter((p) => p !== G.me);
    el['target-body'].innerHTML =
      bersagli.map((p) =>
        '<button class="btn btn-power target-btn" data-target="' + esc(p) + '">' +
        '<span class="avatar" style="background:' + avatarColor(p) + '">' + esc(p.slice(0, 2).toUpperCase()) + '</span>' +
        'PASSA A ' + esc(p.toUpperCase()) + '</button>'
      ).join('') +
      '<button class="btn btn-ghost target-btn" data-target="">✖ ANNULLA</button>';
    el['target-body'].querySelectorAll('[data-target]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-target');
        if (!target) { G.pickTarget = false; renderTargetPicker(G.state); return; }
        passaPatata(target);
      });
    });
    el['overlay-target'].classList.remove('hidden');
  }

  function apriTargetPicker() {
    const s = G.state;
    if (!s) return;
    G.pickTarget = true;
    renderTargetPicker(s);
  }

  async function passaPatata(target) {
    const s = G.state;
    if (!s || !target) return;
    G.pickTarget = false;
    el['overlay-target'].classList.add('hidden');
    const r = await G.backend.applyAtomic(mutPassaPatata, { target });
    if (r && r.ok) {
      toast('🚀 Patata passata a ' + target.toUpperCase() + ' — 0 punti, nessun secondo');
    } else if (r && r.error) {
      const msg = {
        NO_POWER: 'Non hai il power-up di questo round',
        USED: 'Power-up già usato in questo round',
        BAD_TARGET: 'Bersaglio non valido',
        NOT_YOUR_TURN: '⏳ Aspetta il tuo turno',
        PAUSED: '⏸ Prima riprendi il gioco',
        NOT_PLAYING: 'Non puoi usarlo adesso'
      }[r.error.code] || 'Non puoi passare la patata adesso';
      toast('🚀 ' + msg, 'err');
    } else if (r && r.failed) {
      toast('Connessione instabile, riprova', 'err');
    }
  }

  async function pausaToggle() {
    const s = G.state;
    if (!s || !inGiocoFase(s) || s.richiesta) return;
    const eraInPausa = !!s.pausa;
    const r = await G.backend.applyAtomic(mutPausa);
    if (r && r.ok) {
      toast(eraInPausa ? '▶ Gioco ripreso: il cronometro riparte' : '⏸ Pausa per tutti: il tempo è fermo');
    } else if (r && r.aborted) {
      toast(eraInPausa ? 'Non puoi riprendere ora' : 'Pausa non disponibile in questo momento', 'err');
    } else if (r && r.failed) {
      toast('Connessione instabile, riprova', 'err');
    }
  }
  async function riprendiGioco() { return pausaToggle(); }

  async function votaRichiesta(votoSi) {
    const s = G.state;
    if (!s || !s.richiesta) return;
    /* mutVotoParola legge ctx.me/ctx.votoSi: il ctx lo costruisce applyAtomic. */
    const r = await G.backend.applyAtomic(mutVotoParola, { votoSi });
    if (r && r.ok) toast(votoSi ? '👍 Voto registrato' : '👎 Voto registrato');
    else if (r && r.aborted) toast('Il tuo voto è già stato registrato', 'err');
    else if (r && r.failed) toast('Connessione instabile, riprova', 'err');
  }
  async function ritiraRichiesta() {
    const s = G.state;
    if (!s || !s.richiesta) return;
    const r = await G.backend.applyAtomic(mutRitiraRichiesta);
    if (r && r.ok) toast('✖ Proposta ritirata: si riprende a giocare');
  }

  async function richiediParola() {
    const s = G.state;
    if (!s) return;
    const raw = el['word-input'].value;
    const w = normalizeWord(raw);
    if (w.length < MIN_WORD_LENGTH) { toast('Scrivi una parola di almeno ' + MIN_WORD_LENGTH + ' lettere'); return; }
    const r = await G.backend.applyAtomic((st) => mutRichiediParola(st, ctxFor({ word: raw })));
    if (r && r.ok) {
      toast('📖 Proposta inviata: tutti votano per "' + w + '"');
      return;
    }
    if (r && r.error) {
      if (r.error.code === 'ALREADY') toast('"' + w + '" è già nel vocabolario', 'err');
      else if (r.error.code === 'USED') toast('"' + w + '" è già stata usata in questa partita', 'err');
      else if (r.error.code === 'NOT_YOUR_TURN') toast('⏳ Aspetta il tuo turno', 'err');
      else if (r.error.code === 'INVALID') toast('Minimo ' + MIN_WORD_LENGTH + ' lettere', 'err');
      else toast('Non si può proporre adesso', 'err');
      return;
    }
    if (r && r.failed) toast('Connessione instabile, riprova', 'err');
  }

  /**
   * Esito di una votazione (su TUTTI i client): parola approvata → entra nel
   * dizionario locale subito, così chi l'ha proposta può usarla.
   */
  function gestisciEsitoRichiesta(s) {
    const primaVolta = !G.richiestaBooted;
    G.richiestaBooted = true;
    const ur = s.ultimaRichiesta;
    if (!ur) return;
    if (ur.ts === G.prevRichiestaTs) return;
    G.prevRichiestaTs = ur.ts;
    if (ur.esito === 'inserita') {
      aggiungiParolaLocale(ur.parola);
      if (primaVolta) return;            // allo riaprire: niente toast di riga vecchia
      toast('✅ "' + ur.parola + '" aggiunta al vocabolario (+' + ur.parola.length + ' pt)', 'ok');
    } else if (primaVolta) {
      return;
    } else if (ur.esito === 'rifiutata') {
      toast('❌ "' + ur.parola + '" non è stata inserita nel vocabolario', 'err');
    } else if (ur.esito === 'annullata') {
      toast('✖ Proposta di "' + ur.parola + '" annullata');
    }
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

    /* Podio condiviso (../shared/podio.js): ordine per punteggio decrescente,
       gradino del 1° più alto e via via più basso, tutti i giocatori visibili. */
    window.FAWPodio.render(el.podio, ranking.map((r) => ({
      nome: r.p,
      punti: r.pts,
      sottotitolo: r.parole + ' parole' + (r.patate ? ' · 💀×' + r.patate : '')
    })), { io: G.me });

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

    // Statistiche giornaliere (stesso store dell'hub)
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
    }

    // Rivincita (multiplayer)
    el['btn-rivincita'].classList.toggle('hidden', G.solo);
    renderRematch(s);
  }

  /* ---------------- RIVINCITA (Zero runTransaction) ---------------- */
  async function creaRivincita() {
    const s = G.state;
    if (!s || s.stato !== 'conclusa') return;
    if (G.solo || !G.db) { toast('Rivincita disponibile solo in sfida'); return; }
    if (s.prossimaPartita && !(s.rivincitaRifiutataDa || []).length) { toast('Rivincita già creata, in attesa…'); return; }
    try {
      if (window.FAW_RIVINCITA) await window.FAW_RIVINCITA.scarta(G.db, s.prossimaPartita, s.prossimaPartitaGioco);
      const newRef = G.db.collection('partite').doc();
      const punteggi = {};
      const parole = {};
      s.partecipanti.forEach((p) => { punteggi[p] = 0; parole[p] = []; });
      await newRef.set({
        gioco: 'patata',
        partecipanti: s.partecipanti,
        punteggi,
        parole,
        pronti: [],
        stato: 'attesa',
        rivincitaAccettataDa: [],
        rivincitaRifiutataDa: [],
        dataOra: new Date().toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
        timestamp: Date.now(),
        opzioni: {
          tempo: String(s.opzioni.tempo),
          turni: String(s.opzioni.turni),
          lettere: String(s.opzioni.lettere),
          mode: s.opzioni.mode,
          seed: Math.random().toString(36).substring(7).toUpperCase()
        }
      });
      const collegamento = window.FAW_RIVINCITA
        ? window.FAW_RIVINCITA.campiCollegamento(newRef.id, 'patata', G.me)
        : { prossimaPartita: newRef.id, prossimaPartitaCreataDa: G.me, rivincitaAccettataDa: [], rivincitaRifiutataDa: [] };
      await G.backend.ref.update(collegamento);
      hideBanner();
    } catch (e) {
      console.error('[Patata] rivincita:', e);
      toast('Errore nella creazione della rivincita', 'err');
    }
  }
  function fieldValue() {
    return (G.fs && G.fs.FieldValue) ||
      (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue) ||
      null;
  }
  function accettaRivincita() {
    const FV = fieldValue();
    if (!G.backend || !FV) return;
    G.backend.ref.update({ rivincitaAccettataDa: FV.arrayUnion(G.me) }).catch(() => {});
  }
  function rifiutaRivincita() {
    const FV = fieldValue();
    if (!G.backend || !FV) return;
    G.backend.ref.update({ rivincitaRifiutataDa: FV.arrayUnion(G.me) }).catch(() => {});
  }
  function nomeRivincita(s) {
    if (window.FAW_RIVINCITA) return window.FAW_RIVINCITA.nome(s.prossimaPartitaGioco || 'patata');
    return 'Patata Bollente';
  }
  function vaiAllaRivincita(s) {
    if (G.redirected || !s || !s.prossimaPartita) return;
    if (window.FAW_RIVINCITA) {
      if (!window.FAW_RIVINCITA.vai(s, 'patata')) return;
    } else {
      setTimeout(() => { window.location.href = 'index.html?matchId=' + s.prossimaPartita; }, 1200);
    }
    G.redirected = true;
  }
  function preparaContestoRivincita() {
    if (!window.FAW_RIVINCITA || !G.backend) return;
    window.FAW_RIVINCITA.prepara({
      db: G.db,
      ref: G.backend.ref,
      me: G.me,
      partecipanti: (G.state && G.state.partecipanti) || [],
      giocoCorrente: 'patata',
      proposta: G.state,
      onFatto: hideBanner,
      onErrore: (msg) => toast(msg || 'Invito non riuscito', 'err')
    });
  }
  function apriSceltaRivincita() {
    const s = G.state;
    if (!s || s.stato !== 'conclusa' || G.solo) return;
    if (s.prossimaPartita && !(s.rivincitaRifiutataDa || []).length) {
      toast('Rivincita già creata, in attesa…');
      return;
    }
    preparaContestoRivincita();
    const altri = window.FAW_RIVINCITA
      ? window.FAW_RIVINCITA.azioniAltri('patata', s.partecipanti.length, (id) => {
          window.FAW_invitaAltroGioco(id);
        })
      : [];
    banner({
      icon: '🔁',
      title: 'RIVINCITA',
      subtitle: 'Stessa partita, oppure invita tutti a un altro gioco',
      sticky: true,
      buttons: [
        { id: 'stessa', label: '🥔 STESSA PARTITA', kind: 'btn-fire', fn: creaRivincita },
        { id: 'chiudi', label: '✖️', kind: 'btn-ghost', fn: hideBanner }
      ].concat(altri)
    });
  }
  function annullaRivincita() {
    if (!G.backend || !window.FAW_RIVINCITA) return;
    window.FAW_RIVINCITA.annulla(G.db, G.backend.ref, G.state).catch(() => toast('Annullamento non riuscito', 'err'));
  }
  function renderRematch(s) {
    const rifiutanti = s.rivincitaRifiutataDa || [];
    const accettanti = s.rivincitaAccettataDa || [];
    const id = s.prossimaPartita;
    const nome = nomeRivincita(s);
    const pronti = window.FAW_RIVINCITA
      ? window.FAW_RIVINCITA.tuttiAccettati(s.partecipanti, s.prossimaPartitaCreataDa, accettanti)
      : accettanti.length >= s.partecipanti.length - 1;

    if (rifiutanti.length > 0) {
      el['btn-rivincita'].disabled = true;
      el['btn-rivincita'].textContent = '🔁 RIVINCITA RIFIUTATA';
      banner({
        icon: '👋', title: 'RIVINCITA RIFIUTATA',
        subtitle: rifiutanti.join(', ') + ' ha rifiutato',
        buttons: [
          { id: 'altra', label: '🔁 ALTRA', kind: 'btn-fire', fn: apriSceltaRivincita },
          { id: 'home', label: '🏠 HOME', kind: 'btn-ghost', fn: hideBanner }
        ]
      });
      return;
    }
    if (!id) {
      if (s.stato === 'conclusa' && !G.solo) el['btn-rivincita'].disabled = false;
      return;
    }
    if (pronti) {
      el['btn-rivincita'].disabled = true;
      el['btn-rivincita'].textContent = '🔄 REINDIRIZZAMENTO…';
      banner({
        icon: '✅', title: 'ACCETTATA DA TUTTI',
        subtitle: 'Si entra in ' + nome + '…', spinner: true, sticky: true
      });
      vaiAllaRivincita(s);
      return;
    }
    if (s.prossimaPartitaCreataDa === G.me) {
      el['btn-rivincita'].disabled = true;
      el['btn-rivincita'].textContent = '⏳ RIVINCITA IN ATTESA…';
      banner({
        icon: '🔁', title: 'PROPOSTA INVIATA',
        subtitle: 'In attesa di ' + s.partecipanti.filter((p) => p !== G.me && accettanti.indexOf(p) === -1).join(', ') + ' per ' + nome,
        sticky: true,
        buttons: [{ id: 'ann', label: '🚫 ANNULLA', kind: 'btn-ghost', fn: annullaRivincita }]
      });
      return;
    }
    if (accettanti.indexOf(G.me) !== -1) {
      el['btn-rivincita'].disabled = true;
      el['btn-rivincita'].textContent = '⏳ HAI ACCETTATO…';
      banner({
        icon: '✅', title: 'HAI ACCETTATO',
        subtitle: 'In attesa che tutti accettino ' + nome, sticky: true, buttons: []
      });
      return;
    }
    banner({
      icon: '🔁', title: nome.toUpperCase(),
      subtitle: (s.prossimaPartitaCreataDa || 'Qualcuno') + ' propone ' + nome,
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
      G.lastBonus = -1;           // il bonus del nuovo turno riparte pieno: nessun flash "calo"
      gate.reset();
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
    renderPausa(s);
    renderTargetPicker(s);
    gestisciEsitoRichiesta(s);

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
    if (ultimo.pass) {
      // Power-up 🚀 usato: comunicazione ben diversa da una parola valida.
      showFeedback('ok', '🚀 ' + ultimo.nome.toUpperCase() + ' passa la patata a ' +
        String(ultimo.target || '').toUpperCase() + ' (power-up!)');
      if (ultimo.nome === G.me) { el['word-input'].value = ''; updateInputHint(); }
    } else if (ultimo.ok) {
      showFeedback('ok', '✅ ' + ultimo.w + '  +' + ultimo.p + ' pt — passa a ' + nextPlayer(s, ultimo.nome).toUpperCase());
      // Svuota la casella di chi ha appena giocato (nessuna parola
      // preparata in anticipo: ogni turno riparte dalla casella vuota).
      if (ultimo.nome === G.me) el['word-input'].value = '';
      updateInputHint();
    } else if (ultimo.patata) {
      showFeedback('err', '💥 SCOTTATURA: ' + ultimo.nome.toUpperCase() + ' −' + PATATA_PENALTY + ' pt');
    } else if (ultimo.nome === G.me) {
      showFeedback('err', '❌ ' + ultimo.w + ' — parola non valida');
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

  /* ---------------- TIMER RING (rAF) + BONUS METER ---------------- */
  const RING_C = 2 * Math.PI * 88;
  let bonusFlashT = 0;  // anti-doppio flash nello stesso frame

  /**
   * Evidenza dello SCALINO del bonus (es. +4s → +3s):
   * - il chip +Ns lampeggia;
   * - un toast annuncia il nuovo valore;
   * - la barra sottile sotto il cronometro mostra QUANDO scatta il prossimo
   *   scalino (secondary timer: si svuota nel corso del minuto di turno).
   */
  function aggiornaBonusMeter(s, now, b) {
    if (!el['bonus-chip']) return;
    const attivo = inGiocoFase(s);
    document.querySelector('.bonus-meter').classList.toggle('hidden', !attivo);
    if (!attivo) return;
    el['bonus-val'].textContent = '+' + b + 's';
    const inizio = isFinite(Number(s.turno.inizio)) ? Number(s.turno.inizio) : now;
    const nelPassato = Math.max(0, now - inizio);
    const nelPasso = nelPassato % TIME_BONUS_STEP_MS;
    const alProssimo = TIME_BONUS_STEP_MS - nelPasso;
    el['bonus-fill'].style.width = (100 * alProssimo / TIME_BONUS_STEP_MS).toFixed(2) + '%';
    const sec = Math.ceil(alProssimo / 1000);
    if (sec !== G.lastStepSec) {
      G.lastStepSec = sec;
      el['bonus-caption'].textContent = b > 1
        ? 'prossimo scalino (+' + (b - 1) + 's) tra ' + sec + 's'
        : 'bonus minimo: +1s per ogni parola';
    }
  }

  function flashBonusMeter(prev, b) {
    if (prev === -1 || b >= prev) return;         // solo un CALO (o primo frame)
    const now = Date.now();
    if (now - bonusFlashT < 800) return;          // niente doppio flash ravvicinato
    bonusFlashT = now;
    const chip = el['bonus-chip'];
    if (chip) {
      chip.classList.remove('step-flash');
      void chip.offsetWidth;                       // riavvia l'animazione
      chip.classList.add('step-flash');
    }
    toast('⏳ BONUS CALATO: ora +'+b+'s per ogni parola (scalino ogni minuto di turno)');
  }

  function ringFrame() {
    const s = G.state;
    if (s && inGiocoFase(s)) {
      const now = nowEff(s);
      /* Il bonus cala nel tempo: la striscia va rinfrescata "a ogni secondo
         intero" anche senza snapshot (altrimenti mostrerebbe il valore vecchio). */
      const b = bonusPerParola(s, now);
      if (b !== G.lastBonus) {
        const prev = G.lastBonus;
        G.lastBonus = b;
        aggiornaInput(s);
        flashBonusMeter(prev, b);
      }
      aggiornaBonusMeter(s, now, b);
    } else if (el['bonus-chip']) {
      document.querySelector('.bonus-meter').classList.add('hidden');
      G.lastStepSec = -1;
    }
    const attivo = inGiocoFase(s);
    if (attivo) {
      const now = Date.now();
      const inPausa = !!(s.pausa || s.richiesta);
      /* Congelamento visivo: durante la pausa il cronometro resta esattamente
         a quanto rimaneva quando è partita. */
      const remaining = inPausa
        ? Math.max(0, s.turno.deadline - (Number(s.turno.pausaIniziata) || now))
        : Math.max(0, s.turno.deadline - now);
      const ref = s.turno.riferimento || s.turno.inizio || s.turno.deadline - 1;
      const span = Math.max(1, s.turno.deadline - ref);
      const frac = Math.min(1, Math.max(0, remaining / span));
      el['ring-fill'].style.strokeDashoffset = String(RING_C * (1 - frac));
      const sec = Math.ceil(remaining / 1000);
      const danger = sec <= 10;
      el['ring-fill'].classList.toggle('danger', danger);
      el['timer-sec'].classList.toggle('danger', danger);
      ringWrap.classList.toggle('urgent', danger && remaining > 0 && !inPausa);
      if (sec !== G.lastWholeSec) {
        G.lastWholeSec = sec;
        el['timer-sec'].textContent = String(sec);
      }
      /* AL ZERO LA CHIUSURA È IMMEDIATA: il frame stesso invoca la
         scottatura senza aspettare il tick logico di 1s. */
      if (!inPausa && remaining <= 0) logicaTick();
    } else if (s && s.stato === 'in_corso') {
      el['timer-sec'].textContent = '—';
      el['ring-fill'].style.strokeDashoffset = '0';
    }
    requestAnimationFrame(ringFrame);
  }

  /* ---------------- INVIATA PAROLA ---------------- */
  function msgForErr(v) {
    if (v.err === 'SHORT') return '❌ Minimo ' + MIN_WORD_LENGTH + ' lettere';
    if (v.err === 'MISSING') return '❌ Manca: ' + (v.missing || []).join(' + ');
    if (v.err === 'NOT_SEQUENCE') return '❌ Lettere non consecutive: ' + (v.seq || '');
    return '❌ Non è nel dizionario';
  }
  async function inviaParola() {
    const s = G.state;
    if (!s) return;
    if (s.stato !== 'in_corso' || !s.roundData || s.roundData.fase !== 'giochi') return;
    // Pausa o voto aperto: il clock è congelato, nessuna parola accettata.
    if (s.pausa || s.richiesta) {
      toast(s.richiesta ? '📖 Prima vota la proposta di parola' : '⏸ Gioco in pausa');
      return;
    }
    const rule0 = ruleFor(s);
    const ctx0 = ctxFor({ word: el['word-input'].value, rule: rule0 });

    // Fuori turno non si scrive: la casella è disabilitata e il pulsante anche.
    // Il controllo resta come rete di sicurezza (es. click da tastiera o
    // snapshot in ritardo): nessuna scrittura, nessuna parola preparata prima.
    if (!s.turno || s.turno.giocatore !== G.me) {
      toast('⏳ Aspetta il tuo turno per scrivere');
      aggiornaInput(s);
      return;
    }

    const raw = el['word-input'].value;
    const rule = rule0;
    const ctx = ctx0;
    const v = validateWord(raw, ctx.letters, ctx.used, ctx.dict, rule);
    if (!v.ok) {
      if (v.err === 'EMPTY') { toast('Scrivi una parola…'); return; }
      if (v.err === 'USED') {
        showFeedback('err', '❌ Parola già usata in questa partita');
        return;
      }
      showFeedback('err', msgForErr(v));
      const r = await G.backend.applyAtomic((st) => mutWrongWord(st, ctx));
      if (r && r.error && r.error.code === 'NOT_YOUR_TURN') toast('È già passato il turno!');
      return;
    }
    el['word-input'].value = '';
    updateInputHint();
    const r = await G.backend.applyAtomic((st) => mutSubmitWord(st, ctx));
    if (!r) return;
    if (r.error) {
      if (r.error.code === 'NOT_YOUR_TURN') { toast('È già passato il turno!'); showFeedback('err', '⏳ Il turno è già passato'); }
      else if (r.error.code === 'NOT_PLAYING') { toast('Il tempo è scaduto! 🥔'); }
      else if (r.error.code === 'PAUSED') { toast('⏸ Gioco in pausa: aspetta la ripresa'); }
      else { toast('Ops, riprova…', 'err'); }
      return;
    }
    if (r.failed) {
      if (r.rateLimited) {
        toast('⏳ Firestore sta limitando le richieste: riprova tra qualche istante', 'err');
      } else {
        toast('Connessione instabile, riprova', 'err');
      }
      return;
    }
  }

  /* ---------------- CONFERMA RECAP ---------------- */
  async function confermaTurno() {
    const r = await G.backend.applyAtomic(mutConferma);
    if (r && r.ok) {
      toast('✔ Turno confermato');
    }
  }

  /* ---------------- DEBUG/HOOK (usato anche dai test E2E) ---------------- */
  global.__PATATA = {
    get state() { return G.state; },
    get dict() { return G.dict; },
    lettersFor,
    ruleFor: () => ruleFor(G.state),
    validate: (w) => validateWord(w, lettersFor(G.state), usedWords(G.state), G.dict, ruleFor(G.state))
  };

  /* ---------------- BOOT ---------------- */
  function startSolo() {
    G.backend.applyAtomic(mutStart);
  }

  async function boot() {
    // Input
    el['word-input'].addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); inviaParola(); }
    });
    el['word-input'].addEventListener('input', () => {
      updateInputHint();
      aggiornaInput(G.state);   // l'etichetta del pulsante segue il turno
    });
    el['btn-invia'].addEventListener('click', inviaParola);
    el['btn-conferma'].addEventListener('click', confermaTurno);
    el['btn-start-solo'].addEventListener('click', startSolo);
    el['btn-rivincita'].addEventListener('click', apriSceltaRivincita);
    if (el['btn-pausa']) el['btn-pausa'].addEventListener('click', pausaToggle);
    if (el['btn-richiedi']) el['btn-richiedi'].addEventListener('click', richiediParola);
    if (el['btn-power']) el['btn-power'].addEventListener('click', apriTargetPicker);

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
          if (typeof firebase.firestore === 'undefined') {
            console.warn('[Patata] firebase-firestore-compat.js non caricato: solo allenamento disponibile.');
          } else {
            // Bootstrap condiviso: una sola app, una sola attivazione della cache.
            G.fs = firebase.firestore;
            G.db = typeof window.FAW_INIT_FIRESTORE === 'function'
              ? window.FAW_INIT_FIRESTORE()
              : (function () {
                  if (!firebase.apps || firebase.apps.length === 0) firebase.initializeApp(cfg);
                  return firebase.firestore();
                })();
          }
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
      // Allenamento: opzioni personalizzabili via URL (?tempo=60&turni=3&lettere=3&mode=classic)
      const modeParam = urlParams.get('mode') || urlParams.get('modalita') || 'classic';
      const validMode = (modeParam === 'sequenza' || modeParam === 'mix') ? modeParam : 'classic';
      G.backend = new SoloBackend(G.me, {
        tempo: Math.max(5, parseInt(urlParams.get('tempo'), 10) || 60),
        turni: Math.min(10, Math.max(1, parseInt(urlParams.get('turni'), 10) || 3)),
        lettere: Math.min(4, Math.max(2, parseInt(urlParams.get('lettere'), 10) || 3)),
        mode: validMode,
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
      G.backend.onRateLimit = (msWait) => {
        const sec = Math.max(1, Math.ceil(msWait / 1000));
        if (!G.rateLimited) {
          G.rateLimited = true;
          if (G.state) render(G.state);
        }
        toast('⏳ Server sovraccarico (limite richieste): riprovo automaticamente tra ' + sec + ' s', 'err');
      };
      G.backend.onRecover = () => {
        if (G.rateLimited) {
          G.rateLimited = false;
          if (G.state) render(G.state);
        }
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
