"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "../..");
global.FAWCore = require("../../games/shared/faw-core");
global.FAWNet = require("../../games/shared/faw-net");
global.FAWCategorie = require("../../games/shared/faw-categorie");
const ROOM = require("../../games/shared/faw-room");
const R = require("../../games/categoria-rush/js/regole");
const clone = o => structuredClone(o);

function memoryNet() {
  const docs = new Map();
  let transactions = 0, listeners = 0;
  return {
    docs, ops: FAWNet.ops,
    get transactions() { return transactions; }, get listeners() { return listeners; },
    get: async p => ({ exists: docs.has(p), data: clone(docs.get(p)) }),
    update: async (p, patch) => docs.set(p, FAWNet.applyPatch(docs.get(p), patch)),
    transact: async (p, work) => {
      transactions++;
      const cur = clone(docs.get(p) || null), patch = work(cur);
      if (patch === false) return { applied: false, data: cur };
      const data = FAWNet.applyPatch(cur, patch); docs.set(p, data);
      return { applied: true, data: clone(data) };
    },
    onDoc: (p, cb) => { listeners++; cb(clone(docs.get(p))); return () => listeners--; }
  };
}
function match(options = {}) {
  return { ...ROOM.buildMatch({ gioco: "categoria-rush", creator: "ALICE", giocatori: ["ALICE", "BOB"], durata: 120000, seed: "REGRESSIONE", ...options }), stato: "in_corso", startAt: 100000, endsAt: 220000 };
}

test("room: resolveOnce atomico, nessun __claim fantasma o doppio effetto", async () => {
  const net = memoryNet(); net.docs.set("partite/1", { claim: {}, totale: 0 });
  const a = ROOM.open({ net, nome: "ALICE", matchId: "1" }), b = ROOM.open({ net, nome: "BOB", matchId: "1" });
  const work = d => ({ totale: d.totale + 1 });
  const results = await Promise.all([a.resolveOnce("round:0", work), b.resolveOnce("round:0", work), a.resolveOnce("round:0", work)]);
  assert.equal(results.filter(r => r.applied).length, 1);
  const d = net.docs.get("partite/1");
  assert.equal(d.totale, 1); assert.equal(d.claim["round:0"].fatto, true);
  assert.equal(d.__claim, undefined); assert.equal(d.patch, undefined);
  await a.resolveOnce("non_pronto", () => false);
  assert.equal(d.claim.non_pronto, undefined);
  assert.equal(net.transactions, 4, "una sola transazione per tentativo, non due");
});

test("room: invito, pronto e avvio usano il guard reale e almeno due partecipanti", async () => {
  const net = memoryNet();
  net.docs.set("partite/1", ROOM.buildMatch({ gioco: "bomba-parole", giocatori: ["ALICE"], maxGiocatori: 2, opzioni: { countdown: 0 } }));
  const a = ROOM.open({ net, nome: "ALICE", matchId: "1" }), b = ROOM.open({ net, nome: "BOB", matchId: "1" });
  await a.markReady(true);
  assert.equal(net.docs.get("partite/1").stato, "attesa");
  assert.equal((await a.maybeStart({ forza: true, nome: "ALICE" })).applied, false);
  assert.equal((await b.markReady(true)).applied, false, "un estraneo non si dichiara pronto");
  await b.addPlayer("BOB");
  assert.deepEqual(net.docs.get("partite/1").pronti, ["ALICE"], "entrare non equivale a essere pronti");
  assert.equal((await b.maybeStart({ forza: true, nome: "ALICE" })).applied, false, "non si impersona l'host");
  await b.markReady(true);
  assert.equal(net.docs.get("partite/1").stato, "pronto");
  assert.ok(net.docs.get("partite/1").startAt <= Date.now() + 100);
  net.docs.get("partite/1").stato = "conclusa";
  assert.equal((await a.addPlayer("CARLO")).applied, false);
});

test("room: creazione senza fallback che duplica i documenti", async () => {
  const net = memoryNet();
  const o = { net, id: "SALA", gioco: "bomba-parole", giocatori: ["ALICE", "ALICE", "BOB"], maxGiocatori: 6 };
  await ROOM.create(o); await ROOM.create(o);
  assert.equal(net.docs.size, 1);
  assert.deepEqual(net.docs.get("partite/SALA").partecipanti, ["ALICE", "BOB"]);
  let calls = 0;
  await assert.rejects(ROOM.create({ ...o, net: { transact: async () => { calls++; throw new Error("permission-denied"); } } }));
  assert.equal(calls, 1);
});

