/**
 * La Bomba delle Parole — test d'integrazione (un contesto browser per giocatore).
 *
 * Il tempo è nel documento (`bomba.round.inizioAlle` + `micciaMs`): i test spostano
 * quello, non aggiungono scorciatoie al codice di produzione. Le parole valide
 * vengono cercate nel dizionario reale del progetto, quindi anche la validazione
 * end-to-end è provata sui dati veri.
 */
"use strict";

const { test, expect } = require("@playwright/test");
const A = require("./aiuti");

/* Ogni test parte da uno store pulito: i giochi condividono `partite/*` e
   `presenze/*` nello stesso relay, e i residui alterano i tempi dei test. */
test.beforeEach(async () => { await A.resetRelay(); });

const GIOCO = "games/bomba-parole/index.html";

async function apriBomba(page, matchId, extra) {
  const q = [];
  if (matchId) q.push("matchId=" + matchId);
  if (extra) q.push(String(extra).replace(/^\?/, ""));
  await page.goto(GIOCO + (q.length ? "?" + q.join("&") : ""), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.FAWBomba && window.FAWBombaRules && window.FAWWords && window.FAWWords.isDictionaryReady(), null, { timeout: 60000 });
  return page;
}

/** Crea la sala col codice condiviso (FAWRoom.create) e fa entrare i giocatori. */
async function sala(browser, nomi, opts) {
  opts = opts || {};
  const boot = await A.contesto(browser, nomi[0]);
  await boot.page.goto(GIOCO, { waitUntil: "domcontentloaded" });
  await boot.page.waitForFunction(() => window.FAWRoom, null, { timeout: 30000 });
  const matchId = await A.creaPartita(boot.page, {
    gioco: "bomba-parole", creator: nomi[0], giocatori: nomi, maxGiocatori: 6,
    durata: opts.durata || 180000,
    opzioni: Object.assign({ durata: String(Math.round((opts.durata || 180000) / 1000)), miccia: "media", countdown: 0 }, opts.opzioni || {}),
    cfg: { bomba: { difficolta: opts.diff || "media", esplosioniMax: opts.esplosioniMax || 3 } }
  });
  await apriBomba(boot.page, matchId);
  const giocatori = [{ nome: nomi[0], page: boot.page, ctx: boot.ctx }];
  for (const n of nomi.slice(1)) {
    const c = await A.contesto(browser, n);
    await apriBomba(c.page, matchId);
    giocatori.push({ nome: n, page: c.page, ctx: c.ctx });
  }
  await A.scriviDoc(boot.page, matchId, {
    stato: "pronto", startAt: Date.now() - 200, endsAt: Date.now() + (opts.durataMs || 180000)
  });
  for (const g of giocatori) await inGioco(g.page);
  return { matchId, boot, giocatori, chiudi: async () => { for (const g of giocatori) { try { await g.ctx.close(); } catch (e) {} } try { await boot.ctx.close(); } catch (e) {} } };
}

function inGioco(page) {
  return page.waitForFunction(() => {
    const d = window.FAWBomba && window.FAWBomba.stato.data;
    return !!(d && d.stato === "in_corso" && d.bomba && d.bomba.round && d.bomba.round.inizioAlle && d.bomba.round.seq);
  }, null, { timeout: 25000 });
}

const seqDi = (page) => page.evaluate(() => ((window.FAWBomba.stato.data.bomba || {}).round || {}).seq);
/** documento della partita (sblobbato dal snapshot) */
async function doc0(page, id) {
  const snap = await A.leggiDoc(page, id);
  return snap && snap.exists ? snap.data : null;
}

/** aspetta una condizione sul documento, dal lato test (niente chiusure Node in pagina) */
async function waitDoc(page, id, fn, msg) {
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    const d = await doc0(page, id);
    if (d && fn(d)) return d;
    await page.waitForTimeout(200);
  }
  throw new Error("attesa documento non soddisfatta: " + (msg || ""));
}

function cercaParola(page, seq, escludi) {
  return page.evaluate(([s, ex]) => {
    const W = window.FAWWords;
    const tutto = W.wordsContaining(s, { minLen: 4, maxLen: 9, limit: 400 });
    return tutto.find((w) => (ex || []).indexOf(w) < 0 && W.isWord(w)) || tutto[0] || null;
  }, [seq, escludi || []]);
}

