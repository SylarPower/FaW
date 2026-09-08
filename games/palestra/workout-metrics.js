/* Shared workout rules. No network, media, or persistent state. */
function isDumbbellExercise(ex) {
  if (!ex) return false;
  const definition = exDef(ex.exerciseId);
  const equipment = String(definition?.eq || ex.eq || ex.equipment || "")
    .trim()
    .toLowerCase();
  if (/manubr|dumbbell/.test(equipment)) return true;
  if (
    [
      "bilanciere",
      "cavi",
      "macchina",
      "smith-machine",
      "peso corporeo",
      "cardio",
      "allungamenti",
    ].includes(equipment)
  )
    return false;
  // Imported/custom IDs and a few legacy catalogue rows have no valid equipment.
  return /\b(manubri|manubrio|dumbbells?)\b/i.test(
    [ex.name, ex.exerciseId].join(" ").replace(/_/g, " "),
  );
}
function getWeightStep(ex) {
  return isDumbbellExercise(ex) ? 2 : 2.5;
}
function formatGymNumber(value, maximumFractionDigits = 1) {
  return new Intl.NumberFormat("it-IT", {
    maximumFractionDigits,
    useGrouping: "always",
  }).format(value);
}
function getSetProgress(done, total) {
  if (!total || !done) return 0;
  // Never display 100% with a set still to do, even in a very large programme.
  return done >= total ? 100 : Math.min(99, Math.round((done / total) * 100));
}
function getSetVolume(set) {
  const reps = Number(set.r),
    weight = Number(set.w);
  return Number.isFinite(reps) &&
    Number.isFinite(weight) &&
    reps > 0 &&
    weight > 0
    ? reps * weight
    : 0;
}
function getWorkoutReport(day, startedAt, now = Date.now()) {
  let sets = 0,
    done = 0,
    exercises = 0,
    reps = 0,
    volume = 0;
  for (const ex of day.exs || []) {
    const rows = ex.sd || [];
    sets += rows.length;
    const completed = rows.filter((s) => s.done);
    if (completed.length) exercises++;
    for (const set of completed) {
      done++;
      const value = Number(set.r);
      if (Number.isFinite(value) && value > 0) reps += value;
      volume += getSetVolume(set);
    }
  }
  return {
    dayName: String(day.name || "Allenamento"),
    sets,
    done,
    exercises,
    reps,
    volume: Math.round(volume * 100) / 100,
    percent: getSetProgress(done, sets),
    seconds: Number.isFinite(startedAt)
      ? Math.max(0, Math.floor((now - startedAt) / 1000))
      : 0,
  };
}
// Deliberately illustrative reference masses, not specifications for real models.
// The same volume always produces the same "impossible removal" receipt.
const IMPOSSIBLE_CARGO = [
  {
    id: "suitcase",
    kg: 20,
    singular: "valigia da viaggio",
    plural: "valigie da viaggio",
    title: "Bagaglio fuori misura.",
    line: "Il bagaglio a mano ha appena cambiato categoria.",
  },
  {
    id: "penguin",
    kg: 50,
    singular: "pinguino gigante immaginario",
    plural: "pinguini giganti immaginari",
    title: "Il coinquilino arriva dal Polo.",
    line: "Ha portato il ghiaccio. Tu hai fatto il resto.",
  },
  {
    id: "arcade",
    kg: 100,
    singular: "cabinet arcade",
    plural: "cabinet arcade",
    title: "La sala giochi viene con te.",
    line: "Game over per il divano. Oggi si gioca in piedi.",
  },
  {
    id: "robot",
    kg: 200,
    singular: "robot da trasloco",
    plural: "robot da trasloco",
    title: "Hai spostato il traslocatore.",
    line: "Doveva aiutarti. Alla fine hai sollevato anche lui.",
  },
  {
    id: "piano",
    kg: 300,
    singular: "pianoforte",
    plural: "pianoforti",
    title: "Il concerto è al piano di sopra.",
    line: "Niente ascensore. Solo una serie dopo l’altra.",
  },
  {
    id: "bear",
    kg: 600,
    singular: "orso polare immaginario",
    plural: "orsi polari immaginari",
    title: "Ospite ingombrante, cuore tenero.",
    line: "Per il divano nuovo, forse serviva una misura in più.",
  },
  {
    id: "rover",
    kg: 900,
    singular: "rover lunare immaginario",
    plural: "rover lunari immaginari",
    title: "Parcheggio riservato sulla Luna.",
    line: "La consegna era dietro l’angolo. Di un altro pianeta.",
  },
  {
    id: "car",
    kg: 1200,
    singular: "piccola auto",
    plural: "piccole auto",
    title: "Il garage? Nel borsone.",
    line: "Il tuo volume di oggi ha bisogno di un parcheggio.",
  },
  {
    id: "rhino",
    kg: 2000,
    singular: "rinoceronte immaginario",
    plural: "rinoceronti immaginari",
    title: "Il citofono ha un corno.",
    line: "La consegna è arrivata. Il portone, un po’ meno.",
  },
  {
    id: "camper",
    kg: 3500,
    singular: "camper",
    plural: "camper",
    title: "La casa al mare viene con te.",
    line: "Ruote, cucina, letto. Stavolta hai portato proprio tutto.",
  },
  {
    id: "elephant",
    kg: 5000,
    singular: "elefante immaginario",
    plural: "elefanti immaginari",
    title: "La stanza ha un elefante.",
    line: "Questa volta non è un modo di dire. Almeno nel nostro gioco.",
  },
  {
    id: "dinosaur",
    kg: 7000,
    singular: "T-rex immaginario",
    plural: "T-rex immaginari",
    title: "Un T-rex sul pianerottolo.",
    line: "Il vicino ha chiesto se potevi fare un po’ meno rumore.",
  },
  {
    id: "bus",
    kg: 10000,
    singular: "autobus immaginario",
    plural: "autobus immaginari",
    title: "Tutti a bordo del tuo salotto.",
    line: "Hai spostato abbastanza volume per una gita di classe.",
  },
  {
    id: "ufo",
    kg: 15000,
    singular: "disco volante immaginario",
    plural: "dischi volanti immaginari",
    title: "Consegna da un’altra galassia.",
    line: "Anche gli alieni hanno chiesto chi fosse il tuo traslocatore.",
  },
  {
    id: "shuttle",
    kg: 22000,
    singular: "navetta spaziale immaginaria",
    plural: "navette spaziali immaginarie",
    title: "Il quartiere è troppo piccolo.",
    line: "La destinazione è sul navigatore. Molto, molto in alto.",
  },
  {
    id: "tram",
    kg: 30000,
    singular: "tram immaginario",
    plural: "tram immaginari",
    title: "Prossima fermata: il salotto.",
    line: "Per questa consegna, il citofono non basta.",
  },
  {
    id: "whale",
    kg: 50000,
    singular: "balena immaginaria",
    plural: "balene immaginarie",
    title: "La vasca non basterà.",
    line: "Il bagno nuovo aveva bisogno di un oceano, non di una doccia.",
  },
  {
    id: "castle",
    kg: 75000,
    singular: "castello giocattolo gigante",
    plural: "castelli giocattolo giganti",
    title: "Un castello, chiavi in mano.",
    line: "Il ponte levatoio era incluso nel trasloco.",
  },
  {
    id: "rocket",
    kg: 100000,
    singular: "razzo immaginario",
    plural: "razzi immaginari",
    title: "Consegna al piano… orbitale.",
    line: "Il trasloco ha ufficialmente lasciato il quartiere.",
  },
  {
    id: "station",
    kg: 200000,
    singular: "stazione orbitale immaginaria",
    plural: "stazioni orbitali immaginarie",
    title: "Il nuovo indirizzo è in orbita.",
    line: "Il postino non ha ancora trovato il parcheggio.",
  },
  {
    id: "moonbase",
    kg: 500000,
    singular: "base lunare immaginaria",
    plural: "basi lunari immaginarie",
    title: "Hai cambiato pianeta.",
    line: "Il trasloco impossibile ha trovato una nuova casa.",
  },
];
function getImpossibleCargo(volume) {
  if (!Number.isFinite(volume) || volume < IMPOSSIBLE_CARGO[0].kg) return null;
  const cargo = [...IMPOSSIBLE_CARGO]
    .reverse()
    .find((item) => volume >= item.kg);
  // Round down: never congratulate the user on a mass they have not logged.
  const count = Math.floor(volume / cargo.kg);
  return {
    ...cargo,
    level: IMPOSSIBLE_CARGO.indexOf(cargo) + 1,
    next: IMPOSSIBLE_CARGO[IMPOSSIBLE_CARGO.indexOf(cargo) + 1] || null,
    count,
    label: count === 1 ? cargo.singular : cargo.plural,
  };
}
function renderWorkoutReport(report) {
  const duration =
    Math.floor(report.seconds / 60) +
    ":" +
    String(report.seconds % 60).padStart(2, "0");
  document.getElementById("sesSumMsg").textContent = report.dayName;
  document.getElementById("sesSumGrid").innerHTML = `
    <div class="ses-sum-box"><div class="ses-sum-val">${duration}</div><div class="ses-sum-label">Durata</div></div>
    <div class="ses-sum-box"><div class="ses-sum-val">${report.exercises}</div><div class="ses-sum-label">Esercizi allenati</div></div>
    <div class="ses-sum-box"><div class="ses-sum-val">${report.done}</div><div class="ses-sum-label">Serie completate</div></div>
    <div class="ses-sum-box"><div class="ses-sum-val">${report.percent}%</div><div class="ses-sum-label">Della scheda</div></div>`;
  const cargo = getImpossibleCargo(report.volume);
  document.getElementById("sesVolumeReport").innerHTML = `
    <div class="volume-heading"><span class="eyebrow">IL VOLUME DI OGGI</span><span class="cargo-stamp">${report.done < report.sets ? "SESSIONE PARZIALE" : "SESSIONE COMPLETATA"}</span></div>
    <div class="volume-number"><strong id="sesVolumeValue">${formatGymNumber(report.volume, 2)}</strong><span>kg</span></div>
    <p class="volume-caption">${report.volume > 0 ? "Serie dopo serie, tutto questo si somma." : "Il tuo lavoro conta, anche senza carichi."}</p>
    <div class="cargo-art-panel" data-cargo="${cargo?.id || "starter"}"><div class="cargo-art-label"><span>IL TRASLOCO IMPOSSIBILE</span><span>${cargo ? "CARICO " + String(cargo.level).padStart(2, "0") + " / " + IMPOSSIBLE_CARGO.length : "IL TUO PRIMO PASSO"}</span></div>${renderCargoArt(cargo?.id || "starter")}</div>
    ${cargo ? `<div class="cargo-story"><h3>${cargo.title}</h3><p class="cargo-equivalence">Come spostare almeno <strong>${formatGymNumber(cargo.count, 0)} ${cargo.label}</strong>.</p><p class="cargo-line">${cargo.line}</p><p class="cargo-reference">Paragone giocoso: ${formatGymNumber(cargo.kg)} kg per ${cargo.singular}, come riferimento illustrativo. Il volume è cumulativo, non un’alzata singola.</p></div>` : `<div class="cargo-story"><h3>${report.volume === 0 ? "Non tutto si misura in chili." : "Ogni chilo ha il suo posto."}</h3><p class="cargo-line">${report.volume === 0 ? "Hai registrato " + formatGymNumber(report.reps) + " ripetizioni. Il corpo libero e le serie senza carico restano parte del tuo allenamento." : "Niente paragoni forzati. Hai registrato il tuo lavoro, una ripetizione alla volta."}</p></div>`}
    <details class="cargo-collection"><summary>Esplora i ${IMPOSSIBLE_CARGO.length} carichi impossibili</summary><p class="cargo-map-note">Un atlante di fantasia, non obiettivi da inseguire aggiungendo serie. Segui sempre la tua scheda.</p><ol>${IMPOSSIBLE_CARGO.map((item, i) => `<li class="${item.id === cargo?.id ? "current-cargo" : ""}"><span class="cargo-map-index">${String(i + 1).padStart(2, "0")}</span><span>${item.singular}${item.id === cargo?.id ? "<small>Il tuo carico di oggi</small>" : ""}</span><strong>${formatGymNumber(item.kg)} kg</strong></li>`).join("")}</ol></details>
    <details class="volume-method"><summary>Come vengono calcolati i kg?</summary><p>Somma di ripetizioni × carico inserito, solo per le serie completate. Serie non fatte e carico zero non aggiungono kg.</p><p>Con i manubri usiamo il valore che registri: non raddoppiamo automaticamente il carico né le ripetizioni per lato. Il peso corporeo non è stimato. Questa è una misura del volume registrato, non del lavoro meccanico.</p></details>`;
  document.getElementById("sesSummaryTitle").textContent =
    report.done < report.sets
      ? "Anche oggi, un passo avanti."
      : "Allenamento concluso.";
  document.getElementById("sesSummary").style.display = "flex";
  document.getElementById("sesSummary").scrollTop = 0;
  document.getElementById("sesSummaryTitle").focus({ preventScroll: true });
}
function renderSessionProgress(done, total) {
  const percent = getSetProgress(done, total);
  document.getElementById("sesExCount").textContent = percent + "%";
  document.getElementById("sesProgressCaption").textContent =
    `${done} di ${total} serie completate`;
  document.getElementById("sesProgFill").style.width = percent + "%";
  const bar = document.getElementById("sessionProgress");
  bar.setAttribute("aria-valuenow", percent);
  bar.setAttribute(
    "aria-valuetext",
    `${percent}% · ${done} di ${total} serie completate`,
  );
}
function sesAdjWeight(direction) {
  const exercise = D && curDay ? gD()?.exs[sesExIdx] : null;
  sesAdj("sesKg", Math.sign(direction) * getWeightStep(exercise));
}
function renderWeightControls(exercise) {
  const step = formatGymNumber(getWeightStep(exercise));
  document.getElementById("sesWeightStep").textContent =
    `${isDumbbellExercise(exercise) ? "Manubri" : "Carico"} · passi di ${step} kg`;
  document.querySelectorAll("#sesKg").forEach((input) => {
    input.parentElement.querySelectorAll("button").forEach((button) => {
      button.setAttribute(
        "aria-label",
        `${button.textContent.trim() === "+" ? "Aumenta" : "Riduci"} carico di ${step} kg`,
      );
    });
  });
}
