/* Test "quota Firestore" di Patata Bollente.
   I 429 "Too Many Requests" nascono dal traffico: ogni transazione costa una
   lettura (BatchGetDocuments) e il vecchio loop ne sparava una al secondo per
   client. Qui misuriamo letture/scritture e le regole anti-storm. */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, '../../games/patata/js/game.js'));

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✔', msg); }
  else { failed++; console.log('  ✘', msg); }
}
function eq(a, b, msg) {
  if (JSON.stringify(a) === JSON.stringify(b)) { passed++; console.log('  ✔', msg); }
  else { failed++; console.log('  ✘', msg, '\n    atteso:', JSON.stringify(b), '\n    ottenuto:', JSON.stringify(a)); }
}

/* ---------- MOCK FIRESTORE con contatori di consumo ---------- */
function makeMock() {
  const m = {
    store: new Map(),
    subs: new Map(),
    reads: 0,      // BatchGetDocuments (transazioni + get)
    writes: 0,     // commit/update
    applyPatch(key, patch) {
      const doc = this.store.get(key) || {};
      for (const [p, value] of Object.entries(patch)) {
        if (value && value.__mockDelete) C.setPath(doc, p, { __op: 'delete' });
        else if (value && value.__mockUnion) C.setPath(doc, p, { __op: 'union', items: value.__mockUnion });
        else C.setPath(doc, p, value);
      }
      this.store.set(key, doc);
      const subs = this.subs.get(key);
      if (subs) {
        const snap = { exists: () => true, data: () => doc };
        subs.forEach((cb) => queueMicrotask(() => cb(snap)));
      }
    },
    setDoc(key, data) {
      this.store.set(key, JSON.parse(JSON.stringify(data)));
      const subs = this.subs.get(key);
      if (subs) {
        const doc = this.store.get(key);
        const snap = { exists: () => true, data: () => doc };
        subs.forEach((cb) => queueMicrotask(() => cb(snap)));
      }
    },
    runTransaction(fn) {
      return Promise.resolve().then(async () => {
        const staged = [];
        const t = {
          get: async (ref) => {
            m.reads++;                       // ← la lettura che costa quota
            const doc = m.store.get(ref.key);
            return { exists: () => !!doc, data: () => doc };
          },
          update: (ref, patch) => { staged.push([ref.key, patch]); }
        };
        const res = await fn(t);
        for (const [key, patch] of staged) { m.writes++; m.applyPatch(key, patch); }
        return res;
      });
    },
    collection(name) {
      return {
        doc: (id) => ({
          key: name + '/' + id,
          onSnapshot(cb) {
            const k = name + '/' + id;
            const subs = m.subs.get(k) || new Set();
            subs.add(cb);
            m.subs.set(k, subs);
            const doc = m.store.get(k);
            if (doc) queueMicrotask(() => cb({ exists: () => true, data: () => doc }));
            return () => subs.delete(cb);
          },
          update(patch) { m.writes++; m.applyPatch(name + '/' + id, patch); return Promise.resolve(); }
        })
      };
    }
  };
  return m;
}
const mockFieldValues = {
  arrayUnion: (...items) => ({ __mockUnion: items }),
  delete: () => ({ __mockDelete: true })
};
function fsModFor(m) {
  const fsMod = () => m;
  fsMod.FieldValue = mockFieldValues;
  return fsMod;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function nuovaPartita(m, id) {
  m.setDoc('partite/' + id, {
    gioco: 'patata',
    partecipanti: ['ALFA', 'BETA', 'GAMMA'],
    punteggi: { ALFA: 0, BETA: 0, GAMMA: 0 },
    parole: {}, pronti: [], stato: 'attesa',
    rivincitaAccettataDa: [], rivincitaRifiutataDa: [],
    timestamp: Date.now(),
    opzioni: { tempo: '5', turni: '1', lettere: '2', mode: 'classic', seed: 'QUOTA' }
  });
}

(async () => {
  console.log('\n[1] applyAtomic: nessuna lettura (era una transazione)');
  {
    const m = makeMock();
    nuovaPartita(m, 'q1');
    const be = new C.FirebaseBackend(fsModFor(m), 'q1', 'ALFA');
    be.start();
    await sleep(20);
    const readsBase = m.reads, writesBase = m.writes;

    const r = await be.applyAtomic(C.mutReady);
    ok(r && r.ok, 'ready scritto con applyAtomic');
    eq(m.reads - readsBase, 0, 'ZERO letture per segnarsi pronti');
    eq(m.writes - writesBase, 1, 'una sola scrittura');
    await sleep(20);
    ok(be.state.pronti.includes('ALFA'), 'stato locale aggiornato subito (UI reattiva)');

    // e una seconda volta non riscrive nulla (mutReady restituisce null)
    const w2 = m.writes;
    const r2 = await be.applyAtomic(C.mutReady);
    ok(r2 && r2.aborted, 'ready duplicato abortito');
    eq(m.writes - w2, 0, 'nessuna scrittura inutile');
    be.stop();
  }

  console.log('\n[2] transact: costa esattamente 1 lettura + 1 scrittura');
  {
    const m = makeMock();
    nuovaPartita(m, 'q2');
    const bes = ['ALFA', 'BETA', 'GAMMA'].map((n) => new C.FirebaseBackend(fsModFor(m), 'q2', n));
    bes.forEach((b) => b.start());
    await sleep(20);
    await Promise.all(bes.map((b) => b.applyAtomic(C.mutReady)));
    await sleep(20);
    const r0 = m.reads, w0 = m.writes;
    const rStart = await bes[0].transact(C.mutStart);
    await sleep(20);
    ok(rStart && rStart.ok, 'start andato a buon fine');
    eq(m.reads - r0, 1, 'lo start costa una sola lettura');
    eq(m.writes - w0, 1, 'lo start costa una sola scrittura');
    ok(bes.every((b) => b.state.stato === 'in_corso'), 'partita avviata su tutti i client');
    bes.forEach((b) => b.stop());
  }

  console.log('\n[3] Lobby a 3 client: consumo totale');
  {
    const m = makeMock();
    nuovaPartita(m, 'q3');
    const names = ['ALFA', 'BETA', 'GAMMA'];
    const bes = names.map((n) => new C.FirebaseBackend(fsModFor(m), 'q3', n));
    bes.forEach((b) => b.start());
    await sleep(30);
    const r0 = m.reads, w0 = m.writes;
    // come fa il loop reale: ognuno si segna pronto senza leggere
    await Promise.all(bes.map((b) => b.applyAtomic(C.mutReady)));
    await sleep(30);
    eq(m.reads - r0, 0, 'lobby completa senza NESSUNA lettura');
    eq(m.writes - w0, 3, '3 scritture (una per giocatore)');
    // e poi un solo start (lo fa il referente)
    await bes[0].transact(C.mutStart);
    await sleep(30);
    eq(m.reads - r0, 1, 'una lettura in tutta la fase di lobby');
    ok(bes.every((b) => b.state.stato === 'in_corso'), 'tutti i client vedono la partita iniziata');
    bes.forEach((b) => b.stop());
  }

  console.log('\n[4] ActionGate: un solo client agisce, gli altri no');
  {
    const g = new C.ActionGate({ stuckMs: 12000, minRetry: 2000, maxRetry: 30000 });
    const t = 1000000;
    ok(g.mayAct('start', { now: t, isReferent: true, staggerMs: 0 }), 'il referente agisce subito');
    ok(!g.mayAct('start', { now: t + 1000, isReferent: true, staggerMs: 0 }),
      'ma non due volte nello stesso secondo (prenotazione)');

    const g2 = new C.ActionGate({ stuckMs: 12000, minRetry: 2000, maxRetry: 30000 });
    ok(!g2.mayAct('start', { now: t, isReferent: false, staggerMs: 900 }), 'non referente: non agisce al primo tick');
    ok(!g2.mayAct('start', { now: t + 5000, isReferent: false, staggerMs: 900 }), 'non referente: ancora fermo a 5s');
    ok(!g2.mayAct('start', { now: t + 12500, isReferent: false, staggerMs: 900 }),
      'non referente: fermo anche a 12,5s (stagger 900ms)');
    ok(g2.mayAct('start', { now: t + 13000, isReferent: false, staggerMs: 900 }),
      'non referente: subentra dopo stuck + stagger');
  }

  console.log('\n[5] ActionGate: backoff sui fallimenti (mai martellare)');
  {
    const g = new C.ActionGate({ stuckMs: 12000, minRetry: 2000, maxRetry: 30000 });
    let t = 0;
    ok(g.mayAct('timeout', { now: t, isReferent: true }), 'primo tentativo');
    g.failed('timeout', { failed: true, rateLimited: true });
    ok(!g.mayAct('timeout', { now: t + 1999, isReferent: true }), 'attende il backoff (2s)');
    ok(g.mayAct('timeout', { now: t + 2000, isReferent: true }), 'riprova dopo 2s');
    g.failed('timeout', { failed: true });
    ok(!g.mayAct('timeout', { now: t + 5999, isReferent: true }), 'backoff raddoppiato a 4s (slot a t+6000)');
    ok(g.mayAct('timeout', { now: t + 6000, isReferent: true }), 'riprova allo slot successivo');
    // il backoff cresce fino al tetto
    for (let i = 0; i < 8; i++) { g.failed('timeout', { failed: true }); t += 40000; g.mayAct('timeout', { now: t, isReferent: true }); }
    ok(g.book['timeout'].retry === 30000, 'backoff limitato a 30s (got ' + g.book['timeout'].retry + ')');
    // un esito positivo azzera tutto
    g.ok('timeout');
    ok(g.book['timeout'].retry === 2000, 'backoff resettato dopo un successo');
    // "aborted" non e' un errore: nessun allungamento
    const g3 = new C.ActionGate({ stuckMs: 12000, minRetry: 2000, maxRetry: 30000 });
    g3.mayAct('next', { now: 0, isReferent: true });
    g3.failed('next', { aborted: true });
    ok(g3.book['next'].retry === 2000, 'aborted non allunga il backoff');
  }

  console.log('\n[6] Costanti di consumo');
  ok(C.TICK_MS >= 1000, 'tick non piu\' rapido di 1/s (got ' + C.TICK_MS + 'ms)');
  ok(C.ACTION_RETRY_MAX >= 30000, 'tetto retry azioni >= 30s');
  ok(C.RATE_LIMIT_BACKOFF_MAX >= 60000, 'tetto backoff 429 >= 60s');
  ok(typeof C.FirebaseBackend.prototype.applyAtomic === 'function', 'applyAtomic disponibile sul backend Firebase');
  ok(typeof C.SoloBackend.prototype.applyAtomic === 'function', 'applyAtomic disponibile anche in solo');

  console.log('\n=================');
  console.log('PASSATI: ' + passed + '  FALLITI: ' + failed);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERRORE TEST QUOTA:', e); process.exit(1); });