test("room: rivincite simultanee creano una sola sala, nuovo seed e stessi posti", async () => {
  const net = memoryNet();
  const d = { ...match({ maxGiocatori: 4, opzioni: { mode: "creative", seed: "VECCHIO" } }), stato: "conclusa" };
  net.docs.set("partite/ORIGINALE", d);
  const a = ROOM.open({ net, nome: "ALICE", matchId: "ORIGINALE" }), b = ROOM.open({ net, nome: "BOB", matchId: "ORIGINALE" });
  const ids = await Promise.all([a.proposeRematch(), b.proposeRematch(), a.proposeRematch()]);
  assert.equal(new Set(ids).size, 1); assert.equal(net.docs.size, 2);
  const next = net.docs.get("partite/" + ids[0]);
  assert.equal(next.maxGiocatori, 4); assert.equal(next.opzioni.mode, "creative");
  assert.equal(next.opzioni.seed, undefined); assert.notEqual(next.seed, d.seed);
  assert.notEqual(ROOM.seedFrom("ORIGINALE_r"), ROOM.seedFrom("ORIGINALE_r_r"));
});

test("room: heartbeat aggiorna solo visto, nessun ripristino del vecchio pronto", async () => {
  const net = memoryNet(); const d = match();
  d.giocatori.ALICE.visto = 1; d.giocatori.ALICE.pronto = false;
  net.docs.set("partite/1", d);
  const a = ROOM.open({ net, nome: "ALICE", matchId: "1" }); a.data = clone(d);
  net.docs.get("partite/1").giocatori.ALICE.pronto = true;
  a.heartbeat(); await a.flush(); a.stop();
  assert.equal(net.docs.get("partite/1").giocatori.ALICE.pronto, true);
});

test("Rush: una risposta è vincolata al round visto, anche in caso di retry", () => {
  const d = match(), q = R.impostazioni(d).domande[0];
  const word = FAWCategorie.rispostePer(FAWCategorie.byId(q.categoria), q.lettera)[0];
  const request = { testo: word, roundIdx: 0 };
  assert.equal(R.rispostaPatch(d, "ALICE", request, d.startAt + 1000).ok, true);
  assert.equal(R.rispostaPatch(d, "ALICE", request, d.startAt + CFG().roundMs + 1000).motivo, "ROUND_SUPERATO");
  assert.equal(R.rispostaPatch(d, "SPETTATORE", request, d.startAt + 1000).motivo, "NON_PARTECIPANTE");
  assert.equal(R.rispostaPatch(d, "ALICE", { testo: word }, d.startAt + 1000).ok, false);
});
function CFG() { return R.CFG; }

test("Rush: catch-up atomico di tutti i round, mancanti contate e risultato idempotente", () => {
  let d = match();
  const questions = R.impostazioni(d).domande;
  questions.forEach((q, i) => {
    const word = FAWCategorie.rispostePer(FAWCategorie.byId(q.categoria), q.lettera).find(w => R.valutaRisposta(w, q, { giaUsate: R.giaUsate(d, "ALICE", i) }).ok);
    const result = R.rispostaPatch(d, "ALICE", { testo: word, roundIdx: i }, d.startAt + i * R.CFG.roundMs + 1000);
    assert.equal(result.ok, true); d = FAWNet.applyPatch(d, result.patch);
  });
  const final = FAWNet.applyPatch(d, R.avanza(d, d.endsAt + 100));
  assert.equal(final.stato, "conclusa");
  assert.equal(Object.keys(final.rush.punteggiRound).length, 4);
  assert.equal(final.rush.statistiche.ALICE.valide, 4);
  assert.equal(final.rush.statistiche.BOB.mancante, 4);
  assert.equal(final.risultati.classifica[0].punti, final.punteggi.ALICE);
  assert.equal(final.risultati.classifica[1].tempoMedio, null, "serializzabile in JSON/Firestore");
  assert.equal(R.avanza(final, final.endsAt + 90000), false);
});