/** la barra della miccia deve essere dipinta dal documento, non da un timer locale */
function aspettaBarra(page) {
  return page.waitForFunction(() => {
    const w = document.getElementById("fuse-barra").style.width;
    return !!w && !isNaN(parseFloat(w));
  }, null, { timeout: 15000 });
}

async function passa(page, parola) {
  await page.fill("#inp-parola", parola);
  await page.click("#btn-passa");
}



/* ------------------------------- allenamento ------------------------------ */

test("bomba solo: parola accettata, miccia che non si azzera, esplosione con penalità", async ({ browser }) => {
  const { ctx, page } = await A.contesto(browser, "ALICE");
  await apriBomba(page, null, "solo=1");
  await expect(page.locator("#schermo-gioco")).toBeVisible();
  const seq = await seqDi(page);
  expect(seq).toMatch(/^[A-Z]{3}$/);
  await expect(page.locator("#seq-box b")).toHaveCount(3);
  await expect(page.locator("#holder-nome")).toHaveText("Passala!");

  // parola senza sequenza: rifiutata, nessuna scrittura, input libero
  const W = page;
  const senza = await W.evaluate((s) => window.FAWWords.wordsContaining("ZQ").filter((w) => w.indexOf(s) < 0)[0] || "ZUCCHINO", seq);
  await passa(page, senza);
  await expect(page.locator("#fb-parola")).toContainText("deve contenere");
  let d = await page.evaluate(() => window.FAWBomba.stato.dataLocale);
  expect(d.bomba.storico.length).toBe(0);

  // parola giusta: +10 e la miccia riparte? NO: la scadenza resta la stessa
  const inizio1 = await page.evaluate(() => window.FAWBomba.stato.dataLocale.bomba.round.inizioAlle);
  const micro = await page.evaluate(() => window.FAWBomba.stato.dataLocale.bomba.round.micciaMs);
  const parola = await cercaParola(page, seq, []);
  expect(parola).toBeTruthy();
  await passa(page, parola.toLowerCase());
  await page.waitForFunction((p) => {
    const b = window.FAWBomba.stato.dataLocale.bomba;
    return b.usate.indexOf(p) >= 0;
  }, parola, { timeout: 10000 });
  d = await page.evaluate(() => window.FAWBomba.stato.dataLocale);
  expect(d.punteggi.ALICE).toBe(10 + (parola.length >= 8 ? 5 : 0));
  expect(d.bomba.round.inizioAlle).toBe(inizio1, "passare la bomba non sposta la scadenza");
  expect(d.bomba.round.micciaMs).toBe(micro);
  const bar = await page.evaluate(() => document.getElementById("fuse-barra").style.width);
  expect(parseFloat(bar)).toBeGreaterThan(0);
  expect(parseFloat(bar)).toBeLessThan(100, "la barra segna il tempo già consumato, non riparte");

  // etichetta ridondante: icona + parola (non solo colore)
  await expect(page.locator("#fuse-lab")).toContainText(/calma|tiepida|calda|fervente|critica/);

  // la stessa parola ridetta subito è rifiutata per tutta la partita
  await passa(page, parola);
  await expect(page.locator("#fb-parola")).toContainText(/già stata detta/);

  // esplosione: microcia scaduta → -100, nuovo round, sequenza nuova, parole vietate restano
  await page.evaluate(() => {
    const b = window.FAWBomba.stato.dataLocale.bomba;
    b.round.inizioAlle = Date.now() - (b.round.micciaMs + 500);
  });
  await page.waitForFunction(() => {
    const b = window.FAWBomba.stato.dataLocale.bomba;
    return b.roundIdx === 1 && b.esplosioni.ALICE === 1;
  }, null, { timeout: 10000 });
  d = await page.evaluate(() => window.FAWBomba.stato.dataLocale);
  expect(d.punteggi.ALICE).toBe(10 + (parola.length >= 8 ? 5 : 0) - 100);
  expect(d.bomba.round.seq).not.toBe(seq);
  expect(d.bomba.usate).toEqual([parola], "le parole già dette restano vietate nel round nuovo");
  expect(d.bomba.storico.some((x) => x.esplode === true)).toBe(true);

  // e nel round nuovo una parola senza la nuova sequenza non passa comunque
  await passa(page, parola);
  await expect(page.locator("#fb-parola")).toContainText(/deve contenere/);

  expect(page.__errors || [], "errori di pagina: " + JSON.stringify(page.__errors)).toEqual([]);
  await ctx.close();
});

/* --------------------------------- multiplayer ----------------------------- */

