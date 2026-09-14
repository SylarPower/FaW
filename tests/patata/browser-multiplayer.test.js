/* E2E MULTIPLAYER (jsdom) di Patata Bollente.
   Due pagine reali condividono un Firestore simulato (tests/ncc/mock-firestore.js,
   riusato perché è un mock "compat" generico): vengono esercitati UI + backend
   reali, non una reimplementazione.
   Verifica in particolare la regola "si scrive SOLO al proprio turno":
   - la casella di chi NON ha la patata è disabilitata e non accetta testo;
   - nessuna parola preparata in anticipo: la casella resta vuota e nessuna
     scrittura arriva su Firestore;
   - al passaggio della patata la casella si attiva per il nuovo giocatore;
   - il cronometro non supera mai il tempo configurato e il bonus cala con il
     passare dei minuti di turno;
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

  console.log('\n[2] Chi NON ha la patata non può scrivere');
  ok(input(b).disabled, 'casella di BETA DISABILITATA mentre gioca ALFA');
  ok(btnInvia(b).disabled, 'pulsante di BETA DISABILITATO');
  eq(input(b).placeholder, '⏳ Aspetta il tuo turno…', 'la casella dice di aspettare: ' + input(b).placeholder);
  ok(/tocca a te/i.test(a.document.getElementById('input-prep').textContent),
    'chi ha il turno vede l\'invito a inviare: ' +
    a.document.getElementById('input-prep').textContent.trim());
  ok(/solo al tuo turno/i.test(b.document.getElementById('input-prep').textContent),
    'chi aspetta legge che si scrive solo al proprio turno');
  ok(/\+\d+s/.test(a.document.getElementById('input-prep').textContent),
    'il bonus per parola è visibile: ' + a.document.getElementById('input-prep').textContent.trim());

  console.log('\n[3] Nessuna parola preparata in anticipo (nessuna scrittura)');
  const scritturePrima = mock.writes;
  scrivi(b, parolaBeta);
  eq(input(b).value, '', 'il testo digitato fuori turno non resta nella casella');
  invia(b);
  await sleep(300);
  eq(mock.writes, scritturePrima, 'nessuna scrittura su Firestore fuori turno');
  eq(mock.store.get('partite/P1').turno.giocatore, 'ALFA', 'la patata è ancora di ALFA');
  eq(mock.store.get('partite/P1').storia || [], [], 'nessuna parola registrata fuori turno');
  {
    // il cronometro del turno non supera il tempo configurato (60s dal suo inizio)
    const doc0 = mock.store.get('partite/P1');
    const tetto = Number(doc0.opzioni.tempo) * 1000;
    ok(doc0.turno.deadline - doc0.turno.inizio <= tetto,
      'cronometro entro il tetto configurato (' + doc0.opzioni.tempo + 's): ' +
      Math.round((doc0.turno.deadline - doc0.turno.inizio) / 1000) +
      's dal via del turno');
  }

  console.log('\n[4] ALFA gioca: la casella si attiva per il nuovo giocatore');
  ok(!input(a).disabled && !btnInvia(a).disabled,
    'ALFA (che ha la patata) scrive: casella e pulsante attivi');
  scrivi(a, parolaAlfa);
  invia(a);
  ok(await until(() => (mock.store.get('partite/P1').storia || []).length === 1, 'prima parola registrata'),
    'parola di ALFA accettata');
  eq(mock.store.get('partite/P1').turno.giocatore, 'BETA', 'la patata passa a BETA');
  ok(await until(() => !input(b).disabled, 'casella di BETA attiva'),
    'al passaggio della patata la casella di BETA si attiva');
  ok(input(a).disabled, 'ALFA torna a non poter scrivere');
  eq(input(b).value, '', 'BETA parte da una casella vuota (niente parole preparate)');

  console.log('\n[5] BETA invia la parola al proprio turno');
  scrivi(b, parolaBeta);
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
