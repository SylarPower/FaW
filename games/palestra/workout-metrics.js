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
    const completed = rows.filter((s) => s.done && !s.skipped);
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

  const status =
    report.done < report.sets ? "SESSIONE PARZIALE" : "SESSIONE COMPLETATA";
  const caption =
    report.volume > 0
      ? "Somma di ripetizioni × carico registrato, sulle serie completate."
      : report.reps > 0
        ? `${formatGymNumber(report.reps, 0)} ripetizioni completate senza carico registrato; non convertite in kg.`
        : "Nessun volume in kg registrato.";
  document.getElementById("sesVolumeReport").innerHTML = `
    <div class="volume-heading"><span class="eyebrow">VOLUME REGISTRATO</span><span class="session-status">${status}</span></div>
    <div class="volume-number"><strong id="sesVolumeValue">${formatGymNumber(report.volume, 2)}</strong><span>kg</span></div>
    <p class="volume-caption">${caption}</p>
    <details class="volume-method"><summary>Come vengono calcolati i kg?</summary><p>Somma di ripetizioni × carico inserito, solo per le serie completate. Serie non completate e carico zero non aggiungono kg.</p><p>Per i manubri usiamo il valore che registri: non raddoppiamo automaticamente il carico né le ripetizioni per lato. Il peso corporeo non è stimato. È una misura del volume registrato, non del lavoro meccanico.</p></details>`;
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
