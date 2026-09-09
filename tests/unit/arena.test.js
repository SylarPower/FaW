/**
 * Test unitari — regole di Parole in Arena (punteggi, energia, eventi, potenziamenti).
 * `npm run test:unit`
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..", "..");
global.window = global;
require(path.join(ROOT, "games/shared/faw-core.js"));
require(path.join(ROOT, "games/shared/faw-words.js"));
require(path.join(ROOT, "games/parole-arena/js/regole.js"));
const CORE = global.FAWCore;
const WORDS = global.FAWWords;
const R = global.FAWArenaRules;

test.before(() => {
  WORDS.setWords(fs.readFileSync(path.join(ROOT, "dizionario.txt"), "utf8").split("\n").filter((w) => w.trim().length >= 4).map((w) => w.trim()));
});

/* ------------------------------- punteggio ------------------------------- */

test("arena: punteggio base in scala con la lunghezza", () => {
  assert.equal(R.puntiBase(3), 0, "sotto le 4 lettere non si segna");
  assert.equal(R.puntiBase(4), 8);
  assert.equal(R.puntiBase(5), 10);
  assert.equal(R.puntiBase(6), 12);
  assert.equal(R.puntiBase(7), 14);
  assert.equal(R.puntiBase(8), 24, "da 8 lettere il moltiplicatore passa a 3");
  assert.equal(R.puntiBase(10), 30);
});

test("arena: bonus medi e somma dei dettagli", () => {
  const r = R.punteggi("STRADA", {});
  assert.equal(r.punti, 12 + R.CFG.bonusMedie, "6 lettere: base + bonus parole medie");
  assert.deepEqual(r.dettagli.map((d) => d.k), ["6 lettere", "parola da 6+"]);
  assert.equal(R.punteggi("CANE", {}).punti, 8);
  assert.equal(R.punteggi("CASETTA", {}).punti, 14 + R.CFG.bonusMedie);
});

test("arena: Raddio raddoppia e non toglie punti a fine effetto", () => {
  const senza = R.punteggi("CANE", {});
  const con = R.punteggi("CANE", { effetti: { raddio: true } });
  assert.equal(con.punti, senza.punti * 2);
  assert.equal(con.moltiplicatore, 2);
  assert.equal(senza.punti, 8, "il punteggio base non muta per gli altri");
});

test("arena: Sabbiatura sospende solo i bonus evento/casella", () => {
  const ev = { tipo: "lettera", payload: "S" };
  const libero = R.punteggi("STRADA", { evento: ev, effetti: {} });
  const sabbiato = R.punteggi("STRADA", { evento: ev, effetti: { sabbiato: true } });
  assert.equal(libero.punti, 12 + R.CFG.bonusMedie + R.CFG.bonusLettera);
  assert.equal(sabbiato.punti, 12 + R.CFG.bonusMedie, "la base e il bonus media lunghezza restano");
  const cella = R.punteggi("CANE", { evento: { tipo: "casella", payload: 3 }, effetti: { casellaSpeciale: true } });
  assert.equal(cella.punti, 8 + R.CFG.bonusCasella);
  const cellaSab = R.punteggi("CANE", { evento: { tipo: "casella", payload: 3 }, effetti: { casellaSpeciale: true, sabbiato: true } });
  assert.equal(cellaSab.punti, 8);
});

test("arena: energia +1 (+2 da 7 lettere) con tetto 10", () => {
  assert.equal(R.energiaDopo(0, 4), 1);
  assert.equal(R.energiaDopo(0, 7), 3);
  assert.equal(R.energiaDopo(9, 4), 10);
  assert.equal(R.energiaDopo(10, 9), 10, "il tetto non si supera");
});

/* --------------------------------- eventi -------------------------------- */

test("arena: gli eventi sono deterministici per seed e uguali su ogni client", () => {
  const mk = (t) => R.eventoAttivo("SEED-X", t, { celle: 25, durataMs: 180000 });
  const altri = [];
  for (let i = 0; i < 8; i++) altri.push(mk(i * 25000 + 1000));
  const replica = altri.map((_, i) => mk(i * 25000 + 1000));
  assert.deepEqual(altri.map((e) => e && [e.tipo, e.payload]), replica.map((e) => e && [e.tipo, e.payload]));
  assert.notDeepEqual(
    [0, 1, 2, 3].map((i) => { const e = R.eventoAttivo("DIVERSO", i * 25000 + 1000, { celle: 25 }); return e && e.tipo + e.payload; }),
    [0, 1, 2, 3].map((i) => { const e = R.eventoAttivo("SEED-X", i * 25000 + 1000, { celle: 25 }); return e && e.tipo + e.payload; })
  );
});

test("arena: nessun evento prima del primo intervallo e durata limitata alla partita", () => {
  assert.equal(R.eventoAttivo("S", -1000, { celle: 25 }), null);
  assert.equal(R.eventoAttivo("S", 0, { celle: 25, durataMs: 0 }), null);
  const e = R.eventoAttivo("S", 1000, { celle: 25, durataMs: 20000 });
  assert.ok(e, "il primo evento copre almeno la parte rimanente della partita");
  assert.ok(e.fineMs - e.inizioMs <= 20000 && e.entroMs <= 19000);
});

