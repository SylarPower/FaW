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
const C = require(path.join(__dirname, '../../games/patata/js/game.js'));

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'games/patata/index.html'), 'utf8');
const gameJs = fs.readFileSync(path.join(ROOT, 'games/patata/js/game.js'), 'utf8');
const cfgJs = fs.readFileSync(path.join(ROOT, 'games/shared/firebase-config.js'), 'utf8');
const podioJs = fs.readFileSync(path.join(ROOT, 'games/shared/podio.js'), 'utf8');
const bannerJs = fs.readFileSync(path.join(ROOT, 'games/shared/faw-banner.js'), 'utf8');
const rivincitaJs = fs.readFileSync(path.join(ROOT, 'games/shared/rivincita.js'), 'utf8');
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

function pagina(nome, matchId, opts) {
  const dom = new JSDOM(html, {
    url: 'http://localhost/games/patata/index.html?matchId=' + (matchId || 'P1'),
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
  /* Override del dizionario CONDIVISO diversi per client: nella realtà un
     giocatore può avere appena approvato una parola (o una cache diversa).
     Serve a verificare che le lettere del turno restino le stesse per tutti. */
  if (opts && opts.extra) w.FAW_WRITE_DICTIONARY_OVERRIDES({ extra: opts.extra, excluded: [] });
  w.eval(rivincitaJs); // rivincita condivisa (come nella pagina reale)
  w.eval(podioJs);   // podio condiviso di fine partita
  w.eval(bannerJs);   // banner/toast condivisi
  w.eval(gameJs);
  return w;
}
/* Il dizionario di prova: stesso file per tutte le pagine, come in produzione. */
const BASE_WORDS = (() => {
  const set = new Set();
  dictSample.split('\n').forEach((l) => {
    const w = C.normalizeWord(l);
    if (w.length >= C.MIN_WORD_LENGTH) set.add(w);
  });
  return Array.from(set);
})();
const PAROLE_EXTRA = ['ZABAIONE', 'CIAONE', 'PATATINA', 'ZZZQ'];
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

  /* ============================================================
     [9] PAUSA PER TUTTI + RICHIESTA PAROLA NEL VOCABOLARIO (voto)
     Nuova partita P2 con due pagine fresche.
     ============================================================ */
  console.log('\n[9] Pausa per tutti + proposta di parola con voto di tutti');
  mock.store.set('partite/P2', {
    gioco: 'patata',
    partecipanti: ['ALFA', 'BETA'],
    punteggi: {}, parole: {}, pronti: [], stato: 'attesa',
    rivincitaAccettataDa: [], rivincitaRifiutataDa: [],
    opzioni: { tempo: '30', turni: '1', lettere: '2', mode: 'classic', seed: 'PAUSATEST' },
    dataOra: '2026-09-23 09:00:00',
    timestamp: Date.now()
  });
  const c = pagina('ALFA', 'P2');
  const d = pagina('BETA', 'P2');
  ok(await until(() => {
    const st = c.document.defaultView.__PATATA.state;
    return st && st.stato === 'in_corso';
  }, 'P2 avviata'), 'partita P2 avviata (auto-ready)');
  ok(await until(() => {
    const st = d.document.defaultView.__PATATA.state;
    return st && st.stato === 'in_corso';
  }, 'P2 visibile a BETA'), 'BETA vede P2 in gioco');

  /* --- pausa semplice: la può premere chiunque, ferma il clock per TUTTI --- */
  d.document.getElementById('btn-pausa').dispatchEvent(new d.Event('click', { bubbles: true }));
  ok(await until(() => c.document.defaultView.__PATATA.state.pausa === true, 'pausa su entrambe le pagine'),
    'chiunque preme ⏸: la partita va in pausa per tutti');
  ok(await until(() => !c.document.getElementById('overlay-pausa').classList.contains('hidden'), 'overlay su ALFA'),
    'ALFA vede l\'overlay di pausa');
  ok(!d.document.getElementById('overlay-pausa').classList.contains('hidden'), 'BETA vede l\'overlay di pausa');
  const dP2 = c.document.defaultView.__PATATA.state.turno.deadline;
  await sleep(1100);
  eq(c.document.defaultView.__PATATA.state.turno.deadline, dP2,
    'clock FERMO durante la pausa (deadline invariata per 1,1s)');
  ok(c.document.getElementById('word-input').disabled && d.document.getElementById('word-input').disabled,
    'caselle disabilitate per tutti durante la pausa');
  c.document.querySelector('#pausa-body button').dispatchEvent(new c.Event('click', { bubbles: true }));
  ok(await until(() => c.document.defaultView.__PATATA.state.pausa === false, 'ripresa'), 'ripresa dal pulsante');
  ok(await until(() => c.document.getElementById('overlay-pausa').classList.contains('hidden'), 'overlay chiuso'),
    'overlay di pausa richiuso alla ripresa');

  /* --- proposta di parola mancante: pausa + voto di tutti --- */
  const winC = c.document.defaultView;
  const stP2 = winC.__PATATA.state;
  eq(stP2.turno.giocatore, 'ALFA', 'round 1: tocca ad ALFA');
  const lettersP2 = winC.__PATATA.lettersFor(stP2);
  console.log('   lettere P2:', lettersP2.join(''));
  const parolaNuova = lettersP2.map((l) => 'Z' + l).join('') + 'ZZ';
  ok(!winC.__PATATA.dict.has(parolaNuova), 'parola finta non presente nel dizionario: ' + parolaNuova);
  scrivi(c, parolaNuova);
  await until(() => !c.document.getElementById('btn-richiedi').classList.contains('hidden'), 'pulsante proposta', 3000);
  ok(!c.document.getElementById('btn-richiedi').classList.contains('hidden'),
    'al proprio turno il pulsante "Proponi al vocabolario" appare: ' +
    c.document.getElementById('btn-richiedi').textContent);
  /* da BETA (fuori turno) la casella si svuota e nessun pulsante proposta */
  scrivi(d, parolaNuova);
  await sleep(200);
  eq(input(d).value, '', 'la casella di BETA si svuota: niente preparazione fuori turno');
  ok(d.document.getElementById('btn-richiedi').classList.contains('hidden'),
    'da BETA il pulsante "Proponi" resta nascosto (non è il suo turno)');
  c.document.getElementById('btn-richiedi').dispatchEvent(new c.Event('click', { bubbles: true }));
  ok(await until(() => c.document.defaultView.__PATATA.state.pausa === true &&
    !!c.document.defaultView.__PATATA.state.richiesta, 'richiesta aperta'),
  'la proposta mette in pausa per tutti');
  ok(await until(() => !d.document.getElementById('overlay-pausa').classList.contains('hidden'), 'overlay vote BETA'),
    'anche BETA vede il voto');
  const rqTitle = c.document.getElementById('pausa-title').textContent;
  ok(/VOCABOLARIO/.test(rqTitle), 'overlay di voto: ' + rqTitle);
  ok(new RegExp(parolaNuova).test(c.document.getElementById('pausa-sub').textContent),
    'la parola proposta è nell\'overlay: ' + c.document.getElementById('pausa-sub').textContent.trim().slice(0, 120));
  /* proponente: ha già votato sì → vede "HAI VOTATO" + ritira, non i bottoni di voto */
  const btnsC = Array.from(c.document.querySelectorAll('#pausa-body button')).map((b) => b.textContent);
  ok(btnsC.some((t) => /HAI VOTATO/.test(t)), 'proponente: voto SÌ già registrato — ' + btnsC.join(' | '));
  ok(btnsC.some((t) => /RITIRA/.test(t)), 'proponente: può ritirare la proposta');
  ok(!btnsC.some((t) => /INSERISCI/.test(t) && !/HAI/.test(t)), 'proponente: nessun doppio bottone di voto');
  /* BETA vota 👍 */
  const btnsD = Array.from(d.document.querySelectorAll('#pausa-body button')).map((b) => b.textContent);
  ok(btnsD.some((t) => /INSERISCI/.test(t)) && btnsD.some((t) => /NON INSERIRE/.test(t)),
    'BETA vota: ' + btnsD.join(' | '));
  const votoSi = d.document.querySelectorAll('#pausa-body button')[0];
  eq(votoSi.textContent, '👍 INSERISCI', 'primo bottone per BETA = 👍 INSERISCI');
  votoSi.dispatchEvent(new d.Event('click', { bubbles: true }));
  ok(await until(() => {
    const st = c.document.defaultView.__PATATA.state;
    return !st.pausa && !st.richiesta && st.ultimaRichiesta;
  }, 'risoluzione voto', 8000), 'tutti hanno votato → voto chiuso e pausa terminata');
  const ur = c.document.defaultView.__PATATA.state.ultimaRichiesta;
  eq(ur.esito, 'inserita', 'maggioranza di sì → parola APPROVATA');
  eq(ur.parola, parolaNuova, 'esito sulla parola giusta');
  ok(c.document.defaultView.__PATATA.dict.has(parolaNuova),
    'parola nel dizionario LOCALE di ALFA dopo l\'approvazione');
  ok(d.document.defaultView.__PATATA.dict.has(parolaNuova),
    'parola nel dizionario LOCALE di BETA dopo l\'approvazione');
  const cfgDoc = mock.store.get('config/dizionario');
  ok(cfgDoc && Array.isArray(cfgDoc.extra) && cfgDoc.extra.indexOf(parolaNuova) !== -1,
    'parola salvata nel vocabolario condiviso config/dizionario → extra');
  const scrittureCfg = (mock.log || []).filter((e) => e.p === 'config/dizionario');
  eq(scrittureCfg.length, 1, 'il vocabolario condiviso è scritto UNA SOLA volta (solo il referente)');
  ok(await until(() => c.document.getElementById('overlay-pausa').classList.contains('hidden'),
    'overlay chiuso anche su ALFA'), 'overlay di voto richiuso anche da ALFA');

  /* --- la parola approvata ora è giocabile --- */
  await until(() => !c.document.getElementById('word-input').disabled, 'input riattivato', 3000);
  scrivi(c, parolaNuova);
  invia(c);
  ok(await until(() => (mock.store.get('partite/P2').storia || []).length === 1, 'parola approvata giocata'),
    'dopo il sì la proposta si può usare: registrata in storia');
  const pAlfa = mock.store.get('partite/P2').punteggi.ALFA;
  eq(pAlfa, parolaNuova.length, 'punti = lunghezza della parola (' + parolaNuova.length + ')');
  eq(mock.store.get('partite/P2').turno.giocatore, 'BETA', 'la patata passa a BETA');

  /* ============================================================
     [10] POWER-UP 🚀 "PASSA LA PATATA" — badge, scelta bersaglio,
     0 punti, un solo utilizzo. Partita P3 con seed scelto affinché
     il detentore del round sia ALFA (parte per prima).
     ============================================================ */
  console.log('\n[10] Power-up 🚀: passa la patata a chi vuoi (0 punti, 1 volta)');
  let seedPow = null;
  for (let i = 0; i < 500 && !seedPow; i++) {
    const cand = 'POW' + i;
    if (C.powerPassFor({ partecipanti: ['ALFA', 'BETA'], opzioni: { seed: cand }, round: 1 }) === 'ALFA') {
      seedPow = cand;
    }
  }
  ok(!!seedPow, 'seed trovato con power-up ad ALFA: ' + seedPow);
  mock.store.set('partite/P3', {
    gioco: 'patata',
    partecipanti: ['ALFA', 'BETA'],
    punteggi: {}, parole: {}, pronti: [], stato: 'attesa',
    rivincitaAccettataDa: [], rivincitaRifiutataDa: [],
    opzioni: { tempo: '30', turni: '1', lettere: '2', mode: 'classic', seed: seedPow },
    dataOra: '2026-09-23 10:00:00',
    timestamp: Date.now()
  });
  const e = pagina('ALFA', 'P3');
  const f = pagina('BETA', 'P3');
  ok(await until(() => {
    const st = e.document.defaultView.__PATATA.state;
    return st && st.stato === 'in_corso';
  }, 'P3 avviata'), 'partita P3 avviata');
  ok(await until(() => {
    const st = f.document.defaultView.__PATATA.state;
    return st && st.stato === 'in_corso';
  }, 'P3 visibile a BETA'), 'BETA vede P3');

  console.log('   lettere P3:', e.document.defaultView.__PATATA
    .lettersFor(e.document.defaultView.__PATATA.state).join(''));

  /* badge 🚀 sul chip del detentore, non sugli altri */
  ok(await until(() => {
    const chips = e.document.querySelectorAll('#game-players .pchip');
    return chips.length === 2;
  }, 'chip renderizzati'), 'chip giocatori renderizzati');
  const chipsE = Array.from(e.document.querySelectorAll('#game-players .pchip'));
  const chipAlfa = chipsE.find((c) => c.textContent.includes('ALFA'));
  const chipBeta = chipsE.find((c) => c.textContent.includes('BETA'));
  ok(!!chipAlfa.querySelector('.power-badge'), 'badge 🚀 sul chip di ALFA (detentore del round)');
  ok(!chipBeta.querySelector('.power-badge'), 'NESSUN badge 🚀 sul chip di BETA');
  ok(!f.document.querySelectorAll('#game-players .power-badge').length ||
    Array.from(f.document.querySelectorAll('#game-players .pchip'))
      .find((c) => c.textContent.includes('ALFA')).querySelector('.power-badge'),
    'anche la pagina di BETA vede il badge sul detentore');

  /* il pulsante 🚀 compare solo da chi ha patata + power-up */
  ok(await until(() => !e.document.getElementById('btn-power').classList.contains('hidden'),
    'btn-power visibile per ALFA', 4000), 'ALFA (patata + power-up) vede "🚀 PASSA LA PATATA A…"');
  ok(f.document.getElementById('btn-power').classList.contains('hidden'),
    'BETA non vede il pulsante (non è suo né il detentore)');
  console.log('   pulsante:', e.document.getElementById('btn-power').textContent);

  /* scelta bersaglio */
  e.document.getElementById('btn-power').dispatchEvent(new e.Event('click', { bubbles: true }));
  ok(await until(() => !e.document.getElementById('overlay-target').classList.contains('hidden'),
    'picker bersagli'), 'overlay "A CHI PASSI LA PATATA?" aperto');
  const targetBtns = Array.from(e.document.querySelectorAll('#target-body [data-target]'));
  ok(targetBtns.length === 2, 'un pulsante per ogni avversario + ANNULLA (' + targetBtns.length + ')');
  ok(targetBtns.some((b) => /PASSA A BETA/.test(b.textContent)), 'bersaglio BETA presente');
  ok(targetBtns.some((b) => b.getAttribute('data-target') === ''), 'ANNULLA presente');
  const btnPassaBeta = targetBtns.find((b) => b.getAttribute('data-target') === 'BETA');
  const deadlinePrimaPassaggio = mock.store.get('partite/P3').turno.deadline;
  btnPassaBeta.dispatchEvent(new e.Event('click', { bubbles: true }));

  ok(await until(() => {
    const st = e.document.defaultView.__PATATA.state;
    return st && st.turno && st.turno.giocatore === 'BETA';
  }, 'patata a BETA dopo il passaggio'), 'la patata arriva a BETA senza scrivere');
  const docP3 = mock.store.get('partite/P3');
  eq(docP3.roundData.powerPass && docP3.roundData.powerPass.target, 'BETA',
    'power-up registrato come usato (roundData.powerPass)');
  eq(docP3.roundData.powerPass.da, 'ALFA', 'usato da ALFA');
  eq(docP3.storia || [], [], 'nessuna parola: il passaggio non entra nel feed parole');
  eq(docP3.punteggi, { ALFA: 0, BETA: 0 }, 'nessun punto assegnato (0 punti come da regola)');
  /* Il passaggio vale come una parola valida sul cronometro: tempo mai tolto
     e mai oltre il tetto configurato (30s). */
  eq(docP3.turno.ultimo && docP3.turno.ultimo.bonus, 5,
    'il bonus del passaggio (+5s) è comunicato a tutti i client');
  ok(docP3.turno.deadline >= deadlinePrimaPassaggio,
    'il cronometro non perde tempo con il passaggio (prima: ' + deadlinePrimaPassaggio +
    ', dopo: ' + docP3.turno.deadline + ')');
  ok(docP3.turno.deadline <= Date.now() + 30_000,
    'il cronometro resta entro il tetto configurato: ' +
    Math.round((docP3.turno.deadline - Date.now()) / 1000) + 's residui');
  eq(docP3.turno.riferimento, docP3.turno.ultimo.ts,
    'riferimento del ring allineato al passaggio (il bonus si vede subito)');
  ok(/\+5s/.test(e.document.getElementById('feedback').textContent),
    'feedback con il bonus guadagnato: "' +
    e.document.getElementById('feedback').textContent.trim() + '"');
  ok(await until(() => e.document.getElementById('overlay-target').classList.contains('hidden'),
    'picker chiuso dopo la scelta'), 'overlay chiuso dopo il passaggio');
  ok(await until(() => e.document.getElementById('btn-power').classList.contains('hidden'),
    'pulsante nascosto dopo l\'uso'), 'pulsante 🚀 sparito (1 solo utilizzo per round)');
  ok(await until(() => !e.document.querySelectorAll('#game-players .power-badge').length,
    'badge sparito dopo l\'uso'), 'badge 🚀 rimosso da entrambi i chip dopo l\'uso');
  ok(/passa la patata a BETA/i.test(e.document.getElementById('feedback').textContent),
    'feedback dedicato: "' + e.document.getElementById('feedback').textContent.trim() + '"');
  ok(e.document.getElementById('word-input').disabled,
    'patata passata: la casella di ALFA si disattiva');
  ok(f.document.defaultView.__PATATA.state.turno.giocatore === 'BETA' &&
    !f.document.getElementById('word-input').disabled,
    'BETA può a sua volta giocare normalmente dopo aver ricevuto la patata');

  /* ============================================================
     [11] LETTERE UGUALI PER TUTTI — anche con dizionari diversi
     Le lettere di ogni turno si estraggono dal dizionario BASE condiviso:
     prima venivano estratte dal dizionario locale (base + parole approvate +
     esclusioni + cache) e bastava una parola in più su un client per mostrare
     lettere diverse agli altri giocatori.
     ============================================================ */
  console.log('\n[11] Lettere identiche anche con dizionari locali diversi');
  const SEED_LETTERE = 'SEED0';   // con le parole extra divergerebbe (vedi sotto)
  mock.store.set('partite/P4', {
    gioco: 'patata',
    partecipanti: ['ALFA', 'BETA'],
    punteggi: {}, parole: {}, pronti: [], stato: 'attesa',
    rivincitaAccettataDa: [], rivincitaRifiutataDa: [],
    opzioni: { tempo: '30', turni: '3', lettere: '2', mode: 'sequenza', seed: SEED_LETTERE },
    dataOra: '2026-09-29 09:00:00',
    timestamp: Date.now()
  });
  const g = pagina('ALFA', 'P4', { extra: PAROLE_EXTRA });   // dizionario «sporco»
  const h = pagina('BETA', 'P4');                            // dizionario pulito
  ok(await until(() => g.document.defaultView.__PATATA.state &&
    g.document.defaultView.__PATATA.state.stato === 'in_corso', 'P4 avviata (A)'), 'P4 avviata');
  ok(await until(() => h.document.defaultView.__PATATA.state &&
    h.document.defaultView.__PATATA.state.stato === 'in_corso', 'P4 avviata (B)'), 'P4 visibile a BETA');
  /* I due dizionari SONO diversi: il test ha senso solo così. */
  ok(g.document.defaultView.__PATATA.dict.has('ZABAIONE') &&
    !h.document.defaultView.__PATATA.dict.has('ZABAIONE'),
    'i dizionari locali dei due client differiscono (ALFA ha le parole approvate)');
  {
    const wg = g.document.defaultView, wh = h.document.defaultView;
    const stG = wg.__PATATA.state;
    /* Il calcolo «vecchio» (indice del dizionario locale) divergerebbe davvero:
       documenta la regressione, non solo la coincidenza. */
    const idxBase = new C.LetterIndex(BASE_WORDS);
    const idxLocale = new C.LetterIndex(BASE_WORDS.concat(PAROLE_EXTRA));
    const vecchioA = C.pickLetters(SEED_LETTERE, 1, 2, idxLocale, 'sequenza').join('');
    const vecchioB = C.pickLetters(SEED_LETTERE, 1, 2, idxBase, 'sequenza').join('');
    ok(vecchioA !== vecchioB,
      'con l\'indice locale le lettere sarebbero diverse (' + vecchioA + ' vs ' + vecchioB + ')');
    /* ...e invece su tutte le pagine e per tutti i turni sono identiche. */
    let uguali = true;
    const viste = [];
    for (let r = 1; r <= 6; r++) {
      const stR = Object.assign({}, stG, { round: r });
      const lA = wg.__PATATA.lettersFor(stR).join('');
      const lB = wh.__PATATA.lettersFor(stR).join('');
      viste.push('r' + r + ':' + lA);
      if (lA !== lB) uguali = false;
      if (lA !== C.pickLetters(SEED_LETTERE, r, 2, idxBase, 'sequenza').join('')) uguali = false;
    }
    ok(uguali, 'stesse lettere su ogni client e per ogni turno: ' + viste.join(' '));
    eq(g.document.getElementById('letters-avail').textContent,
      h.document.getElementById('letters-avail').textContent,
      'stesso numero di parole valide mostrato ai due client');
  }

  /* ============================================================
     [12] RIVINCITA — si entra nella partita nuova senza restare bloccati
     ============================================================ */
  console.log('\n[12] Rivincita: lobby nuova marcata e accettazione sulla partita di origine');
  mock.store.set('partite/P5', {
    gioco: 'patata', partecipanti: ['ALFA', 'BETA'],
    punteggi: { ALFA: 12, BETA: 7 }, patate: { ALFA: 0, BETA: 1 },
    pronti: ['ALFA', 'BETA'], stato: 'conclusa', round: 1, storia: [],
    roundData: { fase: 'recap', parlate: { ALFA: [], BETA: [] }, patata: 'BETA', flags: {}, rimosse: [] },
    rivincitaAccettataDa: [], rivincitaRifiutataDa: [],
    opzioni: { tempo: '30', turni: '1', lettere: '2', mode: 'classic', seed: 'SEEDTEST' },
    dataOra: '2026-09-29 10:00:00', timestamp: Date.now()
  });
  const i = pagina('ALFA', 'P5');
  const j = pagina('BETA', 'P5');
  ok(await until(() => i.__PATATA.state && i.__PATATA.state.stato === 'conclusa', 'partita finita per ALFA'),
    'ALFA riceve la partita conclusa');
  ok(await until(() => j.__PATATA.state && j.__PATATA.state.stato === 'conclusa', 'partita finita per BETA'),
    'BETA riceve la partita conclusa');
  ok(await until(() => !i.document.getElementById('btn-rivincita').disabled, 'RIVINCITA attiva per ALFA'),
    'ALFA (partita finita) vede il pulsante RIVINCITA');
  ok(await until(() => !j.document.getElementById('btn-rivincita').disabled, 'RIVINCITA attiva per BETA'),
    'BETA vede il pulsante RIVINCITA');
  i.document.getElementById('btn-rivincita').dispatchEvent(new i.Event('click', { bubbles: true }));
  ok(await until(() => !!i.document.getElementById('faw-rv-conferma'), 'modale rivincita'), 'modale di rivincita aperta');
  i.document.getElementById('faw-rv-conferma').dispatchEvent(new i.Event('click', { bubbles: true }));
  ok(await until(() => !!mock.store.get('partite/P5').prossimaPartita, 'proposta creata'), 'lobby nuova creata');
  const nuovaId = mock.store.get('partite/P5').prossimaPartita;
  const nuova = mock.store.get('partite/' + nuovaId) || {};
  ok(nuova.daRivincita === true && nuova.rivincitaDi === 'P5',
    'la lobby nuova è marcata daRivincita + rivincitaDi=P5 (l\'hub non la tratta come invito)');
  /* BETA accetta dal banner della partita finita: si parte tutti insieme. */
  const btnAccetta = Array.from(j.document.querySelectorAll('button'))
    .find((b) => /✅ ACCETTA/.test(b.textContent));
  ok(!!btnAccetta, 'BETA vede il pulsante ✅ ACCETTA nella partita finita');
  btnAccetta.dispatchEvent(new j.Event('click', { bubbles: true }));
  ok(await until(() => (mock.store.get('partite/P5').rivincitaAccettataDa || []).includes('BETA'),
    'accettazione di BETA'), 'accettazione registrata sulla partita di origine');
  ok(await until(() => i.__fawRivincitaVia === true && j.__fawRivincitaVia === true, 'redirect di entrambi'),
    'tutti accettano → entrambi vanno nella partita nuova');

  /* Chi entra nella lobby nuova dall'hub (senza passare dal banner) vale come
     accettazione: altrimenti gli altri restavano in attesa per sempre. */
  mock.store.set('partite/P6', {
    gioco: 'patata', partecipanti: ['ALFA', 'BETA'],
    punteggi: {}, pronti: [], stato: 'attesa',
    rivincitaAccettataDa: [], rivincitaRifiutataDa: [],
    daRivincita: true, rivincitaDi: 'P7',
    opzioni: { tempo: '30', turni: '1', lettere: '2', mode: 'classic', seed: 'SEEDTEST' },
    dataOra: '2026-09-29 10:30:00', timestamp: Date.now()
  });
  mock.store.set('partite/P7', {
    gioco: 'patata', partecipanti: ['ALFA', 'BETA'],
    punteggi: {}, pronti: [], stato: 'attesa',
    rivincitaAccettataDa: ['ALFA'], rivincitaRifiutataDa: [],
    prossimaPartita: 'P6', prossimaPartitaCreataDa: 'ALFA', prossimaPartitaGioco: 'patata',
    opzioni: { tempo: '30', turni: '1', lettere: '2', mode: 'classic', seed: 'SEEDTEST' },
    dataOra: '2026-09-29 10:31:00', timestamp: Date.now()
  });
  const k = pagina('BETA', 'P6', { extra: PAROLE_EXTRA });
  ok(await until(() => (mock.store.get('partite/P7').rivincitaAccettataDa || []).includes('BETA'),
    'accettazione segnata sull\'origine', 6000),
    'entrare nella lobby di rivincita segna l\'accettazione su P7 (chi entra non blocca più gli altri)');

  console.log('\n=================');
  console.log('PASSATI: ' + passed + '  FALLITI: ' + failed);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('ERRORE TEST MULTIPLAYER PATATA:', e);
  process.exit(1);
});
