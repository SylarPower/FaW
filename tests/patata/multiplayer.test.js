/* Test multi-client Patata Bollente: 3 "client" su un mock Firestore
   (applyAtomic, arrayUnion/delete, rate limit 429 backoff). */
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
  collection(name) {
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
  be.subscribe(() => {});
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
    await sleep(30); // Attesa snapshot iniziale

    console.log('\n[1] Lobby: ready + start');
    await Promise.all(['ALFA', 'BETA', 'GAMMA'].map((n) => clients[n].transact(C.mutReady)));
    await waitSnap('ALFA', (s) => s.pronti.length === 3, 'tutti pronti');
    await clients['ALFA'].transact(C.mutStart);
    await waitSnap('GAMMA', (s) => s.stato === 'in_corso' && s.round === 1, 'start visibile a tutti');
    ok(true, 'tutti i client vedono in_corso/round 1');

    // determinismo lettere su tutti i client
    const lA = C.pickLetters(SEED, 1, 2, FAKE_IDX, 'classic');
    const lB = C.pickLetters(SEED, 1, 2, FAKE_IDX, 'classic');
    eq(lA, lB, 'lettere deterministiche (stesse su ogni client)');
    console.log('   lettere turno 1:', lA.join(''));

    console.log('\n[2] Passaggio di turno multi-client');
    const w1 = findWord(lA);
    const d0 = clients['ALFA'].state.turno.deadline;
    await clients['ALFA'].transact((st) => C.mutSubmitWord(st, {
      me: 'ALFA', now: Date.now(), letters: lA, used: C.usedWords(st), dict: FAKE_SET, word: w1, rule: 'classic'
    }));
    await waitSnap('BETA', (s) => s.turno.giocatore === 'BETA', 'patata a BETA');
    ok(clients['BETA'].state.turno.deadline >= d0 + 5000, 'deadline +5s sincronizzata');
    eq(clients['GAMMA'].state.punteggi.ALFA, C.pointsFor(w1.length), 'punti ALFA visibili a GAMMA');

    // BETA prova a sottomettere per conto di ALFA: rifiutato
    const rOff = await clients['BETA'].transact((st) => C.mutSubmitWord(st, {
      me: 'ALFA', now: Date.now(), letters: lA, used: C.usedWords(st), dict: FAKE_SET, word: findWord(lA, [w1]), rule: 'classic'
    }));
    ok(rOff.aborted && rOff.error && rOff.error.code === 'NOT_YOUR_TURN', 'submit fuori turno abortito');

    console.log('\n[3] Timeout da parte dei client');
    // simula il passare del tempo: sposta la deadline nel passato
    MockFS.applyPatch('partite/' + MATCH_ID, { 'turno.deadline': Date.now() - 3000 });
    await waitSnap('ALFA', (s) => s.turno.deadline < Date.now(), 'deadline scaduta locale');
    const t1 = await clients['ALFA'].transact(C.mutTimeout);
    ok(t1 && t1.ok, 'mutTimeout eseguito con successo');
    await waitSnap('BETA', (s) => s.roundData.fase === 'recap', 'recap per tutti');
    const doc = MockFS.store.get('partite/' + MATCH_ID);
    eq(doc.patate, { ALFA: 0, BETA: 1, GAMMA: 0 }, 'una sola scottatura per BETA');
    eq(doc.punteggi.BETA, -C.PATATA_PENALTY, 'penale −10 una sola volta');

    console.log('\n[4] Recap: contestazioni + conferme in parallelo');
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
    const n1 = await clients['ALFA'].transact(C.mutNextRound);
    ok(n1 && n1.ok, 'next-round eseguito con successo');
    await waitSnap('GAMMA', (s) => s.round === 2, 'round 2 per tutti');
    const doc2 = MockFS.store.get('partite/' + MATCH_ID);
    eq(doc2.roundData.patata, null, 'round 2: patata pulita');
    eq(doc2.turno.giocatore, 'BETA', 'round 2: tocca a BETA (rotazione)');
    ok(doc2.confermaTurno.length === 0, 'conferme resettate');

    console.log('\n[5] Round 2 completo → conclusa');
    const l2 = C.pickLetters(SEED, 2, 2, FAKE_IDX, 'classic');
    const w2 = findWord(l2);
    await clients['BETA'].transact((st) => C.mutSubmitWord(st, {
      me: 'BETA', now: Date.now(), letters: l2, used: C.usedWords(st), dict: FAKE_SET, word: w2, rule: 'classic'
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

    console.log('\n[6] Rate limit 429: backoff + flag rateLimited (anti-flood)');
    let failsLeft = 0;
    const rlDocRef = {
      key: 'partite/' + MATCH_ID,
      onSnapshot(cb) {
        return MockFS.collection('partite').doc(MATCH_ID).onSnapshot(cb);
      },
      update(patch) {
        if (failsLeft > 0) {
          failsLeft--;
          const err = new Error('Server responded with status 429');
          err.code = 'unknown';
          return Promise.reject(err);
        }
        MockFS.applyPatch('partite/' + MATCH_ID, patch);
        return Promise.resolve();
      }
    };
    const rlFsMod = () => ({
      collection: () => ({ doc: () => rlDocRef })
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
    const r1 = await rlClient.transact((st) => ({ 'testField': 1 }));
    ok(r1 && r1.failed && r1.rateLimited === true && r1.error.code === 'RATE_LIMIT', 'transazione 429 → {failed, rateLimited}');
    ok(notified === 1, 'onRateLimit notificato una sola volta per episodio (got ' + notified + ')');
    ok(rlClient.rateLimitedUntil > Date.now(), 'backoff attivo: rateLimitedUntil nel futuro');
    ok(rlClient.rateLimitBackoff === 8000, 'backoff raddoppiato 4s → 8s (got ' + rlClient.rateLimitBackoff + 'ms)');

    const r2 = await rlClient.transact((st) => ({ 'testField': 2 }));
    ok(r2 && r2.rateLimited === true, 'secondo 429 consecutivo → di nuovo rateLimited');
    ok(notified === 1, 'nessuna nuova notifica nello stesso episodio');
    ok(rlClient.rateLimitBackoff === 16000, 'backoff raddoppiato ancora 8s → 16s');

    // connessione tornata sana: round trip ok → reset backoff ed episodio
    const r3 = await rlClient.transact((st) => ({ 'testField': 3 }));
    ok(r3 && r3.ok === true, 'scrittura successiva torna a funzionare');
    ok(rlClient.rateLimitBackoff === 4000, 'backoff resettato a 4s');
    ok(rlClient.rateLimitEpisode === false, 'episodio rate limit chiuso');

    failsLeft = 1;
    await rlClient.transact((st) => ({ 'testField': 4 }));
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
