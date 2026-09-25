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
