'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('games/palestra/training-program.js', 'utf8');
let id = 0;
let week = null;
let saveCalls = 0;
const context = {
  D: { days: [], hist: [], sessionFeedback: [], st: {} },
  uid: () => `test-${++id}`,
  getWeightStep: () => 2.5,
  fEx: (uid) => context.D.days.flatMap((day) => day.exs).find((ex) => ex.uid === uid),
  save: () => {
    saveCalls++;
    return Promise.resolve(true);
  },
  toast: () => {},
  confirm: () => true,
  renderAll: () => {},
  renderHomePremium: () => {},
  getProgramWeek: () => week,
  formatGymNumber: (value) => String(Number(value)),
  document: { getElementById: () => null },
  Date,
  Intl,
  Math,
  Number,
  String,
  Boolean,
  Object,
  Array,
  Map,
  Set,
  JSON,
  console,
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'training-program.js' });
const evaluate = (expression) => vm.runInContext(expression, context);
const plain = (value) => JSON.parse(JSON.stringify(value));
const log = (message) => console.log(`✔ ${message}`);

const days = plain(evaluate('createPersonalTrainingProgram()'));
assert.deepEqual(days.map((day) => day.name), ['Push Final', 'Pull Final', 'Gambe Final', 'Upper Final']);
assert.equal(days.length, 4);
assert(days.every((day) => day.personalProgramVersion === 'personal-program-2026-10'));
log('il programma personale crea le 4 giornate nell’ordine richiesto');

const push = days[0];
const incline = push.exs.find((ex) => ex.exerciseId === 'Panca_Inclinata_Con_Manubri_(Presa_Neutra)');
assert.equal(incline.sd.length, 4);
assert.equal(incline.sd[0].w, 26);
assert.deepEqual(plain(incline.progression.range), [6, 8]);
assert.equal(incline.progression.stepKg, 2);
assert.equal(incline.safetyJoint, 'elbow');
const ramps = plain(evaluate(`getRampUpForLoad(${JSON.stringify(incline)}, 28)`));
assert.deepEqual(ramps.map((set) => set.r), [6, 3, 2]);
assert(Math.abs(ramps[0].w - 14) < 0.001);
assert(Math.abs(ramps[1].w - (20 * 28 / 26)) < 0.01);
assert.deepEqual(ramps.map((set) => set.rest), [30, 45, 60]);
log('range, incrementi, flag articolari e ramp-up si aggiornano proporzionalmente');

const upper = days[3];
const antagonist = upper.exs.filter((ex) => ex.ssG === 'upper-antagonist');
assert.equal(antagonist.length, 2);
assert.equal(antagonist[0].rest, 0);
assert.equal(antagonist[1].rest, 90);
log('la superserie Upper è antagonista, senza pausa A→B e con 90s dopo B');

const allDays = days;
const volume = plain(evaluate(`getWeeklyVolumeAdvice(${JSON.stringify(allDays)})`));
assert.equal(volume.find((item) => item.group === 'Core').sets, 10);
assert.equal(volume.find((item) => item.group === 'Core').limit, 8);
assert.equal(volume.find((item) => item.group === 'Spalle').sets, 14);
assert.equal(volume.find((item) => item.group === 'Spalle').atLimit, true);
log('il controllo volume individua Core oltre e Spalle esattamente al tetto');

