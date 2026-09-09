/**
 * Categoria Rush — test delle regole pure (nessun browser, nessun network).
 * Eseguire: npm run test:unit
 */
"use strict";

const test = require("node:test").test;
const assert = require("node:assert/strict");

global.FAWCore = require("../../games/shared/faw-core.js");
global.FAWCategorie = require("../../games/shared/faw-categorie.js");
const R = require("../../games/categoria-rush/js/regole.js");
const CAT = global.FAWCategorie;

/** Prima combinazione giocabile con una data lettera (per avere dati realistici). */
function combo(lettera, indice) {
  const pool = CAT.comboDisponibili({ min: 4 }).filter((c) => c.lettera === lettera);
  const c = pool[indice || 0];
  assert.ok(c, `deve esistere una categoria con risposte in lettera ${lettera}`);
  return { categoria: c.id, categoriaId: c.id, lettera: c.lettera, nome: c.categoria.nome };
}
const unaRispostaDi = (combo) => Object.keys(CAT.indice(CAT.byId(combo.categoria)))
  .filter((r) => r.charAt(0) === combo.lettera.toLowerCase() && r.length >= 3)[0];

test("rush: normalizzazione condivisa con dizionario e categorie", () => {
  assert.equal(R.norm("  CANE  "), "cane");
  assert.equal(R.norm("Cane"), R.norm("cane"), "maiuscole indifferenti");
  assert.equal(R.norm("cànе".replace("е", "e")), R.norm("cane"), "accenti ignorati");
  assert.equal(R.norm("ALL'ERTA"), "allerta", "apostrofi ignorati");
  assert.equal(R.norm("  una   cosa  ASSURDA "), "una cosa assurda", "spazi multipli accorpati");
  assert.equal(R.norm(null), "");
});

test("rush: una risposta ammessa passa, tutto il resto no", () => {
  const c = combo("C", 0);
  const giusta = unaRispostaDi(c);
  const ok = R.valutaRisposta(giusta, c, {});
  assert.equal(ok.ok, true, `${giusta} doveva essere ammessa in ${c.nome}`);
  assert.equal(R.valutaRisposta("pippo Pluto", c, {}).ok, false, "non è una risposta della categoria");
  assert.equal(R.valutaRisposta(giusta.slice(0, 2), c, {}).motivo, "CORTA");
  assert.equal(R.valutaRisposta("", c, {}).motivo, "VUOTO");
  assert.equal(R.valutaRisposta("c4ne", c, {}).motivo, "CARATTERI");
  assert.equal(R.valutaRisposta(giusta + "x".repeat(40), c, {}).motivo, "LUNGA");

  // lettera sbagliata: la parola esiste ed è nella categoria, ma non inizia bene
  const altre = Object.keys(CAT.indice(CAT.byId(c.categoria)))
    .filter((r) => r.charAt(0) !== c.lettera.toLowerCase() && r.length >= 3);
  if (altre.length) {
    const v = R.valutaRisposta(altre[0], c, {});
    assert.equal(v.ok, false, "la lettera del round è un requisito");
    assert.equal(v.motivo, "LETTERA");
  }

  // parola reale del dizionario ma fuori categoria → NON_CATEGORIA (il dizionario non basta)
  const fuori = R.valutaRisposta("tavolo", combo("T", 0), {});
  assert.ok(fuori.motivo === "NON_CATEGORIA" || fuori.ok === true,
    "o è ammessa in quella categoria o va rifiutata: " + JSON.stringify(fuori));
});

test("rush: la stessa risposta riciclata in un round successivo non vale", () => {
  const c = combo("C", 0);
  const giusta = unaRispostaDi(c);
  const v = R.valutaRisposta(giusta, c, { giaUsate: [giusta] });
  assert.equal(v.ok, false);
  assert.equal(v.motivo, "GIA_DATA");
  // scritta in un altro modo, è comunque la stessa risposta
  const v2 = R.valutaRisposta(giusta.toUpperCase(), c, { giaUsate: [" " + giusta + " "] });
  assert.equal(v2.motivo, "GIA_DATA");
});

