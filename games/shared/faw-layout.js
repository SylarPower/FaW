/**
 * FaW — layout condiviso.
 *
 * I giochi mostrano banner di stato ancorati in cima alla pagina
 * (`#game-banner` in ruzzle/pictionary, `#banner` in patata). Sono elementi
 * `position: fixed`, quindi finirebbero sopra l'header e il testo visibile.
 *
 * Questo script misura l'altezza reale del banner e la pubblica come
 * `--faw-banner-h`; `faw-ui.css` riserva quello spazio con uno spacer in
 * flusso (`body.faw-has-banner::before`), cosi' il contenuto scende invece di
 * essere coperto.
 *
 * Costo: un MutationObserver sui soli figli diretti di <body> + un
 * ResizeObserver sul banner. Nessuna scansione ricorsiva del DOM.
 */
(function (global) {
  "use strict";

  var SELECTORS = ["#game-banner", "#banner"];
  var resizeObserver = null;
  var lastHeight = -1;

  /* ATTENZIONE: la visibilita' va letta dagli stili, non dal box model.
     Il CSSOM View impone che il genitore di offset sia null per gli elementi
     `position: fixed`, e i banner di stato sono tutti fixed: affidarsi a quel
     campo disattiverebbe per sempre la riserva di spazio. */
  function visibile(el) {
    if (!el) return false;
    if (el.style && el.style.display === "none") return false;
    var cs = global.getComputedStyle ? global.getComputedStyle(el) : null;
    if (cs && (cs.display === "none" || cs.visibility === "hidden")) return false;
    return true;
  }

  function bannerAttivo() {
    for (var i = 0; i < SELECTORS.length; i++) {
      var el = document.querySelector(SELECTORS[i]);
      if (visibile(el)) return el;
    }
    return null;
  }

  function pubblica(altezza) {
    if (altezza === lastHeight) return;
    lastHeight = altezza;
    document.documentElement.style.setProperty("--faw-banner-h", altezza + "px");
    if (document.body) document.body.classList.toggle("faw-has-banner", altezza > 0);
  }

  function sync() {
    var el = bannerAttivo();
    if (!el) {
      if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
      pubblica(0);
      return;
    }
    if (!resizeObserver || resizeObserver.__el !== el) {
      if (resizeObserver) resizeObserver.disconnect();
      resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(function () {
        var cur = bannerAttivo();
        pubblica(cur ? cur.offsetHeight : 0);
      }) : null;
      if (resizeObserver) {
        resizeObserver.observe(el);
        resizeObserver.__el = el;
      }
    }
    // il ResizeObserver non esiste ovunque: riallineiamo comunque a ogni sync
    pubblica(el.offsetHeight);
  }

  function avvia() {
    if (!document.body) return;
    sync();
    if (typeof MutationObserver === "function") {
      new MutationObserver(sync).observe(document.body, { childList: true });
    }
    global.addEventListener("resize", sync);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", avvia);
  } else {
    avvia();
  }

  global.FAW_SYNC_BANNER_SPACE = sync;
  global.FAW_ELEMENTO_VISIBILE = visibile;
})(typeof window !== "undefined" ? window : globalThis);