context.D = { days, hist: [], sessionFeedback: [], st: {} };
week = 1;
const pushDayId = days[0].id;
const sessionRows = (reps, sessionId, date, complete = true, isDeload = false) => ({
  sessionId,
  exerciseUid: incline.uid,
  eid: incline.exerciseId,
  dayId: pushDayId,
  dt: date,
  sd: reps.map((r) => ({ r, w: 26 })),
  exerciseComplete: complete,
  isDeload,
  isInactivityAdjusted: false,
  w: 26,
});
context.D.hist = [
  sessionRows([8, 8, 8, 8], 'clean-1', '2026-09-01T10:00:00.000Z'),
  sessionRows([8, 8, 8, 8], 'clean-2', '2026-09-08T10:00:00.000Z'),
];
context.D.sessionFeedback = [
  { sessionId: 'clean-1', elbow: 'none', saved: true },
  { sessionId: 'clean-2', elbow: 'none', saved: true },
];
const status = plain(evaluate(`getProgressionStatus(D.days[0].exs.find((ex) => ex.exerciseId === 'Panca_Inclinata_Con_Manubri_(Presa_Neutra)'), '${pushDayId}')`));
assert.equal(status.ready, true);
assert.equal(status.targetLoad, 28);
evaluate(`applyPersonalProgressions(D.days[0])`);
assert(context.D.days[0].exs.find((ex) => ex.exerciseId === incline.exerciseId).sd.every((set) => set.w === 28 && set.r === 6));
log('doppia progressione consentita solo al top range dopo 2 sessioni articolari pulite');

context.D.days[0].exs.find((ex) => ex.exerciseId === incline.exerciseId).sd.forEach((set) => { set.w = 26; set.r = 6; });
context.D.hist = [sessionRows([8, 8, 8, 8], 'clean-1', '2026-09-01T10:00:00.000Z'), sessionRows([8, 8, 8, 8], 'pain-2', '2026-09-08T10:00:00.000Z')];
context.D.sessionFeedback = [{ sessionId: 'clean-1', elbow: 'none' }, { sessionId: 'pain-2', elbow: 'mild' }];
const blocked = plain(evaluate(`getProgressionStatus(D.days[0].exs.find((ex) => ex.exerciseId === 'Panca_Inclinata_Con_Manubri_(Presa_Neutra)'), '${pushDayId}')`));
assert.equal(blocked.ready, false);
assert.match(blocked.text, /2 sessioni consecutive/);
log('il fastidio blocca l’aumento di carico per gli esercizi marcati');

context.D.hist = [];
week = 4;
context.D.st.cycleSessions = 12; // sessione 13 -> deload, settimana 4 irrilevante
const workBefore = context.D.days[0].exs.find((ex) => ex.exerciseId === incline.exerciseId);
const deload = plain(evaluate(`preparePersonalSession(D.days[0], Date.UTC(2026, 8, 20))`));
context.D.activeSession = deload;
const workDuring = context.D.days[0].exs.find((ex) => ex.exerciseId === incline.exerciseId);
assert.equal(deload.isDeload, true);
assert.equal(workDuring.sd.length, 3);
assert.equal(workDuring.sd[0].w, 15.6);
assert.equal(workDuring.sd[0].r, 6);
evaluate(`restorePersonalSessionPlan(D.days[0], D.activeSession)`);
assert.equal(context.D.days[0].exs.find((ex) => ex.exerciseId === incline.exerciseId).sd.length, 4);
assert.equal(context.D.days[0].exs.find((ex) => ex.exerciseId === incline.exerciseId).sd[0].w, 26);
context.D.hist = [sessionRows([8, 8, 8, 8], 'pre-deload', '2026-09-19T10:00:00.000Z')];
context.D.hist[0].w = 30;
context.D.hist[0].sd = [8, 8, 8, 8].map((r) => ({ r, w: 30 }));
context.D.activeSession = evaluate(`preparePersonalSession(D.days[0], Date.UTC(2026, 8, 20))`);
assert.equal(context.D.days[0].exs.find((ex) => ex.exerciseId === incline.exerciseId).sd[0].w, 18);
evaluate(`restorePersonalSessionPlan(D.days[0], D.activeSession)`);
assert.equal(context.D.days[0].exs.find((ex) => ex.exerciseId === incline.exerciseId).sd[0].w, 26);
log('il deload riduce temporaneamente peso del 40% rispetto all’ultima sessione, una serie in meno e base invariata');

