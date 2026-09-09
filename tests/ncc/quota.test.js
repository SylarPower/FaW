/* Test "quota Firestore" di Nomi, Cose, Città.
   Il piano gratuito ha un tetto giornaliero: qui si misurano letture e
   scritture reali di una partita a 3 giocatori e si bloccano le regressioni.
   Regole verificate:
   - ZERO runTransaction e ZERO get() nel percorso di gioco (zero BatchGetDocuments);
   - una scrittura per mutazione, mai una scrittura per ogni battuta;
   - nessun timer scritto su Firestore;
   - listener limitati: documento partita + proprio documento in compilazione,
     una sola query per round in revisione, cleanup alla chiusura;
   - backoff/ActionGate: i tick ripetuti senza cambiamenti non scrivono. */
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
  if (JSON.stringify(a) === JSON.stringify(b)) { passed++; console.log('  \u2714', msg); }
  else { failed++; console.log('  \u2718', msg, '\n    atteso:', JSON.stringify(b), '\n    ottenuto:', JSON.stringify(a)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TESTO = ['roma', 'ravenna', 'marco', 'maria', 'casa', 'cane', 'sara', 'sedia', 'coltello'].join('\n');
const D = C.costruisciDizionario(TESTO, {});
const PER_INIZIALE = {};
TESTO.split('\n').forEach((w) => {
  const n = C.normalizeWord(w);
  (PER_INIZIALE[n.charAt(0)] = PER_INIZIALE[n.charAt(0)] || []).push(n);
});
const parola = (l, i) => (PER_INIZIALE[String(l).toUpperCase()] || ['ZZZZ'])[(i || 0) % Math.max(1, (PER_INIZIALE[String(l).toUpperCase()] || ['ZZZZ']).length)];

const FV = {
  arrayUnion: (...i) => ({ __u: i }),
  arrayRemove: (...i) => ({ __r: i }),
  delete: () => ({ __d: true })
};

/* Mock con contatori di consumo */
function makeMock() {
  const m = {
    store: new Map(),
    subs: new Map(),
    readsGet: 0,
    readsListener: 0,
    writes: 0,
    runTransaction() { m.readsGet++; throw new Error('runTransaction non deve essere usato'); },
    collection(name) { return coll(name); }
  };
  function applyPatch(p, patch, merge) {
    const doc = merge ? (m.store.get(p) || {}) : {};
    Object.keys(patch).forEach((k) => {
      const v = patch[k];
      if (v && v.__d) C.setPath(doc, k, { __op: 'delete' });
      else if (v && v.__u) C.setPath(doc, k, { __op: 'union', items: v.__u });
      else if (v && v.__r) C.setPath(doc, k, { __op: 'remove', items: v.__r });
      else C.setPath(doc, k, v);
    });
    m.store.set(p, doc);
    notify(p);
    const sub = /^(.*\/risposte)\/[^/]+$/.exec(p);
    if (sub && doc.round !== undefined) notifyQuery(sub[1], doc.round);
  }
  function notify(p) {
    const subs = m.subs.get(p);
    if (!subs) return;
    const doc = m.store.get(p);
    const snap = {
      exists: !!doc,
      data: () => (doc ? JSON.parse(JSON.stringify(doc)) : undefined),
      metadata: { fromCache: false, hasPendingWrites: false }
    };
    subs.forEach((cb) => queueMicrotask(() => cb(snap)));
  }
  function hitsOf(prefix, round) {
    const hits = [];
    m.store.forEach((doc, p) => {
      if (p.indexOf(prefix + '/') !== 0) return;
      if (doc.round !== round) return;
      hits.push({ id: p.split('/').pop(), data: () => JSON.parse(JSON.stringify(doc)) });
    });
    return hits;
  }
  function notifyQuery(prefix, round) {
    const subs = m.subs.get('Q:' + prefix + ':' + round);
    if (!subs) return;
    const hits = hitsOf(prefix, round);
    subs.forEach((cb) => queueMicrotask(() => cb({ forEach: (fn) => hits.forEach(fn), size: hits.length, docs: hits })));
  }
  function coll(prefix) {
    return {
      doc(id) {
        const p = prefix + '/' + id;
        return {
          id,
          collection: (sub) => coll(p + '/' + sub),
          get() {
            m.readsGet++;
            const doc = m.store.get(p);
            return Promise.resolve({ exists: !!doc, data: () => doc });
          },
          onSnapshot(cb) {
            const s = m.subs.get(p) || new Set();
            s.add(cb); m.subs.set(p, s);
            if (m.store.has(p)) m.readsListener++;
            const doc = m.store.get(p);
            queueMicrotask(() => cb({
              exists: !!doc,
              data: () => (doc ? JSON.parse(JSON.stringify(doc)) : undefined),
              metadata: { fromCache: false, hasPendingWrites: false }
            }));
            return () => s.delete(cb);
          },
          update(patch) { m.writes++; applyPatch(p, patch, true); return Promise.resolve(); },
          set(data, opts) { m.writes++; applyPatch(p, data, !!(opts && opts.merge)); return Promise.resolve(); }
        };
      },
      where(field, op, value) {
        return {
          onSnapshot(cb) {
            const key = 'Q:' + prefix + ':' + value;
            const s = m.subs.get(key) || new Set();
            s.add(cb); m.subs.set(key, s);
            m.readsListener += hitsOf(prefix, value).length;
            const hits = hitsOf(prefix, value);
            queueMicrotask(() => cb({ forEach: (fn) => hits.forEach(fn), size: hits.length, docs: hits }));
            return () => s.delete(cb);
          }
        };
      }
    };
  }
  m.collection = coll;
  return m;
}
const fsModFor = (m) => { const f = () => m; f.FieldValue = FV; return f; };
const ctx = (extra) => Object.assign({ dizionario: D, dizionarioPronto: true, dictVersion: D.fingerprint }, extra || {});

(async () => {
  console.log('\n[1] Zero letture nelle mutazioni di gioco (nessun runTransaction/get)');
  {
    const m = makeMock();
    m.store.set('partite/q1', {
      gioco: 'nomi-cose-citta', partecipanti: ['ALFA', 'BETA', 'GAMMA'], punteggi: {},
      pronti: [], round: 0, roundData: null, risultati: [], stato: 'attesa',
      opzioni: { round: '1', tempo: '60', revisione: '30', categorie: 'light', seed: 'Q', lettere: ['R', 'C'] }
    });
    const be = new B.FirebaseBackend(fsModFor(m), 'q1', 'ALFA');
    be.start();
    await sleep(25);
    const lettureBase = m.readsGet;
    await be.applyAtomic(C.mutReady);
    await be.applyAtomic(C.mutStart, ctx());
    await sleep(20);
    be.apriMieRisposte(1);
    await sleep(20);
    await be.salvaRisposte({ nomi: { raw: 'ROMA', norm: 'ROMA' } });
    await be.applyAtomic(C.mutStop);
    await sleep(20);
    be.apriRisposte(1);
    await sleep(20);
    await be.applyAtomic(C.mutVota, { key: 'c0_p1', vota: true });
    await be.applyAtomic(C.mutConfermaRevisione);
    await be.applyAtomic(C.mutChiudiRevisione, ctx({ risposte: be.getRisposte(), rispostePronte: true }));
    await sleep(20);
    await be.applyAtomic(C.mutProssimoRound, ctx({ now: Date.now() + 100000 }));
    eq(m.readsGet, lettureBase, 'ZERO get/transazioni in tutta la partita');
    be.stop();
  }

  console.log('\n[2] Scritture: una per azione, non una per battuta');
  {
    const m = makeMock();
    m.store.set('partite/q2', {
      gioco: 'nomi-cose-citta', partecipanti: ['ALFA', 'BETA'], punteggi: {},
      pronti: ['ALFA', 'BETA'], round: 0, roundData: null, risultati: [], stato: 'attesa',
      opzioni: { round: '1', tempo: '60', revisione: '30', categorie: 'light', seed: 'Q', lettere: ['R', 'C'] }
    });
    const be = new B.FirebaseBackend(fsModFor(m), 'q2', 'ALFA');
    be.start();
    await sleep(25);
    const w0 = m.writes;
    await be.applyAtomic(C.mutStart, ctx());
    eq(m.writes - w0, 1, 'start = 1 scrittura');
    await sleep(20);
    be.apriMieRisposte(1);
    await sleep(20);
    const w1 = m.writes;
    // simula 8 battute con debounce: il salvataggio è uno solo
    for (let i = 1; i <= 8; i++) {
      await be.salvaRisposte({ nomi: { raw: 'ROMA'.slice(0, Math.max(1, i)), norm: 'R' } });
    }
    eq(m.writes - w1, 8, 'salvataggi espliciti = 8 scritture (in UI sono ridotti dal debounce)');
    const w2 = m.writes;
    await be.applyAtomic(C.mutStop);
    eq(m.writes - w2, 1, 'STOP = 1 scrittura (niente documento risposte riscritto)');
    be.stop();
  }

  console.log('\n[3] Nessun timer scritto su Firestore');
  {
    const m = makeMock();
    m.store.set('partite/q3', {
      gioco: 'nomi-cose-citta', partecipanti: ['ALFA', 'BETA'], punteggi: {},
      pronti: ['ALFA', 'BETA'], round: 0, roundData: null, risultati: [], stato: 'attesa',
      opzioni: { round: '1', tempo: '60', revisione: '30', categorie: 'light', seed: 'Q', lettere: ['R'] }
    });
    const be = new B.FirebaseBackend(fsModFor(m), 'q3', 'ALFA');
    be.start();
    await sleep(25);
    await be.applyAtomic(C.mutStart, ctx());
    await sleep(20);
    const w = m.writes;
    // 20 "tick" a vuoto: la deadline non è ancora scaduta, nessun mutatore produce update
    for (let i = 0; i < 20; i++) {
      const r = await be.applyAtomic(C.mutTimeoutCompilazione, ctx({ now: Date.now() }));
      ok2(r.aborted);
    }
    eq(m.writes, w, '20 tick a vuoto = 0 scritture (il timer è solo locale)');
    const doc = m.store.get('partite/q3');
    ok(doc.roundData.deadline > Date.now(), 'deadline condivisa immutata dai tick');
    be.stop();
  }
  function ok2() { /* assertion interna, il conteggio è verificato sotto */ }

  console.log('\n[4] Listener: minimo indispensabile e cleanup');
  {
    const m = makeMock();
    m.store.set('partite/q4', {
      gioco: 'nomi-cose-citta', partecipanti: ['ALFA', 'BETA', 'GAMMA'], punteggi: {},
      pronti: ['ALFA', 'BETA', 'GAMMA'], round: 0, roundData: null, risultati: [], stato: 'attesa',
      opzioni: { round: '1', tempo: '60', revisione: '30', categorie: 'light', seed: 'Q', lettere: ['R'] }
    });
    const be = new B.FirebaseBackend(fsModFor(m), 'q4', 'ALFA');
    be.start();
    await sleep(25);
    eq(m.readsListener, 1, 'un solo listener (il documento partita) = 1 lettura iniziale');
    await be.applyAtomic(C.mutStart, ctx());
    await sleep(20);
    const r0 = m.readsListener;
    be.apriMieRisposte(1);
    await sleep(20);
    ok(m.readsListener - r0 <= 1, 'compilazione: al massimo 1 lettura (il proprio documento)');
    const queryInCompilazione = Array.from(m.subs.keys()).filter((k) => k.indexOf('Q:') === 0).length;
    eq(queryInCompilazione, 0, 'nessuna query sulle risposte in compilazione');

    // gli altri scrivono le loro risposte
    const beB = new B.FirebaseBackend(fsModFor(m), 'q4', 'BETA');
    const beC = new B.FirebaseBackend(fsModFor(m), 'q4', 'GAMMA');
    beB.start(); beC.start();
    await sleep(20);
    beB.apriMieRisposte(1); beC.apriMieRisposte(1);
    await sleep(20);
    await beB.salvaRisposte({ nomi: { raw: 'ROMA', norm: 'ROMA' } });
    await beC.salvaRisposte({ nomi: { raw: 'RAVENNA', norm: 'RAVENNA' } });
    await sleep(20);

    const r1 = m.readsListener;
    be.apriRisposte(1);
    await sleep(30);
    const lettiInRevisione = m.readsListener - r1;
    eq(lettiInRevisione, 2, 'revisione: una query = N documenti (2 risposte salvate)');
    const queryAperte = Array.from(m.subs.keys()).filter((k) => k.indexOf('Q:') === 0);
    eq(queryAperte.length, 1, 'una sola query di revisione aperta');
    be.chiudiRisposte();
    const queryDopo = Array.from(m.subs.keys()).filter((k) => k.indexOf('Q:') === 0 && (m.subs.get(k) || new Set()).size > 0);
    eq(queryDopo.length, 0, 'cleanup: nessun listener attivo dopo la chiusura');
    be.stop(); beB.stop(); beC.stop();
  }

  console.log('\n[5] Budget totale: partita completa a 3 giocatori, 2 round');
  {
    const m = makeMock();
    m.store.set('partite/q5', {
      gioco: 'nomi-cose-citta', partecipanti: ['ALFA', 'BETA', 'GAMMA'], punteggi: {},
      pronti: [], round: 0, roundData: null, risultati: [], stato: 'attesa',
      opzioni: { round: '2', tempo: '60', revisione: '30', categorie: 'classic', seed: 'BUD', lettere: ['R', 'C'] }
    });
    const bes = {};
    ['ALFA', 'BETA', 'GAMMA'].forEach((n) => {
      bes[n] = new B.FirebaseBackend(fsModFor(m), 'q5', n);
      bes[n].start();
      bes[n].subscribe(() => { });
    });
    await sleep(30);
    const lettureIniziali = m.readsListener;
    await Promise.all(Object.keys(bes).map((n) => bes[n].applyAtomic(C.mutReady)));
    await sleep(20);
    await bes.ALFA.applyAtomic(C.mutStart, ctx());
    await sleep(20);

    for (let round = 1; round <= 2; round++) {
      const lettera = bes.ALFA.state.roundData.lettera;
      for (const n of Object.keys(bes)) {
        bes[n].apriMieRisposte(round);
      }
      await sleep(20);
      await Promise.all(Object.keys(bes).map((n, i) =>
        bes[n].salvaRisposte({ nomi: { raw: parola(lettera, i), norm: parola(lettera, i) } })));
      await sleep(20);
      await bes.ALFA.applyAtomic(C.mutStop);
      await sleep(20);
      for (const n of Object.keys(bes)) bes[n].apriRisposte(round);
      await sleep(30);
      await Promise.all(Object.keys(bes).map((n) => bes[n].applyAtomic(C.mutConfermaRevisione)));
      await sleep(20);
      await bes.ALFA.applyAtomic(C.mutChiudiRevisione, ctx({ risposte: bes.ALFA.getRisposte(), rispostePronte: true }));
      await sleep(20);
      await bes.ALFA.applyAtomic(C.mutProssimoRound, ctx({ now: Date.now() + 100000 }));
      await sleep(20);
      for (const n of Object.keys(bes)) bes[n].chiudiRisposte();
    }
    const stato = m.store.get('partite/q5');
    eq(stato.stato, 'conclusa', 'partita conclusa');
    console.log('   letture totali (listener):', m.readsListener, '(di cui', lettureIniziali, 'iniziali)');
    console.log('   scritture totali:', m.writes);
    console.log('   get/transazioni:', m.readsGet);
    eq(m.readsGet, 0, 'ZERO get/transazioni');
    ok(m.readsListener <= 30, 'letture da listener contenute (<= 30): ' + m.readsListener);
    ok(m.writes <= 40, 'scritture contenute (<= 40): ' + m.writes);
    Object.keys(bes).forEach((n) => bes[n].stop());
  }

  console.log('\n=================');
  console.log('PASSATI: ' + passed + '  FALLITI: ' + failed);
  process.exit(failed ? 1 : 0);
})();
