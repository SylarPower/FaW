// ============================================================
// 🔧 CONFIGURAZIONE
// ============================================================
// Config condivisa da ../shared/firebase-config.js
const firebaseConfig = window.FAW_REQUIRE_FIREBASE_CONFIG
  ? window.FAW_REQUIRE_FIREBASE_CONFIG()
  : window.FAW_FIREBASE_CONFIG;
if (!firebaseConfig) {
  console.error(
    "[FaW] Impossibile inizializzare Firebase: config condivisa non caricata.",
  );
}
let db = null;
try {
  if (window.firebase && firebaseConfig) {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
  }
} catch (error) {
  console.warn("Cloud non disponibile", error);
}
const MIO = localStorage.getItem("mioNome");

if (!MIO) {
  alert("Devi prima fare login!");
  location.href = "../../index.html";
}

const uBadge = document.getElementById("ubadge");
if (uBadge) {
  uBadge.textContent = MIO;
}

// ============================================================
// 🔔 TOAST SYSTEM
// ============================================================
let toastTimer = null;
function toast(msg, type = "info", ms = 2500) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast " + type;
  clearTimeout(toastTimer);
  requestAnimationFrame(() => {
    el.classList.add("show");
    toastTimer = setTimeout(() => el.classList.remove("show"), ms);
  });
}

// ============================================================
// 📅 DATE HELPER (locale, no UTC shift!)
// ============================================================
function toLocalDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return (
    dt.getFullYear() +
    "-" +
    String(dt.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(dt.getDate()).padStart(2, "0")
  );
}

// ============================================================
// 📦 STATE
// ============================================================
let D = null,
  EX_DB = [],
  curDay = null,
  mf = "all";
let ssTarget = null;
let progTargetUid = null;

// Session state
let sesActive = false;
let sesExIdx = 0;
let sesStartTime = null;
let openExercises = new Set(); // Tiene traccia di quali esercizi sono aperti
let myExChart = null;

const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
const exDef = (id) => EX_DB.find((e) => e.id === id);
const GROUP_PRIORITY = {
  Petto: 1,
  Schiena: 2,
  Gambe: 3,
  Spalle: 4,
  Core: 5,
  Tricipiti: 6,
  Bicipiti: 7,
  Avambracci: 8,
  Cardio: 9,
};
function getPrimaryGroup(def) {
  if (!def || !def.groups || !def.groups.length)
    return def ? def.group : "Altro";
  const sorted = [...def.groups]
    .filter((g) => g !== "Cardio")
    .sort((a, b) => (GROUP_PRIORITY[a] || 99) - (GROUP_PRIORITY[b] || 99));
  return sorted[0] || def.group || "Altro";
}
const MUSCLE_COLORS = {
  Spalle: "#ffa502",
  Petto: "#ff4757",
  Schiena: "#3742fa",
  Core: "#eccc68",
  Bicipiti: "#ff6b81",
  Tricipiti: "#e17055",
  Avambracci: "#fd79a8",
  Gambe: "#2ed573",
};
let BPARTS = ["all"];

const MUSCLE_GROUP_MAP = {
  // Bicipiti
  bicipiti: "Bicipiti",
  "capo lungo del bicipite": "Bicipiti",
  "capo breve del bicipite": "Bicipiti",

  // Tricipiti
  tricipiti: "Tricipiti",
  "capo laterale del tricipite": "Tricipiti",
  "capo mediale del tricipite": "Tricipiti",
  "capo lungo del tricipite": "Tricipiti",

  // Avambracci
  avambracci: "Avambracci",
  "estensori del polso": "Avambracci",
  "flessori del polso": "Avambracci",
  mani: "Avambracci",

  // Schiena
  dorsali: "Schiena",
  "muscoli trapezi (zona media della schiena)": "Schiena",
  "zona lombare": "Schiena",
  "trapezi inferiori": "Schiena",
  "trapezio superiore": "Schiena",
  trappole: "Schiena",
  schiena: "Schiena",

  // Spalle
  spalle: "Spalle",
  "deltoide posteriore": "Spalle",
  "deltoidi posteriori": "Spalle",
  "deltoide laterale": "Spalle",
  "deltoide anteriore": "Spalle",
  "spalle anteriori": "Spalle",

  // Petto
  petto: "Petto",
  "pettorale superiore": "Petto",
  "petto medio e inferiore": "Petto",

  // Gambe
  glutei: "Gambe",
  "gluteo medio": "Gambe",
  "grande gluteo": "Gambe",
  quadricipiti: "Gambe",
  "retto femorale": "Gambe",
  "vasto laterale": "Gambe",
  "interno del quadricipite": "Gambe",
  femorali: "Gambe",
  "bicipiti femorali laterali": "Gambe",
  "muscoli posteriori della coscia (porzione mediale)": "Gambe",
  polpacci: "Gambe",
  polpaccio: "Gambe",
  soleo: "Gambe",
  tibiale: "Gambe",
  "interno coscia": "Gambe",
  inguine: "Gambe",

  // Core
  addominali: "Core",
  "addominali inferiori": "Core",
  "addominali superiori": "Core",
  obliqui: "Core",

  // Cardio
  cardio: "Cardio",
};

function getMuscleGroup(muscle) {
  if (!muscle) return "Altro";
  return MUSCLE_GROUP_MAP[muscle.toLowerCase()] || muscle;
}

function deduplicateExDB() {
  const map = {};
  EX_DB.forEach((e) => {
    if (!map[e.id]) {
      map[e.id] = {
        ...e,
        muscles: e.muscle ? [e.muscle] : [],
        group: getMuscleGroup(e.muscle),
      };
    } else {
      if (e.muscle && !map[e.id].muscles.includes(e.muscle)) {
        map[e.id].muscles.push(e.muscle);
      }
    }
  });

  EX_DB = Object.values(map);
  EX_DB.forEach((e) => {
    // Costruisci tutti i gruppi muscolari coinvolti
    const allGroups = new Set();
    if (e.muscles) {
      e.muscles.forEach((m) => {
        const g = getMuscleGroup(m);
        if (g && g !== "Altro") allGroups.add(g);
      });
    }
    if (e.eq && e.eq.toLowerCase() === "cardio") {
      allGroups.add("Cardio");
      e.group = "Cardio";
    } else {
      e.group = e.group || [...allGroups][0] || "Altro";
    }
    e.groups = allGroups.size > 0 ? [...allGroups] : [e.group];
  });

  const GROUP_ORDER = [
    "Spalle",
    "Petto",
    "Bicipiti",
    "Tricipiti",
    "Avambracci",
    "Schiena",
    "Core",
    "Gambe",
    "Cardio",
  ];
  const allGroups = [...new Set(EX_DB.map((e) => e.group))];
  const ordered = GROUP_ORDER.filter((g) => allGroups.includes(g));
  allGroups.forEach((g) => {
    if (!ordered.includes(g) && g !== "Altro") ordered.push(g);
  });
  BPARTS = ["all", ...ordered];

  console.log("Gruppi trovati:", allGroups);
  console.log("BPARTS:", BPARTS);
}

// ============================================================
// 🗄️ LOAD EXERCISE DB
// ============================================================
async function loadExDB() {
  try {
    const r = await fetch("../../exercises.json", { cache: "no-cache" });
    if (!r.ok) throw new Error("404");
    EX_DB = await r.json();
    deduplicateExDB();
    console.log("✅ Archivio: " + EX_DB.length + " esercizi (deduplicati)");
  } catch (e) {
    console.warn("Fallback locale per exercises.json");
    EX_DB = [
      {
        id: "panca_piana",
        name: "Panca Piana",
        muscle: "Petto",
        eq: "Bilanciere",
      },
      { id: "squat", name: "Squat", muscle: "Quadricipiti", eq: "Bilanciere" },
      {
        id: "stacco",
        name: "Stacco da Terra",
        muscle: "Schiena",
        eq: "Bilanciere",
      },
      {
        id: "military_press",
        name: "Military Press",
        muscle: "Spalle",
        eq: "Bilanciere",
      },
      {
        id: "curl_bilanciere",
        name: "Curl Bilanciere",
        muscle: "Bicipiti",
        eq: "Bilanciere",
      },
    ];
    deduplicateExDB();
  }
}

// ============================================================
// 🔥 FIREBASE LOAD/SAVE
// ============================================================
function dSt() {
  return { tw: 0, ts: 0, te: 0, pr: {}, sk: 0, lwd: null };
}

// ============================================================
// 🧭 NAVIGATION
// ============================================================
function goHome() {
  document.getElementById("vHome").style.display = "block";
  document.getElementById("vDay").style.display = "none";
  curDay = null;
  renderAll();
}
function smartHome() {
  if (curDay) {
    goHome();
  } else {
    location.href = "../../index.html";
  }
}
function goDay(id) {
  curDay = id;
  document.getElementById("vHome").style.display = "none";
  document.getElementById("vDay").style.display = "block";
  renDay();
}

// ============================================================
// 🏠 RENDER ALL (Home)
// ============================================================
// ===== DATI LIVE =====
function getLiveStats() {
  let liveSets = 0;
  D.days.forEach((day) => {
    day.exs.forEach((ex) => {
      if (ex.sd) liveSets += ex.sd.filter((s) => s.done).length;
    });
  });
  return { liveSets };
}
function getWeeklyData() {
  const allGroups = new Set();
  let totalExercises = 0;

  D.days.forEach((day) => {
    day.exs.forEach((ex) => {
      totalExercises++;
      const def = exDef(ex.exerciseId);
      if (def && def.group && def.group !== "Cardio") allGroups.add(def.group);
    });
  });

  // Allenamenti fatti questa settimana
  const now = new Date();
  const dow = now.getDay();
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMon);
  monday.setHours(0, 0, 0, 0);
  const mondayStr = toLocalDate(monday);

  const weekLogs = D.hist
    ? D.hist.filter((l) => toLocalDate(l.dt) >= mondayStr)
    : [];
  const weekDayIds = new Set(weekLogs.map((l) => l.dayId));

  const totalPossibleGroups = Object.keys(MUSCLE_COLORS).length;

  return {
    totalDays: D.days.length,
    totalExercises,
    weekDaysDone: weekDayIds.size,
    allGroups: [...allGroups],
    totalPossibleGroups,
  };
}

function renderWeeklyOverview() {
  const wd = getWeeklyData();
  const fatigue = getMuscleFatigue();

  // Muscle map con gradiente affaticamento
  renderMuscleMap("weeklyMuscleMap", fatigue, 220);

  // Legend con scala affaticamento
  const legendEl = document.getElementById("mmLegend");
  if (legendEl) {
    const sortedGroups = Object.entries(fatigue).sort((a, b) => b[1] - a[1]);
    if (sortedGroups.length > 0) {
      let legendHTML = `<div style="display:flex;align-items:center;gap:2px;margin-bottom:8px;width:100%;justify-content:center;">
                <div style="height:8px;width:28px;border-radius:3px 0 0 3px;background:hsl(140,35%,28%);"></div>
                <div style="height:8px;width:28px;background:hsl(120,55%,40%);"></div>
                <div style="height:8px;width:28px;background:hsl(60,70%,48%);"></div>
                <div style="height:8px;width:28px;background:hsl(35,80%,46%);"></div>
                <div style="height:8px;width:28px;border-radius:0 3px 3px 0;background:hsl(5,85%,48%);"></div>
            </div>
            <div style="display:flex;gap:6px;justify-content:center;margin-bottom:4px;width:100%;flex-wrap:wrap;">
                <span style="font-size:.5rem;color:hsl(140,35%,40%);">● sotto MEV</span>
                <span style="font-size:.5rem;color:hsl(120,55%,45%);">● MEV-MAV</span>
                <span style="font-size:.5rem;color:hsl(60,70%,48%);font-weight:700;">● MAV ✓</span>
                <span style="font-size:.5rem;color:hsl(35,80%,50%);">● sopra MAV</span>
                <span style="font-size:.5rem;color:hsl(5,85%,52%);">● MRV ⚠️</span>
            </div>
            <div style="width:100%;padding:6px 8px;border-radius:8px;background:var(--c2);border:1px solid var(--brd);margin-bottom:8px;font-size:.55rem;color:var(--tx3);line-height:1.6;">
                <b>MEV</b> = Volume Minimo Efficace (riferimento minimo indicativo)<br>
                <b>MAV</b> = Volume Massimo Adattivo (intervallo adattivo di riferimento)<br>
                <b>MRV</b> = Volume Massimo Recuperabile (oltre → rivaluta il volume con il tuo trainer)
            </div>`;
      legendHTML += sortedGroups
        .map(([g, ratio]) => {
          const range = VOLUME_RANGES[g] || { mev: 4, mav: 10, mrv: 16 };
          const setsNum = Math.round(ratio * range.mrv * 10) / 10;
          const mevRatio = range.mev / range.mrv;
          const mavRatio = range.mav / range.mrv;
          let zone, zoneColor;
          if (ratio > 0.95) {
            zone = "⚠️ a MRV — riduci";
            zoneColor = "hsl(5,85%,52%)";
          } else if (ratio > 0.75) {
            zone = "sopra MAV — monitora";
            zoneColor = "hsl(35,80%,50%)";
          } else if (ratio > 0.45) {
            zone = "✓ zona MAV";
            zoneColor = "hsl(60,70%,50%)";
          } else if (ratio > mevRatio) {
            zone = "MEV-MAV";
            zoneColor = "hsl(120,55%,45%)";
          } else if (ratio > 0.03) {
            zone = "sotto MEV";
            zoneColor = "hsl(140,35%,40%)";
          } else {
            zone = "nessun volume";
            zoneColor = "var(--tx3)";
          }
          const c = fatigueColor(ratio) || "var(--tx3)";
          return `<div class="mm-legend-item">
                    <div class="mm-legend-dot" style="background:${c}"></div>
                    <span>${g} <span style="font-size:.55rem;color:${zoneColor};">(~${setsNum} serie, ${zone})</span></span>
                </div>`;
        })
        .join("");
      legendEl.innerHTML = legendHTML;
    } else {
      legendEl.innerHTML = "";
    }
  }
}
// ============================================================
// 📅 PHASE / WEEK SYSTEM
// ============================================================
function getProgramWeek() {
  const start = D.st.programStart;
  if (!start) return null;
  const startDate = new Date(start);
  const now = new Date();
  const diffDays = Math.floor((now - startDate) / 86400000);
  if (diffDays < 0) return null;
  return Math.floor(diffDays / 7) + 1;
}

