"use strict";
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const A = require('./aiuti');
const { shimFirebase } = require('../support/firebase-compat');
const GAME = 'games/categoria-rush/index.html';
const NCC = 'nomi-cose-citta';
test.beforeEach(async () => A.resetRelay());

async function sala(browser, opts = {}) {
  const names = opts.names || ['ALICE', 'BOB'], clients = [];
  for (const name of names) {
    const c = await A.contesto(browser, name, { reducedMotion: true });
    if (opts.firebase) {
      await c.ctx.addInitScript(shimFirebase);
      await c.ctx.addInitScript(() => localStorage.setItem('faw:net:backend', 'firebase'));
    }
    clients.push(c);
  }
  const [a, b] = clients;
  await a.page.goto(GAME);
  const id = await A.creaPartita(a.page, { gioco: 'categoria-rush', creator: names[0], giocatori: names,
    durata: 120000, opzioni: { mode: opts.mode || 'classiche', colonne: opts.colonne || 3, countdown: 0 } });
  await Promise.all(clients.map(c => c.page.goto(GAME + '?matchId=' + id)));
  await Promise.all(clients.map(c => c.page.waitForFunction(() => FAWRush.stato.data)));
  await Promise.all(clients.map(c => c.page.locator('#btn-pronto').click()));
  await Promise.all(clients.map(c => A.attendiRound(c.page)));
  return { a, b, id, names, clients, close: () => Promise.all(clients.map(c => c.ctx.close())) };
}
async function values(page, index = 0) {
  return page.evaluate(i => {
    const q = FAWRush.stato.rounds[FAWRush.stato.idx];
    return Object.fromEntries(q.categorie.map(id => {
      const cat = FAWNcc.byId(id), seen = new Set();
      const words = FAWCategorie.rispostePer(cat, q.lettera).filter(w => {
        const key = FAWCategorie.groupKey(w, cat); if (seen.has(key)) return false; seen.add(key); return true;
      });
      return [id, words[i % words.length]];
    }));
  }, index);
}
async function fillSheet(page, v) { for (const [id, w] of Object.entries(v)) await page.locator('#scheda-' + id).fill(w); }
async function score(page, i = 0) { await page.waitForFunction(i => !!FAWRush.stato.data?.rush?.punteggiRound?.[i], i); }
async function readyAll(s) { await Promise.all(s.clients.map(c => c.page.locator('#btn-avanti').click())); }
function errors(s) { for (const c of s.clients) expect(c.page.__errors || []).toEqual([]); }

test('Sprint: ultime risposte concorrenti, punti una volta sola e Avanti immediato senza muovere startAt', async ({ browser }) => {
  const s = await sala(browser);
  try {
    const start = (await A.leggiDoc(s.a.page, s.id)).data.startAt;
    const wa = await A.rispostaValida(s.a.page), wb = await A.rispostaValida(s.b.page, { indice: 1 });
    await s.a.page.locator('#inp-risposta').fill(wa.word); await s.b.page.locator('#inp-risposta').fill(wb.word);
    await Promise.all(s.clients.map(c => c.page.locator('#btn-invia').dblclick()));
    await Promise.all(s.clients.map(c => score(c.page)));
    const d = (await A.leggiDoc(s.a.page, s.id)).data;
    expect(d.startAt).toBe(start); expect(d.rush.tempi[0].scritturaMs).toBeLessThan(15000);
    expect(Object.keys(d.rush.risposte[0]).sort()).toEqual(['ALICE', 'BOB']);
    for (const n of s.names) expect(d.punteggi[n]).toBe(d.rush.punteggiRound[0][n]);
    await expect(s.a.page.locator('#round-reason')).toContainText('Tutti hanno consegnato');
    const box = await s.a.page.locator('#rivela-lista').boundingBox();
    expect(box.y).toBeLessThan(500);
    await readyAll(s);
    await Promise.all(s.clients.map(c => c.page.waitForFunction(() => FAWRush.stato.idx === 1 && FAWRush.stato.fase === 'input')));
    const result = await s.a.page.evaluate(async ({ id, word }) => FAWNet.transact('partite/' + id, cur => {
      const r = FAWRushRules.rispostaPatch(cur, 'ALICE', { roundIdx: 0, testo: word }, FAWNet.clock());
      return r.ok ? r.patch : false;
    }), { id: s.id, word: wa.word });
    expect(result.applied).toBe(false);
    const after = (await A.leggiDoc(s.a.page, s.id)).data;
    expect(after.startAt).toBe(start); expect(after.rush.punteggiRound[0]).toEqual(d.rush.punteggiRound[0]);
    expect(after.rush.risposte[1]).toBeUndefined(); errors(s);
  } finally { await s.close(); }
});

