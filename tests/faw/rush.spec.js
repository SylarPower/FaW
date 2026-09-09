/**
 * Categoria Rush — test d'integrazione (contesti browser separati, un contesto
 * per giocatore). Il tempo dei round è derivato da `startAt`, quindi i test
 * spostano `startAt` sul documento invece di aspettare 30 secondi: il codice
 * prodotto non ha scorciatoie, e la finestra di scrittura resta verificata.
 */
"use strict";

const { test, expect } = require("@playwright/test");
const A = require("./aiuti");

/* Ogni test parte da uno store pulito: i giochi condividono `partite/*` e
   `presenze/*` nello stesso relay, e i residui alterano i tempi dei test. */
test.beforeEach(async () => { await A.resetRelay(); });

const GIOCO = "games/categoria-rush/index.html";
const CICLO = 30000, INPUT = 26000, VOTO = 7000;

/** Rush non carica il dizionario delle parole: basta che i moduli siano pronti. */
async function apriRush(page, matchId, extra) {
  const q = [];
  if (matchId) q.push("matchId=" + matchId);
  if (extra) q.push(extra.replace(/^\?/, ""));
  await page.goto(GIOCO + (q.length ? "?" + q.join("&") : ""), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.FAWRush && window.FAWCategorie && window.FAWRoom, null, { timeout: 30000 });
}

async function creaSala(browser, giocatori, opzioni, durata) {
  const boot = await A.contesto(browser, giocatori[0]);
  await boot.page.goto(GIOCO, { waitUntil: "domcontentloaded" });
  await boot.page.waitForFunction(() => window.FAWRoom, null, { timeout: 30000 });
  const matchId = await A.creaPartita(boot.page, {
    gioco: "categoria-rush", creator: giocatori[0], giocatori,
    opzioni: Object.assign({ durata: String(Math.round((durata || 120000) / 1000)), mode: "classiche", countdown: 3 }, opzioni || {}),
    durata: durata || 120000
  });
  return { boot, matchId };
}

test("rush solo: pannello opzioni, allenamento, risposta accettata e rifiutata", async ({ browser }) => {
  const { ctx, page } = await A.contesto(browser, "ALICE");
  await apriRush(page);
  await expect(page.locator("#schermo-crea")).toBeVisible();
  // il pannello dice cosa succederà davvero (numero di round e durata effettiva)
  await expect(page.locator("#crea-hint")).toContainText(/round · fino a \d+ s/);
  await page.locator('[data-seg="durata"] [data-v="180"]').click();
  await expect(page.locator("#crea-hint")).toContainText("6 round");
  await page.locator("#btn-solo").click();
  await expect(page.locator("#schermo-gioco")).toBeVisible();

  await page.waitForFunction(() => window.FAWRush.stato.idx >= 0, null, { timeout: 10000 });
  const combo = await page.evaluate(() => window.FAWRush.stato.rounds[window.FAWRush.stato.idx]);
  expect(combo.lettera).toMatch(/^[A-Z]$/);
  await expect(page.locator("#round-lettera")).toHaveText(combo.lettera);
  await expect(page.locator("#round-categoria")).toHaveText(combo.nome);
  await expect(page.locator("#round-sr")).toContainText("Round 1 di 6");

  // risposta sbagliata: motivo chiaro, nessun blocco
  await page.fill("#inp-risposta", "qq");
  await page.click("#btn-invia");
  await expect(page.locator("#feedback")).toContainText("almeno 3 lettere");

  // parola reale ma fuori categoria: rifiutata (il dizionario non basta)
  await page.fill("#inp-risposta", "tavolaccio");
  await page.click("#btn-invia");
  await expect(page.locator("#feedback")).not.toHaveText("");

  // risposta ammessa: +punti e input bloccato per il round
  const r = await A.rispostaValida(page, { indice: 0 });
  expect(r.word, "il database locale deve offrire una risposta per la lettera del round").toBeTruthy();
  await page.fill("#inp-risposta", r.word);
  await page.click("#btn-invia");
  await expect(page.locator("#rivela")).toBeVisible();
  await expect(page.locator("#rivela-lista")).toContainText(r.word);
  await expect(page.locator("#punti-solo")).not.toHaveText("0"); // ultimo (unico) giocatore: chiusura e punti immediati
  await expect(page.locator("#inp-risposta")).toHaveJSProperty("readOnly", true);

  // secondo invio nello stesso round: no (risposta definitiva)
  await page.evaluate(() => { document.getElementById("inp-risposta").disabled = false; document.getElementById("inp-risposta").readOnly = false; });
  await page.evaluate(() => document.getElementById("inp-risposta").value = "altra prova");
  await page.evaluate(() => window.FAWRush.invia());
  await expect(page.locator("#feedback")).toContainText("definitiva");

  // in allenamento compaiono le altre risposte ammesse (ripasso)
  await expect(page.locator("#box-altre")).toBeVisible();
  await expect(page.locator("#altre")).toContainText(r.word);
  await page.evaluate(() => { document.getElementById("inp-risposta").disabled = true; });
  await expect(page.locator("#punti-solo")).not.toHaveText("0");
  await expect(page.locator("#inp-risposta")).toBeDisabled();

  expect(page.__errors || [], "console errors: " + (page.__errors || []).join(" | ")).toEqual([]);
  await ctx.close();
});

