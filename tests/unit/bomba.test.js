/**
 * La Bomba delle Parole — regole pure testate col dizionario reale del progetto
 * (lo stesso di Ruzzle), così «la parola contiene la sequenza» è verificato sui
 * dati veri e i round «impossibili» sono esclusi da un'asserzione, non da un'ipotesi.
 */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
global.FAWCore = require(path.join(ROOT, "games/shared/faw-core.js"));
global.FAWWords = require(path.join(ROOT, "games/shared/faw-words.js"));
const R = require(path.join(ROOT, "games/bomba-parole/js/regole.js"));

const CFG = R.CFG;
let caricato = false;
function dict() {
  if (caricato) return global.FAWWords;
  const list = fs.readFileSync(path.join(ROOT, "dizionario.txt"), "utf8").split("\n")
    .map((w) => w.trim()).filter((w) => w.length >= 4);
  global.FAWWords.setWords(list);
  caricato = true;
  return global.FAWWords;
}
dict();

function doc(over) {
  const base = {
    stato: "in_corso",
    partecipanti: ["ALFA", "BOB", "CIRA", "DANI"],
    giocatori: { ALFA: { visto: 0 }, BOB: { visto: 0 }, CIRA: { visto: 0 }, DANI: { visto: 0 } },
    punteggi: { ALFA: 0, BOB: 0, CIRA: 0, DANI: 0 },
    startAt: 0, endsAt: 10 * 60 * 1000, maxEsplosioni: CFG.esplosioniMax, seed: "SEEDTEST",
    claim: {},
    bomba: {
      roundIdx: 0, difficolta: "media", possessore: "ALFA", usate: [], storico: [],
      passages: {}, passaggi: {}, esplosioni: {}, saltati: {}, sequences: [],
      round: { i: 0, seq: "TR", possibili: 900, inizioAlle: 1000, micciaMs: 35000 },
      ultimoPasso: 1000
    }
  };
  return Object.assign(base, over || {});
}

/* --------------------------- validità delle parole -------------------------- */

test("bomba: la parola deve contenere la sequenza (casi veri di dizionario)", () => {
  const ok1 = R.valutaParola("strada", "TR", []);
  assert.equal(ok1.ok, true, "STRADA contiene TR");
  assert.equal(ok1.parola, "STRADA", "normalizzazione: maiuscole");
  const ok2 = R.valutaParola("  tramontO  ", "tr", []);
  assert.equal(ok2.ok, true, "TRAMONTO contiene TR anche spaziando/cambiando maiuscole");
  assert.equal(R.valutaParola("RETE", "TR", []).motivo, "SENZA_SEQUENZA", "RETE non contiene TR");
  assert.equal(R.valutaParola("TRENO", "TR", []).ok, true, "TRENO contiene TR: è valida");
  assert.equal(R.valutaParola("TRZZZQQ", "TR", []).motivo, "NON_TROVATA", "sequenza che contiene TR ma non è una parola");
  assert.equal(R.valutaParola("ab", "TR", []).motivo, "CORTA", "minimo 4 lettere");
  assert.equal(R.valutaParola("via 22", "TR", []).motivo, "SPAZI", "niente spazi");
  assert.equal(R.valutaParola("strada2", "TR", []).motivo, "CARATTERI", "i numeri non passano inosservati");
  assert.equal(R.valutaParola("   ", "TR", []).motivo, "VUOTA", "solo spazi");
});

test("bomba: accenti e varianti normalizzati come nel dizionario", () => {
  const W = dict();
  const conAccento = R.valutaParola("TWILIGHT", "TW", []);
  assert.ok(conAccento.motivo, "prestito inesistente: il dizionario è il criterio");
  // una parola reale con accento scritto dall'utente deve essere accettata
  const reale = [...W.wordsContaining("TR", { limit: 400, maxLen: 9 })][0];
  assert.ok(reale, "esiste almeno una parola con TR");
  const iV = reale.search(/[aeiou]/i);
  assert.ok(iV >= 0, reale + ": ha una vocale da accentare");
  const accenti = { a: "à", e: "è", i: "ì", o: "ò", u: "ù" };
  const accentata = reale.slice(0, iV) + accenti[reale[iV].toLowerCase()] + reale.slice(iV + 1);
  assert.equal(R.norm(accentata), R.norm(reale), "l'accento non cambia la forma canonica");
  assert.equal(R.valutaParola(accentata, "TR", []).ok, true, "accetto la variante accentata");
});

