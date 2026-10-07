/* ==========================================================================
   FaW — banner di stato e toast, condivisi da tutti i giochi.

   Prima ogni gioco aveva la sua copia: `banner()`+`toast()` in Patata e in
   Nomi/Cose/Città, `showGameBanner` in Ruzzle, `showBanner` in Pictionary,
   box costruiti a mano nel Gioco del 15. Stesso ruolo, quattro look diversi.

   Qui c'è una sola struttura, con due modalità:

     - **pannello** (senza `color`): barra con i colori del tema — la usano
       Patata, Nomi/Cose/Città e il Gioco del 15;
     - **tinta** (con `color`): barra colorata con testo bianco, come i banner
       di Ruzzle e Pictionary.

   L'elemento conserva gli id storici (`#game-banner`, `#banner`) perché
   `games/shared/faw-layout.js` misura la loro altezza per non coprire il
   contenuto, e i test dei giochi li cercano per id.

   API:
     FAW_BANNER.banner({ id, icon, title, subtitle, color, buttons, spinner,
                         timer, sticky, vibrate, compact, priority })
     FAW_BANNER.aggiorna(id, { title, subtitle })
     FAW_BANNER.chiudi(id)
     FAW_BANNER.toast(msg, 'ok' | 'err')
   ========================================================================== */
