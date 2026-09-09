/**
 * Helper comuni per i test multiplayer: contesti separati, backend fake,
 * scoperta delle parole dalla griglia reale del gioco.
 */
"use strict";
const { test } = require("@playwright/test");

/** Crea un contesto browser isolato (→ un "giocatore" indipendente). */
async function contesto(browser, nome, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({
    viewport: opts.viewport || test.info().project.use.viewport || { width: 390, height: 844 },
    hasTouch: !!opts.touch,
    isMobile: !!opts.touch,
    reducedMotion: opts.reducedMotion ? "reduce" : "no-preference",
    offline: !!opts.offline
  });
  await ctx.route(/https:\/\/(www\.gstatic\.com|fonts\.)/, route => route.abort());
  await ctx.addInitScript((n) => {
    if (location.origin === "null") return; // about:blank non ha uno storage accessibile
    window.localStorage.setItem("faw:net:backend", "fake");
    window.localStorage.setItem("faw:net:relayUrl", window.location.origin);
    window.localStorage.setItem("mioNome", n);
  }, nome);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => {
    page.__errors = (page.__errors || []).concat(String(e && e.message));
  });
  return { ctx, page };
}

/** Apre un gioco (con o senza matchId) e aspetta che il dizionario sia pronto. */
async function apri(page, path, matchId, opts) {
  opts = opts || {};
  const url = path + (matchId ? "?matchId=" + matchId : "") + (opts.query || "");
  await page.goto(url, { waitUntil: "domcontentloaded" });
  if (opts.noDict !== true) {
    await page.waitForFunction(() => window.FAWWords && window.FAWWords.isDictionaryReady(), null, { timeout: 60000 });
  }
  return page;
}

/** Crea una partita vera (documento `partite/...`) con il codice del portale. */
async function creaPartita(page, opts) {
  return page.evaluate((o) => {
    FAWNet.init({ backend: "fake", relayUrl: location.origin });
    return FAWRoom.create({
      gioco: o.gioco, creator: o.creator, giocatori: o.giocatori,
      opzioni: o.opzioni || {}, cfg: o.cfg || {}, durata: o.durata || 180000,
      maxGiocatori: o.maxGiocatori || 8
    });
  }, opts);
}

async function leggiDoc(page, matchId) {
  return page.evaluate((id) => FAWNet.get("partite/" + id), matchId);
}

async function scriviDoc(page, matchId, patch) {
  return page.evaluate(([id, p]) => FAWNet.update("partite/" + id, p), [matchId, patch]);
}

/** Aspetta che lo stato del documento sia uno di quelli attesi. */
async function aspettaStato(page, matchId, stati, timeout) {
  const t0 = Date.now();
  const limit = timeout || 40000;
  while (Date.now() - t0 < limit) {
    const d = await leggiDoc(page, matchId);
    if (d && d.exists && stati.includes(d.data.stato)) return d.data;
    await page.waitForTimeout(250);
  }
  throw new Error("stato " + JSON.stringify(stati) + " non raggiunto entro " + limit + "ms");
}

async function aspetto(page, fn, msg, timeout) {
  await page.waitForFunction(fn, null, { timeout: timeout || 30000, polling: 300 });
  return msg;
}


/**
 * Cerca una risposta ammessa per il round corrente (stesso database del gioco),
 * con la garanzia che non sia già stata usata da qualcun altro nel round.
 */
async function rispostaValida(page, opts) {
  opts = opts || {};
  return page.evaluate((o) => {
    const st = window.FAWRush && window.FAWRush.stato;
    if (!st) return null;
    const combo = st.rounds[st.idx];
    if (!combo) return null;
    if (combo.votazione) {
      return { word: o.take ? "una scusa inventata di sana pianta" : "un'altra scusa plausibile", combo };
    }
    const CAT = window.FAWCategorie;
    const cat = CAT.byId(combo.categoria);
    const l = String(combo.lettera || "").toLowerCase();
    let liste = CAT.rispostePer(cat, l).filter((x) => !(o.escludi || []).includes(x));
    if (!liste.length) liste = CAT.rispostePer(cat, l);
    if (!liste.length) return null;
    const scelta = liste[Math.min(o.indice || 0, liste.length - 1)];
    return { word: scelta, combo: { lettera: combo.lettera, nome: combo.nome, categoria: combo.categoria }, totali: liste.length };
  }, { indice: opts.indice || 0, escludi: opts.escludi || [], take: !!opts.take });
}

/** Sposta `startAt` in modo che il tempo condiviso si trovi a `dentroMs` dal via. */
async function portaAvanti(page, matchId, dentroMs) {
  return page.evaluate(({ id, dentro }) => {
    return FAWNet.get("partite/" + id).then((snap) => {
      const ora = FAWNet.clock();
      return FAWNet.update("partite/" + id, { startAt: Math.round(ora - dentro) }).then(() => dentro);
    });
  }, { id: matchId, dentro: dentroMs });
}

/** Solo test: sposta l'orologio usando la timeline ADATTIVA, non indice × ciclo. */
async function portaFaseRush(page, matchId, indice, fase) {
  await page.evaluate(({ id, indice, fase }) => FAWNet.transact("partite/" + id, cur => {
    const p = FAWRushRules.tempiPartita(cur)[indice];
    const offset = fase === "rivela" ? p.fineVoto + Math.min(500, p.confrontoMs / 2)
      : fase === "voto" ? p.fineInput + Math.min(500, p.votoMs / 2) : p.inizio + Math.min(500, p.scritturaMs / 2);
    return { startAt: Math.round(FAWNet.clock() - offset) };
  }), { id: matchId, indice, fase });
  await page.waitForFunction(({ indice, fase }) => FAWRush.stato.idx === indice && FAWRush.stato.fase === fase, { indice, fase });
}

/**
 * Aspetta che il client veda il round davvero aperto nel documento (dopo uno
 * spostamento di `startAt` i due possono essere sfasati di qualche centinaio di ms).
 */
async function attendiRound(page) {
  await page.waitForFunction(() => {
    const st = window.FAWRush.stato;
    const d = st.data;
    if (!d || !window.FAWRushRules) return st.idx >= 0;
    const f = window.FAWRushRules.fasePartita(d, window.FAWNet.clock());
    return f.fase === "input" && f.indice === st.idx;
  }, null, { timeout: 15000 });
  return page.evaluate(() => window.FAWRush.stato.idx);
}

/** Manda la risposta dalla UI (tap sul pulsante) e aspetta la ricevuta. */
async function rispondi(page, parola) {
  await attendiRound(page);
  await page.fill("#inp-risposta", parola);
  await page.click("#btn-invia");
  await page.waitForTimeout(250);
}

/** Svuota lo store del relay (isolamento dei test: niente residui tra i test). */
async function resetRelay() {
  const base = process.env.FAW_RELAY_URL || "http://127.0.0.1:8090";
  try { await fetch(base + "/api/reset", { method: "POST" }); } catch (e) { /* relay non raggiungibile: il test fallirà da solo */ }
}

module.exports = { portaFaseRush, resetRelay, contesto, apri, creaPartita, leggiDoc, scriviDoc, aspettaStato, aspetto, rispostaValida, portaAvanti, rispondi, attendiRound };
