/* ============================================================
   PODIO CONDIVISO — fine partita multiplayer (tutti i giochi FaW)

   Una sola implementazione per Ruzzle, Patata Bollente, Nomi Cose Città,
   Gioco del 15 e Pictionary, così posizioni e punteggi sono sempre gli stessi:

     FAWPodio.render(document.getElementById('podio'), [
       { nome: 'ALFA', punti: 10, sottotitolo: '3 parole' },
       { nome: 'BETA', punti: 6 }
     ], { io: 'ALFA' });

   Regole:
   - ordine per punteggio decrescente (parità: nome in ordine alfabetico);
   - TUTTI i giocatori entrano nel podio, non solo i primi tre;
   - il gradino del 1° è il più alto e scende di STEP a ogni posizione.
   ============================================================ */
(function () {
  'use strict';

  var PODIO_MAX = 104;
  var PODIO_MIN = 32;
  var PODIO_STEP = 16;
  var AVATAR_COLORS = ['#fde68a', '#a7f3d0', '#bfdbfe', '#fbcfe8', '#ddd6fe', '#fed7aa', '#99f6e4', '#fecaca'];
  var MEDAGLIE = ['🥇', '🥈', '🥉'];
  var CLASSI = ['p1', 'p2', 'p3'];

  /** Altezza (px) del gradino per posizione: 1° = 104, poi -16, minimo 32. */
  function altezza(posIdx) {
    var i = Number(posIdx) || 0;
    return Math.max(PODIO_MIN, PODIO_MAX - i * PODIO_STEP);
  }

  /** Colore avatar deterministico: lo stesso nome ha sempre lo stesso colore. */
  function avatarColor(nome) {
    var s = String(nome == null ? '' : nome);
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function punti(riga) {
    var n = Number(riga && riga.punti);
    return isFinite(n) ? n : 0;
  }

  /** Classifica: punteggio decrescente, parità risolta sul nome. */
  function ordina(righe) {
    return (righe || []).slice().sort(function (a, b) {
      var d = punti(b) - punti(a);
      if (d !== 0) return d;
      return String(a && a.nome).localeCompare(String(b && b.nome));
    });
  }

  /** Markup del podio (stessa struttura in ogni gioco). */
  function html(righe, opts) {
    var o = opts || {};
    var classificate = ordina(righe);
    return classificate.map(function (r, i) {
      var h = altezza(i);
      var nome = String(r && r.nome != null ? r.nome : '');
      var sonoIo = r && r.tu !== undefined ? !!r.tu : (!!o.io && nome === o.io);
      var sub = r && r.sottotitolo != null ? r.sottotitolo : (o.etichetta ? o.etichetta(r, i) : '');
      return '<div class="pod-col ' + (CLASSI[i] || 'pn') + '" style="--pod-h:' + h + 'px" data-pos="' + (i + 1) + '">' +
        '<span class="pod-medal">' + (MEDAGLIE[i] || '#' + (i + 1)) + '</span>' +
        '<span class="pod-avatar" style="background:' + avatarColor(nome) + '">' +
          esc(nome.slice(0, 2).toUpperCase()) + '</span>' +
        '<span class="pod-name">' + esc(nome) + (sonoIo ? ' (TU)' : '') + '</span>' +
        '<div class="pod-bar" style="height:' + h + 'px"><span>' + punti(r) + '</span></div>' +
        (sub ? '<span class="pod-sub">' + esc(sub) + '</span>' : '') +
        '</div>';
    }).join('');
  }

  /** Disegna il podio dentro `container` e restituisce le righe ordinate. */
  function render(container, righe, opts) {
    var classificate = ordina(righe);
    if (!container) return classificate;
    container.classList.add('podio');
    container.innerHTML = html(classificate, opts);
    return classificate;
  }

  window.FAWPodio = {
    MAX: PODIO_MAX,
    MIN: PODIO_MIN,
    STEP: PODIO_STEP,
    altezza: altezza,
    avatarColor: avatarColor,
    esc: esc,
    ordina: ordina,
    html: html,
    render: render
  };
})();