test("bomba: parola già detta in partita rifiutata (vale per tutta la partita)", () => {
  assert.equal(R.valutaParola("STRADA", "TR", ["PIZZA", "STRADA"]).motivo, "GIÀ_USATA");
  assert.equal(R.valutaParola("strada", "TR", ["STRADONE"]).ok, true, "un'altra parola con TR resta valida");
});

test("bomba: punteggio dichiarato 10, più 5 per le parole lunghe", () => {
  assert.equal(R.valutaParola("STRADA", "TR", []).punti, CFG.puntiParola);
  const lunga = dict().wordsContaining("TR", { minLen: 8, maxLen: 12, limit: 5 })[0];
  assert.ok(lunga, "trovo una parola lunga con TR");
  assert.equal(R.valutaParola(lunga, "TR", []).punti, CFG.puntiParola + CFG.puntiLunga, lunga);
});

/* -------------------------------- miccia ---------------------------------- */

test("bomba: miccia — segnali progressivi, mai il tempo esatto", () => {
  const etichette = [];
  for (let i = 0; i <= 10; i++) {
    const m = R.statoMiccia(i * 3500 * 1, 35000);
    etichette.push(m.etichetta);
  }
  assert.deepEqual(etichette, ["calma", "calma", "calma", "tiepida", "tiepida", "tiepida", "calda", "calda", "fervente", "fervente", "critica"]);
  assert.equal(R.statoMiccia(35000, 35000).esplosa, true, "a scadenza scaduta è esplosa");
  assert.equal(R.statoMiccia(34999, 35000).esplosa, false, "un ms prima no");
  assert.equal(R.statoMiccia(99999, 35000).frazione, 1, "non oltrepassa il 100%");
  // ogni livello ha un'icona: l'informazione non è solo colore
  for (let i = 0; i <= 10; i++) assert.ok(R.statoMiccia(i * 3500, 35000).icona, "icona presente");
});

test("bomba: passare la bomba NON azzera la miccia", () => {
  const d = doc();
  const prima = d.bomba.round.inizioAlle;
  const es = R.puoPassare(d, "ALFA", { ora: 9000, testo: "STRADA" });
  assert.equal(es.ok, true);
  const eff = R.patchPassaggio(d, "ALFA", es, { ora: 9000 });
  assert.equal(eff.patch["bomba.round"], undefined, "il round (e il suo inizio) non viene riscritto");
  assert.equal(eff.patch["bomba.round.inizioAlle"], undefined, "nessun campo che sposti la scadenza");
  assert.equal(d.bomba.round.inizioAlle, prima, "inizioAlle resta lo stesso");
  assert.equal(R.esplodeAlle(d.bomba.round), prima + 35000, "scadenza unica e condivisa");
});

/* ------------------------------ passaggio --------------------------------- */

test("bomba: il passaggio va al giocatore successivo nell'ordine, saltando gli assenti", () => {
  const d = doc();
  const es = R.puoPassare(d, "ALFA", { ora: 9000, testo: "STRADA" });
  const eff = R.patchPassaggio(d, "ALFA", es, { ora: 9000 });
  assert.equal(eff.prossimo, "BOB");
  assert.equal(eff.patch["bomba.possessore"], "BOB");
  assert.equal(eff.patch["punteggi.ALFA"], CFG.puntiParola);
  assert.equal(eff.patch["bomba.passaggi.ALFA"], 1);
  assert.deepEqual(eff.patch["bomba.usate"], ["STRADA"]);
  assert.equal(eff.patch["bomba.storico"][0].w, "STRADA");
  assert.equal(eff.patch["logUltimo"].tipo, "passo");

  const d2 = doc();
  d2.giocatori = { ALFA: { visto: 0 }, BOB: { visto: -99999 }, CIRA: { visto: 0 }, DANI: { visto: 0 } };
  const es2 = R.puoPassare(d2, "ALFA", { ora: 9000, testo: "TRAMONTO" });
  const eff2 = R.patchPassaggio(d2, "ALFA", es2, { ora: 9000, attivi: ["ALFA", "CIRA", "DANI"] });
  assert.equal(eff2.prossimo, "CIRA", "BOB è offline: la bomba va a CIRA");
});

