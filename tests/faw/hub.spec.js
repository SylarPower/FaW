/**
 * Hub (index.html) — test d'integrazione dei nuovi giochi sulla porta d'ingresso.
 *
 * Il Firebase del progetto non viene toccato: `window.firebase` è uno shim minimo
 * sopra il relay fake (`tests/support/faw-relay.js`), con le stesse semantics di
 * collection/doc/where/onSnapshot/FieldValue che usa l'hub. Serve a provare che
 * «crea sfida» dall'hub produce un documento che il gioco accetta davvero.
 */
"use strict";

const { test, expect } = require("@playwright/test");
const A = require("./aiuti");

/* Ogni test parte da uno store pulito: i giochi condividono `partite/*` e
   `presenze/*` nello stesso relay, e i residui alterano i tempi dei test. */
test.beforeEach(async () => { await A.resetRelay(); });

/** shim firebase → relay (stesso store usato dai giochi) */
function shimFirebase() {
  const W = window;
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  async function post(url, body) {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
    if (!r.ok) throw new Error("relay " + r.status);
    return r.json();
  }
  const get1 = (path) => post("/api/get", { paths: [path] }).then((r) => (r.docs || {})[path] || null);

  class DocSnap {
    constructor(id, data) { this.id = id; this._data = data || null; this.exists = !!data; }
    data() { return this._data; }
  }
  class QuerySnap {
    constructor(docs) { this.docs = docs; this.size = docs.length; this.empty = docs.length === 0; }
    forEach(fn) { this.docs.forEach(fn); }
  }
  class DocRef {
    constructor(path) { this.path = path; this.id = path.split("/").pop(); }
    get() { return get1(this.path).then((d) => new DocSnap(this.id, d && d.data)); }
    set(data) { return post("/api/write", { ops: [{ path: this.path, set: data }] }).then(() => ({})); }
    update(patch) { return post("/api/write", { ops: [{ path: this.path, patch: patch }] }).then(() => ({})); }
    delete() { return post("/api/write", { ops: [{ path: this.path, delete: true }] }).then(() => ({})); }
    onSnapshot(cb) { return aggiungiListener({ kind: "doc", path: this.path, cb: cb }); }
  }
  class ColRef {
    constructor(name, filters) { this.name = name; this.filters = filters || []; }
    where(field, op, value) {
      const map = { "==": "==", "!=": "!=", "in": "in", "array-contains": "array-contains", ">": ">", "<": "<", ">=": ">", "<=": "<" };
      return new ColRef(this.name, this.filters.concat([{ field: field, op: map[op] || "==", value: value }]));
    }
    orderBy(field, dir) { const c = new ColRef(this.name, this.filters); c.order = { field: field, dir: dir || "asc" }; return c; }
    limit(n) { const c = new ColRef(this.name, this.filters); c.limit = n; c.order = this.order; return c; }
    doc(id) { return new DocRef(this.name + "/" + (id || newId())); }
    add(data) { const id = newId(); return this.doc(id).set(data).then(() => ({ id: id })); }
    get() { return post("/api/query", { col: this.name, filters: this.filters, orderBy: this.order, limit: this.limit }).then((r) => new QuerySnap((r.docs || []).map((d) => new DocSnap(d.id, d.data)))); }
    onSnapshot(cb) { return aggiungiListener({ kind: "col", name: this.name, filters: this.filters, order: this.order, limit: this.limit, cb: cb }); }
  }
  const listeners = new Set();
  function aggiungiListener(l) {
    l.vkey = null;
    listeners.add(l);
    const t = setInterval(() => scarica(l), 300);
    l.stop = () => { clearInterval(t); listeners.delete(l); };
    scarica(l);
    return l.stop;
  }
  async function scarica(l) {
    try {
      if (l.kind === "doc") {
        const d = await get1(l.path);
        const vkey = (d ? d.version : -1) + "";
        if (l.vkey === vkey) return;
        l.vkey = vkey;
        try { l.cb(new DocSnap(l.path.split("/").pop(), d && d.data)); }
        catch (e) { (W.__shimErrors = W.__shimErrors || []).push("doc:" + l.path + " " + String(e && e.message)); }
      } else {
        const r = await post("/api/query", { col: l.name, filters: l.filters, orderBy: l.order, limit: l.limit });
        const docs = r.docs || [];
        const vkey = docs.map((d) => d.id + ":" + d.version).join(",");
        if (l.vkey === vkey) return;
        l.vkey = vkey;
        try { l.cb(new QuerySnap(docs.map((d) => new DocSnap(d.id, d.data)))); }
        catch (e) { (W.__shimErrors = W.__shimErrors || []).push("col:" + l.name + " " + String(e && e.message)); }
      }
    } catch (e) { /* relay giù: il prossimo giro riprova */ (W.__shimErrors = W.__shimErrors || []).push("rete:" + String(e && e.message)); }
  }
  function db() {
    return {
      collection: (name) => new ColRef(name),
      batch: () => ({ set: () => {}, update: () => {}, delete: () => {}, commit: () => Promise.resolve() }),
      runTransaction: (fn) => Promise.resolve()
    };
  }
  const fs = function () { return db(); };
  fs.FieldValue = {
    arrayUnion: (v) => ({ __op: "arrayUnion", value: v }),
    arrayRemove: (v) => ({ __op: "arrayRemove", value: v }),
    increment: (v) => ({ __op: "increment", value: v }),
    delete: () => ({ __op: "delete" })
  };
  fs.serverTimestamp = () => Date.now();
  W.firebase = {
    initializeApp: () => ({}),
    firestore: fs,
    appCheck: () => ({ activate: () => {}, setTokenAutoRefreshEnabled: () => {} }),
    auth: () => ({ signInAnonymously: () => Promise.resolve({ user: { uid: "shim" } }), onAuthStateChanged: () => () => {} })
  };
}

