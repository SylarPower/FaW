/*
 * Rivincita condivisa. La proposta vive sul documento della partita già in
 * corso (niente collection nuova, niente indice): prossimaPartita,
 * prossimaPartitaCreataDa, prossimaPartitaGioco, rivincitaAccettataDa,
 * rivincitaRifiutataDa. Il documento nuovo è una lobby normale del gioco
 * scelto, così l'hub la vede come le altre sfide in attesa.
 *
 * Chi crea non deve ri-accettare. Si entra tutti insieme solo quando ogni
 * altro partecipante ha accettato. Un rifiuto blocca quella proposta; se ne
 * può aprire un'altra, e il documento orfano viene cancellato.
 */
(function (global) {
  'use strict';

  var GIOCHI = {
    ruzzle: { nome: 'Ruzzle', icona: '🔠', min: 1, max: 10, collezione: 'partite', query: 'matchId' },
    patata: { nome: 'Patata Bollente', icona: '🥔', min: 2, max: 8, collezione: 'partite', query: 'matchId' },
    'nomi-cose-citta': { nome: 'Nomi, Cose, Città', icona: '📝', min: 2, max: 8, collezione: 'partite', query: 'matchId' },
    pictionary: { nome: 'Pictionary', icona: '🎨', min: 2, max: 8, collezione: 'pictionary_rooms', query: 'room' },
    gameof15: { nome: 'Gioco del 15', icona: '🧩', min: 1, max: 8, collezione: 'partite', query: 'matchId' }
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
  function opzioniDefault(giocoId) {
    if (giocoId === 'ruzzle') return { tempo: '60', griglia: '5', mode: 'classic', seed: seed() };
    if (giocoId === 'patata') return { tempo: '60', turni: '3', lettere: '3', mode: 'classic', seed: seed() };
    if (giocoId === 'nomi-cose-citta') {
      return { round: '3', tempo: '120', revisione: '90', categorie: 'multi', mode: 'classica', seed: seed() };
    }
    if (giocoId === 'gameof15') return { durata: '180', griglia: '4', mode: 'numbers', seed: seed() };
    if (giocoId === 'pictionary') return { mode: 'classic', timePerRound: 60 };
    return { seed: seed() };
  }
  function documentoPartita(giocoId, partecipanti, opzioni) {
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
  function documentoRoom(partecipanti, me, opzioni) {
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
    var col = giocoId === 'pictionary' ? 'pictionary_rooms' : 'partite';
    return db.collection(col).doc(id).delete().catch(function () {});
  }
  function prepara(options) {
    ctx = options || null;
  }
  function invita(giocoId) {
    if (!ctx || !ctx.db || !ctx.ref) return Promise.resolve({ ok: false, errore: 'contesto mancante' });
    var g = GIOCHI[giocoId];
    var persone = (ctx.partecipanti || []).slice();
    var check = adatto(giocoId, persone.length);
    if (!g || !check.ok) return Promise.resolve({ ok: false, errore: check.motivo || 'gioco non valido' });
    var proposta = ctx.proposta || {};
    if (proposta.prossimaPartita && !(proposta.rivincitaRifiutataDa || []).length) {
      return Promise.resolve({ ok: false, errore: 'c\'è già una proposta aperta' });
    }
    var creatoId = null;
    return scarta(ctx.db, proposta.prossimaPartita, proposta.prossimaPartitaGioco).then(function () {
      if (giocoId === 'pictionary') {
        var room = documentoRoom(persone, ctx.me, opzioniDefault('pictionary'));
        creatoId = room.id;
        return ctx.db.collection('pictionary_rooms').doc(room.id).set(room.data);
      }
      var ref = ctx.db.collection('partite').doc();
      creatoId = ref.id;
      return ref.set(documentoPartita(giocoId, persone, opzioniDefault(giocoId)));
    }).then(function () {
      return ctx.ref.update(campiCollegamento(creatoId, giocoId, ctx.me));
    }).then(function () {
      if (ctx.onFatto) ctx.onFatto();
      return { ok: true, id: creatoId, gioco: giocoId };
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
  function vai(data, giocoFallback) {
    if (global.__fawRivincitaVia) return true;
    if (!data || !data.prossimaPartita) return false;
    global.__fawRivincitaVia = true;
    var gioco = data.prossimaPartitaGioco || giocoFallback;
    var url = href(gioco, data.prossimaPartita);
    setTimeout(function () { global.location.href = url; }, 1200);
    return true;
  }
  function htmlAltri(giocoCorrente, n) {
    return Object.keys(GIOCHI).filter(function (id) { return id !== giocoCorrente; }).map(function (id) {
      var g = GIOCHI[id];
      var check = adatto(id, n);
      var dis = check.ok ? '' : ' disabled';
      var title = check.ok ? ('Invita a ' + g.nome) : check.motivo;
      return '<button type="button" ' + dis + ' title="' + title + '" onclick="FAW_invitaAltroGioco(\'' + id + '\')"' +
        ' style="padding:6px 12px;border:none;border-radius:8px;cursor:pointer;font-weight:800;' +
        (check.ok ? 'background:#ffffff;color:#1c2430;border:2px solid #1c2430;' : 'background:#e5e7eb;color:#374151;cursor:not-allowed;') +
        '">' + g.icona + ' ' + g.nome + '</button>';
    }).join('');
  }
  function azioniAltri(giocoCorrente, n, fn) {
    return Object.keys(GIOCHI).filter(function (id) { return id !== giocoCorrente; }).map(function (id) {
      var g = GIOCHI[id];
      var check = adatto(id, n);
      return {
        id: 'altro-' + id,
        label: g.icona + ' ' + g.nome,
        kind: 'btn-ghost',
        disabled: !check.ok,
        title: check.ok ? ('Invita a ' + g.nome) : check.motivo,
        fn: function () { if (check.ok && fn) fn(id); }
      };
    });
  }

  global.FAW_invitaAltroGioco = function (id) {
    return invita(id).then(function (r) {
      if (r && !r.ok && ctx && ctx.onErrore) ctx.onErrore(r.errore);
      return r;
    });
  };
  global.FAW_RIVINCITA = {
    giochi: GIOCHI,
    nome: nome,
    adatto: adatto,
    href: href,
    fase: fase,
    tuttiAccettati: tuttiAccettati,
    campiCollegamento: campiCollegamento,
    opzioniDefault: opzioniDefault,
    documentoPartita: documentoPartita,
    scarta: scarta,
    prepara: prepara,
    invita: invita,
    annulla: annulla,
    vai: vai,
    htmlAltri: htmlAltri,
    azioniAltri: azioniAltri
  };
})(typeof window !== 'undefined' ? window : global);
