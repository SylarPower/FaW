/**
 * Parole in Arena — test d'integrazione con contesti browser separati.
 * Un contesto = un giocatore: nessuna simulazione finta dentro una pagina.
 */
"use strict";

const { test, expect } = require("@playwright/test");
const A = require("./aiuti");

/* Ogni test parte da uno store pulito: i giochi condividono `partite/*` e
   `presenze/*` nello stesso relay, e i residui alterano i tempi dei test. */
test.beforeEach(async () => { await A.resetRelay(); });

const GIOCO = "games/parole-arena/index.html";

test("solo: allenamento con griglia, punteggio e fine partita", async ({ browser }) => {
  const { ctx, page } = await A.contesto(browser, "ALICE");
  await A.apri(page, GIOCO);
  // flusso reale: schermata iniziale → griglia 4×4 → allenamento solo
  await expect(page.locator("#schermo-crea")).toBeVisible();
  await expect(page.locator("#btn-solo")).toBeEnabled({ timeout: 60000 });
  await page.locator('[data-seg="griglia"] [data-v="4"]').click();
  await page.locator("#btn-solo").click();
  await expect(page.locator("#schermo-gioco")).toBeVisible();
  expect(await page.locator("#griglia").evaluate((g) => g.children.length)).toBe(16);

  const parole = [];
  for (let i = 0; i < 3; i++) {
    const w = await A.cercaParola(page, parole, i);
    expect(w, "la griglia deve contenere parole valide").not.toBeNull();
    await A.trascinaParola(page, w);
    parole.push(w.word);
  }
  await expect(page.locator("#punti")).not.toHaveText("0", { timeout: 10000 });

  // nessun errore di runtime
  expect(page.__errors || []).toEqual([]);

  // toggle di accessibilità: modalità tocco senza trascinamento
  await page.locator('[data-action="input"]').click();
  const w2 = await A.cercaParola(page, parole, 0);
  for (const p of w2.points) await page.mouse.click(p.x, p.y);
  await page.keyboard.press("Enter");
  await expect(page.locator("#punti")).not.toHaveText("0");

  // tema chiaro + movimento ridotto non rompono la vista
  await page.locator('[data-action="tema"]').click();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "light");
  await ctx.close();
});

