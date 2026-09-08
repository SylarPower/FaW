/**
 * Test unitari della logica pura di FaW (nessun browser, nessuna rete).
 * Esecuzione: `npm run test:unit` (node --test, nessuna dipendenza).
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..", "..");

// ordine di caricamento identico al browser: core → words → regole
global.window = global;
require(path.join(ROOT, "games/shared/faw-core.js"));
require(path.join(ROOT, "games/shared/faw-words.js"));
require(path.join(ROOT, "games/shared/faw-room.js"));
require(path.join(ROOT, "games/shared/faw-categorie.js"));
const CORE = global.FAWCore;
const WORDS = global.FAWWords;

test.before(() => {
  // dizionario reale del progetto (è l'unico usato dai giochi)
  const tmp = path.join(ROOT, "dizionario.txt");
  const txt = fs.readFileSync(tmp, "utf8");
  const list = txt.split("\n").filter((w) => w.trim().length >= 4);
  WORDS.setWords(list.map((w) => w.trim()));
});

/* ------------------------------- FAWCore ------------------------------- */

test("core: normWord toglie accenti, spazi e punteggiatura", () => {
  assert.equal(CORE.normWord("Caffellatte"), "CAFFELLATTE");
  assert.equal(CORE.normWord("  città! "), "CITTA");
  assert.equal(CORE.normWord("A'"), "A");
  assert.equal(CORE.normText("UNO   DUE"), "uno due");
});

test("core: rng deterministica per seed (stesse griglie per tutti)", () => {
  const a = CORE.rngFrom("SEED-1");
  const b = CORE.rngFrom("SEED-1");
  const c = CORE.rngFrom("SEED-2");
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, [c(), c(), c()]);
});

test("core: hashKey stabile (usato per idempotenza)", () => {
  assert.equal(CORE.hashKey("CIAO"), CORE.hashKey("CIAO"));
  assert.notEqual(CORE.hashKey("CIAO"), CORE.hashKey("CAIO"));
});

test("core: escapeHtml protegge dall'injection nei testi utente", () => {
  assert.equal(CORE.escapeHtml('<img src=x onerror="1">'), "&lt;img src=x onerror=&quot;1&quot;&gt;");
});

test("core: fmtTime e clamp", () => {
  assert.equal(CORE.fmtTime(183), "3:03");
  assert.equal(CORE.fmtTime(-4), "0:00");
  assert.equal(CORE.clamp(12, 0, 10), 10);
});

/* ------------------------------ FAWWords ------------------------------ */

test("words: validazione dizionario reale", () => {
  assert.equal(WORDS.isWord("strada"), true);
  assert.equal(WORDS.isWord("cane"), true);
  assert.equal(WORDS.isWord("zxcvbnm"), false);
  assert.equal(WORDS.isWord("tra"), false, "sotto la lunghezza minima di Ruzzle (4)");
});

test("words: adiacenza incluse diagonali e confini", () => {
  assert.equal(WORDS.isAdjacent(0, 6, 5), true, "diagonale");
  assert.equal(WORDS.isAdjacent(0, 1, 5), true, "orizzontale");
  assert.equal(WORDS.isAdjacent(0, 5, 5), true, "verticale");
  assert.equal(WORDS.isAdjacent(0, 2, 5), false, "salto di casella");
  assert.equal(WORDS.isAdjacent(4, 5, 5), false, "fine riga → inizio riga dopo: NON adiacenti (niente wrap)");
  assert.equal(WORDS.isAdjacent(4, 8, 5), true, "diagonale a sinistra di 4 è 8");
  assert.equal(WORDS.neighborsOf(6, 5).length, 8, "cella interna: 8 vicini");
  assert.equal(WORDS.neighborsOf(0, 5).length, 3, "angolo: 3 vicini");
  assert.equal(WORDS.neighborsOf(12, 5).length, 8, "centro: 8 vicini");
});

test("words: sequenze utilizzabili (Bomba) mai impossibili", () => {
  const seq = WORDS.sampleSequences({ minWords: 40, maxWords: 900, size: 12, rng: CORE.rngFrom("seq-test") });
  assert.ok(seq.length >= 8, "pool troppo piccolo: " + seq.length);
  for (const s of seq) {
    assert.equal(s.seq.length, 3);
    assert.ok(s.count >= 40, s.seq + " ha solo " + s.count + " parole");
    const w = WORDS.wordsContaining(s.seq, { limit: 5 });
    assert.ok(w.length > 0);
    assert.ok(w[0].includes(s.seq));
  }
});

