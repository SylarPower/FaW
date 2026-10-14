// Workout specification and coaching rules for the optional personal program.
// This file contains training data only; it deliberately does not store profile,
// nutrition, account, or demographic information.
const PERSONAL_PROGRAM_VERSION = "personal-program-2026-10";
const PERSONAL_PROGRAM_CONFIG = {
  title: "Push → Pull → Gambe → Upper",
  deloadEveryWeeks: 4,
  deloadLoadMultiplier: 0.6,
  deloadSetReduction: 1,
  inactivityDays: 5,
  inactivityLoadMultiplier: 0.9,
  cleanSessionsForJointProgression: 2,
  plateauWeeks: 4,
  exerciseRotationWeeks: 12,
  volumeReviewEveryWeeks: 8,
  maxWeeklySets: {
    Petto: 16,
    Schiena: 16,
    Spalle: 14,
    Bicipiti: 14,
    Tricipiti: 14,
    Gambe: 16,
    Glutei: 10,
    Core: 8,
  },
};

const PERSONAL_EXERCISE_RULES = {
  "Panca_Inclinata_Con_Manubri_(Presa_Neutra)": {
    range: [6, 8], stepKg: 2, joint: "elbow", rampUp: [[13, 6, 30], [20, 3, 45], [24, 2, 60]],
  },
  Croci_Cavi_Panca_Inclinata: {
    range: [10, 12], stepKg: 1, joint: "elbow",
  },
  Arnold_Press_Seduto_con_Manubri: {
    range: [8, 10], stepKg: 2, joint: "elbow",
  },
  Alzate_Laterali_ai_Cavi: {
    range: [15, 20], stepKg: 1, dropSet: { reduction: 0.4, reps: [8, 10] },
  },
  Flessioni_alle_Parallele: {
    range: [8, 12], stepKg: 2.5, joint: "elbow", special: "dips",
  },
  Face_Pull_al_Cavo_con_Corda: { range: [15, 20], stepKg: 2.5 },
  Estensione_tricipiti_con_corda_al_cavo: { range: [12, 15], stepKg: 2.5 },
  Pulldown_con_presa_neutra: {
    range: [6, 8], stepKg: 2.5, rampUp: [[32, 6, 30], [50, 3, 45], [60, 2, 60]],
  },
  Rematore_Pendlay_con_bilanciere: { range: [6, 8], stepKg: 2.5, rampUp: [[20, 4, 45]] },
  Trazione_con_Braccia_Dritte_al_Cavo: { range: [12, 15], stepKg: 2.5 },
  Croci_inverse_al_cavo_alto: { range: [12, 15], stepKg: 1 },
  Curl_con_manubri_a_martello: { range: [10, 12], stepKg: 2 },
  "Curl_Singolo_al_Cavo_(Bayesian)": { range: [12, 15], stepKg: 1 },
  Pressa_per_le_gambe: {
    range: [6, 8], stepKg: 5, joint: "knee", rampUp: [[65, 6, 30], [100, 3, 45], [120, 2, 60]],
  },
  Stacco_Rumeno_Smith: { range: [8, 10], stepKg: 2.5, rampUp: [[40, 4, 45]] },
  Leg_Curl_Seduto: {
    range: [10, 12], stepKg: 2.5, joint: "knee",
  },
  Hip_thrust_con_bilanciere: {
    range: [10, 12], stepKg: 5, joint: "knee", rampUp: [[20, 5, 45]],
  },
  Calf_Raise_in_Piedi: { range: [12, 15], stepKg: 5 },
  Bulgarian_Split_Squat: { range: [8, 10], stepKg: 2, joint: "knee", scaleDownKg: 2, alternative: "Step-up" },
  "Roll-out_con_bilanciere": { range: [8, 12], stepKg: 0, progressionType: "reps" },
  Pallof_Press_al_cavo: { range: [12, 15], stepKg: 2.5 },
  "Distensioni_su_panca_con_manubri_(presa_neutra)": {
    range: [8, 10], stepKg: 2, joint: "elbow", rampUp: [[14, 8, 30], [21, 4, 45], [25, 2, 60]],
  },
  Pulldown_alla_lat_machine: { range: [8, 10], stepKg: 2.5 },
  Curl_Alternato_con_Manubri: { range: [10, 12], stepKg: 2 },
  Estensione_Tricipiti_Sopra_Testa_Cavo: { range: [12, 15], stepKg: 2.5, joint: "elbow" },
  Plank_Laterale: { range: [20, 45], stepKg: 0, progressionType: "time", unit: "sec" },
};

