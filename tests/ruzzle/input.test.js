/* Test Ruzzle: sistema di selezione delle lettere.
   La griglia si gioca SOLO trascinando (mouse o dito): la "Modalità Click"
   (toccare una lettera alla volta, con il pulsante AZZERA SELEZIONE) è stata
   rimossa perché la piattaforma si usa da desktop e il doppio sistema
   confondeva — un click secco lasciava una selezione di una lettera sola, che
   sembrava un blocco del gioco.
   Qui si esercita la pagina vera: (1) i controlli della modalità click non
   esistono più, (2) un click da solo non costruisce nessuna selezione,
   (3) il trascinamento (mousedown) seleziona la lettera sotto il puntatore e
   una seconda pressione altrove riparte da capo. */
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
const bannerJs = fs.readFileSync(path.join(ROOT, 'games/shared/faw-banner.js'), 'utf8');
const dictSample = ['CANE', 'GATTO', 'VOLPE', 'ROSA', 'MARE'].join('\n');

let passed = 0, failed = 0;
const errori = [];
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
    errori.push(msg.split('\n')[0]);
  });
  const dom = new JSDOM(html, {
    url: 'http://localhost/games/ruzzle/index.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.eval(podioJs);
      w.eval(bannerJs);
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

/* Un round vero: si usa la stessa funzione del pulsante VIA. */
function round(w) {
  w.eval("document.getElementById('modal-timer-select').value = '60';" +
    "document.getElementById('modal-grid-select').value = '4';" +
    'confirmNewGame(false);');
  w.eval('timeRemaining = 60; initialTime = 60;');
  w.eval('startRound();');
}

const tiles = (w) => Array.from(w.document.querySelectorAll('#grid .tile'));
const selezionati = (w) => tiles(w).filter((t) => t.classList.contains('selected')).length;
const parola = (w) => w.document.getElementById('current-word').textContent.trim();
const mouseEvent = (w, tipo) => new w.MouseEvent(tipo, { bubbles: true, cancelable: true, clientX: 0, clientY: 0 });

(async () => {
  const w = pagina('ALFA');
  await sleep(300);

  console.log('\n[1] La modalità click non esiste più');
  ok(!w.document.getElementById('input-mode-toggle'), 'nessun interruttore "input-mode-toggle"');
  ok(!w.document.getElementById('btn-reset-selection'), 'nessun pulsante AZZERA SELEZIONE');
  ok(!/Modalità Click/i.test(w.document.body.innerHTML), 'nessuna etichetta "Modalità Click" nella pagina');

  console.log('\n[2] Un click da solo non seleziona (si gioca trascinando)');
  round(w);
  await sleep(150);
  ok(tiles(w).length === 16, 'griglia 4×4 pronta (' + tiles(w).length + ' lettere)');
  tiles(w)[0].dispatchEvent(mouseEvent(w, 'click'));
  await sleep(40);
  eq(selezionati(w), 0, 'click secco sulla lettera: nessuna selezione');
  eq(parola(w), '', 'nessuna parola composta dal click');

  console.log('\n[3] Il trascinamento seleziona le lettere');
  tiles(w)[0].dispatchEvent(mouseEvent(w, 'mousedown'));
  await sleep(40);
  eq(selezionati(w), 1, 'mousedown (inizio del trascinamento) seleziona la lettera');
  ok(parola(w).length === 1, 'la parola in corso mostra la lettera selezionata: "' + parola(w) + '"');
  /* second click senza trascinamento: la selezione NON cresce come faceva la
     modalità click (una lettera si aggiunge solo trascinandoci sopra) */
  tiles(w)[1].dispatchEvent(mouseEvent(w, 'click'));
  await sleep(40);
  eq(selezionati(w), 1, 'un altro click non aggiunge lettere alla selezione');
  /* una seconda pressione altrove riparte dalla lettera premuta */
  tiles(w)[3].dispatchEvent(mouseEvent(w, 'mousedown'));
  await sleep(40);
  eq(selezionati(w), 1, 'nuova pressione su un\'altra lettera: la selezione riparte da lì');
  ok(tiles(w)[3].classList.contains('selected'), 'la lettera premuta è quella selezionata');
  w.document.dispatchEvent(mouseEvent(w, 'mouseup'));
  await sleep(40);
  /* Rilascio con una sola lettera: niente parola da validare, la selezione
     viene buttata via invece di restare appesa (era il residuo della
     modalità click: una lettera selezionata che «aspettava» altre lettere). */
  eq(selezionati(w), 0, 'rilascio con una sola lettera: selezione scartata, nessun residuo');
  eq(parola(w), '', 'nessuna parola in corso dopo il rilascio');

  console.log('\n[4] La selezione si azzera con le funzioni interne (nessun pulsante)');
  w.eval('clearSelection();');
  await sleep(40);
  eq(selezionati(w), 0, 'clearSelection() svuota la selezione');
  ok(typeof w.eval('typeof clearSelection') === 'string' && w.eval('typeof clearSelection') === 'function',
    'clearSelection resta disponibile come funzione interna');

  console.log('\n[5] La griglia multiplayer segue tutte le opzioni della rivincita');
  w.eval("currentGameData = { stato: 'attesa' };" +
    "syncMultiplayerGrid({ opzioni: { seed: 'RIVINCITA1', griglia: '3', mode: 'classic' } });");
  eq(tiles(w).length, 9, 'con opzioni 3×3 la nuova partita renderizza 9 celle');
  const firstBoardTile = tiles(w)[0];
  w.eval("syncMultiplayerGrid({ opzioni: { seed: 'RIVINCITA1', griglia: '5', mode: 'classic' } });");
  eq(tiles(w).length, 25, 'cambio griglia a seed invariato ricostruisce 25 celle (non resta il vecchio DOM)');
  eq(Number(w.eval('gridSize')), 5, 'la dimensione interna coincide con la griglia renderizzata');
  const currentBoardTile = tiles(w)[0];
  w.eval("syncMultiplayerGrid({ opzioni: { seed: 'RIVINCITA1', griglia: '5', mode: 'classic' } });");
  ok(tiles(w)[0] === currentBoardTile && currentBoardTile !== firstBoardTile,
    'snapshot identica non ridisegna la griglia, una configurazione diversa sì');

  console.log('\n[6] Drag interrotto o indice obsoleto: nessun errore getBoundingClientRect');
  w.eval('inputState.isDragging = true; selectedCells = [];');
  w.document.dispatchEvent(mouseEvent(w, 'mousemove'));
  await sleep(40);
  eq(Boolean(w.eval('inputState.isDragging')), false, 'un move senza celle selezionate chiude il drag');
  w.eval('inputState.isDragging = true; selectedCells = [999, 0];');
  w.document.dispatchEvent(mouseEvent(w, 'mousemove'));
  await sleep(40);
  eq(Boolean(w.eval('inputState.isDragging')), false, 'un indice fuori griglia annulla il drag in sicurezza');
  eq(selezionati(w), 0, 'la selezione non lascia celle fantasma');
  w.eval("gridSize = 5; while (gridEl.children.length > 9) gridEl.lastElementChild.remove();" +
    'inputState.isDragging = true; selectedCells = [8];');
  w.document.dispatchEvent(mouseEvent(w, 'mousemove'));
  await sleep(40);
  eq(Boolean(w.eval('inputState.isDragging')), false, 'un DOM di 3×3 non viene usato come se fosse 5×5');
  w.eval('inputState.isDragging = true; selectedCells = [0];');
  w.document.dispatchEvent(new w.Event('touchcancel', { bubbles: true }));
  eq(Boolean(w.eval('inputState.isDragging')), false, 'touchcancel ripulisce lo stato di trascinamento');

  console.log('\n[7] Nessun errore di pagina durante l\'interazione');
  eq(errori, [], 'nessun errore uncaught: ' + errori.join(' | '));

  console.log('\n=================');
  console.log('PASSATI: ' + passed + '  FALLITI: ' + failed);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('ERRORE TEST INPUT RUZZLE:', e);
  process.exit(1);
});