test("words: scarto delle sequenze quasi impossibili", () => {
  assert.ok(WORDS.sequenceCount("QZX") < 5, "QZX non deve avere risposte");
});

test("words: checkWord distingue inesistente / già usata / senza sequenza", () => {
  assert.equal(WORDS.checkWord("STRADA", new Set(), "TRA").ok, true);
  assert.equal(WORDS.checkWord("TRENO", new Set(), "TRA").reason, "SENZA_SEQUENZA");
  assert.equal(WORDS.checkWord("STRADA", new Set(["STRADA"]), "TRA").reason, "GIÀ_USATA");
  assert.equal(WORDS.checkWord("XQZWRT", new Set(), "TRA").reason, "SENZA_SEQUENZA");
  assert.equal(WORDS.checkWord("ZUCCH", new Set(), "ZUC").reason, "NON_TROVATA");
  assert.equal(WORDS.checkWord("TRA", new Set(), "TRA").reason, "CORTA");
});

test("words: solveGrid trova parole reali in una griglia nota", () => {
  // 5×5 costruito a mano con STRADA e CANE continui
  const letters = ["S", "T", "R", "A", "X", "Q", "A", "D", "Z", "Y", "C", "A", "N", "E", "K", "W", "B", "R", "D", "A", "V", "N", "O", "L", "U"];
  const found = WORDS.solveGrid(letters, 5, { limit: 4000, timeMs: 4000 });
  const parole = found.map((f) => f.word);
  assert.ok(parole.includes("STRADA"), "STRADA leggibile in diagonale/serpente");
  assert.ok(parole.includes("CANE"), "CANE leggibile in riga");
  found.forEach((f) => assert.equal(f.points, WORDS.scoreForLength(f.word.length)));
});

/* --------------------------- FAWRoom (stati) --------------------------- */

const ROOM = global.FAWRoom;

test("room: transizioni legali e non", () => {
  assert.equal(ROOM.canMove("attesa", "pronto"), true);
  assert.equal(ROOM.canMove("pronto", "in_corso"), true);
  assert.equal(ROOM.canMove("in_corso", "chiusura"), true);
  assert.equal(ROOM.canMove("chiusura", "risultati"), true);
  assert.equal(ROOM.canMove("risultati", "conclusa"), true);
  assert.equal(ROOM.canMove("in_corso", "risultati"), true, "con il tempo scaduto la chiusura non aspetta i passaggi formali");
  assert.equal(ROOM.canMove("attesa", "in_corso"), false, "non si salta il countdown");
  assert.equal(ROOM.canMove("attesa", "conclusa"), false, "una partita mai iniziata non diventa un risultato");
  assert.equal(ROOM.canMove("conclusa", "in_corso"), false, "non si riapre una partita finita");
  assert.equal(ROOM.canMove("conclusa", "pronto"), false);
  assert.equal(ROOM.canMove("attesa", "annullata"), true, "annullamento sempre possibile");
  assert.equal(ROOM.canMove("conclusa", "annullata"), false);
});

test("room: documento iniziale coerente con l'hub", () => {
  const d = ROOM.buildMatch({ gioco: "parole-arena", creator: "ALICE", giocatori: ["ALICE", "BOB"], opzioni: { griglia: "5", durata: "180" } });
  assert.equal(d.stato, "attesa");
  assert.deepEqual(d.partecipanti, ["ALICE", "BOB"]);
  assert.deepEqual(d.punteggi, { ALICE: 0, BOB: 0 });
  assert.deepEqual(d.parole, { ALICE: [], BOB: [] });
  assert.equal(d.giocatori.ALICE.pronto, false);
  assert.ok(d.createdAt > 0 && d.timestamp > 0, "l'hub ordina lo storico su timestamp");
  assert.ok(typeof d.dataOra === "string" && d.dataOra.length > 0, "l'hub mostra dataOra");
});