function personalSet(reps, weight = 0) {
  return { r: reps, w: weight, done: false };
}
function personalExercise({
  id, name, sets, reps, weight = 0, rest = 0, tempo = "", note = "", group = null,
  role = "working", unit = "reps", perSide = false, rounds = null, rampUp = null,
  progression = null, safetyJoint = null, dropSet = null, muscleGroup = null,
}) {
  const sd = Array.from({ length: sets }, () => personalSet(reps, weight));
  const rule = PERSONAL_EXERCISE_RULES[id];
  const progress = role === "warmup" ? null : progression || rule;
  const assignedRampUp = role === "warmup" ? null : rampUp || rule?.rampUp;
  return {
    uid: uid(),
    exerciseId: id,
    name,
    sd,
    rest,
    seat: "",
    ssG: group,
    pF: false,
    note,
    tempo,
    sessionRole: role,
    unit,
    perSide: Boolean(perSide),
    rounds,
    rampUp: assignedRampUp || null,
    rampUpReferenceKg: assignedRampUp ? Number(weight) || 0 : null,
    progression: progress ? { ...progress, range: [...progress.range] } : null,
    safetyJoint: role === "warmup" ? null : safetyJoint || rule?.joint || null,
    dropSet: role === "warmup" ? null : dropSet || rule?.dropSet || null,
    introducedAt: role === "warmup" ? null : new Date().toISOString(),
    muscleGroup: muscleGroup || null,
  };
}
function warmupBike(groupName) {
  return personalExercise({
    id: "Cyclette", name: "Cyclette", sets: 1, reps: 120, unit: "sec", rest: 0,
    role: "warmup", note: "2 minuti a ritmo facile. Esegui prima del lavoro principale.",
    muscleGroup: "Cardio",
  });
}
function warmupShoulderCircles() {
  return personalExercise({
    id: "Circonduzioni_Spalle_Gomiti", name: "Circonduzioni spalle e gomiti",
    sets: 1, reps: 30, unit: "sec", perSide: true, role: "warmup",
    note: "30 secondi per lato, movimenti controllati.", muscleGroup: "Spalle",
  });
}
function warmupPushups() {
  return personalExercise({
    id: "Push_Up_Riscaldamento", name: "Flessioni a corpo libero",
    sets: 1, reps: 10, role: "warmup", note: "Riscaldamento: 10 ripetizioni senza cedimento.",
    muscleGroup: "Petto",
  });
}
function warmupExternalRotation() {
  return personalExercise({
    id: "Rotazioni_Esterne_Con_Elastico", name: "Rotazioni esterne con elastico",
    sets: 1, reps: 15, perSide: true, role: "warmup",
    note: "15 ripetizioni per lato, elastico leggero.", muscleGroup: "Spalle",
  });
}
function warmupFacePull() {
  return personalExercise({
    id: "Face_Pull_al_Cavo_con_Corda", name: "Face pull leggero",
    sets: 1, reps: 15, weight: 10, role: "warmup", rest: 0,
    note: "Carico leggero, attivazione. Non conteggiare come serie allenante.",
    muscleGroup: "Schiena",
  });
}
function warmupBandPullApart() {
  return personalExercise({
    id: "Band_Pull_Apart", name: "Band pull-apart",
    sets: 1, reps: 20, role: "warmup", note: "Elastico leggero, controllo scapolare.",
    muscleGroup: "Schiena",
  });
}
function warmupLightHammer() {
  return personalExercise({
    id: "Curl_con_manubri_a_martello", name: "Hammer curl leggero",
    sets: 1, reps: 10, weight: 4, role: "warmup", note: "Carico leggero, presa neutra.",
    muscleGroup: "Bicipiti",
  });
}
function warmupLatEmpty() {
  return personalExercise({
    id: "Pulldown_con_presa_neutra", name: "Lat pulldown presa neutra leggero",
    sets: 1, reps: 15, weight: 10, role: "warmup", note: "Carico minimo, traiettoria controllata.",
    muscleGroup: "Schiena",
  });
}
function warmupAirSquats() {
  return personalExercise({
    id: "Squat_a_corpo_libero", name: "Squat a corpo libero",
    sets: 4, reps: 12, role: "warmup", group: "legs-warmup-circuit",
    note: "Circuito Tom Holland, 4 round; senza pausa fra i tre esercizi.",
    muscleGroup: "Gambe",
  });
}
function warmupLunges() {
  return personalExercise({
    id: "Affondi_a_corpo_libero", name: "Affondi alternati a corpo libero",
    sets: 4, reps: 10, perSide: true, role: "warmup", group: "legs-warmup-circuit",
    note: "10 ripetizioni per lato. Nessuna pausa prima del glute bridge.",
    muscleGroup: "Gambe",
  });
}
function warmupGluteBridge() {
  return personalExercise({
    id: "Glute_Bridge_a_corpo_libero", name: "Glute bridge a corpo libero",
    sets: 4, reps: 15, role: "warmup", group: "legs-warmup-circuit", rest: 60,
    note: "15 ripetizioni; recupero 60 secondi al termine del round.",
    muscleGroup: "Glutei",
  });
}