test("bomba: due dispositivi — stesso round, turno, passaggio, e chi non tocca resta bloccato", async ({ browser }) => {
  const s = await sala(browser, ["ALICE", "BOB"]);
  try {
    const [alice, bob] = s.giocatori;
    const seqA = await seqDi(alice.page), seqB = await seqDi(bob.page);
    expect(seqA).toBe(seqB, "stessa sequenza per tutti (è nel documento)");
    const roundA = await alice.page.evaluate(() => window.FAWBomba.stato.data.bomba.round);
    expect(roundA.micciaMs).toBeGreaterThanOrEqual(25000);

    const poss = await alice.page.evaluate(() => window.FAWBomba.stato.data.bomba.possessore);
    expect(poss).toBe("ALICE", "il creatore inizia con la bomba");

    // BOB non può passare: bottone spento e scritta chiara, senza messaggi d'errore
    await expect(bob.page.locator("#btn-passa")).toBeDisabled();
    await expect(bob.page.locator("#btn-passa")).toHaveText("Aspetta il turno");
    // e se forza il transato, le regole lo rifiutano
    const forcato = await bob.page.evaluate((p) => window.FAWBombaRules.puoPassare(window.FAWBomba.stato.data, "BOB", { ora: Date.now(), testo: p, roundIdx: 0 }).motivo, await cercaParola(bob.page, seqA, []));
    expect(forcato).toBe("NON_TUOI");

    const parola = await cercaParola(alice.page, seqA, []);
    await passa(alice.page, parola);
    await waitDoc(alice.page, s.matchId, (doc) => doc && doc.bomba.possessore === "BOB", "il turno passa a BOB");
    const doc = await doc0(alice.page, s.matchId);
    expect(doc.punteggi.ALICE).toBe(10 + (parola.length >= 8 ? 5 : 0));
    expect(doc.bomba.usate).toEqual([parola]);
    expect(doc.bomba.storico[0].w).toBe(parola);
    // le parole altrui non vengono mostrate prima che siano accettate: qui sì, perché il feed è pubblico e il gioco non le nasconde
    await expect(bob.page.locator("#btn-passa")).toBeEnabled({ timeout: 10000 });
    await expect(bob.page.locator("#holder-nome")).toHaveText("Passala!", "il turno arriva a BOB");

    // parola già usata: rifiutata con motivo specifico, nessun punto
    await passa(bob.page, parola);
    await expect(bob.page.locator("#fb-parola")).toContainText(/già stata detta/);
    const dopo = await doc0(alice.page, s.matchId);
    expect(dopo.bomba.passaggi.BOB || 0).toBe(0);
    expect(dopo.punteggi.BOB).toBe(0);
  } finally { await s.chiudi(); }
});

test("bomba: 4 dispositivi — giro completo A→B→C→D, miccia intatta, e i non di turno non possono toccare", async ({ browser }) => {
  const nomi = ["ALICE", "BOB", "CICE", "DINO"];
  const s = await sala(browser, nomi);
  try {
    const d0 = await doc0(s.boot.page, s.matchId);
    const inizio = d0.bomba.round.inizioAlle;
    expect(d0.bomba.possessore).toBe("ALICE", "la bomba inizia da chi ha creato la sala");

    const giaViste = [];
    for (let k = 0; k < 4; k++) {
      const tocca = s.giocatori[k];
      const seq = await seqDi(tocca.page);
      // per tutti e quattro la sequenza è la stessa: vive nel documento
      for (const g of s.giocatori) expect(await seqDi(g.page), "stessa sequenza su ogni dispositivo").toBe(seq);
      // chi non è di turno ha il bottone spento (e non può scrivere la propria parola)
      for (let j = 0; j < 4; j++) {
        if (j !== k) await expect(s.giocatori[j].page.locator("#btn-passa")).toBeDisabled({ timeout: 10000 });
      }
      const parola = await cercaParola(tocca.page, seq, giaViste);
      expect(parola, "devono esserci abbastanza parole per la sequenza").toBeTruthy();
      giaViste.push(parola);

      await passa(tocca.page, parola);
      const atteso = nomi[(k + 1) % 4];
      const d = await waitDoc(s.boot.page, s.matchId, (x) => x.bomba.possessore === atteso, "passa a " + atteso);
      expect(d.bomba.round.inizioAlle, "la miccia non si azzera mai al passaggio").toBe(inizio);
      expect(d.punteggi[nomi[k]], "un punto parola a chi passa").toBe(10 + (parola.length >= 8 ? 5 : 0));
    }

    const fine = await doc0(s.boot.page, s.matchId);
    expect(fine.bomba.possessore).toBe("ALICE", "il giro si chiude in cerchio");
    expect(fine.bomba.usate.length).toBe(4, "quattro parole registrate, tutte diverse");
    expect(fine.bomba.usate.sort()).toEqual([...giaViste].sort());
    expect(Object.keys(fine.bomba.passaggi).sort()).toEqual([...nomi].sort());
    nomi.forEach((n) => expect(fine.bomba.passaggi[n]).toBe(1));
  } finally { await s.chiudi(); }
});