week = 1;
context.D.st.cycleSessions = 0; // fuori deload: i drop set tornano disponibili
context.D.sessionFeedback = [];
const lateral = context.D.days[0].exs.find((ex) => ex.exerciseId === 'Alzate_Laterali_ai_Cavi');
lateral.sd.forEach((set) => { set.done = true; set.w = 8; });
context.D.activeSession = { dayId: pushDayId, reportedPain: {}, isDeload: false };
assert.equal(evaluate(`addPersonalDropSetIfDue(D.days[0].exs.find((ex) => ex.exerciseId === 'Alzate_Laterali_ai_Cavi'), { w: 8, done: true }, '${pushDayId}')`), true);
assert.equal(lateral.sd.at(-1).isDropSet, true);
assert.equal(lateral.sd.at(-1).w, 4.8);
assert.equal(lateral.sd.at(-1).r, 8);
log('il drop set finale delle alzate laterali scala il carico del 40%');

const existing = { id: 'existing', name: 'Scheda esistente', exs: [] };
context.D = { days: [existing], hist: [], sessionFeedback: [], st: {} };
evaluate('installPersonalTrainingProgram()');
assert.equal(context.D.days.length, 5);
assert.equal(context.D.days[0].id, 'existing');
assert.equal(context.D.st.personalProgramVersion, 'personal-program-2026-10');
assert.match(context.D.st.personalProgramStart, /^\d{4}-\d{2}-\d{2}$/);
const installedDays = plain(evaluate('getPersonalDayList()'));
evaluate(`advancePersonalDay('${installedDays[1].id}')`);
assert.equal(context.D.st.nextPersonalDayIndex, 2);
assert.ok(evaluate('getPersonalRestStatus()'));
assert.equal(evaluate(`getPersonalRestStatus(Date.now() + 2 * 86400000)`), null);
evaluate(`advancePersonalDay('${installedDays[2].id}')`);
assert.equal(context.D.st.nextPersonalDayIndex, 3);
assert.equal(context.D.st.personalRestAfterPull, undefined);
log('installazione non distruttiva conserva giornate esistenti, avvia il ciclo e applica il riposo Pull → Gambe');

// ════════════════════════════════════════════════════════════════════════
// SEZIONE 11 — CICLO A SESSIONI ROTANTI: verifica dei 7 requisiti
// ════════════════════════════════════════════════════════════════════════
const ROTATION = ['Push Final', 'Pull Final', 'Gambe Final', 'Upper Final'];
const freshProgram = () => {
  context.D = {
    days: plain(evaluate('createPersonalTrainingProgram()')),
    hist: [],
    sessionFeedback: [],
    st: { personalProgramVersion: 'personal-program-2026-10', cycleSessions: 0 },
  };
  week = null;
};

// ── Requisito 1 — contatore sessioni globale ──────────────────────────────
freshProgram();
assert.equal(plain(evaluate('getPersonalCycleState()')).completedSessions, 0, 'parte da zero sessioni completate');
assert.equal(evaluate('getPersonalSessionNumber()'), 1, 'la prima sessione è la numero 1');
for (let i = 0; i < 13; i++) evaluate('recordCompletedCycleSession()');
assert.equal(context.D.st.cycleSessions, 13, '+1 a ogni sessione completata, senza limiti settimanali');
assert.equal(evaluate('getPersonalSessionNumber()'), 14, 'la sessione corrente è la successiva');
week = 40;
assert.equal(context.D.st.cycleSessions, 13, 'il calendario non sposta il contatore');
context.D.st.cycleSessions = 3;
assert.equal(evaluate('getCompletedCycleSessions()'), 3, 'il valore vive in D.st e viene persistito con save()');
assert.equal(saveCalls > 0, true, 'save() è stato invocato durante il ciclo di test');
log('req.1 contatore progressivo in D.st.cycleSessions, non legato a settimane o mesi');