test("rush: round generati dal seed, sempre giocabili e deterministici", () => {
  const a = R.roundsDaSeed("SEED-UNO", 6);
  const b = R.roundsDaSeed("SEED-UNO", 6);
  assert.equal(a.length, 6, "sei round per una partita da 3 minuti");
  assert.deepEqual(a.map((r) => r.categoria + ":" + r.lettera), b.map((r) => r.categoria + ":" + r.lettera),
    "stesso seed = stesse domande su ogni dispositivo");
  for (const r of a) {
    assert.ok(r.possibili >= 4, `round ${r.lettera}/${r.categoria} troppo povero: ${r.possibili} risposte`);
    assert.ok(r.lettera && r.nome, "ogni round ha lettera e categoria visibili");
  }
  // nessuna ripetizione identica domanda/lettera nella stessa partita
  const chiavi = a.map((r) => r.categoria + ":" + r.lettera);
  assert.equal(new Set(chiavi).size, chiavi.length, "niente round duplicati nella stessa partita");
});

test("rush: nessuna combinazioneImpossible — ogni lettera offerta ha risposte", () => {
  const pool = CAT.comboDisponibili({ min: 4 });
  assert.ok(pool.length >= 40, "il dataset deve offrire molte combinazioni giocabili");
  assert.ok(pool.every((c) => c.n >= 4));
  // e le lettere meno coperte restano comunque giocabili
  const perLettera = {};
  pool.forEach((c) => { perLettera[c.lettera] = (perLettera[c.lettera] || 0) + 1; });
  assert.ok(Object.keys(perLettera).length >= 12, "abbastanza lettere utilizzabili: " + Object.keys(perLettera).length);
});

test("rush: fasi del round e confini temporali", () => {
  const start = 1000000, rounds = 4, RM = R.CFG.roundMs;
  assert.equal(R.faseRound(start, start - 1, { rounds }).fase, "attesa", "countdown");
  assert.equal(R.faseRound(start, start + 1000, { rounds }).fase, "input");
  assert.equal(R.faseRound(start, start + R.CFG.inputMs - 1, { rounds }).fase, "input");
  assert.equal(R.faseRound(start, start + R.CFG.inputMs + 100, { rounds }).fase, "rivela");
  assert.equal(R.faseRound(start, start + RM - 1, { rounds }).fase, "rivela");
  assert.equal(R.faseRound(start, start + RM + 10, { rounds }).indice, 1, "round successivo");
  assert.equal(R.faseRound(start, start + rounds * RM, { rounds }).fase, "finita");
  assert.equal(R.faseRound(start, start + 99 * RM, { rounds }).fase, "finita", "un ritardo enorme non riapre i round");
  assert.equal(R.faseRound(start, start + rounds * RM, { rounds }).fineMatch, start + rounds * RM);
});

