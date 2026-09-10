/* E2E MULTIPLAYER (jsdom) di Patata Bollente.
   Due pagine reali condividono un Firestore simulato (tests/ncc/mock-firestore.js,
   riusato perché è un mock "compat" generico): vengono esercitati UI + backend
   reali, non una reimplementazione.
   Verifica in particolare la richiesta "si può scrivere SEMPRE per prepararsi":
   - la casella di chi NON ha la patata non è disabilitata;
   - la parola preparata resta nella casella (bozza) e non scrive nulla;
   - la bozza sopravvive al passaggio della patata e si invia al proprio turno;
   - a fine partita il podio ha il vincitore sul gradino più alto. */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { createMockFirestore, makeFirebaseGlobal } = require('../ncc/mock-firestore.js');

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'games/patata/index.html'), 'utf8');
const gameJs = fs.readFileSync(path.join(ROOT, 'games/patata/js/game.js'), 'utf8');
const cfgJs = fs.readFileSync(path.join(ROOT, 'games/shared/firebase-config.js'), 'utf8');
const podioJs = fs.readFileSync(path.join(ROOT, 'games/shared/podio.js'), 'utf8');
const dictSample = fs.readFileSync(path.join(ROOT, 'dizionario.txt'), 'utf8')
  .split('\n').slice(0, 20000).join('\n');

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
async function until(fn, what, timeout = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (fn()) return true;
    await sleep(80);
  }
  console.log('  \u2718 timeout in attesa di:', what);
  failed++;
  return false;
}

const mock = createMockFirestore();