function getProgramPhase(week) {
  if (!week) return null;
  return Math.ceil(week / 4);
}

function isDeloadWeek(week) {
  if (!week) return false;
  return week % 4 === 0;
}
function getDeloadPercent(week) {
  const phase = getProgramPhase(week);
  // Fasi 3 e 5: -20%, altre: -15%
  return phase === 3 || phase === 5 ? 0.2 : 0.15;
}

function getPhaseInfo(phase) {
  const phases = {
    1: {
      name: "Base",
      desc: "Costruisci tecnica e volume. Carichi moderati.",
    },
    2: {
      name: "Sviluppo",
      desc: "Aumenta i carichi per piccoli passi. Rep leggermente ridotte.",
    },
    3: {
      name: "Intensificazione",
      desc: "Carichi alti, rep basse. Spingi ai limiti.",
    },
    4: {
      name: "Nuovi Stimoli",
      desc: "Nuove varianti, tecnica e controllo.",
    },
    5: {
      name: "Peak Estetico",
      desc: "Carichi alti + drop set e rest-pause. Massimo pump.",
    },
  };
  return phases[phase] || phases[1];
}
function setProgramDate(val) {
  if (!val) return;
  D.st.programStart = val;
  save().then(() => {
    renderPhaseIndicator();
    toast("📅 Programma dal " + val, "ok");
  });
}

function clearProgramDate() {
  if (!D.st.programStart) return;
  if (!confirm("Rimuovere la data di inizio programma?")) return;
  delete D.st.programStart;
  const input = document.getElementById("programDateInput");
  if (input) input.value = "";
  save().then(() => {
    renderPhaseIndicator();
    toast("📅 Fase rimossa", "info");
  });
}

function renderPhaseIndicator() {
  const el = document.getElementById("phaseIndicator");
  if (!el) return;
  const dateInput = document.getElementById("programDateInput");
  if (dateInput) dateInput.value = D.st.programStart || "";
  const week = getProgramWeek();
  if (!week) {
    el.innerHTML = `<div style="text-align:center;color:var(--tx3);font-size:.8rem;padding:8px;">
            Imposta la data di inizio programma per vedere la fase attuale
        </div>`;
    return;
  }
  const phase = getProgramPhase(week);
  const deload = isDeloadWeek(week);
  const weekInPhase = ((week - 1) % 4) + 1;
  const totalPhases = 5;
  const info = getPhaseInfo(phase);
  const dlPct = Math.round(getDeloadPercent(week) * 100);

  el.innerHTML = `
        <div class="phase-card">
            <div class="phase-week ${deload ? "phase-deload" : "phase-normal"}">
                <span class="pw-num">${week}</span>
                <span class="pw-label">Sett.</span>
            </div>
            <div class="phase-info">
                <h4 style="color:${deload ? "var(--yel)" : "var(--acc)"}">
                    ${
                      deload
                        ? "📉 Deload — Fase " + phase + " (" + info.name + ")"
                        : "Fase " +
                          phase +
                          ": " +
                          info.name +
                          " — Sett. " +
                          weekInPhase +
                          "/4"
                    }
                </h4>
                <small>${
                  deload
                    ? "Carico -" +
                      dlPct +
                      "%. Valuta una serie in meno sui compound."
                    : info.desc
                }</small>
            </div>
        </div>
        <div style="display:flex;gap:3px;margin-top:8px;">
            ${[1, 2, 3, 4, 5]
              .map((p) => {
                const active = phase === p;
                const done = phase > p;
                return `<div style="flex:1;text-align:center;">
                    <div style="height:6px;border-radius:3px;margin-bottom:3px;
                        background:${done ? "var(--grn)" : active ? "var(--acc)" : "var(--c3)"};
                        transition:all .3s;"></div>
                    <span style="font-size:.5rem;color:${active ? "var(--acc)" : done ? "var(--grn)" : "var(--tx3)"};">
                        F${p}</span>
                </div>`;
              })
              .join("")}
        </div>
    `;
}

function renderAll() {
  if (!D) return;
  try {
    renDays();
  } catch (e) {
    console.error("renDays:", e);
  }
  try {
    if (document.getElementById("weeklyCard").open) renderWeeklyOverview();
  } catch (e) {
    console.error("renderWeeklyOverview:", e);
  }
  try {
    renderPhaseIndicator();
  } catch (e) {
    console.error("renderPhaseIndicator:", e);
  }
}
function renDays() {
  const list = document.getElementById("dList");
  list.replaceChildren();
  if (!D.days.length) {
    list.innerHTML =
      '<p class="muted">Scegli un nome per la prima giornata. Potrai aggiungere gli esercizi subito dopo.</p>';
    return;
  }
  D.days.forEach((day, i) => {
    const card = document.createElement("article");
    card.className = "manage-day";
    const open = document.createElement("button");
    open.className = "quick-day";
    open.innerHTML = `<span class="quick-day-info"><strong>${escapeHTML(day.name)}</strong><small>${day.exs.length} esercizi${isDoneThisWeek(day.id) ? " · Allenata questa settimana" : ""}</small></span><span aria-hidden="true">→</span>`;
    open.onclick = () => goDay(day.id);
    card.append(open);
    const actions = document.createElement("div");
    actions.className = "manage-actions";
    [
      ["↑", "Sposta giornata su", () => applyDayReorder(i, i - 1), i === 0],
      [
        "↓",
        "Sposta giornata giù",
        () => applyDayReorder(i, i + 1),
        i === D.days.length - 1,
      ],
      ["Duplica", "Duplica giornata", () => dupDay(day.id), false],
      ["Elimina", "Elimina giornata", () => remDay(day.id), false],
    ].forEach(([label, title, action, disabled]) => {
      const button = document.createElement("button");
      button.textContent = label;
      button.setAttribute("aria-label", title + " " + day.name);
      button.disabled = disabled;
      button.onclick = action;
      actions.append(button);
    });
    card.append(actions);
    list.append(card);
  });
}

function dupDay(id) {
  const day = D.days.find((d) => d.id === id);
  if (!day) return;
  const newName = prompt("Nome della nuova giornata:", day.name + " (copia)");
  if (!newName || !newName.trim()) return;
  const copy = {
    id: uid(),
    name: newName.trim(),
    exs: day.exs.map((ex) => ({
      ...ex,
      uid: uid(),
      sd: ex.sd ? ex.sd.map((s) => ({ ...s, done: false })) : [],
    })),
  };
  D.days.push(copy);
  save();
  renDays();
  toast('📋 "' + newName.trim() + '" creata da "' + day.name + '"', "ok");
  if (navigator.vibrate) navigator.vibrate(30);
}

// ============================================================
// ➕ ADD / REMOVE DAY (con feedback)
// ============================================================
function addDay() {
  if (!D) {
    toast("⏳ Caricamento in corso...", "warn");
    return;
  }
  const input = document.getElementById("iDay");
  const name = input.value.trim();
  if (!name) {
    toast("✏️ Scrivi un nome per la giornata!", "warn");
    input.classList.add("shake");
    input.focus();
    setTimeout(() => input.classList.remove("shake"), 400);
    return;
  }
  D.days.push({ id: uid(), name, exs: [] });
  input.value = "";
  save();
  renDays();
  toast('✅ "' + name + '" creata!', "ok");
  // Vibrazione haptic se supportata
  if (navigator.vibrate) navigator.vibrate(30);
}

function remDay(id) {
  const day = D.days.find((d) => d.id === id);
  if (!day) return;
  if (!confirm('Eliminare "' + day.name + '"?')) return;
  D.days = D.days.filter((d) => d.id !== id);
  save();
  renDays();
  toast("🗑️ Giornata eliminata", "info");
}
function renameDay() {
  const day = gD();
  if (!day) return;
  const newName = prompt("Rinomina giornata:", day.name);
  if (!newName || !newName.trim() || newName.trim() === day.name) return;
  day.name = newName.trim();
  save();
  document.getElementById("dTitle").textContent = day.name;
  toast('✏️ Rinominata in "' + day.name + '"', "ok");
  if (navigator.vibrate) navigator.vibrate(15);
}
document.getElementById("iDay").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addDay();
});