test('Creativo: Passo e astensione sono definitivi; zero candidati salta il voto', async ({ browser }) => {
  const s = await sala(browser, { mode: 'creative' });
  try {
    await s.a.page.locator('#btn-passo').click();
    await A.rispondi(s.b.page, 'un gatto in riunione');
    await expect(s.a.page.locator('#box-voto')).toBeVisible();
    await expect(s.b.page.locator('#btn-astieni')).toBeDisabled();
    await s.a.page.locator('#btn-astieni').click();
    await score(s.a.page);
    let d = (await A.leggiDoc(s.a.page, s.id)).data;
    expect(d.rush.punteggiRound[0]).toEqual({ ALICE: 0, BOB: 40 });
    expect(d.rush.voti[0].ALICE.astensione).toBe(true); expect(d.rush.tempi[0].votoMs).toBeLessThan(7000);
    await readyAll(s);
    await Promise.all(s.clients.map(c => A.attendiRound(c.page)));
    await Promise.all(s.clients.map(c => c.page.locator('#btn-passo').click()));
    await score(s.a.page, 1);
    d = (await A.leggiDoc(s.a.page, s.id)).data;
    expect(d.rush.tempi[1].votoMs).toBe(0);
    expect(d.rush.punteggiRound[1]).toEqual({ ALICE: 0, BOB: 0 }); errors(s);
  } finally { await s.close(); }
});

test('NCC: 3 categorie, stesso foglio, Stop +10, reload e consegna finale anticipata (shim Firebase)', async ({ browser }) => {
  const s = await sala(browser, { mode: NCC, colonne: 3, firebase: true });
  try {
    const va = await values(s.a.page), vb = await values(s.b.page, 1);
    expect(await s.a.page.locator('#round-lettera').textContent()).toBe(await s.b.page.locator('#round-lettera').textContent());
    await expect(s.a.page.locator('#scheda-fields input')).toHaveCount(3);
    await expect(s.a.page.locator('#frm-risposta')).toBeHidden();
    await s.b.page.locator('#scheda-nomi').fill(vb.nomi);
    await s.b.page.waitForFunction(() => FAWRush.stato.data.rush?.bozze?.[0]?.BOB?.rev >= 1);
    await fillSheet(s.a.page, va);
    await expect(s.a.page.locator('#btn-scheda')).toContainText('Stop!');
    const start = (await A.leggiDoc(s.a.page, s.id)).data.startAt;
    await s.a.page.locator('#btn-scheda').click();
    await expect(s.b.page.locator('#round-reason')).toContainText('ALICE ha dato lo Stop');
    const left = await s.b.page.evaluate(() => FAWRushRules.fasePartita(FAWRush.stato.data, FAWNet.clock()).entroMs);
    expect(left).toBeLessThanOrEqual(10000); expect(left).toBeGreaterThan(0);
    await s.b.page.reload(); await A.attendiRound(s.b.page);
    await expect(s.b.page.locator('#scheda-nomi')).toHaveValue(vb.nomi);
    await fillSheet(s.b.page, vb); await s.b.page.locator('#btn-scheda').click();
    await score(s.a.page);
    const d = (await A.leggiDoc(s.a.page, s.id)).data;
    expect(d.startAt).toBe(start); expect(d.rush.punteggiRound[0]).toEqual({ ALICE: 30, BOB: 30 });
    await expect(s.a.page.locator('#ncc-review-tabs button')).toHaveCount(3);
    await s.a.page.locator('#ncc-review-tabs [data-categoria="citta"]').click();
    await expect(s.a.page.locator('#rivela-lista')).toContainText(vb.citta);
    await expect(s.a.page.locator('#classifica .n')).toHaveText(['1', '1']);
    await readyAll(s); await A.attendiRound(s.a.page); errors(s);
  } finally { await s.close(); }
});

test('NCC: autosave seriale non sostituisce la nuova digitazione; copia locale recuperata dopo reload', async ({ browser }) => {
  const s = await sala(browser, { mode: NCC, colonne: 6 });
  let release, held = false;
  const gate = new Promise(resolve => release = resolve);
  try {
    const first = await values(s.a.page), second = await values(s.a.page, 1);
    await s.a.page.route('**/api/write', async route => {
      const body = route.request().postDataJSON();
      if (!held && body.ops?.some(op => op.set?.rush?.bozze?.[0]?.ALICE)) { held = true; await gate; }
      await route.continue();
    });
    await s.a.page.locator('#scheda-nomi').fill(first.nomi);
    await expect.poll(() => held).toBe(true);
    await s.a.page.locator('#scheda-nomi').fill(second.nomi);
    release();
    await s.a.page.waitForFunction(() => FAWRush.stato.data.rush?.bozze?.[0]?.ALICE?.rev >= 2);
    await expect(s.a.page.locator('#scheda-nomi')).toHaveValue(second.nomi);
    await expect(s.a.page.locator('#scheda-sync')).toContainText('Scheda salvata');
    await s.a.page.locator('#scheda-citta').fill(first.citta);
    // Reload prima del debounce: anche la modifica non ancora confermata deve riapparire.
    await s.a.page.reload(); await A.attendiRound(s.a.page);
    await expect(s.a.page.locator('#scheda-citta')).toHaveValue(first.citta);
    await expect(s.a.page.locator('#scheda-nomi')).toHaveValue(second.nomi);
    await s.a.page.waitForFunction(() => FAWRush.stato.data.rush?.bozze?.[0]?.ALICE?.valori.citta);
    const d = (await A.leggiDoc(s.a.page, s.id)).data;
    expect(d.rush.risposte?.[0]?.ALICE).toBeUndefined(); errors(s);
  } finally { release(); await s.close(); }
});

