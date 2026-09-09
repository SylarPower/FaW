/* Test del core logico di Patata Bollente (senza DOM/Firebase) */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, '../../games/patata/js/game.js'));
const fs = require('fs');

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

/* ---------- dizionario finto deterministico ---------- */
function genFakeDict() {
  const pool = ['A', 'B', 'C', 'E', 'O', 'R'];
  const out = [];
  const push = (len, step) => {
    let i = 0;
    const n = Math.pow(pool.length, len);
    while (i < n) {
      let s = '', x = i;
      for (let j = 0; j < len; j++) { s = pool[x % 6] + s; x = (x / 6) | 0; }
      if (step === 1 || (i % step === 0)) out.push(s);
      i++;
    }
  };
  push(4, 1);   // 1296
  push(5, 2);   // ~3888
  push(6, 8);   // ~5832
  return out;
}
const FAKE_WORDS = genFakeDict();
const FAKE_SET = new Set(FAKE_WORDS);
const FAKE_IDX = new C.LetterIndex(FAKE_WORDS);
console.log('Dizionario finto:', FAKE_WORDS.length, 'parole; index ok');

/* ---------- normalizeWord / pointsFor ---------- */
console.log('\n[1] normalizeWord / pointsFor');
eq(C.normalizeWord('  braciòlo  '), 'BRACIOLO', 'strip accenti/spazi');
eq(C.normalizeWord('quìta'), 'QUITa'.toUpperCase(), 'Q accento');
eq(C.normalizeWord('ciao-mondo!'), 'CIAOMONDO', 'strip non A-Z');
eq(C.normalizeWord(''), '', 'vuoto');
eq(C.pointsFor(4), 1, '4 lettere = 1');
eq(C.pointsFor(5), 2, '5 lettere = 2');
eq(C.pointsFor(6), 3, '6 lettere = 3');
eq(C.pointsFor(7), 5, '7 lettere = 5');
eq(C.pointsFor(12), 11, '8+ lettere = 11');

/* ---------- LetterIndex ---------- */
console.log('\n[2] LetterIndex.countFor / countSequence');
const small = ['ABBA', 'BABA', 'BACIO', 'CANE', 'AMORE', 'EDIFICIO', 'FICCANASO'];
const si = new C.LetterIndex(small);
eq(si.countFor(['A', 'B']), 3, "A+B → ABBA, BABA, BACIO");
eq(si.countFor(['B']), 3, "B → 3");
eq(si.countFor(['A', 'M']), 1, "A+M → AMORE");
eq(si.countFor(['Z']), 0, "Z → 0 (non indicizzata)");
eq(si.countSequence('FICI'), 1, "countSequence FICI → EDIFICIO (1)");
eq(si.countSequence('FIC'), 2, "countSequence FIC → EDIFICIO, FICCANASO (2)");
eq(si.countSequence('ZZZ'), 0, "countSequence ZZZ → 0");
ok(FAKE_IDX.countFor(['A']) > 1000, 'index finto: A presente in molte parole');
ok(FAKE_IDX.countFor(['A', 'B']) > 100, 'index finto: A+B ok');
ok(FAKE_IDX.countFor(['A', 'B', 'C', 'E', 'O', 'R']) > 10, 'index finto: combo 6 lettere ok');
ok(FAKE_IDX.countSequence('AB') > 50, 'index finto: sequenza AB ok');

