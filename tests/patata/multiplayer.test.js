/* Test multi-client Patata Bollente: 3 "client" su un mock Firestore
   (transazioni, arrayUnion/delete, abort su stato cambiato). */
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- dizionario finto ---------- */
function genFakeDict() {
  const pool = ['A', 'B', 'C', 'E', 'O', 'R'];
  const out = [];
  const push = (len, step) => {
    let i = 0;
    const n = Math.pow(pool.length, len);
    while (i < n) {
      let s = '', x = i;
      for (let j = 0; j < len; j++) { s = pool[x % 6] + s; x = (x / 6) | 0; }
      if (step === 1 || (i % step === 0)) out.push(s);
      i++;
    }
  };
  push(4, 1); push(5, 2); push(6, 8);
  return out;
}
const FAKE_WORDS = genFakeDict();
const FAKE_SET = new Set(FAKE_WORDS);
const FAKE_IDX = new C.LetterIndex(FAKE_WORDS);
const findWord = (letters, exclude) =>
  FAKE_WORDS.find((w) => letters.every((l) => w.includes(l)) && !(exclude || []).includes(w));

/* ---------- MOCK FIRESTORE ---------- */
class MockDocRef {
  constructor(colName, id) { this.col = colName; this.id = id; }
  _key() { return this.col + '/' + this.id; }
  onSnapshot(cb) {
    const store = MockFS.store;
    const subs = MockFS.subs.get(this._key()) || new Set();
    subs.add(cb);
    MockFS.subs.set(this._key(), subs);
    const doc = store.get(this._key());
    if (doc) queueMicrotask(() => cb({ exists: () => true, data: () => doc }));
    return () => subs.delete(cb);
  }
  update(patch) {
    MockFS.applyPatch(this._key(), patch);
    return Promise.resolve();
  }
}
const MockFS = {
  store: new Map(),
  subs: new Map(),
  applyPatch(key, patch) {
    const doc = this.store.get(key) || {};
    for (const [path, value] of Object.entries(patch)) {
      if (value && value.__mockDelete) C.setPath(doc, path, { __op: 'delete' });
      else if (value && value.__mockUnion) C.setPath(doc, path, { __op: 'union', items: value.__mockUnion });
      else C.setPath(doc, path, value);
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
    // serializzazione: una transazione alla volta (come Firestore)
    MockFS.txQueue = (MockFS.txQueue || Promise.resolve()).then(async () => {
      const staged = [];
      const t = {
        get: async (ref) => {
          const doc = this.store.get(ref._key());
          return { exists: () => !!doc, data: () => doc };
        },
        update: (ref, patch) => { staged.push([ref._key(), patch]); },
        set: (ref, data) => { staged.push([ref._key(), { __set: data }]); }
      };
      let result;
      try {
        result = await fn(t);
      } catch (e) {
        return { aborted: true, error: { code: 'TX', message: e.message } };
      }
      // commit
      for (const [key, patch] of staged) {
        if (patch && patch.__set) this.setDoc(key, patch.__set);
        else this.applyPatch(key, patch);
      }
      return result;
    });
    return MockFS.txQueue;
  },
  collection(name) {
    const self = this;
    return {
      doc: (id) => new MockDocRef(name, id || 'doc' + Math.random().toString(36).slice(2))
    };
  }
};
const mockFieldValues = {
  arrayUnion: (...items) => ({ __mockUnion: items }),
  delete: () => ({ __mockDelete: true })
};
function makeFsMod() {
  // come firebase.firestore (compat): funzione che restituisce l'istanza db + statiche
  const fsMod = () => MockFS;
  fsMod.FieldValue = mockFieldValues;
  return fsMod;
}

/* ---------- setup: 3 client ---------- */
const MATCH_ID = 'test-multi-1';
const SEED = 'MULTI';
MockFS.setDoc('partite/' + MATCH_ID, {
  gioco: 'patata',
  partecipanti: ['ALFA', 'BETA', 'GAMMA'],
  punteggi: { ALFA: 0, BETA: 0, GAMMA: 0 },
  parole: {},
  pronti: [],
  stato: 'attesa',
  rivincitaAccettataDa: [],
  rivincitaRifiutataDa: [],
  timestamp: Date.now(),
  opzioni: { tempo: '5', turni: '2', lettere: '2', mode: 'classic', seed: SEED }
});

const clients = {};
for (const name of ['ALFA', 'BETA', 'GAMMA']) {
  const be = new C.FirebaseBackend(makeFsMod(), MATCH_ID, name);
  be.start();
  clients[name] = be;
  be.subscribe(() => {}); // forza il primo snapshot
}

const waitSnap = async (name, pred, what, timeout = 5000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const s = clients[name].state;
    if (s && pred(s)) return s;
    await sleep(20);
  }
  throw new Error('timeout: ' + what);
};