test('NCC: tre autosave falliti non fingono una conferma, poi Riprova conserva e salva il testo', async ({ browser }) => {
  const s = await sala(browser, { mode: NCC });
  let calls = 0;
  try {
    const v = await values(s.a.page);
    await s.a.page.route('**/api/write', route => {
      const body = route.request().postDataJSON();
      if (body.ops?.some(op => op.set?.rush?.bozze?.[0]?.ALICE)) { calls++; return route.abort('internetdisconnected'); }
      return route.continue();
    });
    await s.a.page.locator('#scheda-nomi').fill(v.nomi);
    await expect(s.a.page.locator('#btn-salva-scheda')).toBeVisible();
    expect(calls).toBe(6); // 3 tentativi applicativi × 2 invii del trasporto relay su errore di rete
    await expect(s.a.page.locator('#scheda-sync')).toContainText('non confermato');
    await expect(s.a.page.locator('#scheda-nomi')).toHaveValue(v.nomi);
    expect((await A.leggiDoc(s.b.page, s.id)).data.rush.bozze?.[0]?.ALICE).toBeUndefined();
    await s.a.page.unroute('**/api/write'); await s.a.page.locator('#btn-salva-scheda').click();
    await expect(s.a.page.locator('#scheda-sync')).toContainText('Scheda salvata');
    expect((await A.leggiDoc(s.b.page, s.id)).data.rush.bozze[0].ALICE.valori.nomi).toBe(v.nomi);
    errors(s);
  } finally { await s.close(); }
});

test('NCC: scadenza senza click usa le bozze confermate, celle non valide e vuote valgono zero', async ({ browser }) => {
  const s = await sala(browser, { mode: NCC, colonne: 3 });
  try {
    const v = await values(s.a.page);
    await s.a.page.locator('#scheda-nomi').fill(v.nomi);
    await s.a.page.locator('#scheda-cose').fill('parolaassente');
    await s.a.page.waitForFunction(() => FAWRush.stato.data.rush?.bozze?.[0]?.ALICE?.rev >= 2);
    await A.portaFaseRush(s.a.page, s.id, 0, 'rivela');
    await score(s.a.page);
    const d = (await A.leggiDoc(s.a.page, s.id)).data;
    expect(d.rush.punteggiRound[0]).toEqual({ ALICE: 20, BOB: 0 });
    expect(d.rush.risposte[0].ALICE.scheda).toBe(true);
    expect(d.rush.rivela[0].ALICE.scheda.cose.ok).toBe(false);
    expect(d.rush.rivela[0].ALICE.scheda.citta.punti).toBe(0);
    const res = await s.a.page.evaluate(id => FAWNet.transact('partite/' + id, cur => FAWRushRules.bozzaPatch(cur, 'ALICE', { roundIdx: 0, rev: 100, valori: {} }, FAWNet.clock())), s.id);
    expect(res.applied).toBe(false); errors(s);
  } finally { await s.close(); }
});

test('NCC: errori correggibili, consegna parziale definitiva e all-done anche con fogli vuoti', async ({ browser }) => {
  const s = await sala(browser, { mode: NCC });
  try {
    await s.a.page.locator('#scheda-nomi').fill('xx'); await s.a.page.locator('#btn-scheda').click();
    await expect(s.a.page.locator('#scheda-nomi')).toHaveAttribute('aria-invalid', 'true');
    await expect(s.a.page.locator('#scheda-error-nomi')).toContainText('almeno 3 lettere');
    await expect(s.a.page.locator('#scheda-nomi')).toBeFocused();
    await s.a.page.locator('#scheda-nomi').fill(''); await s.a.page.locator('#btn-scheda').click();
    await expect(s.a.page.locator('#scheda-nomi')).toHaveJSProperty('readOnly', true);
    await expect(s.a.page.locator('#btn-scheda')).toBeDisabled();
    await s.b.page.locator('#btn-scheda').click(); await score(s.a.page);
    expect((await A.leggiDoc(s.a.page, s.id)).data.rush.punteggiRound[0]).toEqual({ ALICE: 0, BOB: 0 }); errors(s);
  } finally { await s.close(); }
});

