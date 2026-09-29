/* Tema chiaro/scuro nelle pagine di gioco (games/shared/faw-theme.js).
   L'hub salva la scelta in localStorage['faw-theme']: entrando in una partita
   il tema deve restare lo stesso (niente confine). Le pagine con un solo tema
   lo dichiarano e la preferenza salvata non le tocca. */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'games/shared/faw-theme.js'), 'utf8');
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  \u2714', msg); }
  else { failed++; console.log('  \u2718', msg); }
}
function eq(a, b, msg) {
  if (JSON.stringify(a) === JSON.stringify(b)) { passed++; console.log('  \u2714', msg); }
  else { failed++; console.log('  \u2718', msg, '\n    atteso:', JSON.stringify(b), '\n    ottenuto:', JSON.stringify(a)); }
}

function pagina(salvato, fisso) {
  const attr = fisso ? ' data-tema-fisso="' + fisso + '"' : '';
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'http://localhost/games/patata/index.html',
    runScripts: 'dangerously'
  });
  // currentScript non esiste in jsdom quando lo script gira: lo si finge come
  // farebbe un browser, poi si valuta il modulo.
  const w = dom.window;
  Object.defineProperty(w.document, 'currentScript', {
    configurable: true,
    get() {
      const el = w.document.createElement('script');
      if (attr) el.setAttribute('data-tema-fisso', fisso);
      return el;
    }
  });
  if (salvato) w.localStorage.setItem('faw-theme', salvato);
  w.eval(src);
  return w;
}

console.log('\n[1] La preferenza dell\'hub arriva nel gioco');
{
  eq(pagina('dark').document.documentElement.getAttribute('data-theme'), 'dark',
    'faw-theme=dark → <html data-theme="dark">');
  eq(pagina('light').document.documentElement.getAttribute('data-theme'), 'light',
    'faw-theme=light → <html data-theme="light">');
  eq(pagina(null).document.documentElement.getAttribute('data-theme'), 'light',
    'senza preferenza si resta sul chiaro (come l\'hub)');
  eq(pagina('arcobaleno').document.documentElement.getAttribute('data-theme'), 'light',
    'un valore rovinato non rompe la pagina');
}

console.log('\n[2] Pagine con un solo tema');
{
  eq(pagina('light', 'dark').document.documentElement.getAttribute('data-theme'), 'dark',
    'tema fisso scuro: la preferenza chiara non lo cambia');
  eq(pagina('dark', 'dark').FAW_TEMA.attuale(), 'dark', 'tema fisso scuro anche con preferenza scura');
  eq(pagina('light', 'dark').FAW_TEMA.fisso(), 'dark', 'il tema fisso è dichiarato dal modulo');
}

console.log('\n[3] Cambio di tema a pagina aperta');
{
  const w = pagina('light');
  eq(w.FAW_TEMA.imposta('dark'), 'dark', 'imposta() cambia il tema');
  eq(w.document.documentElement.getAttribute('data-theme'), 'dark', 'e lo scrive su <html>');
  eq(w.localStorage.getItem('faw-theme'), 'dark', 'e lo ricorda (come fa l\'hub)');

  /* cambio arrivato da un altro tab */
  const w2 = pagina('light');
  const ev = w2.document.createEvent('Event');
  ev.initEvent('storage', false, false);
  ev.key = 'faw-theme';
  ev.newValue = 'dark';
  w2.dispatchEvent(ev);
  eq(w2.document.documentElement.getAttribute('data-theme'), 'dark', 'cambio da un altro tab: si aggiorna');
  const ev2 = w2.document.createEvent('Event');
  ev2.initEvent('storage', false, false);
  ev2.key = 'altra-cosa';
  ev2.newValue = 'dark';
  w2.dispatchEvent(ev2);
  eq(w2.FAW_TEMA.attuale(), 'dark', 'gli altri valori salvati non toccano il tema');
}

console.log('\n[4] Le pagine dei giochi caricano il tema prima dei CSS');
{
  const attese = {
    'games/patata/index.html': null,
    'games/nomi-cose-citta/index.html': null,
    'games/ruzzle/index.html': 'dark',
    'games/pictionary/index.html': 'dark',
    'games/gameof15/index.html': 'dark'
  };
  Object.keys(attese).forEach((file) => {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const iTema = html.indexOf('faw-theme.js');
    const iCss = html.indexOf('<link rel="stylesheet"');
    ok(iTema !== -1 && iCss !== -1 && iTema < iCss, file + ': faw-theme.js prima dei fogli di stile');
    const tag = html.slice(iTema - 60, iTema + 80);
    const fisso = attese[file];
    if (fisso) ok(new RegExp('data-tema-fisso="' + fisso + '"').test(tag), file + ': tema fisso ' + fisso);
    else ok(!/data-tema-fisso/.test(tag), file + ': segue la preferenza salvata');
  });
}

console.log('\n[5] I giochi chiari hanno davvero un tema scuro');
{
  ['games/patata/css/style.css', 'games/nomi-cose-citta/css/style.css'].forEach((file) => {
    const css = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const blocco = css.match(/:root\[data-theme='dark'\]\s*\{([\s\S]*?)\}/);
    ok(!!blocco, file + ': blocco :root[data-theme=\'dark\'] presente');
    const testo = blocco ? blocco[1] : '';
    ok(/--bg-0:/.test(testo) && /--card:/.test(testo) && /--text-0:/.test(testo),
      file + ': superfici, schede e testo cambiano con il tema');
    ok(/color-scheme:\s*dark/.test(testo), file + ': color-scheme scuro (controlli nativi coerenti)');
  });
}

console.log('\n=================');
console.log('PASSATI: ' + passed + '  FALLITI: ' + failed);
process.exit(failed ? 1 : 0);