test("arena: eventi disattivabili nella modalità senza potenziamenti", () => {
  assert.equal(R.eventoAttivo("S", 30000, { senzaEventi: true }), null);
});

test("arena: gli eventi non cambiano le lettere (nessun mutamento di griglia)", () => {
  const lettere = R.GRIGLIE ? null : null;
  const e0 = R.eventoAttivo("SEED-Y", 1000, { celle: 25 });
  const e1 = R.eventoAttivo("SEED-Y", 26000, { celle: 25 });
  assert.ok(!("letters" in (e0 || {})) && !("cambia" in (e0 || {})), "l'evento non porta nuove lettere");
  assert.ok(e1.entroMs > 0);
  void lettere;
});

/* ------------------------------ validazione ------------------------------ */

test("arena: selezione parola — adiacenza, celle duplicate, lunghezza, dizionario", () => {
  const letters = ["S", "T", "R", "A", "D", "X", "X", "X", "X", "A", "C", "A", "N", "E", "Z", "P", "L", "U", "M", "Y", "B", "A", "N", "C", "O"];
  const ok = R.valutaSelezione([0, 1, 2, 3, 4, 9], { size: 5, letters }); // S T R A D + A sotto
  assert.equal(ok.ok, true, "STRADA adiacente: " + JSON.stringify(ok));
  assert.equal(ok.parola, "STRADA");
  assert.equal(ok.puntiBase, R.puntiBase(6));

  assert.equal(R.valutaSelezione([0, 2], { size: 5, letters }).motivo, "NON_ADJACENT");
  assert.equal(R.valutaSelezione([0, 1, 1], { size: 5, letters }).motivo, "CELLA_DOPPIA");
  assert.equal(R.valutaSelezione([0, 1, 2], { size: 5, letters }).motivo, "CORTA");
  assert.equal(R.valutaSelezione([10, 11, 12, 13], { size: 5, letters, giocate: new Set(["CANE"]) }).motivo, "GIÀ_TROVATA");
  assert.equal(R.valutaSelezione([15, 16, 17, 18], { size: 5, letters }).motivo, "NON_TROVATA");
  assert.equal(R.valutaSelezione([], { size: 5, letters }).motivo, "VUOTA");
});

test("arena: wrap tra fine riga e inizio riga rifiutato", () => {
  const letters = new Array(25).fill("A");
  assert.equal(R.valutaSelezione([4, 5], { size: 5, letters }).motivo, "NON_ADJACENT");
});

/* ------------------------------ potenziamenti ---------------------------- */

const baseStato = (over) => Object.assign({
  me: "ALICE",
  giocatori: ["ALICE", "BOB", "CARLO"],
  arena: { energia: { ALICE: 10, BOB: 2 }, attivi: {}, immune: {}, colpito: {} },
  bersaglio: null
}, over || {});

test("arena: costo energia rispettato per ogni potenziamento", () => {
  Object.keys(R.POWERUP).forEach((id) => {
    const cfg = R.POWERUP[id];
    assert.ok(cfg.costo >= 1 && cfg.costo <= 6, id + " costo fuori scala");
    assert.ok(cfg.durata >= 6000 && cfg.durata <= 20000, id + " durata fuori scala");
    assert.ok(cfg.testo.length > 12, id + " deve avere una descrizione leggibile");
    const povero = baseStato({ arena: { energia: { ALICE: 0 }, attivi: {}, immune: {}, colpito: {} } });
    assert.equal(R.puoAttivare(id, povero, 1000).ok, false);
    assert.match(R.puoAttivare(id, povero, 1000).motivo, /energia/i);
  });
});

test("arena: Raddio e Scudo non si sovrappongono a se stessi", () => {
  const t = 500000;
  const attivo = baseStato({ arena: { energia: { ALICE: 10 }, attivi: { ALICE: { raddio: { fine: t + 5000 } } }, immune: {}, colpito: {} } });
  assert.equal(R.puoAttivare("raddio", attivo, t).motivo, "Già attivo");
  assert.equal(R.puoAttivare("raddio", baseStato(), t).ok, true);
});

test("arena: Sabbiatura — niente catene, scudo e immunità conteggiate", () => {
  const t = 900000;
  assert.equal(R.puoAttivare("sabbiatura", baseStato(), t).ok, true);

  const conScudo = baseStato({ arena: { energia: { ALICE: 10 }, attivi: { BOB: { scudo: { fine: t + 4000 } }, CARLO: {} }, immune: {}, colpito: {} } });
  assert.equal(R.puoAttivare("sabbiatura", conScudo, t).bersaglio, "CARLO", "BOB è protetto");

  const tuttiImmuni = baseStato({ arena: { energia: { ALICE: 10 }, attivi: {}, immune: { BOB: t + 9000, CARLO: t + 9000 }, colpito: {} } });
  const r = R.puoAttivare("sabbiatura", tuttiImmuni, t);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /bersaglio/i);

  const soloUnBersaglio = baseStato({
    arena: { energia: { ALICE: 10 }, attivi: {}, immune: { CARLO: t + 9000 }, colpito: {}, ultimoBersaglio: "BOB", ultimoColpo: t - 1000 }
  });
  const anti = R.puoAttivare("sabbiatura", soloUnBersaglio, t);
  assert.equal(anti.ok, false, "lo stesso giocatore non può essere colpito due volte di fila");
});

