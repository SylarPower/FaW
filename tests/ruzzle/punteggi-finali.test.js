/* Test Ruzzle: punteggi finali aggiornati e allineati per tutti.
   Tre pagine reali (stesso matchId) condividono un Firestore simulato: si
   verifica che la chiusura della partita scriva IL risultato una volta sola,
   calcolato con una regola unica (duplicati e parole eliminate = 0), e che i
   tre client mostrino gli stessi numeri. Viene esercitato il codice vero
   (listener + chiusura verifica + riconciliazione), non una sua copia. */
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
const dictSample = ['CANE', 'GATTO', 'VOLPE', 'ROSA', 'MARE', 'CASA', 'LUNA', 'STELLA'].join('\n');

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
const PAROLE = {
  ALFA: [{ w: 'CANE', p: 8 }, { w: 'GATTO', p: 10 }, { w: 'VOLPE', p: 12 }],
  BETA: [{ w: 'CANE', p: 8 }, { w: 'ROSA', p: 6 }],
  GAMMA: [{ w: 'VOLPE', p: 12 }, { w: 'MARE', p: 5 }]
};
/* CANE e VOLPE sono in comune (0 punti): restano GATTO 10, ROSA 6, MARE 5. */
const ATTESI = { ALFA: 10, BETA: 6, GAMMA: 5 };
const SCORE = (w) => w.document.getElementById('total-score').textContent;
const BANNER = (w) => {
  const el = w.document.getElementById('game-banner');
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
};

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
      w.eval(podioJs);   // podio condiviso di fine partita
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
      // jsdom non ha il canvas: i festeggiamenti non devono far fallire il test
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
    }
  });
  return dom.window;
}

const doc = () => mock.store.get('partite/P1');
const scritturePunteggi = () => mock.log.filter((w) => w.p === 'partite/P1' && (w.patch || {}).punteggi);
const scrittureChiusura = () => mock.log.filter((w) => w.p === 'partite/P1' && (w.patch || {}).stato === 'conclusa');

