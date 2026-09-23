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
eq(C.pointsFor(4), 4, '4 lettere = 4 punti (lunghezza effettiva)');
eq(C.pointsFor(5), 5, '5 lettere = 5 punti');
eq(C.pointsFor(6), 6, '6 lettere = 6 punti');
eq(C.pointsFor(7), 7, '7 lettere = 7 punti');
eq(C.pointsFor(8), 8, '8 lettere = 8 punti');
eq(C.pointsFor(12), 12, '12 lettere = 12 punti');

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
/* MIX = 50% sparso + 50% sequenza, ALTERNANZA garantita round per round */
{
  const regole = [];
  for (let r = 1; r <= 20; r++) regole.push(C.ruleFor('mix', r, 'QUALSIASI_SEED'));
  const nSeq = regole.filter((x) => x === 'sequenza').length;
  const nCla = regole.filter((x) => x === 'classic').length;
  eq(nCla, 10, 'mix su 20 round: 50% in ordine sparso (10 classic)');
  eq(nSeq, 10, 'mix su 20 round: 50% sequenza (10 sequenza)');
  ok(regole.every((x, i) => x === (i % 2 === 0 ? 'classic' : 'sequenza')),
    'mix: alternanza ferma round per round (pari/dispari)');
  ok(C.ruleFor('mix', 3, 'SEED_A') === C.ruleFor('mix', 3, 'SEED_B'),
    'mix indipendente dal seed: stesso risultato su ogni client');
}

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
ok(s.turno.deadline <= now + 60000,
  'tetto: il cronometro non supera il tempo configurato (' +
  ((s.turno.deadline - now) / 1000) + 's su 60s)');
ok(s.turno.deadline >= dBefore, 'il bonus non toglie tempo (deadline mai indietro)');
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