test("rush multiplayer: stessa domanda, risposta unica, rivelazione, risultati, rivincita", async ({ browser }) => {
  const { boot, matchId } = await creaSala(browser, ["ALICE", "BOB"]);
  const a = await A.contesto(browser, "ALICE");
  const b = await A.contesto(browser, "BOB");
  await apriRush(a.page, matchId);
  await apriRush(b.page, matchId);

  await a.page.locator("#btn-pronto").click();
  await b.page.locator("#btn-pronto").click();
  await A.aspettaStato(a.page, matchId, ["pronto", "in_corso"]);
  await expect(a.page.locator("#schermo-gioco")).toBeVisible({ timeout: 25000 });
  await expect(b.page.locator("#schermo-gioco")).toBeVisible({ timeout: 25000 });

  // 1) la domanda è identica su entrambi i dispositivi
  const roundA = await a.page.locator("#round-categoria").textContent();
  const letA = await a.page.locator("#round-lettera").textContent();
  expect(await b.page.locator("#round-categoria").textContent()).toBe(roundA);
  expect(await b.page.locator("#round-lettera").textContent()).toBe(letA);

  // 2) risposte diverse -> entrambe uniche
  const ra = await A.rispostaValida(a.page, { indice: 0 });
  const rb = await A.rispostaValida(b.page, { indice: 1, escludi: [ra.word] });
  expect(rb.word && rb.word !== ra.word, "servono due risposte diverse per testare l'unicità").toBe(true);
  await A.rispondi(a.page, ra.word);
  // Finché B deve rispondere, la parola di A resta nascosta nella UI.
  expect(await b.page.locator("#schermo-gioco").innerText()).not.toContain(ra.word.toLowerCase());
  await A.rispondi(b.page, rb.word);
  await expect(a.page.locator("#round-avanzati")).toHaveText("2/2");

  // 3) entrambe le risposte sono registrate nello stesso round
  const docGiu = await A.leggiDoc(b.page, matchId);
  const idx = (await a.page.evaluate(() => window.FAWRush.stato.idx));
  expect(Object.keys((((docGiu.data.rush || {}).risposte || {})[idx] || {})).sort()).toEqual(["ALICE", "BOB"]);

  // 4) l’ultimo invio chiude subito il round: nessuno spostamento del tempo
  await a.page.waitForFunction((i) => !!(((window.FAWRush.stato.data || {}).rush || {}).punteggiRound || {})[i], idx, { timeout: 20000 });
  await expect(b.page.locator("#rivela")).toBeVisible({ timeout: 20000 });
  const rivelaText = await b.page.locator("#rivela-lista").innerText();
  expect(rivelaText.toLowerCase()).toContain(ra.word.toLowerCase());
  expect(rivelaText.toLowerCase()).toContain(rb.word.toLowerCase());
  expect(rivelaText.toUpperCase()).toContain("UNICA");

  const doc1 = await A.leggiDoc(a.page, matchId);
  const puntiRound = doc1.data.rush.punteggiRound[idx];
  expect(puntiRound.ALICE).toBeGreaterThan(150);
  expect(puntiRound.BOB).toBeGreaterThan(150);
  expect(doc1.data.punteggi.ALICE).toBe(puntiRound.ALICE, "il punteggio cumulato è esattamente la somma dei round");

  // 5) risposte uguali -> bonus ridotto, e un round in più giocato
  const idx2 = idx + 1;
  await A.portaFaseRush(a.page, matchId, idx2, "input");
  expect(await A.attendiRound(a.page), "A deve vedere il round 2 aperto").toBe(idx2);
  expect(await A.attendiRound(b.page), "B deve vedere lo stesso round").toBe(idx2);
  const ra2 = await A.rispostaValida(a.page, { indice: 0 });
  const rb2 = await A.rispostaValida(b.page, { indice: 0 });
  expect(ra2.word).toBe(rb2.word, "stessa risposta per testare i duplicati");
  await A.rispondi(a.page, ra2.word);
  await A.rispondi(b.page, rb2.word);
  await a.page.waitForFunction((i) => !!(((window.FAWRush.stato.data || {}).rush || {}).punteggiRound || {})[i], idx2, { timeout: 20000 });
  const doc2 = await A.leggiDoc(a.page, matchId);
  const r2 = doc2.data.rush.punteggiRound[idx2];
  expect(r2.ALICE).toBeLessThan(doc1.data.rush.punteggiRound[idx].ALICE + 10, "in due sulla stessa risposta il bonus cala");
  const rivela2 = await a.page.locator("#rivela-lista").innerText();
  expect(rivela2.toUpperCase()).toContain("IN COMUNE");

  // 6) reload a round in corso: riprende lo stesso round, non riparte
  await A.portaFaseRush(a.page, matchId, idx2 + 1, "input");
  await a.page.waitForTimeout(400);
  const primaDelReload = await a.page.evaluate(() => ({
    idx: window.FAWRush.stato.idx, cat: document.getElementById("round-categoria").textContent
  }));
  await a.page.reload({ waitUntil: "domcontentloaded" });
  await a.page.waitForFunction(() => window.FAWRush && window.FAWRush.stato.data, null, { timeout: 30000 });
  const dopoReload = await a.page.evaluate(() => ({
    idx: window.FAWRush.stato.idx, cat: document.getElementById("round-categoria").textContent,
    inGioco: window.FAWRush.stato.inGioco
  }));
  expect(dopoReload.idx).toBe(primaDelReload.idx);
  expect(dopoReload.cat).toBe(primaDelReload.cat);
  expect(dopoReload.inGioco).toBe(true);

  // 7) risposta arrivata dopo la chiusura del round: non conta
  const idxChiuso = dopoReload.idx;
  await A.portaFaseRush(a.page, matchId, idxChiuso, "rivela");
  await a.page.waitForFunction((i) => !!(((window.FAWRush.stato.data || {}).rush || {}).punteggiRound || {})[i], idxChiuso, { timeout: 25000 });
  const prima = await A.leggiDoc(a.page, matchId);
  await a.page.evaluate(() => { const i = document.getElementById("inp-risposta"); i.disabled = false; document.getElementById("btn-invia").disabled = false; });
  await a.page.evaluate(() => document.getElementById("inp-risposta").value = "recupero impossibile");
  await a.page.evaluate(() => window.FAWRush.invia());
  await expect(a.page.locator("#feedback")).toContainText(/tempo scaduto/i);
  // e una scrittura tardiva diretta sul documento non cambia i punteggi
  const roundPrecedente = Math.max(0, idxChiuso - 1);
  await A.scriviDoc(a.page, matchId, { ["rush.risposte." + roundPrecedente + ".TARDI"]: { parola: "tardo", ok: true, t: 0 } });
  const dopo = await A.leggiDoc(a.page, matchId);
  expect(dopo.data.rush.punteggiRound[roundPrecedente]).toEqual(prima.data.rush.punteggiRound[roundPrecedente],
    "i punti di un round chiuso non si ricalcolano");

  // 8) fine partita: classifica, statistiche, rivincita con un tap
  const n = await a.page.evaluate(() => window.FAWRush.stato.rounds.length);
  await A.portaAvanti(a.page, matchId, CICLO * n + 500);
  await a.page.waitForFunction(() => {
    const d = window.FAWRush.stato.data || {};
    return d.stato === "conclusa" || d.stato === "risultati";
  }, null, { timeout: 30000 });
  await expect(a.page.locator("#schermo-risultati")).toBeVisible({ timeout: 25000 });
  await expect(b.page.locator("#schermo-risultati")).toBeVisible({ timeout: 25000 });
  const righe = await a.page.locator("#ris-classifica .faw-rank").count();
  expect(righe).toBe(2);
  await expect(a.page.locator("#ris-rounds .roundo")).toHaveCount(n);
  const classifica = (await A.leggiDoc(a.page, matchId)).data.risultati.classifica;
  expect(classifica[0].punti).toBeGreaterThanOrEqual(classifica[1].punti);
  expect(await a.page.locator("#ris-esito").textContent()).toMatch(/Pareggio|vince con/i);

  await a.page.locator("#btn-rivincita").click();
  await b.page.waitForFunction(() => !document.getElementById("box-rivincita").hidden, null, { timeout: 25000 });
  await b.page.locator("#btn-accetta-rivincita").click();
  const nuovaId = (await A.leggiDoc(a.page, matchId)).data.prossimaPartita;
  expect(nuovaId).toBeTruthy();
  await b.page.waitForFunction((id) => location.search.indexOf("matchId=" + id) >= 0, nuovaId, { timeout: 25000 });
  const nuova = await A.leggiDoc(b.page, nuovaId);
  expect(nuova.data.stato).toBe("attesa");
  expect(nuova.data.partecipanti.sort()).toEqual(["ALICE", "BOB"]);
  expect(nuova.data.punteggi.ALICE).toBe(0);
  expect(nuova.data.opzioni.durata).toBe(prima.data.opzioni.durata);

  for (const p of [a.page, b.page]) expect(p.__errors || [], "console errors: " + (p.__errors || []).join(" | ")).toEqual([]);
  await a.ctx.close(); await b.ctx.close(); await boot.ctx.close();
});