/* ---------- pickLetters ---------- */
console.log('\n[3] pickLetters (determinismo + risolvibilità: classic e sequenza)');
const L = ['A', 'B', 'C', 'E', 'O', 'R'];
for (const n of [2, 3, 4]) {
  const r1 = C.pickLetters('SEEDX', 1, n, FAKE_IDX, 'classic');
  const r2 = C.pickLetters('SEEDX', 1, n, FAKE_IDX, 'classic');
  eq(r1, r2, `classic n=${n}: deterministico`);
  ok(r1.length >= 2 && r1.length <= n, `classic n=${n}: lunghezza valida (${r1.join('')})`);
  ok(new Set(r1).size === r1.length, `classic n=${n}: lettere distinte`);
  ok(r1.every(l => L.includes(l)), `classic n=${n}: lettere dal pool`);
  ok(FAKE_IDX.countFor(r1) >= 1, `classic n=${n}: combo risolvibile`);

  const s1 = C.pickLetters('SEEDX', 1, n, FAKE_IDX, 'sequenza');
  const s2 = C.pickLetters('SEEDX', 1, n, FAKE_IDX, 'sequenza');
  eq(s1, s2, `sequenza n=${n}: deterministico`);
  eq(s1.length, n, `sequenza n=${n}: lunghezza esatta (${s1.join('')})`);
  ok(FAKE_IDX.countSequence(s1.join('')) >= 1, `sequenza n=${n}: sequenza risolvibile`);
}

/* ---------- ruleFor (classic, sequenza, mix) ---------- */
console.log('\n[3b] ruleFor (3 modalità)');
eq(C.ruleFor('classic', 1, 'SEED1'), 'classic', 'ruleFor classic → classic');
eq(C.ruleFor('sequenza', 1, 'SEED1'), 'sequenza', 'ruleFor sequenza → sequenza');
const mixR1_c1 = C.ruleFor('mix', 1, 'SEED_TEST');
const mixR1_c2 = C.ruleFor('mix', 1, 'SEED_TEST');
eq(mixR1_c1, mixR1_c2, 'mix: deterministico tra due client sullo stesso round');
ok(mixR1_c1 === 'classic' || mixR1_c1 === 'sequenza', 'mix r1 valore valido');
const mixState = { opzioni: { mode: 'mix', seed: 'SEED_TEST' }, round: 1 };
eq(C.ruleFor(mixState), mixR1_c1, 'ruleFor supporta oggetto state');

/* ---------- validateWord ---------- */
console.log('\n[4] validateWord (staccate vs consecutive)');
const letters = ['A', 'B', 'C'];
const wValida = FAKE_WORDS.find(w => letters.every(l => w.includes(l)));
eq(C.validateWord(wValida, letters, new Set(), FAKE_SET, 'classic').ok, true, 'classic: parola valida (' + wValida + ')');
eq(C.validateWord('CADE', letters, new Set(), FAKE_SET, 'classic').err, 'MISSING', 'classic: manca B');
eq(C.validateWord('ABC', letters, new Set(), FAKE_SET, 'classic').err, 'SHORT', 'classic: troppo corta');
eq(C.validateWord('ABCADE', letters, new Set(['ABCADE']), FAKE_SET, 'classic').err, 'USED', 'classic: già usata');
eq(C.validateWord('ABCADE', letters, new Set(), new Set(['ZZZZ']), 'classic').err, 'NOT_FOUND', 'classic: non in dizionario');
eq(C.validateWord('', letters, new Set(), FAKE_SET, 'classic').err, 'EMPTY', 'classic: vuota');

// Modalità sequenza
const realDictSet = new Set(['EDIFICIO', 'FICCANASO', 'FICO', 'MALEVOLE']);
eq(C.validateWord('EDIFICIO', ['F', 'I', 'C', 'I'], new Set(), realDictSet, 'sequenza').ok, true, 'sequenza: FICI in EDIFICIO ✅');
eq(C.validateWord('FICCANASO', ['F', 'I', 'C', 'I'], new Set(), realDictSet, 'sequenza').err, 'NOT_SEQUENCE', 'sequenza: FICI non in FICCANASO ❌');
eq(C.validateWord('FICO', ['F', 'I', 'C', 'I'], new Set(), realDictSet, 'sequenza').err, 'NOT_SEQUENCE', 'sequenza: FICI non in FICO ❌');
eq(C.validateWord('MALEVOLE', ['M', 'V', 'E'], new Set(), realDictSet, 'classic').ok, true, 'classic: M V E in MALEVOLE (staccate) ✅');
eq(C.validateWord('MALEVOLE', ['M', 'V', 'E'], new Set(), realDictSet, 'sequenza').err, 'NOT_SEQUENCE', 'sequenza: MVE non consecutivo in MALEVOLE ❌');

