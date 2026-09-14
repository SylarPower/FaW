/* Test Ruzzle: il conto alla rovescia dura quanto impostato.
   Il tempo della partita deve essere quello scelto dall'utente (30, 60, 90, 180,
   300 secondi) misurato sull'orologio, non sul numero di tick di un intervallo:
   le sottrazioni a ogni tick perdevano o raddoppiavano il tempo quando la scheda
   rallentava o quando il round veniva avviato due volte (VIA premuto due volte,
   pausa + riprendi). Qui si esercita la pagina vera: si avvia il round, si
   guarda scendere il valore e si controlla quanto dura davvero la partita. */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { createMockFirestore, makeFirebaseGlobal } = require('../ncc/mock-firestore.js');

const ROOT = path.join(__dirname, '..', '..');
let html = fs.readFileSync(path.join(ROOT, 'games/ruzzle/index.html'), 'utf8');
// via gli script esterni: Firebase e config arrivano dal mock
html = html.replace(/\t*<script src="https:\/\/www\.gstatic\.com[^"]*"><\/script>\n?/g, '');
html = html.replace(/\t*<script src="\.\.\/shared\/firebase-config\.js"><\/script>\n?/g, '');
html = html.replace(/\t*<script src="\.\.\/shared\/faw-layout\.js" defer><\/script>\n?/g, '');

const podioJs = fs.readFileSync(path.join(ROOT, 'games/shared/podio.js'), 'utf8');
const dictSample = ['CANE', 'GATTO', 'VOLPE', 'ROSA', 'MARE'].join('\n');

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  \u2714', msg); }
  else { failed++; console.log('  \u2718', msg); }
}
function eq(a, b, msg) {
  if (JSON.stringify(a) === JSON.stringify(b)) { passed++; console.log('  \u2714', msg); }
  else { failed++; console.log('  \u2718', msg, '\n    atteso:', JSON.stringify(b), '\n    ottenuto:', JSON.stringify(a)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pagina(nome) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const msg = String(e && e.message ? e.message : e);
    if (/Could not load|Not implemented/.test(msg)) return;
    console.log('  [jsdomError]', msg.split('\n')[0]);
  });
  const dom = new JSDOM(html, {
    url: 'http://localhost/games/ruzzle/index.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.eval(podioJs);
      w.localStorage.setItem('mioNome', nome);
      w.firebase = makeFirebaseGlobal(createMockFirestore());
      w.FAW_FIREBASE_CONFIG = { apiKey: 'test-key', projectId: 'test' };
      w.FAW_REQUIRE_FIREBASE_CONFIG = () => w.FAW_FIREBASE_CONFIG;
      w.fetch = async (url) => {
        if (String(url).indexOf('dizionario') !== -1) return { ok: true, status: 200, text: async () => dictSample };
        throw new Error('no network: ' + url);
      };
      w.alert = () => {};
      w.confirm = () => true;
      Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: () => Promise.resolve() } });
      w.Element.prototype.animate = function () { return { onfinish: null, cancel() {} }; };
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
    }
  });
  return dom.window;
}

/* Cronometro delle chiamate a endGame(): quante volte e quando. */
const SPIA = "window.__fine = []; endGame = (function (orig) {" +
  " return function () { window.__fine.push(Date.now()); return orig.apply(this, arguments); };" +
  "})(endGame);";
const fineChiamate = (w) => w.eval('window.__fine.length');

/* Un round corto ma reale: si usa la stessa funzione di avvio del pulsante VIA. */
function round(w, secondi) {
  w.eval("document.getElementById('modal-timer-select').value = '60';" +
    "document.getElementById('modal-grid-select').value = '3';" +
    'confirmNewGame(false);' + SPIA);
  w.eval('timeRemaining = ' + secondi + '; initialTime = ' + secondi + ';');
  w.eval('startRound();');
  return Date.now();
}

const residuo = (w) => w.eval('timeRemaining');
/* Le macchine sotto carico possono ritardare un tick: i confronti sul tempo
   reale lasciano un margine, ma il verso dell'errore non cambia mai (il tempo
   non puo' scorrere piu' veloce dell'orologio). */
const vicino = (a, b, tol) => Math.abs(a - b) <= tol;
const mostrato = (w) => w.document.getElementById('timer').textContent;

