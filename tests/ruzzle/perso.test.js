/* Test Ruzzle: "Cosa mi sono perso" mostra SEMPRE e SOLO le parole mancanti
   del giocatore loggato.
   Alla fine della partita l'analisi preseleziona il vincitore e `foundWords`
   viene riempito con le SUE parole: se il pulsante usasse quell'elenco, un
   giocatore che non ha vinto vedrebbe le parole mancanti di un altro. Qui si
   esercita la pagina vera (griglia compresa) su un mock Firestore, con un
   dizionario minimo che rende il calcolo deterministico. */
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
const modaleJs = fs.readFileSync(path.join(ROOT, 'games/shared/faw-modale.js'), 'utf8');
/* Dizionario minimo: sulla griglia del test si formano solo CANE e MARE. */
const dictSample = ['CANE', 'MARE', 'GATTO', 'LUNA'].join('\n');
/* Le stesse parole scritte dai due giocatori: CANE è in comune (0 punti),
   MARE la trova solo BETA (che quindi è il vincitore preselezionato). */
const PAROLE = {
  ALFA: [{ w: 'CANE', p: 1, path: [0, 1, 2, 3] }],
  BETA: [{ w: 'CANE', p: 1, path: [0, 1, 2, 3] }, { w: 'MARE', p: 1, path: [5, 6, 7, 8] }]
};

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
async function until(fn, what, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (fn()) return true;
    await sleep(60);
  }
  console.log('  \u2718 timeout in attesa di:', what);
  failed++;
  return false;
}

const mock = createMockFirestore();