// ============================================================
// 📋 DAY VIEW - RENDER
// ============================================================
function gD() {
  return D.days.find((d) => d.id === curDay);
}
function isDoneThisWeek(dayId) {
  if (!D.hist || !D.hist.length) return false;
  // Calcola il lunedì di questa settimana
  const now = new Date();
  const dow = now.getDay(); // 0=dom..6=sab
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMon);
  monday.setHours(0, 0, 0, 0);
  const mondayStr = toLocalDate(monday);

  // Cerca nella cronologia se c'è un log con questo dayId dopo lunedì
  return D.hist.some((l) => {
    if (l.dayId !== dayId) return false;
    const logDate = toLocalDate(l.dt);
    return logDate >= mondayStr;
  });
}
function renDay() {
  const day = gD();
  if (!day) return;

  document.getElementById("dTitle").textContent = day.name;

  const cont = document.getElementById("eList");
  if (!cont) return;

  // Show/hide toggle buttons
  const toggleBtns = document.getElementById("exToggleBtns");
  if (toggleBtns)
    toggleBtns.style.display = day.exs && day.exs.length > 0 ? "flex" : "none";

  if (!day.exs || day.exs.length === 0) {
    cont.innerHTML = `<div class="emp fade-in">
            <div class="eic">🏋️</div>
            Nessun esercizio ancora.<br>
            <small>Premi "+ Esercizio" per iniziare!</small>
        </div>`;
    return;
  }

  // Muscle overview
  const muscles = [
    ...new Set(
      day.exs
        .map((e) => {
          const d = exDef(e.exerciseId);
          return d ? d.group : null;
        })
        .filter(Boolean),
    ),
  ];

  let h = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;" class="fade-in">
        ${muscles.map((m) => `<span style="background:var(--c2);color:var(--grn);padding:6px 14px;border-radius:20px;font-size:.78rem;font-weight:600;border:1px solid rgba(3,218,198,.2)">${m}</span>`).join("")}
    </div>`;

  // Exercise cards (con raggruppamento superserie)
  const rendered = new Set();
  let dragIdx = 0;
  day.exs.forEach((ex) => {
    if (rendered.has(ex.uid)) return;
    if (ex.ssG) {
      const group = day.exs.filter((e) => e.ssG === ex.ssG);
      h += `<div class="ss-group fade-in" data-drag-idx="${dragIdx}">`;
      h += `<div class="ss-header">
                <span class="drag-handle" ontouchstart="dragStart(event,'ex')" onmousedown="dragStart(event,'ex')" onclick="event.stopPropagation()">☰</span>
                <span class="ss-label">🔗 Superserie (${group.length})</span>
                <button class="ss-break" onclick="breakSS('${ex.ssG}')">Sciogli</button>
            </div>`;
      group.forEach((gex) => {
        try {
          h += renEC(gex, false);
        } catch (e) {
          console.error(e);
        }
        rendered.add(gex.uid);
      });
      h += `</div>`;
      dragIdx++;
    } else {
      try {
        h += renEC(ex, true, dragIdx);
      } catch (e) {
        console.error(e);
      }
      rendered.add(ex.uid);
      dragIdx++;
    }
  });

  cont.innerHTML = h;
}

// ============================================================
// 🏋️ EXERCISE CARD RENDER
// ============================================================
function renEC(ex, showDrag, dragIdx) {
  const d = exDef(ex.exerciseId);
  const mColor = d ? getMuscleColor(d.group) : "var(--acc)";
  const safeName = escapeHTML(
    (ex.name || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'"),
  );

  // Calcolo progresso
  const total = ex.sd ? ex.sd.length : 0;
  const done = ex.sd ? ex.sd.filter((s) => s.done).length : 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const allDone = done === total && total > 0;
  const isOpen = openExercises.has(ex.uid);

  const dragAttr =
    showDrag && dragIdx !== undefined ? ` data-drag-idx="${dragIdx}"` : "";
  let h = `<div class="ex-card fade-in"${dragAttr} style="border-left:5px solid ${mColor};">`;

  // === HEADER (sempre visibile, cliccabile) ===
  const dragHandle = showDrag
    ? `<span class="drag-handle" ontouchstart="dragStart(event,'ex')" onmousedown="dragStart(event,'ex')" onclick="event.stopPropagation()">☰</span>`
    : "";
  h += `<div class="ex-header" role="button" tabindex="0" aria-expanded="${isOpen}" onkeydown="if(event.target===this && (event.key==='Enter' || event.key===' ')){event.preventDefault();this.click()}" onclick="togEx('${ex.uid}')" style="cursor:pointer;">
        ${dragHandle}
        <div class="ex-info" style="flex:1;min-width:0;">
            <h4 style="margin:0;font-size:.9rem;">${escapeHTML(ex.name)}</h4>
            <small>${d && d.groups ? d.groups.join(" · ") : ""}</small>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
            <span class="ex-summary-badge ${allDone ? "done-badge" : "todo-badge"}">
                ${allDone ? "✅" : done + "/" + total}
            </span>
            <span class="ex-arrow" id="exarrow-${ex.uid}">${isOpen ? "▲" : "▼"}</span>
        </div>
    </div>`;

  // === BARRA PROGRESSO (sempre visibile) ===
  h += `<div class="ex-progress"><div class="ex-progress-fill${allDone ? " complete" : ""}" style="width:${pct}%"></div></div>`;

  // === BODY (collassabile) ===
  h += `<div class="ex-body${isOpen ? " open" : ""}" id="exbody-${ex.uid}">`;

  // Toolbar azioni
  h += `<div class="ex-toolbar">`;

  h += `<button class="btn-icon" aria-label="Storico carichi" onclick="event.stopPropagation();showProgression('${escapeHTML(String(ex.exerciseId).replace(/\\/g, "\\\\").replace(/'/g, "\\'"))}','${safeName}')">📈</button>`;
  h += `<button class="btn-icon" aria-label="Configura superserie" onclick="event.stopPropagation();openSSModal('${ex.uid}')" style="color:var(--pur2);">${ex.ssG ? "🔗✓" : "🔗"}</button>`;
  h += `<button class="btn-icon" onclick="event.stopPropagation();openProgManager('${ex.uid}')" style="color:var(--yel);" title="Gestisci Progressione">⚡</button>`;
  h += `<button class="btn-icon" aria-label="Rimuovi esercizio" onclick="event.stopPropagation();remEx('${ex.uid}')" style="color:var(--red);">🗑️</button>`;
  h += `</div>`;

  // Muscoli coinvolti
  if (d && d.muscles && d.muscles.length > 1) {
    h += `<div style="display:flex;gap:4px;flex-wrap:wrap;padding:4px 0 8px;">`;
    d.muscles.forEach((m) => {
      h += `<span style="padding:3px 8px;border-radius:12px;font-size:.62rem;background:rgba(3,218,198,.1);color:var(--grn);border:1px solid rgba(3,218,198,.2);">${m}</span>`;
    });
    h += `</div>`;
  }

  // Mini muscle map

  // Tabella serie
  h += `<div class="sets-grid-header"><span>SET</span><span>REPS</span><span>KG</span><span></span></div>`;

  ex.sd.forEach((s, i) => {
    h += `<div class="set-row" id="sr-${ex.uid}-${i}">
            <div class="set-num">${i + 1}</div>
            <input type="number" inputmode="numeric" class="set-input" value="${s.r || ""}"
                placeholder="0" oninput="updS('${ex.uid}',${i},'r',this.value)">
            <input type="number" inputmode="decimal" class="set-input" value="${s.w || ""}"
                placeholder="0" oninput="updS('${ex.uid}',${i},'w',this.value)">
            <button class="set-del" onclick="remSet('${ex.uid}',${i})" title="Elimina serie">✕</button>
        </div>`;
  });
  h += `<button class="add-set-btn" onclick="addSet('${ex.uid}')">+ Aggiungi Serie</button>`;
  // Campo tempo smart
  const tp = (ex.tempo || "").split("-");
  const tEcc = escapeHTML(tp[0] || "");
  const tPau = escapeHTML(tp[1] || "");
  const tCon = escapeHTML(tp[2] || "");
  h += `<div style="margin-top:8px;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
            <span style="font-size:.75rem;font-weight:700;color:var(--tx2);">⏱️ Tempo</span>
            <button class="tb" onclick="event.stopPropagation();document.getElementById('mLegend').style.display='flex'"
                style="padding:2px 6px;font-size:.6rem;min-height:22px;border-radius:6px;">❓</button>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
            <div style="flex:1;text-align:center;">
                <input type="number" inputmode="numeric" class="set-input" value="${tEcc}"
                    placeholder="0" min="0" max="10" style="font-size:16px;padding:8px 2px;"
                    aria-label="Tempo in secondi" oninput="updTempoField('${ex.uid}',0,this.value)">
                <div style="font-size:.58rem;color:var(--tx3);margin-top:3px;">Eccentrica</div>
            </div>
            <span style="color:var(--tx3);font-weight:700;">-</span>
            <div style="flex:1;text-align:center;">
                <input type="number" inputmode="numeric" class="set-input" value="${tPau}"
                    placeholder="0" min="0" max="10" style="font-size:16px;padding:8px 2px;"
                    aria-label="Tempo in secondi" oninput="updTempoField('${ex.uid}',1,this.value)">
                <div style="font-size:.58rem;color:var(--tx3);margin-top:3px;">Pausa</div>
            </div>
            <span style="color:var(--tx3);font-weight:700;">-</span>
            <div style="flex:1;text-align:center;">
                <input type="number" inputmode="numeric" class="set-input" value="${tCon}"
                    placeholder="0" min="0" max="10" style="font-size:16px;padding:8px 2px;"
                    aria-label="Tempo in secondi" oninput="updTempoField('${ex.uid}',2,this.value)">
                <div style="font-size:.58rem;color:var(--tx3);margin-top:3px;">Concentrica</div>
            </div>
        </div>
    </div>`;
  // Campo recupero
  h += `<div style="margin-top:8px;">
        <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:.75rem;font-weight:700;color:var(--tx2);">⏱️ Recupero</span>
            <input type="number" inputmode="numeric" class="set-input" value="${ex.rest || ""}"
                placeholder="—" min="0" max="600"
                style="font-size:16px;padding:8px;max-width:80px;text-align:center;"
                aria-label="Recupero in secondi" oninput="updRest('${ex.uid}',this.value)">
            <span style="font-size:.72rem;color:var(--tx3);">sec</span>
        </div>
    </div>`;
  // Campo note
  const noteVal = (ex.note || "").replace(/"/g, "&quot;");
  h += `<div style="margin-top:10px;">
        <textarea aria-label="Note esercizio" rows="2" placeholder="Note (es. tecnica, sensazioni, varianti...)"
            style="font-size:.8rem;padding:10px 12px;"
            oninput="updNote('${ex.uid}',this.value)">${escapeHTML(ex.note || "")}</textarea>
    </div>`;

  h += `</div>`; // chiude ex-body
  h += `</div>`; // chiude ex-card

  return h;
}

// ============================================================
// 🎨 HELPERS
// ============================================================
// Range settimanali ottimali (serie dirette per gruppo)
// MEV = Minimum Effective Volume, MAV = Maximum Adaptive Volume, MRV = Maximum Recoverable Volume
// Fonte: Renaissance Periodization / Dr. Mike Israetel
const VOLUME_RANGES = {
  Petto: { mev: 8, mav: 14, mrv: 22 },
  Schiena: { mev: 8, mav: 14, mrv: 22 },
  Spalle: { mev: 6, mav: 12, mrv: 20 },
  Gambe: { mev: 8, mav: 14, mrv: 20 },
  Bicipiti: { mev: 4, mav: 10, mrv: 18 },
  Tricipiti: { mev: 4, mav: 8, mrv: 14 },
  Core: { mev: 0, mav: 12, mrv: 20 },
  Avambracci: { mev: 0, mav: 6, mrv: 12 },
};

// Quanto un esercizio compound contribuisce ai muscoli secondari
const SECONDARY_CREDIT = 0.3;

function getMuscleFatigue() {
  const sets = {};

  D.days.forEach((day) => {
    day.exs.forEach((ex) => {
      const def = exDef(ex.exerciseId);
      if (!def || def.group === "Cardio") return;
      if (!ex.sd || !ex.sd.length) return;

      const numSets = ex.sd.length;

      const effectiveSets = numSets;

      const primary = getPrimaryGroup(def);
      if (primary && primary !== "Altro") {
        sets[primary] = (sets[primary] || 0) + effectiveSets;
      }

      if (def.groups && def.groups.length > 1) {
        def.groups.forEach((g) => {
          if (g !== primary && g !== "Cardio") {
            sets[g] = (sets[g] || 0) + effectiveSets * SECONDARY_CREDIT;
          }
        });
      }
    });
  });

  const fatigue = {};
  Object.keys(sets).forEach((g) => {
    const range = VOLUME_RANGES[g] || { mev: 4, mav: 10, mrv: 16 };
    fatigue[g] = sets[g] / range.mrv; // >1.0 = oltre MRV → diventerà rosso
  });
  return fatigue;
}
function fatigueColor(ratio) {
  if (ratio <= 0.03) return null; // grigio, gestito da renderMuscleMap

  // 5 gradazioni: verde soft → verde → giallo → arancio → rosso
  // Zona 1: 0.00-0.30 → verde soft  (sotto MEV, tanto margine)
  // Zona 2: 0.30-0.55 → verde       (MEV-MAV, buono)
  // Zona 3: 0.55-0.75 → giallo      (MAV pieno, ottimale)
  // Zona 4: 0.75-0.95 → arancio     (sopra MAV, vicino MRV)
  // Zona 5: 0.95+     → rosso       (a/oltre MRV, riduci)

  let hue, sat, lum;

  if (ratio <= 0.3) {
    const t = ratio / 0.3;
    hue = 140 - Math.round(20 * t);
    sat = 35 + Math.round(20 * t);
    lum = 28 + Math.round(12 * t);
  } else if (ratio <= 0.55) {
    const t = (ratio - 0.3) / 0.25;
    hue = 120 - Math.round(60 * t);
    sat = 55 + Math.round(15 * t);
    lum = 40 + Math.round(8 * t);
  } else if (ratio <= 0.75) {
    const t = (ratio - 0.55) / 0.2;
    hue = 60 - Math.round(25 * t);
    sat = 70 + Math.round(10 * t);
    lum = 48 - Math.round(2 * t);
  } else if (ratio <= 0.95) {
    const t = (ratio - 0.75) / 0.2;
    hue = 35 - Math.round(30 * t);
    sat = 80 + Math.round(5 * t);
    lum = 46 + Math.round(2 * t);
  } else {
    const t = Math.min((ratio - 0.95) / 0.3, 1);
    hue = 5 - Math.round(5 * t);
    sat = 80 + Math.round(10 * t);
    lum = 48 + Math.round(5 * t);
  }

  return "hsl(" + hue + "," + sat + "%," + lum + "%)";
}

function renderMuscleMap(container, fatigueMap, height) {
  const tpl = document.getElementById("muscleMapTpl");
  if (!tpl) {
    console.warn("MM: template non trovato");
    return;
  }
  const svgs = tpl.querySelectorAll("svg.mm-svg");
  if (svgs.length < 2) {
    console.warn("MM: servono 2 SVG, trovati:", svgs.length);
    return;
  }

  if (typeof container === "string")
    container = document.getElementById(container);
  if (!container) {
    console.warn("MM: container non trovato");
    return;
  }

  const isDark =
    document.documentElement.getAttribute("data-theme") !== "light";
  const inactiveColor = isDark ? "#353550" : "#ccd0d8";
  const bodyStroke = isDark ? "#484a68" : "#9a9ab0";
  const aspectRatio = 660.46 / 1206.46;
  const svgW = Math.round(height * aspectRatio);

  const wrap = document.createElement("div");
  wrap.className = "muscle-map-wrap";

  for (let i = 0; i < 2; i++) {
    const svg = svgs[i].cloneNode(true);
    svg.removeAttribute("fill");
    svg.setAttribute("width", svgW);
    svg.setAttribute("height", height);
    svg.style.display = "block";

    svg.querySelectorAll("[data-group]").forEach((g) => {
      const group = g.getAttribute("data-group");
      const val = fatigueMap[group];
      const c = val !== undefined && val > 0 ? fatigueColor(val) : null;
      if (c) {
        g.setAttribute("fill", c);
        const glowSize = val > 1.0 ? 10 : Math.round(2 + Math.min(val, 1) * 8);
        g.style.filter = "drop-shadow(0 0 " + glowSize + "px " + c + ")";
      } else {
        g.setAttribute("fill", inactiveColor);
        g.style.filter = "none";
      }
    });

    svg.querySelectorAll(".mm-body path, .mm-body line").forEach((el) => {
      el.setAttribute("stroke", bodyStroke);
    });

    wrap.appendChild(svg);
  }

  container.innerHTML = "";
  container.appendChild(wrap);
}

