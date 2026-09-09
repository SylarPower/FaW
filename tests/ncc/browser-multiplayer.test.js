/* E2E MULTIPLAYER (jsdom) di "Nomi, Cose, Città".
   Due pagine reali condividono un Firestore simulato (tests/ncc/mock-firestore.js):
   vengono esercitati UI + backend reali, non una reimplementazione.
   Verifica: lobby, ready/start automatico, compilazione isolata (privacy),
   STOP, tabella di revisione, voti all'unanimità, conferma, risultati congelati,
   classifica finale, budget di letture/scritture. */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { createMockFirestore, makeFirebaseGlobal } = require('./mock-firestore.js');

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'games/nomi-cose-citta/index.html'), 'utf8');
const coreJs = fs.readFileSync(path.join(ROOT, 'games/nomi-cose-citta/js/core.js'), 'utf8');
const backendJs = fs.readFileSync(path.join(ROOT, 'games/nomi-cose-citta/js/backend.js'), 'utf8');
const uiJs = fs.readFileSync(path.join(ROOT, 'games/nomi-cose-citta/js/ui.js'), 'utf8');
const cfgJs = fs.readFileSync(path.join(ROOT, 'games/shared/firebase-config.js'), 'utf8');
const dictSample = fs.readFileSync(path.join(ROOT, 'dizionario.txt'), 'utf8')
  .split('\n').filter((_, i) => i % 10 === 0).join('\n');

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
    await sleep(80);
  }
  console.log('  \u2718 timeout in attesa di:', what);
  failed++;
  return false;
}
function norm(w) {
  return String(w).trim().toUpperCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z]/g, '');
}
const PAROLE = {};
dictSample.split('\n').forEach((w) => {
  const n = norm(w);
  if (n.length >= 4) (PAROLE[n.charAt(0)] = PAROLE[n.charAt(0)] || []).push(w.trim());
});

const mock = createMockFirestore();

