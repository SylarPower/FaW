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

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✔', msg); }
  else { failed++; console.log('  ✘', msg); }
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

console.log('\n=================');
console.log('PASSATI: ' + passed + '  FALLITI: ' + failed);
process.exit(failed ? 1 : 0);
