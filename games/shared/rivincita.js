/*
 * Rivincita condivisa. La proposta vive sul documento della partita già in
 * corso (niente collection nuova, niente indice): prossimaPartita,
 * prossimaPartitaCreataDa, prossimaPartitaGioco, rivincitaAccettataDa,
 * rivincitaRifiutataDa. Il documento nuovo è una lobby del gioco scelto,
 * marcata come rivincita: l'hub la mostra come lobby da raggiungere, non come
 * una seconda sfida da accettare (vedi sotto).
 *
 * Chi crea non deve ri-accettare. Si entra tutti insieme solo quando ogni
 * altro partecipante ha accettato. Un rifiuto blocca quella proposta; se ne
 * può aprire un'altra, e il documento orfano viene cancellato.
 *
 * La lobby nuova porta `daRivincita: true`, `rivincitaDi: <partita di origine>`
 * e `rivincitaCollezione` (la collezione dell'origine: `partite` o
 * `pictionary_rooms`): così l'hub la mostra come lobby da raggiungere (non
 * come una seconda sfida da accettare) e chi ci entra segna l'accettazione
 * sulla partita di origine (`segnaAccettazione`), liberando gli altri.
 *
 * La scelta del gioco e delle impostazioni passa da un'unica modale
 * (`apriScelta`): schede per i giochi (quello corrente in evidenza) e, per il
 * gioco selezionato, i controlli descritti dallo schema `GIOCHI[id].opzioni`.
 * Lo schema è l'unica fonte dei valori ammessi: `opzioniScelte` scarta
 * qualunque valore fuori elenco, quindi la lobby nasce sempre valida.
 */