// ── Requisito 2 — scheda assegnata da (numero_sessione - 1) % 4 ──────────
freshProgram();
for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 12, 13, 100]) {
  const state = plain(evaluate(`getCycleStateForSessionNumber(${n})`));
  assert.equal(state.dayIndex, (n - 1) % 4, `resto atteso per la sessione ${n}`);
  assert.equal(state.dayName, ROTATION[(n - 1) % 4], `scheda attesa per la sessione ${n}`);
}
assert.equal(plain(evaluate('getCycleStateForSessionNumber(12)')).dayName, 'Upper Final', 'S12 = Upper');
assert.equal(plain(evaluate('getCycleStateForSessionNumber(13)')).dayName, 'Push Final', 'S13 = Push');
assert.equal(plain(evaluate('getCycleStateForSessionNumber(17)')).dayName, 'Push Final', 'S17 = Push');
log('req.2 rotazione Push→Pull→Gambe→Upper calcolata sul numero di sessione per qualsiasi n');

// ── Requisito 3 — deload dopo 12 sessioni normali, 4 in scarico ──────────
const deloadFlags = [];
for (let n = 1; n <= 48; n++) deloadFlags.push(Boolean(evaluate(`isDeloadSessionNumber(${n})`)));
const expectedFlags = [];
for (let n = 1; n <= 48; n++) expectedFlags.push((n - 1) % 16 >= 12);
assert.deepEqual(deloadFlags, expectedFlags, 'pattern .x12 D x4 per 3 cicli');
assert.deepEqual([13, 14, 15, 16, 29, 30, 31, 32, 45, 46, 47, 48].map((n) => deloadFlags[n - 1]), Array(12).fill(true));
assert.deepEqual([12, 17, 28, 33, 44].map((n) => deloadFlags[n - 1]), Array(5).fill(false));
freshProgram();
context.D.st.cycleSessions = 12;
week = 1; // settimana "normale": il deload deve scattare lo stesso
assert.equal(plain(evaluate('getPersonalCycleState()')).isDeload, true, 'trigger a sessioni, non a settimane');
freshProgram();
context.D.st.cycleSessions = 3;
week = 4; // vecchia settimana di deload: ora non deve contare nulla
assert.equal(plain(evaluate('getPersonalCycleState()')).isDeload, false, 'la settimana 4 non forza più il deload');
log('req.3 deload su (n-1)%16>=12 e nessuna dipendenza dalle date di calendario');

