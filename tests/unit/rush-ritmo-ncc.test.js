"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const CAT = require("../../games/shared/faw-categorie.js");
const sprintPrima = CAT.comboDisponibili().map(c => [c.id, c.lettera, c.n]);
const N = require("../../games/categoria-rush/js/nomi-cose-citta.js");
const R = require("../../games/categoria-rush/js/regole.js");
const NET = require("../../games/shared/faw-net.js");
const T = 1000000;
function match(mode = "classiche", players = ["A", "B"]) {
  const q = mode === N.MODE ? { lettera: "M", nome: "Nomi, Cose, Città", scheda: true, categorie: ["nomi", "cose", "citta"] }
    : mode === "creative" ? { categoria: "scusa", nome: "Una scusa", votazione: true, lettera: null }
      : { categoria: "animali", lettera: "C", nome: "Animali" };
  return { stato: "in_corso", partecipanti: players, punteggi: Object.fromEntries(players.map(n => [n, 0])), startAt: T,
    durata: R.ciclo(mode).roundMs * 2, endsAt: T + R.ciclo(mode).roundMs * 2, opzioni: { mode }, seed: "ritmo",
    rush: { domande: [q, { ...q, i: 1 }] } };
}
function reply(d, name, ms, extra = {}) {
  const res = R.rispostaPatch(d, name, { roundIdx: 0, testo: name === "A" ? "cane" : "cavallo", ...extra }, T + ms);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(Object.keys(res.patch).every(k => !k.startsWith("rush.")), "nessuna patch con antenato rush e campi discendenti in conflitto");
  return NET.applyPatch(d, res.patch);
}
function sheet(d, name, ms, valori, rev = 0) { return reply(d, name, ms, { valori, rev }); }
const completo = { nomi: "Mario", cose: "martello", citta: "Milano" };
const secondo = { nomi: "Marco", cose: "matita", citta: "Modena" };

test("NCC: lettere fattibili in ogni categoria, deterministiche e senza ripetizioni; Sprint non cambia", () => {
  for (const cols of [3, 6]) {
    assert.ok(N.lettere(cols).length >= 8);
    for (let seed = 0; seed < 120; seed++) {
      const qs = N.rounds("test-" + seed, 3, cols);
      assert.deepEqual(qs, N.rounds("test-" + seed, 3, cols));
      assert.equal(new Set(qs.map(q => q.lettera)).size, 3);
      for (const q of qs) {
        assert.equal(q.categorie.length, cols);
        for (const id of q.categorie) {
          const cat = N.byId(id), words = CAT.rispostePer(cat, q.lettera);
          assert.ok(new Set(words.map(w => CAT.groupKey(w, cat))).size >= 2, id + ":" + q.lettera);
          assert.ok(words.every(w => CAT.valida(w, cat, q.lettera).ok));
        }
      }
    }
  }
  assert.deepEqual(CAT.comboDisponibili().map(c => [c.id, c.lettera, c.n]), sprintPrima);
  assert.equal(N.categorie(3).map(c => c.nome).join(", "), "Nomi, Cose, Città");
  assert.equal(N.categorie(6).length, 6);
});

test("NCC: valida casella per casella, non tratta vuoti come errori, esclude campi estranei", () => {
  const q = match(N.MODE).rush.domande[0];
  const v = N.valuta({ nomi: "  Mario  ", cose: "qq", citta: "Parigi", extra: "trucco" }, q);
  assert.equal(v.valide, 1); assert.equal(v.completa, false);
  assert.deepEqual(v.errori, { cose: "CORTA", citta: "LETTERA" });
  assert.deepEqual(Object.keys(v.valori), q.categorie);
  assert.equal(N.valuta({}, q).valide, 0);
  assert.deepEqual(N.valuta({}, q).errori, {});
  assert.equal(N.valuta(completo, q).completa, true);
  assert.equal(CAT.valida("gomm a", N.byId("cose"), "G").ok, false);
  assert.equal(CAT.valida("ri o", N.byId("citta"), "R").ok, false);
});

test("NCC: 20/10/5/0 per singola categoria, alias equivalenti, nessun premio per la velocità", () => {
  const q = { categorie: ["nomi", "cose", "citta", "frutta"], lettera: "F" };
  const rows = {
    A: { valori: { nomi: "Fabio", cose: "frigo", citta: "Firenze", frutta: "Fragole" }, t: 45000 },
    B: { valori: { nomi: "Franco", cose: "frigorifero", citta: "Fuorielenco", frutta: "fragola" }, t: 1 },
    C: { valori: { nomi: "Fabio", cose: "forno", citta: "", frutta: "pizza" }, t: 20000 }
  };
  const e = N.punteggi(rows, q, ["A", "B", "C"]);
  assert.deepEqual(e.punti, { A: 35, B: 20, C: 15 });
  assert.equal(e.rivela.A.scheda.citta.punti, 20);
  assert.equal(e.rivela.B.scheda.nomi.punti, 10);
  assert.equal(e.rivela.A.scheda.cose.punti, 5);
  assert.equal(e.rivela.A.scheda.frutta.punti, 5);
  assert.equal(e.rivela.B.scheda.citta.punti, 0);
  rows.A.t = 0; rows.B.t = 49000;
  assert.deepEqual(N.punteggi(rows, q, ["A", "B", "C"]).punti, e.punti);
});