function pagina(nome) {
  const dom = new JSDOM(html, {
    url: 'http://localhost/games/patata/index.html?matchId=P1',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const w = dom.window;
  w.localStorage.setItem('mioNome', nome);
  w.fetch = async (url) => {
    if (String(url).indexOf('dizionario') !== -1) return { ok: true, status: 200, text: async () => dictSample };
    throw new Error('no network: ' + url);
  };
  w.firebase = makeFirebaseGlobal(mock);
  // jsdom non implementa la Web Animations API (usata dai coriandoli di fine partita)
  w.Element.prototype.animate = function () { return { onfinish: null, cancel: function () {} }; };
  w.eval(cfgJs);
  w.eval(podioJs);   // podio condiviso di fine partita
  w.eval(gameJs);
  return w;
}
const input = (w) => w.document.getElementById('word-input');
const btnInvia = (w) => w.document.getElementById('btn-invia');
function scrivi(w, parola) {
  input(w).value = parola;
  input(w).dispatchEvent(new w.Event('input', { bubbles: true }));
}
function invia(w) {
  btnInvia(w).dispatchEvent(new w.Event('click', { bubbles: true }));
}

(async () => {
  mock.store.set('partite/P1', {
    gioco: 'patata',
    partecipanti: ['ALFA', 'BETA'],
    punteggi: {}, parole: {}, pronti: [], stato: 'attesa',
    rivincitaAccettataDa: [], rivincitaRifiutataDa: [],
    opzioni: { tempo: '8', turni: '1', lettere: '2', mode: 'classic', seed: 'SEEDTEST' },
    dataOra: '2026-09-09 09:00:00',
    timestamp: Date.now()
  });

  console.log('\n[1] Due pagine sulla stessa partita');
  const a = pagina('ALFA');
  const b = pagina('BETA');
  ok(await until(() => a.document.getElementById('screen-game') &&
    !a.document.getElementById('screen-game').classList.contains('hidden'), 'schermata di gioco ALFA'),
  'ALFA in gioco');
  ok(await until(() => !b.document.getElementById('screen-game').classList.contains('hidden'), 'schermata di gioco BETA'),
  'BETA in gioco');
  eq(mock.store.get('partite/P1').turno.giocatore, 'ALFA', 'la patata parte da ALFA');

  const stA = a.document.defaultView.__PATATA.state;
  const letters = a.document.defaultView.__PATATA.lettersFor(stA);
  console.log('   lettere del turno:', letters.join(''));
  const diz = Array.from(a.document.defaultView.__PATATA.dict);
  const valide = diz.filter((w) => w.length >= 4 && letters.every((l) => w.indexOf(l) !== -1));
  ok(valide.length >= 2, 'almeno due parole valide disponibili: ' + valide.length);
  const parolaAlfa = valide[0];
  const parolaBeta = valide.find((w) => w !== parolaAlfa);

  console.log('\n[2] Chi NON ha la patata può scrivere per prepararsi');
  ok(!input(b).disabled, 'casella di BETA NON disabilitata mentre gioca ALFA');
  ok(!btnInvia(b).disabled, 'pulsante di BETA NON disabilitato');
  eq(btnInvia(b).textContent, 'PREPARA', 'etichetta del pulsante fuori turno: ' + btnInvia(b).textContent);
  ok(/tocca a te/i.test(a.document.getElementById('input-prep').textContent),
    'chi ha il turno vede l\'invito a inviare: ' +
    a.document.getElementById('input-prep').textContent.trim());
  ok(/puoi già scrivere/i.test(b.document.getElementById('input-prep').textContent),
    'chi aspetta vede l\'invito a prepararsi');

  console.log('\n[3] La bozza non scrive nulla e non passa la patata');
  scrivi(b, parolaBeta);
  eq(btnInvia(b).textContent, '✔ PRONTA', 'etichetta aggiornata mentre si prepara: ' + btnInvia(b).textContent);
  ok(input(b).classList.contains('bozza'), 'classe .bozza sulla casella');
  const scritturePrima = mock.writes;
  invia(b);
  await sleep(300);
  ok(/pronta/i.test(b.document.getElementById('feedback').textContent),
    'feedback di preparazione: ' + b.document.getElementById('feedback').textContent.trim());
  eq(mock.writes, scritturePrima, 'nessuna scrittura su Firestore per la preparazione');
  eq(mock.store.get('partite/P1').turno.giocatore, 'ALFA', 'la patata è ancora di ALFA');
  eq(mock.store.get('partite/P1').storia || [], [], 'nessuna parola registrata fuori turno');
  eq(input(b).value, parolaBeta, 'la parola preparata resta nella casella');

  console.log('\n[4] ALFA gioca: la bozza di BETA sopravvive al passaggio');
  scrivi(a, parolaAlfa);
  invia(a);
  ok(await until(() => (mock.store.get('partite/P1').storia || []).length === 1, 'prima parola registrata'),
    'parola di ALFA accettata');
  eq(mock.store.get('partite/P1').turno.giocatore, 'BETA', 'la patata passa a BETA');
  eq(input(b).value, parolaBeta, 'la preparazione di BETA non è stata cancellata');
  eq(btnInvia(b).textContent, 'INVIA', 'al proprio turno il pulsante torna INVIA');
  ok(!input(a).disabled, 'anche ALFA può subito preparare la parola successiva');

  console.log('\n[5] BETA invia la parola che aveva preparato');
  invia(b);
  ok(await until(() => (mock.store.get('partite/P1').storia || []).length === 2, 'seconda parola registrata'),
    'parola di BETA accettata');
  eq(mock.store.get('partite/P1').storia.map((e) => e.nome), ['ALFA', 'BETA'], 'ordine delle parole');

  console.log('\n[6] Scottatura, recap e conferma');
  ok(await until(() => mock.store.get('partite/P1').roundData.fase === 'recap', 'fase recap', 30000),
    'tempo scaduto: si apre il recap');
  a.document.getElementById('btn-conferma').dispatchEvent(new a.Event('click', { bubbles: true }));
  b.document.getElementById('btn-conferma').dispatchEvent(new b.Event('click', { bubbles: true }));
  ok(await until(() => mock.store.get('partite/P1').stato === 'conclusa', 'partita conclusa', 25000),
    'partita conclusa dopo le conferme');

  console.log('\n[7] Podio: il vincitore sul gradino più alto');
  ok(await until(() => !a.document.getElementById('overlay-fine').classList.contains('hidden'), 'overlay fine'),
    'schermata finale visibile');
  const doc = mock.store.get('partite/P1');
  const attesa = ['ALFA', 'BETA']
    .map((p) => ({ p, pts: doc.punteggi[p] || 0, patate: doc.patate[p] || 0 }))
    .sort((x, y) => y.pts - x.pts || x.patate - y.patate);
  const cols = a.document.querySelectorAll('#podio .pod-col');
  eq(cols.length, 2, 'un gradino per giocatore');
  ok(cols[0].textContent.indexOf(attesa[0].p) !== -1, 'primo gradino: ' + attesa[0].p);
  ok(cols[1].textContent.indexOf(attesa[1].p) !== -1, 'secondo gradino: ' + attesa[1].p);
  const h0 = parseInt(cols[0].querySelector('.pod-bar').style.height, 10);
  const h1 = parseInt(cols[1].querySelector('.pod-bar').style.height, 10);
  ok(h0 > h1, 'gradino del vincitore più alto del secondo (' + h0 + 'px > ' + h1 + 'px)');
  ok(cols[0].classList.contains('p1') && cols[1].classList.contains('p2'), 'classi di posizione p1/p2');
  console.log('   scritture totali:', mock.writes, '| letture da listener:', mock.readsListener);

  console.log('\n[8] Un invito rifiutato dall\'hub non blocca la rivincita');
  /* L'hub (index.html) scrive il rifiuto di un INVITO in invitoRifiutatoDa e
     toglie chi rifiuta dai partecipanti: non deve toccare rivincitaRifiutataDa,
     altrimenti il pulsante RIVINCITA resta disabilitato per sempre. */
  await mock.collection('partite').doc('P1').update({ invitoRifiutatoDa: ['BETA'] });
  ok(await until(() => !a.document.getElementById('btn-rivincita').disabled, 'rivincita attiva', 5000),
    'RIVINCITA attiva anche con un invito rifiutato dall\'hub');
  ok(a.document.getElementById('btn-rivincita').textContent.indexOf('RIFIUTATA') === -1,
    'etichetta senza "RIFIUTATA": ' + a.document.getElementById('btn-rivincita').textContent.trim());
  /* Solo il rifiuto della RIVINCITA, scritto dentro la partita, la blocca. */
  await mock.collection('partite').doc('P1').update({ rivincitaRifiutataDa: ['BETA'] });
  ok(await until(() => a.document.getElementById('btn-rivincita').disabled, 'rivincita bloccata', 5000),
    'RIVINCITA bloccata solo dal rifiuto della rivincita fatto in partita');

  console.log('\n=================');
  console.log('PASSATI: ' + passed + '  FALLITI: ' + failed);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('ERRORE TEST MULTIPLAYER PATATA:', e);
  process.exit(1);
});
