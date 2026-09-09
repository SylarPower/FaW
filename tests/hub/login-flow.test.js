/* Test hub: flusso login completo su pagina reale (mock Firestore)
   Verifica che il redesign non rompa: login, dashboard, card giochi, tema. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  \u2714', msg); }
  else { failed++; console.log('  \u2718', msg); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// hash passato come parametro: la funzione viene serializzata nella pagina
function mockDb(hash) {
  const snapEmpty = { forEach: () => {} };
  const coll = () => ({
    where() { return this; },
    doc(id) {
      return {
        get: async () => ({
          exists: id === 'TEST',
          data: () => ({ passwordHash: hash })
        }),
        set: async () => {}
      };
    },
    get: async () => snapEmpty,
    onSnapshot(cb) {
      queueMicrotask(() => cb(snapEmpty));
      return () => {};
    }
  });
  return { collection: coll };
}

(async () => {
  let html = HTML;
  html = html.replace(/\t*<script src="https:\/\/www\.gstatic\.com[^"]*"><\/script>\n?/g, '');
  html = html.replace(/\t*<script src="games\/shared\/firebase-config\.js"><\/script>\n?/g, '');
  const mock = `
window.__makeDb__ = ${mockDb.toString()};
window.__MOCK_DB__ = window.__makeDb__('${sha256('test123')}');
window.firebase = { initializeApp: function(){ return {}; }, firestore: function(){ return window.__MOCK_DB__; } };
window.FAW_FIREBASE_CONFIG = { apiKey: 'test-key-123', projectId: 'test' };
window.FAW_REQUIRE_FIREBASE_CONFIG = function(){ return window.FAW_FIREBASE_CONFIG; };
`;
  html = html.replace('<script>\n', '<script>\n' + mock);

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const msg = String(e && e.message ? e.message : e);
    if (/Could not load/.test(msg)) return;
    errors.push(msg);
  });
  const dom = new JSDOM(html, {
    url: 'http://localhost/index.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc
  });
  const { window } = dom;
  // crypto.subtle (sha-256) per hashPassword: jsdom non lo implementa
  window.__nodeSubtle = crypto.webcrypto.subtle;
  window.eval('Object.defineProperty(window, "crypto", { value: Object.assign({}, window.crypto, { subtle: window.__nodeSubtle }), configurable: true });');
  await sleep(150);

  console.log('\n[A] Pagina carica: login');
  const login = window.document.getElementById('login-div');
  ok(!!login, 'login-div presente');
  ok(!!window.document.querySelector('.login-card'), 'card login premium');
  ok(!!window.document.querySelector('.login-cta'), 'CTA login');
  ok(!!window.document.querySelector('.faw-stage'), 'scena ambientale');
  ok(errors.length === 0, 'nessun errore uncaught: ' + errors.join('; '));

  console.log('\n[B] Login con utente mock');
  window.document.getElementById('username').value = 'TEST';
  window.document.getElementById('password').value = 'test123';
  window.eval('entra()');
  await sleep(250);
  const mainApp = window.document.getElementById('main-app');
  ok(mainApp.style.display === 'block', 'main-app visibile dopo login');
  ok(window.document.getElementById('login-div').style.display === 'none', 'login nascosto');
  const disp = window.document.getElementById('user-display').textContent;
  ok(disp.includes('TEST'), 'nome utente nel chip: ' + disp);
  const av = window.document.getElementById('user-avatar');
  ok(av.textContent === 'TE', 'avatar con iniziali: ' + av.textContent);
  ok(av.style.getPropertyValue('--h') !== '', 'avatar con tinta deterministica');

  console.log('\n[C] Dashboard premium');
  const cards = window.document.querySelectorAll('.game-card');
  ok(cards.length === 7, '7 card giochi (trovate: ' + cards.length + ')');
  ok(!!window.document.querySelector('#game-patata .g-tag'), 'card patata con tagline');
  ok(window.document.querySelector('#game-ruzzle').classList.contains('selected'), 'ruzzle selezionato di default');
  ok(!!window.document.getElementById('online-count'), 'pill online nell\u2019header');
  ok(!!window.document.getElementById('theme-toggle'), 'toggle tema');
  ok(!!window.document.getElementById('lista-partite'), 'lista partite');
  ok(!!window.document.getElementById('lista-amici'), 'lista amici');
  ok(!!window.document.getElementById('stats-content'), 'statistiche');
  ok(errors.length === 0, 'nessun errore uncaught: ' + errors.join('; '));

  console.log('\n[D] Tema chiaro/scuro');
  const before = window.document.documentElement.getAttribute('data-theme');
  window.eval('fawToggleTheme()');
  const after = window.document.documentElement.getAttribute('data-theme');
  ok(before !== after, 'tema cambiato: ' + before + ' -> ' + after);
  const saved = window.localStorage.getItem('faw-theme');
  ok(saved === after, 'tema persistito in localStorage');
  const btn = window.document.getElementById('theme-toggle');
  ok(btn.textContent.length > 0, 'icona toggle aggiornata: ' + btn.textContent);

  console.log('\n=================');
  console.log('PASSATI: ' + passed + '  FALLITI: ' + failed);
  window.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('ERRORE TEST LOGIN:', e);
  process.exit(1);
});