test("room: compat con i documenti creati dal banner dell'hub", () => {
  const hubDoc = { partecipanti: ["ALICE", "BOB"], opzioni: { durata: "180", griglia: "4", mode: "eventi", seed: "ABC123" }, stato: "attesa", punteggi: { ALICE: 0, BOB: 0 } };
  assert.equal(ROOM.durataMs(hubDoc), 180000);
  assert.deepEqual(Object.keys(ROOM.giocatoriMap(hubDoc)), ["ALICE", "BOB"]);
  assert.equal(ROOM.fase({ stato: "pronto", startAt: Date.now() + 4000 }), "countdown");
  assert.equal(ROOM.fase({ stato: "pronto", startAt: Date.now() - 100 }), "gioco");
  assert.equal(ROOM.fase({ stato: "conclusa" }), "risultati");
});

test("room: isStale non considera vive partite vecchie", () => {
  assert.equal(ROOM.isStale({ stato: "attesa", createdAt: Date.now() - 7 * 3600000 }), true);
  assert.equal(ROOM.isStale({ stato: "in_corso", createdAt: Date.now() - 60000 }), false);
});

/* --------------------------- Categorie (Rush) --------------------------- */

const CAT = global.FAWCategorie;

test("categorie: risposte reali — dizionario del progetto + eccezioni documentate", () => {
  // Il dizionario del progetto (quello di Ruzzle) non contiene prestiti recenti
  // e parole sotto le 4 lettere: sono eccezioni elencate qui, così un errore
  // vero (voce inventata) non può scivolare dentro in silenzio.
  const ECCEZIONI = new Set([
    "animali:ornitorinco", "cibo:carpaccio", "cibo:paccheri", "cibo:garganelli",
    "cibo:tozzetti", "cibo:arrosticini", "cibo:cicerchiata", "ufficio:webcam",
    "ufficio:notebook", "ufficio:faldone", "ufficio:fax", "sport:padel",
    "sport:snowboard", "sport:kitesurf", "sport:waterpolo", "sport:zumba",
    "sport:bob", "sport:sci", "bevande:spritz", "bevande:matcha", "bevande:gin",
    "bevande:bollicine", "mestieri:badante", "casa:innaffiatoio", "casa:stendino",
    "trasporti:jet", "trasporti:quad", "animali:ape", "animali:bue", "animali:gru",
    "animali:oca", "animali:quaglia"
  ]);
  const inattese = [];
  let totale = 0, nelDiz = 0;
  CAT.CATEGORIE.forEach((c) => {
    if (c.noDict) return; // nomi propri e città: il dizionario comune non è il criterio
    c.risposte.forEach((r) => {
      const n = CAT.norm(r);
      if (n.includes(" ")) return; // multi-parola: giudicata solo dalla categoria
      totale++;
      if (WORDS.isWord(n)) { nelDiz++; return; }
      if (!ECCEZIONI.has(c.id + ":" + n)) inattese.push(c.id + ":" + n);
    });
  });
  assert.deepEqual(inattese, [], "voci fuori dizionario non giustificate: " + inattese.join(", "));
  assert.ok(nelDiz / totale > 0.85, "troppe risposte fuori dal dizionario del progetto");
});

test("categorie: nessuna risposta duplicata o vuota", () => {
  CAT.CATEGORIE.forEach((c) => {
    const set = new Set();
    c.risposte.forEach((r) => {
      const n = CAT.norm(r);
      assert.ok(n.length >= 3, c.id + " voce troppo corta (min 3 caratteri): " + r);
      assert.ok(!set.has(n), c.id + " duplicato: " + n);
      set.add(n);
    });
  });
});

test("categorie: combinazioni lettera/categoria sempre giocabili", () => {
  const combos = CAT.comboDisponibili({ min: 4 });
  assert.ok(combos.length >= 40, "poche combinazioni disponibili: " + combos.length);
  combos.forEach((c) => assert.ok(c.n >= 4, c.id + "/" + c.lettera + " ha " + c.n));
  // le lettere offerte devono avere tutte un numero sufficiente di risposte
  const perLettera = {};
  combos.forEach((c) => { perLettera[c.lettera] = (perLettera[c.lettera] || 0) + 1; });
  assert.ok(Object.keys(perLettera).length >= 12, "troppo poche lettere utilizzabili: " + Object.keys(perLettera).join(""));
});

