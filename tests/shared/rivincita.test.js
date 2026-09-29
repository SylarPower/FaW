/* Rivincita condivisa: soglia di accettazione, destinazione, limiti giocatori. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'games/shared/rivincita.js'), 'utf8');
const sandbox = { console, Math, Date, setTimeout };
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const R = sandbox.FAW_RIVINCITA;

const senzaSeed = (o) => { const c = Object.assign({}, o); delete c.seed; return c; };
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✔', msg); }
  else { failed++; console.log('  ✘', msg); }
}
function eq(a, b, msg) {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja === jb) { passed++; console.log('  ✔', msg); }
  else { failed++; console.log('  ✘', msg, '\n    atteso:', jb, '\n    ottenuto:', ja); }
}

console.log('\n[1] Si entra solo quando tutti gli altri hanno accettato');
ok(!R.tuttiAccettati(['A', 'B', 'C'], 'A', []), 'nessuna accettazione');
ok(!R.tuttiAccettati(['A', 'B', 'C'], 'A', ['B']), 'manca un giocatore');
ok(R.tuttiAccettati(['A', 'B', 'C'], 'A', ['B', 'C']), 'gli altri due bastano, il creatore non ri-accetta');
ok(!R.tuttiAccettati(['A', 'B'], 'A', ['A']), 'l\'accettazione del creatore non chiude da sola');
ok(!R.tuttiAccettati(['A'], 'A', []), 'un solo giocatore non parte in automatico');

console.log('\n[2] Destinazione del gioco scelto, non di quello corrente');
ok(R.href('patata', 'M1') === '../patata/index.html?matchId=M1', 'patata usa matchId');
ok(R.href('pictionary', 'AB12') === '../pictionary/index.html?room=AB12', 'pictionary usa room');
ok(R.href('nomi-cose-citta', 'N1').indexOf('nomi-cose-citta') !== -1, 'ncc ha la sua cartella');
ok(R.nome('gameof15') === 'Gioco del 15', 'nome leggibile');

console.log('\n[3] Limiti giocatori');
ok(R.adatto('patata', 2).ok, 'patata con 2');
ok(!R.adatto('patata', 9).ok, 'patata rifiuta 9');
ok(!R.adatto('pictionary', 1).ok, 'pictionary rifiuta il solo');
ok(R.adatto('ruzzle', 10).ok, 'ruzzle arriva a 10');
ok(!R.adatto('ruzzle', 11).ok, 'ruzzle rifiuta 11');

console.log('\n[4] Fase della proposta');
const aperta = R.fase({
  partecipanti: ['A', 'B'],
  prossimaPartita: 'X',
  prossimaPartitaCreataDa: 'A',
  prossimaPartitaGioco: 'patata',
  rivincitaAccettataDa: [],
  rivincitaRifiutataDa: []
}, 'B');
ok(aperta.fase === 'decidi' && aperta.nome === 'Patata Bollente', 'chi non ha creato deve decidere, e vede il gioco giusto');
const pronta = R.fase({
  players: ['A', 'B'],
  prossimaPartita: 'ROOM',
  prossimaPartitaCreataDa: 'A',
  prossimaPartitaGioco: 'ruzzle',
  rivincitaAccettataDa: ['B'],
  rivincitaRifiutataDa: []
}, 'A');
ok(pronta.fase === 'vai' && pronta.gioco === 'ruzzle', 'room pictionary: players vale come partecipanti, e si va al gioco nuovo');
const rifiutata = R.fase({
  partecipanti: ['A', 'B'],
  prossimaPartita: 'X',
  prossimaPartitaCreataDa: 'A',
  prossimaPartitaGioco: 'gameof15',
  rivincitaAccettataDa: ['B'],
  rivincitaRifiutataDa: ['B']
}, 'A');
ok(rifiutata.fase === 'rifiutata', 'un rifiuto blocca anche se c\'è un\'accettazione');

console.log('\n[5] Documento nuovo');
const doc = R.documentoPartita('nomi-cose-citta', ['A', 'B'], R.opzioniDefault('nomi-cose-citta'));
ok(doc.gioco === 'nomi-cose-citta' && doc.stato === 'attesa' && doc.round === 0, 'ncc nasce in attesa, senza round');
ok(doc.opzioni.categorie === 'multi', 'categorie di default multi');
ok(doc.punteggi.A === 0 && doc.punteggi.B === 0, 'punteggi azzerati');
/* La lobby nasce da una rivincita: l'hub deve saperlo (l'accettazione vive
   sulla partita di origine, non su questo documento). */