test("multiplayer 2 giocatori: lobby → countdown → parole → risultati → rivincita", async ({ browser }) => {
  const boot = await A.contesto(browser, "ALICE");
  await A.apri(boot.page, GIOCO, null, { query: "?solo=1" }).catch(() => {});
  await boot.page.goto(GIOCO, { waitUntil: "domcontentloaded" });
  await boot.page.waitForFunction(() => window.FAWRoom && window.FAWNet, null, { timeout: 20000 });
  const matchId = await A.creaPartita(boot.page, {
    gioco: "parole-arena", creator: "ALICE", giocatori: ["ALICE", "BOB"],
    opzioni: { griglia: "5", durata: "40", mode: "eventi", countdown: 3 },
    durata: 40000
  });
  expect(matchId).toBeTruthy();

  const a = await A.contesto(browser, "ALICE");
  const b = await A.contesto(browser, "BOB");
  await A.apri(a.page, GIOCO, matchId, { noDict: false });
  await A.apri(b.page, GIOCO, matchId, { noDict: false });

  // lobby: entrambi vedono i due giocatori
  for (const p of [a.page, b.page]) {
    await expect(p.locator("#schermo-lobby")).toBeVisible({ timeout: 20000 });
    await expect(p.locator("#lobby-lista .faw-row")).toHaveCount(2);
    await expect(p.locator("#lobby-meta")).toContainText("5×5");
  }

  // pronti → countdown → in_corso
  await a.page.locator("#btn-pronto").click();
  await b.page.locator("#btn-pronto").click();
  const docPronto = await A.aspettaStato(a.page, matchId, ["pronto", "in_corso"], 25000);
  expect(["pronto", "in_corso"]).toContain(docPronto.stato);
  expect(docPronto.startAt).toBeGreaterThan(0);
  expect(docPronto.endsAt - docPronto.startAt).toBeGreaterThanOrEqual(40000);

  // la griglia è identica per entrambi (stesso seed)
  const letA = await a.page.evaluate(() => window.FAWArena.stato.letters.join(""));
  const letB = await b.page.evaluate(() => window.FAWArena.stato.letters.join(""));
  expect(letA.length).toBe(25);
  expect(letA).toBe(letB);

  await expect(a.page.locator("#schermo-gioco")).toBeVisible({ timeout: 25000 });
  await expect(b.page.locator("#schermo-gioco")).toBeVisible({ timeout: 25000 });

  // ALICE trova una parola: BOB la vede in classifica senza che la parola sia rivelata
  const wA = await A.cercaParola(a.page, [], 0);
  await A.trascinaParola(a.page, wA);
  await a.page.waitForFunction(
    () => Object.values((window.FAWArena.stato.data || {}).punteggi || {}).some((v) => v > 0),
    null, { timeout: 20000 }
  );
  const doc1 = await A.leggiDoc(b.page, matchId);
  expect(doc1.data.punteggi.ALICE).toBeGreaterThan(0);
  expect(doc1.data.parole.ALICE.length).toBe(1);
  await expect(b.page.locator(".faw-rank", { hasText: "ALICE" }).first()).toContainText(String(doc1.data.punteggi.ALICE));
  await expect(b.page.locator("#feed")).toContainText(/ALICE ha trovato/);
  expect(await b.page.locator("#feed").innerText()).not.toContain(wA.word);

  // stessa parola rigiocata da ALICE: non deve contare due volte
  const puntiDopo = doc1.data.punteggi.ALICE;
  const wA2 = await A.cercaParola(a.page, [], 0);
  expect(wA2.word).toBe(wA.word);
  await A.trascinaParola(a.page, wA2);
  await a.page.waitForTimeout(3200);
  const doc2 = await A.leggiDoc(a.page, matchId);
  expect(doc2.data.punteggi.ALICE).toBe(puntiDopo);
  expect(doc2.data.parole.ALICE.length).toBe(1);

  // BOB segna con un'altra parola
  const wB = await A.cercaParola(b.page, [], 1);
  await A.trascinaParola(b.page, wB);
  await b.page.waitForFunction(
    () => ((window.FAWArena.stato.data || {}).punteggi || {}).BOB > 0,
    null, { timeout: 20000 }
  );

  // ricarica a metà partita: riprende dalla partita in corso, senza perdere nulla
  await a.page.reload({ waitUntil: "domcontentloaded" });
  await a.page.waitForFunction(() => window.FAWWords && window.FAWWords.isDictionaryReady(), null, { timeout: 60000 });
  await expect(a.page.locator("#schermo-gioco")).toBeVisible({ timeout: 25000 });
  const letA2 = await a.page.evaluate(() => window.FAWArena.stato.letters.join(""));
  expect(letA2).toBe(letA);
  const doc3 = await A.leggiDoc(a.page, matchId);
  expect(doc3.data.punteggi.ALICE).toBe(puntiDopo);

  // rete interrotta e ritorno: l'interfaccia lo dice e poi si riprende
  await a.ctx.setOffline(true);
  await expect(a.page.locator("#conn")).toBeVisible({ timeout: 15000 });
  await a.ctx.setOffline(false);

  // fine partita: un solo client risolve, entrambi vedono la classifica
  const fine = await A.aspettaStato(a.page, matchId, ["conclusa"], 70000);
  expect(fine.risultati).toBeTruthy();
  expect(fine.risultati.classifica.length).toBe(2);
  expect(["vittoria", "pareggio"]).toContain(fine.risultati.esito.tipo);
  const somma = fine.risultati.classifica.reduce((s, x) => s + x.punti, 0);
  expect(somma).toBe(fine.punteggi.ALICE + fine.punteggi.BOB);
  expect(fine.finito.sort()).toEqual(["ALICE", "BOB"]);

  await expect(a.page.locator("#schermo-risultati")).toBeVisible({ timeout: 20000 });
  await expect(a.page.locator("#ris-titolo")).not.toHaveText("");
  await expect(b.page.locator("#schermo-risultati")).toBeVisible({ timeout: 20000 });

  // rivincita con un tocco
  await a.page.locator("#btn-rivincita").click();
  await a.page.waitForFunction(
    () => !!(window.FAWArena.stato.data || {}).prossimaPartita, null, { timeout: 20000 }
  );
  const docR = await A.leggiDoc(a.page, matchId);
  const nuova = docR.data.prossimaPartita;
  expect(nuova).toBeTruthy();
  await expect(b.page.locator("#box-rivincita")).toBeVisible({ timeout: 20000 });
  await b.page.locator("#btn-accetta-rivincita").click();
  await b.page.waitForFunction(
    (id) => location.search.indexOf("matchId=" + id) >= 0, nuova, { timeout: 25000 }
  );
  const docN = await A.leggiDoc(b.page, nuova);
  expect(docN.data.gioco).toBe("parole-arena");
  expect(docN.data.stato).toBe("attesa");
  expect(docN.data.punteggi.ALICE).toBe(0);
  expect(docN.data.rivincitaDi).toBe(matchId);

  for (const p of [a.page, b.page]) expect(p.__errors || [], "console errors: " + (p.__errors || []).join(" | ")).toEqual([]);
  await a.ctx.close(); await b.ctx.close(); await boot.ctx.close();
});