(function (global) {
  'use strict';

  var GIOCHI = {
    ruzzle: {
      nome: 'Ruzzle', icona: '🔠', descrizione: 'Parole sulla griglia',
      min: 1, max: 10, collezione: 'partite', query: 'matchId',
      opzioni: [
        { id: 'tempo', label: 'Durata', def: '60', valori: [
          { v: '30', label: '30 secondi', breve: '30s' },
          { v: '60', label: '60 secondi (standard)', breve: '60s' },
          { v: '90', label: '90 secondi', breve: '90s' },
          { v: '180', label: '3 minuti', breve: '3 min' },
          { v: '300', label: '5 minuti', breve: '5 min' }
        ] },
        { id: 'griglia', label: 'Griglia', def: '5', valori: [
          { v: '3', label: '3×3 (facile)', breve: '3×3' },
          { v: '4', label: '4×4', breve: '4×4' },
          { v: '5', label: '5×5 (classica)', breve: '5×5' },
          { v: '6', label: '6×6', breve: '6×6' },
          { v: '7', label: '7×7 (difficile)', breve: '7×7' },
          { v: '10', label: '10×10 (estrema)', breve: '10×10' }
        ] }
      ],
      modalita: [
        { id: 'classic', label: 'CLASSICA' },
        { id: 'bonus', label: 'BONUS ⭐', breve: 'BONUS' },
        { id: 'crazy', label: 'CRAZY 🤪', breve: 'CRAZY' }
      ]
    },
    patata: {
      nome: 'Patata Bollente', icona: '🥔', descrizione: 'Parole a staffetta contro il tempo',
      min: 2, max: 8, collezione: 'partite', query: 'matchId',
      opzioni: [
        { id: 'tempo', label: 'Countdown', def: '60', valori: [
          { v: '30', label: '30 secondi (fulmine)', breve: '30s' },
          { v: '60', label: '60 secondi (standard)', breve: '60s' },
          { v: '120', label: '120 secondi (relax)', breve: '120s' }
        ] },
        { id: 'turni', label: 'Turni', def: '3', valori: [
          { v: '1', label: '1 turno' }, { v: '2', label: '2 turni' },
          { v: '3', label: '3 turni' }, { v: '4', label: '4 turni' },
          { v: '5', label: '5 turni' }
        ] },
        { id: 'lettere', label: 'Lettere', def: '3', valori: [
          { v: '2', label: '2 lettere', breve: '2 lettere' },
          { v: '3', label: '3 lettere', breve: '3 lettere' },
          { v: '4', label: '4 lettere', breve: '4 lettere' }
        ] }
      ],
      modalita: [
        { id: 'classic', label: 'CLASSICA 🥔', breve: 'CLASSICA' },
        { id: 'sequenza', label: 'SEQUENZA 🔗', breve: 'SEQUENZA' },
        { id: 'mix', label: 'MIX 🔀', breve: 'MIX' }
      ]
    },
    'nomi-cose-citta': {
      nome: 'Nomi, Cose, Città', icona: '📝', descrizione: 'Una lettera, tante categorie',
      min: 2, max: 8, collezione: 'partite', query: 'matchId',
      opzioni: [
        { id: 'round', label: 'Round', def: '3', valori: [
          { v: '1', label: '1 round' }, { v: '2', label: '2 round' },
          { v: '3', label: '3 round' }, { v: '5', label: '5 round' }
        ] },
        { id: 'tempo', label: 'Compilazione', def: '120', valori: [
          { v: '60', label: '60 secondi (sprint)', breve: '60s' },
          { v: '120', label: '120 secondi (standard)', breve: '120s' },
          { v: '180', label: '180 secondi (relax)', breve: '180s' }
        ] },
        { id: 'revisione', label: 'Revisione', def: '90', valori: [
          { v: '60', label: '60 secondi', breve: '60s' },
          { v: '90', label: '90 secondi', breve: '90s' },
          { v: '120', label: '120 secondi', breve: '120s' }
        ] },
        { id: 'categorie', label: 'Categorie', def: 'multi',
          /* Le partite di NCC tengono le categorie risolte ({id,label}): qui
             si risale al preset per riproporre la scelta in modale. */
          daCorrenti: function (v) {
            if (Array.isArray(v)) return v.length >= 7 ? 'multi' : 'light';
            return String(v || '') === 'light' ? 'light' : 'multi';
          },
          valori: [
            { v: 'multi', label: '7 categorie (complete)', breve: '7 categorie' },
            { v: 'light', label: '3 categorie (nomi, cose, città)', breve: '3 categorie' }
          ] }
      ],
      modalita: [
        { id: 'classica', label: 'CLASSICA 📝', breve: 'CLASSICA' }
      ]
    },
    pictionary: {
      nome: 'Pictionary', icona: '🎨', descrizione: 'Disegna e indovina',
      min: 2, max: 8, collezione: 'pictionary_rooms', query: 'room',
      opzioni: [
        { id: 'timePerRound', label: 'Tempo per turno', def: '60', valori: [
          { v: '30', label: '30 secondi', breve: '30s' },
          { v: '45', label: '45 secondi', breve: '45s' },
          { v: '60', label: '60 secondi (standard)', breve: '60s' },
          { v: '90', label: '90 secondi', breve: '90s' },
          { v: '120', label: '120 secondi', breve: '120s' }
        ] }
      ],
      modalita: [
        { id: 'classic', label: 'SFIDA 🎨', breve: 'SFIDA' },
        { id: 'guessit', label: 'GUESS IT! 🔮', breve: 'GUESS IT' }
      ]
    },
    gameof15: {
      nome: 'Gioco del 15', icona: '🧩', descrizione: 'Ricomponi il puzzle',
      min: 1, max: 8, collezione: 'partite', query: 'matchId',
      opzioni: [
        { id: 'durata', label: 'Tempo limite', def: '180', valori: [
          { v: '120', label: '2 minuti (sprint)', breve: '2 min' },
          { v: '180', label: '3 minuti (standard)', breve: '3 min' },
          { v: '300', label: '5 minuti (relax)', breve: '5 min' },
          { v: '600', label: '10 minuti (zen)', breve: '10 min' }
        ] },
        { id: 'griglia', label: 'Griglia', def: '4', valori: [
          { v: '3', label: '3×3 (facile)', breve: '3×3' },
          { v: '4', label: '4×4 (classico)', breve: '4×4' },
          { v: '5', label: '5×5 (difficile)', breve: '5×5' },
          { v: '6', label: '6×6 (estremo)', breve: '6×6' }
        ] }
      ],
      modalita: [
        { id: 'numbers', label: 'NUMERI 🔢', breve: 'NUMERI' },
        { id: 'image', label: 'IMMAGINE 🖼️', breve: 'IMMAGINE' },
        { id: 'emoji', label: 'EMOJI 😀', breve: 'EMOJI' }
      ]
    }
  };

  var ctx = null;

  function seed() {
    return Math.random().toString(36).substring(7).toUpperCase();
  }
  function dataOra() {
    return new Date().toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function nome(id) {
    return (GIOCHI[id] && GIOCHI[id].nome) || id || 'questa partita';
  }
  function partecipantiDi(data) {
    if (!data) return [];
    if (Array.isArray(data.partecipanti) && data.partecipanti.length) return data.partecipanti.slice();
    if (Array.isArray(data.players)) return data.players.slice();
    return [];
  }
  function adatto(giocoId, n) {
    var g = GIOCHI[giocoId];
    if (!g) return { ok: false, motivo: 'Gioco non disponibile' };
    if (n < g.min) return { ok: false, motivo: 'Servono almeno ' + g.min + ' giocatori' };
    if (n > g.max) return { ok: false, motivo: 'Massimo ' + g.max + ' giocatori' };
    return { ok: true, motivo: '' };
  }
  /* ---------------- OPZIONI (schema = unica fonte) ---------------- */
  /**
   * Le opzioni di default del gioco, esattamente come le scrive l'hub.
   * `seed` è sempre nuovo: la rivincita non eredita mai la griglia/le lettere
   * della partita appena finita.
   */
  function opzioniDefault(giocoId) {
    var g = GIOCHI[giocoId];
    var o = { seed: seed() };
    if (!g) return o;
    (g.opzioni || []).forEach(function (opt) { o[opt.id] = opt.def; });
    if (g.modalita && g.modalita.length) o[g.modalitaKey || 'mode'] = g.modalita[0].id;
    if (giocoId === 'pictionary') o.timePerRound = parseInt(o.timePerRound, 10) || 60;
    return o;
  }
  /**
   * Fonde le scelte dell'utente con le opzioni attuali e i default, tenendo
   * solo i valori ammessi dallo schema (nessun valore inventato può finire
   * nella lobby). `correnti` serve a pre-riempire i controlli con le
   * impostazioni della partita appena giocata.
   */
  function opzioniScelte(giocoId, scelte, correnti) {
    var g = GIOCHI[giocoId];
    var da = scelte || {};
    var corr = correnti || {};
    if (!g) return Object.assign({ seed: seed() }, corr, da);
    var out = {};
    (g.opzioni || []).forEach(function (opt) {
      var v = da[opt.id];
      if (v == null || v === '') {
        v = corr[opt.id];
        if (opt.daCorrenti) v = opt.daCorrenti(v);
      }
      if (v == null || v === '') v = opt.def;
      v = String(v);
      var ammesso = !opt.valori || !opt.valori.length || opt.valori.some(function (x) { return String(x.v) === v; });
      out[opt.id] = ammesso ? v : String(opt.def);
    });
    var key = g.modalitaKey || 'mode';
    if (g.modalita && g.modalita.length) {
      var m = String(da[key] || corr[key] || g.modalita[0].id);
      var valido = g.modalita.some(function (x) { return x.id === m; });
      out[key] = valido ? m : g.modalita[0].id;
    }
    if (giocoId === 'pictionary') out.timePerRound = parseInt(out.timePerRound, 10) || 60;
    out.seed = seed();
    return out;
  }
  /**
   * Collezione della partita di ORIGINE (dove vive l'accettazione): le partite
   * dei giochi "tipo Ruzzle" stanno in `partite`, le room Pictionary in
   * `pictionary_rooms`. Stessa mappa di `scarta()`.
   */
  function collezioneOrigine(giocoId) {
    return giocoId === 'pictionary' ? 'pictionary_rooms' : 'partite';
  }
  /**
   * Documento della lobby nuova. `origineId` è la partita da cui nasce la
   * rivincita e `origineCollezione` la sua collezione: la lobby viene marcata
   * (`daRivincita`, `rivincitaDi`, `rivincitaCollezione`) così l'hub sa che NON
   * è una sfida da accettare ma una lobby già avviata in cui entrare, e chi
   * entra può segnare l'accettazione sulla partita di origine (dove gli altri
   * giocatori stanno ancora aspettando), anche quando l'origine è una room
   * Pictionary e non una partita della collezione `partite`.
   */
  function documentoPartita(giocoId, partecipanti, opzioni, origineId, origineCollezione) {
    var punteggi = {};
    var parole = {};
    partecipanti.forEach(function (p) { punteggi[p] = 0; parole[p] = []; });
    var doc = {
      gioco: giocoId,
      partecipanti: partecipanti,
      punteggi: punteggi,
      parole: parole,
      pronti: [],
      finito: [],
      confermaVerifica: [],
      stato: 'attesa',
      rivincitaAccettataDa: [],
      rivincitaRifiutataDa: [],
      daRivincita: true,
      rivincitaDi: origineId || null,
      rivincitaCollezione: origineId ? (origineCollezione || 'partite') : null,
      dataOra: dataOra(),
      timestamp: Date.now(),
      opzioni: opzioni || opzioniDefault(giocoId)
    };
    if (giocoId === 'nomi-cose-citta') {
      doc.risultati = [];
      doc.roundData = null;
      doc.round = 0;
    }
    return doc;
  }
  function documentoRoom(partecipanti, me, opzioni, origineId, origineCollezione) {
    var opts = opzioni || opzioniDefault('pictionary');
    var mode = opts.mode || 'classic';
    var code = Math.random().toString(36).substring(2, 7).toUpperCase();
    return {
      id: code,
      data: {
        host: me || partecipanti[0],
        players: partecipanti,
        ready: [],
        settings: { mode: mode, timePerRound: parseInt(opts.timePerRound || 60, 10) },
        stato: 'lobby',
        currentRound: 0,
        totalRounds: mode === 'guessit' ? partecipanti.length * 2 : partecipanti.length,
        chains: {},
        votes: {},
        scores: {},
        completedRound: {},
        playerOrder: partecipanti,
        daRivincita: true,
        rivincitaDi: origineId || null,
        rivincitaCollezione: origineId ? (origineCollezione || 'partite') : null,
        timestamp: Date.now(),
        dataOra: new Date().toLocaleString('it-IT'),
        sfidaDiretta: true
      }
    };
  }
  function href(giocoId, id) {
    var g = GIOCHI[giocoId];
    if (!g || !id) return 'index.html?matchId=' + encodeURIComponent(id || '');
    return '../' + giocoId + '/index.html?' + g.query + '=' + encodeURIComponent(id);
  }
  function campiCollegamento(id, giocoId, me) {
    return {
      prossimaPartita: id,
      prossimaPartitaCreataDa: me,
      prossimaPartitaGioco: giocoId,
      rivincitaAccettataDa: [],
      rivincitaRifiutataDa: []
    };
  }
  function tuttiAccettati(partecipanti, creatore, accettanti) {
    var altri = (partecipanti || []).filter(function (p) { return p && p !== creatore; });
    if (!altri.length) return false;
    return altri.every(function (p) { return (accettanti || []).indexOf(p) !== -1; });
  }
  function fase(data, me) {
    if (!data || !data.prossimaPartita) return { fase: 'nessuna' };
    var persone = partecipantiDi(data);
    var rifiutanti = data.rivincitaRifiutataDa || [];
    var accettanti = data.rivincitaAccettataDa || [];
    var creatore = data.prossimaPartitaCreataDa || '';
    var gioco = data.prossimaPartitaGioco || data.gioco || '';
    var base = {
      id: data.prossimaPartita,
      gioco: gioco,
      nome: nome(gioco),
      creatore: creatore,
      rifiutanti: rifiutanti,
      accettanti: accettanti
    };
    if (rifiutanti.length) return Object.assign(base, { fase: 'rifiutata' });
    if (tuttiAccettati(persone, creatore, accettanti)) return Object.assign(base, { fase: 'vai' });
    var mancanti = persone.filter(function (p) {
      return p !== creatore && accettanti.indexOf(p) === -1;
    });
    if (creatore && creatore === me) return Object.assign(base, { fase: 'attesa', mancanti: mancanti });
    if (accettanti.indexOf(me) !== -1) return Object.assign(base, { fase: 'accettata', mancanti: mancanti });
    return Object.assign(base, { fase: 'decidi', mancanti: mancanti });
  }
  function scarta(db, id, giocoId) {
    if (!db || !id) return Promise.resolve();
    return db.collection(collezioneOrigine(giocoId)).doc(id).delete().catch(function () {});
  }
  function prepara(options) {
    ctx = options || null;
  }
  /**
   * Crea la lobby del gioco scelto (con le opzioni scelte) e la collega come
   * proposta di rivincita alla partita corrente. Unica via di creazione per
   * tutti i giochi: nessuna copia della logica nelle singole pagine.
   */
  function invita(giocoId, scelte) {
    if (!ctx || !ctx.db || !ctx.ref) return Promise.resolve({ ok: false, errore: 'contesto mancante' });
    var g = GIOCHI[giocoId];
    var persone = (ctx.partecipanti || []).slice();
    var check = adatto(giocoId, persone.length);
    if (!g || !check.ok) return Promise.resolve({ ok: false, errore: check.motivo || 'gioco non valido' });
    var proposta = ctx.proposta || {};
    if (proposta.prossimaPartita && !(proposta.rivincitaRifiutataDa || []).length) {
      return Promise.resolve({ ok: false, errore: 'c\'è già una proposta aperta' });
    }
    var opzioni = opzioniScelte(giocoId, scelte, ctx.correnti || proposta.opzioni);
    var origineId = (ctx.ref && ctx.ref.id) || null;
    /* La collezione dell'origine si ricava dal gioco della PAGINA che propone
       (le room Pictionary vivono in pictionary_rooms, tutto il resto in
       partite): serve a segnare l'accettazione sul documento giusto. */
    var origineCollezione = collezioneOrigine(ctx.giocoCorrente || proposta.gioco);
    var creatoId = null;
    return scarta(ctx.db, proposta.prossimaPartita, proposta.prossimaPartitaGioco).then(function () {
      if (giocoId === 'pictionary') {
        var room = documentoRoom(persone, ctx.me, opzioni, origineId, origineCollezione);
        creatoId = room.id;
        return ctx.db.collection('pictionary_rooms').doc(room.id).set(room.data);
      }
      var ref = ctx.db.collection('partite').doc();
      creatoId = ref.id;
      return ref.set(documentoPartita(giocoId, persone, opzioni, origineId, origineCollezione));
    }).then(function () {
      return ctx.ref.update(campiCollegamento(creatoId, giocoId, ctx.me));
    }).then(function () {
      if (ctx.onFatto) ctx.onFatto();
      return { ok: true, id: creatoId, gioco: giocoId, opzioni: opzioni };
    }).catch(function (e) {
      if (creatoId) scarta(ctx.db, creatoId, giocoId);
      return { ok: false, errore: (e && e.message) || 'creazione non riuscita' };
    });
  }
  function annulla(db, ref, data) {
    var FV = global.firebase && global.firebase.firestore && global.firebase.firestore.FieldValue;
    if (!db || !ref || !FV) return Promise.resolve();
    var id = data && data.prossimaPartita;
    var giocoId = data && (data.prossimaPartitaGioco || data.gioco);
    return scarta(db, id, giocoId).then(function () {
      return ref.update({
        prossimaPartita: FV.delete(),
        prossimaPartitaCreataDa: FV.delete(),
        prossimaPartitaGioco: FV.delete(),
        rivincitaAccettataDa: FV.delete(),
        rivincitaRifiutataDa: FV.delete()
      });
    });
  }
  /* Accettazioni già segnate in QUESTA pagina: una scrittura per origine. */
  var accettazioniSegnate = {};
  /**
   * Segna l'accettazione della rivincita sulla partita di ORIGINE.
   * Serve a chi entra direttamente nella lobby nuova (dall'hub o da un link)
   * senza passare dal banner ✅ ACCETTA della partita finita: senza questa
   * scrittura gli altri giocatori restavano in attesa per sempre e la
   * rivincita non partiva ("a volte la rivincita non funziona").
   * `collezione` è quella dell'origine (`partite` per i giochi "tipo Ruzzle",
   * `pictionary_rooms` per le room Pictionary: una rivincita può cambiare
   * gioco, quindi la collezione dell'origine non si indovina dal gioco nuovo).
   * Scrittura cieca con arrayUnion: idempotente, nessuna lettura, e se il
   * documento di origine non c'è più fallisce in silenzio.
   */
  function segnaAccettazione(db, origineId, me, collezione) {
    var FV = global.firebase && global.firebase.firestore && global.firebase.firestore.FieldValue;
    if (!db || !origineId || !me || !FV) return Promise.resolve(false);
    var col = collezione === 'pictionary_rooms' ? 'pictionary_rooms' : 'partite';
    var chiave = col + '/' + origineId;
    if (accettazioniSegnate[chiave]) return Promise.resolve(false);
    accettazioniSegnate[chiave] = true;
    return db.collection(col).doc(origineId)
      .update({ rivincitaAccettataDa: FV.arrayUnion(me) })
      .then(function () { return true; })
      .catch(function () { return false; });
  }
  function vai(data, giocoFallback) {
    if (global.__fawRivincitaVia) return true;
    if (!data || !data.prossimaPartita) return false;
    global.__fawRivincitaVia = true;
    var gioco = data.prossimaPartitaGioco || giocoFallback;
    var url = href(gioco, data.prossimaPartita);
    setTimeout(function () { global.location.href = url; }, 1200);
    return true;
  }

  /* ==========================================================================
     MODALE "RIVINCITA": scelta del gioco + impostazioni
     ========================================================================== */
  var sceltaAperta = null;
  var valoriScelti = {};   // { giocoId: { optId: valore } } — le scelte restano se si cambia gioco

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function valoreEtichetta(opt, v) {
    var trovato = null;
    (opt.valori || []).forEach(function (x) { if (String(x.v) === String(v)) trovato = x; });
    return trovato ? (trovato.breve || trovato.label) : String(v == null ? '' : v);
  }
  /** Riepilogo compatto delle impostazioni: «60s · 5×5 · CLASSICA». */
  function riepilogo(giocoId, opzioni) {
    var g = GIOCHI[giocoId];
    if (!g || !opzioni) return '';
    var pezzi = [];
    (g.opzioni || []).forEach(function (opt) { pezzi.push(valoreEtichetta(opt, opzioni[opt.id])); });
    var key = g.modalitaKey || 'mode';
    (g.modalita || []).forEach(function (m) { if (m.id === opzioni[key]) pezzi.push(m.breve || m.label); });
    return pezzi.join(' · ');
  }
  function valoreCorrente(giocoId, optId, correnti) {
    if (!valoriScelti[giocoId]) return null;
    var v = valoriScelti[giocoId][optId];
    if (v == null || v === '') return null;
    return String(v);
  }
  function opzioniCorrentiUI(giocoId) {
    var stato = sceltaAperta || {};
    var base = (giocoId === stato.corrente) ? (stato.correnti || {}) : {};
    var finto = {};
    Object.keys(base).forEach(function (k) { finto[k] = base[k]; });
    var scelte = valoriScelti[giocoId] || {};
    Object.keys(scelte).forEach(function (k) { finto[k] = scelte[k]; });
    return opzioniScelte(giocoId, finto, base);
  }
  function giochiOrdinati(corrente) {
    var ids = Object.keys(GIOCHI);
    return [corrente].concat(ids.filter(function (id) { return id !== corrente; }))
      .filter(function (id) { return !!GIOCHI[id]; });
  }
  function schedeHtml(corrente, n, disabilitati) {
    return giochiOrdinati(corrente).map(function (id) {
      var g = GIOCHI[id];
      var check = adatto(id, n);
      var motivo = (disabilitati && disabilitati[id]) || (check.ok ? '' : check.motivo);
      var classi = 'faw-rv-card' + (id === corrente ? ' faw-rv-card--corrente' : '') + (motivo ? ' is-off' : '');
      return '<button type="button" class="' + classi + '" data-gioco="' + esc(id) + '"' +
        (motivo ? ' disabled title="' + esc(motivo) + '"' : ' title="' + esc(g.descrizione || g.nome) + '"') +
        ' aria-pressed="false">' +
        '<span class="faw-rv-card__ico" aria-hidden="true">' + g.icona + '</span>' +
        '<span class="faw-rv-card__name">' + esc(g.nome) + '</span>' +
        '<span class="faw-rv-card__meta">' + (g.min === g.max ? g.min + ' giocatori' : g.min + '–' + g.max + ' giocatori') + '</span>' +
        (id === corrente ? '<span class="faw-rv-card__tag">QUESTA PARTITA</span>'
          : (motivo ? '<span class="faw-rv-card__tag faw-rv-card__tag--off">' + esc(motivo) + '</span>' : '')) +
        '</button>';
    }).join('');
  }
  function controlliHtml(giocoId, opzioni, n) {
    var g = GIOCHI[giocoId];
    var campi = (g.opzioni || []).map(function (opt) {
      var attuale = String(opzioni[opt.id]);
      var opts = (opt.valori || []).map(function (x) {
        return '<option value="' + esc(x.v) + '"' + (String(x.v) === attuale ? ' selected' : '') + '>' +
          esc(x.label) + '</option>';
      }).join('');
      return '<label class="faw-rv-field">' +
        '<span class="faw-rv-field__label">' + esc(opt.label) + '</span>' +
        '<select class="faw-select" data-opt="' + esc(opt.id) + '">' + opts + '</select>' +
        '</label>';
    }).join('');
    var key = g.modalitaKey || 'mode';
    if (g.modalita && g.modalita.length) {
      var seg = g.modalita.map(function (m) {
        var on = m.id === opzioni[key];
        return '<button type="button" class="faw-rv-seg__btn' + (on ? ' is-on' : '') + '"' +
          ' data-modo="' + esc(m.id) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
          esc(m.label) + '</button>';
      }).join('');
      campi += '<div class="faw-rv-field faw-rv-field--wide">' +
        '<span class="faw-rv-field__label">Modalità</span>' +
        '<div class="faw-rv-seg" role="group" aria-label="Modalità di gioco">' + seg + '</div></div>';
    }
    var avviso = '';
    if (g.min > n) avviso = 'Servono almeno ' + g.min + ' giocatori.';
    else if (g.max < n) avviso = 'Questo gioco arriva a ' + g.max + ' giocatori.';
    return campi + (avviso ? '<p class="faw-rv-note">' + esc(avviso) + '</p>' : '');
  }
  function modaleHtml(opts) {
    var corrente = opts.corrente;
    var n = opts.n;
    return '<div class="faw-modal faw-rv-modal" role="document">' +
      '<div class="faw-modal__head">' +
        '<h2 class="faw-rv-title" id="faw-rv-title">🔁 RIVINCITA</h2>' +
        '<button type="button" class="faw-modal__close" data-chiudi aria-label="Chiudi">✕</button>' +
      '</div>' +
      '<div class="faw-modal__body">' +
        '<p class="faw-rv-sub">' + esc(opts.sottotitolo) + '</p>' +
        '<div class="faw-rv-giochi" role="group" aria-label="Scegli il gioco">' +
          schedeHtml(corrente, n, opts.disabilitati) +
        '</div>' +
        '<div class="faw-rv-panel">' +
          '<div class="faw-rv-panel__head">' +
            '<span class="faw-rv-panel__lab">IMPOSTAZIONI</span>' +
            '<span class="faw-rv-panel__sum" id="faw-rv-sum"></span>' +
          '</div>' +
          '<div class="faw-rv-settings" id="faw-rv-settings"></div>' +
        '</div>' +
        '<div class="faw-rv-actions">' +
          '<button type="button" class="faw-btn faw-btn--ghost" data-chiudi>✖️ ANNULLA</button>' +
          '<button type="button" class="faw-btn faw-btn--primary faw-btn--lg" id="faw-rv-conferma">' +
            '🔁 INVITA TUTTI</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }
  function chiudiScelta() {
    var stato = sceltaAperta;
    if (!stato) return;
    sceltaAperta = null;
    if (stato.onKey) global.document.removeEventListener('keydown', stato.onKey);
    if (stato.overlay && stato.overlay.parentNode) stato.overlay.parentNode.removeChild(stato.overlay);
  }
  /**
   * Apre la modale della rivincita.
   * opts: { giocoCorrente, n, correnti, sottotitolo, disabilitati,
   *         onConferma(giocoId, opzioni), onAnnulla() }
   * Senza `onConferma` la lobby viene creata da qui con `invita`.
   */
  function apriScelta(opts) {
    var doc = global.document;
    if (!doc || !doc.body) return null;
    opts = opts || {};
    chiudiScelta();
    /* Le scelte fatte in una modale precedente non devono riapparire: ogni
       apertura riparte dalle impostazioni della partita appena finita. */
    valoriScelti = {};
    var corrente = GIOCHI[opts.giocoCorrente] ? opts.giocoCorrente : Object.keys(GIOCHI)[0];
    var overlay = doc.createElement('div');
    overlay.className = 'faw-modal__overlay faw-rv-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'faw-rv-title');
    overlay.innerHTML = modaleHtml({
      corrente: corrente,
      n: Number(opts.n) || 1,
      sottotitolo: opts.sottotitolo || 'Scegli il gioco e le impostazioni: la sfida parte quando tutti accettano.',
      disabilitati: opts.disabilitati || {}
    });
    doc.body.appendChild(overlay);

    sceltaAperta = {
      overlay: overlay,
      corrente: corrente,
      correnti: opts.correnti || {},
      n: Number(opts.n) || 1,
      gioco: corrente,
      disabilitati: opts.disabilitati || {},
      onConferma: opts.onConferma || null,
      onAnnulla: opts.onAnnulla || null,
      onErrore: opts.onErrore || null
    };

    var elGiochi = overlay.querySelector('.faw-rv-giochi');
    var elSettings = overlay.querySelector('#faw-rv-settings');
    var elSum = overlay.querySelector('#faw-rv-sum');
    var elConferma = overlay.querySelector('#faw-rv-conferma');

    function disegnaSchede() {
      Array.prototype.forEach.call(elGiochi.querySelectorAll('[data-gioco]'), function (card) {
        var on = card.getAttribute('data-gioco') === sceltaAperta.gioco;
        card.classList.toggle('is-on', on);
        card.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    function disegnaImpostazioni() {
      var giocoId = sceltaAperta.gioco;
      var opzioni = opzioniCorrentiUI(giocoId);
      elSettings.innerHTML = controlliHtml(giocoId, opzioni, sceltaAperta.n);
      elSum.textContent = riepilogo(giocoId, opzioni);
      elConferma.textContent = giocoId === sceltaAperta.corrente
        ? '🔁 RIGIOCA ' + GIOCHI[giocoId].nome.toUpperCase()
        : '🔁 INVITA A ' + GIOCHI[giocoId].nome.toUpperCase();
      elConferma.disabled = !!sceltaAperta.disabilitati[giocoId] || !adatto(giocoId, sceltaAperta.n).ok;
      Array.prototype.forEach.call(elSettings.querySelectorAll('[data-opt]'), function (sel) {
        sel.addEventListener('change', function () {
          if (!valoriScelti[giocoId]) valoriScelti[giocoId] = {};
          valoriScelti[giocoId][sel.getAttribute('data-opt')] = sel.value;
          var nuovi = opzioniCorrentiUI(giocoId);
          elSum.textContent = riepilogo(giocoId, nuovi);
        });
      });
      Array.prototype.forEach.call(elSettings.querySelectorAll('[data-modo]'), function (btn) {
        btn.addEventListener('click', function () {
          if (!valoriScelti[giocoId]) valoriScelti[giocoId] = {};
          valoriScelti[giocoId][GIOCHI[giocoId].modalitaKey || 'mode'] = btn.getAttribute('data-modo');
          Array.prototype.forEach.call(elSettings.querySelectorAll('[data-modo]'), function (b) {
            var on = b === btn;
            b.classList.toggle('is-on', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
          });
          var nuovi = opzioniCorrentiUI(giocoId);
          elSum.textContent = riepilogo(giocoId, nuovi);
        });
      });
    }
    Array.prototype.forEach.call(elGiochi.querySelectorAll('[data-gioco]'), function (card) {
      card.addEventListener('click', function () {
        var id = card.getAttribute('data-gioco');
        if (sceltaAperta.disabilitati[id] || !adatto(id, sceltaAperta.n).ok) return;
        sceltaAperta.gioco = id;
        disegnaSchede();
        disegnaImpostazioni();
      });
    });
    Array.prototype.forEach.call(overlay.querySelectorAll('[data-chiudi]'), function (btn) {
      btn.addEventListener('click', function () { chiudiScelta(); });
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) chiudiScelta();   // click sullo sfondo
    });
    elConferma.addEventListener('click', function () {
      var stato = sceltaAperta;
      if (!stato) return;
      var giocoId = stato.gioco;
      if (stato.disabilitati[giocoId] || !adatto(giocoId, stato.n).ok) return;
      var correnti = giocoId === stato.corrente ? stato.correnti : null;
      var opzioni = opzioniScelte(giocoId, valoriScelti[giocoId], correnti);
      var cb = stato.onConferma;
      var onErrore = stato.onErrore;
      chiudiScelta();
      if (cb) { cb(giocoId, opzioni); return; }
      invita(giocoId, opzioni).then(function (r) {
        if (r && !r.ok && onErrore) onErrore(r.errore || 'Invito non riuscito');
      });
    });
    sceltaAperta.onKey = function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') chiudiScelta();
    };
    doc.addEventListener('keydown', sceltaAperta.onKey);

    disegnaSchede();
    disegnaImpostazioni();
    var focus = overlay.querySelector('.faw-rv-card.is-on:not([disabled])') || elConferma;
    if (focus && focus.focus) focus.focus();
    return overlay;
  }

  global.FAW_RIVINCITA = {
    giochi: GIOCHI,
    nome: nome,
    adatto: adatto,
    href: href,
    fase: fase,
    tuttiAccettati: tuttiAccettati,
    campiCollegamento: campiCollegamento,
    opzioniDefault: opzioniDefault,
    opzioniScelte: opzioniScelte,
    documentoPartita: documentoPartita,
    documentoRoom: documentoRoom,
    scarta: scarta,
    collezioneOrigine: collezioneOrigine,
    prepara: prepara,
    invita: invita,
    annulla: annulla,
    segnaAccettazione: segnaAccettazione,
    vai: vai,
    riepilogo: riepilogo,
    apriScelta: apriScelta,
    chiudiScelta: chiudiScelta
  };
})(typeof window !== 'undefined' ? window : global);
