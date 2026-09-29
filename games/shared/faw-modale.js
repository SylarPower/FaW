/* ==========================================================================
   FaW — modali di gioco: comportamento condiviso.

   I giochi hanno involucri diversi (`.modal-overlay` in Ruzzle, `.overlay` in
   Patata e Nomi/Cose/Città, `.overlay-screen` nel Gioco del 15) e ognuno
   gestisce l'apertura per conto suo. Quello che mancava ovunque era la parte
   "finestra": ruolo di dialogo per i lettori di schermo, chiusura con **Esc**
   e con un **click sullo sfondo**, e il focus che entra nella modale e torna
   da dove era partito.

   Questo modulo non cambia come i giochi mostrano le loro modali: si aggancia
   a un elemento esistente e aggiunge i comportamenti mancanti.

     var handle = FAW_MODALE.attiva('stats-modal', {
       chiudi: closeStats,          // chiamata da Esc / click sullo sfondo
       etichetta: 'Statistiche',    // aria-label (se manca)
       display: 'flex'              // valore di display all'apertura
     });
     handle.mostra();               // apre, sposta il focus, aria
     handle.nascondi();             // chiude, ripristina il focus

   Una modale senza `chiudi` resta solo decorata: nessuna chiusura implicita,
   così i flussi che devono passare da un pulsante restano tali.
   ========================================================================== */
(function (global) {
  'use strict';

  var registrate = [];   // handle attivi, in ordine di attivazione

  function doc() { return global.document || null; }

  function risolvi(rif) {
    var d = doc();
    if (!d) return null;
    return typeof rif === 'string' ? d.getElementById(rif) : rif;
  }

  /** La modale è a video? (stile calcolato, non solo attributi) */
  function visibile(el) {
    if (!el) return false;
    if (el.style && el.style.display === 'none') return false;
    var cs = global.getComputedStyle ? global.getComputedStyle(el) : null;
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
    return true;
  }

  /** C'è una modale registrata DOPO questa e a video? (Esc va a quella). */
  function coperta(handle) {
    var i = registrate.indexOf(handle);
    for (var j = registrate.length - 1; j > i; j--) {
      if (visibile(registrate[j].el)) return true;
    }
    return false;
  }

  function focalizzabile(el) {
    if (!el || !el.querySelector) return null;
    return el.querySelector(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]),' +
      ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
  }

  /**
   * Decora un elemento esistente come modale.
   * opts: { chiudi, etichetta, display, esc, sfondo, focus }
   * Restituisce un handle { el, mostra, nascondi, rilascia, aperta }.
   */
  function attiva(rif, opts) {
    var el = risolvi(rif);
    if (!el) return null;
    var o = opts || {};

    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    if (o.etichetta && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')) {
      el.setAttribute('aria-label', o.etichetta);
    }
    if (!el.getAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.classList.add('faw-dialog');

    var handle = {
      el: el,
      aperta: visibile(el),
      display: o.display || 'flex',
      chiudi: typeof o.chiudi === 'function' ? o.chiudi : null,
      mostra: mostra,
      nascondi: nascondi,
      rilascia: rilascia
    };

    function mostra() {
      /* Si ricorda da dove si è partiti SOLO se il focus non è già dentro la
         modale: riaprirla non deve perdere il punto di ritorno originale. */
      var attivo = (doc() && doc().activeElement) || null;
      var dentro = attivo && (attivo === el || el.contains(attivo));
      if (!dentro) handle.precedente = attivo;
      el.style.display = handle.display;
      allinea();
      var bersaglio = risolvi(o.focus) || focalizzabile(el) || el;
      if (bersaglio && bersaglio.focus) bersaglio.focus();
      return el;
    }

    /* L'aria segue la visibilità reale: i giochi aprono e chiudono le modali
       scrivendo style.display, quindi lo stato va riallineato anche quando la
       modifica non passa da qui (osservata con un MutationObserver). */
    function allinea() {
      if (visibile(el)) {
        el.removeAttribute('aria-hidden');
        el.setAttribute('data-aperta', '1');
      } else {
        el.setAttribute('aria-hidden', 'true');
        el.removeAttribute('data-aperta');
      }
    }

    function nascondi() {
      el.style.display = 'none';
      allinea();
      if (handle.precedente && handle.precedente.focus) handle.precedente.focus();
      return el;
    }

    /* Esc e click sullo sfondo funzionano solo se il gioco dichiara come si
       chiude quella modale (`chiudi`): una finestra che deve passare da un
       pulsante (es. la scelta obbligata della modalità) non si chiude da sola. */
    function chiediChiudi() {
      if (!handle.chiudi) return;
      handle.chiudi();
      allinea();
    }

    handle.__esc = function (e) {
      if (o.esc === false) return;
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      if (!visibile(el)) return;
      if (coperta(handle)) return;     // c'è una modale più recente aperta
      chiediChiudi();
    };
    handle.__click = function (e) {
      if (o.sfondo === false) return;
      if (e.target !== el) return;      // click sul contenuto, non sullo sfondo
      if (!visibile(el)) return;
      chiediChiudi();
    };

    if (doc()) doc().addEventListener('keydown', handle.__esc);
    el.addEventListener('click', handle.__click);
    var osservatore = null;
    if (global.MutationObserver) {
      osservatore = new global.MutationObserver(allinea);
      osservatore.observe(el, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    }
    allinea();
    registrate.push(handle);
    return handle;

    function rilascia() {
      if (doc()) doc().removeEventListener('keydown', handle.__esc);
      el.removeEventListener('click', handle.__click);
      if (osservatore) osservatore.disconnect();
      var i = registrate.indexOf(handle);
      if (i !== -1) registrate.splice(i, 1);
    }
  }

  global.FAW_MODALE = {
    attiva: attiva,
    visibile: visibile,
    registrate: registrate
  };
})(typeof window !== 'undefined' ? window : global);