(async () => {
  /* La partita parte gia' in verifica con le parole di tutti: ogni client si
     auto-conferma e l'arbitro designato la chiude. */
  mock.store.set('partite/P1', {
    gioco: 'ruzzle',
    partecipanti: ['ALFA', 'BETA', 'GAMMA'],
    parole: PAROLE,
    punteggi: { ALFA: 20, BETA: 14, GAMMA: 17 },   // valori "live", non ancora finali
    pronti: ['ALFA', 'BETA', 'GAMMA'],
    finito: ['ALFA', 'BETA', 'GAMMA'],
    confermaVerifica: [],
    stato: 'verifica',
    dataOra: '2026-09-10 09:00:00',
    timestamp: Date.now()
  });

  const errori = [];
  console.log('\n[1] Tre client sulla stessa partita');
  const a = pagina('ALFA', errori);
  const b = pagina('BETA', errori);
  const c = pagina('GAMMA', errori);
  await until(() => a.document.getElementById('total-score') &&
    b.document.getElementById('total-score') &&
    c.document.getElementById('total-score'), 'pagine caricate');
  ok(errori.length === 0, 'nessun errore uncaught al carico: ' + errori.join('; '));

  console.log('\n[2] Regola di calcolo condivisa (stessa funzione su tutti i client)');
  const daA = JSON.parse(a.eval('JSON.stringify(calcolaPunteggiFinali(currentGameData))'));
  eq(daA, ATTESI, 'ALFA calcola ' + JSON.stringify(ATTESI));
  eq(JSON.parse(b.eval('JSON.stringify(calcolaPunteggiFinali(currentGameData))')), ATTESI,
    'BETA calcola gli stessi valori');
  ok(a.eval('arbitroPunteggi(currentGameData)') === 'ALFA' &&
     b.eval('arbitroPunteggi(currentGameData)') === 'ALFA' &&
     c.eval('arbitroPunteggi(currentGameData)') === 'ALFA',
  'tutti i client scelgono lo stesso arbitro: ALFA');
  const mappaUI = JSON.parse(a.eval(
    'JSON.stringify(punteggiAllineati({ partecipanti: ["A","B"], punteggi: { A: 3 } }))'
  ));
  eq(mappaUI, { A: 3, B: 0 }, 'mappa UI completa: chi manca vale 0');

  console.log('\n[3] Chiusura della verifica: una scrittura sola, risultato giusto');
  ok(await until(() => doc().stato === 'conclusa', 'partita conclusa'), 'partita conclusa');
  eq(doc().punteggi, ATTESI, 'punteggi finali nel documento: ' + JSON.stringify(ATTESI));
  eq(Object.keys(doc().punteggi).sort(), ['ALFA', 'BETA', 'GAMMA'], 'una voce per ogni partecipante');
  ok(scrittureChiusura().length === 1,
    'UNA sola scrittura di chiusura con 3 client (trovate: ' + scrittureChiusura().length + ')');
  ok(scritturePunteggi().length === 1,
    'UNA sola scrittura dei punteggi (trovate: ' + scritturePunteggi().length + ')');
  ok(doc().punteggi.ALFA !== 20, 'i valori "live" precedenti sono stati sostituiti');
  const conferme = mock.log.filter((w) => w.p === 'partite/P1' && (w.patch || {}).confermaVerifica);
  ok(conferme.length === 3, 'ogni client si e\' confermato (' + conferme.length + '/3)');

  console.log('\n[4] I tre client mostrano gli stessi numeri');
  ok(await until(() => SCORE(a) === '10' && SCORE(b) === '6' && SCORE(c) === '5', 'punteggi a video'),
    'punteggio a video: ALFA ' + SCORE(a) + ', BETA ' + SCORE(b) + ', GAMMA ' + SCORE(c));
  await until(() => BANNER(a).length > 0 && BANNER(b).length > 0 && BANNER(c).length > 0, 'banner finale');
  ok(/ALFA: 10 pt/.test(BANNER(a)) && /BETA: 6 pt/.test(BANNER(a)) && /GAMMA: 5 pt/.test(BANNER(a)),
    'banner con tutti i punteggi: ' + BANNER(a).slice(0, 70));
  const rigaPunteggi = (w) => (BANNER(w).match(/ALFA: \d+ pt \| BETA: \d+ pt \| GAMMA: \d+ pt/) || [''])[0];
  ok(rigaPunteggi(a) === 'ALFA: 10 pt | BETA: 6 pt | GAMMA: 5 pt' &&
     rigaPunteggi(a) === rigaPunteggi(b) && rigaPunteggi(b) === rigaPunteggi(c),
  'stessa riga punteggi sui tre client: ' + rigaPunteggi(b));
  const liveB = (b.document.getElementById('live-opponent-score') || {}).textContent || '';
  ok(/ALFA/.test(liveB) && /10/.test(liveB) && /GAMMA/.test(liveB) && /5/.test(liveB),
    'live score di BETA con i punteggi degli altri: ' + liveB.replace(/\s+/g, ' ').trim());

  console.log('\n[5] Parola eliminata dopo la chiusura: punteggi ricalcolati per tutti');
  await mock.db.collection('partite').doc('P1').update({
    paroleEscluse: mock.FieldValue.arrayUnion('GATTO')
  });
  await until(() => (a.eval('currentGameData.paroleEscluse') || []).indexOf('GATTO') !== -1,
    'parola esclusa vista dal client');
  await a.eval('applicaEliminazioneParola("GATTO")');
  ok(await until(() => doc().punteggi.ALFA === 0, 'ricalcolo applicato'),
    'GATTO eliminata: ' + JSON.stringify(doc().punteggi));
  eq(doc().punteggi, { ALFA: 0, BETA: 6, GAMMA: 5 }, 'ALFA perde i 10 punti della parola eliminata');
  ok(await until(() => SCORE(a) === '0' && SCORE(b) === '6' && SCORE(c) === '5', 'display aggiornati'),
    'tutti i client vedono i punteggi aggiornati');

  console.log('\n[6] Riconciliazione: un punteggio sbagliato viene riscritto');
  const prima = scritturePunteggi().length;   // prima della scrittura sbagliata
  await mock.db.collection('partite').doc('P1').update({ punteggi: { ALFA: 99, BETA: 6, GAMMA: 5 } });
  ok(await until(() => doc().punteggi.ALFA === 0, 'punteggio corretto'),
    'l\'arbitro riscrive il punteggio sbagliato: ' + JSON.stringify(doc().punteggi));
  ok(scritturePunteggi().length === prima + 2,
    'scrittura sbagliata + UNA sola correzione (delta: ' + (scritturePunteggi().length - prima) + ')');
  await sleep(800);
  ok(scritturePunteggi().length === prima + 2,
    'nessun loop di scritture (totale: ' + scritturePunteggi().length + ')');
  ok(await until(() => SCORE(a) === '0' && SCORE(b) === '6' && SCORE(c) === '5', 'display allineati'),
    'display allineati dopo la riconciliazione');

  console.log('\n[7] Podio di fine partita (posizioni e punteggi)');
  const podio = (pw) => Array.from(pw.document.querySelectorAll('#podio .pod-col'));
  ok(await until(() => podio(a).length === 3 && podio(b).length === 3 && podio(c).length === 3,
    'podio su tutti i client'), 'podio con tutti e tre i giocatori su ogni client');
  const nomePodio = (col) => col.querySelector('.pod-name').textContent.replace(' (TU)', '');
  eq(podio(a).map(nomePodio), ['BETA', 'GAMMA', 'ALFA'],
    'ordine per punteggio decrescente (BETA 6, GAMMA 5, ALFA 0 dopo l\'eliminazione)');
  eq(podio(a).map((col) => col.querySelector('.pod-bar').textContent), ['6', '5', '0'],
    'punteggi finali corretti nei gradini');
  eq(podio(a).map((col) => parseInt(col.querySelector('.pod-bar').style.height, 10)), [104, 88, 72],
    'gradino del 1° più alto, poi via via più basso');
  eq(podio(a).map((col) => col.className.replace('pod-col ', '')), ['p1', 'p2', 'p3'],
    'classi di posizione p1/p2/p3');
  ok(a.document.getElementById('podio').style.display === 'flex', 'podio visibile a partita conclusa');
  const marcato = (pw) => podio(pw).filter((col) => col.textContent.indexOf('(TU)') !== -1).map(nomePodio);
  eq(marcato(a), ['ALFA'], 'ALFA marcato (TU) solo sul proprio client');
  eq(marcato(b), ['BETA'], 'BETA marcato (TU) solo sul proprio client');
  eq(marcato(c), ['GAMMA'], 'GAMMA marcato (TU) solo sul proprio client');
  eq(podio(a).map(nomePodio), podio(b).map(nomePodio),
    'stesso ordine del podio su client diversi');

  console.log('\n[8] Tema chiaro: testo leggibile nei modali');
  const paginaCss = fs.readFileSync(path.join(ROOT, 'games/ruzzle/index.html'), 'utf8');
  const rootCss = paginaCss.slice(paginaCss.indexOf(':root {'), paginaCss.indexOf('body.dark-mode {'));
  const hex = (v) => [1, 3, 5].map((i) => parseInt(v.substr(i, 2), 16));
  const lum = (rgb) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  };
  const contrasto = (a, b) => {
    const l1 = lum(hex(a)), l2 = lum(hex(b));
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const variabile = (n) => (rootCss.match(new RegExp('--' + n + ':\\s*(#[0-9a-fA-F]{6})')) || [])[1] || null;
  ['item-bg', 'item-text', 'accent-strong', 'primary-strong'].forEach((n) => {
    ok(/^#[0-9a-fA-F]{6}$/.test(variabile(n) || ''), 'variabile --' + n + ' definita nel tema chiaro: ' + variabile(n));
  });
  const fondo = variabile('item-bg');
  [['item-text', 'testo di "Cosa mi sono perso" e delle statistiche'],
   ['accent-strong', 'punti della parola (mw-p)'],
   ['primary-strong', 'valore delle statistiche (stat-val)']].forEach(([n, cosa]) => {
    const c = contrasto(fondo, variabile(n));
    ok(c >= 4.5, cosa + ': contrasto ' + c.toFixed(2) + ' su sfondo chiaro (>= 4.5)');
  });
  ok(/\.modal-content \.missed-words-list li,[\s\S]{0,120}color: var\(--item-text\)/.test(paginaCss),
    'le schede nei modali usano --item-text (non un colore chiaro fisso)');
  ok(/#podio\s*\{[\s\S]{0,400}--podio-text:\s*var\(--item-text\)/.test(paginaCss),
    'il podio segue il tema (testo leggibile anche nel tema chiaro)');
  ok(/\.modal-content \.missed-words-list \.mw-p \{ color: var\(--accent-strong\); \}/.test(paginaCss),
    'i punti della parola usano --accent-strong');
  /* jsdom non risolve var(): il tema viene verificato dal CSS. Anche il tema
     scuro deve definire un --item-text chiaro, leggibile sulla scheda scura. */
  const darkCss = paginaCss.slice(paginaCss.indexOf('body.dark-mode {'));
  const darkText = (darkCss.match(/--item-text:\s*(#[0-9a-fA-F]{6})/) || [])[1] || null;
  ok(/^#[0-9a-fA-F]{6}$/.test(darkText || ''), 'tema scuro: --item-text definito (' + darkText + ')');
  ok(darkText ? lum(hex(darkText)) > 0.5 : false,
    'tema scuro: testo chiaro sulla scheda scura');
  ok(/\.modal-content\s*\{[\s\S]{0,900}color:\s*#eef1fa/.test(paginaCss),
    'il modale resta scuro in entrambi i temi (testo chiaro fuori dalle schede)');

  ok(errori.length === 0, 'nessun errore uncaught finale: ' + errori.join('; '));
  console.log('   letture get:', mock.readsGet, '| scritture:', mock.writes);

  console.log('\n=================');
  console.log('PASSATI: ' + passed + '  FALLITI: ' + failed);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('ERRORE TEST PUNTEGGI RUZZLE:', e);
  process.exit(1);
});
