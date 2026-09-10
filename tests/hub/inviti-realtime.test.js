/* Test hub: inviti in tempo reale.
   Copre i quattro difetti misurati sul popup inviti:
   1. l'invito arrivava solo col refresh a 60s (nessun listener);
   2. l'anti-rimbalzo buttava via il refresh invece di rimandarlo;
   3. la ✖ nascondeva anche gli inviti successivi;
   4. rifiutare scriveva nel campo della rivincita e lasciava chi rifiutava tra
      i partecipanti (lobby bloccata e RIVINCITA disabilitata per sempre).
   La pagina e' quella reale, con un mock Firestore che filtra le query e
   riemette i listener come fa Firestore. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM, VirtualConsole } = require('jsdom');
const { creaMockFirestore } = require('./mock-firestore.js');

const ROOT = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  \u2714', msg); }
  else { failed++; console.log('  \u2718', msg); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

(async () => {
  let html = HTML;
  html = html.replace(/\t*<script src="https:\/\/www\.gstatic\.com[^"]*"><\/script>\n?/g, '');
  html = html.replace(/\t*<script src="games\/shared\/firebase-config\.js"><\/script>\n?/g, '');
  const mock = `
window.__makeDb__ = ${creaMockFirestore.toString()};
window.__MOCK_DB__ = window.__makeDb__('${sha256('test123')}');
window.firebase = { initializeApp: function(){ return {}; }, firestore: function(){ return window.__MOCK_DB__; } };
window.firebase.firestore.FieldValue = {
  arrayUnion: function(){ return { __op: 'array-union', args: [].slice.call(arguments) }; },
  arrayRemove: function(){ return { __op: 'array-remove', args: [].slice.call(arguments) }; },
  delete: function(){ return { __op: 'delete' }; }
};
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
  window.__nodeSubtle = crypto.webcrypto.subtle;
  window.eval('Object.defineProperty(window, "crypto", { value: Object.assign({}, window.crypto, { subtle: window.__nodeSubtle }), configurable: true });');
  window.eval('window.__nav = []; fawVaiA = function (u) { window.__nav.push(u); };');
  window.eval('window.__warn = []; var __ow = console.warn; console.warn = function () { window.__warn.push([].slice.call(arguments).join(" ")); __ow.apply(console, arguments); };');
  window.confirm = () => true;
  await sleep(150);

  // login come TEST
  window.document.getElementById('username').value = 'TEST';
  window.document.getElementById('password').value = 'test123';
  window.eval('entra()');
  await sleep(250);
  ok(window.document.getElementById('main-app').style.display === 'block', 'login riuscito');
  ok(errors.length === 0, 'nessun errore uncaught al login: ' + errors.join('; '));

  const popup = () => window.document.getElementById('invite-popup');
  const visibile = () => popup().style.display === 'block';
  const titolo = () => window.document.getElementById('invite-title').textContent;
  const coda = () => window.document.getElementById('invite-more');
  const queryLog = () => JSON.parse(window.eval('JSON.stringify(__MOCK_DB__.__queryLog)'));
  const docDi = (nome, id) => window.eval(
    `(function(){ var d = (__MOCK_DB__.__docs.${nome}||[]).find(function(x){ return x.id === ${JSON.stringify(id)}; }); return d ? JSON.stringify(d.__obj) : null; })()`);

  console.log('\n[A] Listener dedicato agli inviti, agganciato al login');
  const ql = queryLog();
  const lPartite = ql.filter(q => q.tipo === 'listener' && q.nome === 'partite' &&
    q.testo.includes('stato == "attesa"'));
  const lStorico = ql.filter(q => q.tipo === 'listener' && q.nome === 'partite' &&
    q.testo.includes('stato == "conclusa"'));
  const lPic = ql.filter(q => q.tipo === 'listener' && q.nome === 'pictionary_rooms');
  ok(lPartite.length === 1, 'un listener dedicato agli inviti (trovati: ' + lPartite.length + ')');
  ok(lStorico.length === 1, 'il listener dello storico resta il suo, separato');
  ok(!!lPartite[0] && lPartite[0].filtri.length === 2,
    'query invitati limitata: ' + (lPartite[0] ? lPartite[0].testo : '(nessuna)'));
  ok(!!lPartite[0] && lPartite[0].testo.includes('partecipanti array-contains "TEST"'),
    'solo le partite a cui partecipo');
  ok(!!lPartite[0] && lPartite[0].testo.includes('stato == "attesa"'),
    'solo le partite ancora in attesa (niente storico scaricato)');
  ok(lPic.length === 1 && lPic[0].testo.includes('players array-contains "TEST"') &&
     lPic[0].testo.includes('stato == "lobby"'),
    'listener anche per le room pictionary in lobby: ' + (lPic[0] ? lPic[0].testo : '(nessuno)'));
  ok(window.eval('invitiListenerAttivo') === true, 'listener inviti attivo');
  ok(window.eval('REFRESH_PARTITE_MS') === 60000, 'la lista partite resta a 60s (non e\' lei a portare gli inviti)');

  console.log('\n[B] L\'invito arriva in tempo reale, senza refresh e senza polling');
  const letturePrima = window.eval('__MOCK_DB__.__contatori.letture');
  const t0 = Date.now();
  window.eval(`__MOCK_DB__.__pushDoc('partite', {
    id: 'INV-1', gioco: 'patata', stato: 'attesa',
    partecipanti: ['COLLEGA', 'TEST'], punteggi: { COLLEGA: 0, TEST: 0 },
    pronti: [], rivincitaAccettataDa: [], rivincitaRifiutataDa: [], timestamp: 1000
  })`);
  let ms = -1;
  for (let i = 0; i < 300; i++) {
    await sleep(10);
    if (visibile()) { ms = Date.now() - t0; break; }
  }
  ok(ms >= 0 && ms < 2000, 'popup invito dopo ' + ms + ' ms (prima: fino a 60000 ms)');
  ok(titolo().includes('COLLEGA'), 'titolo con lo sfidante: ' + titolo());
  ok(window.eval('__MOCK_DB__.__contatori.letture') === letturePrima,
    'nessuna query aggiuntiva: l\'invito arriva dallo snapshot');
  ok(window.eval(`invitiPendenti().filter(function(i){ return i.id === 'INV-1'; }).length`) === 1,
    'invito riconosciuto tra i pendenti');

  console.log('\n[C] La lista "Partite in Corso" segue l\'invito');
  await sleep(1500);
  ok(window.document.getElementById('lista-partite').textContent.includes('SFIDA DA COLLEGA'),
    'riga sfida in lista senza refresh manuale');

  console.log('\n[D] Una partita gia\' iniziata non e\' un invito');
  window.eval(`__MOCK_DB__.__pushDoc('partite', {
    id: 'INV-2', gioco: 'patata', stato: 'in_corso',
    partecipanti: ['ALTRO', 'TEST'], punteggi: {}, timestamp: 1500
  })`);
  await sleep(150);
  ok(window.eval(`invitiPendenti().some(function(i){ return i.id === 'INV-2'; })`) === false,
    'stato != attesa -> nessun invito');
  ok(window.eval(`invitiLive.partite.length`) === 1, 'lo snapshot contiene solo la partita in attesa');

  console.log('\n[E] Piu\' inviti: coda visibile e ✖ che passa al successivo');
  window.eval(`__MOCK_DB__.__pushDoc('partite', {
    id: 'INV-3', gioco: 'nomi-cose-citta', stato: 'attesa',
    partecipanti: ['ALTRO2', 'TEST'], punteggi: {},
    rivincitaAccettataDa: [], rivincitaRifiutataDa: [], timestamp: 2000
  })`);
  await sleep(150);
  ok(window.eval('invitiPendenti().length') === 2, 'due inviti pendenti');
  ok(titolo().includes('ALTRO2'), 'il popup mostra il piu\' recente: ' + titolo());
  ok(coda().style.display === 'block', 'riga "altri inviti" visibile');
  ok(/ancora 1 invito/.test(coda().textContent), 'testo coda: ' + coda().textContent);
  window.eval('chiudiInvito()');
  await sleep(60);
  ok(visibile(), 'dopo la ✖ il popup resta aperto (prima si nascondeva tutto)');
  ok(titolo().includes('COLLEGA'), 'mostra l\'invito successivo: ' + titolo());
  ok(coda().style.display === 'none', 'niente riga coda con un solo invito');
  window.eval('chiudiInvito()');
  await sleep(60);
  ok(!visibile(), 'chiuso anche l\'ultimo invito');
  ok(window.eval('invitiIgnorati.size') === 2, 'ignorati solo i due chiusi con ✖');

  console.log('\n[F] Rifiutare un invito non blocca la partita');
  window.eval(`__MOCK_DB__.__pushDoc('partite', {
    id: 'INV-4', gioco: 'patata', stato: 'attesa',
    partecipanti: ['COLLEGA', 'TEST'], punteggi: { COLLEGA: 0, TEST: 0 },
    rivincitaAccettataDa: [], rivincitaRifiutataDa: [], timestamp: 3000
  })`);
  await sleep(150);
  ok(visibile() && titolo().includes('COLLEGA'), 'nuovo invito mostrato: ' + titolo());
  window.document.getElementById('invite-rif').click();
  await sleep(200);
  const scritti = JSON.parse(window.eval(
    'JSON.stringify(__MOCK_DB__.__scritture.filter(function(w){ return w.coll === "partite" && w.id === "INV-4" && w.update; }))'));
  ok(scritti.length === 1, 'una scrittura di rifiuto');
  const agg = (scritti[0] || {}).update || {};
  ok(agg.invitoRifiutatoDa && agg.invitoRifiutatoDa.__op === 'array-union' &&
     agg.invitoRifiutatoDa.args[0] === 'TEST', 'rifiuto nel campo dedicato invitoRifiutatoDa');
  ok(agg.partecipanti && agg.partecipanti.__op === 'array-remove' &&
     agg.partecipanti.args[0] === 'TEST', 'chi rifiuta esce dai partecipanti');
  ok(!('rivincitaRifiutataDa' in agg), 'rivincitaRifiutataDa non viene piu\' toccato');
  const dopo = JSON.parse(docDi('partite', 'INV-4') || 'null');
  ok(!!dopo && dopo.partecipanti.join(',') === 'COLLEGA',
    'documento: partecipanti = ' + (dopo ? dopo.partecipanti.join(',') : '(nessun doc)') +
    ' (la lobby non aspetta chi ha rifiutato)');
  ok(!!dopo && (dopo.rivincitaRifiutataDa || []).length === 0,
    'rivincita non marcata come rifiutata: il pulsante RIVINCITA resta attivo');
  ok(!visibile(), 'popup chiuso dopo il rifiuto');
  ok(window.eval(`invitiPendenti().some(function(i){ return i.id === 'INV-4'; })`) === false,
    'l\'invito rifiutato non torna nel popup');

  console.log('\n[G] Anti-rimbalzo: il refresh viene rimandato, non buttato');
  const letture0 = window.eval('__MOCK_DB__.__contatori.letture');
  window.eval('ultimoRefreshPartite = Date.now() - 3000');   // dentro la finestra di 4s
  window.eval('window.dispatchEvent(new Event("focus"))');
  ok(window.eval('refreshRinviato !== null'), 'refresh accodato alla fine della finestra');
  await sleep(1700);
  ok(window.eval('__MOCK_DB__.__contatori.letture') > letture0,
    'il refresh accodato e\' partito davvero (prima l\'invito aspettava il minuto)');
  ok(window.eval('refreshRinviato === null'), 'coda svuotata');

  console.log('\n[H] Ripiego se l\'indice composito non c\'e\'');
  window.eval('__MOCK_DB__.__forzaErroreQuery("The query requires an index.")');
  window.eval('avviaListenerInviti()');
  await sleep(200);
  ok(window.eval('__warn').some(m => /ripiego/.test(m)),
    'avviso chiaro in console: ' + (window.eval('__warn').filter(m => /ripiego/.test(m))[0] || '(nessuno)'));
  const lPartite2 = queryLog().filter(q => q.tipo === 'listener' && q.nome === 'partite');
  const ripiego = lPartite2[lPartite2.length - 1];
  ok(!!ripiego && ripiego.filtri.length === 1 && ripiego.filtri[0].op === 'array-contains',
    'listener di ripiego senza filtro di stato: ' + (ripiego ? ripiego.testo : '(nessuno)'));
  const t1 = Date.now();
  window.eval(`__MOCK_DB__.__pushDoc('partite', {
    id: 'INV-5', gioco: 'patata', stato: 'attesa',
    partecipanti: ['TERZO', 'TEST'], punteggi: {}, timestamp: 4000
  })`);
  let ms2 = -1;
  for (let i = 0; i < 200; i++) {
    await sleep(10);
    if (visibile()) { ms2 = Date.now() - t1; break; }
  }
  ok(ms2 >= 0 && ms2 < 2000, 'inviti in tempo reale anche col ripiego: ' + ms2 + ' ms');
  ok(titolo().includes('TERZO'), 'popup sul nuovo invito: ' + titolo());

  console.log('\n[I] Invito pictionary: chi rifiuta esce dalla room');
  const t2 = Date.now();
  window.eval(`__MOCK_DB__.__pushDoc('pictionary_rooms', {
    id: 'ROOM1', host: 'OSPITE', players: ['OSPITE', 'TEST'], ready: [],
    stato: 'lobby', timestamp: 5000
  })`);
  let ms3 = -1;
  for (let i = 0; i < 200; i++) {
    await sleep(10);
    if (visibile()) { ms3 = Date.now() - t2; break; }
  }
  ok(ms3 >= 0 && ms3 < 2000, 'invito pictionary in tempo reale: ' + ms3 + ' ms');
  ok(titolo().includes('OSPITE'), 'popup sulla room pictionary: ' + titolo());
  window.document.getElementById('invite-rif').click();
  await sleep(200);
  const scRoom = JSON.parse(window.eval(
    'JSON.stringify(__MOCK_DB__.__scritture.filter(function(w){ return w.coll === "pictionary_rooms" && w.id === "ROOM1" && w.update; }))'));
  const aggRoom = (scRoom[0] || {}).update || {};
  ok(aggRoom.players && aggRoom.players.__op === 'array-remove' && aggRoom.players.args[0] === 'TEST',
    'chi rifiuta esce dai players');
  ok(aggRoom.ready && aggRoom.ready.__op === 'array-remove', 'tolto anche dai pronti');
  const room = JSON.parse(docDi('pictionary_rooms', 'ROOM1') || 'null');
  ok(!!room && room.players.join(',') === 'OSPITE',
    'room con i soli giocatori rimasti: ' + (room ? room.players.join(',') : '(nessuna)') +
    ' (l\'host puo\' iniziare)');
  ok(!titolo().includes('OSPITE'), 'il popup non resta sulla room rifiutata: ' + titolo());
  ok(window.eval(`invitiPendenti().some(function(i){ return i.id === 'ROOM1'; })`) === false,
    'room rifiutata fuori dalla coda');

  console.log('\n[J] Una partita annullata sparisce dal popup');

  window.eval(`__MOCK_DB__.__deleteDoc('partite', 'INV-5')`);
  await sleep(1600);   // debounce + refresh della lista
  ok(!visibile(), 'popup chiuso dopo l\'annullamento della sfida');
  ok(window.eval(`invitiLive.partite.some(function(p){ return p.id === 'INV-5'; })`) === false,
    'snapshot senza la partita cancellata');

  ok(errors.length === 0, 'nessun errore uncaught finale: ' + errors.join('; '));

  console.log('\n=================');
  console.log('PASSATI: ' + passed + '  FALLITI: ' + failed);
  window.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('ERRORE TEST INVITI:', e);
  process.exit(1);
});
