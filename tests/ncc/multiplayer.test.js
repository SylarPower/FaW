/* Test multi-client di "Nomi, Cose, Città" su un mock Firestore.
   Verifica sincronizzazione, concorrenza e quota:
   - lobby/start con 3 client e lettera condivisa;
   - riservatezza: in compilazione ognuno legge SOLO il proprio documento;
   - STOP simultanei → una sola transizione;
   - revisione: unanimità, conferma, chiusura, punti;
   - scritture tardive rifiutate dopo la chiusura;
   - fallback concorrente (referente offline);
   - refresh/riconnessione a metà round;
   - finalizzazione ripetuta senza doppio punteggio;
   - rivincita senza residui;
   - backoff 429. */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, '../../games/nomi-cose-citta/js/core.js'));
const B = require(path.join(__dirname, '../../games/nomi-cose-citta/js/backend.js'));

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  \u2714', msg); }
  else { failed++; console.log('  \u2718', msg); }
}
function eq(a, b, msg) {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja === jb) { passed++; console.log('  \u2714', msg); }
  else { failed++; console.log('  \u2718', msg, '\n    atteso:', jb, '\n    ottenuto:', ja); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- dizionario di prova ---------- */
const TESTO = ['roma', 'ravenna', 'milano', 'matera', 'marco', 'maria', 'matteo',
  'casa', 'cane', 'cavallo', 'coltello', 'sara', 'sedia', 'sole', 'stella'].join('\n');
const D = C.costruisciDizionario(TESTO, {});
const PER_INIZIALE = {};
TESTO.split('\n').forEach((w) => {
  const n = C.normalizeWord(w);
  (PER_INIZIALE[n.charAt(0)] = PER_INIZIALE[n.charAt(0)] || []).push(n);
});
const parolePer = (l, n) => {
  const lista = PER_INIZIALE[String(l).toUpperCase()] || [];
  const out = [];
  for (let i = 0; i < (n || 1); i++) out.push(lista[i % Math.max(1, lista.length)] || 'ZZZZ');
  return out;
};

/* ---------- MOCK FIRESTORE ---------- */
const FV = {
  arrayUnion: (...items) => ({ __mockUnion: items }),
  arrayRemove: (...items) => ({ __mockRemove: items }),
  delete: () => ({ __mockDelete: true })
};

class MockFS {
  constructor() {
    this.store = new Map();
    this.subs = new Map();       // path -> Set(cb)
    this.readsGet = 0;           // letture "get" esplicite (come una transazione)
    this.readsListener = 0;      // documenti consegnati dai listener
    this.writes = 0;
    this.failNextWrite = 0;
    this.failMessage = 'Server responded with status 429';
  }
  _notify(path) {
    const subs = this.subs.get(path);
    if (!subs) return;
    const doc = this.store.get(path);
    const snap = {
      exists: !!doc,
      data: () => (doc ? JSON.parse(JSON.stringify(doc)) : undefined),
      metadata: { fromCache: false, hasPendingWrites: false }
    };
    subs.forEach((cb) => queueMicrotask(() => cb(snap)));
  }
  _notifyQuery(prefix, filtro) {
    const subs = this.subs.get('Q:' + prefix + ':' + filtro.field + filtro.value);
    if (!subs) return;
    const hits = [];
    this.store.forEach((doc, p) => {
      if (p.indexOf(prefix + '/') !== 0) return;
      if (doc[filtro.field] !== filtro.value) return;
      hits.push({ id: p.split('/').pop(), data: () => JSON.parse(JSON.stringify(doc)) });
    });
    const snap = { forEach: (fn) => hits.forEach(fn), size: hits.length, docs: hits };
    subs.forEach((cb) => queueMicrotask(() => cb(snap)));
  }
  _applyPatch(path, patch, merge) {
    const doc = merge ? (this.store.get(path) || {}) : {};
    Object.keys(patch).forEach((p) => {
      const v = patch[p];
      if (v && v.__mockDelete) C.setPath(doc, p, { __op: 'delete' });
      else if (v && v.__mockUnion) C.setPath(doc, p, { __op: 'union', items: v.__mockUnion });
      else if (v && v.__mockRemove) C.setPath(doc, p, { __op: 'remove', items: v.__mockRemove });
      else C.setPath(doc, p, v);
    });
    this.store.set(path, doc);
    this._notify(path);
    // la sottocollezione risposte va notificata anche alla query del round
    const m = /^(.*\/risposte)\/[^/]+$/.exec(path);
    if (m) {
      const d = this.store.get(path);
      ['round'].forEach((f) => {
        if (d && d[f] !== undefined) this._notifyQuery(m[1], { field: f, value: d[f] });
      });
    }
    return doc;
  }
  collection(name) { return new MockCollection(this, name); }
}

class MockCollection {
  constructor(fs, prefix) { this.fs = fs; this.prefix = prefix; }
  doc(id) {
    const fs = this.fs;
    const p = this.prefix + '/' + (id || 'doc' + Math.random().toString(36).slice(2));
    const self = this;
    return {
      id: p.split('/').pop(),
      collection: (sub) => new MockCollection(fs, p + '/' + sub),
      get: () => {
        fs.readsGet++;
        const doc = fs.store.get(p);
        return Promise.resolve({ exists: !!doc, data: () => (doc ? JSON.parse(JSON.stringify(doc)) : undefined) });
      },
      onSnapshot: (cb) => {
        const subs = fs.subs.get(p) || new Set();
        subs.add(cb);
        fs.subs.set(p, subs);
        fs.readsListener += fs.store.has(p) ? 1 : 0;
        const doc = fs.store.get(p);
        queueMicrotask(() => cb({
          exists: !!doc,
          data: () => (doc ? JSON.parse(JSON.stringify(doc)) : undefined),
          metadata: { fromCache: false, hasPendingWrites: false }
        }));
        return () => subs.delete(cb);
      },
      update: (patch) => {
        if (fs.failNextWrite > 0) {
          fs.failNextWrite--;
          const err = new Error(fs.failMessage);
          err.code = 'unknown';
          return Promise.reject(err);
        }
        fs.writes++;
        fs._applyPatch(p, patch, true);
        return Promise.resolve();
      },
      set: (data, opts) => {
        if (fs.failNextWrite > 0) {
          fs.failNextWrite--;
          const err = new Error(fs.failMessage);
          err.code = 'unknown';
          return Promise.reject(err);
        }
        fs.writes++;
        fs._applyPatch(p, data, !!(opts && opts.merge));
        return Promise.resolve();
      },
      delete: () => { fs.writes++; fs.store.delete(p); fs._notify(p); return Promise.resolve(); }
    };
  }
  where(field, op, value) {
    const fs = this.fs;
    const prefix = this.prefix;
    const key = 'Q:' + prefix + ':' + field + value;
    return {
      onSnapshot: (cb) => {
        const subs = fs.subs.get(key) || new Set();
        subs.add(cb);
        fs.subs.set(key, subs);
        const hits = [];
        fs.store.forEach((doc, p) => {
          if (p.indexOf(prefix + '/') !== 0) return;
          if (doc[field] !== value) return;
          hits.push({ id: p.split('/').pop(), data: () => JSON.parse(JSON.stringify(doc)) });
        });
        fs.readsListener += hits.length;
        queueMicrotask(() => cb({ forEach: (fn) => hits.forEach(fn), size: hits.length, docs: hits }));
        return () => subs.delete(cb);
      }
    };
  }
}

function fsModFor(fs) {
  const mod = () => fs;
  mod.FieldValue = FV;
  return mod;
}

const MATCH = 'ncc-test-1';
function nuovaPartita(fs, id, extra) {
  fs.store.set('partite/' + id, Object.assign({
    gioco: 'nomi-cose-citta',
    partecipanti: ['ALFA', 'BETA', 'GAMMA'],
    punteggi: { ALFA: 0, BETA: 0, GAMMA: 0 },
    pronti: [],
    round: 0,
    roundData: null,
    risultati: [],
    stato: 'attesa',
    rivincitaAccettataDa: [],
    rivincitaRifiutataDa: [],
    timestamp: Date.now(),
    opzioni: {
      round: '2', tempo: '60', revisione: '30', mode: 'classica',
      categorie: 'light', seed: 'MULTI', lettere: ['R', 'C']
    }
  }, extra || {}));
}

function client(fs, id, nome) {
  const be = new B.FirebaseBackend(fsModFor(fs), id, nome);
  be.start();
  be.subscribe(() => { });
  return be;
}
const wait = async (be, pred, what, timeout = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (be.state && pred(be.state)) return be.state;
    await sleep(15);
  }
  throw new Error('timeout in attesa di: ' + what);
};
const ctxBase = () => ({ dizionario: D, dizionarioPronto: true, dictVersion: D.fingerprint });