test("Rush: chiusura mentre qualcuno invia, nessun punto ripetuto", () => {
  let d = match(), q = R.impostazioni(d).domande[0];
  const parola = FAWCategorie.rispostePer(FAWCategorie.byId(q.categoria), q.lettera)[0];
  const request = { testo: parola, roundIdx: 0 };
  d = FAWNet.applyPatch(d, R.rispostaPatch(d, "ALICE", request, d.startAt + 25999).patch);
  const p = R.avanza(d, d.startAt + 26000), judged = FAWNet.applyPatch(d, p);
  assert.equal(R.rispostaPatch(judged, "BOB", request, d.startAt + 26001).ok, false);
  assert.equal(R.avanza(judged, d.startAt + 26001), false);
  assert.equal(judged.rush.rivela.BOB, undefined);
  assert.equal(judged.rush.rivela[0].BOB.motivo, "MANCANTE");
});

test("Rush: un voto definitivo, niente auto-voto, estranei o round sbagliato", () => {
  let d = match({ opzioni: { mode: "creative" } });
  d.rush = { risposte: { 0: { ALICE: { parola: "una risposta", ok: true, t: 1000 }, BOB: { parola: "altra risposta", ok: true, t: 2000 } } } };
  const ora = d.startAt + R.CFG.inputMs + 100;
  const req = { roundIdx: 0, nome: "BOB" };
  assert.equal(R.votoPatch(d, "BOB", req, ora), false);
  assert.equal(R.votoPatch(d, "ESTRANEO", req, ora), false);
  assert.equal(R.votoPatch(d, "ALICE", { ...req, roundIdx: 1 }, ora), false);
  d = FAWNet.applyPatch(d, R.votoPatch(d, "ALICE", req, ora));
  assert.equal(R.votoPatch(d, "ALICE", req, ora), false);
  d = FAWNet.applyPatch(d, R.avanza(d, ora) || {});
  assert.equal(d.rush.punteggiRound[0], undefined, "niente punti durante il voto");
  const judged = FAWNet.applyPatch(d, R.avanza(d, ora + R.CFG.votoMs));
  assert.equal(judged.rush.punteggiRound[0].BOB, 140);
  assert.equal(judged.rush.punteggiRound[0].ALICE, 40);
});

test("categorie: varianti canoniche, niente simboli mascherati o finte risposte", () => {
  const cat = FAWCategorie.byId("animali");
  assert.equal(FAWCategorie.groupKey("cani", cat), "cane");
  assert.equal(FAWCategorie.groupKey("leoni", cat), "leone");
  assert.equal(FAWCategorie.valida("loro", cat, "L").ok, false);
  assert.equal(FAWCategorie.valida("ca@ne", cat, "C").ok, false);
  assert.equal(FAWCategorie.groupKey("bici", FAWCategorie.byId("trasporti")), "bicicletta");
  FAWCategorie.comboDisponibili({ min: 4 }).forEach(c => {
    const keys = FAWCategorie.rispostePer(c.categoria, c.lettera).map(w => FAWCategorie.groupKey(w, c.categoria));
    assert.ok(new Set(keys).size >= 4);
  });
  const rounds = R.roundsDaSeed("VARIETA", 6);
  assert.equal(new Set(rounds.map(q => q.categoria)).size, 6);
  assert.equal(new Set(R.roundsDaSeed("CREATIVE", 4, { modale: "creative" }).map(q => q.categoria)).size, 4);
});

test("Firestore compat: FieldValue statico, set/add/update e transazioni sul backend produzione", async () => {
  let setData, updateData, transactionUpdate;
  const FV = { serverTimestamp: () => "SERVER_TIME", arrayUnion: (...v) => ({ union: v }), arrayRemove: (...v) => ({ remove: v }), increment: v => ({ increment: v }), delete: () => "DELETE" };
  const snap = { exists: true, id: "1", data: () => ({ n: 1, lista: ["A"], native: { preserve: true } }) };
  const ref = { get: async () => snap, set: async d => { setData = d; }, update: async d => { updateData = d; } };
  const db = { doc: () => ref, settings: () => {}, collection: () => ({ add: async d => { setData = d; return { id: "NEW" }; } }), runTransaction: fn => fn({ get: async () => snap, update: (_, d) => { transactionUpdate = d; }, set: () => assert.fail("non riscrivere l'intero documento") }) };
  const firestore = () => db; firestore.FieldValue = FV;
  const ctx = { module: { exports: {} }, console, Date, Map, Set, Promise, setTimeout, clearTimeout, firebase: { apps: [{}], firestore } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "games/shared/faw-net.js"), "utf8"), ctx);
  const NET = ctx.module.exports; NET.init({ backend: "firebase" });
  await NET.set("partite/1", { n: 0 }); assert.equal(setData.syncAt, "SERVER_TIME");
  assert.equal(await NET.add("partite", { n: 0 }), "NEW"); assert.equal(setData.syncAt, "SERVER_TIME");
  await NET.update("partite/1", { lista: NET.ops.arrayUnion(["B", "C"]) });
  assert.equal(JSON.stringify(updateData.lista), JSON.stringify({ union: ["B", "C"] }));
  const result = await NET.transact("partite/1", () => ({ n: NET.ops.increment(2) }));
  assert.equal(result.data.n, 3); assert.equal(transactionUpdate.n.increment, 2);
  assert.equal(transactionUpdate.native, undefined, "i valori nativi non toccati restano sul server");
});