(async () => {
  try {
    console.log('\n[1] Lobby: ready + start');
    await Promise.all(['ALFA', 'BETA', 'GAMMA'].map((n) => clients[n].transact(C.mutReady)));
    await waitSnap('ALFA', (s) => s.pronti.length === 3, 'tutti pronti');
    await clients['ALFA'].transact(C.mutStart);
    await waitSnap('GAMMA', (s) => s.stato === 'in_corso' && s.round === 1, 'start visibile a tutti');
    ok(true, 'tutti i client vedono in_corso/round 1');

    // determinismo lettere su tutti i client
    const lA = C.pickLetters(SEED, 1, 2, FAKE_IDX);
    const lB = C.pickLetters(SEED, 1, 2, FAKE_IDX);
    eq(lA, lB, 'lettere deterministiche (stesse su ogni client)');
    console.log('   lettere turno 1:', lA.join(''));

    console.log('\n[2] Passaggio di turno multi-client');
    const w1 = findWord(lA);
    const d0 = clients['ALFA'].state.turno.deadline;
    await clients['ALFA'].transact((st) => C.mutSubmitWord(st, {
      me: 'ALFA', now: Date.now(), letters: lA, used: C.usedWords(st), dict: FAKE_SET, word: w1
    }));
    await waitSnap('BETA', (s) => s.turno.giocatore === 'BETA', 'patata a BETA');
    ok(clients['BETA'].state.turno.deadline >= d0 + 5000, 'deadline +5s sincronizzata');
    eq(clients['GAMMA'].state.punteggi.ALFA, C.pointsFor(w1.length), 'punti ALFA visibili a GAMMA');

    // BETA fuori turno (gara simulata): rifiutato
    const rOff = await clients['BETA'].transact((st) => C.mutSubmitWord(st, {
      me: 'ALFA', now: Date.now(), letters: lA, used: C.usedWords(st), dict: FAKE_SET, word: findWord(lA, [w1])
    }));
    ok(rOff.aborted && rOff.error && rOff.error.code === 'NOT_YOUR_TURN', 'submit fuori turno abortito');

    console.log('\n[3] Timeout contestato da 2 client (solo una scottatura)');
    // simula il passare del tempo: sposta il deadline nel passato
    MockFS.applyPatch('partite/' + MATCH_ID, { 'turno.deadline': Date.now() - 3000 });
    await waitSnap('ALFA', (s) => s.turno.deadline < Date.now(), 'deadline scaduta locale');
    // due client tentano in parallelo la scottatura
    const [t1, t2] = await Promise.all([
      clients['ALFA'].transact(C.mutTimeout),
      clients['GAMMA'].transact(C.mutTimeout)
    ]);
    const wonTimeout = [t1, t2].filter((r) => r && r.ok).length;
    ok(wonTimeout === 1, 'esattamente una transazione di timeout ha vinto (got ' + wonTimeout + ')');
    await waitSnap('BETA', (s) => s.roundData.fase === 'recap', 'recap per tutti');
    const doc = MockFS.store.get('partite/' + MATCH_ID);
    eq(doc.patate, { ALFA: 0, BETA: 1, GAMMA: 0 }, 'una sola scottatura per BETA');
    eq(doc.punteggi.BETA, -C.PATATA_PENALTY, 'penale −10 una sola volta');

    console.log('\n[4] Recap: contestazioni + conferme in parallelo');
    // ALFA contesta la parola di… BETA non ha parole; usa quella di ALFA? no: l'autore non può contare.
    // Facciamo giocare BETA prima? BETA ha solo sbagliato. Contestiamo la parola di ALFA con GAMMA.
    const rFlag = await clients['GAMMA'].transact((st) => C.mutFlag(st, { word: w1, me: 'GAMMA' }));
    ok(rFlag && rFlag.ok, 'GAMMA contesta ' + w1);
    await waitSnap('ALFA', (s) => (s.roundData.flags || {})[w1] && s.roundData.flags[w1].length === 1, 'flag visibile');
    eq(MockFS.store.get('partite/' + MATCH_ID).roundData.flags[w1], ['GAMMA'], 'flag attribuito a GAMMA (non undefined)');
    // soglia per 3 giocatori = 1 (solo non-autore) → risolvibile
    const rRes = await clients['ALFA'].transact((st) => C.mutResolveFlag(st, { word: w1 }));
    ok(rRes && rRes.ok, 'contestazione risolta');
    await waitSnap('BETA', (s) => (s.roundData.rimosse || []).includes(w1), 'rimossa visibile a tutti');
    eq(MockFS.store.get('partite/' + MATCH_ID).punteggi.ALFA, 0, 'punti di ALFA a zero dopo contestazione');
    // doppio resolve (idempotenza)
    const rRes2 = await clients['GAMMA'].transact((st) => C.mutResolveFlag(st, { word: w1 }));
    ok(rRes2 && rRes2.aborted, 'secondo resolve abortito (parola già rimossa)');

    // conferme tutte in parallelo
    await Promise.all(['ALFA', 'BETA', 'GAMMA'].map((n) => clients[n].transact(C.mutConferma)));
    await waitSnap('GAMMA', (s) => s.confermaTurno.length === 3, '3 conferme');
    // 2 client tentano il next round in parallelo
    const [n1, n2] = await Promise.all([
      clients['ALFA'].transact(C.mutNextRound),
      clients['BETA'].transact(C.mutNextRound)
    ]);
    const wonNext = [n1, n2].filter((r) => r && r.ok).length;
    ok(wonNext === 1, 'esattamente una transazione next-round ha vinto (got ' + wonNext + ')');
    await waitSnap('GAMMA', (s) => s.round === 2, 'round 2 per tutti');
    const doc2 = MockFS.store.get('partite/' + MATCH_ID);
    eq(doc2.roundData.patata, null, 'round 2: patata pulita');
    eq(doc2.turno.giocatore, 'BETA', 'round 2: tocca a BETA (rotazione)');
    ok(doc2.confermaTurno.length === 0, 'conferme resettate');

    console.log('\n[5] Round 2 completo → conclusa');
    const l2 = C.pickLetters(SEED, 2, 2, FAKE_IDX);
    const w2 = findWord(l2);
    await clients['BETA'].transact((st) => C.mutSubmitWord(st, {
      me: 'BETA', now: Date.now(), letters: l2, used: C.usedWords(st), dict: FAKE_SET, word: w2
    }));
    await waitSnap('ALFA', (s) => s.turno.giocatore === 'GAMMA', 'round2: patata a GAMMA');
    MockFS.applyPatch('partite/' + MATCH_ID, { 'turno.deadline': Date.now() - 3000 });
    await waitSnap('ALFA', (s) => s.turno.deadline < Date.now(), 'deadline scaduta r2');
    await clients['GAMMA'].transact(C.mutTimeout);
    await waitSnap('ALFA', (s) => s.roundData.fase === 'recap' && s.roundData.patata === 'GAMMA', 'scottatura GAMMA');
    await Promise.all(['ALFA', 'BETA', 'GAMMA'].map((n) => clients[n].transact(C.mutConferma)));
    await waitSnap('ALFA', (s) => s.confermaTurno.length === 3, 'conferme r2');
    await clients['ALFA'].transact(C.mutNextRound);
    await waitSnap('BETA', (s) => s.stato === 'conclusa', 'conclusa per tutti');
    const doc3 = MockFS.store.get('partite/' + MATCH_ID);
    eq(doc3.stato, 'conclusa', 'documento conclusa');
    const ranking = Object.entries(doc3.punteggi).sort((a, b) => b[1] - a[1]);
    console.log('   classifica finale:', ranking.map((r) => r[0] + '=' + r[1]).join(', '));
    ok(doc3.storia.length === 2, 'storia: 2 parole valide totali');
    eq(doc3.patate, { ALFA: 0, BETA: 1, GAMMA: 1 }, 'scottature: BETA e GAMMA');

    console.log('\n=================');

    console.log('\n[7] Rate limit 429: backoff + flag rateLimited (anti-flood)');
    let failsLeft = 0;
    const rlFsMod = () => ({
      collection: MockFS.collection.bind(MockFS),
      runTransaction(fn) {
        if (failsLeft > 0) {
          failsLeft--;
          // come l'SDK compat 9.x: code "unknown" + messaggio con 429
          const err = new Error('Server responded with status 429');
          err.code = 'unknown';
          return Promise.reject(err);
        }
        return MockFS.runTransaction(fn);
      }
    });
    rlFsMod.FieldValue = mockFieldValues;
    const rlClient = new C.FirebaseBackend(rlFsMod, MATCH_ID, 'ALFA');
    rlClient.start();
    await sleep(30);
    let notified = 0;
    rlClient.onRateLimit = () => { notified++; };

    ok(C.isRateLimitError(Object.assign(new Error('Server responded with status 429'), { code: 'unknown' })), 'isRateLimitError riconosce il 429 "unknown"');
    ok(C.isRateLimitError({ code: 'resource-exhausted', message: 'quota' }), 'isRateLimitError riconosce resource-exhausted');
    ok(!C.isRateLimitError(new Error('permession denied')), 'altri errori NON sono rate limit');

    failsLeft = 2;
    const r1 = await rlClient.transact(C.mutConferma);
    ok(r1 && r1.failed && r1.rateLimited === true && r1.error.code === 'RATE_LIMIT', 'transazione 429 → {failed, rateLimited}');
    ok(notified === 1, 'onRateLimit notificato una sola volta per episodio (got ' + notified + ')');
    ok(rlClient.rateLimitedUntil > Date.now(), 'backoff attivo: rateLimitedUntil nel futuro');
    ok(rlClient.rateLimitBackoff === 8000, 'backoff raddoppiato 4s → 8s (got ' + rlClient.rateLimitBackoff + 'ms)');

    const r2 = await rlClient.transact(C.mutConferma);
    ok(r2 && r2.rateLimited === true, 'secondo 429 consecutivo → di nuovo rateLimited');
    ok(notified === 1, 'nessuna nuova notifica nello stesso episodio');
    ok(rlClient.rateLimitBackoff === 16000, 'backoff raddoppiato ancora 8s → 16s');

    // connessione tornata sana: round trip ok → reset backoff ed episodio
    const r3 = await rlClient.transact(C.mutConferma); // stato conclusa → aborted (ma round trip riuscito)
    ok(r3 && r3.aborted === true, 'transazione successiva torna a funzionare (aborted: stato conclusa)');
    ok(rlClient.rateLimitBackoff === 4000, 'backoff resettato a 4s');
    ok(rlClient.rateLimitEpisode === false, 'episodio rate limit chiuso');

    failsLeft = 1;
    await rlClient.transact(C.mutConferma);
    ok(notified === 2, 'nuovo episodio 429 → nuova notifica (got ' + notified + ')');
    rlClient.stop();

    console.log('\n=================');
    console.log(`PASSATI: ${passed}  FALLITI: ${failed}`);
    process.exit(failed ? 1 : 0);
  } catch (e) {
    console.error('ERRORE TEST MULTI:', e);
    process.exit(1);
  }
})();