test("NCC: nomi maschili/femminili, città estere esplicite; nomi diversi non sono soprannomi", () => {
  for (const w of ["roberto", "roberta"]) assert.equal(CAT.valida(w, N.byId("nomi"), "R").ok, true);
  assert.notEqual(CAT.groupKey("sandro", N.byId("nomi")), CAT.groupKey("alessandro", N.byId("nomi")));
  assert.equal(CAT.valida("londra", N.byId("citta"), "L").ok, true);
  assert.equal(CAT.groupKey("frigo", N.byId("cose")), CAT.groupKey("frigorifero", N.byId("cose")));
});

test("Rush: ultimo invio chiude e assegna i punti atomicamente, senza cambiare startAt o bonus velocità", () => {
  let d = reply(match(), "A", 1000);
  assert.equal(R.fasePartita(d, T + 1000).fase, "input");
  assert.equal(d.rush.punteggiRound?.[0], undefined);
  d = reply(d, "B", 2000);
  assert.equal(d.startAt, T);
  assert.equal(d.rush.tempi[0].scritturaMs, 2000);
  assert.equal(R.fasePartita(d, T + 2000).fase, "rivela");
  assert.equal(d.punteggi.A, 100 + 60 + Math.round(40 * (1 - 1000 / 26000)));
  assert.equal(d.punteggi.B, 100 + 60 + Math.round(40 * (1 - 2000 / 26000)));
  assert.equal(R.rispostaPatch(d, "A", { roundIdx: 0, testo: "cervo" }, T + 2001).ok, false);
  assert.equal(R.avanza(d, T + 2500), false, "non si riassegnano i punti");
});

test("Rush: Passo è definitivo e vale zero; un assente non viene tolto dal quorum", () => {
  let d = match(); d.giocatori = { A: { visto: T }, B: { visto: 0 } };
  d = reply(d, "A", 1000, { passo: true });
  assert.equal(R.fasePartita(d, T + 5000).fase, "input");
  assert.equal(R.tuttiConsegnati(d, 0), false);
  assert.equal(R.rispostaPatch(d, "A", { roundIdx: 0, testo: "cane" }, T + 2000).ok, false);
  const closed = NET.applyPatch(d, R.avanza(d, T + 26000));
  assert.equal(closed.rush.punteggiRound[0].A, 0);
  assert.equal(closed.rush.punteggiRound[0].B, 0);
  assert.equal(closed.rush.rivela[0].A.motivo, "PASSO");
});

test("Rush: tutti pronti saltano il confronto, proteggono i round passati e i payload catturati", () => {
  let d = reply(reply(match(), "A", 1000), "B", 2000);
  const score = structuredClone(d.rush.punteggiRound[0]);
  d = NET.applyPatch(d, R.avantiPatch(d, "A", { roundIdx: 0 }, T + 2500));
  assert.equal(R.fasePartita(d, T + 2500).fase, "rivela");
  assert.equal(R.avantiPatch(d, "A", { roundIdx: 0 }, T + 2501), false);
  assert.equal(R.avantiPatch(d, "ESTERNO", { roundIdx: 0 }, T + 2501), false);
  d = NET.applyPatch(d, R.avantiPatch(d, "B", { roundIdx: 0 }, T + 3000));
  const f = R.fasePartita(d, T + 3000);
  assert.equal(f.fase, "input"); assert.equal(f.indice, 1); assert.equal(f.inizioRound, 3000);
  assert.equal(d.startAt, T);
  assert.equal(R.rispostaPatch(d, "A", { roundIdx: 0, testo: "capra" }, T + 3100).motivo, "ROUND_SUPERATO");
  assert.deepEqual(d.rush.punteggiRound[0], score);
  assert.equal(R.puoScrivere(d, "A", { roundIdx: 1, ora: T + 3500 }).t, 500);
});