function createPersonalTrainingProgram() {
  const push = [
    warmupBike(), warmupShoulderCircles(), warmupPushups(), warmupExternalRotation(),
    personalExercise({ id: "Panca_Inclinata_Con_Manubri_(Presa_Neutra)", name: "Panca inclinata con manubri", sets: 4, reps: 6, weight: 26, rest: 120, tempo: "3-1-2", note: "Panca a 30–35°. Presa neutra o semiprona. Gomito: interrompi al primo fastidio.", muscleGroup: "Petto" }),
    personalExercise({ id: "Croci_Cavi_Panca_Inclinata", name: "Croci ai cavi su panca inclinata", sets: 3, reps: 10, weight: 12, rest: 45, tempo: "3-1-2", note: "Panca a 30–35°. Gomito: interrompi al primo fastidio.", muscleGroup: "Petto" }),
    personalExercise({ id: "Arnold_Press_Seduto_con_Manubri", name: "Arnold press", sets: 3, reps: 8, weight: 14, rest: 0, tempo: "2-1-2", note: "Schienale 80–85°. Presa controllata; stop al fastidio al gomito.", group: "push-shoulders", muscleGroup: "Spalle" }),
    personalExercise({ id: "Alzate_Laterali_ai_Cavi", name: "Alzate laterali al cavo", sets: 3, reps: 15, weight: 8, rest: 75, tempo: "2-1-2", note: "Superserie con Arnold press; recupero 75 s dopo l'ultima coppia.", group: "push-shoulders", muscleGroup: "Spalle" }),
    personalExercise({ id: "Flessioni_alle_Parallele", name: "Dips alle parallele", sets: 3, reps: 8, weight: 0, rest: 0, tempo: "2-1-2", note: "Fase 1: corpo libero fino a 3×12 senza fastidio. Poi fase 2: +2,5 kg e ritorno a 8 rep; passaggio solo dopo 2 sessioni pulite per il gomito.", group: "push-triceps", muscleGroup: "Tricipiti" }),
    personalExercise({ id: "Face_Pull_al_Cavo_con_Corda", name: "Face pull ai cavi con corda", sets: 3, reps: 15, weight: 25, rest: 75, tempo: "2-1-2", note: "Superserie con dips; recupero 75 s dopo l'ultima coppia.", group: "push-triceps", muscleGroup: "Spalle" }),
    personalExercise({ id: "Estensione_tricipiti_con_corda_al_cavo", name: "Pushdown tricipiti con corda", sets: 3, reps: 12, weight: 40, rest: 60, tempo: "2-1-2", note: "Sostituisce skull crusher. Presa neutra, interrompi al fastidio al gomito.", muscleGroup: "Tricipiti" }),
  ];
  const pull = [
    warmupBike(), warmupBandPullApart(), warmupLightHammer(), warmupLatEmpty(),
    personalExercise({ id: "Pulldown_con_presa_neutra", name: "Lat pulldown presa neutra", sets: 4, reps: 6, weight: 65, rest: 120, tempo: "2-1-2", note: "Presa neutra. Ramp-up specifico prima delle serie allenanti.", muscleGroup: "Schiena" }),
    personalExercise({ id: "Rematore_Pendlay_con_bilanciere", name: "Rematore Pendlay", sets: 3, reps: 6, weight: 30, rest: 90, tempo: "2-1-2", note: "Niente pedana da stacco classico; appoggia il bilanciere in modo controllato.", muscleGroup: "Schiena" }),
    personalExercise({ id: "Trazione_con_Braccia_Dritte_al_Cavo", name: "Pulldown a braccia tese", sets: 2, reps: 12, weight: 50, rest: 75, tempo: "2-1-2", muscleGroup: "Schiena" }),
    personalExercise({ id: "Croci_inverse_al_cavo_alto", name: "Reverse fly ai cavi", sets: 3, reps: 12, weight: 15, rest: 0, tempo: "2-1-2", note: "Superserie con hammer curl; nessuna pausa fra gli esercizi.", group: "pull-arms", muscleGroup: "Schiena" }),
    personalExercise({ id: "Curl_con_manubri_a_martello", name: "Hammer curl", sets: 3, reps: 10, weight: 12, rest: 75, tempo: "2-1-2", note: "Presa neutra, gomito vicino al corpo. Sostituisce spider curl.", group: "pull-arms", muscleGroup: "Bicipiti" }),
    personalExercise({ id: "Curl_Singolo_al_Cavo_(Bayesian)", name: "Curl Bayesian al cavo", sets: 3, reps: 12, weight: 8, rest: 60, tempo: "2-1-2", note: "Presa confortevole. Curl inverso escluso dalla scheda principale.", muscleGroup: "Bicipiti" }),
  ];
  const legs = [
    warmupAirSquats(), warmupLunges(), warmupGluteBridge(),
    personalExercise({ id: "Pressa_per_le_gambe", name: "Leg press", sets: 3, reps: 6, weight: 130, rest: 90, tempo: "3-1-2", note: "Ginocchio sinistro: stop al dolore. Range confortevole, non forzare la profondità.", muscleGroup: "Gambe" }),
    personalExercise({ id: "Stacco_Rumeno_Smith", name: "Stacco rumeno alla Smith", sets: 3, reps: 8, weight: 60, rest: 0, tempo: "3-1-2", note: "Ramp-up 40 kg × 4.", group: "legs-posterior", muscleGroup: "Gambe" }),
    personalExercise({ id: "Leg_Curl_Seduto", name: "Leg curl seduto", sets: 3, reps: 10, weight: 35, rest: 75, tempo: "2-1-2", note: "Superserie con RDL Smith; stop se compare dolore al ginocchio.", group: "legs-posterior", muscleGroup: "Gambe" }),
    personalExercise({ id: "Hip_thrust_con_bilanciere", name: "Hip thrust", sets: 3, reps: 10, weight: 40, rest: 0, tempo: "2-1-2", note: "Ramp-up 20 kg × 5. Esercizio di rinforzo glutei; stop al dolore al ginocchio.", group: "legs-glutes", muscleGroup: "Glutei" }),
    personalExercise({ id: "Calf_Raise_in_Piedi", name: "Calf raise in piedi", sets: 3, reps: 12, weight: 70, rest: 60, tempo: "2-1-2", group: "legs-glutes", muscleGroup: "Gambe" }),
    personalExercise({ id: "Bulgarian_Split_Squat", name: "Bulgarian split squat", sets: 2, reps: 8, weight: 10, rest: 75, tempo: "3-1-2", note: "Ginocchio: se tira, riduci di 2 kg; se persiste sostituisci con step-up. Stop al dolore.", muscleGroup: "Gambe" }),
    personalExercise({ id: "Roll-out_con_bilanciere", name: "Ab wheel / roll-out con bilanciere", sets: 3, reps: 8, weight: 0, rest: 0, tempo: "2-1-2", note: "Usa ab wheel se disponibile; altrimenti roll-out con bilanciere. Progressione solo reps fino a 12.", muscleGroup: "Core" }),
    personalExercise({ id: "Pallof_Press_al_cavo", name: "Pallof press", sets: 3, reps: 12, weight: 10, rest: 60, tempo: "2-1-2", muscleGroup: "Core" }),
  ];
  const upper = [
    warmupBike(), warmupShoulderCircles(), warmupPushups(), warmupFacePull(),
    personalExercise({ id: "Distensioni_su_panca_con_manubri_(presa_neutra)", name: "Panca piana con manubri", sets: 3, reps: 8, weight: 28, rest: 0, tempo: "3-1-2", note: "Panca 0°. Presa neutra/semiprona se più confortevole. Superserie antagonista: alterna con lat larga, nessuna pausa fra A e B.", group: "upper-antagonist", muscleGroup: "Petto" }),
    personalExercise({ id: "Pulldown_alla_lat_machine", name: "Lat pulldown presa larga", sets: 3, reps: 8, weight: 55, rest: 90, tempo: "2-1-2", note: "Superserie antagonista con panca piana DB; recupero 90 s dopo B.", group: "upper-antagonist", muscleGroup: "Schiena" }),
    personalExercise({ id: "Curl_Alternato_con_Manubri", name: "Curl alternato con manubri", sets: 3, reps: 10, weight: 10, rest: 0, tempo: "2-1-2", note: "Superserie con estensione tricipiti sopra la testa.", group: "upper-arms", muscleGroup: "Bicipiti" }),
    personalExercise({ id: "Estensione_Tricipiti_Sopra_Testa_Cavo", name: "Estensione tricipiti sopra la testa al cavo", sets: 3, reps: 12, weight: 15, rest: 75, tempo: "2-1-2", note: "Presa corda neutra, interrompi al primo fastidio al gomito.", group: "upper-arms", muscleGroup: "Tricipiti" }),
    personalExercise({ id: "Alzate_Laterali_ai_Cavi", name: "Alzate laterali al cavo", sets: 3, reps: 15, weight: 8, rest: 0, tempo: "2-1-2", note: "Superserie con face pull.", group: "upper-shoulders", muscleGroup: "Spalle" }),
    personalExercise({ id: "Face_Pull_al_Cavo_con_Corda", name: "Face pull ai cavi con corda", sets: 2, reps: 15, weight: 20, rest: 60, tempo: "2-1-2", note: "Superserie con alzate laterali; recupero 60 s dopo la coppia.", group: "upper-shoulders", muscleGroup: "Spalle" }),
    personalExercise({ id: "Roll-out_con_bilanciere", name: "Ab wheel / roll-out con bilanciere", sets: 2, reps: 10, weight: 0, rest: 0, tempo: "2-1-2", note: "Se disponibile ab wheel, altrimenti bilanciere. Superserie con plank laterale.", group: "upper-core", muscleGroup: "Core" }),
    personalExercise({ id: "Plank_Laterale", name: "Plank laterale", sets: 2, reps: 20, weight: 0, rest: 60, unit: "sec", perSide: true, note: "20 secondi per lato; progressione solo sul tempo fino a 45 s.", group: "upper-core", muscleGroup: "Core" }),
  ];
  const days = [
    { name: "Push Final", exs: push },
    { name: "Pull Final", exs: pull },
    { name: "Gambe Final", exs: legs },
    { name: "Upper Final", exs: upper },
  ];
  return days.map((day) => ({
    id: uid(),
    name: day.name,
    exs: day.exs,
    personalProgramVersion: PERSONAL_PROGRAM_VERSION,
  }));
}