test("rush: 4 dispositivi — unica contro in-due, e il bonus non dipende dai tempi", async ({ browser }) => {
  const nomi = ["ALICE", "BOB", "CICE", "DINO"];
  const { boot, matchId } = await creaSala(browser, nomi);
  const giocator = [];
  for (const n of nomi) {
    const c = await A.contesto(browser, n);
    await apriRush(c.page, matchId);
    giocator.push(c);
  }
  try {
    for (const g of giocator) await g.page.locator("#btn-pronto").click();
    await A.aspettaStato(giocator[0].page, matchId, ["pronto", "in_corso"]);
    for (const g of giocator) await expect(g.page.locator("#schermo-gioco")).toBeVisible({ timeout: 25000 });

    // 1) la domanda è la stessa su quattro dispositivi
    const domande = await Promise.all(giocator.map((g) => g.page.evaluate(() => {
      const st = window.FAWRush.stato;
      const c = st.rounds[st.idx];
      return c ? c.categoria + ":" + c.lettera : null;
    })));
    expect(new Set(domande).size, "stessa categoria e stessa lettera per tutti").toBe(1);
    const idx = await giocator[0].page.evaluate(() => window.FAWRush.stato.idx);

    // 2) tre parole diverse: Alice e Dino soli, Bob e Cice in due sulla stessa
    const [wa, wb, wc] = await Promise.all([
      A.rispostaValida(giocator[0].page, { indice: 0 }),
      A.rispostaValida(giocator[1].page, { indice: 1 }),
      A.rispostaValida(giocator[3].page, { indice: 2 })
    ]);
    expect(wb.word).not.toBe(wa.word);
    expect(wc.word).not.toBe(wb.word);
    expect(wc.word).not.toBe(wa.word);
    await A.rispondi(giocator[0].page, wa.word);
    await A.rispondi(giocator[1].page, wb.word);
    await A.rispondi(giocator[2].page, wb.word);
    await A.rispondi(giocator[3].page, wc.word);
    await expect(giocator[0].page.locator("#round-avanzati")).toHaveText("4/4");

    // 3) chiusura del round e rivelazione: chi era solo porta a casa il bonus pieno
    await giocator[0].page.waitForFunction((i) => !!(((window.FAWRush.stato.data || {}).rush || {}).punteggiRound || {})[i], idx, { timeout: 25000 });
    const doc = await A.leggiDoc(giocator[0].page, matchId);
    const punti = doc.data.rush.punteggiRound[idx];
    const riv = doc.data.rush.rivela[idx];
    expect(riv.ALICE.originale).toBe(true);
    expect(riv.DINO.originale).toBe(true);
    expect(riv.BOB.condivisa).toBe(true);
    expect(riv.CICE.condivisa).toBe(true);
    expect(riv.BOB.parola).toBe(riv.CICE.parola, "stessa parola: è una coincidenza, non un'unicità");
    // bonusUnico 60 - bonusCoppia 15 = 45; il più lento dei due può recuperare al
    // massimo 40 di bonus velocità, quindi il distacco minimo garantito è 5 punti
    expect(punti.ALICE - punti.BOB).toBeGreaterThanOrEqual(5);
    expect(punti.DINO - punti.CICE).toBeGreaterThanOrEqual(5);
    expect(punti.BOB).toBeLessThan(160, "in due non si arriva mai al premio dell'unica");
    // e il punteggio cumulato non può essere sotto i punti del round chiuso
    for (const n of nomi) expect(doc.data.punteggi[n]).toBeGreaterThanOrEqual(punti[n]);
  } finally { await boot.ctx.close(); for (const g of giocator) { try { await g.ctx.close(); } catch (e) {} } }
});