test("bomba: doppio tocco = un solo passaggio (scritture idempotenti)", async ({ browser }) => {
  const s = await sala(browser, ["ALICE", "BOB", "CIRA"]);
  try {
    const a = s.giocatori[0].page;
    const seq = await seqDi(a);
    const parola = await cercaParola(a, seq, []);
    await a.fill("#inp-parola", parola);
    // due invii quasi simultanei
    // Un doppio click reale, non due comandi Playwright che possono attendere
    // il turno successivo dopo che il primo ha correttamente spento il pulsante.
    await expect(a.locator("#btn-passa")).toBeEnabled();
    await a.locator("#btn-passa").dblclick();
    await waitDoc(a, s.matchId, (doc) => doc.bomba.passaggi.ALICE >= 1, "passaggio registrato");
    await a.waitForTimeout(1200);
    const doc = await doc0(a, s.matchId);
    expect(doc.bomba.passaggi.ALICE).toBe(1, "un solo passaggio conteggiato");
    expect(doc.bomba.usate.length).toBe(1);
    expect(doc.punteggi.ALICE).toBe(10 + (parola.length >= 8 ? 5 : 0));
    expect(doc.bomba.storico.filter((x) => x.w === parola).length).toBe(1);
    expect(doc.bomba.possessore).toBe("BOB");
  } finally { await s.chiudi(); }
});

test("bomba: esplosione condivisa — penalità, round nuovo, e chi arriva dopo non salva nessuno", async ({ browser }) => {
  const s = await sala(browser, ["ALICE", "BOB"]);
  try {
    const [alice, bob] = s.giocatori;
    const seq = await seqDi(alice.page);
    const prima = await doc0(alice.page, s.matchId);
    const possessore = prima.bomba.possessore;
    const parola = await cercaParola(alice.page, seq, []);
    // ALICE digita, ma non invia: la miccia scade
    await alice.page.fill("#inp-parola", parola);
    await A.scriviDoc(alice.page, s.matchId, { "bomba.round.inizioAlle": Date.now() - 40000 });
    await waitDoc(alice.page, s.matchId, (doc) => doc.bomba.roundIdx === 1 && (doc.bomba.esplosioni[possessore] || 0) === 1, "esplosione registrata una volta sola");
    const doc = await doc0(alice.page, s.matchId);
    expect(doc.punteggi[possessore]).toBe(-100);
    expect(doc.bomba.round.seq).not.toBe(seq, "nuova sequenza");
    expect(doc.bomba.round.inizioAlle).toBeGreaterThan(Date.now() - 5000, "nuova miccia, non ancora esplosa");
    expect(doc.bomba.storico.some((x) => x.esplode)).toBe(true);
    // entrambi vedono la stessa cosa
    await expect(bob.page.locator("#hud-round")).toHaveText("Round 2", { timeout: 10000 });
    await expect(alice.page.locator("#hud-round")).toHaveText("Round 2");

    // la parola preparata prima dello scoppio non può essere recuperata
    const esito = await alice.page.evaluate((p) => {
      const d = window.FAWBomba.stato.data;
      const me = "ALICE";
      const ora = Date.now();
      return {
        vecchio: window.FAWBombaRules.puoPassare({ ...d, bomba: { ...d.bomba, roundIdx: 0, round: { ...d.bomba.round, inizioAlle: ora - 40000, micciaMs: 35000 }, possessore: me } }, me, { ora, testo: p, roundIdx: 0 }).motivo,
        nuovo: window.FAWBombaRules.puoPassare(d, me, { ora, testo: p, roundIdx: 0 }).motivo
      };
    }, parola);
    expect(esito.vecchio).toBe("FUORI_TEMPO", "dopo lo scoppio è tardivo");
    expect(esito.nuovo).not.toBe(undefined, "il round nuovo ha sue regole");
    const dopo = await doc0(alice.page, s.matchId);
    expect(dopo.bomba.usate.indexOf(parola)).toBe(-1, "la parola non è stata salvata retroattivamente");
    expect(dopo.bomba.passaggi.ALICE || 0).toBe(0);
  } finally { await s.chiudi(); }
});

