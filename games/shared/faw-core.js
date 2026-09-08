/**
 * FAWCore — utility condivise del portale FaW.
 *
 * Script browser classico (nessuna build) che espone `window.FAWCore`;
 * le sole parti pure (id, rng, normalizzazione, formattazione, storage
 * "safe") sono anche un modulo UMD caricabile con `require()` nei test Node.
 *
 * Contenuti:
 *  - chiavi localStorage namespace per utente (niente `localStorage.clear()`)
 *  - RNG deterministica seedata (stessa famiglia usata da Ruzzle)
 *  - formattazione tempo / numeri / escaping HTML
 *  - toast, dialoghi accessibili, preferenze audio/movimento, tema
 */
(function (root, factory) {
  var mod = factory(root);
  if (typeof module === "object" && module.exports) module.exports = mod;
  if (root) root.FAWCore = mod;
})(typeof window !== "undefined" ? window : globalThis, function (global) {
  "use strict";

  var HAS_DOM = typeof document !== "undefined";

  /* ------------------------------- identici/pure ------------------------- */

  /** Nome utente corrente (chiave storica del portale). */
  function user() {
    try { return (global.localStorage.getItem("mioNome") || "").toUpperCase(); } catch (e) { return ""; }
  }

  /** Chiave namespace: `faw:<gioco>:<campo>[:<utente>]`. */
  function key(ns, campo, scope) {
    var base = "faw:" + ns + ":" + campo;
    return scope === "user" ? base + ":" + (user() || "-") : base;
  }

  function readJSON(ns, campo, def, scope) {
    try {
      var raw = global.localStorage.getItem(key(ns, campo, scope));
      if (raw == null) return def;
      return JSON.parse(raw);
    } catch (e) { return def; }
  }

  function writeJSON(ns, campo, value, scope) {
    try {
      global.localStorage.setItem(key(ns, campo, scope), JSON.stringify(value));
      return true;
    } catch (e) {
      // Quota superata o storage disabilitato: i dati restano solo in memoria.
      if (global.console) console.warn("[FaW] storage non disponibile:", e && e.message);
      return false;
    }
  }

  function readRaw(k, def) { try { var v = global.localStorage.getItem(k); return v == null ? def : v; } catch (e) { return def; } }
  function writeRaw(k, v) { try { global.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function removeRaw(k) { try { global.localStorage.removeItem(k); return true; } catch (e) { return false; } }

  /**
   * Rimuove SOLO i dati di sessione del portale.
   * Non tocca salvataggi giochi (paroliere_data, gameof15_save, df_legends_save),
   * cache palestra (gym-data-v2:*, gym-theme, gym-timer) e preferenze.
   */
  var SESSION_KEYS = ["mioNome", "passwordHash", "faw:last-route", "faw:hub:toast"];
  function clearSession() {
    var removed = [];
    SESSION_KEYS.forEach(function (k) { if (readRaw(k, null) != null) { removeRaw(k); removed.push(k); } });
    return removed;
  }

  /** id corto, ordinabile per tempo (usato anche come chiave di idempotenza). */
  function shortId(prefix) {
    var t = Date.now().toString(36).slice(-6);
    var r = Math.floor(Math.random() * 1679616).toString(36).padStart(4, "0");
    return (prefix ? prefix + "_" : "") + t + r;
  }

  function hash32(str) { // cyrb128 (come Ruzzle): identico => stessi seed => stesse griglie
    var h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (var i = 0, k; i < str.length; i++) {
      k = str.charCodeAt(i);
      h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
      h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
      h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
      h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
  }

  /** sfc32: PRNG veloce e deterministica. */
  function rngFrom(seedStr) {
    var s = hash32(String(seedStr));
    var a = s[0], b = s[1], c = s[2], d = s[3];
    return function () {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
      var t = (a + b) | 0;
      a = b ^ b >>> 9;
      b = c + (c << 3) | 0;
      c = (c << 21 | c >>> 11);
      d = (d + 1) | 0;
      t = (t + d) | 0;
      return (t >>> 0) / 4294967296;
    };
  }

  function pick(arr, rand) { return arr[Math.floor((rand ? rand() : Math.random()) * arr.length)]; }

  function shuffle(arr, rand) {
    var a = arr.slice();
    var r = rand || Math.random;
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /**
   * Normalizzazione condivisa delle risposte testuali (parole, categorie, nomi).
   * minuscole, senza accenti, senza punteggiatura, spazi singoli.
   */
  function normText(s) {
    return String(s == null ? "" : s)
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Forma "da dizionario": maiuscole, sole lettere A-Z (J K X Y W restano se presenti). */
  function normWord(s) {
    return normText(s).replace(/[^a-z]/g, "").toUpperCase();
  }

  /** Hash compatto per dedup (FNV-1a 32bit) — usato come suffisso di idempotenza. */
  function hashKey(s) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(36);
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ":" + String(s).padStart(2, "0");
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function initials(name) {
    var n = String(name || "?").replace(/[^A-Za-z0-9À-ÿ ]/g, "").trim();
    if (!n) return "?";
    var parts = n.split(/\s+/);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : n.slice(0, 2)).toUpperCase();
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /** Date breve in it-IT a partire da epoch ms. */
  function fmtDateTime(ms) {
    try {
      return new Date(ms).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch (e) { return ""; }
  }

  /* ------------------------------ preferenze ------------------------------ */

  var mqReduce = HAS_DOM && global.matchMedia ? global.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function reducedMotion() { return !!(mqReduce && mqReduce.matches); }

  function soundOn() { return readRaw(key("ui", "sound"), "1") === "1"; }
  function setSoundOn(v) { writeRaw(key("ui", "sound"), v ? "1" : "0"); }

  var audioCtx = null;
  var gesti = 0;
  /**
   * Suoni e vibrazioni partono solo dopo il primo gesto dell'utente: i browser
   * bloccano AudioContext e navigator.vibrate prima, e riempiono la console di
   * errori che sembrano guasti del gioco.
   */
  function armaSuoni() {
    if (!HAS_DOM || gesti > 0) return;
    var segna = function () { gesti++; };
    document.addEventListener("pointerdown", segna, { once: true, passive: true });
    document.addEventListener("keydown", segna, { once: true });
  }
  function suoniArmati() { return gesti > 0; }

  /** Biped breve generato via WebAudio: niente file, niente download. */
  function beep(kind) {
    if (!soundOn() || !HAS_DOM || gesti === 0) return;
    try {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      audioCtx = audioCtx || new AC();
      if (audioCtx.state === "suspended") audioCtx.resume();
      var presets = {
        ok: [[660, 0.06], [880, 0.08]],
        bad: [[220, 0.12]],
        tick: [[1100, 0.03]],
        boom: [[120, 0.28], [80, 0.3]],
        start: [[520, 0.07], [700, 0.07], [900, 0.12]],
        ping: [[900, 0.05]]
      };
      var notes = presets[kind] || presets.ping;
      var t = audioCtx.currentTime;
      notes.forEach(function (n, i) {
        var osc = audioCtx.createOscillator();
        var g = audioCtx.createGain();
        osc.type = kind === "boom" ? "sawtooth" : "sine";
        osc.frequency.setValueAtTime(n[0], t + i * 0.07);
        g.gain.setValueAtTime(0.0001, t + i * 0.07);
        g.gain.exponentialRampToValueAtTime(0.16, t + i * 0.07 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.07 + n[1]);
        osc.connect(g); g.connect(audioCtx.destination);
        osc.start(t + i * 0.07); osc.stop(t + i * 0.07 + n[1] + 0.02);
      });
    } catch (e) { /* audio facoltativo: mai bloccare il gioco */ }
  }

  function vibrate(pattern) {
    try {
      if (HAS_DOM && gesti > 0 && global.navigator && navigator.vibrate && !reducedMotion()) navigator.vibrate(pattern);
    } catch (e) {}
  }

  /** Tema: scuro di default. La palestra ha il proprio `gym-theme` e non viene toccata. */
  function applyTheme(theme) {
    if (!HAS_DOM) return;
    document.body.setAttribute("data-theme", theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#f2f4f6" : "#0d1013");
  }
  /**
   * Scuro di default (identità del portale e della palestra), chiarezza solo su
   * scelta esplicita e memorizzata: così i giochi non cambiano aspetto al variare
   * dell'orario di sistema e il contrasto resta quello verificato nei test.
   */
  function initTheme() {
    var saved = readRaw(key("ui", "theme"), null);
    var t = saved === "light" ? "light" : "dark";
    applyTheme(t);
    return t;
  }
  function toggleTheme() {
    var cur = (HAS_DOM && document.body.getAttribute("data-theme")) === "light" ? "light" : "dark";
    var next = cur === "light" ? "dark" : "light";
    writeRaw(key("ui", "theme"), next);
    applyTheme(next);
    return next;
  }

  /* --------------------------------- toast -------------------------------- */

  var toastLayer = null;
  function toast(msg, kind, ms) {
    if (!HAS_DOM) return;
    if (!toastLayer) {
      toastLayer = document.createElement("div");
      toastLayer.className = "faw-toast-layer";
      toastLayer.setAttribute("role", "status");
      toastLayer.setAttribute("aria-live", "polite");
      document.body.appendChild(toastLayer);
    }
    var el = document.createElement("div");
    el.className = "faw-toast" + (kind ? " faw-toast--" + kind : "");
    el.textContent = msg;
    toastLayer.appendChild(el);
    setTimeout(function () {
      el.style.transition = "opacity 220ms linear";
      el.style.opacity = "0";
      setTimeout(function () { el.remove(); }, 240);
    }, ms || 2600);
  }

  /* ------------------------------- dialoghi -------------------------------- */
  /* Dialog nativo: focus management, Escape e backdrop gestiti dal browser.   */

  var openDialogs = [];

  function showDialog(node) {
    if (!HAS_DOM || !node) return null;
    if (typeof node.showModal !== "function") { // fallback browser vecchi
      node.setAttribute("open", "");
    } else {
      node.showModal();
    }
    openDialogs.push(node);
    var first = node.querySelector("[data-autofocus], input, button, [tabindex]");
    if (first) setTimeout(function () { try { first.focus(); } catch (e) {} }, 30);
    return node;
  }

  function closeDialog(node) {
    if (!HAS_DOM) return;
    node = node || openDialogs[openDialogs.length - 1];
    if (!node) return;
    if (typeof node.close === "function") node.close(); else node.removeAttribute("open");
    var i = openDialogs.indexOf(node);
    if (i >= 0) openDialogs.splice(i, 1);
    if (node.__fawOnClose) { var cb = node.__fawOnClose; node.__fawOnClose = null; cb(false); }
  }

  /** Costruisce un dialogo modale con azioni; risolve true/false (doppio tocco filtrato). */
  function confirmDialog(opts) {
    return new Promise(function (resolve) {
      if (!HAS_DOM) return resolve(!!opts.defaultValue);
      var dlg = document.createElement("dialog");
      dlg.className = "faw-dialog";
      dlg.setAttribute("aria-labelledby", "faw-dlg-title");
      dlg.innerHTML =
        '<div class="faw-dialog__head"><h2 id="faw-dlg-title">' + escapeHtml(opts.title || "Confermi?") + "</h2></div>" +
        '<div class="faw-dialog__body"><p class="faw-dim">' + escapeHtml(opts.message || "") + "</p></div>" +
        '<div class="faw-dialog__foot">' +
        '<button class="faw-btn" data-act="no">' + escapeHtml(opts.cancelLabel || "Annulla") + "</button>" +
        '<button class="faw-btn ' + (opts.danger ? "faw-btn--danger-solid" : "faw-btn--primary") + '" data-act="yes" data-autofocus>' +
        escapeHtml(opts.okLabel || "Conferma") + "</button></div>";
      document.body.appendChild(dlg);
      var done = false;
      function finish(v) {
        if (done) return;
        done = true;
        if (typeof dlg.close === "function") dlg.close();
        setTimeout(function () { dlg.remove(); }, 0);
        resolve(v);
      }
      dlg.addEventListener("click", function (e) {
        var b = e.target.closest("[data-act]");
        if (b) finish(b.getAttribute("data-act") === "yes");
        else if (e.target === dlg) finish(false);
      });
      dlg.addEventListener("cancel", function (e) { e.preventDefault(); finish(false); });
      showDialog(dlg);
    });
  }

  /* ------------------------------ tastiera mobile -------------------------- */
  /**
   * Su mobile la tastiera virtuale copre l'input attivo. `100dvh` +
   * `interactive-widget=resizes-content` (meta) gestisce il grosso; qui si
   * aggiunge lo scroll-into-view dell'input attivo.
   */
  function keepInputVisible(input, delay) {
    if (!HAS_DOM || !input) return;
    setTimeout(function () {
      try { input.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" }); } catch (e) {}
    }, delay == null ? 260 : delay);
  }

  /* ------------------------------ retry/idemp. ----------------------------- */
  /** Esecuzione con backoff esponenziale (per scritture Firestore in coda). */
  function withRetry(fn, attempts, baseMs) {
    attempts = attempts || 3;
    baseMs = baseMs || 240;
    var p = Promise.resolve();
    var lastErr;
    function step(i) {
      if (i >= attempts) return Promise.reject(lastErr);
      return Promise.resolve()
        .then(fn)
        .catch(function (e) {
          lastErr = e;
          return new Promise(function (res) { setTimeout(res, baseMs * Math.pow(2, i)); }).then(function () { return step(i + 1); });
        });
    }
    return step(0);
  }

  /** Debounce con cancel (per scritture aggregate). */
  function debounce(fn, wait) {
    var t = null;
    var wrapped = function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(self, args); }, wait);
    };
    wrapped.flush = function () { if (t) { clearTimeout(t); t = null; fn(); } };
    wrapped.pending = function () { return !!t; };
    return wrapped;
  }

  /** Throttle "leading+trailing": al massimo un invocation ogni `wait`. */
  function throttle(fn, wait) {
    var last = 0, timer = null, lastArgs = null;
    return function () {
      var now = Date.now(), self = this, args = arguments;
      var rest = wait - (now - last);
      lastArgs = args;
      if (rest <= 0) {
        if (timer) { clearTimeout(timer); timer = null; }
        last = now;
        fn.apply(self, args);
      } else if (!timer) {
        timer = setTimeout(function () { timer = null; last = Date.now(); fn.apply(self, lastArgs); }, rest);
      }
    };
  }

  /**
   * Doppio tocco: blocca la seconda chiamata entro `ms`.
   * Le azioni di gioco (invio parola, pronto, rivincita) devono essere idempotenti
   * anche oltre questo guard, ma il guard evita richieste inutili e UI "doppie".
   */
  function onceGuard(ms) {
    var t = 0;
    return function (id) {
      var now = Date.now();
      var k = id || "_";
      if (!onceGuard._m) onceGuard._m = {};
      if (onceGuard._m[k] && now - onceGuard._m[k] < (ms || 700)) return false;
      onceGuard._m[k] = now;
      return true;
    };
  }

  function onVisible(cb) {
    if (!HAS_DOM) return;
    document.addEventListener("visibilitychange", function () { cb(!document.hidden); });
  }

  function qs(name) {
    try { return new URLSearchParams(location.search).get(name); } catch (e) { return null; }
  }

  return {
    HAS_DOM: HAS_DOM,
    user: user, key: key,
    readJSON: readJSON, writeJSON: writeJSON, readRaw: readRaw, writeRaw: writeRaw, removeRaw: removeRaw,
    clearSession: clearSession, SESSION_KEYS: SESSION_KEYS,
    shortId: shortId, hash32: hash32, rngFrom: rngFrom, pick: pick, shuffle: shuffle,
    normText: normText, normWord: normWord, hashKey: hashKey,
    fmtTime: fmtTime, fmtDateTime: fmtDateTime, escapeHtml: escapeHtml, initials: initials, clamp: clamp,
    reducedMotion: reducedMotion, soundOn: soundOn, setSoundOn: setSoundOn, beep: beep, vibrate: vibrate,
    armaSuoni: armaSuoni, suoniArmati: suoniArmati,
    initTheme: initTheme, toggleTheme: toggleTheme, applyTheme: applyTheme,
    toast: toast, showDialog: showDialog, closeDialog: closeDialog, confirmDialog: confirmDialog,
    keepInputVisible: keepInputVisible,
    withRetry: withRetry, debounce: debounce, throttle: throttle, onceGuard: onceGuard,
    onVisible: onVisible, qs: qs
  };
});