test("rush: un giocatore inattivo non blocca i round e non li vince", async ({ browser }) => {
  const { boot, matchId } = await creaSala(browser, ["ALICE", "BOB", "CINZIA"]);
  const a = await A.contesto(browser, "ALICE");
  const b = await A.contesto(browser, "BOB");
  const c = await A.contesto(browser, "CINZIA");
  await apriRush(a.page, matchId);
  await apriRush(b.page, matchId);
  await apriRush(c.page, matchId);
  await a.page.locator("#btn-pronto").click();
  await b.page.locator("#btn-pronto").click();
  await c.page.locator("#btn-pronto").click();
  await A.aspettaStato(a.page, matchId, ["pronto", "in_corso"]);
  await expect(a.page.locator("#schermo-gioco")).toBeVisible({ timeout: 25000 });

  const r = await A.rispostaValida(a.page, { indice: 0 });
  await A.rispondi(a.page, r.word);
  await A.rispondi(b.page, r.word);
  // CINZIA non risponde a nessuno dei due round
  await A.portaAvanti(a.page, matchId, INPUT + 900);
  await a.page.waitForFunction((i) => !!(((window.FAWRush.stato.data || {}).rush || {}).punteggiRound || {})[i], 0, { timeout: 25000 });
  const doc = await A.leggiDoc(a.page, matchId);
  expect(doc.data.rush.punteggiRound[0].CINZIA || 0).toBe(0, "chi non risponde prende zero, ma il round è chiuso lo stesso");
  expect(doc.data.punteggi.ALICE).toBeGreaterThan(0);

  // al secondo round a vuoto compare l'avviso discreto (non un blocco)
  await A.portaFaseRush(a.page, matchId, 1, "input");
  const r2 = await A.rispostaValida(a.page, { indice: 1 });
  await A.rispondi(a.page, r2.word);
  await A.portaAvanti(a.page, matchId, CICLO + INPUT + 900);
  await a.page.waitForFunction((i) => !!(((window.FAWRush.stato.data || {}).rush || {}).punteggiRound || {})[i], 1, { timeout: 25000 });
  await expect(a.page.locator("#chip-inattivi")).toBeVisible({ timeout: 15000 });
  await expect(a.page.locator("#chip-inattivi")).toContainText("CINZIA");
  await expect(c.page.locator("#schermo-gioco")).toBeVisible("la partita resta aperta anche a chi non gioca");

  await a.ctx.close(); await b.ctx.close(); await c.ctx.close(); await boot.ctx.close();
});