test("rush: punteggio = validità + velocità + originalità", () => {
  const e = R.punteggiRound({
    ALICE: { parola: "zebra", ok: true, t: 0 },
    BOB: { parola: "Zebra", ok: true, t: 13000 },
    CINZIA: { parola: "zorba", ok: false, motivo: "NON_CATEGORIA", t: 1000 }
  }, { giocatori: ["ALICE", "BOB", "CINZIA", "DARIO"] });

  assert.equal(e.dettagli.ALICE.base, 100);
  assert.equal(e.dettagli.ALICE.velocita, R.CFG.bonusVelMax, "chi risponde subito prende il bonus pieno");
  assert.equal(e.dettagli.ALICE.originalita, R.CFG.bonusCoppia, "stessa risposta in due: bonus dimezzato, non azzerato");
  assert.equal(e.dettagli.BOB.originalita, R.CFG.bonusCoppia);
  assert.ok(e.punti.ALICE > e.punti.BOB, "la velocità conta solo tra risposte valide pari");
  assert.equal(e.dettagli.BOB.condivisa, 2, "ALICE e BOB hanno dato la stessa risposta (stessa forma canonica)");
  assert.equal(e.punti.CINZIA, 0, "risposta non valida: zero, nessuna penalità aggiuntiva");
  assert.equal(e.dettagli.CINZIA.motivo, "NON_CATEGORIA");
  assert.equal(e.punti.DARIO, 0);
  assert.equal(e.dettagli.DARIO.motivo, "MANCANTE");

  // il bonus velocità è monotòno e non supera il tetto
  const t0 = R.punteggiRound({ A: { parola: "x", ok: true, t: 0 } }, {}).punti.A;
  const tHalf = R.punteggiRound({ A: { parola: "x", ok: true, t: R.CFG.inputMs / 2 } }, {}).punti.A;
  const tEnd = R.punteggiRound({ A: { parola: "x", ok: true, t: R.CFG.inputMs } }, {}).punti.A;
  assert.ok(t0 > tHalf && tHalf > tEnd, "prima rispondi, più punti");
  assert.equal(tEnd, R.CFG.puntiBase + R.CFG.bonusUnico, "all'ultimo istante resta solo base + unicità");
  assert.ok(t0 - tEnd <= R.CFG.bonusVelMax, "il bonus velocità non esplode");

  // tre risposte uguali non valgono il bonus unicità, due sì a metà
  const tre = R.punteggiRound({ A: { parola: "gatto", ok: true, t: 1000 }, B: { parola: "gatto", ok: true, t: 1200 }, C: { parola: "gatto", ok: true, t: 1500 } }, {});
  assert.equal(tre.dettagli.A.originalita, 0);
  const due = R.punteggiRound({ A: { parola: "gatto", ok: true, t: 1000 }, B: { parola: "gatto", ok: true, t: 1200 } }, {});
  assert.equal(due.dettagli.A.originalita, R.CFG.bonusCoppia);
});

test("rush: tempo di risposta tardivo non cambia i punti (round già chiuso)", () => {
  const e = R.punteggiRound({ A: { parola: "lupo", ok: true, t: R.CFG.inputMs + 90000 } }, {});
  assert.equal(e.dettagli.A.velocita, 0, "un timestamp folle non può regalare bonus né andare in negativo");
  assert.ok(e.punti.A > 0, "la risposta resta valida: il bonus velocità è solo azzerato");
});

test("rush: classifica, spareggi e pareggio dichiarato", () => {
  const stat = {
    ALICE: { valide: 3, uniche: 1, tetti: [4000, 5000] },
    BOB: { valide: 3, uniche: 2, tetti: [20000, 21000] },
    CINZIA: { valide: 2, uniche: 0, tetti: [1000] }
  };
  const c = R.classifica({ ALICE: 400, BOB: 400, CINZIA: 120 }, stat);
  assert.deepEqual(c.map((x) => x.nome), ["BOB", "ALICE", "CINZIA"], "a pari punti vince chi è stato più originale");
  assert.equal(R.esito(c).campione, "BOB");

  const pari = R.classifica({ ALICE: 400, BOB: 400 }, {
    ALICE: { valide: 1, uniche: 1, tetti: [5000] }, BOB: { valide: 1, uniche: 1, tetti: [5000] }
  });
  assert.deepEqual(pari.map((x) => x.nome), ["ALICE", "BOB"], "a pari tutto, ordine alfabetico stabile");
  const es = R.esito(pari);
  assert.equal(es.pareggio, true);
  assert.equal(es.campione, null);
  assert.deepEqual(es.pari, ["ALICE", "BOB"]);

  const solo = R.classifica({ ALICE: 10 }, {});
  assert.equal(R.esito(solo).campione, "ALICE");
  assert.equal(R.esito([]).campione, null);
});