test("bomba: doppio invio non conta due volte (la bomba è già passata)", () => {
  const d = doc();
  const es = R.puoPassare(d, "ALFA", { ora: 9000, testo: "STRADA" });
  const eff = R.patchPassaggio(d, "ALFA", es, { ora: 9000 });
  // applico il patch (stessa semantica del backend: chiavi dotted)
  const cur = JSON.parse(JSON.stringify(d));
  Object.keys(eff.patch).forEach((k) => {
    const parti = k.split(".");
    let t = cur;
    for (let i = 0; i < parti.length - 1; i++) { if (!t[parti[i]] || typeof t[parti[i]] !== "object") t[parti[i]] = {}; t = t[parti[i]]; }
    t[parti[parti.length - 1]] = eff.patch[k];
  });
  const secondo = R.puoPassare(cur, "ALFA", { ora: 9050, testo: "STRADA" });
  assert.equal(secondo.ok, false);
  assert.equal(secondo.motivo, "NON_TUOI", "non è più il suo turno: il secondo tocco non fa nulla");
  const terzo = R.puoPassare(cur, "BOB", { ora: 9100, testo: "STRADA" });
  assert.equal(terzo.ok, false, "anche il nuovo possessore non può riusare la stessa parola");
  assert.equal(terzo.motivo, "GIÀ_USATA");
});

test("bomba: guard del passaggio — turno, tempo, round, partita", () => {
  const d = doc();
  assert.equal(R.puoPassare(d, "BOB", { ora: 9000, testo: "STRADA" }).motivo, "NON_TUOI");
  assert.equal(R.puoPassare(d, "ALFA", { ora: 45000, testo: "STRADA" }).motivo, "FUORI_TEMPO", "dopo la scadenza non si salva più");
  assert.equal(R.puoPassare(d, "ALFA", { ora: 9000, testo: "STRADA", roundIdx: 3 }).motivo, "ROUND_SUPERATO", "round cambiato in volo");
  assert.equal(R.puoPassare({ ...d, stato: "attesa" }, "ALFA", { ora: 9000, testo: "STRADA" }).motivo, "PARTITA_NON_IN_GIOCO");
  assert.equal(R.puoPassare(null, "ALFA", { ora: 9000, testo: "x" }).motivo, "PARTITA_NON_TROVATA");
  assert.equal(R.puoPassare(d, "ALFA", { ora: 9000, testo: "RETE" }).motivo, "SENZA_SEQUENZA");
  const ok = R.puoPassare(d, "ALFA", { ora: 9000, testo: " strada " });
  assert.equal(ok.ok, true, "spazi e maiuscole non contano");
  assert.equal(ok.t, 8000, "t = tempo usato, dalla partenza del round");
});

/* ------------------------------ esplosione -------------------------------- */

test("bomba: esplosione — penalità al possessore e nuovo round con miccia nuova", () => {
  const d = doc();
  d.bomba.usate = ["STRADA"];
  d.bomba.roundIdx = 0;
  const out = R.patchEsplosione(d, { ora: 36000, attivi: d.partecipanti });
  assert.equal(out.finita, false);
  assert.equal(out.patch["punteggi.ALFA"], CFG.puntiEsplosione, "-100 a chi la teneva");
  assert.deepEqual(out.patch["bomba.esplosioni"], { ALFA: 1 });
  assert.equal(out.patch["bomba.roundIdx"], 1);
  assert.ok(out.round.inizioAlle > 36000, "il round successivo parte dopo la pausa");
  assert.equal(out.round.micciaMs, 35000, "miccia identica (è la difficoltà che la sceglie)");
  assert.ok(out.round.seq && out.round.seq.length === 3, "sequenza nuova di 3 lettere");
  assert.notEqual(out.round.seq, "TR", "non si ripete la stessa sequenza");
  assert.deepEqual(out.patch["bomba.usate"], ["STRADA"], "le parole restano vietate anche nel round nuovo");
  assert.equal(out.patch["bomba.possessore"], "BOB", "si riparte dal successivo");
  assert.equal(out.patch.logUltimo.tipo, "esplosione");
});

test("bomba: fine partita per tempo o per numero di esplosioni", () => {
  const d = doc({ endsAt: 30000 });
  let out = R.patchEsplosione(d, { ora: 36000, attivi: d.partecipanti });
  assert.equal(out.finita, true, "tempo scaduto: si chiude");
  assert.equal(out.patch.stato, "conclusa");
  assert.equal(out.patch["bomba.finitaPer"], "tempo");

  const d2 = doc({ maxEsplosioni: 3, bomba: Object.assign({}, d.bomba, { esplosioni: { BOB: 1, CIRA: 1 }, roundIdx: 4 }) });
  out = R.patchEsplosione(d2, { ora: 36000, attivi: d2.partecipanti });
  assert.equal(out.finita, true, "terza esplosione totale: si chiude");
  assert.equal(out.patch["bomba.finitaPer"], "esplosioni");

  const d3 = doc({ bomba: Object.assign({}, d.bomba, { roundIdx: CFG.roundMax - 1 }) });
  out = R.patchEsplosione(d3, { ora: 36000, attivi: d3.partecipanti });
  assert.equal(out.finita, true, "esauriti i round previsti");
  assert.equal(out.patch["bomba.finitaPer"], "round");
});