test("Rush: documenti senza tempi adattivi mantengono tutte le scadenze nominali", () => {
  for (const mode of ["classiche", "creative", N.MODE]) {
    const d = match(mode), ciclo = R.ciclo(mode);
    for (const ms of [-1, 0, 1000, ciclo.inputMs, ciclo.roundMs - 1, ciclo.roundMs, 2 * ciclo.roundMs]) {
      const old = R.faseRound(T, T + ms, { rounds: 2, modale: mode }), now = R.fasePartita(d, T + ms);
      assert.equal(now.fase, old.fase); assert.equal(now.indice, old.indice); assert.equal(now.entroMs, old.entroMs);
    }
  }
});

test("Creativo: tutti consegnati aprono il voto; voto/astensione di tutti lo chiudono subito", () => {
  let d = match("creative", ["A", "B", "C"]);
  d = reply(d, "A", 500, { testo: "scusa uno" });
  d = reply(d, "B", 1000, { passo: true });
  d = reply(d, "C", 2000, { testo: "scusa tre" });
  assert.equal(R.fasePartita(d, T + 2000).fase, "voto");
  assert.equal(R.votoPatch(d, "A", { roundIdx: 0, nome: "A" }, T + 2200), false);
  d = NET.applyPatch(d, R.votoPatch(d, "A", { roundIdx: 0, nome: "C" }, T + 2300));
  d = NET.applyPatch(d, R.votoPatch(d, "B", { roundIdx: 0, astieni: true }, T + 2500));
  assert.equal(R.fasePartita(d, T + 2500).fase, "voto");
  assert.equal(R.votoPatch(d, "B", { roundIdx: 0, nome: "A" }, T + 2600), false);
  d = NET.applyPatch(d, R.votoPatch(d, "C", { roundIdx: 0, nome: "A" }, T + 2700));
  assert.equal(R.fasePartita(d, T + 2700).fase, "rivela");
  assert.deepEqual(d.rush.punteggiRound[0], { A: 140, B: 0, C: 140 });
  assert.equal(d.rush.tempi[0].votoMs, 700);
  assert.equal(R.votoPatch(d, "B", { roundIdx: 0, nome: "C" }, T + 2800), false);
});

test("Creativo: senza risposte candidabili non spreca una finestra di voto vuota", () => {
  let d = reply(reply(match("creative"), "A", 1000, { passo: true }), "B", 2000, { passo: true });
  assert.equal(R.fasePartita(d, T + 2000).fase, "rivela");
  assert.equal(d.rush.tempi[0].votoMs, 0);
  assert.deepEqual(d.rush.punteggiRound[0], { A: 0, B: 0 });
  d = NET.applyPatch(match("creative"), R.avanza(match("creative"), T + 26000));
  assert.equal(R.fasePartita(d, T + 26000).fase, "rivela");
});

test("Rush: chi entra dopo lo stop non estende retroattivamente il quorum di voto/confronto", () => {
  let d = reply(reply(match("creative"), "A", 1000), "B", 2000);
  d.partecipanti.push("C");
  assert.deepEqual(R.giocatoriRound(d, 0), ["A", "B"]);
  assert.equal(R.votoPatch(d, "C", { roundIdx: 0, nome: "A" }, T + 2100), false);
  d = NET.applyPatch(d, R.votoPatch(d, "A", { roundIdx: 0, astieni: true }, T + 2200));
  d = NET.applyPatch(d, R.votoPatch(d, "B", { roundIdx: 0, astieni: true }, T + 2300));
  assert.equal(R.fasePartita(d, T + 2300).fase, "rivela");
  assert.equal(R.avantiPatch(d, "C", { roundIdx: 0 }, T + 2350), false);
  d = NET.applyPatch(d, R.avantiPatch(d, "A", { roundIdx: 0 }, T + 2400));
  d = NET.applyPatch(d, R.avantiPatch(d, "B", { roundIdx: 0 }, T + 2500));
  assert.deepEqual(R.giocatoriRound(d, 1), ["A", "B", "C"]);
});

test("NCC: la prima scheda completa lascia 10 secondi; le bozze non valgono come consegna", () => {
  let d = match(N.MODE);
  d = NET.applyPatch(d, R.bozzaPatch(d, "B", { roundIdx: 0, valori: secondo, rev: 1 }, T + 1000));
  assert.equal(R.tuttiConsegnati(d, 0), false);
  d = sheet(d, "A", 5000, completo);
  assert.equal(R.fasePartita(d, T + 5000).entroMs, 10000);
  assert.equal(d.rush.tempi[0].stopDa, "A");
  assert.equal(d.endsAt, T + 15000 + 10000 + 60000);
  assert.equal(d.startAt, T);
  d = sheet(d, "B", 6000, secondo, 2);
  assert.equal(R.fasePartita(d, T + 6000).fase, "rivela");
  assert.equal(d.rush.tempi[0].scritturaMs, 6000);
  assert.deepEqual(d.rush.punteggiRound[0], { A: 30, B: 30 });
});

