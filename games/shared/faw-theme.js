/* ==========================================================================
   FaW — tema (chiaro/scuro) nelle pagine dei giochi.

   L'hub salva la scelta in `localStorage['faw-theme']` e la applica a
   <html data-theme="...">, ma i giochi no: entrando in una partita il tema
   scelto si perdeva e i componenti condivisi (banner, toast, podio, pulsanti)
   tornavano chiari. Questo script fa la stessa cosa nelle pagine di gioco e va
   caricato nel <head>, PRIMA dei fogli di stile, così non c'è nessun lampo.

   Pagine con un solo tema (Ruzzle e Pictionary sono scuri per disegno, il
   Gioco del 15 è scuro): dichiarano il proprio tema sul tag script e la
   preferenza salvata non le riguarda.

     <script src="../shared/faw-theme.js" data-tema-fisso="dark"></script>
   ========================================================================== */
(function (global) {
  'use strict';

  var CHIAVE = 'faw-theme';
  var TEMA_FISSO = null;
  var TEMA = 'light';

  function normalizza(t) { return t === 'dark' ? 'dark' : (t === 'light' ? 'light' : null); }

  /* Il proprio tag (per leggere data-tema-fisso) prima che l'elemento sparisca
     dallo stack degli script in esecuzione. */
  var mio = global.document && global.document.currentScript;
  if (mio) {
    var fisso = normalizza(mio.getAttribute('data-tema-fisso'));
    if (fisso) TEMA_FISSO = fisso;
  }

  function salvato() {
    try { return normalizza(global.localStorage.getItem(CHIAVE)); }
    catch (e) { return null; }
  }

  /** Tema scelto dall'utente (l'hub lo salva; qui è solo da leggere). */
  function preferito() {
    // `var` a livello di modulo: un cambio arriva anche dagli altri tab
    // (evento `storage`) o da un'altra pagina (lettura del valore salvato).
    var s = salvato();
    return s || 'light';
  }

  function attuale() { return TEMA; }

  /** Applica il tema (quello salvato, oppure uno esplicito). */
  function applica(t) {
    if (TEMA_FISSO) t = TEMA_FISSO;
    else if (t === undefined || t === null) t = preferito();
    t = normalizza(t) || 'light';
    TEMA = t;
    if (global.document && global.document.documentElement) {
      global.document.documentElement.setAttribute('data-theme', t);
    }
    return t;
  }

  /** Cambia il tema e lo ricorda (come fa l'hub). */
  function imposta(t) {
    t = normalizza(t) || 'light';
    try { global.localStorage.setItem(CHIAVE, t); } catch (e) { /* noop */ }
    TEMA_FISSO = null;
    return applica(t);
  }

  applica();

  /* Tema cambiato in un altro tab: si aggiorna da solo. */
  if (global.addEventListener) {
    global.addEventListener('storage', function (e) {
      if (!e || e.key !== CHIAVE || TEMA_FISSO) return;
      applica(e.newValue);
    });
  }

  global.FAW_TEMA = {
    chiave: CHIAVE,
    attuale: attuale,
    preferito: preferito,
    applica: applica,
    imposta: imposta,
    fisso: function () { return TEMA_FISSO; }
  };
})(typeof window !== 'undefined' ? window : global);