function getMuscleColor(muscle) {
  const map = {
    Petto: "#ff4757",
    Schiena: "#3742fa",
    Spalle: "#ffa502",
    Bicipiti: "#ff6b81",
    Tricipiti: "#e17055",
    Quadricipiti: "#2ed573",
    Glutei: "#a29bfe",
    Polpacci: "#7bed9f",
    Addominali: "#eccc68",
    Cardio: "#e74c3c",
    Avambracci: "#fd79a8",
    Dorsali: "#3742fa",
    Trapezio: "#ffa502",
    Femorali: "#00b894",
  };
  return map[muscle] || "#03dac6";
}

function fEx(u) {
  const d = gD();
  return d?.exs?.find((e) => e.uid === u);
}
function updTempoField(exUid, partIdx, val) {
  const ex = fEx(exUid);
  if (!ex) return;
  if (
    val !== "" &&
    (!Number.isInteger(Number(val)) || Number(val) < 0 || Number(val) > 10)
  )
    return;
  const parts = (ex.tempo || "0-0-0").split("-");
  while (parts.length < 3) parts.push("0");
  parts[partIdx] = val || "0";
  ex.tempo = parts.join("-");
  // Se tutto è 0, svuota
  if (parts.every((p) => p === "0" || p === "")) ex.tempo = "";
  save();
}
function updNote(exUid, val) {
  const ex = fEx(exUid);
  if (ex) {
    ex.note = val;
    save();
  }
}
function updRest(exUid, val) {
  const ex = fEx(exUid);
  if (ex) {
    if (
      val !== "" &&
      (!Number.isInteger(Number(val)) || Number(val) < 0 || Number(val) > 600)
    )
      return;
    ex.rest = parseInt(val) || 0;
    save();
  }
}
function updS(exUid, idx, field, val) {
  const ex = fEx(exUid);
  if (ex && ex.sd[idx]) {
    const n = Number(String(val).replace(",", "."));
    if (!["r", "w"].includes(field)) return;
    const max = field === "w" ? 9999 : 999;
    if (
      !Number.isFinite(n) ||
      n < 0 ||
      n > max ||
      (field !== "w" && !Number.isInteger(n))
    )
      return;
    ex.sd[idx][field] = n;
    save();
  }
}

function chkSet(exUid, idx, btn) {
  const ex = fEx(exUid);
  if (!ex || !ex.sd[idx]) return;
  const s = ex.sd[idx];
  s.done = !s.done;

  // Haptic
  if (navigator.vibrate) navigator.vibrate(s.done ? [20, 10, 20] : 15);

  // Update button
  btn.classList.toggle("done", s.done);
  btn.textContent = s.done ? "✓" : "";

  // Update row
  const row = document.getElementById("sr-" + exUid + "-" + idx);
  if (row) row.classList.toggle("done", s.done);

  // Update progress bar and counter
  const total = ex.sd.length;
  const done = ex.sd.filter((x) => x.done).length;
  const pct = Math.round((done / total) * 100);
  const card = btn.closest(".ex-card");
  if (card) {
    const fill = card.querySelector(".ex-progress-fill");
    if (fill) {
      fill.style.width = pct + "%";
      fill.classList.toggle("complete", done === total);
    }
    const badge = card.querySelector(".ex-summary-badge");
    if (badge) {
      const allDone = done === total;
      badge.className =
        "ex-summary-badge " + (allDone ? "done-badge" : "todo-badge");
      badge.textContent = allDone ? "✅" : done + "/" + total;
    }
  }

  save();

  // Toast when exercise completed
  if (ex.sd.every((x) => x.done)) {
    toast("💪 " + ex.name + " completato!", "ok", 1800);
  }
}
// ===== ACCORDION ESERCIZI =====
function togEx(uid) {
  const body = document.getElementById("exbody-" + uid);
  const arrow = document.getElementById("exarrow-" + uid);
  if (!body) return;
  const isOpen = body.classList.toggle("open");
  const header = body.closest(".ex-card").querySelector(".ex-header");
  header.setAttribute("aria-expanded", isOpen);
  if (arrow) arrow.textContent = isOpen ? "−" : "+";
  if (isOpen) openExercises.add(uid);
  else openExercises.delete(uid);
}

function openAllEx() {
  const day = gD();
  if (!day) return;
  day.exs.forEach((ex) => openExercises.add(ex.uid));
  renDay();
  toast("📂 Tutti aperti", "info", 1200);
}

function closeAllEx() {
  openExercises.clear();
  renDay();
  toast("📁 Tutti chiusi", "info", 1200);
}
function addSet(u) {
  const e = fEx(u);
  if (!e) return;
  const last = e.sd.length ? e.sd[e.sd.length - 1] : { r: 10, w: 0 };
  e.sd.push({ r: last.r, w: last.w, done: false });
  save();
  renDay();
}
// ===== SUPERSERIE =====
function openSSModal(exUid) {
  ssTarget = exUid;
  const day = gD();
  const ex = day.exs.find((e) => e.uid === exUid);
  if (!ex) return;
  const others = day.exs.filter((e) => e.uid !== exUid);
  if (!others.length) {
    toast("⚠️ Aggiungi altri esercizi prima", "warn");
    return;
  }

  const currentGroup = ex.ssG;
  let h = "";
  others.forEach((e) => {
    const inSame = currentGroup && e.ssG === currentGroup;
    const def = exDef(e.exerciseId);
    h += `<div class="ss-option${inSame ? " selected" : ""}" onclick="toggleSSOption(this)">
            <input type="checkbox" style="display:none" class="ss-cb" value="${e.uid}" ${inSame ? "checked" : ""}>
            <div class="ss-check-mark">${inSame ? "✓" : ""}</div>
            <div style="flex:1;min-width:0;">
                <div class="ss-option-name">${escapeHTML(e.name)}</div>
                <div class="ss-option-detail">${def && def.groups ? def.groups.join(" · ") : ""} • ${e.sd ? e.sd.length : 0} serie</div>
            </div>
        </div>`;
  });
  const cnt = currentGroup
    ? day.exs.filter((e) => e.ssG === currentGroup).length
    : 1;
  h += `<div class="ss-count" id="ssCount">${cnt}/4 esercizi</div>`;
  document.getElementById("ssExList").innerHTML = h;
  document.getElementById("mSS").style.display = "flex";
}

function toggleSSOption(el) {
  const cb = el.querySelector(".ss-cb");
  const mark = el.querySelector(".ss-check-mark");
  const all = document.querySelectorAll(".ss-cb:checked").length;
  if (!cb.checked && all >= 3) {
    toast("⚠️ Max 4 esercizi per superserie", "warn");
    return;
  }
  cb.checked = !cb.checked;
  el.classList.toggle("selected", cb.checked);
  mark.textContent = cb.checked ? "✓" : "";
  const c = document.getElementById("ssCount");
  if (c)
    c.textContent =
      document.querySelectorAll(".ss-cb:checked").length + 1 + "/4 esercizi";
}

function confirmSS() {
  const day = gD();
  if (!day) return;
  const checks = document.querySelectorAll(".ss-cb:checked");
  const uids = [ssTarget, ...Array.from(checks).map((c) => c.value)];

  if (uids.length < 2) {
    // Rimuovi da superserie
    const ex = day.exs.find((e) => e.uid === ssTarget);
    if (ex && ex.ssG) {
      const old = ex.ssG;
      ex.ssG = null;
      const rem = day.exs.filter((e) => e.ssG === old);
      if (rem.length === 1) rem[0].ssG = null;
    }
    save();
    renDay();
    document.getElementById("mSS").style.display = "none";
    toast("🔗 Superserie rimossa", "info");
    return;
  }

  const gid = uid();
  // Pulisci vecchi gruppi
  uids.forEach((u) => {
    const e = day.exs.find((x) => x.uid === u);
    if (e && e.ssG) {
      const old = e.ssG;
      e.ssG = null;
      const rem = day.exs.filter((x) => x.ssG === old);
      if (rem.length === 1) rem[0].ssG = null;
    }
  });
  uids.forEach((u) => {
    const e = day.exs.find((x) => x.uid === u);
    if (e) e.ssG = gid;
  });
  save();
  document.getElementById("mSS").style.display = "none";
  renDay();
  toast("🔗 Superserie creata!", "ok");
  if (navigator.vibrate) navigator.vibrate([20, 10, 20]);
}

function breakSS(groupId) {
  const day = gD();
  if (!day) return;
  day.exs.forEach((e) => {
    if (e.ssG === groupId) e.ssG = null;
  });
  save();
  renDay();
  toast("🔗 Superserie sciolta", "info");
}
// ============================================================
// 🔀 DRAG & DROP SYSTEM
// ============================================================
let dragState = null;

function dragStart(e, type) {
  e.stopPropagation();
  if (e.cancelable) e.preventDefault();

  const ptr = e.touches ? e.touches[0] : e;
  const handle = e.target.closest(".drag-handle");
  if (!handle) return;
  const item = handle.closest("[data-drag-idx]");
  if (!item) return;

  const container = item.parentElement;
  const rect = item.getBoundingClientRect();

  const ghost = item.cloneNode(true);
  ghost.className = "drag-ghost";
  ghost.style.width = rect.width + "px";
  ghost.style.top = rect.top + "px";
  ghost.style.left = rect.left + "px";
  document.body.appendChild(ghost);

  item.classList.add("drag-source");
  document.body.classList.add("is-dragging");

  dragState = {
    type,
    item,
    ghost,
    container,
    fromIdx: parseInt(item.getAttribute("data-drag-idx")),
    targetIdx: parseInt(item.getAttribute("data-drag-idx")),
    offsetY: ptr.clientY - rect.top,
  };

  document.addEventListener("touchmove", dragMove, { passive: false });
  document.addEventListener("touchend", dragEnd);
  document.addEventListener("mousemove", dragMove);
  document.addEventListener("mouseup", dragEnd);

  if (navigator.vibrate) navigator.vibrate(20);
}

function dragMove(e) {
  if (!dragState) return;
  if (e.cancelable) e.preventDefault();

  const ptr = e.touches ? e.touches[0] : e;
  dragState.ghost.style.top = ptr.clientY - dragState.offsetY + "px";

  // Auto-scroll near edges
  const zone = 60;
  if (ptr.clientY < zone) window.scrollBy(0, -10);
  else if (ptr.clientY > window.innerHeight - zone) window.scrollBy(0, 10);

  // Find target
  const items = [
    ...dragState.container.querySelectorAll(":scope > [data-drag-idx]"),
  ];
  let targetIdx = dragState.fromIdx;

  items.forEach((el) => {
    el.classList.remove("drag-target");
    const r = el.getBoundingClientRect();
    if (ptr.clientY >= r.top && ptr.clientY <= r.bottom) {
      targetIdx = parseInt(el.getAttribute("data-drag-idx"));
      if (targetIdx !== dragState.fromIdx) el.classList.add("drag-target");
    }
  });

  dragState.targetIdx = targetIdx;
}

function dragEnd(e) {
  if (!dragState) return;

  dragState.ghost.remove();
  dragState.item.classList.remove("drag-source");
  document.body.classList.remove("is-dragging");

  const items = [
    ...dragState.container.querySelectorAll(":scope > [data-drag-idx]"),
  ];
  items.forEach((el) => el.classList.remove("drag-target"));

  document.removeEventListener("touchmove", dragMove);
  document.removeEventListener("touchend", dragEnd);
  document.removeEventListener("mousemove", dragMove);
  document.removeEventListener("mouseup", dragEnd);

  const from = dragState.fromIdx;
  const to = dragState.targetIdx;
  const type = dragState.type;
  dragState = null;

  if (from !== to) {
    if (type === "ex") applyExReorder(from, to);
    else if (type === "day") applyDayReorder(from, to);
  }
}

// ===== Helpers per riordinamento esercizi =====
function getExGroups(day) {
  const groups = [];
  const seen = new Set();
  day.exs.forEach((ex) => {
    if (seen.has(ex.uid)) return;
    if (ex.ssG) {
      const members = day.exs.filter((e) => e.ssG === ex.ssG);
      members.forEach((m) => seen.add(m.uid));
      groups.push(members.map((m) => m.uid));
    } else {
      seen.add(ex.uid);
      groups.push([ex.uid]);
    }
  });
  return groups;
}

