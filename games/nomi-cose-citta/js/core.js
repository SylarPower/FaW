/* =========================================================
   NOMI, COSE, CITTÀ — core logico (Focus at Work)

   Questo file contiene SOLO logica pura: niente DOM, niente
   Firebase, niente side effects. È lo stesso modulo usato da:
   - il browser (via <script src="js/core.js">),
   - i test Node (module.exports),
   - l'allenamento solo (SoloBackend) e il multiplayer (FirebaseBackend).

   Regole di gioco implementate (modalità CLASSICA):
   - ogni round ha UNA lettera e un insieme di categorie condivisi;
   - una risposta per giocatore e per categoria;
   - validità automatica = non vuota + iniziale corretta + presente
     nel dizionario effettivo (base + override condivisi). Nessuna
     verifica semantica: "ROMA" sotto "Animali" è valida finché i
     giocatori non la contestano ALL'UNANIMITÀ (autore incluso);
   - punti per categoria: 0 / 5 / 10 / 20 (mai sommati tra loro).

   Il dizionario e la normalizzazione sono quelli di Ruzzle e di
   Patata Bollente: stesso file (../../dizionario.txt), stessa
   normalizeWord, stesso ordine di precedenza degli override
   (base → extra → excluded, le esclusioni vincono).
   ========================================================= */
