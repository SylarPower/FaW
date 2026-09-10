/* Test del podio condiviso (games/shared/podio.js + podio.css).
   È l'unico posto dove si calcolano posizioni e gradini, quindi le regole
   vengono verificate qui una volta per tutti i giochi multiplayer:
   ordine per punteggio decrescente, tutti i giocatori presenti, gradino del 1°
   più alto e via via più basso, nomi escapati. */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const podioJs = fs.readFileSync(path.join(ROOT, 'games/shared/podio.js'), 'utf8');
const podioCss = fs.readFileSync(path.join(ROOT, 'games/shared/podio.css'), 'utf8');

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  \u2714', msg); }
  else { failed++; console.log('  \u2718', msg); }
}
function eq(a, b, msg) {
  if (JSON.stringify(a) === JSON.stringify(b)) { passed++; console.log('  \u2714', msg); }
  else { failed++; console.log('  \u2718', msg, '\n    atteso:', JSON.stringify(b), '\n    ottenuto:', JSON.stringify(a)); }
}

const dom = new JSDOM('<!DOCTYPE html><html><head><style>' + podioCss + '</style></head><body><div id="podio"></div></body></html>', {
  runScripts: 'dangerously'
});
const w = dom.window;
w.eval(podioJs);
const P = w.FAWPodio;

console.log('\n[1] API del modulo');
ok(!!P && typeof P.render === 'function' && typeof P.ordina === 'function', 'window.FAWPodio esposto con render/ordina');
eq([P.altezza(0), P.altezza(1), P.altezza(2), P.altezza(3)], [104, 88, 72, 56], 'gradini: 104, 88, 72, 56');
ok(P.altezza(9) === 32 && P.altezza(20) === 32, 'gradino minimo 32px anche per l\'ultimo di tanti giocatori');

console.log('\n[2] Ordine della classifica');
eq(P.ordina([{ nome: 'BETA', punti: 6 }, { nome: 'ALFA', punti: 10 }, { nome: 'GAMMA', punti: 5 }])
  .map((r) => r.nome), ['ALFA', 'BETA', 'GAMMA'], 'punteggio decrescente');
eq(P.ordina([{ nome: 'ZETA', punti: 7 }, { nome: 'ALFA', punti: 7 }]).map((r) => r.nome),
  ['ALFA', 'ZETA'], 'a pari punti conta il nome (ordine alfabetico)');
eq(P.ordina([{ nome: 'A' }, { nome: 'B', punti: 'x' }, { nome: 'C', punti: 3 }]).map((r) => r.nome),
  ['C', 'A', 'B'], 'punteggio mancante o non numerico vale 0');

console.log('\n[3] Rendering nel DOM');
const righe = [
  { nome: 'DELTA', punti: 1 },
  { nome: 'ALFA', punti: 10, sottotitolo: '3 parole' },
  { nome: 'BETA', punti: 6 },
  { nome: 'GAMMA', punti: 5 },
  { nome: 'EPSILON', punti: 0 }
];
const box = w.document.getElementById('podio');
const ordinate = P.render(box, righe, { io: 'BETA' });
eq(ordinate.map((r) => r.nome), ['ALFA', 'BETA', 'GAMMA', 'DELTA', 'EPSILON'], 'render restituisce le righe ordinate');
ok(box.classList.contains('podio'), 'il contenitore riceve la classe .podio');
const cols = box.querySelectorAll('.pod-col');
eq(cols.length, 5, 'TUTTI i giocatori entrano nel podio (5 colonne)');
eq(Array.from(cols).map((c) => c.className.replace('pod-col ', '')), ['p1', 'p2', 'p3', 'pn', 'pn'],
  'classi di posizione p1/p2/p3 e pn per gli altri');
const altezze = Array.from(cols).map((c) => parseInt(c.querySelector('.pod-bar').style.height, 10));
eq(altezze, [104, 88, 72, 56, 40], 'altezze decrescenti dalla prima posizione');
ok(altezze.every((h, i) => i === 0 || h < altezze[i - 1]), 'ogni gradino è più basso del precedente');
eq(Array.from(cols).map((c) => c.getAttribute('data-pos')), ['1', '2', '3', '4', '5'], 'data-pos progressivo');
eq(Array.from(cols).map((c) => c.querySelector('.pod-bar').textContent), ['10', '6', '5', '1', '0'],
  'punteggi nei gradini, nell\'ordine giusto');
eq(Array.from(cols).map((c) => c.querySelector('.pod-medal').textContent), ['🥇', '🥈', '🥉', '#4', '#5'],
  'medaglie per i primi tre, numero per gli altri');
ok(cols[1].querySelector('.pod-name').textContent.indexOf('(TU)') !== -1, 'il giocatore corrente è marcato (TU)');
ok(cols[0].querySelector('.pod-name').textContent.indexOf('(TU)') === -1, 'nessun (TU) sugli altri');
ok(cols[0].querySelector('.pod-sub').textContent === '3 parole', 'sottotitolo mostrato');
ok(!cols[1].querySelector('.pod-sub'), 'nessun sottotitolo vuoto');
eq(Array.from(cols).map((c) => parseInt(c.style.getPropertyValue('--pod-h'), 10)), [104, 88, 72, 56, 40],
  '--pod-h coerente con l\'altezza del gradino');

console.log('\n[4] Sicurezza del markup');
P.render(box, [{ nome: '<img src=x onerror=alert(1)>', punti: 4 }], {});
ok(box.querySelectorAll('img').length === 0, 'un nome con HTML non genera elementi');
ok(box.textContent.indexOf('<img') !== -1, 'il nome resta visibile come testo');
ok(P.esc('a&b"c\'d<e>') === 'a&amp;b&quot;c&#39;d&lt;e&gt;', 'esc() copre i caratteri pericolosi');

console.log('\n[5] CSS condiviso');
ok(/\.podio\s*\{/.test(podioCss) && /\.pod-bar\s*\{/.test(podioCss), 'regole di struttura presenti');
ok(/height:\s*var\(--pod-h/.test(podioCss), 'l\'altezza del gradino viene da --pod-h');
ok(/--podio-card/.test(podioCss) && /--podio-text/.test(podioCss), 'variabili di tema sovrascrivibili dai giochi');

console.log('\n=================');
console.log('PASSATI: ' + passed + '  FALLITI: ' + failed);
process.exit(failed ? 1 : 0);