(async () => {
  const w = pagina('ALFA');
  await sleep(300);

  console.log('\n[1] Il round parte dal tempo scelto');
  w.eval("document.getElementById('modal-timer-select').value = '180';" +
    "document.getElementById('modal-grid-select').value = '5';" +
    'confirmNewGame(false);');
  eq([w.eval('timeRemaining'), w.eval('initialTime')], [180, 180], 'la partita parte da 180s (quelli del menu)');
  eq(mostrato(w), '03:00', 'il display mostra la durata scelta');
  w.eval("document.getElementById('modal-timer-select').value = '30'; confirmNewGame(false);");
  eq([w.eval('timeRemaining'), mostrato(w)], [30, '00:30'], 'cambiando durata cambia anche il display');

  console.log('\n[2] Un secondo vale un secondo (orologio, non tick)');
  round(w, 6);
  const t0 = Date.now();
  const letture = [];
  while (Date.now() - t0 < 4000) {
    /* valore e display letti insieme: tra due letture separate un tick puo'
       cambiare il valore e far sembrare i due numeri incoerenti */
    const [v, txt] = w.eval('[timeRemaining, document.getElementById("timer").textContent]');
    letture.push({ t: Date.now() - t0, v: v, txt: txt });
    await sleep(200);
  }
  const atteso = 6 - Math.floor((Date.now() - t0) / 1000);
  const ultima = letture[letture.length - 1];
  ok(vicino(ultima.v, atteso, 1.5),
    'dopo ' + (ultima.t / 1000).toFixed(1) + 's restano ' + ultima.v + 's (atteso ~' + atteso + ')');
  const cali = letture.filter((l, i) => i > 0 && l.v !== letture[i - 1].v);
  const durataCali = cali.length > 1 ? (cali[cali.length - 1].t - cali[0].t) / (cali.length - 1) : 0;
  ok(durataCali > 800 && durataCali < 1300,
    'ogni secondo mostrato dura ~1000ms reali (' + Math.round(durataCali) + 'ms)');
  ok(letture.every((l) => l.txt === w.eval('formatTime(' + l.v + ')')),
    'display e valore residuo sono sempre coerenti (ultimo: ' + ultima.txt + ')');
  /* la partita finisce quando l'orologio arriva a zero, non prima */
  const scadenza = Date.now() + 6000;
  while (Date.now() < scadenza && fineChiamate(w) < 1) await sleep(100);
  eq(residuo(w), 0, 'il conto arriva a zero senza andare sotto');
  eq(mostrato(w), '00:00', 'a fine tempo il display mostra 00:00');
  eq(fineChiamate(w), 1, 'endGame() chiamato una volta sola a fine tempo');

  console.log('\n[3] La partita dura davvero il tempo impostato');
  round(w, 5);
  const inizio = Date.now();
  while (Date.now() - inizio < 9000 && fineChiamate(w) < 2) await sleep(100);
  const durataReale = (w.eval('window.__fine[1]') - inizio) / 1000;
  ok(durataReale >= 4.6 && durataReale <= 6.4,
    'una partita da 5s dura ' + durataReale.toFixed(2) + 's reali (mai meno di 4.6)');
  eq(fineChiamate(w), 2, 'endGame() una volta per partita anche a fine tempo');

  console.log('\n[4] Doppio avvio (VIA premuto due volte): nessun tempo doppio');
  w.eval('clearInterval(timerInterval);');
  round(w, 8);
  w.eval('startRound();');   // secondo ingresso, come un secondo click su VIA
  const t1 = Date.now();
  await sleep(3000);
  const sceso = 8 - residuo(w);
  const reali = (Date.now() - t1) / 1000;
  ok(sceso <= reali + 1 && sceso >= reali - 2,
    'in ' + reali.toFixed(1) + 's sono passati ' + sceso + 's di gioco (non il doppio)');
  w.eval('clearInterval(timerInterval);');

  console.log('\n[5] Pausa: il tempo si ferma e riprende da dove era');
  round(w, 10);
  await sleep(1200);
  w.eval('togglePause();');
  const congelato = residuo(w);
  const displayCongelato = mostrato(w);
  await sleep(2500);
  eq([residuo(w), mostrato(w)], [congelato, displayCongelato],
    'in pausa il tempo non scende (restano ' + congelato + 's)');
  w.eval('togglePause();');
  await sleep(1500);
  const dopo = residuo(w);
  ok(congelato - dopo >= 1 && congelato - dopo <= 3,
    'alla ripresa il conto riparte da ' + congelato + 's (ora ' + dopo + 's)');
  w.eval('clearInterval(timerInterval);');

  console.log('\n[6] Scheda rallentata: il tempo non si perde e non raddoppia');
  round(w, 12);
  const t2 = Date.now();
  await sleep(1000);
  /* blocco sincrono di 3s: l'intervallo non puo' scattare */
  const fineBlocco = Date.now() + 3000;
  while (Date.now() < fineBlocco) { /* busy wait */ }
  await sleep(200);
  const passati = Math.round((Date.now() - t2) / 1000);
  const scesi = 12 - residuo(w);
  ok(scesi <= passati + 1 && scesi >= passati - 2,
    'dopo un blocco di 3s il residuo e\u2019 allineato all\u2019orologio (' + scesi + 's su ' + passati + 's)');
  w.eval('clearInterval(timerInterval);');

  console.log('\n[7] Il tempo mostrato non e\u2019 mai negativo');
  w.eval('timeRemaining = 0; updateTimerDisplay();');
  eq(mostrato(w), '00:00', 'zero secondi si vede come 00:00');
  eq(w.eval('formatTime(-5)'), '00:00', 'formatTime non mostra valori negativi');

  console.log('\n=================');
  console.log('PASSATI: ' + passed + '  FALLITI: ' + failed);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('ERRORE TEST TIMER RUZZLE:', e);
  process.exit(1);
});