function applyExReorder(fromIdx, toIdx) {
  const day = gD();
  if (!day) return;
  const groups = getExGroups(day);
  if (
    fromIdx < 0 ||
    fromIdx >= groups.length ||
    toIdx < 0 ||
    toIdx >= groups.length
  )
    return;

  const [moved] = groups.splice(fromIdx, 1);
  groups.splice(toIdx, 0, moved);

  const newExs = [];
  groups.forEach((uids) => {
    uids.forEach((uid) => {
      const ex = day.exs.find((e) => e.uid === uid);
      if (ex) newExs.push(ex);
    });
  });
  day.exs = newExs;
  save();
  renDay();
  toast("✅ Ordine aggiornato", "info", 1000);
  if (navigator.vibrate) navigator.vibrate(15);
}

function applyDayReorder(fromIdx, toIdx) {
  if (
    fromIdx < 0 ||
    fromIdx >= D.days.length ||
    toIdx < 0 ||
    toIdx >= D.days.length
  )
    return;
  const [moved] = D.days.splice(fromIdx, 1);
  D.days.splice(toIdx, 0, moved);
  save();
  renDays();
  toast("✅ Ordine aggiornato", "info", 1000);
  if (navigator.vibrate) navigator.vibrate(15);
}
// ===== PROGRESSION MANAGER =====
function openProgManager(exUid) {
  const ex = fEx(exUid);
  if (!ex || !ex.sd || ex.sd.length === 0) return;

  progTargetUid = exUid;
  document.getElementById("pmWeightDescription").textContent =
    `Aumenta il carico di ${formatGymNumber(getWeightStep(ex))} kg e riduci una ripetizione per serie.`;
  document.getElementById("pmTitle").textContent = "⚡ " + ex.name;
  document.getElementById("mProgManager").style.display = "flex";
}

function applyProgType(type) {
  const ex = fEx(progTargetUid);
  if (!ex || !ex.sd) return;

  ex.sd.forEach((s) => {
    let w = parseFloat(s.w) || 0;
    let r = parseInt(s.r) || 0;

    if (type === "weight") {
      s.w = Math.min(9999, Math.round((w + getWeightStep(ex)) * 100) / 100);
      s.r = Math.max(1, r - 1); // -1 Rep
    } else if (type === "volume") {
      s.r = r + 1; // +1 Rep, stesso peso
    } else if (type === "deload") {
      s.w = (w * 0.9).toFixed(1); // -10% peso
    }

    // Rimuove gli .0 inutili (es. 80.0 diventa 80)
    if (s.w % 1 === 0) s.w = parseInt(s.w);
    s.done = false; // Resetta le spunte per eseguirle
  });

  save();
  renDay();
  document.getElementById("mProgManager").style.display = "none";
  toast("⚡ Parametri aggiornati!", "ok");
  if (navigator.vibrate) navigator.vibrate([20, 50, 20]);
}
function remEx(u) {
  const ex = fEx(u);
  if (!ex) return;
  if (!confirm('Rimuovere "' + ex.name + '"?')) return;
  const d = gD();
  const oldGroup = ex.ssG;
  d.exs = d.exs.filter((e) => e.uid !== u);
  if (oldGroup) {
    const rem = d.exs.filter((e) => e.ssG === oldGroup);
    if (rem.length === 1) rem[0].ssG = null;
  }
  save();
  renDay();
  toast("🗑️ Esercizio rimosso", "info");
}
function remSet(u, i) {
  const e = fEx(u);
  if (!e) return;
  if (e.sd.length <= 1) {
    toast("⚠️ Serve almeno 1 serie", "warn");
    return;
  }
  e.sd.splice(i, 1);
  save();
  renDay();
  toast("🗑️ Serie eliminata", "info", 1200);
  if (navigator.vibrate) navigator.vibrate(15);
}
// ============================================================
// 📋 EXERCISE SELECTOR
// ============================================================
function openSel() {
  document.getElementById("mSel").style.display = "flex";
  document.getElementById("mChips").innerHTML = BPARTS.map(
    (m) =>
      `<span class="mch${mf === m ? " on" : ""}" onclick="mf='${m}';openSel();">${m === "all" ? "🏷️ Tutti" : m}</span>`,
  ).join("");
  filEx();
  setTimeout(() => document.getElementById("exQ").focus(), 350);
}

function closeSel() {
  document.getElementById("mSel").style.display = "none";
  document.getElementById("exQ").value = "";
  mf = "all";
}
function fuzzyMatch(text, query) {
  text = text.toLowerCase();
  query = query.toLowerCase().trim();
  // Splitta la query in parole e verifica che ogni parola sia contenuta nel testo
  const words = query.split(/\s+/);
  return words.every((w) => text.includes(w));
}

function filEx() {
  const q = document.getElementById("exQ").value.toLowerCase();
  let res = EX_DB;
  if (mf !== "all") res = res.filter((e) => e.groups && e.groups.includes(mf));
  if (q)
    res = res.filter((e) =>
      fuzzyMatch(
        [e.name, e.muscles ? e.muscles.join(" ") : "", e.eq].join(" "),
        q,
      ),
    );
  res = [...res].sort((a, b) => a.name.localeCompare(b.name, "it"));
  const list = document.getElementById("exR");
  list.replaceChildren();
  res.slice(0, 300).forEach((e) => {
    const button = document.createElement("button");
    button.className = "exo";
    button.style.cssText =
      "width:100%;text-align:left;display:flex;align-items:center;";
    button.innerHTML = `<span style="flex:1;min-width:0"><span class="on" style="display:block">${escapeHTML(e.name)}</span><span class="om" style="display:block">${escapeHTML((e.groups || [e.group]).join(" · "))} · ${escapeHTML(e.eq)}</span></span><span aria-hidden="true">+</span>`;
    button.onclick = () => addEx(e.id);
    list.append(button);
  });
  if (!res.length)
    list.innerHTML =
      '<div class="emp" role="status">Nessun risultato. Prova un altro nome o muscolo.</div>';
  else if (res.length > 300)
    list.insertAdjacentHTML(
      "beforeend",
      '<p class="muted">Mostrati 300 risultati. Affina la ricerca per trovare gli altri.</p>',
    );
}

function getLast(eid) {
  if (!D.hist) return null;
  return (
    D.hist
      .filter((x) => x.eid === eid)
      .sort((a, b) => new Date(b.dt) - new Date(a.dt))[0] || null
  );
}

function addEx(eid) {
  const d = exDef(eid),
    day = gD();
  if (!d || !day) return;
  const l = getLast(eid);
  const sd =
    l && l.sd
      ? l.sd.map((s) => ({ ...s, done: false }))
      : [{ r: 10, w: 0, done: false }];
  const newId = uid();
  day.exs.push({
    uid: newId,
    exerciseId: eid,
    name: d.name,
    sd,
    rest: l?.rest || 0,
    seat: l?.seat || "",
    ssG: null,
    pF: false,
    note: l?.note || "",
    tempo: l?.tempo || "",
  });
  openExercises.clear();
  openExercises.add(newId);
  save();
  closeSel();
  renDay();
  toast("✅ " + d.name + " aggiunto!", "ok", 1500);
  if (navigator.vibrate) navigator.vibrate(30);
  setTimeout(() => {
    const el = document.getElementById("exbody-" + newId);
    if (el)
      el.closest(".ex-card").scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
  }, 200);
}

// ============================================================
// 📊 PROGRESSION CHART
// ============================================================
async function showProgression(exId, exName) {
  const stats = [];
  if (D.hist) {
    D.hist.forEach((entry) => {
      if (entry.eid === exId && entry.w > 0) {
        stats.push({
          date: entry.dt,
          weight: entry.w,
          sets: entry.s,
          reps: entry.r,
        });
      }
    });
  }
  if (stats.length < 2) {
    toast("📊 Servono almeno 2 sessioni per il grafico", "info");
    return;
  }

  stats.sort((a, b) => new Date(a.date) - new Date(b.date));

  if (!window.Chart && !(await loadChartLibrary())) {
    toast(
      "Grafico non disponibile. Riprova con una connessione attiva.",
      "warn",
    );
    return;
  }
  document.getElementById("mProg").style.display = "flex";
  document.getElementById("progTitle").textContent = "📈 " + exName;

  const ctx = document.getElementById("exChart").getContext("2d");
  if (myExChart) myExChart.destroy();

  myExChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: stats.map((s) =>
        new Date(s.date).toLocaleDateString("it-IT", {
          day: "numeric",
          month: "short",
        }),
      ),
      datasets: [
        {
          label: "Carico Max (kg)",
          data: stats.map((s) => s.weight),
          borderColor: "#03dac6",
          backgroundColor: "rgba(3, 218, 198, 0.1)",
          tension: 0.3,
          fill: true,
          pointRadius: 5,
          pointBackgroundColor: "#03dac6",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          grid: { color: "rgba(255,255,255,.08)" },
          ticks: { color: "#aaa" },
        },
        x: {
          grid: { display: false },
          ticks: { color: "#aaa", maxRotation: 45 },
        },
      },
    },
  });
}

// ============================================================
// 🏋️ SESSION MODE
// ============================================================

function startSession() {
  const day = gD();
  if (!day || !day.exs || !day.exs.length) {
    toast("⚠️ Aggiungi esercizi prima!", "warn");
    return;
  }

  const totalSets = day.exs.reduce((a, e) => a + (e.sd ? e.sd.length : 0), 0);
  const doneSets = day.exs.reduce(
    (a, e) => a + (e.sd ? e.sd.filter((s) => s.done).length : 0),
    0,
  );

  if (totalSets === 0) {
    toast("⚠️ Aggiungi almeno una serie agli esercizi!", "warn");
    return;
  }

  // Ask before discarding a completed draft.
  if (doneSets === totalSets) {
    if (
      !confirm(
        "Tutte le serie sono completate. Iniziare una nuova sessione azzerando le spunte?",
      )
    )
      return;
    delete D.activeSession;
    day.exs.forEach((e) => {
      if (e.sd) e.sd.forEach((s) => (s.done = false));
    });
    save();
    launchSession();
  }
  // Parziale → mostra modal con 3 scelte
  else if (doneSets > 0) {
    document.getElementById("sesChoiceDone").textContent = doneSets;
    document.getElementById("sesChoiceTotal").textContent = totalSets;
    document.getElementById("mSesChoice").style.display = "flex";
  }
  // Nessuna serie fatta → parti subito
  else {
    launchSession();
  }
}

function sesChoiceContinue() {
  document.getElementById("mSesChoice").style.display = "none";
  launchSession();
}

function sesChoiceReset() {
  if (!confirm("Azzerare le serie completate e ricominciare?")) return;
  delete D.activeSession;
  document.getElementById("mSesChoice").style.display = "none";
  const day = gD();
  day.exs.forEach((e) => {
    if (e.sd) e.sd.forEach((s) => (s.done = false));
  });
  save();
  launchSession();
}

function sesChoiceCancel() {
  document.getElementById("mSesChoice").style.display = "none";
}

function launchSession() {
  const day = gD();

  sesActive = true;
  sesExIdx = 0;
  sesLastExIdx = -1;
  sesStartTime =
    D.activeSession?.dayId === curDay ? D.activeSession.startedAt : Date.now();
  D.activeSession = { dayId: curDay, startedAt: sesStartTime };
  sessionFinalized = false;
  document.getElementById("sesTimerToggle").disabled = false;
  selectedSetIdx = null;
  save();

  const firstUndone = day.exs.findIndex(
    (ex) => ex.sd && ex.sd.some((s) => !s.done),
  );
  if (firstUndone >= 0) sesExIdx = firstUndone;

  // ← FIX CRITICO: Reset UI sessione precedente
  document.getElementById("sesSummary").style.display = "none";
  document.getElementById("sesExCard").style.display = "";
  document.querySelector(".ses-nav").style.display = "";

  document.body.classList.add("in-session");
  document.getElementById("vDay").style.display = "none";
  document.getElementById("vSession").style.display = "flex";

  updateTimerToggleUI();
  sesRender();
  if (navigator.vibrate) navigator.vibrate(30);
}

function exitSession() {
  if (!confirm("Uscire dalla sessione?\nI progressi sono salvati.")) return;

  skipRestTimer();
  resetStopwatch();
  save();
  // Ferma timer se attivo
  clearInterval(restTimerId);
  var timerEl = document.getElementById("sesTimer");
  if (timerEl) timerEl.style.display = "none";

  // Rilascia wake lock se presente
  if (typeof releaseWakeLock === "function") releaseWakeLock();

  sesActive = false;
  document.body.classList.remove("in-session");
  document.getElementById("vSession").style.display = "none";
  document.getElementById("vDay").style.display = "block";

  renDay();
}

function sesClose() {
  skipRestTimer();
  resetStopwatch();
  clearInterval(restTimerId);
  var timerEl = document.getElementById("sesTimer");
  if (timerEl) timerEl.style.display = "none";
  if (typeof releaseWakeLock === "function") releaseWakeLock();

  sesActive = false;
  document.body.classList.remove("in-session");
  document.getElementById("vSession").style.display = "none";
  goHome();
}

// ===== Rendering sessione =====
let sesLastExIdx = -1;