test("bomba: giocatore offline non blocca il giro (nessuna penalità per lui)", async ({ browser }) => {
  const s = await sala(browser, ["ALICE", "BOB", "CIRA"]);
  try {
    const a = s.giocatori[0].page;
    // BOB esce di scena mentre ha la bomba
    await A.scriviDoc(a, s.matchId, { "bomba.possessore": "BOB", "bomba.ultimoPasso": Date.now() - 60000 });
    await s.giocatori[1].ctx.close();
    await A.scriviDoc(a, s.matchId, { "giocatori.BOB": { nome: "BOB", visto: Date.now() - 90000 } });
    await waitDoc(a, s.matchId, (doc) => doc.bomba.possessore === "CIRA" && (doc.bomba.saltati.BOB || 0) >= 1, "bomba passata oltre, senza colpevoli");
    const doc = await doc0(a, s.matchId);
    expect(doc.punteggi.BOB).toBe(0, "nessuna penalità: era offline");
    expect(doc.bomba.esplosioni.BOB || 0).toBe(0);
    expect(doc.bomba.storico.slice(-1)[0].salto).toBe(true);
    await expect(a.locator("#holder-nome")).not.toHaveText("—", "l'interfaccia segue il passaggio");
  } finally { await s.chiudi(); }
});

test("bomba: reload a metà round — riprende la miccia vera del documento", async ({ browser }) => {
  const s = await sala(browser, ["ALICE", "BOB"]);
  try {
    const a = s.giocatori[0].page;
    await aspettaBarra(a);
    const prima = await a.evaluate(() => {
      const r = window.FAWBomba.stato.data.bomba.round;
      return { i: r.inizioAlle, seq: r.seq, m: r.micciaMs, fraz: parseFloat(document.getElementById("fuse-barra").style.width) };
    });
    expect(prima.fraz).toBeLessThanOrEqual(100);
    await a.reload({ waitUntil: "domcontentloaded" });
    await apriBomba(a, s.matchId);
    await inGioco(a);
    await aspettaBarra(a);
    const dopo = await a.evaluate(() => {
      const r = window.FAWBomba.stato.data.bomba.round;
      return { i: r.inizioAlle, seq: r.seq, m: r.micciaMs, fraz: parseFloat(document.getElementById("fuse-barra").style.width) };
    });
    expect(dopo.i).toBe(prima.i, "la scadenza non riparte: è nel documento");
    expect(dopo.seq).toBe(prima.seq);
    expect(dopo.fraz).toBeGreaterThanOrEqual(prima.fraz - 1, "la barra riprende da dove era");
    const poss = await a.evaluate(() => window.FAWBomba.stato.data.bomba.possessore);
    expect(poss).toBe("ALICE", "è ancora il suo turno dopo il reload");
    await expect(a.locator("#btn-passa")).toBeEnabled();
  } finally { await s.chiudi(); }
});

test("bomba: fine partita, classifica e rivincita con un tap", async ({ browser }) => {
  const s = await sala(browser, ["ALICE", "BOB"], { durataMs: 12000 });
  try {
    const [alice, bob] = s.giocatori;
    const seq = await seqDi(alice.page);
    const parola = await cercaParola(alice.page, seq, []);
    await passa(alice.page, parola);
    await waitDoc(alice.page, s.matchId, (doc) => doc.bomba.passaggi.ALICE >= 1, "parola a referto");
    // tempo scaduto: il round si chiude da solo ( watchdog/tick ), senza input manuali
    await A.scriviDoc(alice.page, s.matchId, { endsAt: Date.now() - 100 });
    await alice.page.waitForFunction(() => window.FAWBomba.stato.data && window.FAWBomba.stato.data.stato === "conclusa", null, { timeout: 20000 });
    await expect(alice.page.locator("#schermo-risultati")).toBeVisible();
    await expect(bob.page.locator("#schermo-risultati")).toBeVisible({ timeout: 15000 });
    const doc = await doc0(alice.page, s.matchId);
    expect(doc.risultati.classifica.length).toBe(2);
    expect(doc.risultati.classifica.find((c) => c.nome === "ALICE").punti).toBe(10 + (parola.length >= 8 ? 5 : 0));
    expect(doc.risultati.esito.campione).toBe("ALICE");
    expect(doc.risultati.parole).toContain(parola);
    await expect(alice.page.locator("#ris-stats")).toContainText("parole valide");
    await expect(alice.page.locator("#classifica .faw-rank")).toHaveCount(2);
    await expect(alice.page.locator("#ris-parole")).toContainText(parola);

    await alice.page.click("#btn-rivincita");
    await waitDoc(alice.page, s.matchId, (d) => !!d.prossimaPartita, "rivincita creata");
    await expect(bob.page.locator("#btn-rivincita")).toHaveText("Entra in rivincita", { timeout: 12000 });
    const nuova = await doc0(alice.page, s.matchId);
    expect(nuova.prossimaPartita).toBeTruthy();
    const doc2 = await doc0(alice.page, nuova.prossimaPartita);
    expect(doc2.stato).toBe("attesa");
    expect(doc2.rivincitaDi).toBe(s.matchId);
    expect(doc2.gioco).toBe("bomba-parole");
    expect(doc2.opzioni.miccia).toBe("media");
  } finally { await s.chiudi(); }
});

