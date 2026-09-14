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
   - il gradino del 1° è il più alto e scende di STEP a ogni posizione;
   - le colonne hanno tutte la stessa struttura (medaglia, avatar, nome,
     gradino, sottotitolo): solo così i gradini restano incolonnati e la
     classifica si legge a colpo d'occhio anche con 5-6 giocatori;
   - il disegno è idempotente: se i dati non cambiano il podio non viene
     ridisegnato (niente sfarfallio quando il documento si aggiorna).
   ============================================================ */
(function () {
  'use strict';

  var PODIO_MAX = 104;
  var PODIO_MIN = 32;
  var PODIO_STEP = 16;
  var AVATAR_COLORS = ['#fde68a', '#a7f3d0', '#bfdbfe', '#fbcfe8', '#ddd6fe', '#fed7aa', '#99f6e4', '#fecaca'];
  var MEDAGLIE = ['🥇', '🥈', '🥉'];
  var CLASSI = ['p1', 'p2', 'p3'];
  var MEDAGLIE_TXT = ['medaglia d\'oro', 'medaglia d\'argento', 'medaglia di bronzo'];
  var UNITA_DEFAULT = 'punti';

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

  /** Riga di classifica normalizzata: nome, punti, sottotitolo, se sono io. */
  function riga(r, o, i) {
    var nome = String(r && r.nome != null ? r.nome : '');
    var sonoIo = r && r.tu !== undefined ? !!r.tu : (!!o.io && nome === o.io);
    var sub = r && r.sottotitolo != null ? r.sottotitolo : (o.etichetta ? o.etichetta(r, i) : '');
    return {
      nome: nome,
      punti: punti(r),
      sottotitolo: sub == null ? '' : String(sub),
      tu: sonoIo,
      posto: i + 1
    };
  }

  /** Testo per i lettori di schermo: "1° posto: ALFA, 120 punti, 3 parole". */
  function etichettaAria(r, unita) {
    var pos = r.posto === 1 ? '1\u00b0 posto' : r.posto + '\u00b0 posto';
    var testo = pos + ': ' + (r.nome || 'giocatore');
    testo += ', ' + r.punti + ' ' + (unita || UNITA_DEFAULT);
    if (r.sottotitolo) testo += ', ' + r.sottotitolo;
    if (r.tu) testo += ' (tu)';
    return testo;
  }

  /** Markup del podio (stessa struttura in ogni gioco). */
  function html(righe, opts) {
    var o = opts || {};
    var classificate = ordina(righe).map(function (r, i) { return riga(r, o, i); });
    var unita = o.unita || UNITA_DEFAULT;
    return classificate.map(function (r) {
      var h = altezza(r.posto - 1);
      var medaglia = MEDAGLIE[r.posto - 1] || '#' + r.posto;
      return '<div class="pod-col ' + (CLASSI[r.posto - 1] || 'pn') + '" data-pos="' + r.posto + '"' +
        (r.tu ? ' data-tu="1"' : '') + ' style="--pod-h:' + h + 'px" role="listitem" ' +
        'aria-label="' + esc(etichettaAria(r, unita)) + '">' +
        '<span class="pod-medal" aria-hidden="true" title="' + esc(MEDAGLIE_TXT[r.posto - 1] || r.posto + '\u00b0 posto') + '">' +
          esc(medaglia) + '</span>' +
        '<span class="pod-avatar" aria-hidden="true" style="background:' + avatarColor(r.nome) + '">' +
          esc(r.nome.slice(0, 2).toUpperCase()) + '</span>' +
        '<span class="pod-name">' + esc(r.nome) +
          (r.tu ? '<span class="pod-tu"> (TU)</span>' : '') + '</span>' +
        '<div class="pod-bar" style="height:' + h + 'px" aria-label="' + esc(r.punti + ' ' + unita) + '">' +
          '<span>' + r.punti + '</span></div>' +
        (r.sottotitolo ? '<span class="pod-sub">' + esc(r.sottotitolo) + '</span>' : '') +
        '</div>';
    }).join('');
  }

  /** Firma dei dati: serve a non ridisegnare un podio identico. */
  function firma(righe, opts) {
    var o = opts || {};
    return JSON.stringify([o.io || '', o.unita || '', (righe || []).map(function (r, i) {
      var n = riga(r, o, i);
      return [n.nome, n.punti, n.sottotitolo, n.tu];
    })]);
  }

  /** Disegna il podio dentro `container` e restituisce le righe ordinate. */
  function render(container, righe, opts) {
    var classificate = ordina(righe);
    if (!container) return classificate;
    container.classList.add('podio');
    var nuova = firma(classificate, opts);
    var colonne = container.querySelectorAll('.pod-col').length;
    /* Stesso contenuto e DOM intatto: non si tocca niente. Ruzzle ridisegna il
       podio a ogni aggiornamento della partita: senza questo controllo il podio
       sfarfallerebbe (e le transizioni dei gradini ripartirebbero da capo). */
    if (container.getAttribute('data-firma') === nuova && colonne === classificate.length) {
      return classificate;
    }
    container.setAttribute('data-firma', nuova);
    /* Con 5+ giocatori le colonne si stringono un po': il podio sta nello
       spazio disponibile senza tagliare le prime posizioni. */
    if (classificate.length > 4) container.setAttribute('data-molti', '1');
    else container.removeAttribute('data-molti');
    container.innerHTML = html(classificate, opts);
    /* Se le colonne non entrano (5-6 giocatori su schermi/colonne strette il
       podio scorre in orizzontale): la sfumatura sul bordo destro lo dice
       senza doverlo spiegare. Il confronto va fatto dopo aver disegnato. */
    if (container.scrollWidth > container.clientWidth + 1) container.setAttribute('data-scroll', '1');
    else container.removeAttribute('data-scroll');
    return classificate;
  }

  window.FAWPodio = {
    MAX: PODIO_MAX,
    MIN: PODIO_MIN,
    STEP: PODIO_STEP,
    UNITA: UNITA_DEFAULT,
    altezza: altezza,
    avatarColor: avatarColor,
    esc: esc,
    ordina: ordina,
    html: html,
    render: render
  };
})();