function isWarmupExercise(ex) {
  return Boolean(ex && ex.sessionRole === "warmup");
}
function isWorkingExercise(ex) {
  return Boolean(ex && ex.sessionRole !== "warmup");
}
function formatRepTarget(ex) {
  const range = ex?.progression?.range;
  if (!range) return "";
  const suffix = ex.unit === "sec" || ex.progression.unit === "sec" ? "s" : " rep";
  return `${range[0]}–${range[1]}${suffix}`;
}
function roundTrainingLoad(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}
function getRampUpForLoad(ex, workLoad, multiplier = 1) {
  if (!ex?.rampUp?.length) return [];
  const reference = Math.max(0, Number(ex.rampUpReferenceKg ?? ex.sd?.[0]?.w) || 0);
  const current = Math.max(0, Number(workLoad) || 0);
  const factor = reference > 0 ? current / reference : 1;
  return ex.rampUp.map(([load, reps, restSec = 45]) => ({
    w: roundTrainingLoad(load * factor * multiplier),
    r: reps,
    rest: restSec,
  }));
}
function isRepRangeMet(ex, completedSets) {
  const range = ex?.progression?.range;
  const sets = Array.isArray(completedSets) ? completedSets : [];
  if (!range || !sets.length) return false;
  return sets.length >= (ex.sd?.length || 1) && sets.every((set) => Number(set.r) >= range[1]);
}
function getCleanJointStreak(exerciseHistory, feedbackBySession, joint, limit = 2) {
  if (!joint || !Array.isArray(exerciseHistory) || !Array.isArray(feedbackBySession)) return 0;
  const feedback = new Map(feedbackBySession.map((entry) => [entry.sessionId, entry]));
  const relevant = [...exerciseHistory]
    .filter((entry) => entry.sessionId)
    .sort((a, b) => new Date(b.dt) - new Date(a.dt));
  let streak = 0;
  for (const entry of relevant) {
    if (entry.exerciseComplete === false || !feedback.has(entry.sessionId) || feedback.get(entry.sessionId)?.[joint] !== "none") break;
    streak++;
    if (streak >= limit) break;
  }
  return streak;
}
function getWeeklyVolumeAdvice(dayList, limits = PERSONAL_PROGRAM_CONFIG.maxWeeklySets) {
  const totals = {};
  for (const day of dayList || []) {
    for (const ex of day.exs || []) {
      if (isWarmupExercise(ex)) continue;
      const group = ex.muscleGroup || "Altro";
      totals[group] = (totals[group] || 0) + (ex.sd?.length || 0);
    }
  }
  return Object.entries(limits).map(([group, limit]) => ({
    group,
    sets: totals[group] || 0,
    limit,
    atLimit: (totals[group] || 0) >= limit,
    nearLimit: (totals[group] || 0) >= limit * 0.85,
  }));
}

function installPersonalTrainingProgram() {
  if (!D || !Array.isArray(D.days)) return;
  if (D.st?.personalProgramVersion === PERSONAL_PROGRAM_VERSION) {
    toast("Il programma personale è già presente.", "info");
    return;
  }
  const existingCount = D.days.length;
  const confirmation = existingCount
    ? `Aggiungere le quattro giornate personali alle ${existingCount} già presenti?\n\nNessuna scheda, sessione o nota verrà sostituita.`
    : "Aggiungere le quattro giornate del programma personale?";
  if (!confirm(confirmation)) return;
  const days = createPersonalTrainingProgram();
  D.days.push(...days);
  D.st = D.st || {};
  D.st.personalProgramVersion = PERSONAL_PROGRAM_VERSION;
  D.st.nextPersonalDayIndex = 0;
  if (!D.st.personalProgramStart) {
    const today = new Date();
    D.st.personalProgramStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  }
  D.sessionFeedback = Array.isArray(D.sessionFeedback) ? D.sessionFeedback : [];
  save();
  if (typeof renderAll === "function") renderAll();
  if (typeof renderHomePremium === "function") renderHomePremium();
  toast(
    "Programma aggiunto senza modificare le schede esistenti. La settimana 1 parte da oggi; puoi correggere la data nelle impostazioni della fase.",
    "ok",
    5000,
  );
}

