/* Service worker della palestra (GymTracker Pro).
   Prima non esisteva: senza un service worker registrato il browser non
   considera la pagina una web app promuovibile e non mostra "Installa app".

   Regole di sicurezza dei dati:
   - Sono in cache SOLO gli asset statici dell'app (pagina, script, stili,
     icone, catalogo esercizi). Mai Firestore, mai le API di autenticazione:
     i progressi restano nel salvataggio local-first + cloud già esistente.
   - Le navigazioni vanno prima in rete e la cache serve solo offline, così
     un aggiornamento del sito non resta bloccato da una copia vecchia.
   - Il nome della cache include la versione: al cambio di CACHE_VERSION i
     vecchi file vengono eliminati. Per pubblicare modifiche che devono
     sostituire subito i file in cache basta incrementare quella stringa. */

const CACHE_VERSION = "gymtracker-v1";
const APP_SHELL = [
  "./index.html",
  "./base.css",
  "./premium.css",
  "./app.js",
  "./workout-metrics.js",
  "./training-program.js",
  "./premium.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "../../exercises.json",
];

/** Richieste che il service worker non deve mai intercettare. */
function gestioneEsterna(url) {
  return (
    url.origin !== self.location.origin ||
    url.pathname.indexOf("/__/") !== -1 // ambiente di anteprima/test
  );
}

/** Risposta di ripiego quando la rete manca e il file non è in cache. */
function ripiegoOffline() {
  return new Response(
    "<!doctype html><meta charset=\"utf-8\"><title>Offline</title>" +
      "<body style=\"font-family:system-ui;padding:32px;line-height:1.5\">" +
      "<h1>Sei offline</h1><p>Apri l’app almeno una volta con la connessione " +
      "attiva: i file resteranno sul telefono e la palestra si avvierà anche " +
      "senza rete.</p></body>",
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      // addAll fallisce in blocco se un solo file manca: meglio un file alla
      // volta, così un asset opzionale non impedisce l'installazione.
      .then((cache) =>
        Promise.all(
          APP_SHELL.map((file) =>
            cache.add(file).catch(() => undefined),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("gymtracker-") && key !== CACHE_VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (gestioneEsterna(url)) return;

  // Navigazioni: rete prima, cache (o pagina "offline") solo se la rete manca.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          if (response.ok)
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches
            .match(request)
            .then(
              (cached) =>
                cached ||
                caches
                  .match("./index.html")
                  .then((shell) => shell || ripiegoOffline()),
            ),
        ),
    );
    return;
  }

  // Catalogo esercizi: la pagina lo chiede con "no-cache", quindi qui la rete
  // ha la precedenza; la cache serve solo se la rete manca.
  if (/\/exercises\.json$/.test(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches
              .open(CACHE_VERSION)
              .then((cache) => cache.put(request, copy))
              .catch(() => undefined);
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || Response.error())),
    );
    return;
  }

  // Asset statici: cache prima, ma aggiornati in sottofondo dalla rete.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            caches
              .open(CACHE_VERSION)
              .then((cache) => cache.put(request, copy))
              .catch(() => undefined);
          }
          return response;
        })
        .catch(() => cached || Response.error());
      return cached || network;
    }),
  );
});
