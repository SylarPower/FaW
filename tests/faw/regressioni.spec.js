"use strict";
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const A = require('./aiuti');
const { shimFirebase } = require('../support/firebase-compat');
const RUSH = 'games/categoria-rush/index.html', BOMBA = 'games/bomba-parole/index.html';
test.beforeEach(async () => A.resetRelay());

async function salaRush(browser) {
  const a = await A.contesto(browser, 'ALICE'), b = await A.contesto(browser, 'BOB');
  await a.page.goto(RUSH);
  const id = await A.creaPartita(a.page, { gioco: 'categoria-rush', creator: 'ALICE', giocatori: ['ALICE', 'BOB'], durata: 120000, opzioni: { countdown: 0 } });
  await Promise.all([a.page.goto(RUSH + '?matchId=' + id), b.page.goto(RUSH + '?matchId=' + id)]);
  await Promise.all([a.page.waitForFunction(() => FAWRush.stato.data), b.page.waitForFunction(() => FAWRush.stato.data)]);
  await a.page.click('#btn-pronto'); await b.page.click('#btn-pronto');
  await Promise.all([A.attendiRound(a.page), A.attendiRound(b.page)]);
  return { a, b, id, close: () => Promise.all([a.ctx.close(), b.ctx.close()]) };
}

test('Rush: reload dopo la risposta ripristina ricevuta e blocco, non si può riscrivere', async ({ browser }) => {
  const s = await salaRush(browser);
  try {
    const answer = await A.rispostaValida(s.a.page);
    await A.rispondi(s.a.page, answer.word);
    await expect(s.a.page.locator('#receipt')).toContainText(answer.word);
    const original = (await A.leggiDoc(s.a.page, s.id)).data.rush.risposte[0].ALICE;
    await s.a.page.reload(); await A.attendiRound(s.a.page);
    await expect(s.a.page.locator('#receipt')).toContainText(answer.word);
    await expect(s.a.page.locator('#inp-risposta')).toHaveJSProperty('readOnly', true);
    await expect(s.a.page.locator('#btn-invia')).toBeDisabled();
    await A.scriviDoc(s.b.page, s.id, { 'giocatori.BOB.visto': Date.now() });
    await expect(s.a.page.locator('#inp-risposta')).toHaveJSProperty('readOnly', true);
    await s.a.page.evaluate(() => FAWRush.invia());
    expect((await A.leggiDoc(s.a.page, s.id)).data.rush.risposte[0].ALICE).toEqual(original);
    expect(s.a.page.__errors || []).toEqual([]);
  } finally { await s.close(); }
});

