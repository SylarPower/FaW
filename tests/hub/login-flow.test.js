/* Test hub: flusso login completo su pagina reale (mock Firestore)
   Verifica che il redesign non rompa: login, dashboard, card giochi, tema,
   inviti (senza audio), aggiornamento manuale della lista partite e la
   barra sfida che segue il gioco selezionato. */
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
  // crypto.subtle (sha-256) per hashPassword: jsdom non lo implementa
  window.__nodeSubtle = crypto.webcrypto.subtle;
  window.eval('Object.defineProperty(window, "crypto", { value: Object.assign({}, window.crypto, { subtle: window.__nodeSubtle }), configurable: true });');
  // jsdom non naviga: dirottiamo l'helper di navigazione dell'hub
  window.eval('window.__nav = []; fawVaiA = function (u) { window.__nav.push(u); };');
  await sleep(150);

  console.log('\n[A] Pagina carica: login');
  const login = window.document.getElementById('login-div');
  ok(!!login, 'login-div presente');
  ok(!!window.document.querySelector('.login-card'), 'card login premium');
  ok(!!window.document.querySelector('.login-cta'), 'CTA login');
  ok(!!window.document.querySelector('.faw-stage'), 'scena ambientale');
  ok(errors.length === 0, 'nessun errore uncaught: ' + errors.join('; '));

  console.log('\n[B] Login con utente mock');
  window.document.getElementById('username').value = 'TEST';
  window.document.getElementById('password').value = 'test123';
  window.eval('entra()');
  await sleep(250);
  const mainApp = window.document.getElementById('main-app');
  ok(mainApp.style.display === 'block', 'main-app visibile dopo login');
  ok(window.document.getElementById('login-div').style.display === 'none', 'login nascosto');
  const disp = window.document.getElementById('user-display').textContent;
  ok(disp.includes('TEST'), 'nome utente nel chip: ' + disp);
  const av = window.document.getElementById('user-avatar');
  ok(av.textContent === 'TE', 'avatar con iniziali: ' + av.textContent);
  ok(av.style.getPropertyValue('--h') !== '', 'avatar con tinta deterministica');

  console.log('\n[C] Dashboard premium');
  const cards = window.document.querySelectorAll('.game-card');
  ok(cards.length === 7, '7 card giochi (trovate: ' + cards.length + ')');
  ok(!!window.document.querySelector('#game-patata .g-tag'), 'card patata con tagline');
  ok(!!window.document.querySelector('#game-nomi-cose-citta .g-tag'), 'card nomi-cose-citta con tagline');
  ok(window.document.querySelector('#game-ruzzle').classList.contains('selected'), 'ruzzle selezionato di default');
  ok(!!window.document.getElementById('online-count'), 'pill online nell\u2019header');
  ok(!!window.document.getElementById('theme-toggle'), 'toggle tema');
  ok(!!window.document.getElementById('lista-partite'), 'lista partite');
  ok(!!window.document.getElementById('lista-amici'), 'lista amici');
  ok(!!window.document.getElementById('stats-content'), 'statistiche');
  ok(errors.length === 0, 'nessun errore uncaught: ' + errors.join('; '));

  console.log('\n[D] Tema chiaro/scuro');
  const before = window.document.documentElement.getAttribute('data-theme');
  window.eval('fawToggleTheme()');
  const after = window.document.documentElement.getAttribute('data-theme');
  ok(before !== after, 'tema cambiato: ' + before + ' -> ' + after);
  const saved = window.localStorage.getItem('faw-theme');
  ok(saved === after, 'tema persistito in localStorage');
  const btn = window.document.getElementById('theme-toggle');
  ok(btn.textContent.length > 0, 'icona toggle aggiornata: ' + btn.textContent);

  console.log('\n[E] Nessuna opzione Disponibili / Non disturbare');
  ok(!window.document.getElementById('btn-disponibilita'), 'pulsante disponibilita\' rimosso dall\u2019header');
  ok(window.eval('typeof toggleDisponibilita === "undefined"'), 'toggleDisponibilita non esiste piu\'');
  ok(window.eval('typeof aggiornaUIDisponibilita === "undefined"'), 'aggiornaUIDisponibilita non esiste piu\'');
  const presWrite = window.__MOCK_DB__.__scritture.filter(w => w.coll === 'presenze').pop();
  ok(!!presWrite, 'presenza scritta');
  ok(presWrite && !('disponibile' in presWrite.data), 'nessun campo "disponibile" nella presenza');

  console.log('\n[F] Nessun audio nella webapp');
  ok(!/AudioContext|createOscillator|new Audio\(/.test(HTML), 'nessun costrutto audio nel sorgente hub');
  ok(window.eval('typeof suonoInvito === "undefined"'), 'suonoInvito rimosso');

  console.log('\n[G] Lista partite: refresh manuale + cadenza 60s');
  ok(!!window.document.getElementById('btn-refresh-partite'), 'pulsante Aggiorna presente');
  ok(!!window.document.getElementById('refresh-meta'), 'etichetta ultimo aggiornamento presente');
  ok(window.eval('REFRESH_PARTITE_MS') === 60000, 'cadenza automatica = 60000 ms');
  ok(!/setInterval\(caricaPartitePictionary/.test(HTML), 'nessun polling pictionary a pochi secondi');
  const hb = window.eval('PRESENZA_HEARTBEAT_MS');
  ok(hb === 30000, 'battito presenza ogni 30s (finestra online 60s): ' + hb);

  const sfida = (extra) => Object.assign({
    id: 'match-123',
    gioco: 'patata', stato: 'attesa',
    partecipanti: ['COLLEGA', 'TEST'],
    punteggi: { COLLEGA: 0, TEST: 0 },
    rivincitaAccettataDa: [], rivincitaRifiutataDa: [],
    dataOra: '09/09 14:00', timestamp: Date.now()
  }, extra || {});

  // arriva una sfida Patata da COLLEGA (passando dal refresh, come fa l'hub)
  window.__MOCK_DB__.__docs.partite = [{ id: 'match-123', data: () => sfida() }];
  await window.eval('refreshPartite(true)');
  await sleep(120);

  console.log('\n[H] Invito sfida: popup evidente, silenzioso');
  const popup = window.document.getElementById('invite-popup');
  ok(popup && popup.style.display === 'block', 'popup invito visibile');
  ok(popup.classList.contains('invite-live'), 'popup con animazione pulsante');
  const inviteTitle = window.document.getElementById('invite-title').textContent;
  ok(inviteTitle.includes('COLLEGA'), 'titolo invito con nome sfidante: ' + inviteTitle);
  ok(window.document.getElementById('invite-sub').textContent.toLowerCase().includes('patata'), 'sottotitolo con nome gioco');
  const lista = window.document.getElementById('lista-partite').textContent;
  ok(lista.includes('SFIDA DA COLLEGA'), 'riga sfida ancora in lista partite');
  ok(!window.eval('navigator.vibrate'), 'nessuna vibrazione per gli inviti');

  console.log('\n[I] Banner/popup non coprono il contenuto');
  // Il popup invito e' aperto: l'hub deve riservare il suo spazio.
  const popupEl = window.document.getElementById('invite-popup');
  ok(window.eval('fawElementoVisibile(document.getElementById("invite-popup"))') === true,
    'popup fixed riconosciuto come visibile (offsetParent e\' null sui fixed!)');
  popupEl.style.display = 'none';
  ok(window.eval('fawElementoVisibile(document.getElementById("invite-popup"))') === false,
    'popup nascosto riconosciuto come non visibile');
  popupEl.style.display = 'block';
  ok(!/offsetParent/.test(HTML), 'nessun uso di offsetParent (bug noto sui position:fixed)');

  // jsdom non fa layout (offsetHeight = 0): verifichiamo il cablaggio,
  // cioe' che l'altezza misurata finisca nelle variabili CSS e che header
  // e contenuto le usino davvero per spostarsi.
  window.eval('fawSyncTopInset()');
  const rootStyle = window.document.documentElement.style;
  ok(rootStyle.getPropertyValue('--faw-top-inset') !== '',
    '--faw-top-inset impostato: ' + rootStyle.getPropertyValue('--faw-top-inset'));
  ok(rootStyle.getPropertyValue('--faw-popup-h') !== '',
    '--faw-popup-h impostato (il banner sfida scende sotto il popup)');
  const cssHub = HTML;
  ok(/\.hub-header\s*\{\s*top:\s*var\(--faw-top-inset\)/.test(cssHub),
    'header sticky agganciato a --faw-top-inset');
  ok(/#main-app\s*\{[^}]*padding-top:\s*var\(--faw-top-inset\)/.test(cssHub),
    'contenuto spostato sotto gli elementi fissi');
  ok(/\.game-banner\s*\{[^}]*top:\s*var\(--faw-popup-h\)/.test(cssHub),
    'banner sfida posizionato sotto il popup invito');

  console.log('\n[J] Accettare l\'invito porta subito in lobby');
  window.document.getElementById('invite-acc').click();
  await sleep(120);
  ok(window.__nav.length === 1, 'un solo redirect: ' + JSON.stringify(window.__nav));
  ok(window.__nav[0] === 'games/patata/index.html?matchId=match-123',
    'redirect alla lobby patata: ' + window.__nav[0]);
  const accWrite = window.__MOCK_DB__.__scritture.filter(w => w.coll === 'partite' && w.update).pop();
  ok(!!accWrite, 'accettazione scritta su Firestore');

  // popup chiuso perche' la sfida ora risulta accettata
  window.__MOCK_DB__.__docs.partite = [{
    id: 'match-123',
    data: () => sfida({ rivincitaAccettataDa: ['TEST'] })
  }];
  await window.eval('refreshPartite(true)');
  await sleep(120);
  ok(popup.style.display === 'none', 'popup chiuso dopo accettazione');

  console.log('\n[K] La lista non viene ricostruita se i dati non cambiano');
  const firma1 = window.eval('ultimaFirmaPartite');
  const htmlPrima = window.document.getElementById('lista-partite').innerHTML;
  window.eval('renderTutteLePartite()');
  ok(window.document.getElementById('lista-partite').innerHTML === htmlPrima,
    'DOM invariato a parita\' di dati (niente sfarfallio)');
  window.eval('renderTutteLePartite(true)');
  ok(window.document.getElementById('lista-partite').innerHTML === htmlPrima,
    'forzando il render il contenuto resta identico');
  ok(firma1.length > 0, 'firma lista calcolata');

  console.log('\n[L] La barra sfida segue il gioco selezionato');
  // selezione amici + apertura barra su Ruzzle
  window.eval("amiciSelezionati.add('COLLEGA'); aggiornaBottoneSfida(); apriModalSfida();");
  await sleep(30);
  let banner = window.document.getElementById('game-banner');
  ok(!!banner, 'barra sfida aperta');
  ok(banner.textContent.includes('RUZZLE'), 'barra su Ruzzle: ' + banner.textContent.slice(0, 40));
  ok(!!window.document.getElementById('opt-griglia-banner'), 'opzione griglia di Ruzzle presente');
  ok(banner.textContent.includes('CLASSICA'), 'modalita\' di Ruzzle presenti');

  // cambio gioco -> Patata: la barra si aggiorna con le opzioni di Patata
  window.eval("selezionaGioco('patata', document.getElementById('game-patata'));");
  await sleep(30);
  banner = window.document.getElementById('game-banner');
  ok(!!banner, 'barra ancora aperta dopo il cambio gioco');
  ok(banner.textContent.includes('PATATA BOLLENTE'), 'barra aggiornata a Patata Bollente');
  ok(!!window.document.getElementById('opt-turni-banner'), 'opzione turni di Patata presente');
  ok(!!window.document.getElementById('opt-lettere-banner'), 'opzione lettere di Patata presente');
  ok(!window.document.getElementById('opt-griglia-banner'), 'opzione griglia di Ruzzle rimossa');

  // cambio gioco -> Nomi, Cose, Città: opzioni di round/tempo/revisione/categorie
  window.eval("selezionaGioco('nomi-cose-citta', document.getElementById('game-nomi-cose-citta'));");
  await sleep(30);
  banner = window.document.getElementById('game-banner');
  ok(!!banner && banner.textContent.includes('NOMI, COSE'), 'barra aggiornata a Nomi, Cose, Città');
  ok(!!window.document.getElementById('opt-round-banner'), 'opzione round di NCC presente');
  ok(!!window.document.getElementById('opt-categorie-banner'), 'opzione categorie di NCC presente');
  ok(banner.textContent.includes('CLASSICA'), "modalita' classica di NCC presente");
  ok(!window.document.getElementById('opt-turni-banner'), 'opzione turni di Patata rimossa');
  ok(window.eval("GIOCHI_CONFIG['nomi-cose-citta'].minGiocatori") === 2, 'minimo 2 giocatori');
  ok(window.eval("GIOCHI_CONFIG['nomi-cose-citta'].maxGiocatori") === 8, 'massimo 8 giocatori');

  // cambio gioco -> gioco solo allenamento: la barra sparisce
  window.eval("selezionaGioco('neonwar', document.getElementById('game-neonwar'));");
  await sleep(30);
  ok(!window.document.getElementById('game-banner'), 'barra chiusa su gioco solo allenamento');
  ok(window.eval('bannerSfidaAperto') === false, 'stato barra sfida resettato');

  // ritorno su gioco multiplayer e riapertura
  window.eval("selezionaGioco('gameof15', document.getElementById('game-gameof15')); amiciSelezionati.add('COLLEGA'); apriModalSfida();");
  await sleep(30);
  banner = window.document.getElementById('game-banner');
  ok(!!banner && banner.textContent.includes('GIOCO DEL 15'), 'barra riaperta su Gioco del 15');
  ok(!!window.document.getElementById('opt-durata-banner'), 'opzione durata di Gioco del 15 presente');
  window.eval('chiudiBannerSfida()');
  ok(!window.document.getElementById('game-banner'), 'barra chiusa con ✖');
  ok(window.eval('amiciSelezionati.size') === 0, 'amici deselezionati alla chiusura');

  console.log('\n[M] Creare una sfida porta subito in lobby');
  window.__nav.length = 0;
  window.eval("selezionaGioco('patata', document.getElementById('game-patata')); amiciSelezionati.add('COLLEGA'); apriModalSfida();");
  await sleep(20);
  await window.eval("creaPartitaDaBanner('classic')");
  await sleep(150);
  ok(window.__nav.length === 1, 'redirect immediato dopo la creazione');
  ok(/^games\/patata\/index\.html\?matchId=NUOVA-1$/.test(window.__nav[0] || ''),
    'redirect alla lobby della nuova partita: ' + window.__nav[0]);

  console.log('\n[N] Una partita di Nomi, Cose, Città in "Partite in Corso"');
  window.eval(`__MOCK_DB__.__docs.partite.push({
    id: 'NCC-1',
    data: () => ({
      gioco: 'nomi-cose-citta',
      partecipanti: ['TEST', 'COLLEGA'],
      stato: 'in_corso', round: 1, punteggi: { TEST: 0, COLLEGA: 0 },
      opzioni: { round: '3', tempo: '120', revisione: '90', categorie: 'classic' },
      dataOra: '2026-09-09 09:00:00'
    })
  });`);
  await window.eval('refreshPartite(true)');
  await sleep(120);
  ok(window.eval('partiteCache.ncc.length') === 1, 'partita NCC nel bucket dedicato');
  ok(window.eval('partiteCache.ruzzle.length') === 0, 'non finisce nel bucket di Ruzzle');
  window.eval('renderTutteLePartite(true)');
  await sleep(80);
  ok(window.document.getElementById('lista-partite').textContent.includes('Nomi, Cose, Città'),
    'nome del gioco nella lista partite');
  ok(window.eval("gameHref('nomi-cose-citta', 'matchId=NCC-1')") ===
     'games/nomi-cose-citta/index.html?matchId=NCC-1', 'link alla lobby della partita NCC');
  // invito pendente per chi non ha ancora accettato
  window.eval(`__MOCK_DB__.__docs.partite.push({
    id: 'NCC-2',
    data: () => ({
      gioco: 'nomi-cose-citta', partecipanti: ['ALTRO', 'TEST'],
      stato: 'attesa', opzioni: { round: '3' }, dataOra: '2026-09-09 09:05:00'
    })
  });`);
  await window.eval('refreshPartite(true)');
  await sleep(120);
  ok(window.eval("invitiPendenti().some(p => p.gioco === 'nomi-cose-citta')"),
    'invito NCC riconosciuto tra quelli pendenti');

  ok(errors.length === 0, 'nessun errore uncaught finale: ' + errors.join('; '));

  console.log('\n=================');
  console.log('PASSATI: ' + passed + '  FALLITI: ' + failed);
  window.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('ERRORE TEST LOGIN:', e);
  process.exit(1);
});