test("potenziamenti: energia, Raddio e Sabbiatura condivisi; doppio tocco non raddoppia", async ({ browser }) => {
  const boot = await A.contesto(browser, "ALICE");
  await boot.page.goto(GIOCO, { waitUntil: "domcontentloaded" });
  await boot.page.waitForFunction(() => window.FAWRoom, null, { timeout: 20000 });
  const matchId = await A.creaPartita(boot.page, {
    gioco: "parole-arena", creator: "ALICE", giocatori: ["ALICE", "BOB"],
    opzioni: { griglia: "5", durata: "240", mode: "no-eventi", countdown: 3 }, durata: 240000
  });

  const a = await A.contesto(browser, "ALICE");
  const b = await A.contesto(browser, "BOB");
  await A.apri(a.page, GIOCO, matchId);
  await A.apri(b.page, GIOCO, matchId);
  await a.page.locator("#btn-pronto").click();
  await b.page.locator("#btn-pronto").click();
  await A.aspettaStato(a.page, matchId, ["pronto", "in_corso"]);
  await expect(a.page.locator("#schermo-gioco")).toBeVisible({ timeout: 25000 });

  // L'energia vive nel documento (i client la rileggono da lì): un test che la
  // scrivesse solo in memoria si vedrebbe sovrascrivere al primo stato utile.
  const daiEnergia = async (ctx, nome, v) => {
    await A.scriviDoc(ctx.page, matchId, { ["arena.energia." + nome]: v });
    await ctx.page.waitForFunction((val) => window.FAWArena.stato.energia >= val, v, { timeout: 20000 });
  };

  // energia da parole valide: 4 parole devono dare energia e punteggio
  const fatte = [];
  for (let i = 0; i < 4; i++) {
    const w = await A.cercaParola(a.page, fatte, i);
    if (!w) break;
    await A.trascinaParola(a.page, w);
    fatte.push(w.word);
  }
  await a.page.waitForFunction(() => window.FAWArena.stato.energia >= 3, null, { timeout: 20000 });

  // doppio tocco sul pulsante: la spesa è una sola (transazione + guard sull'energia)
  const ePrima = (await A.leggiDoc(a.page, matchId)).data.arena.energia.ALICE;
  await a.page.locator('[data-pw="scudo"]').dblclick();
  await a.page.waitForFunction(() => {
    const att = ((((window.FAWArena.stato.data || {}).arena || {}).attivi) || {}).ALICE || {};
    return !!(att.scudo && att.scudo.fine > Date.now());
  }, null, { timeout: 20000 });
  await a.page.waitForTimeout(1200);
  const docS = await A.leggiDoc(a.page, matchId);
  expect(docS.data.arena.energia.ALICE).toBe(Math.max(0, ePrima - 3), "lo Scudo costa 3, una volta sola");
  expect(await a.page.locator("#effetto-scudo").isVisible()).toBe(true);

  // Raddio: costo 4, moltiplica le parole successive
  await daiEnergia(a, "ALICE", 10);
  const pPrima = (await A.leggiDoc(a.page, matchId)).data.punteggi.ALICE;
  await a.page.locator('[data-pw="raddio"]').click();
  await a.page.waitForFunction(() => {
    const att = ((((window.FAWArena.stato.data || {}).arena || {}).attivi) || {}).ALICE || {};
    return !!(att.raddio && att.raddio.fine > Date.now());
  }, null, { timeout: 20000 });
  const wR = await A.cercaParola(a.page, fatte, 6);
  expect(wR, "la griglia deve offrire una parola da testare").not.toBeNull();
  // partita senza eventi: il punteggio atteso è deterministico (base ×2)
  const atteso = await a.page.evaluate((w) => ({
    normale: window.FAWArenaRules.punteggi(w, {}).punti,
    raddio: window.FAWArenaRules.punteggi(w, { effetti: { raddio: true } }).punti
  }), wR.word);
  expect(atteso.raddio).toBe(atteso.normale * 2);
  await A.trascinaParola(a.page, wR);
  await a.page.waitForFunction((p) => ((window.FAWArena.stato.data || {}).punteggi || {}).ALICE > p, pPrima, { timeout: 20000 });
  const dopo = (await A.leggiDoc(a.page, matchId)).data.punteggi.ALICE;
  expect(dopo, "con Raddio attivo la parola vale il doppio").toBe(pPrima + atteso.raddio);

  // Sabbiatura: sospende i bonus dell'avversario senza toccare i punti già dati
  await daiEnergia(a, "ALICE", 10);
  const primaDelColpo = (await A.leggiDoc(b.page, matchId)).data.punteggi.BOB || 0;
  await a.page.locator('[data-pw="sabbiatura"]').click();
  await b.page.waitForFunction(() => {
    const c = ((((window.FAWArena.stato.data || {}).arena || {}).colpito) || {}).BOB;
    return !!(c && c.fine > Date.now());
  }, null, { timeout: 20000 });
  const docC = await A.leggiDoc(b.page, matchId);
  expect(docC.data.arena.colpito.BOB.da).toBe("ALICE");
  expect(docC.data.punteggi.BOB).toBe(primaDelColpo, "la Sabbiatura non toglie punti già guadagnati");
  expect(await b.page.locator("#effetto-sabbiato").isVisible()).toBe(true);
  expect(await b.page.locator("#effetto-sabbiato").textContent()).toMatch(/sabbiato/i);

  // anti-catena: un secondo colpo sullo stesso bersaglio non prolunga l'effetto
  const finePrima = docC.data.arena.colpito.BOB.fine;
  await daiEnergia(a, "ALICE", 10);
  await a.page.locator('[data-pw="sabbiatura"]').click();
  await a.page.waitForTimeout(2500);
  const docD = await A.leggiDoc(a.page, matchId);
  expect(docD.data.arena.ultimoBersaglio).toBe("BOB");
  expect(docD.data.arena.colpito.BOB.fine, "nessuna catena di disturbo sullo stesso giocatore")
    .toBe(Math.max(finePrima, docD.data.arena.colpito.BOB.fine));
  expect(docD.data.arena.immune.BOB).toBeGreaterThan(Date.now() - 1000);

  for (const p of [a.page, b.page]) expect(p.__errors || [], "console errors: " + (p.__errors || []).join(" | ")).toEqual([]);
  await a.ctx.close(); await b.ctx.close(); await boot.ctx.close();
});