/* ---------- highlightWord ---------- */
console.log('\n[4b] highlightWord (classic vs sequenza)');
eq(C.highlightWord('EDIFICIO', ['F', 'I', 'C', 'I'], 'sequenza'), 'EDI<mark>FICI</mark>O', 'highlight sequenza: blocco consecutivo');
eq(C.highlightWord('MALEVOLE', ['M', 'V', 'E'], 'classic'), '<mark>M</mark>AL<mark>EV</mark>OLE', 'highlight classic: lettere staccate');

/* ---------- applyPartial ---------- */
console.log('\n[5] applyPartial');
{
  const o = { a: { b: 1 }, arr: [1] };
  C.applyPartial(o, { 'a.b': 2, 'arr': { __op: 'union', items: [1, 2] }, 'a.b': { __op: 'delete' } });
  eq(o.a, {}, 'dot-path + delete');
  eq(o.arr, [1, 2], 'union con dedup');
}
{
  const o = {};
  C.applyPartial(o, { 'x.y.z': 5 });
  eq(o, { x: { y: { z: 5 } } }, 'crea path nested');
}

/* ---------- simulazione stato completo (3 giocatori, 2 round) ---------- */
console.log('\n[6] Simulazione multi-giocatore completa');
let now = 1_000_000_000_000;
const mkState = () => C.normState({
  partecipanti: ['ALFA', 'BETA', 'GAMMA'],
  opzioni: { tempo: '60', turni: '2', lettere: '3', seed: 'TEST' },
  punteggi: {}, pronti: [], stato: 'attesa'
});
let s = mkState();
const ctx = (me, extra) => Object.assign({ me, now, letters: C.pickLetters('TEST', s.round || 1, 3, FAKE_IDX, C.ruleFor(s)), used: C.usedWords(s), dict: FAKE_SET }, extra || {});
const run = (me, mut, extra) => {
  const up = mut(s, ctx(me, extra));
  if (up && !up.__error) C.applyPartial(s, up);
  return up;
};

// ready + start
run('ALFA', C.mutReady); run('BETA', C.mutReady); run('GAMMA', C.mutReady);
eq(s.stato, 'attesa', 'ancora in attesa');
const st = run('ALFA', C.mutStart);
ok(st && st.stato === 'in_corso' || s.stato === 'in_corso', 'start: in_corso');
eq(s.round, 1, 'start: round 1');
eq(s.turno.giocatore, 'ALFA', 'start: tocca ad ALFA (1°)');
eq(s.turno.deadline, now + 60000, 'start: deadline +60s');
eq(s.punteggi, { ALFA: 0, BETA: 0, GAMMA: 0 }, 'start: punteggi a zero');

// parola valida per ALFA
const let1 = C.pickLetters('TEST', 1, 3, FAKE_IDX, 'classic');
const findWord = (let_, exclude) => FAKE_WORDS.find(w => let_.every(l => w.includes(l)) && !(exclude || []).includes(w));
const w1 = findWord(let1);
ok(!!w1, 'trovata parola valida per combo ' + let1.join(''));
const dBefore = s.turno.deadline;
now += 1000;
const sub1 = run('ALFA', C.mutSubmitWord, { word: w1 });
ok(sub1 && !sub1.__error, 'submit ALFA ok');
eq(s.turno.giocatore, 'BETA', 'patata passa a BETA');
eq(s.turno.deadline, dBefore + C.TIME_BONUS, 'deadline +5s (max(deadline,now)+5000)');
eq(s.punteggi.ALFA, C.pointsFor(w1.length), 'punti ad ALFA');
eq(s.storia.length, 1, 'storia: 1 parola');
eq(s.roundData.parlate.ALFA, [{ w: w1, p: C.pointsFor(w1.length) }], 'parlate ALFA');

// non è il turno di ALFA
const sub2 = run('ALFA', C.mutSubmitWord, { word: findWord(let1, [w1]) });
eq(sub2 && sub2.__error && sub2.__error.code, 'NOT_YOUR_TURN', 'submit fuori turno rifiutato');