const docRem = R.documentoPartita('patata', ['A', 'B'], R.opzioniDefault('patata'), 'ORIGINE-1');
ok(docRem.daRivincita === true && docRem.rivincitaDi === 'ORIGINE-1',
  'documento marcato daRivincita + rivincitaDi');
eq(docRem.rivincitaCollezione, 'partite', 'origine nei "partite": la lobby lo dichiara');
const docRemCross = R.documentoPartita('patata', ['A', 'B'], R.opzioniDefault('patata'),
  'ROOM-1', 'pictionary_rooms');
eq([docRemCross.rivincitaDi, docRemCross.rivincitaCollezione], ['ROOM-1', 'pictionary_rooms'],
  'rivincita da una room Pictionary: la lobby sa dove segnare l\'accettazione');
const roomRem = R.documentoRoom(['A', 'B'], 'A', R.opzioniDefault('pictionary'), 'ORIGINE-2');
ok(roomRem.data.daRivincita === true && roomRem.data.rivincitaDi === 'ORIGINE-2',
  'anche la room Pictionary è marcata');
eq(roomRem.data.rivincitaCollezione, 'partite', 'room con origine in "partite"');

console.log('\n[6] Schema delle impostazioni (unica fonte per la modale)');
{
  const giochi = Object.keys(R.giochi);
  ok(giochi.length >= 5, 'giochi con schema: ' + giochi.join(', '));
  giochi.forEach((id) => {
    const g = R.giochi[id];
    let problema = '';
    (g.opzioni || []).forEach((o) => {
      if (!o.id || !o.label) problema = o.id + ': id/label mancanti';
      if (!(o.valori || []).some((v) => String(v.v) === String(o.def))) problema = o.id + ': default fuori elenco';
      (o.valori || []).forEach((v) => { if (v.v == null || !v.label) problema = o.id + ': valore senza etichetta'; });
    });
    ok(!problema, id + ': opzioni e default coerenti' + (problema ? ' → ' + problema : ''));
    const ids = (g.modalita || []).map((m) => m.id);
    ok(ids.length > 0 && new Set(ids).size === ids.length, id + ': modalità senza duplicati (' + ids.join('/') + ')');
  });
  eq(senzaSeed(R.opzioniDefault('ruzzle')), { tempo: '60', griglia: '5', mode: 'classic' },
    'ruzzle: default 60s · 5×5 · classica');
  eq(senzaSeed(R.opzioniDefault('patata')), { tempo: '60', turni: '3', lettere: '3', mode: 'classic' },
    'patata: default 60s · 3 turni · 3 lettere · classica');
  eq(senzaSeed(R.opzioniDefault('nomi-cose-citta')), { round: '3', tempo: '120', revisione: '90', categorie: 'multi', mode: 'classica' },
    'ncc: default 3 round · 120s · 90s · multi');
  eq(senzaSeed(R.opzioniDefault('gameof15')), { durata: '180', griglia: '4', mode: 'numbers' },
    'gameof15: default 3 min · 4×4 · numeri');
  const picDef = senzaSeed(R.opzioniDefault('pictionary'));
  ok(picDef.mode === 'classic' && picDef.timePerRound === 60,
    'pictionary: default 60s · sfida (tempo numerico)');

  const scelte = R.opzioniScelte('patata', { tempo: '120' },
    { tempo: '30', turni: '5', lettere: '2', mode: 'mix' });
  ok(scelte.tempo === '120', 'la scelta dell\'utente vince');
  ok(scelte.turni === '5' && scelte.lettere === '2' && scelte.mode === 'mix',
    'le altre opzioni arrivano dalla partita appena finita');
  const fuori = R.opzioniScelte('patata', { tempo: '999', turni: 'x' }, {});
  ok(fuori.tempo === '60' && fuori.turni === '3', 'valori fuori schema scartati → default');
  ok(!!scelte.seed && scelte.seed !== fuori.seed, 'seed sempre nuovo (mai la griglia della partita finita)');
  ok(R.opzioniScelte('nomi-cose-citta', {}, { categorie: [{ id: 'nomi' }, { id: 'cose' }, { id: 'citta' }] }).categorie === 'light',
    'ncc: categorie risolte (3) → preset light');
  ok(R.opzioniScelte('nomi-cose-citta', {},
    { categorie: [{ id: 'nomi' }, { id: 'cose' }, { id: 'citta' }, { id: 'animali' }, { id: 'frutta' }, { id: 'mestieri' }, { id: 'colori' }] }).categorie === 'multi',
  'ncc: 7 categorie → preset multi');
  ok(R.opzioniScelte('nomi-cose-citta', { categorie: 'light' }, {}).categorie === 'light',
    'ncc: la scelta esplicita nel menu resta');
  const pic = R.opzioniScelte('pictionary', { timePerRound: '90' }, {});
  ok(pic.timePerRound === 90 && typeof pic.timePerRound === 'number', 'pictionary: tempo numerico per la room');
  eq(R.riepilogo('ruzzle', { tempo: '60', griglia: '5', mode: 'bonus' }), '60s · 5×5 · BONUS',
    'riepilogo compatto delle impostazioni');
}