(function (global) {
  'use strict';

  /* ---------------- COSTANTI ---------------- */
  const MIN_WORD_LENGTH = 4;         // come Ruzzle/Patata: il file non contiene parole più corte
  const PUNTI_DUPLICATO = 5;         // valida, uguale ad almeno un'altra valida
  const PUNTI_DISTINTA = 10;         // valida non duplicata, con altre valide nella categoria
  const PUNTI_SOLO_VALIDA = 20;      // unica risposta valida della categoria (precede il 10)
  const PUNTI_ALLENAMENTO = 10;      // allenamento solo: 10 per risposta automaticamente valida
  const TIMEOUT_GRACE = 2500;        // tolleranza sulle scadenze condivise (convenzione Patata)
  const RISULTATI_HOLD_MS = 9000;    // quanto resta visibile il recap del round prima di avanzare
  const STUCK_FALLBACK_MS = 12000;   // subentro se il referente non agisce (convenzione Patata)
  const ACTION_RETRY_MIN = 2000;
  const ACTION_RETRY_MAX = 30000;
  const RATE_LIMIT_BACKOFF_MIN = 4000;
  const RATE_LIMIT_BACKOFF_MAX = 60000;
  const TICK_MS = 1000;
  const DICT_CACHE_TTL = 24 * 60 * 60 * 1000;   // 24 ore, come gli altri giochi
  const DICT_CACHE_KEY = 'faw_ncc_dict_override';
  // Chiave usata da Patata Bollente per lo stesso documento config/dizionario:
  // la leggiamo come sorgente secondaria per non pagare una lettura in più.
  const DICT_CACHE_KEY_ALT = 'faw_patata_dict_override';

  /* ---------------- CATEGORIE ----------------
     Gli identificativi (`id`) sono stabili e usati come chiavi nei dati;
     le etichette (`label`) sono solo visualizzate e possono cambiare. */
  const CATEGORIE_BASE = [
    { id: 'nomi', label: 'Nomi', icona: '👤' },
    { id: 'cose', label: 'Cose', icona: '📦' },
    { id: 'citta', label: 'Città', icona: '🏙️' },
    { id: 'animali', label: 'Animali', icona: '🐾' },
    { id: 'mestieri', label: 'Mestieri', icona: '🛠️' },
    { id: 'piante', label: 'Piante', icona: '🌿' }
  ];
  const PRESET_CATEGORIE = {
    light: ['nomi', 'cose', 'citta'],
    classic: ['nomi', 'cose', 'citta', 'animali', 'mestieri', 'piante']
  };
  const MAX_CATEGORIE = 10;
  const MIN_CATEGORIE = 1;

  /* Lettere supportate di default: nel dizionario condiviso le parole
     partono quasi sempre da queste. L'insieme è configurabile per partita
     tramite `opzioni.lettere` (array di singole lettere maiuscole). */
  const LETTERE_BASE = [
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'I', 'L', 'M',
    'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'Z'
  ];

  /* ---------------- RNG DETERMINISTICO (schema Ruzzle/Patata) ---------------- */
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
      let t = (a + d) | 0;
      a = b ^ (b >>> 9);
      b = (b + c) | 0;
      c = (c << 21 | c >>> 11);
      d = (d + 1) | 0;
      t = (t + d) | 0;
      c = (c + t) | 0;
      return ((t = (t + d) | 0) >>> 0) / 4294967296;
    };
  }

  /* ---------------- NORMALIZZAZIONE (identica a Ruzzle/Patata) ---------------- */
  function normalizeWord(raw) {
    return (raw == null ? '' : String(raw))
      .trim()
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z]/g, '');
  }

  /**
   * Identificativo "sicuro" per chiavi di mappa e ID documento.
   * Gli username FaW sono `.trim().toUpperCase()` liberi (possono contenere
   * spazi, punti, emoji): NON sono usabili come dot-path né come ID doc.
   * Qui teniamo solo [A-Z0-9]; le chiavi definitive usano comunque gli
   * indici (c0, p1), questa serve per categorie personalizzate e fallback.
   */
  function safeId(raw, fallback) {
    const s = normalizeWord(raw).replace(/[^A-Z0-9]/g, '').slice(0, 24);
    return s || (fallback || 'X');
  }

  /** Hash veloce e stabile (FNV-1a) per il fingerprint del dizionario. */
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  /* ---------------- DIZIONARIO ----------------
     Precedenza (la stessa di Ruzzle e Patata Bollente):
     1. file base ../../dizionario.txt (filtrato a MIN_WORD_LENGTH);
     2. override condivisi `extra` (config/dizionario) aggiunti;
     3. override condivisi `excluded` rimossi PER ULTIMI → le esclusioni
        vincono sulle aggiunte.
     Il fingerprint riassume il dizionario EFFETTIVO, così due client con
     cache diverse si accorgono della divergenza prima di validare. */
  function normalizzaListaOverride(lista) {
    const out = [];
    const visti = new Set();
    (Array.isArray(lista) ? lista : []).forEach((w) => {
      const n = normalizeWord(w);
      if (n.length >= MIN_WORD_LENGTH && !visti.has(n)) { visti.add(n); out.push(n); }
    });
    out.sort();
    return out;
  }

  /**
   * Costruisce il dizionario effettivo e il suo fingerprint.
   * @param {string} testoBase contenuto di dizionario.txt
   * @param {{extra?:string[],excluded?:string[]}} overrides
   * @returns {{parole:Set<string>,extra:string[],excluded:string[],fingerprint:string,conteggio:number}}
   */
  function costruisciDizionario(testoBase, overrides) {
    const extra = normalizzaListaOverride(overrides && overrides.extra);
    const excluded = normalizzaListaOverride(overrides && overrides.excluded);
    const parole = new Set();
    const righe = String(testoBase || '').split('\n');
    for (let i = 0; i < righe.length; i++) {
      const w = normalizeWord(righe[i]);
      if (w.length >= MIN_WORD_LENGTH) parole.add(w);
    }
    extra.forEach((w) => parole.add(w));
    excluded.forEach((w) => parole.delete(w));
    return {
      parole,
      extra,
      excluded,
      conteggio: parole.size,
      fingerprint: fingerprintDizionario({ conteggio: parole.size, extra, excluded })
    };
  }

  /** Fingerprint del dizionario effettivo (indipendente dal client). */
  function fingerprintDizionario(d) {
    const extra = normalizzaListaOverride(d && d.extra);
    const excluded = normalizzaListaOverride(d && d.excluded);
    const conteggio = (d && d.conteggio) || 0;
    return 'v1:' + fnv1a(MIN_WORD_LENGTH + ':' + conteggio + ':' + extra.join(',') + '|' + excluded.join(','));
  }

  /** Applica solo gli override a un dizionario già costruito (riallineamento mirato). */
  function applicaOverride(dizionario, overrides) {
    const extra = normalizzaListaOverride(overrides && overrides.extra);
    const excluded = normalizzaListaOverride(overrides && overrides.excluded);
    const parole = new Set(dizionario ? dizionario.parole : []);
    // Riparte dallo stato "solo base": rimuove i precedenti extra, poi riapplica.
    (dizionario && dizionario.extra ? dizionario.extra : []).forEach((w) => parole.delete(w));
    extra.forEach((w) => parole.add(w));
    excluded.forEach((w) => parole.delete(w));
    return {
      parole,
      extra,
      excluded,
      conteggio: parole.size,
      fingerprint: fingerprintDizionario({ conteggio: parole.size, extra, excluded })
    };
  }

  /** Parole del dizionario che iniziano per una lettera (informazione, non autorità). */
  function conteggioPerIniziale(dizionario, lettera) {
    if (!dizionario || !dizionario.parole) return 0;
    const l = normalizeWord(lettera).charAt(0);
    if (!l) return 0;
    let n = 0;
    dizionario.parole.forEach((w) => { if (w.charAt(0) === l) n++; });
    return n;
  }

  /* ---------------- LETTERE ---------------- */
  function lettereSupportate(opzioni) {
    const lista = opzioni && Array.isArray(opzioni.lettere) ? opzioni.lettere : null;
    if (!lista || !lista.length) return LETTERE_BASE.slice();
    const out = [];
    lista.forEach((l) => {
      const c = normalizeWord(l).charAt(0);
      if (c && out.indexOf(c) === -1) out.push(c);
    });
    return out.length ? out : LETTERE_BASE.slice();
  }

  /**
   * Sequenza di lettere del round: deterministica sul seed condiviso.
   * Mescola l'insieme supportato con Fisher-Yates e lo ripete a blocchi,
   * quindi le lettere non si ripetono finché il blocco non è esaurito.
   * Nessun client estrae per conto proprio.
   */
  function generaSequenzaLettere(seed, lettere, quanti) {
    const pool = lettereSupportate({ lettere });
    const n = Math.max(0, parseInt(quanti, 10) || 0);
    if (!n) return [];
    const rand = sfc32.apply(null, cyrb128((seed || 'SEED') + '::ncc-lettere::'));
    const seq = [];
    while (seq.length < n) {
      const bag = pool.slice();
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const tmp = bag[i]; bag[i] = bag[j]; bag[j] = tmp;
      }
      for (let i = 0; i < bag.length && seq.length < n; i++) seq.push(bag[i]);
    }
    return seq;
  }

  /** Lettera del round (derivata dal seed; nel documento resta comunque salvata). */
  function letteraPerRound(seed, lettere, round) {
    const r = Math.max(1, parseInt(round, 10) || 1);
    return generaSequenzaLettere(seed, lettere, r)[r - 1] || lettereSupportate({ lettere })[0];
  }

  /* ---------------- CATEGORIE ---------------- */
  function categorieBase() {
    return CATEGORIE_BASE.map((c) => ({ id: c.id, label: c.label, icona: c.icona }));
  }

  /**
   * Risolve le categorie della partita.
   * Accetta: un preset ('light'|'classic'), un array di id, oppure un array
   * di oggetti {id,label} (categorie personalizzate dalla configurazione).
   */
  function categoriePerPartita(input) {
    let lista = null;
    if (typeof input === 'string') {
      lista = PRESET_CATEGORIE[input] || PRESET_CATEGORIE.classic;
    } else if (Array.isArray(input) && input.length) {
      lista = input;
    } else {
      lista = PRESET_CATEGORIE.classic;
    }
    const out = [];
    const visti = new Set();
    lista.forEach((item, i) => {
      let id = null;
      let label = null;
      if (typeof item === 'string') {
        const base = CATEGORIE_BASE.filter((c) => c.id === item)[0];
        id = base ? base.id : safeId(item, 'CAT' + i);
        label = base ? base.label : String(item).trim().slice(0, 24);
      } else if (item && typeof item === 'object') {
        const base = CATEGORIE_BASE.filter((c) => c.id === item.id)[0];
        id = base ? base.id : safeId(item.id || item.label, 'CAT' + i);
        label = String(item.label || item.id || '').trim().slice(0, 24) || id;
      }
      if (!id || visti.has(id)) return;
      visti.add(id);
      const base2 = CATEGORIE_BASE.filter((c) => c.id === id)[0];
      out.push({ id, label: label || id, icona: (item && item.icona) || (base2 ? base2.icona : '📝') });
    });
    if (!out.length) out.push({ id: 'nomi', label: 'Nomi', icona: '👤' });
    return out.slice(0, MAX_CATEGORIE);
  }

  function etichettaCategoria(categorie, id) {
    const c = (categorie || []).filter((x) => x && x.id === id)[0];
    return c ? c.label : String(id || '');
  }

  /* ---------------- CHIAVI STABILI ----------------
     Chiavi di cella = indici, non nomi: niente punti nei dot-path, niente
     collisioni fra username o categorie personalizzate. */
  function catKey(i) { return 'c' + i; }
  function playerKey(i) { return 'p' + i; }
  function cellKey(catIdx, playerIdx) { return catKey(catIdx) + '_' + playerKey(playerIdx); }
  function roundId(round) { return 'r' + round; }
  function docIdRisposta(round, playerIdx) { return roundId(round) + '__' + playerKey(playerIdx); }

  /* ---------------- OPZIONI ---------------- */
  function normOpzioni(raw) {
    const o = raw || {};
    const num = (v, def, min, max) => {
      const n = parseInt(v, 10);
      if (!isFinite(n)) return def;
      return Math.min(max, Math.max(min, n));
    };
    return {
      round: num(o.round != null ? o.round : o.turni, 3, 1, 10),
      tempo: num(o.tempo, 120, 30, 600),
      revisione: num(o.revisione, 90, 20, 600),
      seed: typeof o.seed === 'string' && o.seed ? o.seed : 'SEED',
      mode: o.mode || 'classica',
      categorie: categoriePerPartita(o.categorie),
      lettere: lettereSupportate(o)
    };
  }

  /* ---------------- NORMALIZZAZIONE STATO (Firestore → state) ---------------- */
  function normState(d) {
    const doc = d || {};
    return {
      partecipanti: Array.isArray(doc.partecipanti) ? doc.partecipanti.slice() : [],
      opzioni: normOpzioni(doc.opzioni),
      stato: doc.stato || 'attesa',
      pronti: Array.isArray(doc.pronti) ? doc.pronti.slice() : [],
      round: parseInt(doc.round, 10) || 0,
      roundData: doc.roundData ? normRoundData(doc.roundData) : null,
      punteggi: doc.punteggi && typeof doc.punteggi === 'object' ? doc.punteggi : {},
      risultati: Array.isArray(doc.risultati) ? doc.risultati : [],
      prossimaPartita: doc.prossimaPartita || null,
      prossimaPartitaCreataDa: doc.prossimaPartitaCreataDa || null,
      rivincitaAccettataDa: Array.isArray(doc.rivincitaAccettataDa) ? doc.rivincitaAccettataDa : [],
      rivincitaRifiutataDa: Array.isArray(doc.rivincitaRifiutataDa) ? doc.rivincitaRifiutataDa : []
    };
  }

  function normRoundData(rd) {
    const voti = {};
    const src = (rd && rd.voti) || {};
    Object.keys(src).forEach((k) => { voti[k] = Array.isArray(src[k]) ? src[k].slice() : []; });
    return {
      id: rd.id || roundId(rd.round || 1),
      round: parseInt(rd.round, 10) || 1,
      lettera: normalizeWord(rd.lettera).charAt(0) || 'A',
      categorie: Array.isArray(rd.categorie) ? rd.categorie.slice() : [],
      partecipanti: Array.isArray(rd.partecipanti) ? rd.partecipanti.slice() : [],
      fase: rd.fase || 'compilazione',
      faseVersion: parseInt(rd.faseVersion, 10) || 1,
      inizio: parseInt(rd.inizio, 10) || 0,
      deadline: parseInt(rd.deadline, 10) || 0,
      stop: rd.stop || null,
      voti,
      conferme: Array.isArray(rd.conferme) ? rd.conferme.slice() : [],
      esitoId: rd.esitoId || null,
      dictVersion: rd.dictVersion || null,
      annullateManuali: Array.isArray(rd.annullateManuali) ? rd.annullateManuali.slice() : []
    };
  }

  /** Dati del round nuovo: categorie, partecipanti e lettera fissati PRIMA della compilazione. */
  function nuovoRoundData(round, state, now, dictVersion) {
    const op = state.opzioni;
    const lettera = letteraPerRound(op.seed, op.lettere, round);
    return {
      id: roundId(round),
      round,
      lettera,
      categorie: op.categorie.map((c) => c.id),
      partecipanti: state.partecipanti.slice(),
      fase: 'compilazione',
      faseVersion: 1,
      inizio: now,
      deadline: now + op.tempo * 1000,
      stop: null,
      voti: {},
      conferme: [],
      esitoId: null,
      dictVersion: dictVersion || null,
      annullateManuali: []
    };
  }

  function mapZero(partecipanti) {
    const out = {};
    (partecipanti || []).forEach((p) => { out[p] = 0; });
    return out;
  }

  /* ---------------- AGGIORNAMENTO A PUNTEGGIATO (dot-path + ops) ----------------
     Ops supportate: {__op:'union'} → arrayUnion, {__op:'remove'} → arrayRemove,
     {__op:'delete'} → FieldValue.delete(). */
  function setPath(obj, path, value) {
    const parts = String(path).split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    const last = parts[parts.length - 1];
    if (value && value.__op === 'delete') {
      delete cur[last];
    } else if (value && value.__op === 'union') {
      if (!Array.isArray(cur[last])) cur[last] = [];
      (value.items || []).forEach((it) => {
        const sig = JSON.stringify(it);
        if (!cur[last].some((x) => JSON.stringify(x) === sig)) cur[last].push(it);
      });
    } else if (value && value.__op === 'remove') {
      if (!Array.isArray(cur[last])) return;
      const firme = (value.items || []).map((it) => JSON.stringify(it));
      cur[last] = cur[last].filter((x) => firme.indexOf(JSON.stringify(x)) === -1);
    } else {
      cur[last] = value;
    }
  }
  function applyPartial(obj, up) {
    Object.keys(up || {}).forEach((k) => setPath(obj, k, up[k]));
  }
  function toFirestoreUpdate(up, fsMod) {
    const out = {};
    Object.keys(up || {}).forEach((k) => {
      const v = up[k];
      if (v && v.__op === 'delete') out[k] = fsMod.FieldValue.delete();
      else if (v && v.__op === 'union') out[k] = fsMod.FieldValue.arrayUnion.apply(fsMod.FieldValue, v.items || []);
      else if (v && v.__op === 'remove') out[k] = fsMod.FieldValue.arrayRemove.apply(fsMod.FieldValue, v.items || []);
      else out[k] = v;
    });
    return out;
  }
  function docExists(snap) {
    if (!snap) return false;
    if (typeof snap.exists === 'function') {
      try { return !!snap.exists(); } catch (e) { return false; }
    }
    return !!snap.exists;
  }
  function isRateLimitError(e) {
    if (!e) return false;
    const code = String(e.code || '');
    const msg = String(e.message || '');
    if (code === 'resource-exhausted') return true;
    return /429|too many requests|quota exceeded|rate ?limit/i.test(msg);
  }

  /* ---------------- VALIDAZIONE (pura) ----------------
     Il sistema NON verifica la semantica: una parola esistente con iniziale
     corretta è accettabile anche se fuori categoria; la contestano i giocatori. */
  function validaRisposta(raw, lettera, dizionario) {
    const testo = raw == null ? '' : String(raw);
    const norm = normalizeWord(testo);
    if (!testo.trim() || !norm) return { ok: false, motivo: 'VUOTA', raw: testo, norm: norm };
    const iniziale = normalizeWord(lettera).charAt(0);
    if (norm.charAt(0) !== iniziale) return { ok: false, motivo: 'INIZIALE', raw: testo, norm: norm };
    if (!dizionario || !dizionario.parole) {
      return { ok: false, motivo: 'DIZIONARIO_NON_PRONTO', raw: testo, norm: norm };
    }
    if (!dizionario.parole.has(norm)) return { ok: false, motivo: 'ASSENTE', raw: testo, norm: norm };
    return { ok: true, motivo: null, raw: testo, norm: norm };
  }

  function motivoTesto(motivo, lettera) {
    if (motivo === 'VUOTA') return 'Risposta vuota';
    if (motivo === 'INIZIALE') return 'Non inizia per ' + (lettera || '?');
    if (motivo === 'ASSENTE') return 'Parola assente dal dizionario';
    if (motivo === 'DIZIONARIO_NON_PRONTO') return 'Dizionario non caricato';
    if (motivo === 'ANNULLATA_MANUALE') return 'Annullata manualmente';
    return '';
  }

  /* ---------------- CONTESTAZIONI: UNANIMITÀ ----------------
     Una risposta è annullata SOLO se TUTTI i partecipanti al round votano
     "Non valida", autore INCLUSO. Non valgono maggioranza, unanimità dei
     soli avversari, né l'assenza di voto come consenso.
     Il quorum è `roundData.partecipanti`, fissato all'inizio del round. */
  function rispostaAnnullata(voti, quorum) {
    if (!Array.isArray(quorum) || !quorum.length) return false;
    const lista = Array.isArray(voti) ? voti : [];
    return quorum.every((p) => lista.indexOf(p) !== -1);
  }

  function statoVotazione(voti, quorum) {
    const lista = Array.isArray(voti) ? voti : [];
    const tot = (quorum || []).length;
    return { voti: lista.length, quorum: tot, unanime: rispostaAnnullata(voti, quorum) };
  }

  /* ---------------- PUNTEGGI (puri) ---------------- */
  /**
   * Punti di UNA categoria. Variante classica dichiarata in UI:
   *  0  → vuota o definitivamente non valida;
   *  20 → unica risposta valida della categoria (precede il 10);
   *  5  → valida e uguale ad almeno un'altra valida;
   * 10  → valida e non duplicata, con altre valide nella categoria.
   * I punti non si sommano mai tra loro.
   * @param {Array} gruppo celle della stessa categoria
   */
  function assegnaPuntiCategoria(gruppo) {
    const celle = Array.isArray(gruppo) ? gruppo : [];
    const valide = celle.filter((c) => c.valida && !c.annullata);
    if (!valide.length) {
      celle.forEach((c) => { c.punti = 0; });
      return celle;
    }
    const conteggi = {};
    valide.forEach((c) => { conteggi[c.norm] = (conteggi[c.norm] || 0) + 1; });
    celle.forEach((c) => {
      if (!c.valida || c.annullata) { c.punti = 0; return; }
      if (valide.length === 1) c.punti = PUNTI_SOLO_VALIDA;
      else if ((conteggi[c.norm] || 0) > 1) c.punti = PUNTI_DUPLICATO;
      else c.punti = PUNTI_DISTINTA;
    });
    return celle;
  }

  /**
   * Esito congelato di un round: validazione + contestazioni + punti.
   * Deterministico: stessi input (risposte accettate, voti, quorum,
   * dizionario) → identico risultato su ogni client.
   */
  function calcolaEsitoRound(opts) {
    const rd = opts.roundData;
    const risposte = opts.risposte || {};
    const dizionario = opts.dizionario;
    const quorum = rd.partecipanti || [];
    const celle = [];

    (rd.categorie || []).forEach((catId, ci) => {
      quorum.forEach((nome, pi) => {
        const k = cellKey(ci, pi);
        const r = (risposte[nome] && risposte[nome][catId]) || null;
        const v = validaRisposta(r ? r.raw : '', rd.lettera, dizionario);
        const voti = (rd.voti && rd.voti[k]) ? rd.voti[k].slice() : [];
        const annullata = v.ok && rispostaAnnullata(voti, quorum);
        celle.push({
          k: k, c: catKey(ci), p: playerKey(pi),
          cat: catId, nome: nome,
          raw: v.raw, norm: v.norm,
          valida: v.ok, motivo: v.motivo,
          voti: voti, annullata: annullata, punti: 0
        });
      });
    });

    (rd.categorie || []).forEach((catId, ci) => {
      assegnaPuntiCategoria(celle.filter((c) => c.c === catKey(ci)));
    });

    const punti = mapZero(quorum);
    celle.forEach((c) => { punti[c.nome] = (punti[c.nome] || 0) + c.punti; });

    const risultato = {
      id: rd.id,
      round: rd.round,
      lettera: rd.lettera,
      celle: celle,
      punti: punti
    };
    return { celle: celle, punti: punti, risultato: risultato };
  }

  /** Punteggio di allenamento: 10 per risposta automaticamente valida, 0 altrimenti. */
  function assegnaPuntiAllenamento(gruppo) {
    (Array.isArray(gruppo) ? gruppo : []).forEach((c) => {
      c.punti = (c.valida && !c.annullata) ? PUNTI_ALLENAMENTO : 0;
    });
    return gruppo;
  }

  /**
   * Esito di un round in ALLENAMENTO: nessun quorum, nessuna votazione.
   * L'annullamento manuale (`annullateManuali`) è distinto dalla validazione
   * automatica e vale solo localmente (mai scritto su Firestore).
   */
  function calcolaEsitoAllenamento(opts) {
    const rd = opts.roundData;
    const risposte = opts.risposte || {};
    const dizionario = opts.dizionario;
    const manuali = opts.annullateManuali || [];
    const celle = [];
    (rd.categorie || []).forEach((catId, ci) => {
      (rd.partecipanti || []).forEach((nome, pi) => {
        const k = cellKey(ci, pi);
        const r = (risposte[nome] && risposte[nome][catId]) || null;
        const v = validaRisposta(r ? r.raw : '', rd.lettera, dizionario);
        celle.push({
          k: k, c: catKey(ci), p: playerKey(pi), cat: catId, nome: nome,
          raw: v.raw, norm: v.norm, valida: v.ok, motivo: v.motivo,
          motivoAutomatico: v.motivo,
          voti: [], annullata: false,
          annullataManuale: manuali.indexOf(k) !== -1, punti: 0
        });
      });
    });
    celle.forEach((c) => {
      if (!c.annullataManuale) return;
      // Annullamento MANUALE dell'allenamento: distinto dalla validazione
      // automatica (che resta nel campo `motivoAutomatico`) e mai condiviso.
      c.motivoAutomatico = c.motivo;
      c.valida = false;
      c.motivo = 'ANNULLATA_MANUALE';
    });
    assegnaPuntiAllenamento(celle);
    const punti = mapZero(rd.partecipanti);
    celle.forEach((c) => { punti[c.nome] = (punti[c.nome] || 0) + c.punti; });
    return {
      celle: celle,
      punti: punti,
      risultato: { id: rd.id, round: rd.round, lettera: rd.lettera, celle: celle, punti: punti, allenamento: true }
    };
  }

  /**
   * Totali di partita DERIVATI dai risultati dei round.
   * Ogni round è contato una volta sola (per `id`): ripetere la
   * finalizzazione non assegna due volte gli stessi punti.
   */
  function punteggiDaRisultati(risultati, partecipanti) {
    const out = mapZero(partecipanti);
    const visti = new Set();
    (risultati || []).forEach((r) => {
      if (!r || !r.id || visti.has(r.id)) return;
      visti.add(r.id);
      Object.keys(r.punti || {}).forEach((nome) => {
        if (!(nome in out)) out[nome] = 0;
        out[nome] += (r.punti[nome] || 0);
      });
    });
    return out;
  }

  /** Classifica con pari merito (ranking "standard competition": 1,1,3). */
  function classifica(punteggi, partecipanti) {
    const righe = (partecipanti || []).map((nome) => ({
      nome: nome,
      punti: (punteggi && punteggi[nome]) || 0
    })).sort((a, b) => b.punti - a.punti || String(a.nome).localeCompare(String(b.nome)));
    righe.forEach((r, i) => {
      r.posizione = (i > 0 && righe[i - 1].punti === r.punti) ? righe[i - 1].posizione : i + 1;
    });
    return righe;
  }

  function vincitore(punteggi, partecipanti) {
    const c = classifica(punteggi, partecipanti);
    if (!c.length) return null;
    const top = c[0].punti;
    return c.filter((r) => r.punti === top);
  }

  /* ---------------- MUTATORI (puri: state + ctx → update | {__error} | null) ----------------
     Ogni mutatore verifica fase e round attesi: una scrittura riferita a un
     round o a una fase superati produce `null` (operazione abortita), quindi
     le transizioni sono idempotenti e non si ripetono. */

  function mutReady(state, ctx) {
    if (state.stato !== 'attesa') return null;
    if (state.pronti.indexOf(ctx.me) !== -1) return null;
    return { pronti: { __op: 'union', items: [ctx.me] } };
  }

  function mutStart(state, ctx) {
    if (state.stato !== 'attesa' || state.round) return null;
    if (!state.partecipanti.length) return null;
    if (state.pronti.length < state.partecipanti.length) return null;
    if (!ctx.dizionarioPronto) return { __error: { code: 'DIZIONARIO_NON_PRONTO' } };
    const rd = nuovoRoundData(1, state, ctx.now, ctx.dictVersion);
    return {
      stato: 'in_corso',
      round: 1,
      risultati: [],
      punteggi: mapZero(state.partecipanti),
      roundData: rd
    };
  }

  /** STOP: chiude la compilazione e apre la revisione. Il primo accettato vince. */
  function mutStop(state, ctx) {
    if (state.stato !== 'in_corso' || !state.roundData) return null;
    const rd = state.roundData;
    if (rd.fase !== 'compilazione') return null;
    if (rd.stop) return null;                                  // già fermato: idempotente
    if (rd.partecipanti.indexOf(ctx.me) === -1) return { __error: { code: 'NON_PARTECIPANTE' } };
    return {
      'roundData.stop': { da: ctx.me, ts: ctx.now },
      'roundData.fase': 'revisione',
      'roundData.faseVersion': rd.faseVersion + 1,
      'roundData.inizio': ctx.now,
      'roundData.deadline': ctx.now + state.opzioni.revisione * 1000,
      'roundData.conferme': []
    };
  }

  /** Scadenza della compilazione: stessa transizione dello STOP. */
  function mutTimeoutCompilazione(state, ctx) {
    if (state.stato !== 'in_corso' || !state.roundData) return null;
    const rd = state.roundData;
    if (rd.fase !== 'compilazione') return null;
    if (rd.stop) return null;
    if (ctx.now <= rd.deadline + TIMEOUT_GRACE) return null;
    return {
      'roundData.stop': { da: 'TEMPO', ts: ctx.now },
      'roundData.fase': 'revisione',
      'roundData.faseVersion': rd.faseVersion + 1,
      'roundData.inizio': ctx.now,
      'roundData.deadline': ctx.now + state.opzioni.revisione * 1000,
      'roundData.conferme': []
    };
  }

  /**
   * Voto "Non valida" / ritiro del voto.
   * Cambiare un voto revoca la propria conferma di revisione.
   */
  function mutVota(state, ctx) {
    if (state.stato !== 'in_corso' || !state.roundData) return null;
    const rd = state.roundData;
    if (rd.fase !== 'revisione') return { __error: { code: 'REVISIONE_CHIUSA' } };
    if (rd.partecipanti.indexOf(ctx.me) === -1) return { __error: { code: 'NON_PARTECIPANTE' } };
    const key = ctx.key;
    if (!key) return null;
    const voti = rd.voti[key] || [];
    const hoVotato = voti.indexOf(ctx.me) !== -1;
    if (ctx.vota && hoVotato) return null;
    if (!ctx.vota && !hoVotato) return null;
    const up = {};
    up['roundData.voti.' + key] = ctx.vota
      ? { __op: 'union', items: [ctx.me] }
      : { __op: 'remove', items: [ctx.me] };
    if (rd.conferme.indexOf(ctx.me) !== -1) {
      up['roundData.conferme'] = { __op: 'remove', items: [ctx.me] };
    }
    return up;
  }

  function mutConfermaRevisione(state, ctx) {
    if (state.stato !== 'in_corso' || !state.roundData) return null;
    const rd = state.roundData;
    if (rd.fase !== 'revisione') return { __error: { code: 'REVISIONE_CHIUSA' } };
    if (rd.partecipanti.indexOf(ctx.me) === -1) return { __error: { code: 'NON_PARTECIPANTE' } };
    if (rd.conferme.indexOf(ctx.me) !== -1) return null;
    return { 'roundData.conferme': { __op: 'union', items: [ctx.me] } };
  }

  /**
   * Chiusura della revisione: congela voti ed esito.
   * Serve la conferma di TUTTI i partecipanti del round oppure la scadenza;
   * una contestazione non unanime alla scadenza lascia valida la risposta.
   * Richiede le risposte del round già caricate: senza, non si congela nulla
   * (altrimenti un client senza dati assegnerebbe zeri a caso).
   */
  function mutChiudiRevisione(state, ctx) {
    if (state.stato !== 'in_corso' || !state.roundData) return null;
    const rd = state.roundData;
    if (rd.fase !== 'revisione') return null;
    if (rd.esitoId) return null;                                  // già congelato
    if ((state.risultati || []).some((r) => r && r.id === rd.id)) return null;
    const quorum = rd.partecipanti;
    const tutti = quorum.length > 0 && quorum.every((p) => rd.conferme.indexOf(p) !== -1);
    const scaduto = ctx.now > rd.deadline + TIMEOUT_GRACE;
    if (!tutti && !scaduto) return null;
    if (!ctx.rispostePronte) return { __error: { code: 'RISPOSTE_NON_PRONTE' } };
    if (!ctx.dizionarioPronto) return { __error: { code: 'DIZIONARIO_NON_PRONTO' } };
    const esito = calcolaEsitoRound({
      roundData: rd, risposte: ctx.risposte || {}, dizionario: ctx.dizionario
    });
    const risultati = (state.risultati || []).concat([esito.risultato]);
    return {
      'roundData.esitoId': rd.id,
      'roundData.fase': 'risultati',
      'roundData.faseVersion': rd.faseVersion + 1,
      'roundData.inizio': ctx.now,
      'roundData.deadline': ctx.now + RISULTATI_HOLD_MS,
      risultati: { __op: 'union', items: [esito.risultato] },
      punteggi: punteggiDaRisultati(risultati, state.partecipanti)
    };
  }

  /** Avanzamento: round successivo o partita conclusa. */
  function mutProssimoRound(state, ctx) {
    if (state.stato !== 'in_corso' || !state.roundData) return null;
    const rd = state.roundData;
    if (rd.fase !== 'risultati') return null;
    if (!rd.esitoId) return null;
    if (ctx.now <= rd.deadline) return null;   // il recap resta visibile
    if (state.round >= state.opzioni.round) {
      return {
        stato: 'conclusa',
        punteggi: punteggiDaRisultati(state.risultati, state.partecipanti)
      };
    }
    const next = state.round + 1;
    return {
      round: next,
      roundData: nuovoRoundData(next, state, ctx.now, ctx.dictVersion)
    };
  }

  /* ---------------- ALLENAMENTO SOLO ----------------
     Un solo giocatore: nessuna revisione, nessun quorum. La consegna
     congela subito l'esito con il punteggio di allenamento (10/0) e
     l'annullamento manuale resta un'azione esplicita e separata. */
  function mutConsegnaSolo(state, ctx) {
    if (state.stato !== 'in_corso' || !state.roundData) return null;
    const rd = state.roundData;
    if (rd.fase !== 'compilazione') return null;
    if (rd.esitoId) return null;
    if (!ctx.dizionarioPronto) return { __error: { code: 'DIZIONARIO_NON_PRONTO' } };
    const esito = calcolaEsitoAllenamento({
      roundData: rd,
      risposte: ctx.risposte || {},
      dizionario: ctx.dizionario,
      annullateManuali: rd.annullateManuali || []
    });
    const risultati = (state.risultati || []).concat([esito.risultato]);
    return {
      'roundData.stop': { da: ctx.me, ts: ctx.now },
      'roundData.esitoId': rd.id,
      'roundData.fase': 'risultati',
      'roundData.faseVersion': rd.faseVersion + 1,
      'roundData.inizio': ctx.now,
      'roundData.deadline': ctx.now + RISULTATI_HOLD_MS,
      risultati: { __op: 'union', items: [esito.risultato] },
      punteggi: punteggiDaRisultati(risultati, state.partecipanti)
    };
  }

  /** Annullamento MANUALE in allenamento: distinto dalla validazione automatica. */
  function mutAnnullaManualeSolo(state, ctx) {
    if (state.stato !== 'in_corso' || !state.roundData) return null;
    const rd = state.roundData;
    if (rd.fase !== 'risultati' || !rd.esitoId) return null;
    if (!ctx.dizionarioPronto) return { __error: { code: 'DIZIONARIO_NON_PRONTO' } };
    const lista = (rd.annullateManuali || []).slice();
    const i = lista.indexOf(ctx.key);
    if (ctx.annulla) { if (i !== -1) return null; lista.push(ctx.key); }
    else { if (i === -1) return null; lista.splice(i, 1); }
    const idx = (state.risultati || []).findIndex((r) => r && r.id === rd.id);
    if (idx === -1) return null;
    const esito = calcolaEsitoAllenamento({
      roundData: rd,
      risposte: ctx.risposte || {},
      dizionario: ctx.dizionario,
      annullateManuali: lista
    });
    const risultati = (state.risultati || []).slice();
    risultati[idx] = esito.risultato;
    return {
      'roundData.annullateManuali': lista,
      risultati: risultati,
      punteggi: punteggiDaRisultati(risultati, state.partecipanti)
    };
  }

  /* ---------------- HELPERS DI FASE ---------------- */
  function quorumRound(state) {
    return (state.roundData && state.roundData.partecipanti) || [];
  }
  function referenteAzione(state) {
    const rd = state.roundData;
    const lista = (rd && rd.partecipanti && rd.partecipanti.length)
      ? rd.partecipanti : state.partecipanti;
    if (!lista.length) return null;
    const idx = ((state.round || 1) - 1) % lista.length;
    return lista[idx];
  }
  function risposteComplete(risposte, categorie, partecipanti) {
    return true; // la completezza è garantita dallo snapshot, non dal contenuto
  }

  /* ---------------- ESPOSIZIONE ---------------- */
  const core = {
    // costanti
    MIN_WORD_LENGTH, PUNTI_DUPLICATO, PUNTI_DISTINTA, PUNTI_SOLO_VALIDA,
    PUNTI_ALLENAMENTO, TIMEOUT_GRACE, RISULTATI_HOLD_MS, STUCK_FALLBACK_MS,
    ACTION_RETRY_MIN, ACTION_RETRY_MAX, RATE_LIMIT_BACKOFF_MIN,
    RATE_LIMIT_BACKOFF_MAX, TICK_MS, DICT_CACHE_TTL, DICT_CACHE_KEY,
    DICT_CACHE_KEY_ALT, CATEGORIE_BASE, PRESET_CATEGORIE, LETTERE_BASE,
    MAX_CATEGORIE, MIN_CATEGORIE,
    // rng / lettere
    cyrb128, sfc32, generaSequenzaLettere, letteraPerRound, lettereSupportate,
    conteggioPerIniziale,
    // dizionario
    normalizeWord, safeId, fnv1a, normalizzaListaOverride, costruisciDizionario,
    fingerprintDizionario, applicaOverride,
    // categorie / chiavi
    categorieBase, categoriePerPartita, etichettaCategoria,
    catKey, playerKey, cellKey, roundId, docIdRisposta,
    // stato
    normOpzioni, normState, normRoundData, nuovoRoundData, mapZero,
    setPath, applyPartial, toFirestoreUpdate, docExists, isRateLimitError,
    // regole
    validaRisposta, motivoTesto, rispostaAnnullata, statoVotazione,
    assegnaPuntiCategoria, calcolaEsitoRound, assegnaPuntiAllenamento,
    calcolaEsitoAllenamento, punteggiDaRisultati, classifica, vincitore,
    // mutatori
    mutReady, mutStart, mutStop, mutTimeoutCompilazione, mutVota,
    mutConfermaRevisione, mutChiudiRevisione, mutProssimoRound,
    mutConsegnaSolo, mutAnnullaManualeSolo,
    // helper
    quorumRound, referenteAzione, risposteComplete
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  if (global) global.__NCC_CORE = core;
})(typeof window !== 'undefined' ? window : globalThis);