test("rush creativo: voto tra pari dopo la rivelazione, senza toccare la modalità classica", async ({ browser }) => {
  const { boot, matchId } = await creaSala(browser, ["ALICE", "BOB"], { mode: "creative" }, 120000);
  const a = await A.contesto(browser, "ALICE");
  const b = await A.contesto(browser, "BOB");
  await apriRush(a.page, matchId);
  await apriRush(b.page, matchId);
  await a.page.locator("#btn-pronto").click();
  await b.page.locator("#btn-pronto").click();
  await A.aspettaStato(a.page, matchId, ["pronto", "in_corso"]);
  await expect(a.page.locator("#schermo-gioco")).toBeVisible({ timeout: 25000 });

  // in creativa non c'è la lettera-obbligo: la domanda è libera
  expect(await a.page.locator("#round-lettera").textContent()).toBe("✳");
  await A.rispondi(a.page, "ho dimenticato il gatto nel forno");
  await A.rispondi(b.page, "mi si è rotta la lavastoviglie");

  // finestra di voto: si chiude il round solo dopo
  await a.page.waitForFunction(() => document.getElementById("box-voto") !== null, null, { timeout: 20000 });
  await expect(b.page.locator("#box-voto [data-voto]").first()).toBeVisible({ timeout: 20000 });
  await a.page.locator("#box-voto [data-voto]").first().click();
  await a.page.waitForFunction(() => {
    const d = window.FAWRush.stato.data || {};
    return !!(((d.rush || {}).voti || {})["0"] || {}).ALICE;
  }, null, { timeout: 20000 });

  // mentre si vota i punti non sono ancora assegnati
  const primaDiChiudere = await A.leggiDoc(a.page, matchId);
  expect(primaDiChiudere.data.rush.punteggiRound && primaDiChiudere.data.rush.punteggiRound[0]).toBeFalsy();

  await b.page.locator("#box-voto [data-voto]").first().click(); // ultimo voto: chiusura immediata
  await a.page.waitForFunction(() => {
    const d = window.FAWRush.stato.data || {};
    return !!(((d.rush || {}).punteggiRound || {})[0]);
  }, null, { timeout: 25000 });
  const doc = await A.leggiDoc(a.page, matchId);
  const punti = doc.data.rush.punteggiRound[0];
  const voti = doc.data.rush.voti["0"];
  expect(Object.keys(voti).sort()).toEqual(["ALICE", "BOB"], "un voto a testa");
  // con due giocatori il voto è reciproco: entrambi partecipazione + un premio
  const conta = (nome) => Object.keys(voti).filter((k) => voti[k].voto === nome).length;
  expect(punti.ALICE).toBe(40 + conta("ALICE") * 100);
  expect(punti.BOB).toBe(40 + conta("BOB") * 100);
  expect(punti.ALICE + punti.BOB).toBe(2 * 40 + 2 * 100);

  // e la modalità classica resta quella di default per le partite create dall'hub
  const classica = await creaSala(browser, ["ALICE", "BOB"], { mode: "classiche" }, 120000);
  const d = await A.leggiDoc(classica.boot.page, classica.matchId);
  expect(d.data.opzioni.mode).toBe("classiche");
  expect(d.data.rush, "nessun campo creativo in una partita classica").toBeUndefined();

  for (const p of [a.page, b.page]) expect(p.__errors || [], "console errors: " + (p.__errors || []).join(" | ")).toEqual([]);
  await a.ctx.close(); await b.ctx.close(); await boot.ctx.close(); await classica.boot.ctx.close();
});

