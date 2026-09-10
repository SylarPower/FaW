/* Podio di fine partita nei giochi senza suite jsdom propria: Gioco del 15 e
   Pictionary. Le pagine reali vengono caricate in jsdom con un Firebase
   simulato e viene chiamata la loro funzione di fine partita: si verifica che il
   podio venga disegnato dal modulo condiviso, con tutti i giocatori, nell'ordine
   giusto e con i gradini decrescenti. */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { createMockFirestore, makeFirebaseGlobal } = require('../ncc/mock-firestore.js');

const ROOT = path.join(__dirname, '..', '..');
const podioJs = fs.readFileSync(path.join(ROOT, 'games/shared/podio.js'), 'utf8');

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  \u2714', msg); }
  else { failed++; console.log('  \u2718', msg); }
}
function eq(a, b, msg) {
  if (JSON.stringify(a) === JSON.stringify(b)) { passed++; console.log('  \u2714', msg); }
  else { failed++; console.log('  \u2718', msg, '\n    atteso:', JSON.stringify(b), '\n    ottenuto:', JSON.stringify(a)); }
}

const mock = createMockFirestore();

function pagina(file, nome, errori) {
  let html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  html = html.replace(/\s*<script src="https:\/\/www\.gstatic\.com[^"]*"><\/script>/g, '');
  html = html.replace(/\s*<script src="\.\.\/shared\/firebase-config\.js"><\/script>/g, '');
  html = html.replace(/\s*<script src="\.\.\/shared\/faw-layout\.js" defer><\/script>/g, '');
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const msg = String(e && e.message ? e.message : e);
    if (/Could not load|Not implemented/.test(msg)) return;
    errori.push(file + ': ' + msg.split('\n')[0]);
  });
  const dom = new JSDOM(html, {
    url: 'http://localhost/' + file,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.eval(podioJs);
      w.localStorage.setItem('mioNome', nome);
      w.firebase = makeFirebaseGlobal(mock);
      w.FAW_FIREBASE_CONFIG = { apiKey: 'test-key', projectId: 'test' };
      w.FAW_REQUIRE_FIREBASE_CONFIG = () => w.FAW_FIREBASE_CONFIG;
      w.alert = () => {};
      w.confirm = () => true;
      w.Element.prototype.animate = function () { return { onfinish: null, cancel() {} }; };
      /* jsdom non ha il canvas: contesto finto chiamabile e con metodi finti
         (serve anche per i gradienti: createLinearGradient().addColorStop()). */
      const contestoFinto = new Proxy(function () {}, {
        get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : contestoFinto),
        apply: () => contestoFinto,
        set: () => true
      });
      w.HTMLCanvasElement.prototype.getContext = () => contestoFinto;
    }
  });
  return dom.window;
}

const colonne = (w) => Array.from(w.document.querySelectorAll('#podio .pod-col'));
const nomi = (w) => colonne(w).map((c) => c.querySelector('.pod-name').textContent.replace(' (TU)', ''));
const punti = (w) => colonne(w).map((c) => c.querySelector('.pod-bar').textContent);
const altezze = (w) => colonne(w).map((c) => parseInt(c.querySelector('.pod-bar').style.height, 10));

(async () => {
  const errori = [];

  console.log('\n[1] Gioco del 15: podio a fine partita');
  const g = pagina('games/gameof15/index.html', 'ALFA', errori);
  ok(typeof g.renderPodioFinale === 'function', 'la pagina espone renderPodioFinale');
  g.renderPodioFinale({
    partecipanti: ['ALFA', 'BETA', 'GAMMA', 'DELTA'],
    punteggi: { ALFA: 120, BETA: 480, GAMMA: 0, DELTA: 300 },
    finito: ['ALFA', 'BETA', 'GAMMA', 'DELTA']
  });
  eq(nomi(g), ['BETA', 'DELTA', 'ALFA', 'GAMMA'], 'ordine per punteggio decrescente (tutti e 4)');
  eq(punti(g), ['480', '300', '120', '0'], 'punteggi corretti nei gradini');
  eq(altezze(g), [104, 88, 72, 56], 'gradini decrescenti');
  ok(g.document.getElementById('multiplayer-results').style.display === 'block', 'riquadro risultati visibile');
  ok(nomi(g).length === 4 && !g.document.getElementById('podio').innerHTML.includes('undefined'),
    'nessun valore undefined nel podio');
  g.renderPodioFinale({ punteggi: { ZETA: 10, ALFA: 90 } });
  eq(nomi(g), ['ALFA', 'ZETA'], 'funziona anche senza lista partecipanti (chiavi dei punteggi)');

  console.log('\n[2] Pictionary: podio a fine partita');
  const p = pagina('games/pictionary/index.html', 'ALFA', errori);
  // 'state' e' un const di script (non una proprieta' di window): si passa da eval
  p.eval("state.playerName = 'ALFA'; handleResultsPhase({ scores: { ALFA: 5, BETA: 12, GAMMA: 7 }, chains: { c1: { originalTheme: 'CASA', steps: [{ player: 'BETA' }] } } });");
  eq(nomi(p), ['BETA', 'GAMMA', 'ALFA'], 'ordine per voti decrescente');
  eq(punti(p), ['12', '7', '5'], 'voti corretti nei gradini');
  eq(altezze(p), [104, 88, 72], 'gradino del 1° più alto');
  ok(colonne(p)[0].querySelector('.pod-medal').textContent === '🥇', 'medaglia d\'oro al primo');
  ok(colonne(p)[2].textContent.indexOf('(TU)') !== -1, 'giocatore corrente marcato (TU)');
  ok(p.document.querySelectorAll('#full-ranking .ranking-row').length === 3, 'classifica completa ancora presente');
  ok(!p.document.querySelector('.podium'), 'il vecchio podio centrale-prima non esiste più');

  console.log('\n[3] Nessun errore nelle due pagine');
  ok(errori.length === 0, 'nessun errore uncaught: ' + errori.join(' | '));

  console.log('\n=================');
  console.log('PASSATI: ' + passed + '  FALLITI: ' + failed);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('ERRORE TEST PODIO GIOCHI:', e);
  process.exit(1);
});