/* --------------------------- giocatori inattivi --------------------------- */

test("bomba: possessore offline → la bomba passa da sola, senza colpevoli", () => {
  const t = 20000;
  const base = doc();
  const d = doc({
    bomba: Object.assign({}, base.bomba, { ultimoPasso: t - 40000, round: { i: 0, seq: "TR", inizioAlle: 1000, micciaMs: 35000 } }),
    giocatori: { ALFA: { visto: t - 40000 }, BOB: { visto: t }, CIRA: { visto: t }, DANI: { visto: t } }
  });
  assert.equal(R.puoAutoPassare(d, "CIRA", { ora: t }), true);
  const out = R.patchAutoPassaggio(d, { ora: t, attivi: ["BOB", "CIRA", "DANI"] });
  assert.equal(out.prossimo, "BOB");
  assert.equal(out.patch["bomba.possessore"], "BOB");
  assert.equal(out.patch["bomba.saltati.ALFA"], 1);
  assert.equal(out.patch["punteggi.ALFA"], undefined, "nessuna penalità: era offline, non scarso");
  assert.equal(out.patch["bomba.round"], undefined, "la miccia non si sposta: il tempo del round resta quello");
  assert.equal(out.patch["bomba.storico"][0].salto, true);
});

test("bomba: possessore presente non viene scavalcato, e dopo lo scoppio è tardi", () => {
  const t = 20000;
  function bombaAttiva() {
    return { roundIdx: 0, possessore: "ALFA", usate: [], storico: [], difficolta: "media",
      round: { i: 0, seq: "TR", inizioAlle: t - 5000, micciaMs: 35000 }, ultimoPasso: t - 5000 };
  }
  const attivo = doc({ bomba: bombaAttiva(), giocatori: { ALFA: { visto: t - 3000 }, BOB: { visto: t }, CIRA: { visto: t }, DANI: { visto: t } } });
  assert.equal(R.puoAutoPassare(attivo, "BOB", { ora: t }), false, "sta solo pensando: guai a lui");
  const esplosa = JSON.parse(JSON.stringify(attivo));
  esplosa.bomba.round.inizioAlle = t - 40000;
  esplosa.bomba.ultimoPasso = t - 40000;
  assert.equal(R.puoAutoPassare(esplosa, "BOB", { ora: t }), false, "bomba già esplosa: niente salvataggi tardivi");
});

/* --------------------- sequenze: nessun round impossibile ------------------ */

test("bomba: le sequenze scelte hanno sempre molte risposte nel dizionario", () => {
  for (const diff of ["facile", "media", "dura"]) {
    const min = CFG.seq[diff].minWords;
    const viste = [];
    for (let i = 0; i < 8; i++) {
      const s = R.scegliSequenza("SEED" + diff, i, diff, { escluse: viste });
      assert.ok(s.seq && s.seq.length === CFG.seq[diff].len, diff + ": lunghezza sequenza");
      const n = R.ampiezzaSequenza(s.seq);
      assert.ok(n >= min, diff + " round " + i + ": «" + s.seq + "» ha solo " + n + " parole, minimo " + min);
      viste.push(s.seq);
    }
    assert.equal(new Set(viste).size, 8, diff + ": sequenze diverse nei round");
  }
});

test("bomba: stessa seed → stesse sequenze (round deterministici, zero scritture)", () => {
  const rng1 = global.FAWCore.rngFrom("PARTITA1:bomba:3");
  const a = R.scegliSequenza("PARTITA1", 3, "media", { rng: rng1 });
  const b = R.scegliSequenza("PARTITA1", 3, "media", { rng: global.FAWCore.rngFrom("PARTITA1:bomba:3") });
  assert.equal(a.seq, b.seq, "un reload non cambia la domanda");
  const c = R.scegliSequenza("PARTITA2", 3, "media", { rng: global.FAWCore.rngFrom("PARTITA2:bomba:3") });
  assert.notEqual(a.seq, c.seq, "seed diverse → partite diverse");
});

