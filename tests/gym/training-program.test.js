'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('games/palestra/training-program.js', 'utf8');
let id = 0;
let week = null;
const context = {
  D: { days: [], hist: [], sessionFeedback: [], st: {} },
  uid: () => `test-${++id}`,
  getWeightStep: () => 2.5,
  fEx: (uid) => context.D.days.flatMap((day) => day.exs).find((ex) => ex.uid === uid),
  save: () => Promise.resolve(true),
  toast: () => {},
  confirm: () => true,
  renderAll: () => {},
  renderHomePremium: () => {},
  getProgramWeek: () => week,
  isDeloadWeek: (value) => Boolean(value && value % 4 === 0),
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

console.log('Tutti i test del programma personale sono passati.');