function getPersonalDayList() {
  return (D?.days || []).filter(
    (day) => day.personalProgramVersion === PERSONAL_PROGRAM_VERSION,
  );
}
function getPersonalExerciseHistory(dayId, ex) {
  return (D?.hist || [])
    .filter(
      (entry) =>
        entry.dayId === dayId &&
        entry.eid === ex.exerciseId &&
        (entry.exerciseUid === ex.uid || !entry.exerciseUid) &&
        !entry.isWarmup,
    )
    .sort((a, b) => new Date(b.dt) - new Date(a.dt));
}
function getProgressionStatus(ex, dayId) {
  if (!ex?.progression || !dayId || !D) return null;
  const history = getPersonalExerciseHistory(dayId, ex);
  const last = history[0];
  const range = ex.progression.range;
  if (!last) return { ready: false, text: `Obiettivo ${formatRepTarget(ex)}; nessuna sessione registrata.` };
  if (last.isDeload)
    return { ready: false, text: "Deload registrato: riprendi il carico normale nel prossimo allenamento." };
  if (last.isInactivityAdjusted)
    return { ready: false, text: "Sessione di rientro a −10%: riprendi il carico programmato senza aumentarlo." };
  if (last.exerciseComplete === false)
    return { ready: false, text: "Completa tutte le serie allenanti prima di progredire." };
  const lastSets = (last.sd || []).filter((set) => !set.isDropSet);
  const workPlan = (ex.sd || []).filter((set) => !set.isDropSet);
  if (!isRepRangeMet({ ...ex, sd: workPlan }, lastSets)) {
    const achieved = lastSets.map((set) => Number(set.r) || 0);
    const best = achieved.length ? Math.min(...achieved) : 0;
    return {
      ready: false,
      text: `Obiettivo ${formatRepTarget(ex)}; mantieni il carico finché tutte le serie raggiungono ${range[1]}${ex.unit === "sec" ? " s" : " rep"}.`,
      lastSets: achieved,
      lowestReps: best,
    };
  }
  const joint = ex.safetyJoint || ex.progression.joint;
  if (joint) {
    const streak = getCleanJointStreak(
      history,
      D.sessionFeedback || [],
      joint,
      PERSONAL_PROGRAM_CONFIG.cleanSessionsForJointProgression,
    );
    if (streak < PERSONAL_PROGRAM_CONFIG.cleanSessionsForJointProgression) {
      return {
        ready: false,
        text: `Ripetizioni al limite alto, ma servono ${PERSONAL_PROGRAM_CONFIG.cleanSessionsForJointProgression} sessioni consecutive senza fastidio ${joint === "elbow" ? "al gomito" : "al ginocchio"} (registrate: ${streak}).`,
        streak,
      };
    }
  }
  if (ex.progression.progressionType === "reps" || ex.progression.progressionType === "time") {
    return {
      ready: false,
      reachedTop: true,
      text: `Limite alto raggiunto (${range[1]}${ex.unit === "sec" ? " s" : " rep"}); mantieni il carico e consolida.`,
    };
  }
  const currentLoad = Math.max(0, ...workPlan.map((set) => Number(set.w) || 0));
  const increment = ex.progression.special === "dips" && (ex.progressionStage || 1) === 1
    ? 2.5
    : Number(ex.progression.stepKg) || 0;
  const targetLoad = roundTrainingLoad(currentLoad + increment);
  const specialText = ex.progression.special === "dips" && (ex.progressionStage || 1) === 1
    ? "Passa alla fase 2"
    : "Progressione doppia completata";
  return {
    ready: true,
    currentLoad,
    targetLoad,
    targetReps: range[0],
    text: `${specialText}: ${formatGymNumber(targetLoad, 2)} kg × ${range[0]} rep per serie.`,
  };
}
function applyPersonalProgressions(day) {
  if (!day || !D || !day.personalProgramVersion) return [];
  const week = typeof getProgramWeek === "function" ? getProgramWeek() : null;
  if (week && isDeloadWeek(week)) return [];
  const changes = [];
  day.exs.forEach((ex) => {
    if (!ex.progression) return;
    const status = getProgressionStatus(ex, day.id);
    if (!status?.ready) return;
    const rangeStart = Number(ex.progression.range[0]);
    if (ex.progression.special === "dips" && (ex.progressionStage || 1) === 1)
      ex.progressionStage = 2;
    (ex.sd || []).forEach((set) => {
      if (set.isDropSet) return;
      if (ex.progression.progressionType === "reps" || ex.progression.progressionType === "time") {
        set.r = Math.min(Number(ex.progression.range[1]), Math.max(rangeStart, Number(set.r) || rangeStart));
      } else {
        set.w = roundTrainingLoad((Number(set.w) || 0) + (Number(ex.progression.special === "dips" && (ex.progressionStage || 1) === 2 && status.currentLoad === 0 ? 2.5 : ex.progression.stepKg) || 0));
        set.r = rangeStart;
      }
      set.done = false;
    });
    changes.push({ exercise: ex.name, text: status.text });
  });
  return changes;
}
function getLastSessionForDay(dayId) {
  return (D?.sessionFeedback || [])
    .filter((entry) => entry.dayId === dayId)
    .sort((a, b) => new Date(b.dt) - new Date(a.dt))[0] || null;
}
function getDaysSinceLastPersonalSession(dayId, now = Date.now()) {
  const last = (D?.hist || [])
    .filter((entry) => entry.dayId === dayId && !entry.isWarmup)
    .sort((a, b) => new Date(b.dt) - new Date(a.dt))[0];
  if (!last?.dt) return null;
  return Math.floor((now - new Date(last.dt).getTime()) / 86400000);
}
function getJointDiscomfortStreak(joint, feedback = D?.sessionFeedback || []) {
  if (!joint) return 0;
  const ordered = [...feedback].sort((a, b) => new Date(b.dt) - new Date(a.dt));
  let count = 0;
  for (const session of ordered) {
    if (!session.saved) continue;
    if (!['mild', 'yes'].includes(session[joint])) break;
    count++;
    if (count >= 3) break;
  }
  return count;
}
function canUseDropSet(dayId) {
  if (Object.keys(D?.activeSession?.reportedPain || {}).length)
    return { allowed: false, reason: "Drop set sospesi dopo un fastidio articolare nella sessione in corso." };
  const week = typeof getProgramWeek === "function" ? getProgramWeek() : null;
  if (D?.activeSession?.isDeload || (week && isDeloadWeek(week))) return { allowed: false, reason: "Drop set esclusi nella settimana di deload." };
  const last = getLatestSessionFeedback();
  if (last && (last.elbow !== "none" || last.knee !== "none"))
    return { allowed: false, reason: "Drop set sospesi dopo un fastidio articolare nella sessione precedente." };
  return { allowed: true, reason: "" };
}
function preparePersonalSession(day, now = Date.now()) {
  if (!day?.personalProgramVersion || !D) return null;
  const week = typeof getProgramWeek === "function" ? getProgramWeek() : null;
  const volumeChanges = typeof applyPersonalVolumeMilestone === "function" ? applyPersonalVolumeMilestone(week) : [];
  const progressionChanges = applyPersonalProgressions(day);
  const deload = Boolean(week && isDeloadWeek(week));
  const daysSince = getDaysSinceLastPersonalSession(day.id, now);
  const inactivity = daysSince !== null && daysSince > PERSONAL_PROGRAM_CONFIG.inactivityDays;
  const multiplier = (deload ? PERSONAL_PROGRAM_CONFIG.deloadLoadMultiplier : 1) *
    (inactivity ? PERSONAL_PROGRAM_CONFIG.inactivityLoadMultiplier : 1);
  const originalSets = {};
  day.exs.forEach((ex) => {
    originalSets[ex.uid] = (ex.sd || []).map((set) => ({ ...set }));
    if (isWarmupExercise(ex)) {
      ex.sd.forEach((set) => { set.done = false; delete set.skipped; });
      return;
    }
    const lastNormalSession = deload
      ? getPersonalExerciseHistory(day.id, ex).find((entry) => !entry.isDeload && !entry.isInactivityAdjusted && entry.exerciseComplete !== false)
      : null;
    const lastNormalSets = (lastNormalSession?.sd || []).filter((set) => !set.isDropSet);
    if (deload && ex.sd.length > 1) ex.sd = ex.sd.slice(0, Math.max(1, ex.sd.length - PERSONAL_PROGRAM_CONFIG.deloadSetReduction));
    ex.sd.forEach((set, index) => {
      const previousLoad = Number(lastNormalSets[index]?.w ?? lastNormalSession?.w ?? set.w) || 0;
      const startingLoad = deload ? previousLoad : Number(set.w) || 0;
      set.w = roundTrainingLoad(startingLoad * multiplier);
      set.done = false;
      delete set.skipped;
      delete set.isDropSet;
    });
  });
  return {
    dayId: day.id,
    startedAt: now,
    originalSets,
    isPersonal: true,
    isDeload: deload,
    inactivityAdjusted: inactivity,
    daysSinceLastSession: daysSince,
    loadMultiplier: multiplier,
    week,
    progressionChanges,
    volumeChanges,
    reportedPain: {},
    stoppedExercises: {},
    pendingCompletion: false,
  };
}
function restorePersonalSessionPlan(day, activeSession) {
  if (!day || !activeSession?.originalSets) return;
  for (const ex of day.exs || []) {
    const saved = activeSession.originalSets[ex.uid];
    if (saved) ex.sd = saved.map((set) => { const restored = { ...set, done: false }; delete restored.skipped; delete restored.isDropSet; return restored; });
  }
}
function addPersonalDropSetIfDue(ex, completedSet, dayId) {
  if (!ex?.dropSet || !completedSet || completedSet.isDropSet || ex.sessionRole === "warmup") return false;
  const eligibility = canUseDropSet(dayId);
  if (!eligibility.allowed) return false;
  const workingSets = ex.sd.filter((set) => !set.isDropSet);
  if (!workingSets.length || !workingSets.every((set) => set.done)) return false;
  if (ex.sd.some((set) => set.isDropSet)) return false;
  const reduction = Math.max(0, Math.min(0.9, Number(ex.dropSet.reduction) || 0.3));
  const lastWeight = Number(completedSet.w) || 0;
  ex.sd.push({
    r: Number(ex.dropSet.reps?.[0]) || 8,
    w: roundTrainingLoad(lastWeight * (1 - reduction)),
    done: false,
    isDropSet: true,
  });
  return true;
}
function getProgramPolicyMessages(day) {
  if (!day?.personalProgramVersion || !D) return [];
  const messages = [];
  const rest = getPersonalRestStatus();
  if (rest) messages.push(rest.message);
  else {
    const personalDays = getPersonalDayList();
    const expected = personalDays[Number(D.st?.nextPersonalDayIndex) || 0];
    if (expected && expected.id !== day.id)
      messages.push(`Sequenza personale: la prossima giornata è ${expected.name}.`);
  }
  const week = typeof getProgramWeek === "function" ? getProgramWeek() : null;
  if (week && isDeloadWeek(week)) {
    messages.push(`Settimana ${week}: deload obbligatorio · −40% dal carico dell’ultima sessione normale, −1 serie per esercizio (minimo 1), ripetizioni e recuperi invariati, senza drop set.`);
  } else if (week) {
    messages.push(`Settimana ${week} del mesociclo · prossimo deload alla settimana ${Math.ceil(week / 4) * 4}.`);
  } else {
    messages.push("Imposta la data di inizio del programma per attivare il deload obbligatorio ogni 4 settimane.");
  }
  const daysSince = getDaysSinceLastPersonalSession(day.id);
  if (daysSince !== null && daysSince > PERSONAL_PROGRAM_CONFIG.inactivityDays && !(week && isDeloadWeek(week)))
    messages.push(`Sono passati ${daysSince} giorni: solo in questa sessione carichi ridotti del 10%; dalla prossima si riprende il carico programmato.`);
  if (week && D.st?.lastVolumeReview?.week === week)
    messages.push(`Revisione volume settimana ${week}: ${D.st.lastVolumeReview.messages.join(" ")}`);
  else if (week > 1 && (week - 1) % 4 === 0 && !D.st?.volumeReviewApplied?.[week])
    messages.push("Revisione volume: braccia +1 serie/mese (entro il tetto) e, ogni 8 settimane, +1 serie all’esercizio principale se il gruppo è sotto il limite; ab wheel solo a 12 rip.");
  const volume = getWeeklyVolumeAdvice(getPersonalDayList());
  const over = volume.filter((entry) => entry.sets > entry.limit);
  const atLimit = volume.filter((entry) => entry.sets === entry.limit);
  const near = volume.filter((entry) => entry.nearLimit && entry.sets < entry.limit);
  if (over.length || atLimit.length) {
    const constrained = [...over, ...atLimit].map((entry) => `${entry.group} ${entry.sets}/${entry.limit} serie`).join(", ");
    messages.push(`Volume oltre/al tetto: ${constrained}. Scegli una sostituzione/riduzione prima di aggiungere serie.`);
  } else if (near.length)
    messages.push(`Vicino al tetto settimanale: ${near.map((entry) => `${entry.group} ${entry.sets}/${entry.limit}`).join(", ")}. Preferisci una sostituzione a un’aggiunta.`);
  return messages;
}
function getPlateauStatus(ex, dayId) {
  const history = getPersonalExerciseHistory(dayId, ex).filter((entry) => !entry.isDeload && !entry.isInactivityAdjusted && entry.exerciseComplete !== false);
  if (history.length < 2) return null;
  const latest = history[0];
  const latestTime = new Date(latest.dt).getTime();
  const stableLoad = [];
  for (const entry of history) {
    if (Number(entry.w) !== Number(latest.w)) break;
    stableLoad.push(entry);
  }
  const oldestStableTime = new Date(stableLoad.at(-1)?.dt || latest.dt).getTime();
  if (stableLoad.length >= 2 && latestTime - oldestStableTime >= PERSONAL_PROGRAM_CONFIG.plateauWeeks * 7 * 86400000)
    return "Stallo da circa 4 settimane (deload esclusi): valuta una variante sicura.";
  const introduced = new Date(ex.introducedAt || latest.dt).getTime();
  if (Number.isFinite(introduced) && Date.now() - introduced >= PERSONAL_PROGRAM_CONFIG.exerciseRotationWeeks * 7 * 86400000)
    return "12 settimane sullo stesso esercizio: valuta una rotazione del movimento.";
  return null;
}