function sesRender() {
  const day = gD();
  if (!day) return;

  const exs = day.exs;
  const ex = exs[sesExIdx];
  if (!ex) return;
  const def = exDef(ex.exerciseId);

  const sameExercise = sesExIdx === sesLastExIdx;
  sesLastExIdx = sesExIdx;

  // Reset cronometro se cambia esercizio
  if (!sameExercise) {
    resetStopwatch();
    selectedSetIdx = null;
  }
  const checkBtn = document.getElementById("sesCheckBtn");
  checkBtn.removeAttribute("data-edit-idx");
  checkBtn.innerHTML =
    '<span aria-hidden="true">✓</span><span>Conferma serie</span>';

  // Progress globale
  let totalSets = 0,
    doneSets = 0;
  exs.forEach((e) => {
    if (!e.sd) return;
    totalSets += e.sd.length;
    doneSets += e.sd.filter((s) => s.done).length;
  });
  renderSessionProgress(doneSets, totalSets);

  // Nascondi prev/next ai limiti
  document.getElementById("sesBtnPrev").disabled = sesExIdx === 0;
  document.getElementById("sesBtnNext").disabled = sesExIdx === exs.length - 1;

  // Superserie: bordo viola
  const sesExCard = document.getElementById("sesExCard");
  if (ex.ssG) {
    sesExCard.classList.add("ses-superserie");
  } else {
    sesExCard.classList.remove("ses-superserie");
  }

  // Aggiorna il contesto soltanto quando cambia esercizio.
  if (!sameExercise) {
    // Nome
    document.getElementById("sesExName").textContent = ex.name;

    // Dettaglio + badge superserie
    let detailHTML = def
      ? (def.groups ? def.groups.join(" · ") : def.group) + " • " + def.eq
      : "";
    if (ex.ssG) {
      const ssGroup = day.exs.filter((e) => e.ssG === ex.ssG);
      const ssNames = ssGroup.map((e) => e.name);
      const myPos = ssGroup.findIndex((e) => e.uid === ex.uid) + 1;
      detailHTML += `<div class="ses-ss-badge">Superserie ${myPos}/${ssGroup.length}: ${escapeHTML(ssNames.join(" + "))}</div>`;
    }
    document.getElementById("sesExDetail").innerHTML = detailHTML;
  }

  // Set dots (aggiorna sempre)
  const curSetIdx = sesGetCurrentSetIdx(ex);
  const allSetsDone = ex.sd.every((s) => s.done);

  document.getElementById("sesSetDots").innerHTML = ex.sd
    .map((s, i) => {
      let cls = "ses-dot ";
      if (s.done) cls += "done";
      else if (i === curSetIdx) cls += "current";
      else cls += "todo";
      return `<button class="${cls}" onclick="sesEditSet(${i})" aria-label="Serie ${i + 1}${s.done ? ", completata" : ", da fare"}" aria-pressed="${i === curSetIdx}">${s.done ? "✓" : i + 1}</button>`;
    })
    .join("");

  // Set area vs completed
  const setArea = document.getElementById("sesSetArea");
  const doneArea = document.getElementById("sesExDone");

  if (allSetsDone) {
    setArea.style.display = "none";
    doneArea.style.display = "block";
  } else {
    setArea.style.display = "block";
    doneArea.style.display = "none";

    const s = ex.sd[curSetIdx];
    document.getElementById("sesSetLabel").textContent =
      "SET " + (curSetIdx + 1) + "/" + ex.sd.length;
    document.getElementById("sesReps").value = s.r || "";
    document.getElementById("sesKg").value = s.w || "";

    // Dati della serie precedente
    const sugEl = document.getElementById("sesPreviousSet");
    if (sugEl) {
      sugEl.innerHTML = buildPreviousSetHTML(curDay, ex, curSetIdx);
    }

    // Tempo + Help unificati
    const tempoEl = document.getElementById("sesTempoInfo");
    if (tempoEl) {
      const helpBtn = `<button onclick="document.getElementById('mLegend').style.display='flex'" 
                style="font-size:.6rem;background:var(--c2);color:var(--tx3);padding:3px 8px;
                border-radius:6px;border:1px solid var(--brd);cursor:pointer;white-space:nowrap;">Guida</button>`;

      if (ex.tempo && ex.tempo.split("-").some((p) => p && p !== "0")) {
        const tParts = ex.tempo.split("-");
        const tDesc =
          (tParts[0] || "0") +
          "s negativa - " +
          (tParts[1] || "0") +
          "s pausa - " +
          (tParts[2] || "0") +
          "s positiva";
        tempoEl.innerHTML = `<span style="font-size:.72rem;color:var(--yel);font-weight:600;">${tDesc}</span>${helpBtn}`;
        tempoEl.style.background = "rgba(241,196,15,.08)";
        tempoEl.style.border = "1px solid rgba(241,196,15,.15)";
      } else {
        tempoEl.innerHTML = helpBtn;
        tempoEl.style.background = "transparent";
        tempoEl.style.border = "none";
      }
    }

    // Note sotto il tempo
    const noteInline = document.getElementById("sesNoteInline");
    if (noteInline) {
      if (ex.note) {
        noteInline.textContent = ex.note;
        noteInline.style.display = "block";
      } else {
        noteInline.style.display = "none";
      }
    }
  }
}
// ============================================================
// PREVIOUS SESSION REFERENCE
// ============================================================
function getLastSessionData(dayId, exerciseId) {
  if (!D.hist || !D.hist.length) return null;
  const entries = D.hist.filter(
    (h) => h.dayId === dayId && h.eid === exerciseId,
  );
  if (!entries.length) return null;
  entries.sort((a, b) => new Date(b.dt) - new Date(a.dt));
  return entries[0];
}

function buildPreviousSetHTML(dayId, ex, setIdx) {
  const last = getLastSessionData(dayId, ex.exerciseId);
  const set = last?.sd?.[setIdx];
  if (!set) return "";
  const reps = Number(set.r),
    weight = Number(set.w);
  if (
    !Number.isInteger(reps) ||
    reps < 1 ||
    reps > 999 ||
    !Number.isFinite(weight) ||
    weight < 0 ||
    weight > 9999
  )
    return "";
  const date = new Date(last.dt);
  const when = Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("it-IT", {
        day: "numeric",
        month: "short",
      }).format(date)
    : "Sessione precedente";
  return `<div class="previous-set"><span>Ultima volta · ${escapeHTML(when)}</span><strong>${reps} rip. × ${formatGymNumber(weight, 2)} kg</strong><button onclick="applyPreviousSet(${reps},${weight})">Usa questi valori</button></div>`;
}
function applyPreviousSet(reps, kg) {
  document.getElementById("sesReps").value = reps;
  document.getElementById("sesKg").value = kg;
  persistSessionInputs();
  toast("Valori precedenti applicati", "ok", 1200);
}
// ============================================================
// ⏱️ REST TIMER (completo)
// ============================================================
let restTimerId = null;
let restTimeLeft = 0;
let restTimeTotal = 0;
let restEndTime = 0;
let sesTimerEnabled = localStorage.getItem("gym-timer") !== "0";

function toggleSesTimer() {
  sesTimerEnabled = !sesTimerEnabled;
  localStorage.setItem("gym-timer", sesTimerEnabled ? "1" : "0");
  updateTimerToggleUI();
  toast(
    sesTimerEnabled
      ? "⏱️ Timer recupero attivato"
      : "⏱️ Timer recupero disattivato",
    "info",
    1500,
  );
  if (navigator.vibrate) navigator.vibrate(15);
}

function updateTimerToggleUI() {
  const btn = document.getElementById("sesTimerToggle");
  if (btn) btn.classList.toggle("active", sesTimerEnabled);
}

function tryStartRestTimer(ex) {
  if (!sesTimerEnabled) return;
  const restTime = parseInt(ex.rest) || 0;
  if (restTime <= 0) return;
  startRestTimer(restTime);
}

function startRestTimer(seconds) {
  if (seconds <= 0) return;
  const overlay = document.getElementById("sesTimer");
  const circle = document.getElementById("sesTimerCircle");
  if (!overlay || !circle) return;

  skipRestTimer();
  restTimeTotal = seconds;
  restEndTime = Date.now() + seconds * 1000;

  circle.style.transition = "none";
  circle.style.strokeDashoffset = "0";
  circle.style.stroke = "var(--acc)";
  void circle.offsetWidth;
  circle.style.transition = "stroke-dashoffset .3s linear, stroke .3s";

  overlay.style.display = "flex";

  const nextInfo = document.getElementById("sesTimerNext");
  if (nextInfo) {
    const day = gD();
    if (day && day.exs[sesExIdx]) {
      const nex = day.exs[sesExIdx];
      const nsi = sesGetCurrentSetIdx(nex);
      const allDone = nex.sd.every((s) => s.done);
      nextInfo.textContent = allDone
        ? "Prossimo esercizio..."
        : nex.name + " • Set " + (nsi + 1);
    }
  }

  restTimeLeft = seconds;
  updateTimerDisplay();
  clearInterval(restTimerId);
  restTimerId = setInterval(() => {
    restTimeLeft = Math.max(0, Math.ceil((restEndTime - Date.now()) / 1000));
    updateTimerDisplay();
    if (restTimeLeft <= 0) {
      clearInterval(restTimerId);
      timerMinimized = false;
      overlay.style.display = "none";
      var mini = document.getElementById("sesTimerMini");
      if (mini) mini.style.display = "none";
      if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
    }
  }, 250);
}

function updateTimerDisplay() {
  const m = Math.floor(restTimeLeft / 60);
  const s = restTimeLeft % 60;
  const timeStr = m + ":" + String(s).padStart(2, "0");
  const progress = restTimeTotal > 0 ? restTimeLeft / restTimeTotal : 0;
  const isWarning = restTimeLeft <= 10;

  // Fullscreen
  const el = document.getElementById("sesTimerTime");
  if (el) el.textContent = timeStr;

  const circle = document.getElementById("sesTimerCircle");
  if (circle) {
    const offset = 553 * (1 - progress);
    circle.style.strokeDashoffset = offset;
    circle.style.stroke = isWarning ? "var(--red)" : "var(--acc)";
  }

  // Mini banner
  const miniTime = document.getElementById("sesTimerMiniTime");
  if (miniTime) {
    miniTime.textContent = timeStr;
    miniTime.style.color = isWarning ? "var(--red)" : "var(--acc)";
  }
  const miniFill = document.getElementById("sesTimerMiniFill");
  if (miniFill) {
    miniFill.style.width = progress * 100 + "%";
    miniFill.style.background = isWarning ? "var(--red)" : "var(--acc)";
  }
}

function skipRestTimer() {
  clearInterval(restTimerId);
  timerMinimized = false;
  var el = document.getElementById("sesTimer");
  if (el) el.style.display = "none";
  var mini = document.getElementById("sesTimerMini");
  if (mini) mini.style.display = "none";
  if (navigator.vibrate) navigator.vibrate(15);
}

function adjRestTimer(delta) {
  restEndTime = Math.max(Date.now() + 5000, restEndTime + delta * 1000);
  restTimeLeft = Math.ceil((restEndTime - Date.now()) / 1000);
  if (restTimeLeft > restTimeTotal) restTimeTotal = restTimeLeft;
  updateTimerDisplay();
  if (navigator.vibrate) navigator.vibrate(10);
}
let timerMinimized = false;

function minimizeTimer() {
  timerMinimized = true;
  document.getElementById("sesTimer").style.display = "none";
  document.getElementById("sesTimerMini").style.display = "block";
  if (navigator.vibrate) navigator.vibrate(10);
}

function expandTimer() {
  timerMinimized = false;
  document.getElementById("sesTimerMini").style.display = "none";
  document.getElementById("sesTimer").style.display = "flex";
  if (navigator.vibrate) navigator.vibrate(10);
}
// ============================================================
// ⏱️ EXERCISE STOPWATCH
// ============================================================
let swRunning = false;
let swStartTime = 0;
let swElapsed = 0;
let swIntervalId = null;

function toggleStopwatch() {
  if (swRunning) {
    stopStopwatch();
  } else {
    startStopwatch();
  }
}

function startStopwatch() {
  if (swRunning) return;
  swRunning = true;
  swStartTime = Date.now() - swElapsed;
  const timeEl = document.getElementById("sesSwTime");
  timeEl.style.display = "block";
  timeEl.classList.add("running");
  const btn = document.getElementById("sesSwBtn");
  btn.textContent = "Pausa";
  btn.classList.add("active");
  clearInterval(swIntervalId);
  swIntervalId = setInterval(updateStopwatch, 250);
  updateStopwatch();
}

function stopStopwatch() {
  swRunning = false;
  swElapsed = Date.now() - swStartTime;
  clearInterval(swIntervalId);
  const btn = document.getElementById("sesSwBtn");
  const timeEl = document.getElementById("sesSwTime");
  const resetBtn = document.getElementById("sesSwReset");
  btn.textContent = "▶ Riprendi";
  btn.classList.remove("active");
  timeEl.classList.remove("running");
  resetBtn.style.display = "flex";
  if (navigator.vibrate) navigator.vibrate(15);
}