test("NCC: Stop tardi non allunga i 50 secondi; primo Stop e scadenza sono irrevocabili", () => {
  let d = match(N.MODE, ["A", "B", "C"]);
  d = sheet(d, "A", 48000, completo);
  assert.equal(R.fasePartita(d, T + 48000).entroMs, 2000);
  d = sheet(d, "B", 49000, secondo);
  assert.equal(d.rush.tempi[0].scritturaMs, 50000);
  assert.equal(d.rush.tempi[0].stopDa, "A");
  assert.equal(R.rispostaPatch(d, "C", { roundIdx: 0, valori: completo }, T + 50000).ok, false);
  assert.equal(R.bozzaPatch(d, "C", { roundIdx: 0, valori: completo, rev: 1 }, T + 50000), false);
});

test("NCC: bozze revisionate, nessuna sovrascrittura tardiva, invalidi segnalati prima della consegna", () => {
  let d = match(N.MODE);
  const req = { roundIdx: 0, valori: completo, rev: 2 };
  d = NET.applyPatch(d, R.bozzaPatch(d, "A", req, T + 1000));
  assert.equal(R.bozzaPatch(d, "A", { ...req, rev: 1, valori: {} }, T + 1200), false);
  assert.equal(R.bozzaPatch(d, "A", req, T + 1200), false);
  assert.equal(R.bozzaPatch(d, "A", { ...req, rev: NaN }, T + 1200), false);
  assert.equal(R.bozzaPatch(d, "ESTERNO", req, T + 1200), false);
  assert.equal(R.rispostaPatch(d, "A", { ...req, rev: 1 }, T + 1200).motivo, "BOZZA_SUPERATA");
  assert.equal(R.rispostaPatch(d, "A", { ...req, valori: { ...completo, cose: "pizza" } }, T + 1200).motivo, "SCHEDA_NON_VALIDA");
  d = sheet(d, "A", 1300, { ...completo, cose: "" }, 3);
  assert.equal(d.rush.tempi?.[0], undefined, "consegna parziale: non dà Stop");
  assert.equal(R.bozzaPatch(d, "A", { ...req, rev: 4 }, T + 1400), false);
});

test("NCC: al tempo scaduto si sigilla solo l'ultima bozza salvata; vuoti/invalidi zero, catch-up idempotente", () => {
  let d = match(N.MODE);
  const values = { nomi: "Mario", cose: "mela", citta: "" };
  d = NET.applyPatch(d, R.bozzaPatch(d, "B", { roundIdx: 0, valori: values, rev: 1 }, T + 1000));
  d = sheet(d, "A", 5000, completo);
  d = NET.applyPatch(d, R.avanza(d, T + 15000));
  assert.equal(d.rush.risposte[0].B.scheda, true);
  assert.deepEqual(d.rush.punteggiRound[0], { A: 45, B: 5 });
  assert.equal(d.rush.rivela[0].B.scheda.cose.esito, "NON_CATEGORIA");
  const final = NET.applyPatch(d, R.avanza(d, T + 120000));
  assert.equal(final.stato, "conclusa");
  assert.equal(Object.keys(final.rush.punteggiRound).length, 2);
  assert.equal(final.rush.statistiche.A.valide, 3);
  assert.equal(final.rush.statistiche.B.mancante, 5);
  assert.equal(final.risultati.secondiRisparmiati, 35);
  assert.equal(R.avanza(final, T + 121000), false);
  assert.equal(R.rispostaPatch(final, "A", { roundIdx: 1, valori: completo }, T + 121000).ok, false);
});

test("NCC: parità sui punti, senza spareggio su uniche o tempo", () => {
  const stats = { A: { uniche: 9, tetti: [1] }, B: { uniche: 0, tetti: [40000] } };
  const grad = R.classifica({ A: 30, B: 30 }, stats, { modale: N.MODE });
  assert.equal(R.esito(grad, { modale: N.MODE }).pareggio, true);
  assert.deepEqual(R.esito(grad, { modale: N.MODE }).pari, ["A", "B"]);
  assert.equal(R.esito(grad).pareggio, false, "Sprint mantiene gli spareggi dichiarati");
});

test("Rush: durate memorizzate malformate non allungano i limiti né rompono le fasi", () => {
  const d = match();
  d.rush.tempi = { 0: { scritturaMs: -1, votoMs: "100", confrontoMs: Infinity }, 1: { scritturaMs: 99999999, confrontoMs: 90000 } };
  assert.equal(R.tempiPartita(d)[0].fine, 30000);
  assert.equal(R.tempiPartita(d)[1].fine, 60000);
  assert.equal(R.rispostaPatch(d, "A", { roundIdx: 0, testo: "cane" }, NaN).ok, false);
  assert.equal(R.avanza(d, Infinity), false);
});
