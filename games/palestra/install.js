/* Installazione della palestra come app sul telefono.
   Storicamente la pagina non era installabile: mancavano manifest, icone e
   service worker, quindi il browser non mostrava "Installa app" e non
   considerava la pagina una web app. Qui:
   - si registra il service worker (serve anche per l'avvio offline);
   - si usa il prompt di installazione nativo dove esiste;
   - si mostrano istruzioni esplicite su iOS/iPadOS, dove il gesto è manuale;
   - si gestisce l'accesso nel contenitore isolato di iOS: una web app su Home
     Screen ha localStorage separato da Safari, quindi al primo avvio si
     chiede la password una volta e si ripristina lo stesso account.
   Nessun dato di allenamento viene copiato: schede e storico arrivano dal
   salvataggio local-first + cloud già esistente. */
"use strict";

const APP_PASSWORD_PROMPT_ID = "appPassword";
const FORM_APP_PASSWORD_ID = "formAppPassword";

/** Vero quando la pagina gira nella web app installata (non nel browser). */
function isInstalledApp() {
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    window.navigator.standalone === true ||
    document.referrer.startsWith("android-app://")
  );
}

/** iPhone/iPad: il browser non offre un prompt, l'utente usa Condividi → Home. */
function isIOS() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function installPromptAvailable() {
  return !!window.__gymInstallPrompt;
}

// ------------------------------------------------------------------
// Service worker: abilita installazione e avvio offline
// ------------------------------------------------------------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("sw.js", { scope: "./" })
      .catch((error) => console.warn("Service worker non registrato:", error));
  });
}

// ------------------------------------------------------------------
// Prompt nativo (Chrome/Edge/Samsung su Android e desktop)
// ------------------------------------------------------------------
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  window.__gymInstallPrompt = event;
  renderInstallCard();
});
window.addEventListener("appinstalled", () => {
  window.__gymInstallPrompt = null;
  toast("App installata. Si apre dalla Home del telefono.", "ok", 4000);
  renderInstallCard();
});

/** Pulsante "Installa": prompt nativo o istruzioni manuali. */
async function requestAppInstall() {
  const prompt = window.__gymInstallPrompt;
  if (prompt) {
    prompt.prompt();
    const choice = await prompt.userChoice;
    window.__gymInstallPrompt = null;
    if (choice.outcome === "accepted")
      toast("Installazione avviata. Controlla la Home del telefono.", "ok", 4000);
    renderInstallCard();
    return;
  }
  if (isIOS())
    alert(
      "Su iPhone/iPad l’installazione si fa dal browser:\n\n" +
        "1. Apri questa pagina in Safari.\n" +
        "2. Tocca Condividi (il quadrato con la freccia).\n" +
        "3. Scegli «Aggiungi alla Home».\n" +
        "4. Conferma con «Aggiungi».",
    );
  else
    alert(
      "Apri la pagina in Chrome (Android) oppure Chrome/Edge (computer): " +
        "nel menu del browser scegli «Installa app» o «Aggiungi alla schermata Home».",
    );
}

// ------------------------------------------------------------------
// Scheda di installazione: testo e stile seguono dispositivo e contesto
// ------------------------------------------------------------------
function refreshInstallCardText() {
  const hint = document.getElementById("installHint");
  if (hint)
    hint.textContent = installPromptAvailable()
      ? "Aggiunge l’icona alla Home e fa partire la palestra anche senza rete."
      : isIOS()
        ? "Su iPhone/iPad: tocca Condividi (il quadrato con la freccia) e scegli «Aggiungi alla Home». L’icona resta sul telefono e la palestra si apre anche senza rete."
        : "Dal menu del browser scegli «Installa app»: icona sulla Home e avvio anche senza rete.";
  const button = document.getElementById("installAppBtn");
  if (button)
    button.textContent = installPromptAvailable()
      ? "Installa l’app"
      : "Come installarla";
  // Già installata o già aperta come app: nessun invito da mostrare.
  const card = document.getElementById("installCard");
  if (card) card.hidden = isInstalledApp();
}

/** Scheda installazione in Home: sparisce quando l'app è già installata. */
function renderInstallCard() {
  refreshInstallCardText();
}

function dismissInstallCard() {
  const card = document.getElementById("installCard");
  if (card) card.hidden = true;
}

// ------------------------------------------------------------------
// Accesso nella web app installata (iOS isola lo storage da Safari)
// ------------------------------------------------------------------
/** Nome account noto in questo contenitore (Safari o app installata). */
function savedAccountName() {
  try {
    return localStorage.getItem("mioNome") || "";
  } catch (_) {
    return "";
  }
}

/** Tocca alla UI chiedere la password? Solo nell'app installata. */
function needsAppLogin() {
  return isInstalledApp() && !savedAccountName();
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Ripristina il nome account usato di solito in Safari (facoltativo). */
function fillSuggestedAccount() {
  const field = document.getElementById("appUsername");
  if (field && !field.value) field.value = localStorage.getItem("gym-last-user") || "";
}

async function submitAppLogin() {
  const userField = document.getElementById("appUsername");
  const passField = document.getElementById(APP_PASSWORD_PROMPT_ID);
  const name = (userField?.value || "").trim().toUpperCase();
  const password = (passField?.value || "").trim();
  if (name.length < 2 || password.length < 3) {
    alert("Nome minimo 2 caratteri, password minimo 3.");
    return;
  }
  const button = document.getElementById("appLoginBtn");
  const original = button ? button.textContent : "";
  if (button) {
    button.disabled = true;
    button.textContent = "Verifica…";
  }
  try {
    if (!db) throw new Error("Cloud non disponibile: controlla la connessione.");
    const doc = await db.collection("utenti").doc(name).get();
    if (!doc.exists) throw new Error("Utente non trovato. Contatta l’amministratore.");
    const hash = await sha256Hex(password);
    if (doc.data().passwordHash !== hash) throw new Error("Password errata.");
    localStorage.setItem("mioNome", name);
    localStorage.setItem("passwordHash", hash);
    localStorage.setItem("gym-last-user", name);
    location.reload();
  } catch (error) {
    alert("Accesso non riuscito: " + error.message);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

/** Ricorda l'account per le prossime installazioni (nome, non password). */
function rememberAccountName() {
  try {
    if (savedAccountName()) localStorage.setItem("gym-last-user", savedAccountName());
  } catch (_) {
    /* noop */
  }
}

/** Pulsante "Riprova" della schermata di errore (sessione scaduta). */
function signInAgain() {
  localStorage.removeItem("mioNome");
  location.replace(location.pathname);
}

if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", () => {
    rememberAccountName();
    renderInstallCard();
  });
else {
  rememberAccountName();
  renderInstallCard();
}