async function hub(browser, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({
    viewport: opts.viewport || { width: 390, height: 844 },
    hasTouch: !!opts.touch, isMobile: !!opts.touch
  });
  await ctx.addInitScript(shimFirebase);
  await ctx.addInitScript((n) => {
    window.localStorage.setItem("faw:net:backend", "fake");
    window.localStorage.setItem("faw:net:relayUrl", window.location.origin);
    window.localStorage.setItem("mioNome", n);
    window.localStorage.setItem("passwordHash", "shim-shim-shim");
  }, opts.nome || "ALICE");
  const page = await ctx.newPage();
  page.__errors = [];
  page.on("pageerror", (e) => { page.__errors.push(String(e && e.message)); });
  await page.goto("index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.firebase && typeof GIOCHI_CONFIG !== "undefined", null, { timeout: 20000 });
  await page.waitForLoadState("load").catch(() => {});
  return { ctx, page };
}

test("hub: i tre giochi sono configurati e raggiungibili", async ({ browser }) => {
  const { ctx, page } = await hub(browser);
  const cfg = await page.evaluate(() => ({
    paths: GAME_PATHS,
    arena: { min: GIOCHI_CONFIG["parole-arena"].minGiocatori, max: GIOCHI_CONFIG["parole-arena"].maxGiocatori, faw: !!GIOCHI_CONFIG["parole-arena"].faw, mode: GIOCHI_CONFIG["parole-arena"].modalita.map((m) => m.id), opt: GIOCHI_CONFIG["parole-arena"].opzioni.map((o) => o.id) },
    rush: { mode: GIOCHI_CONFIG["categoria-rush"].modalita.map((m) => m.id), opt: GIOCHI_CONFIG["categoria-rush"].opzioni.map((o) => o.id), max: GIOCHI_CONFIG["categoria-rush"].maxGiocatori },
    bomba: { mode: GIOCHI_CONFIG["bomba-parole"].modalita.map((m) => m.id), opt: GIOCHI_CONFIG["bomba-parole"].opzioni.map((o) => o.id), min: GIOCHI_CONFIG["bomba-parole"].minGiocatori },
    gameof15: GIOCHI_CONFIG.gameof15.modalita.map((m) => m.id),
    href: { a: gameHref("parole-arena", "matchId=XX"), b: gameHref("bomba-parole"), g: gameHref("palestra") },
    nome: nomeGioco("bomba-parole")
  }));
  expect(cfg.paths["parole-arena"]).toBe("games/parole-arena/index.html");
  expect(cfg.paths["categoria-rush"]).toBe("games/categoria-rush/index.html");
  expect(cfg.paths["bomba-parole"]).toBe("games/bomba-parole/index.html");
  expect(cfg.arena).toMatchObject({ min: 2, max: 6, faw: true });
  expect(cfg.arena.mode).toEqual(["arena", "solo-parole"]);
  expect(cfg.arena.opt).toEqual(["durata", "griglia"]);
  expect(cfg.rush.mode).toEqual(["classiche", "creative"]);
  expect(cfg.rush.max).toBe(8);
  expect(cfg.bomba.opt).toEqual(["durata", "miccia"]);
  // nessuna modalità inventata: Bomba ha una sola modalità, e gameof15 non offre «emoji»
  expect(cfg.bomba.mode).toEqual([""]);
  expect(cfg.gameof15).toEqual(["numbers", "image"]);
  expect(cfg.href.a).toBe("games/parole-arena/index.html?matchId=XX");
  expect(cfg.href.b).toBe("games/bomba-parole/index.html");
  expect(cfg.href.g, "palestra: percorso intatto").toBe("games/palestra/index.html");
  expect(cfg.nome).toBe("La Bomba delle Parole");

  await expect(page.locator("#game-parole-arena")).toBeVisible();
  await expect(page.locator("#game-categoria-rush")).toBeVisible();
  await expect(page.locator("#game-bomba-parole")).toBeVisible();
  await page.click("#game-bomba-parole");
  expect(await page.evaluate(() => giocoSelezionato)).toBe("bomba-parole");
  // la finestra delle sfide esiste anche per il nuovo gioco (stessa UI degli altri)
  await page.evaluate(() => apriModalSfida());
  const banner = page.locator("#game-banner");
  await expect(banner).toBeVisible();
  await expect(banner.locator("select")).toHaveCount(2);
  await expect(banner.locator("select").nth(1)).toContainText("Media");
  await expect(banner.locator(".btn-banner").first()).toContainText("CREA SFIDA");
  await page.evaluate(() => chiudiBannerSfida());
  expect(page.__errors, "errori di pagina: " + JSON.stringify(page.__errors)).toEqual([]);
  await ctx.close();
});

test("hub: «crea sfida» scrive un documento che il gioco apre davvero", async ({ browser }) => {
  const { ctx, page } = await hub(browser);
  await page.evaluate(() => {
    selezionaGioco("bomba-parole", document.getElementById("game-bomba-parole"));
    amiciSelezionati.add("BOB");
  });
  // flusso reale: finestra della sfida → opzioni → pulsante modalità
  await page.evaluate(() => apriModalSfida());
  await page.selectOption("#opt-durata-banner", "120");
  await page.selectOption("#opt-miccia-banner", "dura");
  await page.locator("#game-banner .btn-banner").first().click();
  await page.waitForFunction(() => {
    const b = document.getElementById("game-banner");
    return !!b && /Sfida creata/.test(b.textContent);
  }, null, { timeout: 20000 });
  const docs = await page.evaluate(async () => {
    const r = await fetch("/api/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ col: "partite", filters: [{ field: "gioco", op: "==", value: "bomba-parole" }] }) });
    const j = await r.json();
    return j.docs.map((d) => ({ id: d.id, data: d.data }));
  });
  // il relay conserva le partite dei test precedenti: si prende l'ultima creata
  docs.sort((a, b) => (b.data.createdAt || 0) - (a.data.createdAt || 0));
  expect(docs.length).toBeGreaterThanOrEqual(1);
  const doc = docs[0].data;
  expect(doc.stato).toBe("attesa");
  expect(doc.partecipanti).toEqual(["ALICE", "BOB"]);
  expect(doc.punteggi.ALICE).toBe(0);
  expect(doc.giocatori.ALICE.visto).toBeGreaterThan(0);
  expect(doc.durata).toBe(120000, "la durata scelta nel banner arriva al documento");
  expect(doc.maxGiocatori).toBe(6);
  expect(doc.seed).toBeTruthy();
  expect(doc.host).toBe("ALICE");
  expect(doc.creator).toBe("ALICE");
  expect(doc.claim).toBeTruthy();
  expect(doc.opzioni.miccia).toBe("dura");
  expect(doc.opzioni.mode, "modalità vuota non scritta").toBeUndefined();
  expect(doc.sfidaDiretta).toBe(true);

  // e il gioco lo accetta: lobby con la stessa lista giocatori
  const nuovaId = docs[0].id;
  await page.goto("games/bomba-parole/index.html?matchId=" + nuovaId, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.FAWBomba && window.FAWBomba.stato.data, null, { timeout: 30000 });
  const inSala = await page.evaluate(() => ({
    me: window.FAWBomba.stato.me,
    data: window.FAWBomba.stato.data.partecipanti,
    diff: window.FAWBomba.stato.diff
  }));
  expect(inSala.data).toEqual(["ALICE", "BOB"]);
  expect(inSala.diff, "il gioco eredita la difficoltà scelta dall'hub").toBe("dura");
  await expect(page.locator("#lobby-lista")).toContainText("ALICE");
  await expect(page.locator("#lobby-lista")).toContainText("BOB");
  await expect(page.locator("#schermo-lobby")).toBeVisible();
  expect(page.__errors, "errori di pagina: " + JSON.stringify(page.__errors)).toEqual([]);
  await ctx.close();
});

test("hub: la lista partite distingue i giochi shared-room (stato + link)", async ({ browser }) => {
  const { ctx, page } = await hub(browser);
  await page.evaluate(async () => {
    const base = {
      gioco: "categoria-rush", stato: "attesa", creator: "ALICE", host: "ALICE",
      partecipanti: ["ALICE", "BOB"], giocatori: { ALICE: { nome: "ALICE", visto: Date.now() }, BOB: { nome: "BOB", visto: Date.now() } },
      punteggi: { ALICE: 0, BOB: 0 }, pronti: ["ALICE"], opzioni: { mode: "classiche", durata: "120" }, claim: {}, round: 0,
      durata: 120000, seed: "SEEDHUB", createdAt: Date.now(), timestamp: Date.now(), log: [], rivincitaAccettataDa: [], rivincitaRifiutataDa: []
    };
    await firebase.firestore().collection("partite").add(base);
  });
  await page.waitForFunction(() => (typeof partiteCache !== "undefined" && (partiteCache["categoria-rush"] || []).length > 0) || (window.__shimErrors || []).length > 0, null, { timeout: 15000 })
    .catch(() => { throw new Error("il listener dell'hub non ha visto la partita: " + JSON.stringify({ bucket: Object.keys(partiteCache).map((k) => k + ":" + partiteCache[k].length), shim: window.__shimErrors || [] })); });
  await expect(page.locator("#lista-partite")).toContainText("Categoria Rush", { timeout: 15000 });
  const riga = page.locator("#lista-partite .user-item", { hasText: "Categoria Rush" }).first();
  await expect(riga).toContainText("in attesa (1/2)");
  await expect(riga).toContainText("vs BOB");
  const href = await riga.locator("button").first().evaluate((b) => b.getAttribute("onclick"));
  expect(href).toContain("games/categoria-rush/index.html?matchId=");
  expect(await page.evaluate(() => window.__shimErrors || []), "errori nello shim firebase").toEqual([]);
  expect(href, "niente nomi interni in faccia all'utente").not.toContain("categoria-rush/index.html?matchId=undefined");
  expect(page.__errors, "errori di pagina: " + JSON.stringify(page.__errors)).toEqual([]);
  await ctx.close();
});

test("hub: logout tiene i salvataggi, cancella la sessione", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(shimFirebase);
  await ctx.addInitScript(() => {
    // una sola volta per tab: dopo il logout la pagina si ricarica e non deve
    // ritrovare la sessione reinstallata dall'init script
    if (sessionStorage.getItem("__seeded")) return;
    sessionStorage.setItem("__seeded", "1");
    const sal = {
      "gym-programma": "palestra", "gym-cache-esercizi": "[]", "paroliere_data": "{}",
      "gameof15_save": "{}", "df_legends_save": "{}", "funatwork_daily_stats": "{}",
      "ultimo_ruzzle_tempo": "60", "mioNome": "ALICE", "passwordHash": "abc",
      "faw:net:backend": "fake", "faw:ui:theme": "light", "sessioneCorrente": "1"
    };
    Object.keys(sal).forEach((k) => localStorage.setItem(k, sal[k]));
  });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on("pageerror", (e) => { page.__errors.push(String(e && e.message)); });
  await page.goto("index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.firebase && typeof logout === "function", null, { timeout: 20000 });
  await page.evaluate(() => setTimeout(() => logout(), 10));   // la pagina si ricarica: niente evaluate in corso
  await page.waitForLoadState("load").catch(() => {});
  await page.waitForTimeout(400);
  const dopo = await page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); out[k] = localStorage.getItem(k); }
    return out;
  });
  for (const k of ["gym-programma", "gym-cache-esercizi", "paroliere_data", "gameof15_save", "df_legends_save", "funatwork_daily_stats", "ultimo_ruzzle_tempo"]) {
    expect(dopo, k + " non deve sparire con il logout").toHaveProperty(k);
  }
  expect(dopo.mioNome, "la sessione deve sparire").toBeUndefined();
  expect(dopo.passwordHash).toBeUndefined();
  expect(dopo["faw:net:backend"]).toBeUndefined();
  await ctx.close();
});

test("hub: tab statistiche senza fare affidamento su `event` globale", async ({ browser }) => {
  const { ctx, page } = await hub(browser);
  const tabs = page.locator(".stats-tab");
  expect(await tabs.count()).toBeGreaterThanOrEqual(3);
  await tabs.nth(1).click();
  expect(await tabs.nth(1).evaluate((n) => n.classList.contains("active"))).toBe(true);
  expect(await tabs.nth(0).evaluate((n) => n.classList.contains("active"))).toBe(false);
  await tabs.nth(2).click();
  expect(await tabs.nth(2).evaluate((n) => n.classList.contains("active"))).toBe(true);
  expect(await page.evaluate(() => document.getElementById("stats-sempre").style.display)).toBe("block");
  // e le statistiche dei giochi nuevosi registrano con lo stesso shape (storico hub)
  await page.evaluate(() => aggiornaStatsUI());
  expect(page.__errors, "errori di pagina: " + JSON.stringify(page.__errors)).toEqual([]);
  await ctx.close();
});