test("rush: statistiche cumulate per gli spareggi", () => {
  let s = {};
  const e1 = R.rivela({ A: { parola: "lupo", ok: true, t: 1000 }, B: { parola: "lince", ok: false, motivo: "NON_CATEGORIA" } },
    R.punteggiRound({ A: { parola: "lupo", ok: true, t: 1000 }, B: { parola: "lince", ok: false, t: 2000 } }, {}));
  s = R.accumulaStati(s, "PARTITA", e1);
  assert.equal(s.A.valide, 1);
  assert.equal(s.A.uniche, 1, "risposta sola nel round = originale");
  assert.equal(s.B.valide || 0, 0);
  const e2 = R.rivela({ A: { parola: "orso", ok: true, t: 9000 } },
    R.punteggiRound({ A: { parola: "orso", ok: true, t: 9000 }, C: { parola: "orso", ok: true, t: 8000 } }, {}));
  s = R.accumulaStati(s, "PARTITA", e2);
  assert.equal(s.A.valide, 2);
  assert.equal(s.A.uniche, 1, "nel secondo round la risposta era condivisa");
});

test("rush: un giocatore inattivo non blocca nulla ma si vede", () => {
  const risposte = { 0: { ALICE: { parola: "cane", ok: true } }, 1: { ALICE: { parola: "gatto", ok: true } } };
  assert.deepEqual(R.inattivi(["ALICE", "BOB"], risposte, 0), [], "dopo un round non si ancora nessuno");
  assert.deepEqual(R.inattivi(["ALICE", "BOB"], risposte, 1), ["BOB"], "due round a vuoto: avviso");
  assert.deepEqual(R.inattivi(["ALICE", "BOB"], { ...risposte, 2: { BOB: { parola: "lupo", ok: true } } }, 2), [],
    "appena risponde smette di essere segnalato");
});

test("rush: le categorie 'votazione' non hanno risposte ammesse (il dizionario non le giudica)", () => {
  assert.ok(CAT.CREATIVE.length >= 3, "esistono categorie creative");
  for (const c of CAT.CREATIVE) {
    assert.equal(c.tipo, "votazione", c.id);
    assert.equal(c.risposte, undefined, "nessuna lista chiusa: si giudica tra pari, non col dizionario");
  }
  // e il generatore competitivo non le pesca mai
  const pool = CAT.comboDisponibili({ min: 4 });
  const creativi = new Set(CAT.CREATIVE.map((c) => c.id));
  assert.equal(pool.filter((p) => creativi.has(p.id)).length, 0);
});

test("rush: guard unico sulla risposta (tardiva, duplicata, a round chiuso)", () => {
  const base = {
    stato: "in_corso", startAt: 1000000, durata: 4 * R.CFG.roundMs, opzioni: {}, rush: {}
  };
  const dentro = (ms) => 1000000 + ms;
  assert.equal(R.puoScrivere(base, "ALICE", { ora: dentro(3000) }).ok, true, "in tempo: sì");
  assert.equal(R.puoScrivere(base, "ALICE", { ora: dentro(27000) }).motivo, "ROUND_GIA_CHIUSO",
    "il round è chiuso: la risposta tardiva non recupera nulla");
  assert.equal(R.puoScrivere(base, "ALICE", { ora: dentro(31000) }).ok, true,
    "round 2 aperto: la risposta va a quello, non a quello visto a schermo");
  assert.equal(R.puoScrivere(base, "ALICE", { ora: dentro(31000) }).indice, 1);
  assert.equal(R.puoScrivere(base, "ALICE", { ora: dentro(-1000) }).motivo, "COUNTDOWN_IN_CORSO",
    "countdown: troppo presto");
  assert.equal(R.puoScrivere({ ...base, stato: "conclusa" }, "ALICE", { ora: dentro(3000) }).motivo,
    "PARTITA_NON_IN_GIOCO");
  assert.equal(R.puoScrivere({ ...base, rush: { risposte: { 0: { ALICE: { parola: "lupo" } } } } }, "ALICE",
    { ora: dentro(3000) }).motivo, "HAI_GIA_RISPOSTO", "una risposta per round, definitiva");
  assert.equal(R.puoScrivere({ ...base, rush: { punteggiRound: { 0: { ALICE: 155 } } } }, "ALICE",
    { ora: dentro(3000) }).motivo, "ROUND_GIA_PUNTEGGIATO", "round già chiuso da un altro client");
  // il tempo accumulato è quello che determina il bonus velocità
  const g = R.puoScrivere(base, "ALICE", { ora: dentro(8000) });
  assert.equal(g.t, 8000);
});