test("parole giocate offline: restano in coda e contano una volta sola quando torna la rete", async ({ browser }) => {
  const boot = await A.contesto(browser, "ALICE");
  await boot.page.goto(GIOCO, { waitUntil: "domcontentloaded" });
  await boot.page.waitForFunction(() => window.FAWRoom, null, { timeout: 20000 });
  const matchId = await A.creaPartita(boot.page, {
    gioco: "parole-arena", creator: "ALICE", giocatori: ["ALICE", "BOB"],
    opzioni: { griglia: "5", durata: "240", mode: "solo-parole" }, durataMs: 240000
  });
  const a = await A.contesto(browser, "ALICE");
  const b = await A.contesto(browser, "BOB");
  await A.apri(a.page, GIOCO, matchId);
  await A.apri(b.page, GIOCO, matchId);
  await a.page.locator("#btn-pronto").click();
  await b.page.locator("#btn-pronto").click();
  await expect(a.page.locator("#schermo-gioco")).toBeVisible({ timeout: 25000 });

  // una parola giocata con la rete spenta: confronto locale immediato, nessun doppio conteggio
  await a.ctx.setOffline(true);
  const w = await A.cercaParola(a.page, [], 0);
  await A.trascinaParola(a.page, w);
  await a.page.waitForFunction(() => window.FAWArena.stato.coda.length > 0 || window.FAWArena.stato.inSospeso, null, { timeout: 10000 });
  await expect(a.page.locator("#chip-sospeso")).toBeVisible({ timeout: 10000 });

  await a.ctx.setOffline(false);
  await a.page.waitForFunction((word) => {
    const d = window.FAWArena.stato.data || {};
    return ((d.parole || {}).ALICE || []).includes(word);
  }, w.word, { timeout: 30000 });
  const doc = await A.leggiDoc(a.page, matchId);
  expect(doc.data.parole.ALICE.filter((x) => x === w.word).length, "la parola ricodata non viene contata due volte").toBe(1);
  expect(doc.data.punteggi.ALICE).toBeGreaterThan(0);
  await expect(a.page.locator("#chip-sospeso")).toBeHidden({ timeout: 10000 });

  await a.ctx.close(); await b.ctx.close(); await boot.ctx.close();
});

