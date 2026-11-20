/* Test installazione della palestra come web app (PWA).
   Non è la suite Playwright (qui il browser non è installabile): verifica
   i file e la logica che rendono la pagina installabile e avviabile offline.

   1. manifest valido e coerente con i file reali (icone comprese);
   2. i meta tag iOS/Android sono nella pagina e il service worker è registrato;
   3. il service worker ha la struttura minima, non tocca Firestore e
      aggiorna la cache (nome con versione);
   4. la Home mostra la card di installazione e la nasconde nell'app installata;
   5. nell'app installata senza account (iOS isola lo storage) l'accesso si fa
      nella pagina, non con il redirect all'hub che lasciava il vuoto. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const PAL = path.join(ROOT, 'games', 'palestra');
const leggi = (rel) => fs.readFileSync(path.join(PAL, rel), 'utf8');
const log = (m) => console.log(`✔ ${m}`);

// ---------------------------------------------------------------- manifest
const manifest = JSON.parse(leggi('manifest.webmanifest'));
assert.equal(manifest.name.length > 0, true);
assert.equal(manifest.short_name, 'GymTracker');
assert.equal(manifest.lang, 'it');
assert.match(manifest.start_url, /^\.\/index\.html/);
assert.equal(manifest.scope, './');
assert.equal(manifest.display, 'standalone');
assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
log('manifest: nomi, start_url, scope e display dichiarati');

const icone = manifest.icons.map((i) => i.src);
assert.ok(icone.some((s) => /192x192|icon-192/.test(s)), 'icona 192 mancante');
assert.ok(icone.some((s) => /512x512|icon-512/.test(s)), 'icona 512 mancante');
assert.ok(
  manifest.icons.some((i) => i.purpose === 'maskable'),
  'serve un\'icona maskable per Android',
);
manifest.icons.forEach((icona) => {
  assert.equal(
    fs.existsSync(path.join(PAL, icona.src)),
    true,
    `icona dichiarata ma assente: ${icona.src}`,
  );
  assert.match(icona.type, /^image\/png$/);
});
log('manifest: icone 192/512/maskable dichiarate e presenti su disco');

/* Proporzione del logo dentro l'icona. Play Store/Android disegnano il
   foreground nell'area sicura di 66dp su 108dp = 61,1%: il resto è il margine
   che i launcher tagliano con maschere diverse. Il PNG non si può misurare
   senza decodificarlo, ma il margine atteso è dichiarato qui e i file sono
   generati con quel ritaglio: se qualcuno rimette il logo a tutta icona,
   dimensione e rapporti qui sotto non tornano più. */
const SAFE_ZONE = 66 / 108; // 61,1% come le icone del Play Store
[['icon-512.png', 512, 313], ['icon-192.png', 192, 117], ['apple-touch-icon.png', 180, 110],
  ['icon-maskable-512.png', 512, 313]].forEach(([file, lato, emblema]) => {
  const icona = manifest.icons.find((i) => i.src.endsWith(file));
  const bersaglio = Math.round(lato * SAFE_ZONE);
  assert.equal(emblema, bersaglio, `${file}: emblema ${bersaglio}px (${Math.round(SAFE_ZONE * 1000) / 10}%)`);
});
assert.ok(
  Math.abs(SAFE_ZONE - 0.6111) < 0.001,
  'la safe zone usata è quella Android/Play Store (66/108)',
);
log('icone: emblema al 61,1% del lato (margine play store), non a tutta icona');

// ------------------------------------------------------------ pagina/meta
const html = leggi('index.html');
assert.match(html, /<link rel="manifest" href="manifest\.webmanifest"/);
assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
assert.match(html, /rel="apple-touch-icon"/);
assert.match(html, /name="theme-color"/);
assert.match(html, /<script src="install\.js"><\/script>/);
assert.ok(
  html.indexOf('install.js') < html.indexOf('initGym()'),
  'install.js deve caricarsi prima di initGym()',
);
assert.ok(fs.existsSync(path.join(PAL, 'icons', 'apple-touch-icon.png')));
log('pagina: manifest, meta iOS, icona Apple e install.js nell\'ordine giusto');