test("rush: un round si chiude solo quando la finestra di scrittura è finita", () => {
  const cur = { stato: "in_corso", startAt: 1000000, durata: 4 * R.CFG.roundMs, opzioni: {}, rush: {} };
  const at = (ms) => 1000000 + ms;
  assert.equal(R.puoChiudere(cur, 0, { ora: at(20000) }), false, "la partita è ancora in corso: non si chiude");
  assert.equal(R.puoChiudere(cur, 0, { ora: at(R.CFG.inputMs + 500) }), true, "rivelazione iniziata: si chiude");
  assert.equal(R.puoChiudere(cur, 0, { ora: at(R.CFG.roundMs + 500) }), true, "round già superato");
  assert.equal(R.puoChiudere(cur, 1, { ora: at(R.CFG.roundMs + 500) }), false, "il round in corso no");
  assert.equal(R.puoChiudere({ ...cur, stato: "pronto" }, 0, { ora: at(1000) }), false, "countdown: nessun round");
  assert.equal(R.puoChiudere({ ...cur, stato: "conclusa" }, 0, { ora: at(60000) }), false, "partita archiviata");
  assert.equal(R.puoChiudere(cur, 9, { ora: at(60000) }), false, "round inesistente");
  // modalità creativa: la chiusura aspetta anche la finestra di voto
  const crea = R.ciclo("creative");
  assert.equal(R.puoChiudere(cur, 0, { ora: at(crea.inputMs + 1000), modale: "creative" }), false,
    "si sta ancora votando");
  assert.equal(R.puoChiudere(cur, 0, { ora: at(crea.inputMs + crea.votoMs + 500), modale: "creative" }), true);
});

test("rush: punteggio della votazione tra pari", () => {
  const r = { A: { parola: "scusa vera", ok: true }, B: { parola: "altra cosa", ok: true }, C: { parola: "meh", ok: true } };
  const voti = { A: { voto: "B" }, B: { voto: "A" }, C: { voto: "A" } };
  const e = R.punteggiVotazione(r, voti, { giocatori: ["A", "B", "C"] });
  assert.equal(e.punti.A, R.CFG.puntiPartecipazione + 2 * R.CFG.puntiVoto, "due voti");
  assert.equal(e.punti.B, R.CFG.puntiPartecipazione + R.CFG.puntiVoto);
  assert.equal(e.punti.C, R.CFG.puntiPartecipazione, "nessun voto: vale aver risposto");
  const nonVoto = R.punteggiVotazione(r, {}, { giocatori: ["A", "B", "C"] });
  assert.deepEqual([nonVoto.punti.A, nonVoto.punti.B, nonVoto.punti.C], [40, 40, 40],
    "se nessuno vota il round non si blocca");
  const auto = R.punteggiVotazione(r, { A: { voto: "A" } }, { giocatori: ["A"] });
  assert.equal(auto.punti.A, R.CFG.puntiPartecipazione, "non si vota da solo");
  const manc = R.punteggiVotazione({ A: { parola: "x", ok: false, motivo: "TROPPO_CORTA" } }, {}, { giocatori: ["A", "B"] });
  assert.equal(manc.punti.A, 0);
  assert.equal(manc.dettagli.A.motivo, "TROPPO_CORTA");
});
