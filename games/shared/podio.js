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

   "Juice" di fine partita (opzioni del render, tutte attive di default):
   - `conta`: i punteggi salgono da 0 al valore finale (rispetto del
     `prefers-reduced-motion`, che li lascia subito al valore giusto);
   - `festa`: coriandoli condivisi (`.faw-confetti` di faw-ui.css) per chi ha
     vinto davvero — se il primo ha 0 punti non si festeggia niente;
   - `entra`: colonne che salgono in sequenza.
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

  /* ---------------- ANIMAZIONI (juice) ---------------- */

  function ridottaMovimento() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  /**
   * Fa salire i punteggi da 0 al valore finale. Il valore giusto resta
   * nell'aria-label (scritto da `html`), quindi i lettori di schermo non
   * sentono numeri intermedi.
   */
  function contaNumeri(container, durata) {
    if (!container || ridottaMovimento()) return;
    var raf = window.requestAnimationFrame;
    if (typeof raf !== 'function') return;
    var span = container.querySelectorAll('.pod-bar > span');
    var finali = [];
    for (var i = 0; i < span.length; i++) finali.push(Number(span[i].textContent) || 0);
    var t0 = null;
    var ms = Number(durata) || 750;
    function passo(t) {
      if (t0 === null) t0 = t;
      var k = Math.min(1, (t - t0) / ms);
      var ease = 1 - Math.pow(1 - k, 3);       // uscita morbida
      for (var j = 0; j < span.length; j++) {
        if (!span[j].isConnected) continue;
        span[j].textContent = String(Math.round(finali[j] * ease));
      }
      if (k < 1) raf(passo);
      else for (var h = 0; h < span.length; h++) if (span[h].isConnected) span[h].textContent = String(finali[h]);
    }
    // lo span parte da 0: il primo frame lo riporta al valore corrente
    for (var z = 0; z < span.length; z++) span[z].textContent = '0';
    raf(passo);
  }

  /** Coriandoli per il vincitore (particelle .faw-confetti di faw-ui.css). */
  function confetti(n) {
    if (!document.body || ridottaMovimento()) return null;
    var box = document.createElement('div');
    box.className = 'faw-confetti';
    var colori = ['#6366f1', '#a855f7', '#38bdf8', '#2fd67b', '#ffd166', '#ff5a6e'];
    var quanti = Number(n) || 30;
    for (var i = 0; i < quanti; i++) {
      var p = document.createElement('i');
      p.style.left = (4 + Math.random() * 92) + 'vw';
      p.style.background = colori[i % colori.length];
      p.style.animationDuration = (1.4 + Math.random() * 1.2) + 's';
      p.style.animationDelay = (Math.random() * 0.35) + 's';
      p.style.transform = 'rotate(' + (Math.random() * 360).toFixed(0) + 'deg)';
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 3200);
    return box;
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
          '<span class="faw-num">' + r.punti + '</span></div>' +
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

  /** Ingresso a scaletta, punteggi che salgono e coriandoli per il vincitore. */
  function anima(container, classificate, opts) {
    var o = opts || {};
    if (o.entra !== false) {
      /* L'animazione d'ingresso riparte solo quando il podio viene ridisegnato:
         la firma qui sopra impedisce i ridisegni inutili. */
      container.classList.remove('podio--entra');
      /* reflow: senza questo il browser non riavvia la transizione */
      void container.offsetWidth;
      container.classList.add('podio--entra');
    }
    if (o.conta !== false) contaNumeri(container, o.durataConta);
    var primo = classificate && classificate[0];
    if (o.festa !== false && primo && punti(primo) > 0) confetti(o.quantiConfetti);
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
    anima(container, classificate, opts);
    return classificate;
  }

  window.FAWPodio = {
    MAX: PODIO_MAX,
    MIN: PODIO_MIN,
    STEP: PODIO_STEP,
    UNITA: UNITA_DEFAULT,
    altezza: altezza,
    avatarColor: avatarColor,
    contaNumeri: contaNumeri,
    confetti: confetti,
    esc: esc,
    ordina: ordina,
    html: html,
    render: render
  };
})();