const genericExerciseWeightStep = getWeightStep;
getWeightStep = function (ex) {
  const step = Number(ex?.progression?.stepKg);
  return Number.isFinite(step) && step > 0 ? step : genericExerciseWeightStep(ex);
};
function getLatestSessionFeedback() {
  return (D?.sessionFeedback || [])
    .filter((entry) => entry.saved)
    .sort((a, b) => new Date(b.dt) - new Date(a.dt))[0] || null;
}
function addOrRemoveDropSet(exUid) {
  const ex = fEx(exUid);
  if (!ex || ex.sessionRole === "warmup") return;
  if (ex.dropSet) {
    if (!confirm(`Disattivare il drop set finale di ${ex.name}?`)) return;
    ex.dropSet = null;
  } else {
    if (!confirm(`Attivare un drop set solo dopo l’ultima serie di ${ex.name}, riducendo il carico del 30%?`)) return;
    ex.dropSet = { reduction: 0.3, reps: [8, 10] };
  }
  save();
  if (typeof renderDayPremium === "function") renderDayPremium();
}
function localProgramDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function getPersonalRestStatus(now = Date.now()) {
  if (!D?.st?.personalProgramVersion || Number(D.st.nextPersonalDayIndex) !== 2 || !D.st.personalRestAfterPull) return null;
  const [year, month, day] = String(D.st.personalRestAfterPull).split("-").map(Number);
  const pullDate = new Date(year, month - 1, day);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const daysSincePull = Math.floor((today - pullDate) / 86400000);
  if (!Number.isFinite(daysSincePull) || daysSincePull >= 2 || daysSincePull < 0) return null;
  const nextDate = new Date(pullDate);
  nextDate.setDate(nextDate.getDate() + 2);
  const available = localProgramDate(nextDate);
  return {
    availableDate: available,
    message: daysSincePull === 0
      ? `Riposo dopo Pull Final. Gambe Final non prima del ${available}.`
      : `Oggi è il giorno di riposo programmato dopo Pull Final. Riprendi con Gambe Final il ${available}.`,
  };
}
function advancePersonalDay(dayId) {
  if (!D?.st?.personalProgramVersion) return;
  const days = getPersonalDayList();
  const index = days.findIndex((day) => day.id === dayId);
  if (index < 0) return;
  D.st.nextPersonalDayIndex = (index + 1) % days.length;
  if (days[index].name === "Pull Final") D.st.personalRestAfterPull = localProgramDate();
  else if (days[index].name === "Gambe Final") delete D.st.personalRestAfterPull;
}
function stopExerciseForJointPain() {
  const day = gD();
  const ex = day?.exs?.[sesExIdx];
  const joint = ex?.safetyJoint;
  if (!ex || !joint || !sesActive || sessionFinalized) return;
  if (!confirm(`Interrompere ${ex.name} per il fastidio e saltare le serie rimanenti?`)) return;
  D.activeSession = D.activeSession || { dayId: curDay, startedAt: sesStartTime };
  D.activeSession.reportedPain = D.activeSession.reportedPain || {};
  D.activeSession.stoppedExercises = D.activeSession.stoppedExercises || {};
  D.activeSession.reportedPain[joint] = "yes";
  D.activeSession.stoppedExercises[ex.uid] = true;
  ex.sd.forEach((set) => {
    if (!set.done) {
      set.done = true;
      set.skipped = true;
    }
  });
  save();
  movePastStoppedExercise();
}
function skipExerciseForSafety() {
  const day = gD();
  const ex = day?.exs?.[sesExIdx];
  if (!ex || !sesActive || sessionFinalized) return;
  ex.sd.forEach((set) => {
    if (!set.done) {
      set.done = true;
      set.skipped = true;
    }
  });
  D.activeSession.stoppedExercises = D.activeSession.stoppedExercises || {};
  D.activeSession.stoppedExercises[ex.uid] = true;
  save();
  movePastStoppedExercise();
}
function movePastStoppedExercise() {
  const day = gD();
  if (!day) return;
  const next = day.exs.findIndex((exercise) => exercise.sd?.some((set) => !set.done));
  if (next < 0) {
    sesShowSummary();
    return;
  }
  sesExIdx = next;
  sesLastExIdx = -1;
  selectedSetIdx = null;
  sesRender();
}
function persistSessionFeedbackDraft() {
  if (!D?.activeSession?.pendingCompletion) return;
  D.activeSession.feedbackDraft = {
    elbow: document.getElementById("feedbackElbow")?.value || "",
    knee: document.getElementById("feedbackKnee")?.value || "",
    rpe: document.getElementById("feedbackRpe")?.value || "",
    note: document.getElementById("feedbackNote")?.value || "",
  };
  save();
}
["feedbackElbow", "feedbackKnee", "feedbackRpe", "feedbackNote"].forEach((id) => {
  const input = document.getElementById(id);
  input?.addEventListener("input", persistSessionFeedbackDraft);
  input?.addEventListener("change", persistSessionFeedbackDraft);
});