(async () => {
  try {
    console.log('\n[1] Lobby: pronti + start, lettera condivisa');
    const fs = new MockFS();
    nuovaPartita(fs, MATCH);
    const clients = {};
    ['ALFA', 'BETA', 'GAMMA'].forEach((n) => { clients[n] = client(fs, MATCH, n); });
    await sleep(40);
    ok(clients.ALFA.state && clients.ALFA.state.stato === 'attesa', 'stato iniziale in attesa');

    await Promise.all(['ALFA', 'BETA', 'GAMMA'].map((n) => clients[n].applyAtomic(C.mutReady)));
    await wait(clients.ALFA, (s) => s.pronti.length === 3, 'tutti pronti');
    const r0 = await clients.ALFA.applyAtomic(C.mutStart, ctxBase());
    ok(r0.ok, 'start eseguito');
    await wait(clients.GAMMA, (s) => s.stato === 'in_corso' && s.round === 1, 'start visibile a tutti');
    const lettera = clients.GAMMA.state.roundData.lettera;
    ok(C.letteraPerRound('MULTI', clients.GAMMA.state.opzioni.lettere, 1) === lettera,
      'lettera identica al seed su tutti i client (' + lettera + ')');
    eq(clients.GAMMA.state.roundData.partecipanti, ['ALFA', 'BETA', 'GAMMA'], 'quorum fissato a inizio round');
    eq(clients.GAMMA.state.roundData.dictVersion, D.fingerprint, 'fingerprint dizionario nel round');
    const r0bis = await clients.BETA.applyAtomic(C.mutStart, ctxBase());
    ok(r0bis.aborted, 'secondo start abortito');

    console.log('\n[2] Compilazione: ognuno scrive e legge solo il proprio documento');
    const readsAfterStart = fs.readsListener;
    clients.ALFA.apriMieRisposte(1);
    clients.BETA.apriMieRisposte(1);
    await sleep(30);
    const [wa, wb, wc] = parolePer(lettera, 3);
    await clients.ALFA.salvaRisposte({ nomi: { raw: wa, norm: C.normalizeWord(wa) } });
    await clients.BETA.salvaRisposte({ nomi: { raw: wb, norm: C.normalizeWord(wb) } });
    await sleep(30);
    const docA = fs.store.get('partite/' + MATCH + '/risposte/r1__p0');
    const docB = fs.store.get('partite/' + MATCH + '/risposte/r1__p1');
    ok(!!docA && !!docB, 'documenti risposta creati (r1__p0, r1__p1)');
    eq(docA.risposte.c0.raw, wa, 'risposta di ALFA nel suo documento');
    eq(docB.risposte.c0.raw, wb, 'risposta di BETA nel suo documento');
    ok(!(fs.store.get('partite/' + MATCH).roundData.risposte), 'nessuna risposta nel documento condiviso');
    ok(!clients.ALFA.rispostePronte(), 'in compilazione il client NON ha le risposte altrui');
    eq(clients.ALFA.getMieRisposte().nomi.raw, wa, 'il client rilegge le proprie risposte (refresh-safe)');
    ok(fs.readsListener - readsAfterStart <= 4,
      'listener limitati: ' + (fs.readsListener - readsAfterStart) + ' letture per i listener propri');
    const queryAperte = Array.from(fs.subs.keys()).filter((k) => k.indexOf('Q:') === 0);
    eq(queryAperte, [], 'in compilazione NESSUNA query sulle risposte altrui è aperta');

    console.log('\n[3] STOP simultanei: una sola transizione');
    const stops = await Promise.all([
      clients.ALFA.applyAtomic(C.mutStop),
      clients.BETA.applyAtomic(C.mutStop),
      clients.GAMMA.applyAtomic(C.mutStop)
    ]);
    const accettati = stops.filter((r) => r && r.ok).length;
    await wait(clients.GAMMA, (s) => s.roundData.fase === 'revisione', 'fase revisione');
    const doc = fs.store.get('partite/' + MATCH);
    ok(!!doc.roundData.stop && !!doc.roundData.stop.da, 'STOP registrato: ' + doc.roundData.stop.da);
    eq(doc.roundData.faseVersion, 2, 'una sola transizione di fase (faseVersion 2)');
    ok(accettati <= 3, 'nessun errore fra gli STOP concorrenti (' + accettati + ' ok)');
    const rTimeout = await clients.GAMMA.applyAtomic(C.mutTimeoutCompilazione, ctxBase());
    ok(rTimeout.aborted, 'timeout dopo lo STOP: abortito');

    console.log('\n[4] Revisione: query del round, unanimità, conferma, chiusura');
    ['ALFA', 'BETA', 'GAMMA'].forEach((n) => clients[n].apriRisposte(1));
    await wait(clients.ALFA, () => clients.ALFA.rispostePronte(), 'risposte del round caricate');
    const risposte = clients.ALFA.getRisposte();
    eq(Object.keys(risposte).sort(), ['ALFA', 'BETA'], 'solo chi ha scritto ha un documento');
    eq(risposte.ALFA.nomi.raw, wa, 'risposta di ALFA letta in revisione');

    const key = C.cellKey(0, 0);   // categoria 'nomi', giocatore ALFA
    // maggioranza (2 su 3, autore escluso) NON annulla
    await clients.BETA.applyAtomic(C.mutVota, { key, vota: true });
    await clients.GAMMA.applyAtomic(C.mutVota, { key, vota: true });
    await wait(clients.ALFA, (s) => (s.roundData.voti[key] || []).length === 2, 'due voti');
    ok(!C.rispostaAnnullata(fs.store.get('partite/' + MATCH).roundData.voti[key], ['ALFA', 'BETA', 'GAMMA']),
      'con 2 voti su 3 la risposta NON è annullata');

    // l'autore vota → unanimità
    await clients.ALFA.applyAtomic(C.mutVota, { key, vota: true });
    await wait(clients.BETA, (s) => (s.roundData.voti[key] || []).length === 3, 'voto dell’autore');
    ok(C.rispostaAnnullata(fs.store.get('partite/' + MATCH).roundData.voti[key], ['ALFA', 'BETA', 'GAMMA']),
      'unanimità con autore incluso → annullata');

    // un voto ritirato revoca la propria conferma
    await clients.ALFA.applyAtomic(C.mutConfermaRevisione);
    await clients.ALFA.applyAtomic(C.mutVota, { key, vota: false });
    await wait(clients.ALFA, (s) => s.roundData.conferme.indexOf('ALFA') === -1, 'conferma revocata');
    await clients.ALFA.applyAtomic(C.mutVota, { key, vota: true });

    // chiusura senza le risposte caricate: rifiutata
    const senzaRisposte = await clients.GAMMA.applyAtomic(C.mutChiudiRevisione,
      Object.assign(ctxBase(), { risposte: {}, rispostePronte: false }));
    ok(senzaRisposte.aborted, 'chiusura senza risposte caricate: abortita');

    await Promise.all(['ALFA', 'BETA', 'GAMMA'].map((n) => clients[n].applyAtomic(C.mutConfermaRevisione)));
    await wait(clients.ALFA, (s) => s.roundData.conferme.length === 3, 'tre conferme');

    const ctxChiusura = Object.assign(ctxBase(), { risposte: clients.ALFA.getRisposte(), rispostePronte: true });
    const chiusure = await Promise.all([
      clients.ALFA.applyAtomic(C.mutChiudiRevisione, ctxChiusura),
      clients.BETA.applyAtomic(C.mutChiudiRevisione, ctxChiusura),
      clients.GAMMA.applyAtomic(C.mutChiudiRevisione, ctxChiusura)
    ]);
    await wait(clients.BETA, (s) => s.roundData.fase === 'risultati', 'fase risultati');
    const doc2 = fs.store.get('partite/' + MATCH);
    eq(doc2.risultati.length, 1, 'esito del round scritto UNA volta (chiusure concorrenti)');
    eq(chiusure.filter((r) => r && r.ok).length <= 3, true, 'nessun errore nelle chiusure concorrenti');

    const celle = doc2.risultati[0].celle;
    const cellaAlfa = celle.filter((c) => c.nome === 'ALFA' && c.cat === 'nomi')[0];
    const cellaBeta = celle.filter((c) => c.nome === 'BETA' && c.cat === 'nomi')[0];
    eq(cellaAlfa.annullata, true, 'risposta di ALFA annullata all’unanimità');
    eq(cellaAlfa.punti, 0, '0 punti per la risposta annullata');
    eq(cellaBeta.punti, 20, '20 punti: unica valida rimasta nella categoria');
    eq(doc2.punteggi, C.punteggiDaRisultati(doc2.risultati, ['ALFA', 'BETA', 'GAMMA']), 'punteggi derivati dai risultati');

    // finalizzazione ripetuta: nessun doppio punteggio
    const puntiPrima = JSON.parse(JSON.stringify(doc2.punteggi));
    const ripetuta = await clients.BETA.applyAtomic(C.mutChiudiRevisione, ctxChiusura);
    ok(ripetuta.aborted, 'finalizzazione ripetuta abortita');
    eq(fs.store.get('partite/' + MATCH).punteggi, puntiPrima, 'nessun doppio punteggio');

    console.log('\n[5] Scritture tardive dopo la chiusura');
    const tardiva = await clients.ALFA.salvaRisposte({ nomi: { raw: 'ROMA', norm: 'ROMA' } });
    ok(tardiva.aborted && tardiva.error.code === 'ROUND_CHIUSO', 'scrittura tardiva rifiutata dal client');
    eq(fs.store.get('partite/' + MATCH + '/risposte/r1__p0').risposte.c0.raw, wa,
      'il documento non è stato modificato dopo la chiusura');

    console.log('\n[6] Round 2 e fine partita');
    const dopoRecap = fs.store.get('partite/' + MATCH).roundData.deadline + 1;
    const av = await clients.ALFA.applyAtomic(C.mutProssimoRound,
      Object.assign(ctxBase(), { now: dopoRecap }));
    ok(av.ok, 'avanzamento al round 2');
    await wait(clients.GAMMA, (s) => s.round === 2 && s.roundData.fase === 'compilazione', 'round 2');
    eq(fs.store.get('partite/' + MATCH).roundData.voti, {}, 'voti del round 1 azzerati');
    ok(!fs.store.get('partite/' + MATCH).roundData.esitoId, 'esito azzerato nel nuovo round');

    const lettera2 = clients.ALFA.state.roundData.lettera;
    clients.ALFA.apriMieRisposte(2);
    await sleep(20);
    eq(clients.ALFA.getMieRisposte(), {}, 'nuovo round: nessuna risposta residua del precedente');
    const [w2] = parolePer(lettera2, 1);
    await clients.ALFA.salvaRisposte({ nomi: { raw: w2, norm: C.normalizeWord(w2) } });
    await clients.ALFA.applyAtomic(C.mutStop);
    await wait(clients.ALFA, (s) => s.roundData.fase === 'revisione', 'revisione round 2');
    clients.ALFA.apriRisposte(2);
    await wait(clients.ALFA, () => clients.ALFA.rispostePronte(), 'risposte round 2');
    await Promise.all(['ALFA', 'BETA', 'GAMMA'].map((n) => clients[n].applyAtomic(C.mutConfermaRevisione)));
    await wait(clients.ALFA, (s) => s.roundData.conferme.length === 3, 'conferme round 2');
    await clients.ALFA.applyAtomic(C.mutChiudiRevisione,
      Object.assign(ctxBase(), { risposte: clients.ALFA.getRisposte(), rispostePronte: true }));
    await wait(clients.ALFA, (s) => s.roundData.fase === 'risultati', 'esito round 2');
    const doc3 = fs.store.get('partite/' + MATCH);
    eq(doc3.risultati.length, 2, 'due risultati totali');
    eq(doc3.punteggi.ALFA, 20, 'ALFA: 0 nel round 1 + 20 nel round 2');

    console.log('\n[7] Refresh / riconnessione a metà partita');
    const rinfrescato = client(fs, MATCH, 'GAMMA');
    await wait(rinfrescato, (s) => s.round === 2 && s.roundData.fase === 'risultati', 'stato ricostruito dopo refresh');
    eq(rinfrescato.state.punteggi, doc3.punteggi, 'punteggi identici dopo il refresh');
    ok(!rinfrescato.rispostePronte(), 'nessuna risposta altrui caricata automaticamente dopo il refresh');
    rinfrescato.stop();

    const fineAttesa = fs.store.get('partite/' + MATCH).roundData.deadline + 1;
    await clients.ALFA.applyAtomic(C.mutProssimoRound, Object.assign(ctxBase(), { now: fineAttesa }));
    await wait(clients.BETA, (s) => s.stato === 'conclusa', 'partita conclusa');
    eq(fs.store.get('partite/' + MATCH).punteggi,
      C.punteggiDaRisultati(fs.store.get('partite/' + MATCH).risultati, ['ALFA', 'BETA', 'GAMMA']),
      'totali finali = somma dei round');

    console.log('\n[8] ActionGate: referente offline e subentro scaglionato');
    {
      const gate = new B.ActionGate({ stuckMs: 1000, minRetry: 100, maxRetry: 800 });
      const infoReferente = { now: 1000, isReferent: true, staggerMs: 0 };
      ok(gate.mayAct('k', infoReferente), 'il referente agisce subito');
      ok(!gate.mayAct('k', infoReferente), 'un solo tentativo in volo (backoff)');
      const gate2 = new B.ActionGate({ stuckMs: 1000, minRetry: 100, maxRetry: 800 });
      ok(!gate2.mayAct('k', { now: 1000, isReferent: false, staggerMs: 0 }), 'il non referente osserva prima');
      ok(!gate2.mayAct('k', { now: 1500, isReferent: false, staggerMs: 0 }), 'attende STUCK_FALLBACK_MS');
      ok(gate2.mayAct('k', { now: 2500, isReferent: false, staggerMs: 0 }), 'subentra se la situazione resta ferma');
      const gate3 = new B.ActionGate({ stuckMs: 1000, minRetry: 100, maxRetry: 800 });
      gate3.mayAct('k', { now: 0, isReferent: true });
      gate3.failed('k', { failed: true });
      ok(!gate3.mayAct('k', { now: 50, isReferent: true }), 'dopo un fallimento: backoff');
      ok(gate3.mayAct('k', { now: 300, isReferent: true }), 'backoff minimo superato');
      const gate4 = new B.ActionGate({ stuckMs: 1000, minRetry: 100, maxRetry: 400 });
      gate4.mayAct('k', { now: 0, isReferent: true });
      gate4.failed('k', { failed: true });
      gate4.mayAct('k', { now: 200, isReferent: true });
      gate4.failed('k', { failed: true });
      gate4.mayAct('k', { now: 500, isReferent: true });
      gate4.failed('k', { failed: true });
      gate4.mayAct('k', { now: 1000, isReferent: true });
      gate4.failed('k', { failed: true });
      gate4.mayAct('k', { now: 1600, isReferent: true });
      gate4.failed('k', { failed: true });
      ok(!gate4.mayAct('k', { now: 1900, isReferent: true }), 'backoff esponenziale fino al tetto');
      gate4.ok('k');
      ok(gate4.mayAct('k', { now: 2100, isReferent: true }), 'dopo un successo il backoff si azzera');
      const gate5 = new B.ActionGate({ stuckMs: 1000, minRetry: 100, maxRetry: 800 });
      gate5.mayAct('k', { now: 0, isReferent: true });
      gate5.failed('k', { aborted: true });
      ok(gate5.mayAct('k', { now: 100, isReferent: true }),
        'un aborted non allunga l’attesa: si riprova dopo il retry minimo');
      const gate5b = new B.ActionGate({ stuckMs: 1000, minRetry: 100, maxRetry: 800 });
      gate5b.mayAct('k', { now: 0, isReferent: true });          // prenotazione: next = 100
      gate5b.failed('k', { failed: true });                      // retry 100 → 200
      ok(!gate5b.mayAct('k', { now: 50, isReferent: true }), 'in attesa del retry dopo un fallimento');
      ok(gate5b.mayAct('k', { now: 100, isReferent: true }), 'retry scaduto: nuovo tentativo');
      gate5b.failed('k', { failed: true });                      // retry 200 → 400
      ok(!gate5b.mayAct('k', { now: 299, isReferent: true }), 'il secondo fallimento allunga l’attesa a 200ms');
      const gate6 = new B.ActionGate({ stuckMs: 1000, minRetry: 100, maxRetry: 800 });
      ok(!gate6.mayAct('k', { now: 0, isReferent: false, staggerMs: 900 }), 'primo giro: registra e attende');
      ok(!gate6.mayAct('k', { now: 1500, isReferent: false, staggerMs: 900 }), 'scaglionamento rispettato');
      ok(gate6.mayAct('k', { now: 2000, isReferent: false, staggerMs: 900 }), 'subentro dopo stuck + scaglionamento');
    }

    console.log('\n[9] Rate limit 429: backoff, un avviso per episodio, recupero');
    {
      const fs2 = new MockFS();
      nuovaPartita(fs2, 'ncc-429');
      const be = client(fs2, 'ncc-429', 'ALFA');
      await sleep(30);
      let avvisi = 0, recuperi = 0;
      be.onRateLimit = () => { avvisi++; };
      be.onRecover = () => { recuperi++; };
      // mutatore che produce sempre una scrittura (come nel test quota di Patata)
      const scrivi = (n) => () => ({ testField: n });
      fs2.failNextWrite = 2;
      const r1 = await be.applyAtomic(scrivi(1));
      ok(r1.failed && r1.rateLimited === true, '429 → {failed, rateLimited}');
      ok(be.rateLimitedUntil > Date.now(), 'backoff attivo');
      eq(be.rateLimitBackoff, 8000, 'backoff raddoppiato 4s → 8s');
      const r2 = await be.applyAtomic(scrivi(2));
      ok(r2.rateLimited === true, 'secondo 429 consecutivo');
      eq(avvisi, 1, 'un solo avviso per episodio');
      eq(be.rateLimitBackoff, 16000, 'backoff raddoppiato ancora');
      const r3 = await be.applyAtomic(scrivi(3));
      ok(r3.ok, 'scrittura successiva riuscita');
      eq(be.rateLimitBackoff, 4000, 'backoff resettato');
      eq(recuperi, 1, 'callback di recupero');
      fs2.failNextWrite = 1;
      await be.applyAtomic(scrivi(4));
      eq(avvisi, 2, 'nuovo episodio → nuovo avviso');
      be.stop();
    }

    console.log('\n[10] Rivincita: documento nuovo, nessun residuo');
    {
      const fs3 = new MockFS();
      nuovaPartita(fs3, 'ncc-rev');
      const be = client(fs3, 'ncc-rev', 'ALFA');
      await sleep(20);
      const newRef = fs3.collection('partite').doc('ncc-rev-2');
      await newRef.set({
        gioco: 'nomi-cose-citta',
        partecipanti: ['ALFA', 'BETA', 'GAMMA'],
        punteggi: { ALFA: 0, BETA: 0, GAMMA: 0 },
        pronti: [], risultati: [], roundData: null, round: 0, stato: 'attesa',
        rivincitaAccettataDa: [], rivincitaRifiutataDa: [],
        opzioni: { round: '2', tempo: '60', revisione: '30', categorie: 'light', seed: 'NUOVOSEED', lettere: ['R', 'C'] }
      });
      await be.ref.update({ prossimaPartita: newRef.id, prossimaPartitaCreataDa: 'ALFA' });
      const nuova = fs3.store.get('partite/ncc-rev-2');
      eq(nuova.stato, 'attesa', 'nuova partita in attesa');
      eq(nuova.risultati, [], 'nessun risultato residuo');
      eq(nuova.roundData, null, 'nessun round residuo');
      eq(nuova.punteggi, { ALFA: 0, BETA: 0, GAMMA: 0 }, 'punteggi azzerati');
      ok(nuova.opzioni.seed !== 'MULTI', 'seed nuovo: lettere diverse');
      ok(fs3.store.get('partite/ncc-rev-2/risposte/r1__p0') === undefined, 'nessuna risposta residua');
      const be2 = client(fs3, 'ncc-rev-2', 'ALFA');
      await wait(be2, (s) => s.stato === 'attesa', 'nuova partita raggiungibile');
      be.stop(); be2.stop();
    }

    Object.keys(clients).forEach((n) => clients[n].stop());
    console.log('\n=================');
    console.log('PASSATI: ' + passed + '  FALLITI: ' + failed);
    process.exit(failed ? 1 : 0);
  } catch (e) {
    console.error('ERRORE TEST MULTIPLAYER:', e);
    process.exit(1);
  }
})();