test("bomba: per ogni round almeno un giocatore può rispondere davvero", () => {
  const d = doc();
  const s = R.scegliSequenza(d.seed, 0, "media", {});
  d.bomba.round.seq = s.seq;
  const possibili = dict().wordsContaining(s.seq, { minLen: CFG.minLen, maxLen: 9, limit: 12 });
  assert.ok(possibili.length >= 6, "esistono " + possibili.length + " parole con " + s.seq);
  let cur = d;
  for (const w of possibili.slice(0, 4)) {
    const turno = cur.bomba.possessore;
    const es = R.puoPassare(cur, turno, { ora: (cur.bomba.round.inizioAlle || 0) + 3000, testo: w });
    assert.equal(es.ok, true, turno + " passa con «" + w + "»");
    const eff = R.patchPassaggio(cur, turno, es, { ora: (cur.bomba.round.inizioAlle || 0) + 3000 });
    cur = JSON.parse(JSON.stringify(cur));
    Object.keys(eff.patch).forEach((k) => {
      const parti = k.split("."); let t = cur;
      for (let i = 0; i < parti.length - 1; i++) { if (!t[parti[i]] || typeof t[parti[i]] !== "object") t[parti[i]] = {}; t = t[parti[i]]; }
      t[parti[parti.length - 1]] = eff.patch[k];
    });
  }
  assert.equal(cur.bomba.possessore, "ALFA", "giro completo: la bomba torna al primo");
  const tot = cur.punteggi.ALFA + cur.punteggi.BOB + cur.punteggi.CIRA + cur.punteggi.DANI;
  assert.ok(tot >= 4 * CFG.puntiParola && tot <= 4 * (CFG.puntiParola + CFG.puntiLunga), "4 passaggi, 4 punteggi (+" + tot + ")");
  assert.equal(Object.keys(cur.bomba.passaggi).length, 4, "uno per giocatore");
});

/* ------------------------------ classifica -------------------------------- */

test("bomba: classifica per punti, poi esplosioni, poi passaggi; pareggio dichiarato", () => {
  const b = {
    esplosioni: { ALFA: 2, BOB: 0, CIRA: 0, DANI: 1 },
    passaggi: { ALFA: 5, BOB: 3, CIRA: 3, DANI: 2 },
    storico: [{ da: "ALFA", w: "STRADA" }, { da: "BOB", w: "TRAMONTO" }, { da: "CIRA", w: "ATLANTE" }]
  };
  const cls = R.classifica({ ALFA: 40, BOB: 70, CIRA: 70, DANI: -60 }, b);
  assert.deepEqual(cls.map((c) => c.nome), ["BOB", "CIRA", "ALFA", "DANI"]);
  assert.equal(cls[0].parole, 1);
  assert.equal(cls[2].esplosioni, 2, "ALFA: due esplosioni");
  assert.equal(cls[3].esplosioni, 1, "DANI: una");
  const es = R.esito(cls);
  assert.equal(es.pareggio, true, "BOB e CIRA: stesso punteggio, stesse esplosioni e stessi passaggi");
  assert.deepEqual(es.pari, ["BOB", "CIRA"]);
  assert.equal(es.campione, null);
  const cls2 = R.classifica({ ALFA: 40, BOB: 70, CIRA: 90, DANI: -60 }, b);
  assert.equal(R.esito(cls2).campione, "CIRA");
});

test("bomba: i motivi hanno un messaggio in italiano per l'utente", () => {
  const attesi = ["CORTA", "VUOTA", "SPAZI", "LUNGA", "CARATTERI", "SENZA_SEQUENZA", "GIÀ_USATA", "NON_TROVATA", "NON_TUOI", "FUORI_TEMPO", "ROUND_SUPERATO", "PARTITA_NON_IN_GIOCO", "PARTITA_NON_TROVATA"];
  for (const m of attesi) {
    const t = R.motivoTesto(m, "TR");
    assert.ok(t && t.length > 12, m + ": testo mancante");
    assert.ok(!/undefined/.test(t), m + ": testo rotto");
  }
  assert.equal(R.motivoTesto("SENZA_SEQUENZA", "TR"), "La parola deve contenere «TR».");
});

test("bomba: riga di storico leggibile (feed del gioco)", () => {
  assert.equal(R.rigaStorico({ da: "ALFA", w: "STRADA", p: 10 }), "ALFA ha passato «STRADA» +10");
  assert.equal(R.rigaStorico({ da: "BOB", esplode: true }), "BOB è rimasto con la bomba");
  assert.equal(R.rigaStorico({ da: "CIRA", salto: true }), "CIRA non c'era: bomba passata");
});