// ── Requisito 4 — modalità deload applicata automaticamente ───────────────
freshProgram();
context.D.st.cycleSessions = 12;
const pushDay = context.D.days[0];
const primary = pushDay.exs.find((ex) => ex.exerciseId === 'Panca_Inclinata_Con_Manubri_(Presa_Neutra)');
const repsBefore = primary.sd.map((set) => set.r);
const restBefore = primary.sd.map((set) => set.rest);
const pristineDay = plain(pushDay);
context.D.hist = [{
  sessionId: 'pre-deload',
  exerciseUid: primary.uid,
  eid: primary.exerciseId,
  dayId: pushDay.id,
  dt: '2026-10-10T12:00:00.000Z',
  w: 30,
  sd: [8, 8, 8, 8].map((r) => ({ r, w: 30 })),
  exerciseComplete: true,
  isDeload: false,
}];
const deloadPlan = plain(evaluate('preparePersonalSession(D.days[0], Date.UTC(2026, 9, 12, 12))'));
context.D.activeSession = deloadPlan;
const during = context.D.days[0].exs.find((ex) => ex.exerciseId === 'Panca_Inclinata_Con_Manubri_(Presa_Neutra)');
assert.equal(deloadPlan.isDeload, true);
assert.equal(deloadPlan.sessionNumber, 13, 'la sessione in corso è la 13ª');
assert.equal(during.sd.length, 3, '-1 serie su ogni esercizio');
assert.deepEqual(during.sd.map((set) => set.w), [18, 18, 18], '-40% sull’ultima sessione normale (30 kg)');
assert.deepEqual(during.sd.map((set) => set.r), repsBefore.slice(0, 3), 'ripetizioni invariate');
assert.deepEqual(during.sd.map((set) => set.rest), restBefore.slice(0, 3), 'recuperi invariati');
assert.equal(during.sd.some((set) => set.isDropSet), false, 'nessun drop set in deload');
assert.equal(plain(evaluate('canUseDropSet(D.days[0].id)')).allowed, false, 'i drop set sono bloccati in deload');
assert.deepEqual(plain(evaluate('applyPersonalProgressions(D.days[0])')), [], 'nessuna progressione di carico in deload');
const rampArg = JSON.stringify(during);
const rampsDeload = plain(evaluate(`getRampUpForLoad(${rampArg}, 18)`));
const rampsNormal = plain(evaluate(`getRampUpForLoad(${rampArg}, 26)`));
assert.equal(rampsDeload.length, rampsNormal.length, 'ramp-up invariato nel numero di serie');
assert.deepEqual(rampsDeload.map((set) => set.r), rampsNormal.map((set) => set.r), 'ripetizioni del ramp-up invariate');
assert.deepEqual(rampsDeload.map((set) => set.rest), rampsNormal.map((set) => set.rest), 'recuperi del ramp-up invariati');
assert.equal(rampsDeload.every((set, i) => Math.abs(set.w - rampsNormal[i].w * (18 / 26)) < 0.01), true, 'percentuali del ramp-up ricalcolate sul carico deload');
const deloadPolicy = plain(evaluate('getProgramPolicyMessages(D.days[0])'));
assert.equal(deloadPolicy.some((m) => m.includes('Sessione 13') && /DELOAD/.test(m)), true, 'avviso di deload visibile prima di iniziare');
assert.equal(deloadPolicy.some((m) => m.includes('−40%') && m.includes('drop set')), true, 'regole del deload elencate');
// ── Requisito 5 — contenuto della scheda intatto dopo restore ─────────────
evaluate('restorePersonalSessionPlan(D.days[0], D.activeSession)');
assert.deepEqual(plain(context.D.days[0]), pristineDay, 'esercizi, ordine, note, superserie e ramp-up identici all’import');
log('req.4+5 deload automatico (carico, serie, drop set) senza toccare la scheda importata');

// ── Requisito 6 — giorni saltati, misurati sull'ultima sessione in assoluto ─
freshProgram();
context.D.hist = [{
  sessionId: 'pull-only',
  dayId: context.D.days[1].id,
  eid: 'altro',
  exerciseUid: 'altro',
  dt: '2026-10-03T12:00:00.000Z',
  sd: [{ r: 8, w: 20 }],
}];
const gapPlan = plain(evaluate('preparePersonalSession(D.days[0], Date.UTC(2026, 9, 10, 12))'));
assert.equal(gapPlan.daysSinceLastSession, 7, 'gap calcolato sull’ultima sessione completata, anche di un altro giorno');
assert.equal(gapPlan.inactivityAdjusted, true);
assert.equal(gapPlan.loadMultiplier, 0.9, '-10% solo per questa sessione');
freshProgram();
context.D.hist = [{
  sessionId: 'recent',
  dayId: context.D.days[1].id,
  dt: '2026-10-07T12:00:00.000Z',
  sd: [{ r: 8, w: 20 }],
}];
assert.equal(plain(evaluate('preparePersonalSession(D.days[0], Date.UTC(2026, 9, 10, 12))')).inactivityAdjusted, false, 'entro 5 giorni nessun aggiustamento');
freshProgram();
context.D.st.cycleSessions = 12;
context.D.st.lwd = '2026-10-03';
const bothPlan = plain(evaluate('preparePersonalSession(D.days[0], Date.UTC(2026, 9, 10, 12))'));
assert.equal(bothPlan.isDeload, true);
assert.equal(bothPlan.inactivityAdjusted, true, 'il -10% si applica anche in deload');
assert.equal(Math.round(bothPlan.loadMultiplier * 100) / 100, 0.54, '-40% e -10% combinati');
assert.equal(plain(evaluate('getProgramPolicyMessages(D.days[0])')).some((m) => m.includes('10%') && m.includes('deload')), true, 'avviso di rientro mostrato anche in deload');
log('req.6 avviso e -10% sull’ultima sessione complessiva, valido in ciclo normale e in deload');

