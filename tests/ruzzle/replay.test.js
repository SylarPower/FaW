/* Test Ruzzle: una rivincita crea una lobby nuova e ogni client carica
   lo stesso tabellone prima di mostrare VIA. */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { createMockFirestore, makeFirebaseGlobal } = require('../ncc/mock-firestore.js');

const ROOT = path.join(__dirname, '..', '..');
let html = fs.readFileSync(path.join(ROOT, 'games/ruzzle/index.html'), 'utf8');
html = html.replace(/\t*<script src="https:\/\/www\.gstatic\.com[^\"]*"><\/script>\n?/g, '');
html = html.replace(/\t*<script src="\.\.\/shared\/firebase-config\.js"><\/script>\n?/g, '');
html = html.replace(/\t*<script src="\.\.\/shared\/faw-layout\.js" defer><\/script>\n?/g, '');

const rivincitaJs = fs.readFileSync(path.join(ROOT, 'games/shared/rivincita.js'), 'utf8');
const podioJs = fs.readFileSync(path.join(ROOT, 'games/shared/podio.js'), 'utf8');
const bannerJs = fs.readFileSync(path.join(ROOT, 'games/shared/faw-banner.js'), 'utf8');
const mock = createMockFirestore();
let passed = 0, failed = 0;
const errori = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✔', msg); }
  else { failed++; console.log('  ✘', msg); }
}
function eq(actual, expected, msg) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log('  ✔', msg); }
  else {
    failed++;
    console.log('  ✘', msg, '\n    atteso:', JSON.stringify(expected), '\n    ottenuto:', JSON.stringify(actual));
  }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, what, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return true;
    await sleep(30);
  }
  failed++;
  console.log('  ✘ timeout in attesa di:', what);
  return false;
}

function pagina(nome, matchId) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const msg = String(e && e.message ? e.message : e);
    if (/Could not load|Not implemented/.test(msg)) return;
    errori.push(nome + ': ' + msg.split('\n')[0]);
  });
  vc.on('error', (...args) => errori.push(nome + ': ' + args.join(' ')));
  const dom = new JSDOM(html, {
    url: 'http://localhost/games/ruzzle/index.html?matchId=' + encodeURIComponent(matchId),
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.eval(rivincitaJs);
      w.eval(podioJs);
      w.eval(bannerJs);
      w.localStorage.setItem('mioNome', nome);
      w.firebase = makeFirebaseGlobal(mock);
      w.FAW_FIREBASE_CONFIG = { apiKey: 'test-key', projectId: 'test' };
      w.FAW_REQUIRE_FIREBASE_CONFIG = () => w.FAW_FIREBASE_CONFIG;
      w.fetch = async (url) => {
        if (String(url).indexOf('dizionario') !== -1) {
          return { ok: true, status: 200, text: async () => 'CANE\nMARE\nGATTO\nLUNA' };
        }
        throw new Error('no network: ' + url);
      };
      w.alert = () => {};
      w.confirm = () => true;
      w.Element.prototype.animate = function () { return { onfinish: null, cancel() {} }; };
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
    }
  });
  return dom.window;
}

(async () => {
  mock.store.set('partite/ORIGINE', {
    gioco: 'ruzzle',
    partecipanti: ['ALFA', 'BETA'],
    stato: 'conclusa',
    opzioni: { tempo: '60', griglia: '5', mode: 'classic', seed: 'VECCHIA' },
    pronti: ['ALFA', 'BETA'],
    finito: ['ALFA', 'BETA'],
    confermaVerifica: ['ALFA', 'BETA'],
    parole: { ALFA: [], BETA: [] },
    punteggi: { ALFA: 0, BETA: 0 },
    paroleEscluse: []
  });

  console.log('\n[1] Invito di rivincita: il documento nuovo conserva le opzioni scelte');
  const origine = pagina('ALFA', 'ORIGINE');
  await until(() => origine.eval('!!currentGameData'), 'caricamento partita originale');
  origine.eval('preparaContestoRivincita()');
  const creata = await origine.FAW_RIVINCITA.invita('ruzzle', {
    tempo: '60', griglia: '3', mode: 'classic'
  });
  ok(creata && creata.ok, 'invita() crea la lobby di rivincita');
  const docPath = 'partite/' + (creata && creata.id);
  const lobby = mock.store.get(docPath);
  ok(!!lobby, 'documento della nuova partita presente in Firestore');
  eq(lobby && lobby.stato, 'attesa', 'la nuova partita nasce in attesa');
  eq(lobby && lobby.opzioni && lobby.opzioni.griglia, '3', 'la scelta 3×3 viene salvata');
  ok(lobby && lobby.opzioni.seed && lobby.opzioni.seed !== 'VECCHIA', 'il seed della rivincita è nuovo');
  eq([lobby && lobby.daRivincita, lobby && lobby.rivincitaDi], [true, 'ORIGINE'],
    'la lobby è collegata alla partita da cui nasce');

  console.log('\n[2] Entrambi i client caricano il tabellone nuovo e arrivano a VIA');
  const a = pagina('ALFA', creata.id);
  const b = pagina('BETA', creata.id);
  await until(() => a.document.querySelectorAll('#grid .tile').length === 9 &&
    b.document.querySelectorAll('#grid .tile').length === 9, 'tabellone 3×3 su entrambi i client');
  await until(() => mock.store.get(docPath).stato === 'in_corso', 'tutti pronti e partita avviata');
  eq(a.document.querySelectorAll('#grid .tile').length, 9, 'ALFA vede tutte le 9 celle');
  eq(b.document.querySelectorAll('#grid .tile').length, 9, 'BETA vede tutte le 9 celle');
  const lettereA = a.document.getElementById('grid').dataset.letters;
  const lettereB = b.document.getElementById('grid').dataset.letters;
  eq(lettereA, lettereB, 'la stessa seed produce lo stesso tabellone per tutti');
  ok(a.document.getElementById('grid-overlay').style.display === 'flex' &&
    b.document.getElementById('grid-overlay').style.display === 'flex',
    'il pulsante VIA appare dopo la sincronizzazione della lobby');

  console.log('\n[3] Una snapshot aggiornata non lascia gridSize e DOM fuori sincrono');
  await mock.db.collection('partite').doc(creata.id).update({ 'opzioni.griglia': '5' });
  await until(() => a.document.querySelectorAll('#grid .tile').length === 25 &&
    b.document.querySelectorAll('#grid .tile').length === 25, 'ricostruzione da 3×3 a 5×5');
  eq(a.document.querySelectorAll('#grid .tile').length, 25, 'ALFA ridisegna 25 celle alla nuova configurazione');
  eq(b.document.querySelectorAll('#grid .tile').length, 25, 'BETA ridisegna 25 celle alla nuova configurazione');
  eq([Number(a.eval('gridSize')), Number(b.eval('gridSize'))], [5, 5],
    'dimensione interna e DOM restano allineati');

  ok(errori.length === 0, 'nessun errore uncaught: ' + errori.join(' | '));
  console.log('\n=================');
  console.log('PASSATI: ' + passed + '  FALLITI: ' + failed);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('ERRORE TEST RIVINCITA RUZZLE:', e);
  process.exit(1);
});