function pagina(nome) {
  const dom = new JSDOM(html, {
    url: 'http://localhost/games/nomi-cose-citta/index.html?matchId=M1',
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
  w.eval(cfgJs);          // config condivisa reale (games/shared/firebase-config.js)
  w.eval(coreJs);
  w.eval(backendJs);
  w.eval(uiJs);
  return w;
}
const visibile = (w, id) => !w.document.getElementById(id).classList.contains('hidden');

(async () => {
  mock.store.set('partite/M1', {
    gioco: 'ncc',
    partecipanti: ['ALFA', 'BETA'],
    punteggi: {}, parole: {}, pronti: [], finito: [], confermaVerifica: [],
    stato: 'attesa', rivincitaAccettataDa: [], rivincitaRifiutataDa: [],
    opzioni: {
      round: '1', tempo: '120', revisione: '180', categorie: 'light',
      seed: '20260909', modality: 'classica'
    },
    dataOra: '2026-09-09 09:00:00',
    timestamp: new Date('2026-09-09T09:00:00Z').getTime()
  });

  console.log('\n[1] Lobby: due pagine, stesso documento partita');
  const a = pagina('ALFA');
  const b = pagina('BETA');
  ok(await until(() => !visibile(a, 'screen-loading') && !visibile(a, 'screen-lobby'), 'lobby ALFA'),
    'ALFA in lobby');
  ok(await until(() => !visibile(b, 'screen-lobby'), 'lobby BETA'), 'BETA in lobby');
  eq(a.document.querySelectorAll('#lobby-players .pchip').length, 2, 'lista giocatori (2)');
  eq(a.document.querySelectorAll('#lobby-cats .cat-chip').length, 3, 'categorie condivise (3)');
  eq(a.document.getElementById('cfg-round').textContent, '1', 'round dalla configurazione');
  eq(a.document.getElementById('cfg-tempo').textContent, '120s', 'tempo di compilazione');
  eq(a.document.getElementById('cfg-revisione').textContent, '180s', 'tempo di revisione condiviso');
  ok(a.document.getElementById('btn-start-solo').classList.contains('hidden'),
    'in sfida non compare il pulsante di allenamento');
  ok(/^DIZ v1:[0-9a-f]+$/.test(a.document.getElementById('dict-badge').textContent),
    'fingerprint del dizionario nel topbar: ' + a.document.getElementById('dict-badge').textContent);

  console.log('\n[2] Ready automatico e start: una sola transizione vince');
  ok(await until(() => visibile(a, 'screen-gioco') && visibile(b, 'screen-gioco'), 'schermata di gioco'),
    'entrambi i giocatori passano in compilazione');
  eq(a.document.getElementById('fase-chip').textContent, 'COMPILAZIONE', 'fase compilazione su ALFA');
  eq(mock.store.get('partite/M1').roundData.fase, 'compilazione', 'fase condivisa');
  eq(mock.store.get('partite/M1').roundData.partecipanti, ['ALFA', 'BETA'], 'quorum congelato a inizio round');
  eq(mock.store.get('partite/M1').roundData.lettera, a.document.getElementById('lettera-tile').textContent,
    'lettera condivisa');

  console.log('\n[3] Compilazione isolata: ogni giocatore scrive solo le proprie risposte');
  const lettera = a.document.getElementById('lettera-tile').textContent;
  const parole = (PAROLE[lettera] || ['parola']).slice(0, 3);
  const inputsA = a.document.querySelectorAll('#campi input');
  eq(inputsA.length, 3, 'un campo per categoria su ALFA');
  for (let i = 0; i < inputsA.length; i++) {
    inputsA[i].value = parole[i];
    inputsA[i].dispatchEvent(new a.Event('input', { bubbles: true }));
  }
  await sleep(1500);   // oltre il debounce
  const docA = mock.store.get('partite/M1/risposte/r1__p0');
  ok(!!docA, 'documento risposte di ALFA creato');
  eq(Object.keys(docA.risposte).length, 3, 'tre risposte salvate');
  eq(docA.giocatore, 'ALFA', 'documento intestato ad ALFA');
  ok(!mock.store.has('partite/M1/risposte/r1__p1'), 'nessun documento per BETA: non ha scritto nulla');
  const inputsB = b.document.querySelectorAll('#campi input');
  ok(Array.prototype.every.call(inputsB, (i) => i.value === ''), 'i campi di BETA restano vuoti');
  ok(b.document.body.textContent.indexOf(parole[0]) === -1,
    'le risposte di ALFA non compaiono da nessuna parte nella pagina di BETA');
  eq(a.document.getElementById('save-state').textContent.indexOf('salvato') !== -1, true,
    'indicatore di salvataggio su ALFA');

  console.log('\n[4] STOP di ALFA: revisione condivisa, tabella con tutti');
  a.document.getElementById('btn-stop').dispatchEvent(new a.Event('click', { bubbles: true }));
  ok(await until(() => visibile(a, 'overlay-revisione') && visibile(b, 'overlay-revisione'), 'overlay revisione'),
    'entrambi passano in revisione');
  eq(mock.store.get('partite/M1').roundData.fase, 'revisione', 'fase revisione condivisa');
  eq(mock.store.get('partite/M1').roundData.stop.da, 'ALFA', 'chi ha premuto STOP');
  const righe = a.document.querySelectorAll('#rev-body .rev-table tbody tr');
  eq(righe.length, 3, 'una riga per categoria');
  eq(righe[0].querySelectorAll('td').length, 2, 'una colonna per giocatore');
  eq(a.document.querySelectorAll('#rev-body thead th').length, 3, 'intestazione: categoria + 2 giocatori');
  ok(a.document.querySelector('#rev-body .cell-word').textContent === parole[0],
    'la tabella mostra le risposte di ALFA');
  eq(a.document.querySelectorAll('#rev-body .cell-empty').length, 3, 'le celle vuote di BETA sono evidenziate');
  eq(a.document.querySelectorAll('#rev-body .vote-btn:not([disabled])').length, 3,
    'solo le risposte valide sono contestabili (3 pulsanti attivi)');
  ok(/solo se tutti/i.test(a.document.getElementById('overlay-revisione').textContent),
    'la regola dell\'unanimità è scritta nella schermata');

  console.log('\n[5] Voto: niente annullamento senza unanimità (autore compreso)');
  const btnAlfaNonValida = a.document.querySelector('.vote-btn[data-key="c0_p0"]');
  const btnBetaNonValida = b.document.querySelector('.vote-btn[data-key="c0_p0"]');
  ok(!!btnAlfaNonValida && !!btnBetaNonValida, 'entrambi possono votare sulla cella c0_p0');
  btnBetaNonValida.dispatchEvent(new b.Event('click', { bubbles: true }));
  await sleep(400);
  const cella0 = () => a.document.querySelector('.vote-btn[data-key="c0_p0"]').closest('.rev-cell');
  ok(cella0().textContent.indexOf('1/2') !== -1, 'ALFA vede il voto di BETA (1/2)');
  ok(!/ANNULLATA/i.test(cella0().textContent), 'con un solo voto la risposta NON è annullata');
  ok(/RITIRA/i.test(a.document.querySelector('.vote-btn[data-key="c1_p0"]').textContent) === false,
    'i pulsanti non votati restano "NON VALIDA"');
  eq(mock.store.get('partite/M1').roundData.voti.c0_p0, ['BETA'], 'voto registrato nel documento partita');

  btnAlfaNonValida.dispatchEvent(new a.Event('click', { bubbles: true }));
  await sleep(400);
  eq(mock.store.get('partite/M1').roundData.voti.c0_p0.slice().sort(), ['ALFA', 'BETA'],
    'unanimità raggiunta (votanti in ordine di arrivo)');
  ok(/2\/2 · ANNULLATA/.test(cella0().textContent), 'solo ora la cella risulta annullata');
  ok(/annullata/.test(cella0().querySelector('.cell-word').className),
    'classe .annullata applicata alla parola');

  console.log('\n[6] Conferma della revisione');
  ok(a.document.getElementById('btn-conferma').disabled === false, 'conferma abilitata per chi partecipa');
  ok(a.document.getElementById('conf-progress').textContent.indexOf('0/2') !== -1,
    'contatore conferme: ' + a.document.getElementById('conf-progress').textContent.replace(/\s+/g, ' ').trim());
  a.document.getElementById('btn-conferma').dispatchEvent(new a.Event('click', { bubbles: true }));
  await sleep(300);
  eq(mock.store.get('partite/M1').roundData.conferme, ['ALFA'], 'conferma di ALFA');
  ok(/IN ATTESA/i.test(a.document.getElementById('btn-conferma').textContent),
    'ALFA vede il proprio pulsante in attesa');
  b.document.getElementById('btn-conferma').dispatchEvent(new b.Event('click', { bubbles: true }));
  ok(await until(() => visibile(a, 'overlay-risultati') && visibile(b, 'overlay-risultati'), 'overlay risultati'),
    'chiusura della revisione alla conferma di tutti');
  eq(mock.store.get('partite/M1').roundData.fase, 'risultati', 'fase risultati condivisa');
  eq(mock.store.get('partite/M1').roundData.esitoId, 'r1', 'esito identificato dal round (esitoId)');
  eq(mock.store.get('partite/M1').risultati.length, 1, 'esito congelato in risultati[]');
  eq(mock.store.get('partite/M1').roundData.dictVersion, a.document.defaultView.__NCC.dizionario.fingerprint,
    'fingerprint del dizionario registrato a inizio round');

  console.log('\n[7] Punteggio congelato (variante classica)');
  const st = a.document.defaultView.__NCC.state;
  const esito = st.risultati[0];
  eq(esito.id, 'r1', 'risultato agganciato al round r1');
  eq(esito.punti.ALFA, 40, 'due risposte uniche valide = 20+20, quella annullata = 0');
  eq(esito.punti.BETA, 0, 'chi non risponde prende 0');
  const celle = esito.celle;
  eq(celle.filter((c) => c.punti === 20).length, 2, 'due celle da 20 punti');
  eq(celle.filter((c) => c.punti === 0 && c.annullata).length, 1, 'una cella annullata da 0');
  eq(st.punteggi.ALFA, 40, 'punteggio partita di ALFA');
  ok(a.document.getElementById('res-body').textContent.indexOf('40') !== -1, 'punti visibili nel riepilogo');

  console.log('\n[8] Nessuna doppia chiusura dell\'esito');
  const esitoId = mock.store.get('partite/M1').roundData.esitoId;
  const writesPrima = mock.writes;
  // snapshot ridondante sul documento partita (simula refresh / riconnessione)
  mock.db.collection('partite').doc('M1').update({});
  await sleep(400);
  eq(mock.store.get('partite/M1').roundData.esitoId, esitoId, 'esitoId invariato');
  eq(mock.store.get('partite/M1').risultati.length, 1, 'un solo round nei risultati');
  eq(mock.store.get('partite/M1').punteggi.ALFA, 40, 'punteggi non raddoppiati');
  eq(mock.writes, writesPrima + 1, 'lo snapshot ridondante non provoca nuove scritture');

  console.log('\n[9] Fine partita e classifica');
  ok(await until(() => visibile(a, 'overlay-fine') && visibile(b, 'overlay-fine'), 'overlay fine', 25000),
    'schermata finale su entrambi i giocatori');
  eq(mock.store.get('partite/M1').stato, 'conclusa', 'partita conclusa');
  const podio = a.document.querySelectorAll('#podio .pod-col');
  eq(podio.length, 2, 'podio con entrambi i giocatori');
  ok(podio[0].textContent.indexOf('ALFA') !== -1, 'ALFA primo');
  ok(podio[0].textContent.indexOf('40') !== -1, 'punteggio finale mostrato');
  ok(podio[1].textContent.indexOf('BETA') !== -1, 'BETA secondo');
  eq(a.document.getElementById('fine-title').textContent, 'HAI VINTO!', 'titolo per il vincitore (ALFA)');
  eq(b.document.getElementById('fine-title').textContent, 'HA VINTO ALFA', 'titolo per chi ha perso (BETA)');
  ok(!a.document.getElementById('btn-rivincita').classList.contains('hidden'),
    'rivincita disponibile in sfida');
  ok(!a.document.getElementById('btn-rivincita').disabled, 'pulsante rivincita attivo');
  ok(a.document.getElementById('fine-dettaglio').textContent.indexOf('Round 1') !== -1, 'dettaglio per round');

  console.log('\n[10] Budget Firestore');
  eq(mock.readsGet, 2, 'due letture get in tutta la partita (le override del dizionario)');
  console.log('   scritture totali:', mock.writes, '| letture da listener:', mock.readsListener);
  ok(mock.writes <= 14, 'scritture contenute (<=14): ' + mock.writes);
  ok(mock.readsListener <= 20, 'letture contenute (<=20): ' + mock.readsListener);
  eq(a.document.defaultView.__NCC.backend._unsubRisposte, null,
    'listener delle risposte chiuso dopo la chiusura della partita');

  console.log('\n=================');
  console.log('PASSATI: ' + passed + '  FALLITI: ' + failed);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('ERRORE TEST MULTIPLAYER:', e);
  process.exit(1);
});
