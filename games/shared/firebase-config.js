/**
 * Configurazione Firebase condivisa di FaW (Fun at Work).
 *
 * Questo file e' volutamente uno script browser "classico" (NON un modulo ES),
 * cosi' puo' essere incluso da tutte le pagine che usano Firebase compat
 * (index.html, ruzzle, patata, pictionary, gameof15, neonwar, palestra).
 *
 * Uso nelle pagine compat:
 *   <script src="games/shared/firebase-config.js"></script>   (dalla root)
 *   <script src="../shared/firebase-config.js"></script>      (da games/<gioco>/)
 *   ...
 *   firebase.initializeApp(window.FAW_FIREBASE_CONFIG);
 *
 * NOTA: `databaseURL` e' un retaggio del Realtime Database (ex-stanze online):
 * le pagine che usano solo Firestore lo ignorano senza effetti.
 */
(function (global) {
  "use strict";

  var config = {
    apiKey: "AIzaSyCNo7o2Ft22JDEyJ97BspE3Kur5DNAPKQc",
    authDomain: "funatwork-cd237.firebaseapp.com",
    databaseURL: "https://funatwork-cd237-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "funatwork-cd237",
    storageBucket: "funatwork-cd237.firebasestorage.app",
    messagingSenderId: "798226885203",
    appId: "1:798226885203:web:ce83f4d9e96b82266274a6"
  };

  global.FAW_FIREBASE_CONFIG = Object.freeze(config);

  /**
   * True se la config condivisa e' presente e sembra valorizzata davvero
   * (non un placeholder tipo YOUR_API_KEY).
   */
  global.FAW_IS_FIREBASE_CONFIGURED = function () {
    var cfg = global.FAW_FIREBASE_CONFIG;
    return !!cfg &&
      typeof cfg.apiKey === "string" &&
      cfg.apiKey.length > 8 &&
      cfg.apiKey.indexOf("YOUR_") !== 0;
  };

  /**
   * Abilita la cache offline di Firestore (IndexedDB persistence) su compat SDK.
   * Se fallisce (es. piu' schede aperte o browser senza supporto), degrada dolcemente.
   */
  global.FAW_ENABLE_PERSISTENCE = function (db) {
    if (!db || typeof db.enableIndexedDbPersistence !== 'function') return Promise.resolve(false);
    return db.enableIndexedDbPersistence({ synchronizeTabs: true })
      .then(function () { return true; })
      .catch(function (err) {
        if (err && err.code === 'failed-precondition') {
          console.warn('[FaW] Persistenza offline non abilitata: piu schede aperte contemporaneamente.');
        } else if (err && err.code === 'unimplemented') {
          console.warn('[FaW] Persistenza offline non supportata dal browser.');
        } else {
          console.warn('[FaW] Persistenza offline:', err ? (err.message || err.code) : err);
        }
        return false;
      });
  };

  /**
   * Restituisce la config condivisa, loggando un errore chiaro se manca
   * (tipicamente perche' questo file non e' stato incluso prima dello script
   * che inizializza Firebase, oppure il path relativo e' sbagliato).
   */
  global.FAW_REQUIRE_FIREBASE_CONFIG = function () {
    var cfg = global.FAW_FIREBASE_CONFIG;
    if (!cfg) {
      console.error(
        "[FaW] Config Firebase mancante: includi games/shared/firebase-config.js " +
        "PRIMA dello script che chiama firebase.initializeApp()."
      );
    }
    return cfg;
  };
})(window);