/* ---------- bonus a scalare e tetto del cronometro ---------- */
console.log('\n[6b] Bonus a scalare (5→4→3→2→1) e tetto del cronometro');
{
  const TEMPO = 60;
  const t0 = 3_000_000_000_000;
  const mk = () => {
    const st = C.normState({
      partecipanti: ['ALFA', 'BETA'],
      opzioni: { tempo: String(TEMPO), turni: '2', lettere: '3', seed: 'BONUS' },
      punteggi: {}, pronti: ['ALFA', 'BETA'], stato: 'attesa'
    });
    C.applyPartial(st, C.mutStart(st, { me: 'ALFA', now: t0, dictVersion: 'v' }));
    return st;
  };
  const lettere = (st) => C.pickLetters('BONUS', st.round || 1, 3, FAKE_IDX, C.ruleFor(st));
  const usate = new Set();
  /* gioca una parola valida al tempo `now`, diversa dalle precedenti.
     `usate` viene aggiornato DOPO l'invio: prima di allora la parola non è
     ancora stata giocata (altrimenti il mutatore la rifiuterebbe come USED). */
  const gioca = (st, now, chi) => {
    const let_ = lettere(st);
    const w = FAKE_WORDS.find(x => let_.every(l => x.includes(l)) && !usate.has(x));
    const up = C.mutSubmitWord(st, { me: chi, now: now, letters: let_, used: usate, dict: FAKE_SET, word: w, rule: 'classic' });
    if (up && !up.__error) C.applyPartial(st, up);
    else ok(false, 'la parola di prova non è stata accettata: ' + JSON.stringify(up && (up.__error || up)));
    usate.add(w);
    return w;
  };

  eq(C.bonusPerParola({ turno: { inizio: t0 } }, t0), 5, 'bonus pieno nel primo minuto: +5');
  ok(C.bonusPerParola({ turno: { inizio: t0 } }, t0 + 61000) === 4, 'dopo 1 minuto di turno: +4');
  ok(C.bonusPerParola({ turno: { inizio: t0 } }, t0 + 121000) === 3, 'dopo 2 minuti: +3');
  ok(C.bonusPerParola({ turno: { inizio: t0 } }, t0 + 181000) === 2, 'dopo 3 minuti: +2');
  ok(C.bonusPerParola({ turno: { inizio: t0 } }, t0 + 241000) === 1, 'dopo 4 minuti: +1');
  ok(C.bonusPerParola({ turno: { inizio: t0 } }, t0 + 600000) === 1, 'mai sotto +1, per quanto duri il turno');

  const st = mk();
  eq(C.bonusPerParola(st, t0 + 500), 5, 'il turno nuovo riparte dal bonus pieno');

  /* tetto: partendo dal pieno, una parola non porta oltre il tempo configurato */
  const primaDellaPrima = st.turno.deadline;
  gioca(st, t0 + 1000, 'ALFA');
  ok(st.turno.deadline <= t0 + 1000 + TEMPO * 1000,
    'prima parola: il cronometro non supera i ' + TEMPO + 's (' +
    ((st.turno.deadline - (t0 + 1000)) / 1000) + 's)');
  ok(st.turno.deadline >= primaDellaPrima, 'prima parola: tetto, non taglio del tempo già restante');

  /* tetto con tante parole di fila: la deadline non sfonda mai il massimo */
  let now = t0 + 2000;
  for (let i = 0; i < 6; i++) {
    const chi = st.turno.giocatore;
    now += 500;
    gioca(st, now, chi);
    ok(st.turno.deadline <= now + TEMPO * 1000,
      'parola ' + (i + 2) + ': massimo ' + TEMPO + 's di cronometro');
  }

  /* bonus visibile quando il tempo è sceso sotto il tetto */
  st.turno.deadline = now + 20000;          // restano 20s
  st.turno.inizio = now - 5000;             // il turno dura da 5s → bonus +5
  const chi1 = st.turno.giocatore;
  gioca(st, now, chi1);
  eq(st.turno.deadline, now + 25000, 'tempo basso: il bonus aggiunge davvero i secondi (+5)');

  /* lo stesso turno, dopo i minuti: il bonus è più piccolo */
  st.turno.deadline = now + 20000;
  st.turno.inizio = now - 130000;           // 2 minuti e 10s → bonus +3
  const chi2 = st.turno.giocatore;
  gioca(st, now, chi2);
  eq(st.turno.deadline, now + 23000, 'dopo 2 minuti di turno il bonus vale +3');

  st.turno.deadline = now + 20000;
  st.turno.inizio = now - 1000000;          // turno lunghissimo → bonus +1
  const chi3 = st.turno.giocatore;
  gioca(st, now, chi3);
  eq(st.turno.deadline, now + 21000, 'a turno lunghissimo il bonus vale +1');

  /* il turno successivo riparte dal bonus pieno */
  st.roundData.fase = 'recap';
  st.confermaTurno = ['ALFA', 'BETA'];
  C.applyPartial(st, C.mutNextRound(st, { now: now + 1000 }));
  eq(st.round, 2, 'round 2 avviato');
  eq(C.bonusPerParola(st, now + 1000 + 3000), 5, 'nuovo turno: bonus di nuovo +5');
}