// ── Requisito 7 — stato del ciclo leggibile prima della sessione ──────────
freshProgram();
context.D.st.cycleSessions = 7;
const view = plain(evaluate('getPersonalCycleState()'));
assert.equal(view.sessionNumber, 8, 'numero sessione corrente');
assert.equal(view.dayName, 'Upper Final', 'scheda assegnata');
assert.equal(view.isDeload, false, 'tipo sessione: normale');
assert.equal(view.sessionsToDeload, 5, 'deload tra 5 sessioni');
assert.equal(view.nextDeloadSessionNumber, 13, 'la 13ª sessione apre lo scarico');
const viewMsg = plain(evaluate('getProgramPolicyMessages(D.days[0])'));
assert.equal(viewMsg.some((m) => m.includes('Sessione 8 · Upper Final') && m.includes('deload tra 5 sessioni')), true, 'stato del ciclo nella scheda del giorno');
context.D.st.cycleSessions = 13;
const mid = plain(evaluate('getPersonalCycleState()'));
assert.equal(mid.isDeload, true);
assert.equal(mid.deloadSessionsLeft, 3, 'sessione 2 di 4 di scarico');
assert.equal(mid.lastDeloadSessionNumber, 16, 'lo scarico finisce alla sessione 16');
assert.equal(mid.nextNormalSessionNumber, 17, 'dalla 17 si riparte normali');
// il ciclo continua oltre il confine del calendario: 3 sessioni una settimana, 2 la successiva
let cursor = plain(evaluate('getPersonalCycleState()'));
for (let n = 14; n <= 20; n++) {
  const state = plain(evaluate(`getCycleStateForSessionNumber(${n})`));
  assert.equal(state.dayName, ROTATION[(n - 1) % 4], `sequenza mantenuta alla sessione ${n}`);
  assert.equal(state.isDeload, n <= 16, `deload attivo fino alla 16, non a calendario (${n})`);
}
assert.equal(plain(evaluate('getCycleStateForSessionNumber(17)')).cycleNumber, 2, 'dalla 17 parte il ciclo 2');
assert.equal(cursor.isDeload, true);
log('req.7 sessione, scheda, tipo e countdown al deload sempre esposti, anche a cavallo di settimane diverse');

// il deload blocca anche le aggiunte di volume del milestone (niente +1 serie in scarico)
freshProgram();
context.D.st.cycleSessions = 12;
week = 9; // mese compiuto: senza deload qui le braccia crescerebbero di una serie
assert.deepEqual(plain(evaluate('applyPersonalVolumeMilestone(9)')), [], 'nessuna aggiunta di volume nelle sessioni di deload');
assert.equal(context.D.st.volumeReviewApplied && context.D.st.volumeReviewApplied[9], undefined, 'la revisione resta dovuta e non è marcata come applicata');
const postponed = plain(evaluate('getProgramPolicyMessages(D.days[0])'));
assert.equal(postponed.some((m) => /Revisione volume rimandata/.test(m)), true, 'l’avviso spiega che il milestone scivola alla prossima sessione normale');
context.D.st.cycleSessions = 0; // sessione 1: ciclo normale, il milestone è recuperabile
const applied = plain(evaluate('applyPersonalVolumeMilestone(9)'));
assert.equal(applied.length > 0, true, 'alla prima sessione normale il milestone recuperato si applica');
assert.equal(context.D.st.volumeReviewApplied[9], true);
log('il milestone di volume scivola oltre il deload senza perdere l’appuntamento');

console.log('Tutti i test del programma personale sono passati.');