function pagina(nome, errori) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const msg = String(e && e.message ? e.message : e);
    if (/Could not load|Not implemented/.test(msg)) return;
    errori.push(nome + ': ' + msg);
  });
  const dom = new JSDOM(html, {
    url: 'http://localhost/games/ruzzle/index.html?matchId=P1',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.eval(podioJs);
      w.eval(bannerJs);   // banner/toast condivisi
      w.eval(modaleJs);   // modali condivise (Esc, sfondo, aria)
      w.eval(bannerJs);   // banner/toast condivisi
      w.localStorage.setItem('mioNome', nome);
      w.firebase = makeFirebaseGlobal(mock);
      w.FAW_FIREBASE_CONFIG = { apiKey: 'test-key', projectId: 'test' };
      w.FAW_REQUIRE_FIREBASE_CONFIG = () => w.FAW_FIREBASE_CONFIG;
      w.fetch = async (url) => {
        if (String(url).indexOf('dizionario') !== -1) return { ok: true, status: 200, text: async () => dictSample };
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

/* Sulla griglia (riga 0 = C A N E, riga 1 = M A R E, resto X) si formano
   esattamente CANE e MARE: 4 lettere = 1 punto ciascuna. */
function preparaGriglia(w) {
  const gs = Number(w.eval('gridSize')) || 5;
  const letters = new Array(gs * gs).fill('X');
  'CANE'.split('').forEach((c, i) => { letters[i] = c; });
  'MARE'.split('').forEach((c, i) => { letters[gs + i] = c; });
  const bonuses = new Array(gs * gs).fill(null);
  w.eval('gridEl.dataset.letters = ' + JSON.stringify(JSON.stringify(letters)) + ';' +
    'gridEl.dataset.bonuses = ' + JSON.stringify(JSON.stringify(bonuses)) + ';');
  return { gs, letters };
}

const parolePers = (w) => Array.from(w.document.querySelectorAll('#missed-words-list li'))
  .map((li) => li.querySelector('.mw-w').textContent.trim());
const riepilogo = (w) => w.document.getElementById('missed-summary').textContent.trim();

async function apriPersi(w, errori) {
  const btn = w.document.getElementById('btn-missed');
  btn.dispatchEvent(new w.Event('click', { bubbles: true }));
  await until(() => w.document.getElementById('missed-words-modal').style.display === 'flex',
    'modale "Cosa mi sono perso" aperto');
  await until(() => w.document.querySelectorAll('#missed-words-list li').length > 0 ||
    /perso niente/.test(riepilogo(w)), 'calcolo parole mancanti concluso', 15000);
  if (errori && errori.length) console.log('   [jsdomError]', errori[0]);
}

/* La modale "Cosa mi sono perso" è una vera finestra: ruolo di dialogo e
   chiusura con Esc, come tutte le modali della piattaforma. */
async function modaleAccessibile(w) {
  const el = w.document.getElementById('missed-words-modal');
  const aria = [el.getAttribute('role'), el.getAttribute('aria-modal')];
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await until(() => el.style.display === 'none', 'Esc chiude la modale');
  return aria;
}

(async () => {
  mock.store.set('partite/P1', {
    gioco: 'ruzzle',
    partecipanti: ['ALFA', 'BETA'],
    parole: PAROLE,
    punteggi: { ALFA: 0, BETA: 1 },
    pronti: ['ALFA', 'BETA'],
    finito: ['ALFA', 'BETA'],
    confermaVerifica: ['ALFA', 'BETA'],
    paroleEscluse: [],
    stato: 'conclusa',
    opzioni: { tempo: '60', griglia: '5', mode: 'classic', seed: 'PERSO1' },
    dataOra: '2026-09-27 10:00:00',
    timestamp: Date.now()
  });

  const errori = [];
  console.log('\n[1] Analisi di fine partita: la vista mostra il vincitore');
  const a = pagina('ALFA', errori);
  const b = pagina('BETA', errori);
  await until(() => a.document.getElementById('sel-analisi') &&
    b.document.getElementById('sel-analisi'), 'analisi attiva su entrambe le pagine');
  ok(errori.length === 0, 'nessun errore uncaught al carico: ' + errori.join('; '));
  preparaGriglia(a);
  preparaGriglia(b);

  eq(a.document.getElementById('sel-analisi').value, 'BETA',
    'la selezione "MOSTRA PAROLE DI:" parte dal vincitore (BETA)');
  ok(await until(() => a.eval('foundWords.size') === 2, 'parole del vincitore caricate'),
    'la lista a video contiene le parole di BETA (' + a.eval('foundWords.size') + ')');
  eq(Array.from(a.eval('Array.from(foundWords.keys())')).sort(), ['CANE', 'MARE'],
    'parole a video = quelle di BETA (precondizione del bug)');

  console.log('\n[2] ALFA: "Cosa mi sono perso" = solo le SUE parole mancanti');
  eq(Array.from(a.eval('Array.from(mieParoleTrovate()).sort()')), ['CANE'],
    'le parole trovate da ALFA sono le sue (CANE), non quelle di BETA');
  await apriPersi(a, errori);
  eq(parolePers(a), ['MARE'],
    'unica parola mancante di ALFA: MARE (' + parolePers(a).join(', ') + ')');
  ok(/ALFA/.test(riepilogo(a)), 'il riepilogo dice di chi sono le parole: "' + riepilogo(a) + '"');
  ok(/1 parole|1 parola/.test(riepilogo(a)) || /ne restavano 1/.test(riepilogo(a)),
    'il riepilogo conta le parole trovate da ALFA (1), non quelle del vincitore (2)');

  console.log('\n[2b] La modale è una finestra accessibile');
  {
    const aria = await modaleAccessibile(a);
    eq(aria, ['dialog', 'true'], 'role="dialog" e aria-modal="true" sulla modale');
    await until(() => a.document.getElementById('missed-words-modal').getAttribute('aria-hidden') === 'true',
      'aria-hidden coerente quando è chiusa');
  }

  console.log('\n[3] Cambiare la vista non cambia le parole mancanti');
  const sel = a.document.getElementById('sel-analisi');
  sel.value = 'ALFA';
  sel.dispatchEvent(new a.Event('change', { bubbles: true }));
  await until(() => a.eval('foundWords.size') === 1, 'vista passata ad ALFA');
  await apriPersi(a, errori);
  eq(parolePers(a), ['MARE'], 'dopo il cambio di vista la parola mancante resta MARE');
  a.document.getElementById('missed-words-modal').style.display = 'none';
  a.eval('closeMissedWords()');

  console.log('\n[4] BETA (vincitore, che ha trovato tutto): niente da recuperare');
  eq(Array.from(b.eval('Array.from(mieParoleTrovate()).sort()')), ['CANE', 'MARE'],
    'le parole di BETA sono entrambe sue');
  await apriPersi(b, errori);
  eq(parolePers(b), [], 'nessuna parola mancante per chi ha trovato tutto');
  ok(/Non ti sei perso niente/.test(riepilogo(b)) && /BETA/.test(riepilogo(b)),
    'riepilogo dedicato a BETA: "' + riepilogo(b) + '"');

  console.log('\n[5] Parola esclusa dal vocabolario: non entra mai fra le mancanti');
  await mock.db.collection('partite').doc('P1').update({
    paroleEscluse: mock.FieldValue.arrayUnion('CANE')
  });
  await until(() => (a.eval('currentGameData.paroleEscluse') || []).indexOf('CANE') !== -1,
    'esclusione di CANE vista da ALFA');
  /* La griglia non cambia: CANE resta disegnata ma non è più una parola. */
  await apriPersi(a, errori);
  eq(parolePers(a).indexOf('CANE'), -1, 'CANE esclusa non compare fra le parole mancanti');
  eq(parolePers(a), ['MARE'], 'restano solo le parole valide mancanti (MARE)');

  console.log('\n=================');
  console.log('PASSATI: ' + passed + '  FALLITI: ' + failed);
  process.exit(failed ? 1 : 0);
})();