(async () => {
  console.log('\n[7] Modale della rivincita: schede dei giochi + impostazioni');
  {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'http://localhost/games/patata/index.html',
      runScripts: 'dangerously'
    });
    const w = dom.window;
    w.eval(src);
    const M = w.FAW_RIVINCITA;
    const doc = w.document;
    const click = (el) => el.dispatchEvent(new w.Event('click', { bubbles: true }));
    let scelta = null;
    M.apriScelta({
      giocoCorrente: 'patata',
      n: 3,
      correnti: { tempo: '30', turni: '5', lettere: '2', mode: 'mix' },
      disabilitati: { pictionary: 'Solo l\'host può rigiocare questa room' },
      onConferma: (id, op) => { scelta = { id: id, op: op }; }
    });
    const schede = () => Array.from(doc.querySelectorAll('.faw-rv-giochi [data-gioco]'));
    const sel = (id) => doc.querySelector('#faw-rv-settings [data-opt="' + id + '"]');
    ok(schede().length >= 5, 'una scheda per ogni gioco (' + schede().length + ')');
    ok(schede()[0].getAttribute('data-gioco') === 'patata', 'il gioco corrente è la prima scheda');
    ok(schede()[0].classList.contains('is-on') && schede()[0].getAttribute('aria-pressed') === 'true',
      'scheda del gioco corrente selezionata');
    ok(schede().some((c) => c.getAttribute('data-gioco') === 'pictionary' && c.disabled),
      'gioco non disponibile mostrato come disabilitato');
    ok(sel('tempo').value === '30' && sel('turni').value === '5' && sel('lettere').value === '2',
      'impostazioni pre-riempite con quelle della partita appena finita');
    ok(doc.querySelector('#faw-rv-settings [data-modo="mix"]').classList.contains('is-on'),
      'modalità della partita già selezionata');
    ok(/30s/.test(doc.getElementById('faw-rv-sum').textContent) &&
      /MIX/.test(doc.getElementById('faw-rv-sum').textContent),
    'riepilogo aggiornato: ' + doc.getElementById('faw-rv-sum').textContent);

    /* cambio gioco: il pannello passa alle impostazioni dell'altro gioco */
    click(schede().find((c) => c.getAttribute('data-gioco') === 'gameof15'));
    ok(doc.querySelector('[data-gioco="gameof15"]').classList.contains('is-on') &&
      /3 min/.test(doc.getElementById('faw-rv-sum').textContent),
    'Gioco del 15: pannello con le sue impostazioni (' + doc.getElementById('faw-rv-sum').textContent + ')');

    /* si torna indietro: la scelta fatta prima non si perde */
    click(doc.querySelector('[data-gioco="patata"]'));
    sel('tempo').value = '120';
    sel('tempo').dispatchEvent(new w.Event('change', { bubbles: true }));
    click(doc.querySelector('[data-gioco="gameof15"]'));
    click(doc.querySelector('[data-gioco="patata"]'));
    ok(sel('tempo').value === '120', 'la scelta fatta su un gioco resta cambiando gioco e tornando');

    /* conferma: arrivano gioco e opzioni validate */
    click(doc.querySelector('[data-gioco="gameof15"]'));
    click(doc.getElementById('faw-rv-conferma'));
    ok(!!scelta && scelta.id === 'gameof15', 'conferma con il gioco selezionato (' + (scelta && scelta.id) + ')');
    eq(senzaSeed(scelta.op), { durata: '180', griglia: '4', mode: 'numbers' },
      'opzioni della lobby validate dallo schema');
    ok(!doc.getElementById('faw-rv-title'), 'modale chiusa dopo la conferma');

    /* ESC chiude senza creare nulla */
    let confermato = false;
    M.apriScelta({ giocoCorrente: 'ruzzle', n: 2, onConferma: () => { confermato = true; } });
    ok(!!doc.getElementById('faw-rv-title'), 'modale riaperta');
    doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
    ok(!doc.getElementById('faw-rv-title') && !confermato, 'ESC chiude la modale senza confermare');

    /* una nuova apertura riparte dalle impostazioni della partita, non dalle
       scelte fatte (e poi abbandonate) nella modale precedente */
    M.apriScelta({
      giocoCorrente: 'patata', n: 3,
      correnti: { tempo: '30', turni: '5', lettere: '2', mode: 'mix' }
    });
    ok(doc.querySelector('#faw-rv-settings [data-opt="tempo"]').value === '30',
      'alla riapertura contano le impostazioni della partita, non le scelte vecchie');
    M.chiudiScelta();
  }

  console.log('\n[8] invita(): lobby nuova con le opzioni scelte, proposta collegata');
  {
    const { createMockFirestore } = require('../ncc/mock-firestore.js');
    const mock = createMockFirestore();
    const corrente = { gioco: 'ruzzle', partecipanti: ['ALFA', 'BETA'], stato: 'conclusa',
      opzioni: { tempo: '60', griglia: '5', mode: 'classic' } };
    mock.store.set('partite/C1', corrente);
    R.prepara({
      db: mock.db, ref: mock.db.collection('partite').doc('C1'), me: 'ALFA',
      partecipanti: ['ALFA', 'BETA'], proposta: corrente, correnti: corrente.opzioni
    });
    const r = await R.invita('patata', { tempo: '120', turni: '2', mode: 'sequenza' });
    ok(r && r.ok, 'lobby di Patata creata (id ' + (r && r.id) + ')');
    const nuovo = mock.store.get('partite/' + r.id);
    eq([nuovo.opzioni.tempo, nuovo.opzioni.turni, nuovo.opzioni.mode, nuovo.opzioni.lettere],
      ['120', '2', 'sequenza', '3'], 'la lobby nasce con le impostazioni scelte (lettere di default)');
    eq(nuovo.partecipanti, ['ALFA', 'BETA'], 'stessi partecipanti della partita finita');
    eq(nuovo.stato, 'attesa', 'lobby in attesa di tutti');
    eq(nuovo.parole, { ALFA: [], BETA: [] }, 'liste parole vuote per tutti');
    ok(mock.store.get('partite/C1').prossimaPartita === r.id &&
      mock.store.get('partite/C1').prossimaPartitaGioco === 'patata',
    'proposta collegata alla partita corrente');
    ok(mock.store.get('partite/C1').rivincitaAccettataDa.length === 0, 'nessuna accettazione di partenza');
    eq([nuovo.daRivincita, nuovo.rivincitaDi], [true, 'C1'],
      'lobby nuova marcata daRivincita con la partita di origine (l\'hub non la tratta come invito)');

    /* pictionary: stanza nuova con le impostazioni della modale */
    const corrente2 = { gioco: 'patata', partecipanti: ['ALFA', 'BETA'], stato: 'conclusa', opzioni: {} };
    mock.store.set('partite/C2', corrente2);
    R.prepara({
      db: mock.db, ref: mock.db.collection('partite').doc('C2'), me: 'ALFA',
      partecipanti: ['ALFA', 'BETA'], proposta: corrente2, correnti: {}
    });
    const r2 = await R.invita('pictionary', { mode: 'guessit', timePerRound: '45' });
    ok(r2 && r2.ok, 'room Pictionary creata');
    const room = mock.store.get('pictionary_rooms/' + r2.id);
    eq(room.settings, { mode: 'guessit', timePerRound: 45 }, 'room con modalità e tempo scelti');
    eq(room.players, ['ALFA', 'BETA'], 'tutti i giocatori nella room');
    ok(mock.store.get('partite/C2').prossimaPartita === r2.id, 'proposta pictionary collegata');
    eq([room.daRivincita, room.rivincitaDi], [true, 'C2'], 'room marcata come rivincita di C2');
  }

  console.log('\n[9] segnaAccettazione: chi entra nella lobby nuova libera gli altri');
  {
    const vm2 = require('vm');
    const sandbox2 = {
      console, Math, Date, setTimeout,
      firebase: {
        firestore: {
          FieldValue: {
            arrayUnion: function () { return { __op: 'array-union', args: [].slice.call(arguments) }; }
          }
        }
      }
    };
    sandbox2.global = sandbox2;
    vm2.createContext(sandbox2);
    vm2.runInContext(src, sandbox2);
    const R2 = sandbox2.FAW_RIVINCITA;
    const scritture = [];
    let fallisci = false;
    const dbFinto = {
      collection: function (c) {
        return {
          doc: function (id) {
            return {
              update: function (patch) {
                scritture.push({ c: c, id: id, patch: patch });
                return fallisci ? Promise.reject(new Error('not-found')) : Promise.resolve();
              }
            };
          }
        };
      }
    };
    ok(await R2.segnaAccettazione(dbFinto, 'ORIGINE-1', 'BETA'),
      'prima chiamata: accettazione segnata');
    eq(scritture.length, 1, 'una sola scrittura');
    eq([scritture[0].c, scritture[0].id], ['partite', 'ORIGINE-1'], 'scrive sulla partita di ORIGINE');
    eq(scritture[0].patch.rivincitaAccettataDa,
      { __op: 'array-union', args: ['BETA'] }, 'accettazione con arrayUnion (idempotente)');
    ok(await R2.segnaAccettazione(dbFinto, 'ORIGINE-1', 'BETA') === false && scritture.length === 1,
      'seconda chiamata: nessuna scrittura doppia');
    ok(await R2.segnaAccettazione(dbFinto, 'ALTRA', 'BETA'),
      'origine diversa: si segna anche quella');
    /* Origine in un'altra collezione (rivincita nata da una room Pictionary):
       il "si" deve finire sulla room di origine, non su partite/<codice>. */
    ok(await R2.segnaAccettazione(dbFinto, 'ROOM-9', 'BETA', 'pictionary_rooms'),
      'origine Pictionary: accettazione segnata');
    const ultima = scritture[scritture.length - 1];
    eq([ultima.c, ultima.id], ['pictionary_rooms', 'ROOM-9'],
      'scrive nella collezione giusta (pictionary_rooms)');
    eq(ultima.patch.rivincitaAccettataDa, { __op: 'array-union', args: ['BETA'] },
      'stessa modalità idempotente');
    fallisci = true;
    ok(await R2.segnaAccettazione(dbFinto, 'SPARITA', 'BETA') === false,
      'origine inesistente: fallisce in silenzio (nessuna eccezione)');
    ok(await R2.segnaAccettazione(null, 'ORIGINE-1', 'BETA') === false, 'senza db non fa nulla');
  }

  console.log('\n=================');
  console.log('PASSATI: ' + passed + '  FALLITI: ' + failed);
  process.exit(failed ? 1 : 0);
})();