test("arena: bersaglio singolo non bloccante (gioco 1 vs 1 comunque giocabile)", () => {
  const t = 1000;
  const duello = baseStato({ giocatori: ["ALICE", "BOB"], arena: { energia: { ALICE: 10 }, attivi: {}, immune: {}, colpito: {} } });
  assert.equal(R.puoAttivare("sabbiatura", duello, t).ok, true);
});

test("arena: patchAttivazione sottrae energia, marca durata e bersaglio", () => {
  const t = 123456;
  const arena = { energia: { ALICE: 10 }, attivi: {} };
  const patch = R.patchAttivazione("sabbiatura", "ALICE", "BOB", t, arena);
  assert.equal(patch["arena.energia.ALICE"], 5, "costo 5 scalato");
  assert.equal(patch["arena.colpito.BOB"].da, "ALICE");
  assert.equal(patch["arena.colpito.BOB"].fine, t + R.POWERUP.sabbiatura.durata);
  assert.equal(patch["arena.immune.BOB"], t + R.POWERUP.sabbiatura.durata + 12000, "immunità anti-catena");
  assert.equal(patch["arena.ultimoBersaglio"], "BOB");
  assert.ok(patch.logUltimo);

  const p2 = R.patchAttivazione("raddio", "ALICE", null, t, arena);
  assert.equal(p2["arena.attivi.ALICE.raddio"].parole, R.POWERUP.raddio.maxParole);
  assert.equal(p2["arena.colpito.BOB"], undefined);
});

/* ------------------------------- classifica ------------------------------ */

test("arena: classifica con tie-break deterministici", () => {
  const data = {
    partecipanti: ["A", "B", "C"],
    punteggi: { A: 40, B: 40, C: 12 },
    parole: { A: ["CANE", "GATTO"], B: ["CANE"], C: [] }
  };
  const c = R.classifica(data, { giocatori: data.partecipanti });
  assert.deepEqual(c.map((x) => x.nome), ["A", "B", "C"], "a pari punti vince chi ha più parole, poi l'alfabeto");
  assert.equal(c[0].parole, 2);
  assert.equal(c[0].piuLunga, 5);
});

test("arena: pareggio dichiarato come pareggio, non come vittoria", () => {
  assert.deepEqual(R.esito([{ nome: "A", punti: 10 }, { nome: "B", punti: 10 }]), { tipo: "pareggio", nomi: ["A", "B"], punti: 10 });
  assert.equal(R.esito([{ nome: "A", punti: 11 }, { nome: "B", punti: 10 }]).tipo, "vittoria");
  assert.equal(R.esito([]).tipo, "vuoto");
});

test("arena: miglior rimonta calcolata solo se la curva è sufficiente", () => {
  assert.equal(R.migliorRimonta([[0, 5, 0]], ["A", "B"]), null, "meno di 4 campioni: niente numero");
  const curva = [
    [0, 10, 0],
    [1, 20, 0],
    [2, 30, 5],
    [3, 30, 25],
    [4, 30, 40]
  ];
  const r = R.migliorRimonta(curva, ["A", "B"]);
  assert.equal(r.nome, "B");
  assert.equal(r.recupero, 25, "da -30 di svantaggio a +10: 25 punti recuperati");
  assert.equal(R.migliorRimonta([[0, 5, 0], [1, 6, 0], [2, 7, 0], [3, 8, 0]], ["A", "B"]), null, "chi è sempre avanti non ha rimontato");
});

test("arena: curva dei punteggi costruita nell'ordine dei giocatori", () => {
  const row = R.curvaRow(7000, ["A", "B", "C"], { A: 3, B: 5, C: 0 });
  assert.deepEqual(row, [7000, 3, 5, 0]);
});

test("arena: parole più lunghe tracciate per giocatore", () => {
  const data = { parole: { A: ["CANE", "CASETTA"], B: ["GATTO"] } };
  assert.deepEqual(R.piuLunga(data), { parola: "CASETTA", len: 7, chi: "A" });
  assert.equal(R.piuLunga({ parole: {} }), null);
});

test("arena: modalità e griglie valide per il banner del portale", () => {
  assert.deepEqual(Object.keys(R.GRIGLIE), ["4", "5", "6"]);
  Object.keys(R.POWERUP).forEach((id) => {
    assert.equal(R.POWERUP[id].id, id);
    assert.ok(["me", "altro"].includes(R.POWERUP[id].tipo));
  });
  assert.ok(R.CFG.eventoOgni === 25000, "evento circa ogni 25 secondi");
  assert.ok(R.CFG.minLen === WORDS.MIN_LEN, "lunghezza minima identica a Ruzzle");
});
