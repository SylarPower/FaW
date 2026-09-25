/**
 * Firebase shared client layer — Focus at Work.
 *
 * All FaW pages still use the compat API because the games share a mature
 * `collection(...).doc(...).onSnapshot(...)` implementation.  The SDK version
 * is kept in the HTML includes, while this file centralises only the safe
 * bootstrap, IndexedDB cache and small public-data cache used by every game.
 */
(function (global) {
  "use strict";

  /* Firebase JavaScript SDK 12.19.0 (current at 2026-09-25). */
  global.FAW_FIREBASE_SDK_VERSION = "12.19.0";

  var config = {
    apiKey: "AIzaSyCNo7o2Ft22JDEyJ97BspE3Kur5DNAPKQc",
    authDomain: "funatwork-cd237.firebaseapp.com",
    projectId: "funatwork-cd237",
    storageBucket: "funatwork-cd237.firebasestorage.app",
    messagingSenderId: "798226885203",
    appId: "1:798226885203:web:ce83f4d9e96b82266274a6"
  };

  global.FAW_FIREBASE_CONFIG = Object.freeze(config);

  /**
   * True if the checked-in configuration is present rather than a placeholder.
   * This is deliberately not an authentication or authorisation check.
   */
  global.FAW_IS_FIREBASE_CONFIGURED = function () {
    var cfg = global.FAW_FIREBASE_CONFIG;
    return !!cfg &&
      typeof cfg.apiKey === "string" &&
      cfg.apiKey.length > 8 &&
      cfg.apiKey.indexOf("YOUR_") !== 0;
  };

  /**
   * IndexedDB persistence is enabled once for each Firestore instance.  It is
   * best-effort: multiple tabs and unsupported browsers continue online
   * normally.  Besides offline UX, warm starts can be served from the local
   * Firestore cache instead of an avoidable document read.
   */
  var persistenceByDb = typeof WeakMap === "function" ? new WeakMap() : null;
  global.FAW_ENABLE_PERSISTENCE = function (db) {
    if (!db || typeof db.enableIndexedDbPersistence !== "function") return Promise.resolve(false);
    if (persistenceByDb && persistenceByDb.has(db)) return persistenceByDb.get(db);

    var attempt = db.enableIndexedDbPersistence({ synchronizeTabs: true })
      .then(function () { return true; })
      .catch(function (err) {
        if (err && err.code === "failed-precondition") {
          console.warn("[FaW] Persistenza offline non abilitata: altre schede stanno usando Firestore.");
        } else if (err && err.code === "unimplemented") {
          console.warn("[FaW] Persistenza offline non supportata dal browser.");
        } else {
          console.warn("[FaW] Persistenza offline:", err ? (err.message || err.code) : err);
        }
        return false;
      });
    if (persistenceByDb) persistenceByDb.set(db, attempt);
    return attempt;
  };

  /**
   * Initialise exactly one default app and return its Firestore compat
   * instance.  Repeated scripts/tests cannot create a duplicate Firebase app.
   */
  global.FAW_INIT_FIRESTORE = function () {
    if (!global.firebase || typeof global.firebase.firestore !== "function") {
      throw new Error("script Firebase Firestore non caricati (CDN gstatic.com irraggiungibile?).");
    }
    var cfg = global.FAW_REQUIRE_FIREBASE_CONFIG();
    if (!cfg) throw new Error("config Firebase condivisa mancante (games/shared/firebase-config.js non caricato).");

    if (!global.firebase.apps || global.firebase.apps.length === 0) {
      global.firebase.initializeApp(cfg);
    }
    var db = global.firebase.firestore();
    global.FAW_ENABLE_PERSISTENCE(db);
    return db;
  };

  /*
   * Tiny TTL cache for public, rarely-changing documents (currently
   * config/dizionario).  It intentionally never caches game state, accounts,
   * invitations, or presence.  A cache hit saves one Firestore read at page
   * start without making multiplayer state stale.
   */
  var CACHE_PREFIX = "faw:cache:";
  global.FAW_READ_TTL_CACHE = function (key, ttlMs) {
    try {
      var raw = global.localStorage && global.localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      var entry = JSON.parse(raw);
      if (!entry || typeof entry.ts !== "number" || Date.now() - entry.ts > ttlMs) return null;
      return entry.value;
    } catch (err) {
      return null;
    }
  };
  global.FAW_WRITE_TTL_CACHE = function (key, value) {
    try {
      if (global.localStorage) {
        global.localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), value: value }));
      }
    } catch (err) { /* Storage is optional. */ }
  };

  /*
   * Shared dictionary overrides (config/dizionario). Ruzzle, Patata and NCC
   * used to keep three caches and each paid a Firestore read on a cold open.
   * One TTL (24h) is enough: a hit in any of the keys skips the read, and a
   * write refreshes all of them so the next game does not re-fetch.
   */
  var DICT_CACHE_ID = "dictionary-overrides-v1";
  var DICT_CACHE_TTL = 24 * 60 * 60 * 1000;
  var DICT_LOCAL_KEYS = ["faw_patata_dict_override", "faw_ncc_dict_override"];

  function dictValue(raw) {
    var extra = raw && Array.isArray(raw.extra) ? raw.extra : [];
    var excluded = raw && Array.isArray(raw.excluded) ? raw.excluded : [];
    return { extra: extra, excluded: excluded };
  }

  global.FAW_READ_DICTIONARY_OVERRIDES = function () {
    var shared = global.FAW_READ_TTL_CACHE(DICT_CACHE_ID, DICT_CACHE_TTL);
    if (shared) return dictValue(shared);
    try {
      for (var i = 0; i < DICT_LOCAL_KEYS.length; i++) {
        var raw = global.localStorage && global.localStorage.getItem(DICT_LOCAL_KEYS[i]);
        if (!raw) continue;
        var parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.ts !== "number") continue;
        if (Date.now() - parsed.ts > DICT_CACHE_TTL) continue;
        var value = dictValue(parsed);
        global.FAW_WRITE_TTL_CACHE(DICT_CACHE_ID, value);
        return value;
      }
    } catch (err) { /* cache is optional */ }
    return null;
  };

  global.FAW_WRITE_DICTIONARY_OVERRIDES = function (value) {
    var safe = dictValue(value);
    global.FAW_WRITE_TTL_CACHE(DICT_CACHE_ID, safe);
    try {
      if (!global.localStorage) return;
      var payload = JSON.stringify({ ts: Date.now(), extra: safe.extra, excluded: safe.excluded });
      DICT_LOCAL_KEYS.forEach(function (key) { global.localStorage.setItem(key, payload); });
    } catch (err) { /* Storage is optional. */ }
  };

  /* Relative luminance + WCAG contrast. Named colors used by the hub modes. */
  var NAMED_COLORS = { white: "#ffffff", black: "#000000", "#333": "#333333" };
  function parseHex(input) {
    if (!input) return null;
    var raw = String(input).trim().toLowerCase();
    if (NAMED_COLORS[raw]) raw = NAMED_COLORS[raw];
    if (raw.charAt(0) === "#") raw = raw.slice(1);
    if (raw.length === 3) raw = raw[0] + raw[0] + raw[1] + raw[1] + raw[2] + raw[2];
    if (!/^[0-9a-f]{6}$/.test(raw)) return null;
    return [parseInt(raw.slice(0, 2), 16), parseInt(raw.slice(2, 4), 16), parseInt(raw.slice(4, 6), 16)];
  }
  function channelLum(v) {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  function relLum(rgb) {
    return 0.2126 * channelLum(rgb[0]) + 0.7152 * channelLum(rgb[1]) + 0.0722 * channelLum(rgb[2]);
  }
  function contrast(a, b) {
    var l1 = relLum(a), l2 = relLum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  function toHex(rgb) {
    return "#" + rgb.map(function (v) {
      var n = Math.max(0, Math.min(255, Math.round(v)));
      return (n < 16 ? "0" : "") + n.toString(16);
    }).join("");
  }
  /**
   * Pair a fill with readable ink (>= 4.5:1). Keeps the proposed ink when it
   * already passes; otherwise picks dark or white ink. If the fill sits in the
   * dead zone (neither ink passes) it is darkened until white text does.
   */
  global.FAW_coppiaLeggibile = function (bg, fg) {
    var bgRgb = parseHex(bg);
    var fgRgb = parseHex(fg) || parseHex("#ffffff");
    var ink = parseHex("#1c2438");
    var white = parseHex("#ffffff");
    if (!bgRgb) return { bg: bg || "#1c2438", fg: fg || "#ffffff" };
    if (contrast(bgRgb, fgRgb) >= 4.5) return { bg: toHex(bgRgb), fg: toHex(fgRgb) };
    if (contrast(bgRgb, ink) >= 4.5) return { bg: toHex(bgRgb), fg: "#1c2438" };
    if (contrast(bgRgb, white) >= 4.5) return { bg: toHex(bgRgb), fg: "#ffffff" };
    var cur = bgRgb.slice();
    for (var i = 0; i < 14; i++) {
      cur = cur.map(function (v) { return Math.max(0, Math.round(v * 0.82)); });
      if (contrast(cur, white) >= 4.6) return { bg: toHex(cur), fg: "#ffffff" };
    }
    return { bg: "#1c2438", fg: "#ffffff" };
  };
  /** Darken a banner fill until white text clears 4.5:1. Hue stays. */
  global.FAW_fillPerTestoChiaro = function (bg) {
    return global.FAW_coppiaLeggibile(bg, "#ffffff").bg;
  };

  /**
   * Return the shared config, logging a useful diagnostic when inclusion order
   * is wrong.
   */
  global.FAW_REQUIRE_FIREBASE_CONFIG = function () {
    var cfg = global.FAW_FIREBASE_CONFIG;
    if (!cfg) {
      console.error(
        "[FaW] Config Firebase mancante: includi games/shared/firebase-config.js " +
        "PRIMA dello script che inizializza Firebase."
      );
    }
    return cfg;
  };
})(window);