test('Rush: invio in volo al cambio round non consuma la nuova risposta', async ({ browser }) => {
  const s = await salaRush(browser);
  try {
    const answer = await A.rispostaValida(s.a.page);
    let release, intercepted;
    const waiting = new Promise(resolve => { intercepted = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    let held = false;
    await s.a.page.route('**/api/write', async route => {
      const body = route.request().postDataJSON();
      const isAnswer = body.ops?.some(op => op.set?.rush?.risposte?.[0]?.ALICE);
      if (isAnswer && !held) { held = true; intercepted(); await gate; }
      await route.continue();
    });
    await s.a.page.fill('#inp-risposta', answer.word); await s.a.page.click('#btn-invia');
    await waiting;
    await A.portaAvanti(s.b.page, s.id, 31000);
    await s.a.page.waitForFunction(() => FAWRush.stato.idx === 1);
    const next = await A.rispostaValida(s.a.page);
    await s.a.page.fill('#inp-risposta', next.word);
    release();
    await expect(s.a.page.locator('#inp-risposta')).toHaveValue(next.word);
    const after = await A.leggiDoc(s.b.page, s.id);
    expect(after.data.rush.risposte?.[1]?.ALICE).toBeUndefined();
    await s.a.page.click('#btn-invia');
    await expect(s.a.page.locator('#receipt')).toContainText(next.word);
    expect((await A.leggiDoc(s.b.page, s.id)).data.rush.risposte[1].ALICE.parola).toBe(next.word);
  } finally { await s.close(); }
});

test('Rush: retry limitati allo stesso payload, poi input sbloccato', async ({ browser }) => {
  const s = await salaRush(browser);
  try {
    const answer = await A.rispostaValida(s.a.page);
    await s.a.page.evaluate(() => {
      const transact = FAWNet.transact;
      window.__attempts = 0;
      FAWNet.transact = (...args) => { window.__attempts++; return transact(...args); };
    });
    await s.a.page.route('**/api/get', route => route.abort('internetdisconnected'));
    await s.a.page.fill('#inp-risposta', answer.word); await s.a.page.click('#btn-invia');
    await expect(s.a.page.locator('#feedback')).toContainText('Invio non confermato');
    expect(await s.a.page.evaluate(() => window.__attempts)).toBe(3);
    await expect(s.a.page.locator('#inp-risposta')).toHaveJSProperty('readOnly', false);
    await s.a.page.unroute('**/api/get');
    await s.a.page.click('#btn-invia');
    await expect(s.a.page.locator('#receipt')).toContainText(answer.word);
    expect(s.a.page.__errors || []).toEqual([]);
  } finally { await s.close(); }
});

test('Rush: riapertura dopo tutti i round salva anche quelli saltati e lo zero degli assenti', async ({ browser }) => {
  const s = await salaRush(browser);
  try {
    const answer = await A.rispostaValida(s.a.page); await A.rispondi(s.a.page, answer.word);
    await s.a.page.evaluate(() => FAWRush.stato.room.stop());
    await s.b.page.evaluate(() => FAWRush.stato.room.stop());
    await A.portaAvanti(s.b.page, s.id, 121000);
    await s.a.page.reload();
    await expect(s.a.page.locator('#schermo-risultati')).toBeVisible();
    const d = (await A.leggiDoc(s.a.page, s.id)).data;
    expect(Object.keys(d.rush.punteggiRound)).toHaveLength(4);
    expect(d.rush.statistiche.ALICE.valide).toBe(1);
    expect(d.rush.statistiche.BOB.mancante).toBe(4);
    expect(d.risultati.classifica[0].punti).toBe(d.punteggi.ALICE);
  } finally { await s.close(); }
});

async function compatContext(browser, nome) {
  const ctx = await browser.newContext({ viewport: test.info().project.use.viewport || { width: 390, height: 844 } });
  await ctx.route('https://**/*', route => {
    const url = route.request().url();
    const body = url.includes('firebase-firestore-compat.js') ? '(' + shimFirebase.toString() + ')();' : '';
    return route.fulfill({ status: 200, contentType: 'application/javascript', body });
  });
  await ctx.addInitScript(n => { localStorage.setItem('mioNome', n); localStorage.setItem('faw:net:backend', 'firebase'); }, nome);
  const page = await ctx.newPage(); page.__errors = []; page.on('pageerror', e => page.__errors.push(e.message));
  return { ctx, page };
}

for (const gioco of ['categoria-rush', 'bomba-parole']) {
  test(`${gioco}: bootstrap e partita sul trasporto Firebase compat, non sul backend fake`, async ({ browser }) => {
    const a = await compatContext(browser, 'ALICE'), b = await compatContext(browser, 'BOB');
    try {
      const file = `games/${gioco}/index.html`, rush = gioco === 'categoria-rush';
      await a.page.goto(file);
      await expect(a.page.locator('#schermo-crea')).toBeVisible();
      expect(await a.page.evaluate(() => FAWNet.backendName())).toBe('firebase');
      expect(await a.page.evaluate(() => window.__firebaseCompatLoaded)).toBe(true);
      expect(await a.page.evaluate(() => !!FAW_FIREBASE_CONFIG.projectId)).toBe(true);
      await a.page.click(rush ? '#btn-crea-stanza' : '#btn-crea');
      await expect(a.page.locator('#schermo-lobby')).toBeVisible();
      const id = await a.page.evaluate(isRush => (isRush ? FAWRush : FAWBomba).stato.matchId, rush);
      await b.page.goto(file + '?matchId=' + id);
      await expect(a.page.locator('#lobby-lista')).toContainText('BOB');
      await expect(b.page.locator('#lobby-lista')).toContainText('ALICE');
      await a.page.click('#btn-pronto'); await b.page.click('#btn-pronto');
      if (rush) {
        await A.attendiRound(a.page);
        const answer = await A.rispostaValida(a.page);
        await a.page.fill('#inp-risposta', answer.word); await a.page.click('#btn-invia');
        await expect(a.page.locator('#receipt')).toContainText(answer.word);
        await A.portaAvanti(b.page, id, 121000);
      } else {
        await a.page.waitForFunction(() => FAWBomba.stato.data?.bomba?.round);
        const word = await a.page.evaluate(() => FAWWords.wordsContaining(FAWBomba.stato.data.bomba.round.seq, { limit: 40 }).find(w => w.length <= 24));
        await expect(a.page.locator('#btn-passa')).toBeEnabled();
        await a.page.fill('#inp-parola', word); await a.page.click('#btn-passa');
        await expect(b.page.locator('#btn-passa')).toBeEnabled();
        // L'ultima esplosione deve portare con sé la classifica e la penalità.
        await a.page.evaluate(async id => {
          await FAWNet.update('partite/' + id, { maxEsplosioni: 1, 'bomba.round.inizioAlle': FAWNet.clock() - 10000, 'bomba.round.micciaMs': 1000 });
        }, id);
      }
      await expect(a.page.locator('#schermo-risultati')).toBeVisible();
      await expect(b.page.locator('#schermo-risultati')).toBeVisible();
      const d = (await A.leggiDoc(a.page, id)).data;
      expect(d.risultati.classifica).toHaveLength(2);
      if (!rush) expect(d.risultati.punteggiFinale.BOB).toBe(-100);
      await a.page.evaluate(() => FAWNet.set('presenze/ALICE', { nome: 'ALICE' })); // FieldValue.serverTimestamp su set
      expect(a.page.__errors).toEqual([]); expect(b.page.__errors).toEqual([]);
    } finally { await a.ctx.close(); await b.ctx.close(); }
  });
}

test('Bomba: codice Firestore misto di 20 caratteri, link, sala mancante e sala chiusa', async ({ browser }) => {
  const { ctx, page } = await A.contesto(browser, 'BOB');
  try {
    await page.goto(BOMBA); await expect(page.locator('#schermo-crea')).toBeVisible();
    const id = 'AbCdEfGhIjKlMnOpQrSt';
    await page.evaluate(async id => FAWNet.set('partite/' + id, FAWRoom.buildMatch({ gioco: 'bomba-parole', giocatori: ['ALICE'], maxGiocatori: 6 })), id);
    await page.fill('#inp-code', 'NonEsiste'); await page.click('#btn-unisciti');
    await expect(page.locator('.faw-toast').last()).toContainText('Nessuna sala');
    await page.fill('#inp-code', id); await page.click('#btn-unisciti');
    await expect(page.locator('#lobby-lista')).toContainText('BOB');
    expect(new URL(page.url()).searchParams.get('matchId')).toBe(id);
    await page.evaluate(async id => FAWNet.update('partite/' + id, { stato: 'conclusa' }), id);
    await page.goto(BOMBA); await expect(page.locator('#schermo-crea')).toBeVisible();
    await page.fill('#inp-code', `https://example.test/games/bomba-parole/index.html?matchId=${id}`); await page.click('#btn-unisciti');
    await expect(page.locator('.faw-toast').last()).toContainText('già finita');
    await expect(page.locator('#schermo-crea')).toBeVisible();
    expect(page.__errors || []).toEqual([]);
  } finally { await ctx.close(); }
});

test('Bomba: durante la pausa non si può passare, e una transazione di esplosione fallita viene ritentata', async ({ browser }) => {
  const { ctx, page } = await A.contesto(browser, 'ALICE');
  try {
    await page.goto(BOMBA);
    const id = await A.creaPartita(page, { gioco: 'bomba-parole', creator: 'ALICE', giocatori: ['ALICE', 'BOB'], durata: 120000 });
    await page.goto(BOMBA + '?matchId=' + id); await page.waitForFunction(() => FAWBomba.stato.data);
    await page.evaluate(id => FAWNet.update('partite/' + id, {
      stato: 'in_corso', startAt: FAWNet.clock() - 1000, endsAt: FAWNet.clock() + 60000,
      bomba: { roundIdx: 0, possessore: 'ALICE', round: { i: 0, seq: 'TRA', inizioAlle: FAWNet.clock() + 2000, micciaMs: 1000 }, usate: [], passaggi: {}, esplosioni: {}, storico: [] }
    }), id);
    await expect(page.locator('#btn-passa')).toBeDisabled();
    const denied = await page.evaluate(() => FAWBombaRules.puoPassare(FAWBomba.stato.data, 'ALICE', { testo: 'strada', ora: FAWNet.clock(), roundIdx: 0 }));
    expect(denied.ok).toBe(false); expect(denied.motivo).toBe('ROUND_NON_PRONTO');
    await page.evaluate(() => {
      const txn = FAWNet.transact;
      window.__failedExplosion = false;
      FAWNet.transact = (path, mutate) => txn(path, cur => {
        const patch = mutate(cur);
        if (patch && patch['bomba.esplosioni'] && !window.__failedExplosion) { window.__failedExplosion = true; throw new Error('Rete intermittente'); }
        return patch;
      });
    });
    await page.waitForFunction(() => FAWBomba.stato.data?.bomba?.roundIdx === 1);
    expect(await page.evaluate(() => window.__failedExplosion)).toBe(true);
    const d = (await A.leggiDoc(page, id)).data;
    expect(d.bomba.esplosioni.ALICE).toBe(1); expect(d.punteggi.ALICE).toBe(-100);
  } finally { await ctx.close(); }
});

for (const theme of ['dark', 'light']) {
  test(`Rush: accessibilità automatica, tastiera e contrasto (${theme})`, async ({ browser }) => {
    const { ctx, page } = await A.contesto(browser, 'ALICE', { reducedMotion: true });
    try {
      await page.goto(RUSH); await page.evaluate(t => document.body.dataset.theme = t, theme);
      await expect(page.locator('#schermo-crea')).toBeVisible();
      let result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
      await page.click('#btn-solo'); await page.waitForFunction(() => FAWRush.stato.idx >= 0);
      await expect(page.locator('#box-altre')).toBeHidden();
      result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
      await page.locator('[data-action="regole"]').first().click();
      await expect(page.locator('#dlg-regole')).toBeVisible();
      await page.keyboard.press('Escape'); await expect(page.locator('#dlg-regole')).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    } finally { await ctx.close(); }
  });
}

test('Bomba: errore dizionario recuperabile e allenamento ripetibile dai risultati', async ({ browser }) => {
  const { ctx, page } = await A.contesto(browser, 'ALICE');
  try {
    await page.route('**/dizionario.txt', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<html>errore</html>' }));
    await page.goto(BOMBA + '?solo=1');
    await expect(page.locator('#btn-rip-rova')).toBeVisible();
    expect(await page.evaluate(() => FAWWords.isDictionaryReady())).toBe(false);
    await page.unroute('**/dizionario.txt'); await page.click('#btn-rip-rova');
    await expect(page.locator('#schermo-gioco')).toBeVisible();
    const firstSeed = await page.evaluate(() => FAWBomba.stato.data.seed);
    await page.evaluate(() => { FAWBomba.stato.data.endsAt = FAWNet.clock() - 10; });
    await expect(page.locator('#schermo-risultati')).toBeVisible();
    await page.click('#btn-rivincita');
    await expect(page.locator('#schermo-gioco')).toBeVisible();
    expect(await page.evaluate(() => FAWBomba.stato.data.seed)).not.toBe(firstSeed);
    expect(await page.evaluate(() => FAWBomba.stato.data.punteggi.ALICE)).toBe(0);
    expect(page.__errors || []).toEqual([]);
  } finally { await ctx.close(); }
});

test('relay: nuovo listener immediato durante un long-poll, cancellazioni e disiscrizione', async ({ browser }) => {
  const { ctx, page } = await A.contesto(browser, 'ALICE');
  try {
    await page.goto(RUSH);
    await page.evaluate(async () => {
      await FAWNet.set('test/first', { x: 1 });
      window.__events = [];
      window.__off1 = FAWNet.onDoc('test/first', d => __events.push({ key: 'first', data: d }));
    });
    await page.waitForFunction(() => __events.length === 1);
    await page.evaluate(() => {
      window.__off2 = FAWNet.onDoc('test/second', d => __events.push({ key: 'second', data: d }));
    });
    await page.waitForFunction(() => __events.some(e => e.key === 'second' && e.data === null), null, { timeout: 2000 });
    await page.evaluate(() => FAWNet.set('test/second', { x: 2 }));
    await page.waitForFunction(() => __events.some(e => e.data?.x === 2), null, { timeout: 2000 });
    await page.evaluate(() => { __off1(); return FAWNet.del('test/second'); });
    await page.waitForFunction(() => __events.filter(e => e.key === 'second' && e.data === null).length === 2, null, { timeout: 2000 });
    await page.evaluate(() => FAWNet.update('test/first', { x: 3 }));
    expect(await page.evaluate(() => __events.filter(e => e.key === 'first').length)).toBe(1);
    await page.evaluate(() => __off2());
    expect(page.__errors || []).toEqual([]);
  } finally { await ctx.close(); }
});

test('SDK bloccato: creazione e coda falliscono in modo recuperabile, senza fallback a un relay', async ({ browser }) => {
  for (const game of [RUSH, BOMBA]) {
    const { ctx, page } = await A.contesto(browser, 'ALICE'); // il CDN è bloccato in questo helper
    try {
      await page.addInitScript(() => localStorage.setItem('faw:net:backend', 'firebase'));
      await page.goto(game);
      const button = page.locator(game === RUSH ? '#btn-crea-stanza' : '#btn-crea');
      await expect(button).toBeVisible(); await button.click();
      await expect(page.locator('.faw-toast').last()).toContainText(/non creata|non riuscita/i);
      await expect(button).toBeEnabled();
      expect(await page.evaluate(() => FAWNet.backendName())).toBe('firebase');
      if (game === BOMBA) {
        await page.click('#btn-coda');
        await expect(page.locator('.faw-toast').last()).toContainText('Ricerca non riuscita');
        await expect(page.locator('#btn-coda')).toBeEnabled();
      }
      expect(page.__errors || []).toEqual([]);
    } finally { await ctx.close(); }
  }
});
