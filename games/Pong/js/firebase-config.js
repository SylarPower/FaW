/**
 * Adapter ES module verso la config Firebase condivisa di FaW.
 *
 * La config NON vive piu' qui: sta in `games/shared/firebase-config.js`, che
 * index.html di Pong carica come script classico PRIMA di `js/main.js`
 * (`type="module"`), quindi `window.FAW_FIREBASE_CONFIG` e' gia' disponibile
 * quando questo modulo viene valutato.
 *
 * Include `databaseURL`, necessario al Realtime Database delle stanze online.
 */

const sharedConfig = typeof window !== "undefined" ? window.FAW_FIREBASE_CONFIG : undefined;

if (!sharedConfig) {
  console.error(
    "[Pong] Config Firebase condivisa non trovata: assicurati che " +
    '<script src="../shared/firebase-config.js"></script> sia caricato in index.html ' +
    'prima di <script type="module" src="js/main.js"></script>. ' +
    "L'online resta disabilitato, vs CPU funziona comunque."
  );
}

export const firebaseConfig = sharedConfig || null;

export function isFirebaseConfigured() {
  return !!firebaseConfig &&
    typeof firebaseConfig.apiKey === "string" &&
    firebaseConfig.apiKey.length > 8 &&
    !firebaseConfig.apiKey.startsWith("YOUR_");
}