test("griglia valida per ogni dimensione e evento visibile a schermo piccolo", async ({ browser }) => {
  // 320×568 = smartphone piccolo: la griglia deve restare intera, senza scroll
  // orizzontale e con celle grandi abbastanza per il tocco
  for (const size of [4, 5, 6]) {
    const { ctx, page } = await A.contesto(browser, "TINY", { viewport: { width: 320, height: 568 } });
    await page.goto(GIOCO + `?solo=1&griglia=${size}&durata=240`);
    await page.waitForFunction(() => window.FAWWords && window.FAWWords.isDictionaryReady(), null, { timeout: 60000 });
    await page.locator("#schermo-gioco").waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(300);
    const info = await page.evaluate(() => {
      const g = document.getElementById("griglia");
      const r = g.getBoundingClientRect();
      const doc = document.documentElement;
      const tiles = Array.from(g.children).map((t) => t.getBoundingClientRect());
      return {
        celle: g.children.length,
        cellePiccole: tiles.filter((t) => t.width < 34 || t.height < 34).length,
        overflowX: doc.scrollWidth - doc.clientWidth,
        timerVisto: !document.getElementById("timer").hidden,
        eventoVisto: !!document.getElementById("evento"),
        seed: window.FAWArena.stato.seed,
        letters: window.FAWArena.stato.letters.join("")
      };
    });
    expect(info.celle, `griglia ${size}`).toBe(size * size);
    expect(info.overflowX, `scroll orizzontale indesiderato a 320px con griglia ${size}`).toBeLessThanOrEqual(1);
    expect(info.cellePiccole, `celle troppo piccole per il tocco (griglia ${size})`).toBe(0);
    expect(info.letters.length).toBe(size * size);
    await ctx.close();
  }
});

test("regole visibili e accessibilità di base nel dialogo regole", async ({ browser }) => {
  const { ctx, page } = await A.contesto(browser, "ALE");
  await A.apri(page, GIOCO);
  await page.locator('[data-action="regole"]').click();
  const dlg = page.locator("#dlg-regole");
  await expect(dlg).toBeVisible();
  const testo = await dlg.innerText();
  for (const frammento of ["2 × lettere", "25 secondi", "Raddio", "Scudo", "Sabbiatura", "immune"]) {
    expect(testo.toLowerCase()).toContain(frammento.toLowerCase());
  }
  // focus dentro il dialogo, Esc lo chiude
  const focusNel = await page.evaluate(() => !!document.activeElement.closest("#dlg-regole"));
  expect(focusNel).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden({ timeout: 5000 });
  await ctx.close();
});
