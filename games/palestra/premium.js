/* UX and resilient local-first persistence. Existing Firestore schema remains compatible. */
"use strict";
const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const cacheKey = "gym-data-v2:" + MIO;
let localRevision = 0,
  pendingSave = false,
  saveFlight = null,
  cloudReady = false,
  baseline = null;
let selectedSetIdx = null,
  sessionFinalized = false,
  dayEditing = false,
  gymTab = "today";
let storedEnvelope = null,
  storageOK = true;
try {
  storedEnvelope = JSON.parse(localStorage.getItem(cacheKey) || "null");
} catch (_) {
  /* Invalid cache is never sent to the cloud. */
}
function setSaveStatus(text, state = "") {
  const el = document.getElementById("saveStatus");
  el.textContent = text;
  el.dataset.state = state;
  const sessionStatus = document.getElementById("sessionSaveStatus");
  if (sessionStatus) sessionStatus.textContent = text;
  if (state === "error" || state === "pending") {
    const button = document.createElement("button");
    button.textContent = "Riprova";
    button.onclick = retrySync;
    el.append(button);
  }
}
function normalizeData(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.days))
    throw new Error("Formato dei dati non valido. Nessun dato sovrascritto.");
  data.hist = Array.isArray(data.hist) ? data.hist : [];
  data.sessionFeedback = Array.isArray(data.sessionFeedback) ? data.sessionFeedback : [];
  data.st = { ...dSt(), ...data.st };
  data.days.forEach((day) => {
    day.exs = Array.isArray(day.exs) ? day.exs : [];
    day.exs.forEach((ex) => {
      ex.sd = Array.isArray(ex.sd) ? ex.sd : [];
      ex.sd.forEach((set) => {
        delete set.rpe;
      });
    });
  });
  data.hist.forEach((entry) => {
    delete entry.rpe;
    (entry.sd || []).forEach((set) => {
      delete set.rpe;
    });
  });
  return data;
}
function localSnapshot() {
  try {
    localStorage.setItem(
      cacheKey,
      JSON.stringify({ data: D, pending: pendingSave, baseline }),
    );
    storageOK = true;
    return true;
  } catch (error) {
    storageOK = false;
    setSaveStatus(
      "Memoria locale non disponibile. Non chiudere la pagina.",
      "error",
    );
    return false;
  }
}
function cloudDoc() {
  return db.collection("gym_users").doc(MIO);
}
async function readCloud() {
  if (!db || !navigator.onLine) throw new Error("Connessione non disponibile");
  let timeout;
  try {
    return await Promise.race([
      cloudDoc().get({ source: "server" }),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Connessione lenta")),
          7000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
async function load() {
  let cached = null;
  try {
    if (storedEnvelope?.data) cached = normalizeData(storedEnvelope.data);
  } catch (_) {
    cached = null;
  }
  if (cached) {
    D = cached;
    baseline = storedEnvelope.baseline ?? null;
    pendingSave = !!storedEnvelope.pending;
    setSaveStatus(
      pendingSave
        ? "Salvato sul dispositivo · da sincronizzare"
        : "Copia sul dispositivo",
      "pending",
    );
    // Do not block the workout while waiting for a slow network.
    retrySync();
    return;
  }
  try {
    const doc = await readCloud();
    D = doc.exists
      ? normalizeData(doc.data())
      : { days: [], hist: [], st: dSt() };
    baseline = doc.exists ? JSON.stringify(doc.data()) : null;
    cloudReady = true;
    localSnapshot();
    setSaveStatus("Sincronizzato");
  } catch (error) {
    // Crucial: no empty fallback that can overwrite the user's real program.
    throw new Error(
      "Non riesco a caricare la tua scheda. Controlla la connessione e riprova. I dati esistenti non sono stati modificati.",
    );
  }
}
async function retrySync() {
  if (!D || saveFlight) return;
  setSaveStatus("Verifica sincronizzazione…");
  try {
    const doc = await readCloud();
    const remote = doc.exists ? JSON.stringify(doc.data()) : null;
    if (pendingSave && remote !== baseline && remote !== JSON.stringify(D)) {
      cloudReady = false;
      setSaveStatus(
        "Dati diversi nel cloud · scegli quale copia tenere",
        "conflict",
      );
      const button = document.createElement("button");
      button.textContent = "Verifica";
      button.onclick = () =>
        showSyncConflict(doc.exists ? doc.data() : null, remote);
      document.getElementById("saveStatus").append(button);
      return;
    }
    if (!pendingSave && remote !== baseline && remote) {
      // Never swap the program underneath an active workout/form.
      if (sesActive || curDay || gymTab === "plan") {
        cloudReady = false;
        setSaveStatus(
          "Aggiornamenti cloud disponibili · torna ad Allenamento",
          "pending",
        );
        return;
      }
      D = normalizeData(JSON.parse(remote));
      renderAll();
    }
    baseline = remote;
    cloudReady = true;
    localSnapshot();
    if (pendingSave) flushSave();
    else setSaveStatus("Sincronizzato");
  } catch (_) {
    cloudReady = false;
    setSaveStatus("Salvato sul dispositivo · cloud non disponibile", "pending");
  }
}
function showSyncConflict(remoteData, remote) {
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.style.display = "flex";
  modal.innerHTML =
    '<div class="mc"><h2>Due copie della tua scheda</h2><p class="muted">Il cloud è cambiato rispetto alla copia su questo dispositivo. Prima di sostituire una copia puoi esportare le tue schede da Schede → Esporta tutto.</p><button data-choice="local">Mantieni questo dispositivo</button><button data-choice="cloud">Usa la copia cloud</button><button data-choice="cancel">Decidi più tardi</button></div>';
  modal.addEventListener("click", (event) => {
    const choice = event.target.dataset.choice;
    if (!choice) return;
    if (choice === "cancel") {
      modal.remove();
      return;
    }
    if (sesActive) {
      toast("Chiudi prima la sessione, senza perdere i progressi.", "warn");
      return;
    }
    if (
      !confirm(
        "Sostituire la copia " +
          (choice === "local"
            ? "cloud con quella di questo dispositivo?"
            : "di questo dispositivo con quella cloud?"),
      )
    )
      return;
    if (choice === "cloud" && !remoteData) {
      toast("La copia cloud è vuota. Conserva i dati locali.", "warn");
      return;
    }
    baseline = remote;
    cloudReady = true;
    if (choice === "cloud") {
      D = normalizeData(remoteData);
      pendingSave = false;
      localSnapshot();
      goHome();
      setSaveStatus("Sincronizzato");
    } else {
      pendingSave = true;
      flushSave();
    }
    modal.remove();
  });
  document.body.append(modal);
}
function save() {
  if (!D) return Promise.resolve(false);
  localRevision++;
  pendingSave = true;
  const localOK = localSnapshot();
  if (localOK) setSaveStatus("Salvato sul dispositivo · sincronizzazione…");
  if (cloudReady && navigator.onLine) flushSave();
  else if (localOK)
    setSaveStatus("Salvato sul dispositivo · da sincronizzare", "pending");
  return Promise.resolve(localOK);
}
function flushSave() {
  if (saveFlight || !pendingSave || !cloudReady || !db) return;
  const revision = localRevision;
  const snapshot = JSON.stringify(D); // Immutable snapshot; edits during a request queue the next write.
  saveFlight = cloudDoc()
    .set(JSON.parse(snapshot))
    .then(() => {
      baseline = snapshot;
      if (revision === localRevision) pendingSave = false;
      localSnapshot();
      if (storageOK)
        setSaveStatus(pendingSave ? "Sincronizzazione…" : "Sincronizzato");
    })
    .catch((error) => {
      console.warn("Cloud save:", error);
      cloudReady = false;
      setSaveStatus(
        storageOK
          ? "Salvato sul dispositivo · da sincronizzare"
          : "Salvataggio non riuscito. Non chiudere la pagina.",
        storageOK ? "pending" : "error",
      );
    })
    .finally(() => {
      saveFlight = null;
      if (pendingSave && cloudReady) flushSave();
    });
}
window.addEventListener("online", retrySync);
window.addEventListener("offline", () => {
  cloudReady = false;
  if (D)
    setSaveStatus(
      storageOK
        ? "Offline · progressi sul dispositivo"
        : "Offline · salvataggio non disponibile",
      storageOK ? "pending" : "error",
    );
});
window.addEventListener("pagehide", () => {
  persistSessionInputs();
  if (D) localSnapshot();
});
window.addEventListener("beforeunload", (event) => {
  if (!storageOK && pendingSave) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("storage", (event) => {
  if (event.key === cacheKey && D) {
    cloudReady = false;
    setSaveStatus(
      "Scheda aperta in un’altra finestra. Usa una sola finestra.",
      "error",
    );
  }
});
function dayCounts(day) {
  return {
    sets: day.exs.reduce((a, e) => a + e.sd.length, 0),
    done: day.exs.reduce((a, e) => a + e.sd.filter((s) => s.done && !s.skipped).length, 0),
  };
}
function showGymTab(tab) {
  if (!D || sesActive) return;
  gymTab = ["today", "plan", "progress"].includes(tab) ? tab : "today";
  curDay = null;
  document.getElementById("vDay").style.display = "none";
  document.getElementById("vHome").style.display = "block";
  ["Today", "Plan", "Progress"].forEach((name) => {
    document.getElementById("home" + name).hidden =
      name.toLowerCase() !== gymTab;
  });
  document.querySelectorAll("[data-tab]").forEach((button) => {
    if (button.dataset.tab === gymTab)
      button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  renderAll();
  window.scrollTo(0, 0);
}
const legacyRenderAll = renderAll;
renderAll = function () {
  legacyRenderAll();
  renderHomePremium();
};
const legacyRenDays = renDays;
renDays = function () {
  legacyRenDays();
  renderHomePremium();
};
const legacyGoHome = goHome;
goHome = function () {
  legacyGoHome();
  showGymTab("today");
};
const legacyGoDay = goDay;
goDay = function (id) {
  if (!D.days.some((day) => day.id === id)) return;
  dayEditing = false;
  legacyGoDay(id);
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) => b.removeAttribute("aria-current"));
  window.scrollTo(0, 0);
};
function renderHomePremium() {
  if (!D) return;
  const installCard = document.getElementById("personalProgramCard");
  if (installCard)
    installCard.hidden = D.st?.personalProgramVersion === PERSONAL_PROGRAM_VERSION;
  document.getElementById("todayDate").textContent = new Intl.DateTimeFormat(
    "it",
    { weekday: "long", day: "numeric", month: "long" },
  ).format(new Date());
  const activeDay = D.days.find((d) => d.id === D.activeSession?.dayId);
  const partial = activeDay || D.days.find((d) => dayCounts(d).done > 0);
  const personalDays = typeof getPersonalDayList === "function" ? getPersonalDayList() : [];
  const cycle = typeof getPersonalCycleState === "function" ? getPersonalCycleState() : null;
  const cursor = Number(D.st?.nextPersonalDayIndex) || 0;
  const scheduled =
    (cycle && cycle.day) ||
    (personalDays.length ? personalDays[cursor % personalDays.length] : null);
  const restStatus = typeof getPersonalRestStatus === "function" ? getPersonalRestStatus() : null;
  const next =
    partial ||
    scheduled ||
    D.days.find((d) => d.exs.length && !isDoneThisWeek(d.id)) ||
    D.days.find((d) => d.exs.length) ||
    D.days[0];
  const hero = document.getElementById("todayHero");
  if (restStatus && !partial) {
    hero.innerHTML = `<article class="hero-card rest-day-card"><span class="hero-label">RECUPERO PROGRAMMATO</span><h3>Giorno di riposo.</h3><p>${escapeHTML(restStatus.message)}</p><p class="muted">Il ciclo personale riprenderà con Gambe Final. La sequenza resta invariata.</p></article>`;
  } else if (next) {
    const count = dayCounts(next);
    const cycleCfg = PERSONAL_PROGRAM_CONFIG;
    const heroCycle =
      cycle && next.personalProgramVersion
        ? `<p class="hero-cycle${cycle.isDeload ? " hero-cycle-deload" : ""}">Sessione ${cycle.sessionNumber} · ${cycle.isDeload
            ? `DELOAD ${cycleCfg.deloadSessions - cycle.deloadSessionsLeft + 1}/${cycleCfg.deloadSessions}: −40% di carico, −1 serie, nessun drop set`
            : `normale · deload tra ${cycle.sessionsToDeload} ${cycle.sessionsToDeload === 1 ? "sessione" : "sessioni"}`}</p>`
        : "";
    hero.innerHTML = `<article class="hero-card"><div class="hero-top"><span class="hero-label">${partial ? "Da dove eri rimasto" : "Il prossimo passo"}</span><span class="hero-tag${cycle && next.personalProgramVersion && cycle.isDeload ? " hero-tag-deload" : ""}">${partial ? "In corso" : "La tua scheda"}</span></div><h3>${escapeHTML(next.name)}</h3><p>${partial ? `${count.done} di ${count.sets} serie completate. Riparti da qui.` : "Tutto pronto. Prenditi questo tempo per te."}</p>${heroCycle}<div class="hero-meta"><div><strong>${next.exs.length}</strong><span>Esercizi</span></div><div><strong>${count.sets}</strong><span>Serie previste</span></div><div><strong>${count.sets ? Math.round((count.done / count.sets) * 100) : 0}%</strong><span>Completato</span></div></div><button class="bp" id="heroStart">${partial ? "Riprendi allenamento" : "Apri la scheda"} <span aria-hidden="true">→</span></button></article>`;
    document.getElementById("heroStart").onclick = () => {
      goDay(next.id);
      if (partial) launchSession();
    };
  } else {
    hero.innerHTML =
      '<article class="hero-card"><span class="hero-label">Il tuo primo passo</span><h3>Si comincia da una scheda.</h3><p>Crea la tua giornata, importa una scheda o aggiungi il programma personale.</p><button class="bp full-width" onclick="showGymTab(\'plan\')">Apri le schede <span>→</span></button><button class="text-button" onclick="openImport()">Ho già una scheda da importare →</button></article>';
  }
  const quick = document.getElementById("quickDays");
  quick.replaceChildren();
  D.days.forEach((day, i) => {
    const c = dayCounts(day);
    const button = document.createElement("button");
    button.className = "quick-day";
    button.innerHTML = `<span class="day-number">${String(i + 1).padStart(2, "0")}</span><span class="quick-day-info"><strong>${escapeHTML(day.name)}</strong><small>${day.exs.length} esercizi · ${c.sets} serie${c.done ? " · " + c.done + " fatte" : isDoneThisWeek(day.id) ? " · Allenata questa settimana" : ""}</small></span><span class="arrow" aria-hidden="true">↗</span>`;
    button.onclick = () => goDay(day.id);
    quick.append(button);
  });
  if (!D.days.length)
    quick.innerHTML = '<p class="muted">Le tue giornate appariranno qui.</p>';
  const sessions = sessionHistory();
  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const weekly = sessions.filter(
    (s) => new Date(s.dt) >= monday && new Date(s.dt) <= new Date(),
  ).length;
  document.getElementById("weekStrip").innerHTML =
    `<strong>${weekly}</strong><span>allenament${weekly === 1 ? "o" : "i"} questa settimana.<br>Ogni sessione conta.</span>`;
  const cycleTile =
    typeof getPersonalCycleState === "function"
      ? getPersonalCycleState()
      : null;
  document.getElementById("progressStats").innerHTML =
    `<div class="stat-tile"><strong>${D.st.tw || sessions.length}</strong><span>Allenamenti totali</span></div><div class="stat-tile"><strong>${D.st.ts || 0}</strong><span>Serie completate</span></div>${
      cycleTile
        ? `<div class="stat-tile"><strong>${cycleTile.sessionNumber}</strong><span>Sessione del ciclo</span></div><div class="stat-tile${cycleTile.isDeload ? " stat-tile-deload" : ""}"><strong>${
            cycleTile.isDeload ? "DELOAD" : cycleTile.sessionsToDeload
          }</strong><span>${
            cycleTile.isDeload
              ? `fine alla sessione ${cycleTile.lastDeloadSessionNumber}`
              : `sessioni al deload`
          }</span></div>`
        : ""
    }`;
  document.getElementById("recentSessions").innerHTML = sessions.length
    ? sessions
        .slice(0, 20)
        .map(
          (session) =>
            `<article class="history-item"><strong>${escapeHTML(D.days.find((d) => d.id === session.dayId)?.name || "Allenamento")}</strong><p>${new Intl.DateTimeFormat("it", { day: "numeric", month: "short", year: "numeric" }).format(new Date(session.dt))} · ${session.exercises} esercizi · ${session.sets} serie${session.volumeKnown ? " · " + formatGymNumber(session.volumeKg, 2) + " kg di volume" : ""}${session.duration ? " · " + Math.max(1, Math.round(session.duration / 60)) + " min" : ""}${session.rpe ? ` · RPE ${session.rpe}/10 · gomito ${{ none: "no", mild: "lieve", yes: "sì" }[session.elbow] || "—"} · ginocchio ${{ none: "no", mild: "lieve", yes: "sì" }[session.knee] || "—"}` : ""}${session.note ? ` · ${escapeHTML(session.note)}` : ""}</p></article>`,
        )
        .join("")
    : '<div class="card"><h3>La tua storia inizia qui.</h3><p class="muted">Completa un allenamento per ritrovare qui il tuo lavoro.</p></div>';
}
function sessionHistory() {
  const groups = new Map();
  D.hist.forEach((h) => {
    if (!h.dt || !Number.isFinite(new Date(h.dt).getTime())) return;
    const key = h.sessionId || h.dayId + ":" + h.dt.slice(0, 16);
    if (!groups.has(key))
      groups.set(key, {
        dt: h.dt,
        dayId: h.dayId,
        exercises: 0,
        sets: 0,
        duration: h.duration,
        volumeKg: 0,
        volumeKnown: true,
      });
    const entry = groups.get(key);
    entry.exercises++;
    entry.sets += Number(h.s) || 0;
    if (
      typeof h.volumeKg === "number" &&
      Number.isFinite(h.volumeKg) &&
      h.volumeKg >= 0
    )
      entry.volumeKg += h.volumeKg;
    else entry.volumeKnown = false;
  });
  const feedbackById = new Map((D.sessionFeedback || []).map((entry) => [entry.sessionId, entry]));
  return [...groups.entries()].map(([key, entry]) => {
    const feedback = feedbackById.get(key);
    return feedback ? { ...entry, rpe: feedback.rpe, elbow: feedback.elbow, knee: feedback.knee, note: feedback.note } : entry;
  }).sort((a, b) => new Date(b.dt) - new Date(a.dt));
}
const legacyRenDay = renDay;
renDay = function () {
  legacyRenDay();
  renderDayPremium();
};
function toggleDayEdit() {
  dayEditing = !dayEditing;
  renderDayPremium();
}
function renderDayPremium() {
  const day = gD();
  if (!day) return;
  const count = dayCounts(day);
  document.getElementById("dayMeta").textContent =
    `${day.exs.length} esercizi · ${count.sets} serie${count.done ? " · " + count.done + " completate" : ""}`;
  document.getElementById("dayStartBtn").innerHTML =
    (count.done ? "Riprendi allenamento" : "Inizia allenamento") +
    ' <span aria-hidden="true">→</span>';
  document.getElementById("dayStartBtn").disabled = !count.sets;
  document.getElementById("dayEditor").hidden = !dayEditing;
  document.getElementById("dayOutline").hidden = dayEditing;
  const edit = document.getElementById("editDayBtn");
  edit.textContent = dayEditing ? "Fine modifiche" : "Modifica scheda";
  edit.setAttribute("aria-pressed", dayEditing);
  document.getElementById("dayOutline").innerHTML = day.exs.length
    ? day.exs
        .map((ex, i) => {
          const done = ex.sd.filter((s) => s.done).length;
          const def = exDef(ex.exerciseId);
          const reps = [...new Set(ex.sd.map((s) => s.r).filter(Boolean))].join(
            " / ",
          );
          const range = ex.progression ? formatRepTarget(ex) : "";
          const loads = [...new Set(ex.sd.map((set) => Number(set.w) || 0))];
          const loadLabel = loads.map((load) => load > 0 ? `${formatGymNumber(load, 2)} kg` : "corpo libero").join(" / ");
          const step = Number(ex.progression?.stepKg) || 0;
          const progressStatus = ex.progression ? getProgressionStatus(ex, day.id) : null;
          const ramp = ex.rampUp?.length
            ? getRampUpForLoad(ex, ex.sd?.[0]?.w).map((set) => `${formatGymNumber(set.w, 2)} kg × ${set.r} (${set.rest}s)`).join(" → ")
            : "";
          const plateau = day.personalProgramVersion ? getPlateauStatus(ex, day.id) : null;
          const painStreak = ex.safetyJoint ? getJointDiscomfortStreak(ex.safetyJoint) : 0;
          const safetyTrigger = painStreak >= 3
            ? `<small class="safety-warning">3 sessioni consecutive con fastidio: sospendi e valuta ${escapeHTML(ex.progression?.alternative || (ex.safetyJoint === "elbow" ? "una variante a presa neutra" : "una variante senza dolore"))}.</small>`
            : "";
          const dropSetControl = "";
          return `<article class="outline-ex"><span class="outline-number">${done === ex.sd.length && done ? "✓" : String(i + 1).padStart(2, "0")}</span><div><h4>${escapeHTML(ex.name)}</h4><p>${ex.sd.length} serie${reps ? " × " + escapeHTML(reps) + (ex.unit === "sec" ? " s" : " rip.") : ""} · ${escapeHTML(loadLabel)}${range ? ` · range ${escapeHTML(range)}${step > 0 ? ` · step +${formatGymNumber(step, 2)} kg` : ` · solo ${ex.progression.progressionType === "time" ? "tempo" : "ripetizioni"}`}` : ""}${ex.rest ? " · Recupero " + escapeHTML(ex.rest) + "s" : ""}</p><p>${escapeHTML(def?.eq || "")}${done ? " · " + done + "/" + ex.sd.length + " fatte" : ""}</p>${progressStatus ? `<small class="progression-status ${progressStatus.ready ? "ready" : ""}">${escapeHTML(progressStatus.text)}</small>` : ""}${ramp ? `<small>Ramp-up: ${escapeHTML(ramp)}</small>` : ""}${ex.ssG ? "<small>Superserie · esercizi alternati</small>" : ""}${ex.dropSet ? `<small>Drop set finale −${Math.round(ex.dropSet.reduction * 100)}% · ${ex.dropSet.reps[0]}–${ex.dropSet.reps[1]} rep</small>` : ""}${plateau ? `<small class="safety-warning">${escapeHTML(plateau)}</small>` : ""}${safetyTrigger}${dropSetControl}${ex.note ? '<small class="note">' + escapeHTML(ex.note) + "</small>" : ""}</div></article>`;
        })
        .join("")
    : '<div class="card"><h3>La tua scheda è pronta da costruire.</h3><p class="muted">Aggiungi il primo esercizio, poi imposta serie e recupero.</p><button class="bp full-width" onclick="dayEditing=true;renderDayPremium();openSel()">+ Aggiungi esercizio</button></div>';
  if (day.personalProgramVersion) {
    const messages = getProgramPolicyMessages(day);
    const policy = document.createElement("section");
    policy.className =
      "card program-policy" +
      (typeof getPersonalCycleState === "function" && getPersonalCycleState().isDeload
        ? " program-policy-deload"
        : "");
    policy.setAttribute("aria-label", "Regole del programma personale");
    policy.innerHTML = `<h3>Progressione e recupero</h3>${messages.map((message) => `<p>${escapeHTML(message)}</p>`).join("")}`;
    document.getElementById("dayOutline").prepend(policy);
  }
}
function validateSessionInputs() {
  const rules = [
    ["sesReps", 1, 999, true],
    ["sesKg", 0, 9999, false],
  ];
  for (const [id, min, max, integer] of rules) {
    const input = document.getElementById(id),
      value = input.value.trim();
    const number = Number(value.replace(",", "."));
    const optional = id !== "sesReps" && value === "";
    const invalid =
      !optional &&
      (value === "" ||
        !Number.isFinite(number) ||
        number < min ||
        number > max ||
        (integer && !Number.isInteger(number)));
    input.setAttribute("aria-invalid", invalid);
    if (invalid) {
      toast(
        id === "sesKg"
          ? "Inserisci un carico valido, anche 0 kg."
          : "Inserisci le ripetizioni, da 1 a 999.",
        "warn",
      );
      input.focus();
      return false;
    }
  }
  return true;
}
function persistSessionInputs() {
  if (
    !sesActive ||
    sessionFinalized ||
    document.getElementById("sesSetArea").style.display === "none"
  )
    return;
  const ex = gD()?.exs[sesExIdx];
  if (!ex?.sd.length) return;
  const set = ex.sd[sesGetCurrentSetIdx(ex)];
  if (!set) return;
  const values = [
    ["sesReps", "r", 999],
    ["sesKg", "w", 9999],
  ];
  let changed = false;
  values.forEach(([id, key, max]) => {
    const raw = document.getElementById(id).value;
    const value = raw === "" ? 0 : Number(raw.replace(",", "."));
    if (Number.isFinite(value)) {
      if (
        value >= 0 &&
        value <= max &&
        (key === "w" || Number.isInteger(value)) &&
        set[key] !== value
      ) {
        set[key] = value;
        changed = true;
      }
    }
  });
  if (changed) save();
}
["sesReps", "sesKg"].forEach((id) =>
  document.getElementById(id).addEventListener("input", persistSessionInputs),
);
const legacySesAdj = sesAdj;
sesAdj = function (id, delta) {
  legacySesAdj(id, delta);
  persistSessionInputs();
};
const legacyExitSession = exitSession;
exitSession = function () {
  persistSessionInputs();
  legacyExitSession();
};
const legacySesRender = sesRender;
sesRender = function () {
  legacySesRender();
  const day = gD();
  if (!day) return;
  const ex = day.exs[sesExIdx];
  renderWeightControls(ex);
  const repsLabel = document.getElementById("sesRepsLabel");
  if (repsLabel) repsLabel.textContent = ex.unit === "sec" ? "Durata · secondi" : "Ripetizioni";
  const repsOnly = ex.unit === "sec" || ["reps", "time"].includes(ex.progression?.progressionType);
  const kgGroup = document.getElementById("sesKg")?.closest(".ses-input-group");
  if (kgGroup) kgGroup.hidden = repsOnly;
  const stepHint = document.getElementById("sesWeightStep");
  if (stepHint) stepHint.hidden = repsOnly;
  const rampInfo = document.getElementById("sesRampUpInfo");
  if (rampInfo) {
    const rampSets = ex.rampUp?.length ? getRampUpForLoad(ex, ex.sd?.[0]?.w) : [];
    rampInfo.hidden = rampSets.length === 0;
    if (rampSets.length) {
      const adjusted = D.activeSession?.isDeload ? " · carichi ricalcolati sul deload" : D.activeSession?.inactivityAdjusted ? " · rientro −10%" : "";
      rampInfo.innerHTML = `<strong>Ramp-up${adjusted}</strong><br>${rampSets.map((set, i) => `${i + 1}. ${formatGymNumber(set.w, 2)} kg × ${set.r} · recupero ${set.rest} s`).join("<br>")}`;
    }
  }
  const safety = document.getElementById("sesSafetyNotice");
  const stopButton = document.getElementById("sesPainStop");
  const checkButton = document.getElementById("sesCheckBtn");
  const jointStreak = ex.safetyJoint ? getJointDiscomfortStreak(ex.safetyJoint) : 0;
  const repeatedPain = jointStreak >= 3;
  if (safety) {
    safety.hidden = !ex.safetyJoint && !repeatedPain;
    safety.textContent = repeatedPain
      ? `Tre sessioni consecutive con fastidio ${ex.safetyJoint === "elbow" ? "al gomito" : "al ginocchio"}: esercizio sospeso. Salta le serie e valuta una variante sicura.`
      : ex.safetyJoint === "elbow"
        ? "⚠️ Gomito: presa neutra/semiprona dove possibile. Interrompi subito se compare anche un lieve fastidio. Aumenta il carico solo dopo 2 sessioni consecutive senza fastidio."
        : ex.safetyJoint === "knee"
          ? "⚠️ Ginocchio: interrompi subito se compare dolore. Aumenta il carico solo dopo 2 sessioni consecutive senza fastidio."
          : "";
  }
  if (stopButton) {
    stopButton.hidden = !ex.safetyJoint && !repeatedPain;
    stopButton.textContent = repeatedPain ? "Sospendi e salta questo esercizio" : "Segnala fastidio e interrompi questo esercizio";
    stopButton.onclick = repeatedPain ? skipExerciseForSafety : stopExerciseForJointPain;
  }
  if (checkButton) {
    checkButton.disabled = repeatedPain || Date.now() < sesConfirmUntil;
    if (repeatedPain) checkButton.setAttribute("aria-label", "Esercizio sospeso dopo tre sessioni con fastidio");
    else checkButton.removeAttribute("aria-label");
  }
  const currentSet = ex.sd?.[sesGetCurrentSetIdx(ex)];
  const dropInfo = document.getElementById("sesDropSetInfo");
  if (dropInfo) {
    dropInfo.hidden = !currentSet?.isDropSet;
    if (currentSet?.isDropSet) {
      dropInfo.innerHTML = `<strong>Drop set finale</strong><br>−${Math.round((ex.dropSet?.reduction || 0.3) * 100)}% rispetto all’ultimo set · obiettivo ${ex.dropSet?.reps?.[0] || 8}–${ex.dropSet?.reps?.[1] || 10} ripetizioni · senza pausa.`;
    }
  }
  if (currentSet?.isDropSet) {
    document.getElementById("sesSetLabel").textContent = `DROP SET · ${sesGetCurrentSetIdx(ex) + 1}/${ex.sd.length}`;
  }
  document
    .getElementById("sesTimerToggle")
    .setAttribute("aria-pressed", sesTimerEnabled);
  document.getElementById("sesExDone").innerHTML =
    `<div class="ses-ex-done-text">${day.exs[sesExIdx]?.sd.length ? "Tutte le serie completate." : "Nessuna serie prevista."}</div><p class="muted">${day.exs[sesExIdx]?.sd.length ? "Tocca una serie per correggerla, oppure passa al prossimo esercizio." : "Passa al prossimo esercizio. Puoi aggiungere serie da Modifica scheda."}</p><button class="bp full-width" onclick="openSessionList()">Scegli il prossimo esercizio →</button>`;
};
const legacyUpdateTimerUI = updateTimerToggleUI;
updateTimerToggleUI = function () {
  legacyUpdateTimerUI();
  document
    .getElementById("sesTimerToggle")
    .setAttribute("aria-pressed", sesTimerEnabled);
  if (!sesTimerEnabled) skipRestTimer();
};
function openSessionList() {
  persistSessionInputs();
  const list = document.getElementById("sessionList");
  list.replaceChildren();
  gD().exs.forEach((ex, i) => {
    const done = ex.sd.filter((s) => s.done).length;
    const button = document.createElement("button");
    button.className = "quick-day";
    button.innerHTML = `<span class="day-number">${i + 1}</span><span class="quick-day-info"><strong>${escapeHTML(ex.name)}</strong><small>${done}/${ex.sd.length} serie completate${i === sesExIdx ? " · Attuale" : ""}</small></span><span aria-hidden="true">→</span>`;
    button.onclick = () => {
      selectedSetIdx = null;
      sesExIdx = i;
      sesLastExIdx = -1;
      sesRender();
      closeSessionList();
    };
    list.append(button);
  });
  document.getElementById("mSessionList").style.display = "flex";
}
function closeSessionList() {
  document.getElementById("mSessionList").style.display = "none";
}
// Keep focus inside every bottom sheet and return it to its trigger, including legacy dialogs.
const dialogFocus = new Map();
let activeDialogs = [];
function syncDialogs() {
  const visible = [...document.querySelectorAll(".modal, #sesTimer")].filter(
    (el) => getComputedStyle(el).display !== "none",
  );
  for (const modal of visible) {
    if (dialogFocus.has(modal)) continue;
    dialogFocus.set(modal, document.activeElement);
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute(
      "aria-label",
      modal.querySelector("h2")?.textContent || "Recupero",
    );
    const target = modal.querySelector("input, button, textarea, select");
    if (target) target.focus({ preventScroll: true });
  }
  for (const [modal, previous] of dialogFocus) {
    if (visible.includes(modal)) continue;
    dialogFocus.delete(modal);
    if (previous?.isConnected && previous.getClientRects().length)
      previous.focus({ preventScroll: true });
  }
  activeDialogs = visible;
  document.body.classList.toggle("dialog-open", visible.length > 0);
}
new MutationObserver(syncDialogs).observe(document.body, {
  attributes: true,
  attributeFilter: ["style"],
  childList: true,
  subtree: true,
});
document.addEventListener("keydown", (event) => {
  const modal = activeDialogs.at(-1);
  if (!modal) return;
  if (event.key === "Escape") {
    event.preventDefault();
    if (modal.id === "sesTimer") minimizeTimer();
    else if (modal.id === "mSel") closeSel();
    else modal.style.display = "none";
  }
  if (event.key === "Tab") {
    const items = [
      ...modal.querySelectorAll(
        'button, input, select, textarea, a[href], [tabindex="0"]',
      ),
    ].filter((el) => !el.disabled && el.getClientRects().length);
    if (!items.length) return;
    const first = items[0],
      last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      last.focus();
      event.preventDefault();
    } else if (!event.shiftKey && document.activeElement === last) {
      first.focus();
      event.preventDefault();
    }
  }
});
// Legacy icon controls receive accessible names without changing their handlers.
function labelControls(root = document) {
  root.querySelectorAll("button[title]").forEach((button) => {
    if (!button.hasAttribute("aria-label"))
      button.setAttribute("aria-label", button.title);
  });
  root.querySelectorAll(".ses-adj-btn").forEach((button) => {
    const input = button.parentElement.querySelector("input");
    button.setAttribute(
      "aria-label",
      (button.textContent.trim() === "+" ? "Aumenta " : "Riduci ") +
        (input.id === "sesKg"
          ? `carico di ${formatGymNumber(getWeightStep(D && curDay ? gD()?.exs[sesExIdx] : null))} kg`
          : "ripetizioni"),
    );
  });
  root
    .querySelectorAll(".set-row input")
    .forEach((input, i) =>
      input.setAttribute(
        "aria-label",
        ["Ripetizioni", "Carico in kg"][i % 2] +
          " serie " +
          (Math.floor(i / 2) + 1),
      ),
    );
}
new MutationObserver(() => labelControls()).observe(
  document.getElementById("eList"),
  { childList: true, subtree: true },
);
labelControls();
document
  .getElementById("exQ")
  .setAttribute("aria-label", "Cerca esercizio, muscolo o attrezzatura");
// Visual viewport handles iOS keyboard; dvh is the fallback.
function updateViewport() {
  document.documentElement.style.setProperty(
    "--gym-viewport",
    (window.visualViewport?.height || window.innerHeight) + "px",
  );
}
window.visualViewport?.addEventListener("resize", updateViewport);
window.addEventListener("resize", updateViewport);
updateViewport();
// Reflect the selected theme in browser chrome.
const legacyToggleTheme = toggleTheme;
toggleTheme = function () {
  legacyToggleTheme();
  updateThemeColor();
};
function updateThemeColor() {
  document.querySelector('meta[name="theme-color"]').content =
    document.documentElement.dataset.theme === "light" ? "#f5f6f2" : "#101413";
}
updateThemeColor();
// Lightweight vector icons, rendered locally with no font or image requests.
function uiIcon(name) {
  const paths = {
    today: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
    plan: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 10h6M9 14h6M9 18h3"/>',
    progress: '<path d="M4 19h16M5 15l5-5 4 3 5-8M15 5h4v4"/>',
    guide:
      '<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15"/>',
    moon: '<path d="M20 14a8 8 0 0 1-10-10 8 8 0 1 0 10 10Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1"/>',
    timer:
      '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6M12 2v3M19 5l1-1"/>',
  };
  return `<svg viewBox="0 0 24 24" class="ui-icon" aria-hidden="true">${paths[name] || paths.today}</svg>`;
}
document.querySelectorAll("[data-tab]").forEach((button) => {
  button.querySelector("span").innerHTML = uiIcon(button.dataset.tab);
});
document.querySelector('[aria-label="Guida allenamento"]').innerHTML =
  uiIcon("guide");
document.getElementById("sesTimerToggle").innerHTML = uiIcon("timer");
const originalUpdateThemeColor = updateThemeColor;
updateThemeColor = function () {
  originalUpdateThemeColor();
  document.getElementById("thBtn").innerHTML = uiIcon(
    document.documentElement.dataset.theme === "dark" ? "moon" : "sun",
  );
};
updateThemeColor();
document.getElementById("weeklyCard").addEventListener("toggle", (event) => {
  if (event.target.open && D) renderWeeklyOverview();
});
// Chart.js is optional and only fetched when a user opens a history chart.
let chartLoading = null;
function loadChartLibrary() {
  if (window.Chart) return Promise.resolve(true);
  if (chartLoading) return chartLoading;
  chartLoading = new Promise((resolve) => {
    const script = document.createElement("script");
    const finish = () => {
      clearTimeout(timeout);
      resolve(!!window.Chart);
      if (!window.Chart) {
        script.remove();
        chartLoading = null;
      }
    };
    const timeout = setTimeout(finish, 6000);
    script.onload = script.onerror = finish;
    script.src =
      "https://cdn.jsdelivr.net/npm/chart.js@4.4.8/dist/chart.umd.min.js";
    document.head.append(script);
  });
  return chartLoading;
}