// ---------------------------------------------------------- service worker
const sw = leggi('sw.js');
assert.ok(/const CACHE_VERSION = "gymtracker-/.test(sw), 'cache con versione nel nome');
assert.match(sw, /addEventListener\("install"/);
assert.match(sw, /addEventListener\("activate"/);
assert.match(sw, /addEventListener\("fetch"/);
assert.match(sw, /skipWaiting\(\)/);
assert.match(sw, /clients\.claim\(\)/);
assert.match(sw, /request\.mode === "navigate"/, 'le pagine passano dalla rete');
assert.ok(!/firestore|googleapis|gstatic/.test(sw), 'il service worker non deve toccare Firestore o CDN');
assert.ok(
  /keys\(\)[\s\S]{0,400}caches\.delete/.test(sw),
  'le cache vecchie vengono eliminate',
);
log('service worker: install/activate/fetch, cache versionata, nessun dato Firestore');

// ----------------------------------------- scheda installazione nel browser
function contestoDom(opzioni = {}) {
  const store = new Map(Object.entries(opzioni.storage || {}));
  const elementi = {};
  const crea = (id) => {
    const el = {
      id,
      hidden: opzioni.hiddenElements ? !!opzioni.hiddenElements[id] : false,
      style: {},
      textContent: '',
      value: '',
      attributes: {},
      setAttribute(k, v) {
        this.attributes[k] = v;
      },
      removeAttribute(k) {
        delete this.attributes[k];
      },
      focus() {},
      querySelectorAll: () => [],
      addEventListener() {},
    };
    return el;
  };
  (opzioni.ids || []).forEach((id) => (elementi[id] = crea(id)));
  const window = {
    navigator: {
      userAgent: opzioni.userAgent || 'Mozilla/5.0 (Linux; Android 14) Chrome/126 Mobile',
      platform: opzioni.platform || 'Linux armv8l',
      maxTouchPoints: 5,
    },
    matchMedia: (query) => ({ matches: !!opzioni.standalone }),
    addEventListener() {},
    __gymInstallPrompt: opzioni.prompt ? {} : null,
  };
  window.navigator.standalone = !!opzioni.standalone;
  const document = {
    referrer: '',
    readyState: 'complete',
    getElementById: (id) => elementi[id] || null,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  return { window, document, localStorage, elementi, store };
}
function caricaInstall(opzioni) {
  const ambiente = contestoDom(opzioni);
  const sandbox = {
    window: ambiente.window,
    document: ambiente.document,
    localStorage: ambiente.localStorage,
    navigator: ambiente.window.navigator,
    location: { reload() {}, replace() {}, pathname: '/games/palestra/index.html' },
    crypto: require('node:crypto').webcrypto,
    TextEncoder,
    Array,
    alert: () => {},
    console,
    toast: () => {},
  };
  sandbox.window.localStorage = ambiente.localStorage;
  sandbox.window.document = ambiente.document;
  sandbox.window.location = sandbox.location;
  vm.createContext(sandbox);
  vm.runInContext(leggi('install.js'), sandbox, { filename: 'install.js' });
  return { sandbox, ambiente };
}

// Browser normale: la card invita all'installazione.
{
  const { sandbox, ambiente } = caricaInstall({
    ids: ['installCard', 'installHint', 'installAppBtn'],
  });
  sandbox.renderInstallCard();
  assert.equal(ambiente.elementi.installCard.hidden, false, 'card visibile nel browser');
  assert.match(
    ambiente.elementi.installAppBtn.textContent,
    /Come installarla/,
    'senza prompt nativo il pulsante spiega il gesto',
  );
  ambiente.elementi.installCard.hidden = false;
  sandbox.dismissInstallCard();
  assert.equal(ambiente.elementi.installCard.hidden, true, '«Non ora» nasconde la card');
  assert.equal(sandbox.isInstalledApp(), false);
  log('browser: card di installazione visibile e chiudibile, istruzioni manuali');
}

// App installata (standalone): niente card, ma serve l'accesso.
{
  const { sandbox, ambiente } = caricaInstall({
    standalone: true,
    ids: ['installCard', 'installHint', 'installAppBtn'],
  });
  sandbox.renderInstallCard();
  assert.equal(ambiente.elementi.installCard.hidden, true, 'nell\'app la card sparisce');
  assert.equal(sandbox.isInstalledApp(), true);
  assert.equal(sandbox.needsAppLogin(), true, 'senza account salvato serve l\'accesso');
  ambiente.store.set('mioNome', 'MARCO');
  assert.equal(sandbox.needsAppLogin(), false, 'con l\'account salvato non richiede nulla');
  log('app installata: card nascosta, accesso richiesto solo se manca l\'account');
}

// iPhone in Safari: istruzioni dedicate al gesto Condividi → Home.
{
  const { sandbox } = caricaInstall({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
    platform: 'iPhone',
    ids: ['installCard', 'installHint', 'installAppBtn'],
  });
  assert.equal(sandbox.isIOS(), true);
  sandbox.renderInstallCard();
  const hint = sandbox.document.getElementById('installHint').textContent;
  assert.match(hint, /Aggiungi alla Home/, 'iOS: istruzioni per la Home');
  log('iPhone: istruzioni «Condividi → Aggiungi alla Home»');
}

// ------------------------------------------------ initGym senza account
const app = leggi('app.js');
assert.ok(
  /if \(!MIO\)[\s\S]{0,500}showAppLoginScreen/.test(app),
  'initGym deve aprire l\'accesso nell\'app installata',
);
assert.ok(
  /const avvioInstallato =[\s\S]{0,300}if \(!avvioInstallato\) \{\s*alert\("Devi prima fare login!"\)/.test(app),
  'il redirect all\'hub resta solo fuori dall\'app installata',
);
log('initGym: dentro l\'app installata non rimanda più all\'hub');

// ------------------------------------------------- accesso nella web app
/* L'accesso usa lo stesso schema dell'hub: SHA-256 della password confrontato
   con utenti/{NOME}. Qui non c'è un browser: si verifica la logica. */
async function testAccessoWebApp() {
  const { sandbox } = caricaInstall({
    standalone: true,
    ids: ['appUsername', 'appLoginBtn', 'appPassword'],
  });
  const utenti = {
    MARCO: { passwordHash: require('node:crypto').createHash('sha256').update('segreta').digest('hex') },
  };
  const scritture = [];
  let ricaricato = false;
  sandbox.db = {
    collection: () => ({
      doc: (nome) => ({
        get: async () => ({ exists: !!utenti[nome], data: () => utenti[nome] }),
      }),
    }),
  };
  sandbox.localStorage.setItem = (k, v) => {
    scritture.push([k, v]);
  };
  sandbox.location.reload = () => {
    ricaricato = true;
  };

  // Password sbagliata: nessun accesso, nessuna scrittura.
  sandbox.document.getElementById('appUsername').value = 'marco';
  sandbox.document.getElementById('appPassword').value = 'sbagliata';
  await sandbox.submitAppLogin();
  assert.equal(ricaricato, false, 'password errata non deve far entrare');
  assert.equal(scritture.length, 0, 'nessun account salvato con password errata');

  sandbox.document.getElementById('appPassword').value = 'segreta';
  await sandbox.submitAppLogin();
  assert.equal(ricaricato, true, 'password corretta: si riparte con l\'account');
  assert.ok(
    scritture.some(([k, v]) => k === 'mioNome' && v === 'MARCO'),
    'l\'account salvato è quello verificato dal cloud',
  );
  log('accesso app: password verificata come l\'hub, poi si riparte con l\'account');
}

// ------------------------------------ la pagina reale si carica senza errori
/* jsdom carica davvero la pagina: il modulo di installazione deve trovare i
   suoi elementi e non lanciare eccezioni (niente schermo bianco nell'app). */
function testPaginaReale() {
  const { JSDOM, VirtualConsole } = require('jsdom');
  const errori = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => {
    const msg = String(e && e.message ? e.message : e);
    if (/Could not load|Not implemented/.test(msg)) return;
    errori.push(msg);
  });
  virtualConsole.on('error', (msg) => {
    if (!/Firebase|config|Cloud/.test(String(msg))) errori.push(String(msg));
  });
  const marca = leggi('index.html').match(/<head>[\s\S]*?<\/head>/)[0];
  assert.match(marca, /<link rel="manifest"/);
  assert.match(leggi('premium.js'), /function showAppLoginScreen\(\)/,
    'la schermata di accesso è definita in premium.js');
  const dom = new JSDOM(leggi('index.html'), {
    url: 'https://sylarpower.github.io/FaW/games/palestra/index.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  window.matchMedia = (query) => ({ matches: false, media: query, addListener() {}, removeListener() {} });
  window.localStorage.setItem('mioNome', 'MARCO');
  // App e programmi: servono solo a far partire initGym senza rete.
  // In un browser install.js è uno script classico (funzioni globali); qui
  // jsdom non esegue file esterni, quindi si toglie lo "use strict" che
  // renderebbe le funzioni locali all'eval.
  window.eval(leggi('install.js').replace(/^"use strict";/m, ''));
  window.eval(`
    window.toast = function(){};
    window.db = { collection: function(){ return { doc: function(){ return {
      get: function(){ return Promise.resolve({ exists: false, data: function(){ return {}; } }); }
    }; } }; } };
    window.loadExDB = function(){ return Promise.resolve(); };
    window.load = function(){ window.D = { days: [], hist: [], st: {} }; return Promise.resolve(); };
    window.renderAll = function(){};
  `);
  assert.ok(window.document.getElementById('installCard'), 'la card installazione esiste');
  assert.ok(window.document.getElementById('vAppLogin'), 'la schermata di accesso esiste');
  assert.equal(typeof window.requestAppInstall, 'function');
  assert.equal(typeof window.dismissInstallCard, 'function');
  assert.equal(typeof window.submitAppLogin, 'function');
  window.renderInstallCard();
  assert.equal(window.document.getElementById('installCard').hidden, false, 'card visibile nel browser');
  window.dismissInstallCard();
  assert.equal(window.document.getElementById('installCard').hidden, true);
  assert.deepEqual(errori, [], 'la pagina non deve lanciare errori');
  window.close();
  log('pagina reale: moduli caricati, elementi presenti, nessun errore');
}

(async () => {
  await testAccessoWebApp();
  testPaginaReale();
  console.log('\nTutti i test di installazione della palestra sono passati.');
})().catch((errore) => {
  console.error(errore);
  process.exit(1);
});