test("bootstrap: Rush e Bomba caricano SDK e config, non un relay di fallback in produzione", async () => {
  for (const game of ["categoria-rush", "bomba-parole"]) {
    const page = fs.readFileSync(path.join(ROOT, "games", game, "index.html"), "utf8");
    const scripts = [...page.matchAll(/<script[^>]+src="([^"]+)"/g)].map(x => x[1]);
    assert.ok(scripts.some(x => /firebase-app-compat/.test(x)));
    assert.ok(scripts.some(x => /firebase-firestore-compat/.test(x)));
    assert.ok(scripts.indexOf("../shared/firebase-config.js") < scripts.indexOf("../shared/faw-net.js"));
  }
  const ctx = { module: { exports: {} }, console, Date, Map, Set, Promise, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'games/shared/faw-net.js'), 'utf8'), ctx);
  const net = ctx.module.exports; net.init({ backend: 'firebase' });
  await assert.rejects(net.ready(), /SDK Firestore non caricato/);
  await assert.rejects(net.transact('partite/1', () => ({})), /SDK Firestore non caricato/);
  await assert.rejects(net.get('partite/1'), /SDK Firestore non caricato/);

});

test("Firestore: offset anche con orologio locale avanti, solo dalla propria scrittura confermata", async () => {
  let write, listener;
  class TestDate extends Date { static now() { return 10000; } }
  const ref = { set: async d => { write = d; }, onSnapshot: (_, cb) => { listener = cb; return () => {}; } };
  const firestore = () => ({ doc: () => ref, settings: () => {} });
  firestore.FieldValue = { serverTimestamp: () => 'SERVER_TIMESTAMP' };
  const ctx = { module: { exports: {} }, console, Date: TestDate, Map, Set, Promise, setTimeout, clearTimeout, firebase: { apps: [{}], firestore } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'games/shared/faw-net.js'), 'utf8'), ctx);
  const net = ctx.module.exports; net.init({ backend: 'firebase' });
  await net.set('partite/clock', {});
  const off = net.onDoc('partite/clock', () => {});
  const emit = (token, pending) => listener({ id: 'clock', exists: true, metadata: { hasPendingWrites: pending }, data: () => ({ syncToken: token, syncAt: { toMillis: () => 9500 } }) });
  emit('UN_ALTRO_GIOCATORE', false); assert.equal(net.clockSamples(), 0);
  emit(write.syncToken, true); assert.equal(net.clockSamples(), 0);
  emit(write.syncToken, false); assert.equal(net.clockOffset(), -500); assert.equal(net.clock(), 9500);
  emit(write.syncToken, false); assert.equal(net.clockSamples(), 1, 'ogni scrittura produce al massimo un campione');
  off();
});

test("relay: l'attesa del long-poll non altera la stima dell'orologio", async () => {
  let time = 10000;
  class TestDate extends Date { static now() { return time; } }
  const ctx = {
    module: { exports: {} }, console, Date: TestDate, Map, Set, Promise, setTimeout, clearTimeout, AbortController,
    fetch: async url => ({ ok: true, json: async () => {
      if (url.includes('/api/watch')) { time += 2000; return { serverNow: time, docs: { 'test/1': { version: 1, data: { n: 1 } } } }; }
      return { serverNow: time - 500, docs: {} };
    } })
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'games/shared/faw-net.js'), 'utf8'), ctx);
  const net = ctx.module.exports; net.init({ backend: 'fake', relayUrl: 'http://relay.test' });
  let off;
  await new Promise(resolve => { off = net.onDoc('test/1', () => { off(); resolve(); }); });
  assert.equal(net.clockOffset(), 0, 'due secondi di attesa non sono un secondo di skew');
  await net.get('test/2'); assert.equal(net.clockOffset(), -500, 'le risposte immediate contribuiscono al clock');
});