test('NCC: 8 consegne concorrenti, duplicati per categoria, nessun punto perso o duplicato', async ({ browser }) => {
  const s = await sala(browser, { mode: NCC, names: ['ALICE', 'BOB', 'CICE', 'DINO', 'ELISA', 'FABIO', 'GINA', 'UGO'] });
  try {
    const v = await values(s.a.page);
    await Promise.all(s.clients.map(c => fillSheet(c.page, v)));
    await Promise.all(s.clients.map(c => c.page.locator('#btn-scheda').click()));
    await Promise.all(s.clients.map(c => score(c.page)));
    const d = (await A.leggiDoc(s.a.page, s.id)).data;
    expect(Object.keys(d.rush.risposte[0])).toHaveLength(8);
    expect(d.rush.tempi[0].motivo).toBe('tutti');
    for (const name of s.names) {
      expect(d.rush.punteggiRound[0][name]).toBe(15);
      expect(d.punteggi[name]).toBe(15);
      expect(d.rush.statistiche[name].valide).toBe(3);
    }
    await readyAll(s); await A.attendiRound(s.a.page); errors(s);
  } finally { await s.close(); }
});

test('NCC solo: 6 categorie, 2 lettere diverse, punti e storico, rivincita mantiene il formato senza commit di rete', async ({ browser }) => {
  const { ctx, page } = await A.contesto(browser, 'ALICE', { reducedMotion: true });
  let commits = 0;
  page.on('request', r => { if (r.url().includes('/api/write')) commits++; });
  try {
    await page.goto(GAME + '?solo=1&mode=' + NCC);
    let previous;
    for (let i = 0; i < 2; i++) {
      await A.attendiRound(page);
      await expect(page.locator('#scheda-fields input')).toHaveCount(6);
      const letter = await page.locator('#round-lettera').textContent();
      expect(letter).not.toBe(previous); previous = letter;
      await fillSheet(page, await values(page)); await page.locator('#btn-scheda').click(); await score(page, i);
      await expect(page.locator('#punti-solo')).toHaveText(String(120 * (i + 1)));
      await page.locator('#btn-avanti').click();
    }
    await expect(page.locator('#schermo-risultati')).toBeVisible();
    await expect(page.locator('#ris-stats')).toContainText('12/12');
    await expect(page.locator('#ris-rounds details')).toHaveCount(2);
    await page.locator('#ris-rounds summary').first().click();
    await expect(page.locator('#ris-rounds details').first().locator('tbody tr')).toHaveCount(6);
    await expect(page.locator('#ris-tempo')).toContainText('secondi di attesa risparmiati');
    await page.locator('#btn-rivincita').click(); await A.attendiRound(page);
    expect(await page.evaluate(() => FAWRush.stato.modale)).toBe(NCC);
    await expect(page.locator('#scheda-fields input')).toHaveCount(6);
    expect(commits).toBe(0); expect(page.__errors || []).toEqual([]);
  } finally { await ctx.close(); }
});

for (const theme of ['dark', 'light']) {
  test(`NCC: scheda e tastiera a 320px, confronto leggibile e WCAG A/AA (${theme})`, async ({ browser }) => {
    const { ctx, page } = await A.contesto(browser, 'ALICE', { viewport: { width: 320, height: 480 }, touch: true, reducedMotion: true });
    try {
      await page.goto(GAME + '?solo=1&mode=' + NCC); await A.attendiRound(page);
      await page.evaluate(t => document.body.dataset.theme = t, theme);
      const last = page.locator('#scheda-fields input').last();
      await last.tap(); await page.waitForTimeout(350);
      let rect = await last.boundingBox(); expect(rect.y).toBeGreaterThanOrEqual(0); expect(rect.y + rect.height).toBeLessThanOrEqual(480);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      await page.keyboard.press('Enter'); await expect(page.locator('#btn-scheda')).toBeFocused();
      const axe = () => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      let result = await axe(); expect(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
      await fillSheet(page, await values(page));
      await page.setViewportSize({ width: 320, height: 700 });
      await page.waitForTimeout(250);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `.arena/screenshots/ncc-sheet-${theme}.png`, fullPage: true });
      await page.locator('#btn-scheda').click(); await score(page);
      await expect(page.locator('#frm-scheda')).toBeHidden();
      result = await axe(); expect(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
      await page.screenshot({ path: `.arena/screenshots/ncc-review-${theme}.png`, fullPage: true });
      rect = await page.locator('#rivela-lista').boundingBox(); expect(rect.y).toBeLessThan(700);
      expect(page.__errors || []).toEqual([]);
    } finally { await ctx.close(); }
  });
}