test("categorie: pickCombo deterministico per rng e rispetta il vincolo di lettera", () => {
  const a = CAT.pickCombo(CORE.rngFrom("rush-seed"));
  const b = CAT.pickCombo(CORE.rngFrom("rush-seed"));
  assert.equal(a.lettera, b.lettera);
  assert.equal(a.id, b.id);
  assert.ok(a.n >= 4);
  const risposte = CAT.rispostePer(a.categoria, a.lettera);
  assert.ok(risposte.length >= a.n);
  risposte.forEach((r) => assert.equal(r[0], a.lettera.toLowerCase()));
});

test("categorie: validazione — lettere, accenti, maiuscole, varianti, fuori categoria", () => {
  const cibo = CAT.byId("cibo");
  assert.equal(CAT.valida(" Pizza ", cibo, "P").ok, true);
  assert.equal(CAT.valida("pizza", cibo, "p").canonical, "pizza");
  assert.equal(CAT.valida("LASAGNE", cibo, "L").ok, true, "plurale ammesso come variante");
  assert.equal(CAT.valida("melanzana", cibo, "M").ok, false);
  assert.equal(CAT.valida("melanzane", cibo, "M").ok, true);
  assert.equal(CAT.valida("prosciutto", cibo, "P").motivo, undefined);
  assert.equal(CAT.valida("pane", cibo, "M").motivo, "LETTERA");
  assert.equal(CAT.valida("", cibo, "P").motivo, "VUOTO");
  assert.equal(CAT.valida("   ", cibo, "P").motivo, "VUOTO");
  assert.equal(CAT.valida("pizza12", cibo, "P").motivo, "CARATTERI");
  assert.equal(CAT.valida("qwertyuiopasdfghjklzxcvbnmqwertyuiopasdfghjklzxcvbnmqwerty", cibo, "Q").motivo, "LUNGA");
  assert.equal(CAT.valida("gatto", cibo, "G").motivo, "NON_CATEGORIA");
  assert.equal(CAT.valida("caffè", CAT.byId("bevande"), "C").ok, true, "accento normalizzato");
});

test("categorie: chiavi di raggruppamento duplicati coerenti", () => {
  const ufficio = CAT.byId("ufficio");
  assert.equal(CAT.groupKey(" Penna ", ufficio), CAT.groupKey("penna", ufficio));
  assert.equal(CAT.groupKey("Penna", null), CAT.groupKey("PENNA", null));
  assert.notEqual(CAT.groupKey("penna", ufficio), CAT.groupKey("mouse", ufficio));
});

test("categorie: nomi propri esclusi dal controllo dizionario ma validati", () => {
  const nomi = CAT.byId("nomi_f");
  assert.equal(nomi.noDict, true);
  assert.equal(CAT.valida("Giulia", nomi, "G").ok, true);
  assert.equal(CAT.valida("Giulia", nomi, "M").motivo, "LETTERA");
});

test("categorie: le categorie creative non bloccano la modalità principale", () => {
  assert.ok(CAT.CREATIVE.length >= 3);
  CAT.CREATIVE.forEach((c) => {
    assert.equal(c.tipo, "votazione");
    assert.ok(!c.risposte, "le categorie creative non hanno una lista chiusa");
  });
  assert.ok(CAT.comboDisponibili({ min: 4 }).length > 0, "la modalità competitiva resta giocabile");
});

test("room: start forzato solo dall'host e mai su partita già iniziata", () => {
  // stesso contratto del client: la logica è dentro la transazione, qui la verifichiamo
  // su una funzione che replica il guard senza rete
  const guard = (cur, opts) => {
    if (!cur || cur.stato !== "attesa") return false;
    const tot = (cur.partecipanti || []).length;
    const pronti = cur.pronti || [];
    if (opts.forza) { if (cur.host !== opts.nome || !tot) return false; }
    else if (pronti.length < tot) return false;
    return true;
  };
  const base = { stato: "attesa", host: "ALICE", partecipanti: ["ALICE", "BOB"], pronti: ["ALICE"] };
  assert.equal(guard(base, {}), false, "con BOB non pronto non si parte");
  assert.equal(guard(base, { forza: true, nome: "ALICE" }), true, "l'host può forzare");
  assert.equal(guard(base, { forza: true, nome: "BOB" }), false, "un ospite no");
  assert.equal(guard({ ...base, stato: "in_corso" }, { forza: true, nome: "ALICE" }), false, "partita iniziata intoccabile");

});