/* ---------- timeout IMMEDIATO, pausa per tutti, richiesta parola ---------- */
console.log('\n[6c] Timeout immediato + pausa + richiesta vocabolario (voto di tutti)');
{
  eq(C.TIMEOUT_GRACE, 0, 'TIMEOUT_GRACE = 0: la chiusura al zero è immediata');
  const t0 = 4_000_000_000_000;
  const mk = () => {
    const st = C.normState({
      partecipanti: ['ALFA', 'BETA', 'GAMMA'],
      opzioni: { tempo: '30', turni: '2', lettere: '3', seed: 'PAUSA' },
      punteggi: {}, pronti: ['ALFA', 'BETA', 'GAMMA'], stato: 'attesa'
    });
    C.applyPartial(st, C.mutStart(st, { me: 'ALFA', now: t0 }));
    return st;
  };
  const ctxOf = (me, now, extra) => Object.assign({
    me, now, letters: ['A', 'B', 'C'], used: new Set(),
    dict: new Set(['CANE', 'BRANCA']), rule: 'classic'   // BRANCA contiene A+B+C
  }, extra || {});

  /* --- timeout: scatta ESATTAMENTE a zero, non dopo 2,5s --- */
  const st1 = mk();
  ok(C.mutTimeout(st1, ctxOf('ALFA', st1.turno.deadline - 1)) === null,
    'un millisecondo PRIMA dello zero: nessuna scottatura');
  const to1 = C.mutTimeout(st1, ctxOf('ALFA', st1.turno.deadline));
  ok(to1 && !to1.__error, 'AL LO ZERO ESATTO la scottatura scatta subito (senza grazia)');
  C.applyPartial(st1, to1);
  eq(st1.roundData.fase, 'recap', 'timeout immediato → recap');

  /* --- pausa per tutti --- */
  const st = mk();
  const deadlinePrima = st.turno.deadline;          // t0 + 30s
  const pauseAt = t0 + 5000;
  const p1 = C.mutPausa(st, ctxOf('BETA', pauseAt));
  ok(p1 && p1.pausa === true, 'mutPausa: mette in pausa per tutti');
  C.applyPartial(st, p1);
  eq(st.pausaDa, 'BETA', 'pausaDa registra chi ha chiuso');
  eq(st.turno.pausaIniziata, pauseAt, 'clock congelato a pauseAt');
  eq(C.mutTimeout(st, ctxOf('ALFA', st.turno.deadline + 999999)), null,
    'durante la pausa NON scatta mai la scottatura');
  const subP = C.mutSubmitWord(st, ctxOf('ALFA', pauseAt + 100, { word: 'CANE' }));
  ok(subP && subP.__error && subP.__error.code === 'PAUSED',
    'durante la pausa non si possono giocare parole (PAUSED)');

  /* ripresa dopo 20s di pausa: il clock riparte da dove si era congelato */
  const resumeAt = pauseAt + 20000;
  const p2 = C.mutPausa(st, ctxOf('BETA', resumeAt));
  ok(p2 && p2.pausa === false, 'seconda chiamata: riprende il gioco');
  C.applyPartial(st, p2);
  eq(st.pausa, false, 'pausa azzerata alla ripresa');
  eq(st.turno.deadline, deadlinePrima + 20000, 'deadline slitta esattamente della durata della pausa');
  eq(st.turno.inizio, t0 + 20000, 'anche inizio slitta: il bonus non conteggia la pausa');
  ok(!st.turno.pausaIniziata, 'pausaIniziata cancellato alla ripresa');
  const subDopo = C.mutSubmitWord(st, ctxOf('ALFA', resumeAt + 100, { word: 'BRANCA' }));
  ok(subDopo && !subDopo.__error, 'alla ripresa si torna a giocare normalmente');

  /* --- richiesta parola + voto di TUTTI (pausa fino a tutti i voti) --- */
  const st3 = mk();
  const reqAt = t0 + 3000;
  const rq = C.mutRichiediParola(st3, ctxOf('ALFA', reqAt, { word: 'BRUCIA' }));
  ok(rq && !rq.__error, 'richiesta parola accettata (al proprio turno, non nel dizionario)');
  C.applyPartial(st3, rq);
  eq(st3.pausa, true, 'la richiesta mette in pausa per tutti');
  eq(st3.richiesta.parola, 'BRUCIA', 'parola normalizzata nella richiesta');
  eq(st3.richiesta.votiSi, ['ALFA'], 'il proponente conta subito come voto SÌ');
  ok(C.mutTimeout(st3, ctxOf('BETA', st3.turno.deadline + 999999)) === null,
    'nessuna scottatura durante la votazione');
  eq(C.mutRisolviRichiesta(st3, ctxOf('ALFA', reqAt + 100)), null,
    'con 1 voto su 3 la votazione NON si chiude');

  const vB = C.mutVotoParola(st3, ctxOf('BETA', reqAt + 200, { votoSi: false }));
  ok(vB && vB['richiesta.votiNo'], 'BETA vota 👎');
  C.applyPartial(st3, vB);
  eq(C.mutRisolviRichiesta(st3, ctxOf('ALFA', reqAt + 300)), null,
    '2 voti su 3: ancora in attesa');
  const vG = C.mutVotoParola(st3, ctxOf('GAMMA', reqAt + 400, { votoSi: false }));
  ok(vG && vG['richiesta.votiNo'], 'GAMMA vota 👎');
  C.applyPartial(st3, vG);
  ok(C.mutVotoParola(st3, ctxOf('GAMMA', reqAt + 500, { votoSi: true })) === null,
    'doppio voto rifiutato');
  const res = C.mutRisolviRichiesta(st3, ctxOf('ALFA', reqAt + 600));
  ok(res && res.ultimaRichiesta, 'tutti hanno votato → risoluzione');
  C.applyPartial(st3, res);
  ok(!st3.richiesta, 'votazione chiusa (richiesta rimossa)');
  eq(st3.pausa, false, 'la pausa finisce con la votazione');
  eq(st3.ultimaRichiesta.esito, 'rifiutata', 'maggioranza 1-2 contro → parola NON inserita');
  eq(st3.turno.deadline, t0 + 30000 + (reqAt + 600 - reqAt),
    'clock ripreso: la pausa di votazione (600ms) è stata aggiunta alla deadline');

  /* esito positivo: maggioranza di sì */
  const st4 = mk();
  C.applyPartial(st4, C.mutRichiediParola(st4, ctxOf('ALFA', t0 + 1000, { word: 'ZEBRA' })));
  C.applyPartial(st4, C.mutVotoParola(st4, ctxOf('BETA', t0 + 1100, { votoSi: true })));
  ok(C.mutRisolviRichiesta(st4, ctxOf('ALFA', t0 + 1150)) === null,
    '2 voti su 3: non si chiude ancora');
  C.applyPartial(st4, C.mutVotoParola(st4, ctxOf('GAMMA', t0 + 1180, { votoSi: true })));
  const resSi = C.mutRisolviRichiesta(st4, ctxOf('ALFA', t0 + 1200));
  ok(resSi && resSi.ultimaRichiesta && resSi.ultimaRichiesta.esito === 'inserita',
    'maggioranza di sì (3-0) → parola inserita');
  C.applyPartial(st4, resSi);
  eq(st4.pausa, false, 'ripresa anche in caso di esito positivo');

  /* ritiro proposta dal proponente */
  const st5 = mk();
  C.applyPartial(st5, C.mutRichiediParola(st5, ctxOf('ALFA', t0 + 500, { word: 'PROVA' })));
  eq(C.mutRitiraRichiesta(st5, ctxOf('BETA', t0 + 600)), null,
    'solo il proponente può ritirare la proposta');
  const rit = C.mutRitiraRichiesta(st5, ctxOf('ALFA', t0 + 600));
  ok(rit && rit.ultimaRichiesta && rit.ultimaRichiesta.esito === 'annullata',
    'proponente ritira → proposta annullata, pausa sciolta');
  C.applyPartial(st5, rit);
  eq(st5.pausa, false, 'dopo il ritiro si riprende a giocare');

  /* non si propone fuori turno / parola già presente */
  const st6 = mk();
  const rqOff = C.mutRichiediParola(st6, ctxOf('BETA', t0 + 500, { word: 'CANE' }));
  ok(rqOff && rqOff.__error && rqOff.__error.code === 'NOT_YOUR_TURN',
    'fuori turno non si può proporre');
  const rqAlready = C.mutRichiediParola(st6, ctxOf('ALFA', t0 + 500, { word: 'CANE' }));
  ok(rqAlready && rqAlready.__error && rqAlready.__error.code === 'ALREADY',
    'parola già nel dizionario: niente votazione');
}