function resetStopwatch() {
  swRunning = false;
  swElapsed = 0;
  clearInterval(swIntervalId);
  const btn = document.getElementById("sesSwBtn");
  const timeEl = document.getElementById("sesSwTime");
  const resetBtn = document.getElementById("sesSwReset");
  btn.textContent = "Cronometro";
  btn.classList.remove("active");
  timeEl.textContent = "0:00";
  timeEl.style.display = "none";
  timeEl.classList.remove("running");
  resetBtn.style.display = "none";
}

function updateStopwatch() {
  const elapsed = Date.now() - swStartTime;
  const secs = Math.floor(elapsed / 1000);
  const mins = Math.floor(secs / 60);
  const s = secs % 60;
  document.getElementById("sesSwTime").textContent =
    mins + ":" + String(s).padStart(2, "0");
}
function sesGetCurrentSetIdx(ex) {
  if (!ex.sd) return 0;
  if (selectedSetIdx !== null && ex.sd[selectedSetIdx]) return selectedSetIdx;
  const idx = ex.sd.findIndex((s) => !s.done);
  return idx >= 0 ? idx : ex.sd.length - 1;
}
function sesEditSet(setIdx) {
  persistSessionInputs();
  selectedSetIdx = setIdx;
  const day = gD();
  const ex = day.exs[sesExIdx];
  if (!ex || !ex.sd[setIdx]) return;

  const s = ex.sd[setIdx];

  // Mostra i campi con i valori di quella serie
  const setArea = document.getElementById("sesSetArea");
  const doneArea = document.getElementById("sesExDone");
  setArea.style.display = "block";
  doneArea.style.display = "none";

  document.getElementById("sesSetLabel").textContent =
    "SET " + (setIdx + 1) + "/" + ex.sd.length + (s.done ? " ✏️" : "");
  document.getElementById("sesReps").value = s.r || "";
  document.getElementById("sesKg").value = s.w || "";

  // Se la serie era già fatta, il pulsante diventa "Aggiorna"
  const checkBtn = document.getElementById("sesCheckBtn");
  if (s.done) {
    checkBtn.setAttribute("data-edit-idx", setIdx);
    checkBtn.innerHTML =
      '<span class="ses-check-icon">✏️</span><span>AGGIORNA</span>';
  } else {
    checkBtn.removeAttribute("data-edit-idx");
    checkBtn.innerHTML =
      '<span class="ses-check-icon">✓</span><span>Conferma serie</span>';
  }

  // Aggiorna dots per evidenziare quale si sta editando
  document.querySelectorAll(".ses-dot").forEach((dot, i) => {
    dot.classList.remove("current");
    if (i === setIdx && !ex.sd[i].done) dot.classList.add("current");
  });

  // Dati della serie precedente
  const sugEl = document.getElementById("sesPreviousSet");
  if (sugEl) sugEl.innerHTML = buildPreviousSetHTML(curDay, ex, setIdx);

  if (navigator.vibrate) navigator.vibrate(10);
}
// ===== Check set (con Logica Superserie Alternate) =====
function sesCheck() {
  const confirmButton = document.getElementById("sesCheckBtn");
  if (
    !sesActive ||
    sessionFinalized ||
    confirmButton.disabled ||
    !validateSessionInputs()
  )
    return;
  confirmButton.disabled = true;
  setTimeout(() => {
    confirmButton.disabled = false;
  }, 400);
  const ex = gD()?.exs[sesExIdx];
  if (!ex) return;
  const idx = sesGetCurrentSetIdx(ex);
  const set = ex.sd[idx];
  if (!set) return;
  const wasDone = set.done;
  persistSessionInputs();
  set.done = true;
  selectedSetIdx = null;
  resetStopwatch();
  save();
  if (navigator.vibrate) navigator.vibrate(20);
  if (wasDone) {
    sesRender();
    toast("Serie aggiornata", "ok");
    return;
  }
  const day = gD();
  const allDone = day.exs.every(
    (e) => !e.sd?.length || e.sd.every((s) => s.done),
  );
  if (allDone) {
    sesShowSummary();
    return;
  }
  if (ex.ssG) {
    const group = day.exs
      .map((e, i) => ({ e, i }))
      .filter((x) => x.e.ssG === ex.ssG);
    const pos = group.findIndex((x) => x.i === sesExIdx);
    let next = null;
    for (let j = 1; j <= group.length; j++) {
      const candidate = group[(pos + j) % group.length];
      if (candidate.e.sd.some((s) => !s.done)) {
        next = candidate;
        break;
      }
    }
    if (next) sesExIdx = next.i;
    else sesExIdx = day.exs.findIndex((e) => e.sd?.some((s) => !s.done));
  } else if (ex.sd.every((s) => s.done)) {
    let next = day.exs.findIndex(
      (e, i) => i > sesExIdx && e.sd?.some((s) => !s.done),
    );
    sesExIdx =
      next >= 0 ? next : day.exs.findIndex((e) => e.sd?.some((s) => !s.done));
  }
  sesRender();
  // In a superset recover only at the end of the round.
  if (
    !ex.ssG ||
    gD().exs[sesExIdx].ssG !== ex.ssG ||
    gD().exs[sesExIdx].sd.filter((s) => s.done).length >=
      ex.sd.filter((s) => s.done).length
  )
    tryStartRestTimer(ex);
}

// ===== Navigazione =====
function sesPrevEx() {
  persistSessionInputs();
  selectedSetIdx = null;
  if (sesExIdx > 0) {
    sesExIdx--;
    sesRender();
  }
}

function sesNextEx() {
  persistSessionInputs();
  selectedSetIdx = null;
  const day = gD();
  if (sesExIdx < day.exs.length - 1) {
    sesExIdx++;
    sesRender();
  }
}
function sesAdj(inputId, delta) {
  if (!["sesKg", "sesReps"].includes(inputId)) return;
  const el = document.getElementById(inputId);
  const min = inputId === "sesKg" ? 0 : 1;
  const max = inputId === "sesKg" ? 9999 : 999;
  const value = Math.min(
    max,
    Math.max(min, (parseFloat(el.value) || 0) + delta),
  );
  el.value = Number(value.toFixed(2));
  if (navigator.vibrate) navigator.vibrate(10);
}

// ===== Termina sessione =====
function sesFinish() {
  persistSessionInputs();
  const day = gD();
  const totalSets = day.exs.reduce((a, e) => a + (e.sd ? e.sd.length : 0), 0);
  const doneSets = day.exs.reduce(
    (a, e) => a + (e.sd ? e.sd.filter((s) => s.done).length : 0),
    0,
  );

  if (doneSets === 0) {
    exitSession();
    return;
  }

  if (!confirm(`Completare con ${doneSets}/${totalSets} serie fatte?`)) return;
  sesShowSummary();
}

function sesCompleteSave() {
  const day = gD();
  if (!day || sessionFinalized) return;
  sessionFinalized = true;
  const sessionId = uid();
  const sessionDate = new Date().toISOString();

  const today = toLocalDate(new Date());
  const yest = toLocalDate(new Date(Date.now() - 864e5));
  const s = D.st;
  let newPR = false;

  if (s.lwd === yest) s.sk = (s.sk || 0) + 1;
  else if (s.lwd !== today) s.sk = 1;
  s.lwd = today;
  s.tw = (s.tw || 0) + 1;

  const doneSetsAll = day.exs.reduce(
    (a, e) => a + (e.sd ? e.sd.filter((x) => x.done).length : 0),
    0,
  );
  s.ts = (s.ts || 0) + doneSetsAll;
  s.te = (s.te || 0) + day.exs.filter((e) => e.sd?.some((s) => s.done)).length;
  if (!s.pr) s.pr = {};

  day.exs.forEach((e) => {
    const doneS = e.sd ? e.sd.filter((x) => x.done) : [];
    if (!doneS.length) return;
    const maxW = Math.max(...doneS.map((x) => parseFloat(x.w) || 0));
    if (maxW > (s.pr[e.exerciseId] || 0)) {
      s.pr[e.exerciseId] = maxW;
      newPR = true;
    }
    const avgR = Math.round(
      doneS.reduce((a, x) => a + (parseInt(x.r) || 0), 0) / doneS.length,
    );
    D.hist.push({
      sessionId,
      duration: Math.floor((Date.now() - sesStartTime) / 1000),
      eid: e.exerciseId,
      name: e.name,
      dt: sessionDate,
      dayId: curDay,
      s: doneS.length,
      volumeKg:
        Math.round(
          doneS.reduce((total, set) => total + getSetVolume(set), 0) * 100,
        ) / 100,
      r: avgR,
      w: maxW,
      rest: e.rest || 0,
      seat: e.seat || null,
      sd: doneS.map((x) => ({ r: x.r, w: x.w })),
    });
  });

  delete D.activeSession;
  // Reset
  day.exs.forEach((e) => {
    if (e.sd) e.sd.forEach((x) => (x.done = false));
  });
  save();
}

function sesShowSummary() {
  if (sessionFinalized) return;
  const day = gD();
  if (!day) return;
  const report = getWorkoutReport(day, sesStartTime);
  if (!report.done) return;
  skipRestTimer();
  resetStopwatch();
  // Snapshot before finalization resets all done flags. Partial sessions stay truthful.
  sesCompleteSave();
  document.getElementById("sesExCard").style.display = "none";
  document.querySelector(".ses-nav").style.display = "none";
  document.getElementById("sesTimerToggle").disabled = true;
  renderSessionProgress(report.done, report.sets);
  renderWorkoutReport(report);
}
// ============================================================
// 📤📥 IMPORT / EXPORT (formato unico)
// ============================================================
const CSV_HEADER =
  "GIORNO\tN\tESERCIZIO\tID_ES\tSERIE\tREP\tRECUPERO\tCARICO\tTEMPO\tNOTE";

function detectSep(text) {
  const first = text.split("\n")[0] || "";
  return first.includes("\t") ? "\t" : ";";
}

function exportDay() {
  const day = gD();
  if (!day) return;
  document.getElementById("expTitle").textContent = "📤 " + day.name;
  document.getElementById("expText").value =
    CSV_HEADER + "\n" + exportDayToText(day);
  document.getElementById("mExport").style.display = "flex";
}

function exportAll() {
  if (!D.days.length) {
    toast("Nessuna giornata da esportare", "warn");
    return;
  }
  let out = CSV_HEADER + "\n";
  D.days.forEach((d) => {
    out += exportDayToText(d) + "\n";
  });
  document.getElementById("expTitle").textContent =
    "📤 Tutte le Giornate (" + D.days.length + ")";
  document.getElementById("expText").value = out.trim();
  document.getElementById("mExport").style.display = "flex";
}

function exportDayToText(day) {
  const lines = [];
  // Mappa superserie → numero + lettera progressiva
  const ssGroups = {};
  let ssNum = 1;
  const rendered = new Set();

  day.exs.forEach((ex) => {
    if (rendered.has(ex.uid)) return;

    if (ex.ssG) {
      const group = day.exs.filter((e) => e.ssG === ex.ssG);
      if (!ssGroups[ex.ssG]) {
        ssGroups[ex.ssG] = ssNum;
        ssNum++;
      }
      const num = ssGroups[ex.ssG];
      const letters = "abcdefgh";
      group.forEach((gex, gi) => {
        lines.push(exportExLine(day.name, num + letters[gi], gex));
        rendered.add(gex.uid);
      });
    } else {
      lines.push(exportExLine(day.name, String(ssNum), ex));
      ssNum++;
      rendered.add(ex.uid);
    }
  });

  return lines.join("\n");
}

function exportExLine(dayName, numField, ex) {
  const serieCount = ex.sd ? ex.sd.length : 0;

  // Reps: se tutte uguali → "10", se diverse → "10-8-6"
  let repStr = "";
  if (ex.sd && ex.sd.length) {
    const reps = ex.sd.map((s) => s.r || 0);
    const allSame = reps.every((r) => r === reps[0]);
    repStr = allSame ? String(reps[0]) : reps.join("/");
  }

  const formatSeries = (values) =>
    values.every((v) => v === values[0])
      ? String(values[0] ?? "")
      : values.map((v) => v ?? "-").join("/");
  const caricoStr = ex.sd?.length
    ? formatSeries(ex.sd.map((s) => s.w || 0))
    : "";

  // Recupero
  let recStr = "";
  if (ex.rest && ex.rest > 0) recStr = ex.rest + "s";

  // Tempo
  let tempoStr = "";
  if (ex.tempo && ex.tempo.split("-").some((p) => p && p !== "0")) {
    tempoStr = ex.tempo;
  }

  // Note
  const noteStr = (ex.note || "").replace(/\t/g, " ").replace(/\n/g, " ");

  return [
    dayName,
    numField,
    ex.name,
    ex.exerciseId,
    serieCount,
    repStr,
    recStr,
    caricoStr,
    tempoStr,
    noteStr,
  ]
    .map((v) => String(v ?? "").replace(/[\t\r\n]/g, " "))
    .join("\t");
}