test("bomba: 320px senza overflow, hero fermo quando la tastiera apre, nessuna funzione audio", async ({ browser }) => {
  const { ctx, page } = await A.contesto(browser, "ALICE", { viewport: { width: 320, height: 568 }, touch: true });
  await apriBomba(page, null, "solo=1");
  await page.waitForFunction(() => window.FAWBomba.stato.data && window.FAWBomba.stato.data.bomba.round, null, { timeout: 15000 });
  const overflow = await page.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, cw: document.scrollingElement.clientWidth }));
  expect(overflow.sw).toBeLessThanOrEqual(overflow.cw + 1, "nessun overflow orizzontale a 320px");
  // «la tastiera non deve spostare niente»: l'input è nel flusso (non ancorato in
  // basso) e il viewport chiede il ridimensionamento del contenuto → la posizione
  // del blocco bomba nel documento non cambia quando l'input prende il focus.
  const meta = await page.evaluate(() => document.querySelector("meta[name=viewport]").content);
  expect(meta).toContain("interactive-widget=resizes-content");
  expect(meta).toContain("viewport-fit=cover");
  const prima = await page.evaluate(() => {
    const n = document.getElementById("bomba-hero");
    return { yDoc: Math.round(n.getBoundingClientRect().top + window.scrollY), pos: getComputedStyle(n).position };
  });
  expect(prima.pos).toBe("static");
  await page.locator("#inp-parola").focus();
  await page.waitForTimeout(400);
  const dopo = await page.evaluate(() => {
    const n = document.getElementById("bomba-hero");
    const i = document.getElementById("inp-parola").getBoundingClientRect();
    return {
      yDoc: Math.round(n.getBoundingClientRect().top + window.scrollY),
      inputVibile: i.top >= 0 && i.bottom <= window.innerHeight + 1,
      frmPos: getComputedStyle(document.getElementById("frm-parola")).position
    };
  });
  expect(dopo.yDoc, "la posizione nel documento non deve cambiare").toBe(prima.yDoc);
  expect(dopo.frmPos, "il form non deve essere position:fixed").not.toBe("fixed");
  expect(dopo.inputVibile, "l'input resta visibile dopo il focus").toBe(true);
  // target touch minimi
  const dimensioni = await page.evaluate(() => ["#btn-passa", "#btn-regole", "#inp-parola"].map((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { s, h: Math.round(r.height), w: Math.round(r.width) };
  }));
  for (const d of dimensioni) expect(d.h, d.s + " troppo basso per il pollice").toBeGreaterThanOrEqual(44);
  const larga = dimensioni.find((d) => d.s === "#inp-parola");
  expect(larga.w, "il campo parola deve restare comodo da digitare a 320px").toBeGreaterThanOrEqual(150);
  // Tutte le informazioni restano visive; non c'è un motore audio nascosto.
  await expect(page.locator("#btn-audio")).toHaveCount(0);
  expect(await page.evaluate(() => ["beep", "soundOn", "setSoundOn", "armaSuoni"].some(k => k in FAWCore))).toBe(false);
  await expect(page.locator("#fuse-lab")).not.toHaveText("");
  expect(page.__errors || [], "errori di pagina: " + JSON.stringify(page.__errors)).toEqual([]);
  await ctx.close();
});
