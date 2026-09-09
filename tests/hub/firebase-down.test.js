/* Test hub: fallback quando Firebase non si inizializza
   Riproduce il bug "Cannot access 'db' before initialization" al login
   (script hub che moriva in silenzio se CDN/config fallivano). */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  \u2714', msg); }
  else { failed++; console.log('  \u2718', msg); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadHub({ withFirebase, withConfig }) {
  let html = HTML;
  // rimuove gli script esterni (CDN/config) e inietta i mock prima dello script inline
  html = html.replace(/\t*<script src="https:\/\/www\.gstatic\.com[^"]*"><\/script>\n?/g, '');
  html = html.replace(/\t*<script src="games\/shared\/firebase-config\.js"><\/script>\n?/g, '');
  let mock = '';
  if (withFirebase) mock += 'window.firebase = { initializeApp: function(){ return {}; }, firestore: function(){ return { collection: function(){ throw new Error("non usato nel test"); } }; } };\n';
  if (withConfig) mock += 'window.FAW_FIREBASE_CONFIG = { apiKey: "test-key-123", projectId: "test" };\nwindow.FAW_REQUIRE_FIREBASE_CONFIG = function(){ return window.FAW_FIREBASE_CONFIG; };\n';
  html = html.replace('<script>\n', '<script>\n' + mock);
  const errors = [];
  const virtualConsole = new VirtualConsole();
  // solo gli errori "uncaught" contano (i console.error del fallback sono attesi)
  virtualConsole.on('jsdomError', (e) => {
    const msg = String(e && e.message ? e.message : e);
    if (/Could not load/.test(msg)) return; // fetch di risorse esterne assenti: atteso
    errors.push(msg);
  });
  const dom = new JSDOM(html, {
    url: 'http://localhost/index.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole
  });
  const { window } = dom;
  const alerts = [];
  window.alert = (msg) => { alerts.push(String(msg)); };
  await sleep(150); // lascia eseguire lo script inline
  return { window, errors, alerts };
}

(async () => {
  console.log('\n[A] CDN Firebase irraggiungibile (scenario utente)');
  {
    const { window, errors, alerts } = await loadHub({ withFirebase: false, withConfig: true });
    const banner = window.document.querySelector('#login-div .faw-fb-down');
    ok(!!banner, 'avviso visibile in login-div');
    ok(banner && banner.textContent.includes('script Firebase non caricati'),
      'messaggio chiaro sulla causa: ' + (banner ? banner.textContent.slice(0, 80) : '(niente)'));
    // il login NON deve piu' fare TDZ
    window.document.getElementById('username').value = 'TEST';
    window.document.getElementById('password').value = 'test123';
    window.eval('entra()');
    await sleep(50);
    ok(alerts.length === 1 && alerts[0].includes('Firebase non disponibile'),
      'alert login con spiegazione: ' + (alerts[0] ? alerts[0].split('\n')[0] : '(nessun alert)'));
    ok(!alerts.join('\n').includes('before initialization'), 'NESSUN errore "before initialization"');
    ok(errors.length === 0, 'nessun errore uncaught: ' + errors.join('; '));
    window.close();
  }

  console.log('\n[B] Config condivisa mancante');
  {
    const { window, errors } = await loadHub({ withFirebase: true, withConfig: false });
    const banner = window.document.querySelector('#login-div .faw-fb-down');
    ok(!!banner, 'avviso visibile');
    ok(banner && banner.textContent.includes('config Firebase condivisa mancante'),
      'messaggio sulla config: ' + (banner ? banner.textContent.slice(0, 80) : '(niente)'));
    ok(errors.length === 0, 'nessun errore uncaught: ' + errors.join('; '));
    window.close();
  }

  console.log('\n[C] Tutto ok (Firebase + config presenti)');
  {
    const { window, errors } = await loadHub({ withFirebase: true, withConfig: true });
    const banner = window.document.querySelector('.faw-fb-down');
    ok(!banner, 'nessun avviso');
    ok(errors.length === 0, 'nessun errore uncaught: ' + errors.join('; '));
    const dbOk = window.eval('typeof db !== "undefined" && db !== null');
    ok(dbOk, 'db inizializzato');
    window.close();
  }

  console.log('\n=================');
  console.log('PASSATI: ' + passed + '  FALLITI: ' + failed);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('ERRORE TEST HUB:', e);
  process.exit(1);
});