const PERSONAL_VOLUME_PRIMARY_IDS = {
  Petto: ["Panca_Inclinata_Con_Manubri_(Presa_Neutra)"],
  Schiena: ["Pulldown_con_presa_neutra"],
  Spalle: ["Arnold_Press_Seduto_con_Manubri"],
  Gambe: ["Pressa_per_le_gambe"],
  Glutei: ["Hip_thrust_con_bilanciere"],
  Core: ["Roll-out_con_bilanciere"],
  Bicipiti: ["Curl_con_manubri_a_martello"],
  Tricipiti: ["Estensione_tricipiti_con_corda_al_cavo"],
};
function getLastExerciseSetLog(ex) {
  return getPersonalExerciseHistory(
    getPersonalDayList().find((day) => day.exs.some((item) => item.uid === ex.uid))?.id,
    ex,
  )[0] || null;
}
function applyPersonalVolumeMilestone(week) {
  if (!D || !week || week <= 1) return [];
  const monthDue = (week - 1) % 4 === 0;
  const eightWeekDue = (week - 1) % PERSONAL_PROGRAM_CONFIG.volumeReviewEveryWeeks === 0;
  if (!monthDue && !eightWeekDue) return [];
  D.st = D.st || {};
  D.st.volumeReviewApplied = D.st.volumeReviewApplied || {};
  if (D.st.volumeReviewApplied[week]) return [];
  const cycle = Math.floor((week - 1) / PERSONAL_PROGRAM_CONFIG.volumeReviewEveryWeeks);
  D.st.volumeAddsByCycle = D.st.volumeAddsByCycle || {};
  const additions = D.st.volumeAddsByCycle[cycle] || (D.st.volumeAddsByCycle[cycle] = {});
  const totals = Object.fromEntries(getWeeklyVolumeAdvice(getPersonalDayList()).map((entry) => [entry.group, entry.sets]));
  const messages = [];
  const groupsDue = new Set();
  if (monthDue) {
    groupsDue.add("Bicipiti");
    groupsDue.add("Tricipiti");
  }
  if (eightWeekDue) {
    ["Petto", "Schiena", "Spalle", "Gambe", "Glutei", "Core"].forEach((group) => groupsDue.add(group));
  }
  for (const group of groupsDue) {
    const limit = PERSONAL_PROGRAM_CONFIG.maxWeeklySets[group];
    const current = totals[group] || 0;
    const countThisCycle = additions[group] || 0;
    const primaryIds = PERSONAL_VOLUME_PRIMARY_IDS[group] || [];
    const candidate = getPersonalDayList()
      .flatMap((day) => day.exs.map((ex) => ({ day, ex })))
      .find(({ ex, day }) => primaryIds.includes(ex.exerciseId) && ex.muscleGroup === group && (group !== "Core" || day.name === "Gambe Final"));
    if (group === "Core") {
      const prior = candidate ? getPersonalExerciseHistory(candidate.day.id, candidate.ex).find((entry) => !entry.isDeload && !entry.isInactivityAdjusted) : null;
      const reached12 = prior?.exerciseComplete && (prior.sd || []).filter((set) => !set.isDropSet).length >= 1 &&
        (prior.sd || []).filter((set) => !set.isDropSet).every((set) => Number(set.r) >= 12);
      if (!reached12) {
        messages.push("Core: +1 serie rinviata; applicala solo dopo aver portato l’ab wheel a 12 ripetizioni.");
        continue;
      }
    }
    if (!candidate || countThisCycle >= 2 || current + 1 > limit || current >= limit * 0.85) {
      messages.push(`${group}: niente serie aggiuntive (${current}/${limit}); vicino al tetto, preferisci una sostituzione.`);
      continue;
    }
    const lastSet = candidate.ex.sd[candidate.ex.sd.length - 1] || { r: candidate.ex.progression?.range?.[0] || 1, w: 0 };
    candidate.ex.sd.push({
      r: Number(candidate.ex.progression?.range?.[0]) || Number(lastSet.r) || 1,
      w: Number(lastSet.w) || 0,
      done: false,
    });
    additions[group] = countThisCycle + 1;
    totals[group] = current + 1;
    messages.push(`${group}: aggiunta 1 serie a ${candidate.ex.name} (${totals[group]}/${limit}).`);
  }
  D.st.volumeReviewApplied[week] = true;
  D.st.lastVolumeReview = { week, cycle, messages, dt: new Date().toISOString() };
  save();
  return messages;
}