(function (global) {
  'use strict';

  var BANNER_TIMEOUT = 6000;
  var TOAST_TIMEOUT = 2600;
  var timers = {};      // id → timeout di auto-chiusura
  var toasts = null;    // contenitore dei toast, creato alla prima chiamata

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function doc() { return global.document || null; }

  function elemento(id) { return doc() ? doc().getElementById(id) : null; }

  /* La tinta dei banner colorati è data dal gioco (es. viola attesa, verde
     vittoria): la sfumatura la calcola qui il componente, così nessun gioco
     deve portarsi dietro il proprio `adjustColor`. */
  function scurisci(hex, delta) {
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return hex;
    var h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    var r = Math.max(0, Math.min(255, ((n >> 16) & 255) + delta));
    var g = Math.max(0, Math.min(255, ((n >> 8) & 255) + delta));
    var b = Math.max(0, Math.min(255, (n & 255) + delta));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  function bottoniHtml(buttons) {
    return (buttons || []).map(function (b) {
      var etichetta = b.label != null ? b.label : b.text;
      var classi = b.kind || b.class || 'faw-btn faw-btn--ghost';
      if (b.chiaro) classi += ' faw-banner__btn--chiaro';
      var attrs = 'class="faw-banner__btn ' + esc(classi) + '"';
      if (b.id) attrs += ' data-bid="' + esc(b.id) + '"';
      if (b.disabled) attrs += ' disabled';
      if (b.title) attrs += ' title="' + esc(b.title) + '"';
      /* Ruzzle e Pictionary dichiarano l'handler come stringa (`onclick`),
         Patata e NCC come funzione: il componente accetta entrambi. */
      if (typeof b.onclick === 'string' && b.onclick) attrs += ' onclick="' + esc(b.onclick) + '"';
      return '<button type="button" ' + attrs + '>' + esc(etichetta) + '</button>';
    }).join('');
  }

  function contenuto(opts) {
    var azioni = '';
    /* la classe storica `banner-timer` resta per gli stili dei giochi */
    if (opts.timer != null) azioni += '<span class="faw-banner__timer banner-timer" id="banner-timer">' + esc(opts.timer) + 's</span>';
    azioni += bottoniHtml(opts.buttons);
    if (opts.spinner) azioni += '<span class="faw-banner__spin" aria-hidden="true"></span>';
    return '<span class="faw-banner__ico" aria-hidden="true">' + esc(opts.icon || '🎮') + '</span>' +
      '<div class="faw-banner__text">' +
        '<div class="faw-banner__title">' + esc(opts.title || '') + '</div>' +
        (opts.subtitle ? '<div class="faw-banner__sub">' + esc(opts.subtitle) + '</div>' : '') +
      '</div>' +
      '<div class="faw-banner__actions">' + azioni + '</div>';
  }

  /**
   * Mostra (o aggiorna) un banner di stato. Restituisce l'elemento usato.
   * `id` di default è `game-banner`; Patata e NCC usano `banner`.
   * Con `sticky: true` il banner resta finché non lo si chiude; senza, sparisce
   * da solo dopo `timeout` (6s).
   */
  function banner(opts) {
    var o = opts || {};
    var d = doc();
    if (!d || !d.body) return null;
    var id = o.id || 'game-banner';
    var el = elemento(id);
    if (!el) {
      el = d.createElement('div');
      el.id = id;
      d.body.appendChild(el);
    }
    el.className = 'faw-banner' + (o.color ? ' faw-banner--tinta' : ' faw-banner--pannello') +
      (o.flottante ? ' faw-banner--flottante' : '') +
      (o.compact ? ' faw-banner--compatto' : '') +
      (o.vibrate ? ' faw-banner--vittoria' : '');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    if (o.priority != null) el.setAttribute('data-priorita', String(o.priority));
    if (o.color) el.style.setProperty('--faw-banner-fill', o.color);
    else el.style.removeProperty('--faw-banner-fill');
    if (o.color) {
      el.style.background = 'linear-gradient(135deg, ' + o.color + ' 0%, ' + scurisci(o.color, -28) + ' 100%)';
    } else {
      el.style.removeProperty('background');
    }
    el.innerHTML = contenuto(o);
    el.style.removeProperty('display');
    el.classList.remove('hidden');
    el.removeAttribute('hidden');

    /* Handler come funzione: agganciati dopo il render, come facevano
       Patata e NCC con i loro `data-bid`. */
    (o.buttons || []).forEach(function (b) {
      if (!b || typeof b.fn !== 'function') return;
      var btn = b.id ? el.querySelector('[data-bid="' + b.id + '"]')
                     : el.querySelectorAll('.faw-banner__btn')[(o.buttons || []).indexOf(b)];
      if (btn) btn.addEventListener('click', b.fn);
    });

    clearTimeout(timers[id]);
    if (o.sticky !== true) {
      timers[id] = setTimeout(function () { chiudi(id); }, o.timeout || BANNER_TIMEOUT);
    }
    if (global.FAW_SYNC_BANNER_SPACE) global.FAW_SYNC_BANNER_SPACE();
    return el;
  }

  /** Aggiorna i testi di un banner già a video (senza ricostruirlo). */
  function aggiorna(id, testi) {
    var el = elemento(id || 'game-banner');
    if (!el) return null;
    var t = testi || {};
    var titolo = el.querySelector('.faw-banner__title');
    var sotto = el.querySelector('.faw-banner__sub');
    if (titolo && t.title != null) titolo.textContent = t.title;
    if (sotto && t.subtitle != null) sotto.textContent = t.subtitle;
    return el;
  }

  /** Nasconde il banner: l'altezza misurata da faw-layout torna a zero. */
  function chiudi(id) {
    var key = id || 'game-banner';
    clearTimeout(timers[key]);
    var el = elemento(key);
    if (!el) return null;
    el.style.display = 'none';
    el.classList.add('hidden');
    if (global.FAW_SYNC_BANNER_SPACE) global.FAW_SYNC_BANNER_SPACE();
    return el;
  }

  /* ---------------- TOAST ---------------- */

  function contenitoreToast() {
    var d = doc();
    if (!d || !d.body) return null;
    if (toasts && toasts.parentNode) return toasts;
    toasts = d.createElement('div');
    toasts.id = 'faw-toasts';
    toasts.className = 'faw-toasts';
    d.body.appendChild(toasts);
    return toasts;
  }

  /**
   * Messaggio breve in basso. `kind`: 'ok' | 'err' (o vuoto).
   * Più toast insieme restano impilati invece di sovrascriversi.
   */
  function toast(msg, kind) {
    var box = contenitoreToast();
    if (!box) return null;
    var el = doc().createElement('div');
    el.className = 'faw-toast' + (kind ? ' faw-toast--' + kind : '');
    el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
    el.textContent = msg;
    box.appendChild(el);
    var t = setTimeout(function () {
      el.classList.add('is-out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
    }, TOAST_TIMEOUT + (box.children.length - 1) * 400);
    el.addEventListener('click', function () {
      clearTimeout(t);
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    return el;
  }

  /** Il toast più recente (comodo nei test e per chi vuole aggiornarlo). */
  function ultimoToast() {
    var box = elemento('faw-toasts');
    return box && box.lastElementChild ? box.lastElementChild : null;
  }

  global.FAW_BANNER = {
    banner: banner,
    aggiorna: aggiorna,
    chiudi: chiudi,
    toast: toast,
    ultimoToast: ultimoToast,
    scurisci: scurisci,
    TIMEOUT: BANNER_TIMEOUT
  };
})(typeof window !== 'undefined' ? window : global);