// parola sbagliata di BETA (non toglie tempo!)
const dBefore2 = s.turno.deadline;
now += 1000;
const wrong = run('BETA', C.mutWrongWord, { word: 'ZQXCV' });
ok(wrong && !wrong.__error, 'wrong word accettata come evento');
eq(s.turno.deadline, dBefore2, 'deadline invariata per parola sbagliata (nessuna penalità)');
eq(s.turno.ultimo.ok, false, 'ultimo: ok=false');
eq(s.turno.giocatore, 'BETA', 'il turno resta a BETA');

// cooldown (stesso giocatore, <1s)
const wrong2 = run('BETA', C.mutWrongWord, { word: 'ZQXCV' });
eq(wrong2, null, 'cooldown: secondo tentativo <1s ignorato');

// timeout → scottatura
now = s.turno.deadline + C.TIMEOUT_GRACE + 100;
const to = run('BETA', C.mutTimeout);
ok(to && !to.__error, 'timeout: scattata');
eq(s.roundData.fase, 'recap', 'fase recap');
eq(s.roundData.patata, 'BETA', 'BETA ha la patata');
eq(s.punteggi.BETA, -C.PATATA_PENALTY, 'BETA −10');
eq(s.patate.BETA, 1, 'patate BETA = 1');

// recap: ALFA ha una parola, flag da GAMMA → soglia ceil((3-1)/2)=1 → risolta
eq(C.flagThreshold(s), 1, 'soglia flag per 3 giocatori = 1');
const fl = run('GAMMA', C.mutFlag, { word: w1 });
ok(fl && !fl.__error, 'flag inviato');
eq(C.flagResolved(s, w1), true, 'flag risolto (soglia raggiunta)');
const pA = s.punteggi.ALFA;
const res = run('GAMMA', C.mutResolveFlag, { word: w1 });
ok(res && !res.__error, 'resolve flag ok');
eq(s.roundData.parlate.ALFA, [], 'parola rimossa da parlate');
eq(s.punteggi.ALFA, pA - C.pointsFor(w1.length), 'punti rimossi ad ALFA');
eq(s.roundData.rimosse, [w1], 'rimosse registra la parola');
ok(!s.roundData.flags[w1], 'flag cancellato');

// conferme → round 2
run('ALFA', C.mutConferma); run('BETA', C.mutConferma); run('GAMMA', C.mutConferma);
const nr = run('GAMMA', C.mutNextRound);
ok(nr && !nr.__error, 'next round ok');
eq(s.round, 2, 'round 2');
eq(s.turno.giocatore, 'BETA', 'round 2: parte BETA (rotazione)');
eq(s.roundData.patata, null, 'patata resettata');
eq(s.confermaTurno, [], 'conferme resettate');

// round 2: BETA gioca, GAMMA gioca, poi timeout con GAMMA→ALFA...
const let2 = C.pickLetters('TEST', 2, 3, FAKE_IDX, C.ruleFor(s));
const w2 = findWord(let2, [w1]);
now += 500;
run('BETA', C.mutSubmitWord, { word: w2 });
eq(s.turno.giocatore, 'GAMMA', 'round2: patata a GAMMA');
now += 500;
const w3 = findWord(let2, [w2]);
run('GAMMA', C.mutSubmitWord, { word: w3 });
eq(s.turno.giocatore, 'ALFA', 'round2: patata ad ALFA');
now = s.turno.deadline + C.TIMEOUT_GRACE + 50;
run('ALFA', C.mutTimeout);
eq(s.roundData.patata, 'ALFA', 'round2: ALFA scottato');
run('ALFA', C.mutConferma); run('BETA', C.mutConferma); run('GAMMA', C.mutConferma);
const fin = run('ALFA', C.mutNextRound);
eq(fin && fin.stato, 'conclusa', 'partita conclusa (2/2 round)');
eq(s.stato, 'conclusa', 'stato conclusa applicato');

/* classifica finale */
const ranking = s.partecipanti
  .map(p => ({ p, pts: s.punteggi[p] || 0 }))
  .sort((a, b) => b.pts - a.pts);