/* ---------- POWER-UP 🚀 "passa la patata" ---------- */
console.log('\n[6d] Power-up 🚀 passa la patata (estrazione + mutatore)');
{
  /* assegnazione deterministica (stessa su ogni client, zero scritture) */
  const stBase = { partecipanti: ['ALFA', 'BETA', 'GAMMA'], opzioni: { seed: 'POWTEST' }, round: 1 };
  const pu1 = C.powerPassFor(stBase);
  const pu2 = C.powerPassFor(JSON.parse(JSON.stringify(stBase)));
  eq(pu1, pu2, 'power-up deterministico: stesso detentore su ogni client');
  ok(['ALFA', 'BETA', 'GAMMA'].indexOf(pu1) !== -1, 'detentore fra i partecipanti (' + pu1 + ')');
  eq(C.powerPassFor({ partecipanti: ['SOL'], opzioni: { seed: 'X' }, round: 1 }), null,
    'in solo non c\'è nessun power-up (nessuno a cui passare)');
  {
    const visti = new Set();
    for (let r = 1; r <= 30; r++) visti.add(C.powerPassFor({ partecipanti: ['A', 'B', 'C'], opzioni: { seed: 'MIXPOW' }, round: r }));
    ok(visti.size > 1, 'sui 30 round il power-up gira fra più giocatori (' + visti.size + ' distinti)');
  }

  /* mutatore */
  const t0 = 5_000_000_000_000;
  const mk = () => {
    const st = C.normState({
      partecipanti: ['ALFA', 'BETA', 'GAMMA'],
      opzioni: { tempo: '30', turni: '2', lettere: '3', seed: 'POWTEST' },
      punteggi: {}, pronti: ['ALFA', 'BETA', 'GAMMA'], stato: 'attesa'
    });
    C.applyPartial(st, C.mutStart(st, { me: 'ALFA', now: t0 }));
    return st;
  };
  const ctxP = (me, extra) => Object.assign({
    me, now: t0 + 1000, letters: ['A', 'B', 'C'], used: new Set(),
    dict: new Set(['BRANCA']), rule: 'classic'
  }, extra || {});

  const st = mk();
  const pu = C.powerPassFor(st);
  const altro = st.partecipanti.find((p) => p !== pu);   // primo non-detentore
  /* porta la patata dal detentore (i test stimano il mutatore, non la rotazione) */
  C.applyPartial(st, { 'turno.giocatore': pu });

  /* bersagli invalidi */
  const self = C.mutPassaPatata(st, ctxP(pu, { target: pu }));
  eq(self && self.__error && self.__error.code, 'BAD_TARGET', 'non puoi passarti la patata addosso');
  const fuoriTurno = C.mutPassaPatata(st, ctxP(altro, { target: pu }));
  eq(fuoriTurno && fuoriTurno.__error && fuoriTurno.__error.code, 'NOT_YOUR_TURN',
    'solo chi ha la patata può usare il power-up');
  /* pausa/voto bloccano il power-up come il resto */
  C.applyPartial(st, { pausa: true, pausaTs: t0 + 900, 'turno.pausaIniziata': t0 + 900 });
  const inPausa = C.mutPassaPatata(st, ctxP(pu, { target: altro, now: t0 + 1200 }));
  eq(inPausa && inPausa.__error && inPausa.__error.code, 'PAUSED', ' durante la pausa il passaggio non si usa');
  C.applyPartial(st, { pausa: false, pausaDa: { __op: 'delete' }, pausaTs: { __op: 'delete' }, 'turno.pausaIniziata': { __op: 'delete' } });

  /* passaggio riuscito */
  const deadlinePrima = st.turno.deadline;
  const pass = C.mutPassaPatata(st, ctxP(pu, { target: altro }));
  ok(pass && !pass.__error, 'passaggio concesso al detentore al proprio turno');
  C.applyPartial(st, pass);
  eq(st.turno.giocatore, altro, 'la patata è arrivata al bersaglio');
  eq(st.roundData.powerPass, { da: pu, target: altro, ts: t0 + 1000 }, 'power-up segnato come usato');
  eq(st.turno.ultimo.pass, true, 'ultimo.pass = true (feedback dedicato, non una parola)');
  eq(st.turno.deadline, deadlinePrima, 'il clock non cambia: né secondi aggiunti né tolti');
  eq(st.storia, [], 'nessuna parola in storia (0 punti, feed parole invariato)');
  eq(st.punteggi, { ALFA: 0, BETA: 0, GAMMA: 0 }, 'nessun punto assegnato');

  /* la rotazione riparte dalla posizione del ricevente */
  const attesoDopo = C.nextPlayer(st, altro);
  C.applyPartial(st, C.mutSubmitWord(st, ctxP(altro, { word: 'BRANCA' })));
  eq(st.turno.giocatore, attesoDopo,
    'dopo il passaggio la rotazione normale prosegue dalla posizione del ricevente (' + attesoDopo + ')');

  /* uno solo per round */
  C.applyPartial(st, { 'turno.giocatore': pu });
  const seconda = C.mutPassaPatata(st, ctxP(pu, { target: st.partecipanti.find((p) => p !== pu && p !== altro) }));
  eq(seconda && seconda.__error && seconda.__error.code, 'USED', 'secondo utilizzo nello stesso round rifiutato');

  /* chi NON ha il power-up non può usarlo */
  const st2 = mk();
  const pu2b = C.powerPassFor(st2);
  const senza = st2.partecipanti.find((p) => p !== pu2b);
  C.applyPartial(st2, { 'turno.giocatore': senza });
  const noPower = C.mutPassaPatata(st2, ctxP(senza, { target: pu2b }));
  eq(noPower && noPower.__error && noPower.__error.code, 'NO_POWER',
    'chi non è il detentore del round non può passare la patata');
}

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