function copyExport() {
  const text = document.getElementById("expText").value;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        toast("📋 Copiato negli appunti!", "ok");
      })
      .catch(() => fallbackCopy());
  } else {
    fallbackCopy();
  }
}

function fallbackCopy() {
  const el = document.getElementById("expText");
  el.select();
  el.setSelectionRange(0, 99999);
  const copied = document.execCommand("copy");
  toast(
    copied
      ? "Copiato negli appunti"
      : "Copia il testo selezionato con il menu del dispositivo.",
    copied ? "ok" : "info",
  );
}

// === IMPORT ===
function openImport() {
  document.getElementById("impText").value = "";
  document.getElementById("impPreview").style.display = "none";
  document.getElementById("mImport").style.display = "flex";
  setTimeout(() => document.getElementById("impText").focus(), 350);
}

function previewImport() {
  const text = document.getElementById("impText").value.trim();
  if (!text) {
    toast("Incolla prima il testo", "warn");
    return;
  }
  try {
    const days = parseImport(text);
    if (!days.length) {
      toast("Nessuna giornata trovata", "warn");
      return;
    }

    const existingNames = D.days.map((d) => d.name.toLowerCase());
    let html =
      '<b style="color:var(--grn);">Trovate ' + days.length + " giornate:</b>";
    days.forEach((d) => {
      const nEx = d.exs.length;
      const nSets = d.exs.reduce((a, e) => a + (e.sd ? e.sd.length : 0), 0);
      const nSS = new Set(d.exs.filter((e) => e.ssG).map((e) => e.ssG)).size;
      const exists = existingNames.includes(d.name.toLowerCase());
      html +=
        '<div style="margin-top:6px;padding:6px 10px;border-radius:8px;' +
        (exists
          ? "background:rgba(241,196,15,.1);border:1px solid rgba(241,196,15,.2);"
          : "background:var(--c3);") +
        '">';
      html +=
        "<b>" +
        escapeHTML(d.name) +
        "</b>" +
        (exists
          ? ' <span style="color:var(--yel);font-size:.65rem;">⚠️ GIÀ ESISTENTE</span>'
          : ' <span style="color:var(--grn);font-size:.65rem;">✨ NUOVA</span>');
      html +=
        '<br><span style="font-size:.7rem;color:var(--tx2);">' +
        nEx +
        " esercizi, " +
        nSets +
        " serie";
      if (nSS) html += ", " + nSS + " superserie";
      html += "</span></div>";
    });

    const conflicts = days.filter((d) =>
      existingNames.includes(d.name.toLowerCase()),
    );
    if (conflicts.length > 0) {
      html +=
        '<div style="margin-top:10px;padding:8px 12px;border-radius:8px;background:rgba(241,196,15,.08);border:1px solid rgba(241,196,15,.15);font-size:.72rem;color:var(--yel);">';
      html +=
        "⚠️ " +
        conflicts.length +
        " giornate esistenti verranno <b>sostituite</b> (storico sessioni preservato)";
      html += "</div>";
    }

    document.getElementById("impPreview").innerHTML = html;
    document.getElementById("impPreview").style.display = "block";
  } catch (e) {
    toast("❌ Errore: " + e.message, "err");
  }
}

function doImport() {
  const text = document.getElementById("impText").value.trim();
  if (!text) {
    toast("Incolla il testo della scheda", "warn");
    return;
  }

  try {
    const days = parseImport(text);
    if (!days.length) {
      toast("Nessuna giornata trovata", "warn");
      return;
    }

    const existingNames = D.days.map((d) => d.name.toLowerCase());
    const conflicts = days.filter((d) =>
      existingNames.includes(d.name.toLowerCase()),
    );
    const newDays = days.filter(
      (d) => !existingNames.includes(d.name.toLowerCase()),
    );

    let msg = "Importare " + days.length + " giornate?\n\n";
    if (conflicts.length > 0) {
      msg += "🔄 SOSTITUZIONE (" + conflicts.length + "):\n";
      conflicts.forEach(
        (d) => (msg += "  • " + d.name + " → " + d.exs.length + " esercizi\n"),
      );
      msg +=
        "\n(gli esercizi attuali verranno sostituiti,\nlo storico sessioni resta)\n";
    }
    if (newDays.length > 0) {
      msg += "\n✨ NUOVE (" + newDays.length + "):\n";
      newDays.forEach(
        (d) => (msg += "  • " + d.name + " → " + d.exs.length + " esercizi\n"),
      );
    }

    if (!confirm(msg)) return;

    let replaced = 0,
      added = 0;

    days.forEach((newDay) => {
      const existing = D.days.find(
        (d) => d.name.toLowerCase() === newDay.name.toLowerCase(),
      );
      if (existing) {
        existing.exs = newDay.exs;
        replaced++;
      } else {
        D.days.push(newDay);
        added++;
      }
    });

    save();
    document.getElementById("mImport").style.display = "none";
    openExercises.clear();

    if (curDay) renDay();
    renderAll();

    let resultMsg = "📥 ";
    if (replaced > 0) resultMsg += replaced + " sostituite";
    if (replaced > 0 && added > 0) resultMsg += ", ";
    if (added > 0) resultMsg += added + " aggiunte";
    toast(resultMsg, "ok");
    if (navigator.vibrate) navigator.vibrate([30, 15, 30]);
  } catch (e) {
    console.error("Import error:", e);
    toast("❌ Errore: " + e.message, "err");
  }
}

function parseImport(text) {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.trim());
  if (!lines.length) return [];

  const sep = detectSep(text);

  // Salta header
  let startIdx = 0;
  const firstCols = lines[0].split(sep).map((c) => c.trim().toUpperCase());
  if (firstCols.includes("GIORNO") || firstCols.includes("ESERCIZIO")) {
    startIdx = 1;
  }

  if (text.length > 1000000 || lines.length > 1000)
    throw new Error("Scheda troppo grande. Importa al massimo 1000 righe.");
  const daysMap = Object.create(null);
  const dayOrder = [];
  const ssMapGlobal = Object.create(null);

  for (let i = startIdx; i < lines.length; i++) {
    const cols = lines[i].split(sep).map((c) => c.trim());
    if (cols.length < 4)
      throw new Error(
        "Riga " + (i + 1) + ": formato incompleto. Usa TAB o punto e virgola.",
      );

    const dayName = cols[0] || "";
    const numField = cols[1] || "";
    const exName = cols[2] || "";
    const exId = cols[3] || "";
    const serieNum = cols[4] ? Number(cols[4]) : 1;
    if (!Number.isInteger(serieNum) || serieNum < 1 || serieNum > 100)
      throw new Error("Riga " + (i + 1) + ": imposta da 1 a 100 serie.");
    const repField = cols[5] || "";
    const recField = cols[6] || "";
    const carico = (cols[7] || "").replace(/,/g, ".");
    const tempo = cols[8] || "";
    // Header-aware import skips retired columns; legacy headerless 11-column rows
    // retain the final note instead of accidentally shifting it into another field.
    const noteIndex = startIdx
      ? firstCols.indexOf("NOTE")
      : cols.length >= 11
        ? 10
        : 9;
    const note = noteIndex >= 0 ? cols[noteIndex] || "" : "";

    if (!dayName || !exName) continue;

    // Crea giornata
    if (!daysMap[dayName]) {
      daysMap[dayName] = { id: uid(), name: dayName, exs: [] };
      dayOrder.push(dayName);
    }

    // Detect superserie dal campo N (es. 2a, 2b, 5a, 5b)
    let ssG = null;
    const ssMatch = numField.match(/^(\d+)([a-z])$/i);
    if (ssMatch) {
      const ssKey = dayName + "|" + ssMatch[1];
      if (!ssMapGlobal[ssKey]) ssMapGlobal[ssKey] = uid();
      ssG = ssMapGlobal[ssKey];
    }

    // Parse reps: "10", "12-15" → prende il primo numero
    let reps = parseInt(repField) || 0;

    // Parse recupero: "120s", "60s", "120", ""
    let rest = 0;
    const restMatch = recField.match(/(\d+)/);
    if (restMatch) rest = parseInt(restMatch[1]) || 0;

    // Parse carico/peso: "50 kg", "14+14 kg", "50", "Corpo", "Leggero", ""
    let weight = 0;
    let caricoNote = "";
    const dblMatch = carico.match(/([\d.]+)\s*\+\s*([\d.]+)/);
    if (dblMatch) {
      weight = parseFloat(dblMatch[1]) || 0;
    } else {
      const kgMatch = carico.match(/([\d.]+)/);
      if (kgMatch) weight = parseFloat(kgMatch[1]) || 0;
    }
    // Se il carico è testuale (Leggero, Moderato, Corpo, etc.), salvalo nelle note
    if (weight === 0 && carico && !carico.match(/^\s*$/)) {
      caricoNote = "💪 " + carico;
    }

    // Parse tempo: "3-1-2", ""
    let tempoClean = "";
    if (tempo) {
      if (
        !/^\d{1,2}-\d{1,2}-\d{1,2}$/.test(tempo) ||
        tempo.split("-").some((n) => Number(n) > 10)
      )
        throw new Error(
          "Riga " +
            (i + 1) +
            ": usa un tempo come 2-0-1, da 0 a 10 secondi per fase.",
        );
      tempoClean = tempo;
    }

    if (reps < 0 || reps > 999 || weight > 9999 || rest > 600)
      throw new Error("Riga " + (i + 1) + ": valori fuori intervallo.");

    // Pulisci nome (rimuovi "SS " prefix)
    let cleanName = exName;
    if (cleanName.match(/^SS\s+/i))
      cleanName = cleanName.replace(/^SS\s+/i, "");

    // Genera serie
    const sd = [];
    for (let s = 0; s < serieNum; s++) {
      const seriesValue = (field, fallback, max) => {
        if (!field.includes("/")) return fallback;
        const list = field.split("/");
        if (list.length !== serieNum)
          throw new Error(
            "Riga " +
              (i + 1) +
              ": i valori per serie non corrispondono al numero di serie.",
          );
        const raw = list[s].trim();
        const value = Number(raw);
        if (!Number.isFinite(value) || value < 0 || value > max)
          throw new Error("Riga " + (i + 1) + ": valore per serie non valido.");
        return value;
      };
      sd.push({
        r: seriesValue(repField, reps, 999),
        w: seriesValue(carico, weight, 9999),
        done: false,
      });
    }

    daysMap[dayName].exs.push({
      uid: uid(),
      exerciseId: exId || cleanName.replace(/\s+/g, "_"),
      name: cleanName,
      sd: sd,
      rest: rest,
      seat: "",
      ssG: ssG,
      pF: false,
      note: [caricoNote, note].filter(Boolean).join(" — "),
      tempo: tempoClean,
    });
  }

  return dayOrder.map((name) => daysMap[name]);
}
// ============================================================
// 🎊 CONFETTI
// ============================================================
function toggleTheme() {
  const next =
    document.documentElement.getAttribute("data-theme") === "dark"
      ? "light"
      : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("gym-theme", next);
  document.getElementById("thBtn").textContent = next === "dark" ? "🌙" : "☀️";
  // Rigenera muscle map con i colori del nuovo tema
  if (D) {
    try {
      if (document.getElementById("weeklyCard").open) renderWeeklyOverview();
    } catch (e) {}
    if (curDay) {
      try {
        renDay();
      } catch (e) {}
    }
  }
}
(function () {
  const t = localStorage.getItem("gym-theme") || "dark";
  document.documentElement.setAttribute("data-theme", t);
  document.getElementById("thBtn").textContent = t === "dark" ? "🌙" : "☀️";
})();

// ============================================================
// 🚀 INIT
// ============================================================
async function initGym() {
  if (!MIO) return;
  try {
    console.log("1. Loading exercises...");
    await loadExDB();
    console.log("2. Loading user data...");
    await load();
    console.log("3. Hiding loader...");
    document.getElementById("vLoad").style.display = "none";
    document.getElementById("vHome").style.display = "block";
    console.log("4. Rendering...");
    renderAll();
    // Auto-select input values on focus (faster data entry)
    document.addEventListener(
      "focus",
      (e) => {
        if (e.target.matches(".ses-input, .set-input")) {
          setTimeout(() => e.target.select(), 50);
        }
      },
      true,
    );
    console.log("5. Done!");
    // No greeting toast: the workout remains the primary content.
  } catch (e) {
    console.error("❌ ERRORE INIT:", e);

    const loader = document.getElementById("vLoad");
    if (loader) {
      loader.style.display = "block";
      document.getElementById("vHome").style.display = "none";
      loader.innerHTML = `
                <div style="color:var(--red);font-size:.85rem;padding:20px;text-align:left;">
                    <b>❌ Errore di caricamento:</b><br><br>
                    <code style="font-size:.75rem;color:var(--tx2);word-break:break-all;">${e.message}</code><br><br>
                    <button onclick="location.reload()">Riprova</button>
                </div>`;
    } // Chiude l'if
  } // Chiude il catch
} // initGym