test("rush: a 320px con tastiera l'input resta visibile e niente scroll orizzontale", async ({ browser }) => {
  const { ctx, page } = await A.contesto(browser, "ALICE", { viewport: { width: 320, height: 480 }, touch: true });
  await apriRush(page);
  await expect(page.locator("#schermo-crea")).toBeVisible();
  await page.locator("#btn-solo").click();
  await expect(page.locator("#schermo-gioco")).toBeVisible();
  await page.locator("#inp-risposta").tap();
  await page.waitForTimeout(400);
  const info = await page.evaluate(() => {
    const doc = document.documentElement;
    const r = document.getElementById("inp-risposta").getBoundingClientRect();
    const btn = document.getElementById("btn-invia").getBoundingClientRect();
    return {
      overflowX: doc.scrollWidth - doc.clientWidth,
      inputVisibile: r.top >= 0 && r.bottom <= window.innerHeight,
      inputAltezza: Math.round(r.height),
      btnLarghezza: Math.round(btn.width),
      btnAltezza: Math.round(btn.height),
      enterkeyhint: document.getElementById("inp-risposta").getAttribute("enterkeyhint"),
      domInMovimento: Math.round(doc.scrollHeight - window.innerHeight)
    };
  });
  expect(info.overflowX, "nessuno scroll orizzontale a 320px").toBeLessThanOrEqual(1);
  expect(info.inputVisibile, "la casella di risposta deve restare nello schermo").toBe(true);
  expect(info.inputAltezza).toBeGreaterThanOrEqual(40);
  expect(info.btnAltezza).toBeGreaterThanOrEqual(44);
  expect(info.enterkeyhint).toBe("send");
  await ctx.close();
});