console.log('   classifica:', ranking.map(r => r.p + '=' + r.pts).join(', '));

/* ---------- SoloBackend con clock controllato ---------- */
console.log('\n[7] SoloBackend (allenamento)');
{
  let t = 2_000_000_000_000;
  const be = new C.SoloBackend('TU', { tempo: 30, turni: 2, lettere: 2, mode: 'classic', seed: 'SOLO1' }, { clock: () => t });
  let last = null;
  be.subscribe(st => { last = st; });
  eq(last.stato, 'attesa', 'solo: iniziale attesa');
  be.applyAtomic(C.mutStart);
  eq(last.stato, 'in_corso', 'solo: start');
  eq(last.round, 1, 'solo: round 1');
  // parola valida
  const lt = C.pickLetters('SOLO1', 1, 2, FAKE_IDX, 'classic');
  const w = FAKE_WORDS.find(x => lt.every(l => x.includes(l)));
  t += 2000;
  be.applyAtomic(st => C.mutSubmitWord(st, { me: 'TU', now: t, letters: lt, used: C.usedWords(st), dict: FAKE_SET, word: w, rule: 'classic' }));
  eq(last.punteggi.TU, C.pointsFor(w.length), 'solo: punti');
  // timeout
  t = last.turno.deadline + C.TIMEOUT_GRACE + 10;
  be.applyAtomic(C.mutTimeout);
  eq(last.roundData.fase, 'recap', 'solo: recap');
  eq(last.roundData.patata, 'TU', 'solo: patata a TU');
  be.applyAtomic(C.mutConferma);
  be.applyAtomic(C.mutNextRound);
  eq(last.round, 2, 'solo: round 2');
  t = last.turno.deadline + C.TIMEOUT_GRACE + 10;
  be.applyAtomic(C.mutTimeout);
  be.applyAtomic(C.mutConferma);
  be.applyAtomic(C.mutNextRound);
  eq(last.stato, 'conclusa', 'solo: conclusa a fine turni');
}

/* ---------- dizionario REALE: performance pickLetters ---------- */
console.log('\n[8] Dizionario reale (dizionario.txt Ruzzle)');
{
  const raw = fs.readFileSync(path.join(__dirname, '../../dizionario.txt'), 'utf8');
  const set = new Set();
  raw.split('\n').forEach(w => {
    const c = C.normalizeWord(w);
    if (c.length >= C.MIN_WORD_LENGTH) set.add(c);
  });
  console.log('   parole reali:', set.size);
  const t0 = Date.now();
  const idx = new C.LetterIndex(Array.from(set));
  const buildMs = Date.now() - t0;
  console.log('   build index:', buildMs + 'ms');
  ok(buildMs < 3000, 'build index < 3s');

  let minAvail = Infinity, maxMs = 0;
  for (const seed of ['AAA', 'MELA', 'K7X']) {
    for (let round = 1; round <= 4; round++) {
      for (const n of [2, 3, 4]) {
        for (const mode of ['classic', 'sequenza']) {
          const t1 = Date.now();
          const letters = C.pickLetters(seed, round, n, idx, mode);
          const ms = Date.now() - t1;
          maxMs = Math.max(maxMs, ms);
          const avail = mode === 'sequenza' ? idx.countSequence(letters.join('')) : idx.countFor(letters);
          minAvail = Math.min(minAvail, avail);
          if (avail < C.LETTER_THRESHOLD) {
            console.log(`   ⚠ mode=${mode} seed=${seed} r=${round} n=${n} → ${letters.join('')} solo ${avail} parole`);
          }
        }
      }
    }
  }
  console.log('   pickLetters: max', maxMs + 'ms, min disponibilità', minAvail);
  ok(maxMs < 2500, 'pickLetters veloce (<2.5s peggior caso)');
  ok(minAvail >= 1, 'nessuna combo impossibile');
}

console.log('\n=================');
console.log(`PASSATI: ${passed}  FALLITI: ${failed}`);
process.exit(failed ? 1 : 0);
