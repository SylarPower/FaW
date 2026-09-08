/**
 * Categoria Rush — regole pure (nessun DOM, nessun network).
 *
 * Un round = stessa lettera + stessa categoria per tutti, ~26 s per rispondere,
 * ~4 s di rivelazione. La partita è un numero chiuso di round (4 o 6), così
 * non esistono round monchi quando scade il tempo.
 *
 * Punteggio di un round (semplice, spiegato a schermo):
 *   +100  risposta valida (esiste nella categoria ammessa e inizia con la lettera)
 *   +0..40  bonus velocità, proporzionale al tempo rimasto nel round
 *   +60  risposta unica   | +15 in due | 0 in tre o più (i duplicati non rendono)
 *   0    risposta non valida (nessuna penalità oltre a questo: nessun -1)
 * La risposta è definitiva: una per round, quello che arriva dopo la chiusura
 * del round non recupera nulla (il punteggio lo decide chi chiude il round).
 *
 * `classifica` decide i pareggi con criteri dichiarati, non con l'ordine di
 * arrivo dei pacchetti di rete.
 */
(function (root, factory) {
  var mod = factory(root);
  if (typeof module === "object" && module.exports) module.exports = mod;
  if (root) root.FAWRushRules = mod;
})(typeof window !== "undefined" ? window : globalThis, function (global) {
  "use strict";

  var CAT = global && global.FAWCategorie ? global.FAWCategorie : null;
  var CORE = global && global.FAWCore ? global.FAWCore : null;

  var CFG = {
    // classica: 26 s per rispondere + 4 s di rivelazione = 30 s a round
    inputMs: 26000,
    rivelaMs: 4000,
    votoMs: 7000,          // solo modalità creativa: finestra di voto tra pari
    rivelaFinMs: 5000,     // solo modalità creativa: punteggi del round
    minLen: 3,
    maxLen: 40,
    puntiBase: 100,
    puntiPartecipazione: 40,
    puntiVoto: 100,
    bonusVelMax: 40,
    bonusUnico: 60,
    bonusCoppia: 15,
    durate: [120, 180],
    roundMinimiGiocatore: 2
  };
  CFG.roundMs = CFG.inputMs + CFG.rivelaMs;                  // 30000
  CFG.roundMsCreative = CFG.inputMs + CFG.votoMs + CFG.rivelaFinMs; // 38000

  /** Tempi del round secondo modalità: la creativa ha una finestra di voto in più. */
  function ciclo(modale) {
    return modale === "creative"
      ? { roundMs: CFG.roundMsCreative, inputMs: CFG.inputMs, votoMs: CFG.votoMs, rivelaMs: CFG.rivelaFinMs, votazione: true }
      : { roundMs: CFG.roundMs, inputMs: CFG.inputMs, votoMs: 0, rivelaMs: CFG.rivelaMs, votazione: false };
  }

  /**
   * Stessa normalizzazione del dizionario e del database categorie: minuscole,
   * accenti rimossi, apostrofi ignorati, spazi ridotti a uno. Se un client usasse
   * una normalizzazione diversa, "CANE" e "cane" risulterebbero due risposte.
   */
  function norm(s) {
    if (CORE) return CORE.normText(s);
    return String(s == null ? "" : s).trim().toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ").trim();
  }

  /* ------------------------------- rounds -------------------------------- */

  /**
   * Numero di round per la durata scelta: si arrotonda per difetto sul ciclo del
   * round, così non esiste mai un round interrotto a metà (i punti sarebbero
   * decisi dal client più veloce). Il tempo residuo si perde, dichiarato in UI.
   */
  function numeroRound(durataMs, roundMs) {
    var rm = roundMs || CFG.roundMs;
    return Math.max(1, Math.floor((durataMs || rm) / rm));
  }

  /**
   * Combinazioni dei round derivate dal seed: ogni client le calcola da solo,
   * quindi non serve nessuna scrittura per "dire a tutti la domanda".
   * Le combinazioni sono scelte solo tra quelle con abbastanza risposte ammesse,
   * così non esistono round impossibili; si evitano ripetizioni nei round precedenti.
   */
  function roundsDaSeed(seed, n, opts) {
    opts = opts || {};
    var out = [];
    var usati = [];
    for (var i = 0; i < n; i++) {
      var rng = CORE ? CORE.rngFrom(seed + ":rush:" + i) : Math.random;
      if (opts.modale === "creative") {
        var lista = (CAT && CAT.CREATIVE) || [];
        if (!lista.length) break;
        var c = lista[Math.floor(rng() * lista.length) % lista.length];
        out.push({ i: i, categoria: c.id, nome: c.nome, lettera: null, votazione: true });
        continue;
      }
      var cb = CAT ? CAT.pickCombo(rng, { escludi: usati, min: opts.min == null ? 4 : opts.min }) : null;
      if (!cb) continue;
      usati.push(cb.id + ":" + cb.lettera);
      out.push({ i: i, categoria: cb.id, nome: cb.nome, lettera: cb.lettera, possibili: cb.n });
    }
    return out;
  }

  /** Fase del round in corso: `input` (si scrive) o `rivela` (si guarda). */
  function faseRound(startAt, oraMs, opts) {
    opts = opts || {};
    var c = opts.ciclo || ciclo(opts.modale);
    var n = opts.rounds || 1;
    var t = oraMs - (startAt || 0);
    var out = { rounds: n, indice: -1, fase: "attesa", entroMs: 0, entroInputMs: 0, fineMatch: (startAt || 0) + n * c.roundMs, ciclo: c };
    if (t < 0) { out.entroMs = -(t); return out; }               // countdown
    var i = Math.floor(t / c.roundMs);
    if (i >= n) { out.fase = "finita"; out.indice = n - 1; out.entroMs = 0; return out; }
    var dentro = t - i * c.roundMs;
    out.indice = i;
    if (dentro < c.inputMs) {
      out.fase = "input";
      out.entroInputMs = c.inputMs - dentro;
      out.entroMs = out.entroInputMs;
    } else if (c.votazione && dentro < c.inputMs + c.votoMs) {
      out.fase = "voto";
      out.entroMs = c.inputMs + c.votoMs - dentro;
    } else {
      out.fase = "rivela";
      out.entroMs = c.roundMs - dentro;
    }
    return out;
  }

  /* ------------------------------ validità ------------------------------- */

  /**
   * Controllo della risposta. Motivi (tradotti in messaggio utente dalla UI):
   * VUOTO, CORTA, LUNGA, CARATTERI, LETTERA, NON_CATEGORIA, GIA_DATA.
   * `giaUsate` = risposte già date da *quella persona* in questo match: il
   * riciclo è vietato (altrimenti un solo vocabolo vinto varrebbe tre round).
   */
  function valutaRisposta(testo, combo, opts) {
    opts = opts || {};
    var n = norm(testo);
    function ko(motivo) { return { ok: false, motivo: motivo, parola: n, canonica: n }; }
    if (!n) return ko("VUOTO");
    if (n.length < CFG.minLen) return ko("CORTA");
    if (n.length > CFG.maxLen) return ko("LUNGA");
    if (/[0-9]/.test(n)) return ko("CARATTERI");
    if (!CAT) return ko("DIZIONIONARIO_ASSENTE");
    if (combo.votazione || opts.creativo) {
      // modalità creativa: nessun elenco chiuso da consultare, la risposta è
      // giudicata a voto tra giocatori; qui si filtra solo l'assurdo
      var par = n.split(" ").filter(Boolean);
      if (n.length < 8 && par.length < 2) return ko("TROPPO_CORTA");
      return { ok: true, parola: n, canonica: n, categoriaId: combo.categoria, creativo: true };
    }
    var categoria = combo.categoriaId ? CAT.byId(combo.categoriaId) : CAT.byId(combo.categoria);
    if (!categoria) return ko("CATEGORIA_SCONOSCIUTA");
    var v = CAT.valida(testo, categoria, combo.lettera);
    if (!v.ok) return ko(v.motivo);
    var canonica = norm(v.canonical || v.normalizzata);
    var gia = opts.giaUsate || [];
    if (gia.map(norm).indexOf(canonica) >= 0) return ko("GIA_DATA");
    return { ok: true, parola: norm(v.normalizzata), canonica: canonica, categoriaId: categoria.id };
  }

  /* ------------------------------ punteggio ------------------------------ */

  /**
   * Decide i punti di un round. `risposte` = { NOME: {parola, t} } con `t` in ms
   * dall'inizio del round (0 = velocissimo). I duplicati sono rilevati sulla forma
   * canonica, quindi `CANE` e `cane` contano come la stessa risposta.
   */
  function punteggiRound(risposte, opts) {
    opts = opts || {};
    var inputMs = opts.inputMs || CFG.inputMs;
    var lista = {};
    chi(risposte).forEach(function (nome) {
      var r = risposte[nome] || {};
      lista[nome] = {
        parola: norm(r.parola), ok: r.ok !== false, motivo: r.motivo || null,
        t: Math.max(0, Math.min(inputMs, r.t || 0)), canonica: norm(r.canonica || r.parola)
      };
    });

    var gruppi = {};
    chi(lista).forEach(function (nome) {
      var r = lista[nome];
      if (!r.ok) return;
      var k = r.canonica || r.parola;
      (gruppi[k] = gruppi[k] || []).push(nome);
    });

    var punti = {}, dettagli = {};
    chi(lista).forEach(function (nome) {
      var r = lista[nome];
      if (!r.ok) {
        punti[nome] = 0;
        dettagli[nome] = { base: 0, velocita: 0, originalita: 0, motivo: r.motivo || "NON_VALIDA", condivisa: 0 };
        return;
      }
      var k = r.canonica || r.parola;
      var n = (gruppi[k] || []).length;
      var base = CFG.puntiBase;
      var velocita = Math.round(CFG.bonusVelMax * (1 - r.t / inputMs));
      var originalita = n === 1 ? CFG.bonusUnico : (n === 2 ? CFG.bonusCoppia : 0);
      punti[nome] = base + velocita + originalita;
      dettagli[nome] = { base: base, velocita: velocita, originalita: originalita, motivo: null, condivisa: n };
    });

    // chi non ha risposto per niente: 0, ma senza messaggi d'errore in classifica
    (opts.giocatori || chi(risposte)).forEach(function (nome) {
      if (punti[nome] == null) {
        punti[nome] = 0;
        dettagli[nome] = { base: 0, velocita: 0, originalita: 0, motivo: "MANCANTE", condivisa: 0 };
      }
    });

    return { punti: punti, dettagli: dettagli, gruppi: gruppi };
  }

  /**
   * Guard unico per la scrittura di una risposta: lo usa il client dentro la
   * transazione, così la stessa regola vale per ogni dispositivo e si può
   * verificare senza browser. Una risposta è accettata solo se:
   *  - la partita è attiva (`pronto` dopo lo start, o `in_corso`);
   *  - il round richiesto è ancora quello in fase di scrittura, secondo l'orologio
   *    condiviso (i ritardi di rete non riaprono un round);
   *  - il round non è già stato punteggiato e non hai già risposto.
   */
  function puoScrivere(cur, me, opts) {
    opts = opts || {};
    function no(motivo) { return { ok: false, motivo: motivo }; }
    if (!cur) return no("PARTITA_NON_TROVATA");
    if (cur.stato !== "in_corso" && cur.stato !== "pronto") return no("PARTITA_NON_IN_GIOCO");
    var modale = opts.modale;
    var durata = opts.durataMs || cur.durata || ((cur.opzioni || {}).durata * 1000) || CFG.roundMs;
    var n = numeroRound(durata, ciclo(modale).roundMs);
    var f = faseRound(cur.startAt || 0, opts.ora == null ? 0 : opts.ora, { rounds: n, modale: modale });
    if (f.fase === "attesa") return no("COUNTDOWN_IN_CORSO");
    // la risposta finisce nel round APERTO adesso, non in quello che il client
    // aveva sullo schermo: un dispositivo in ritardo di qualche secondo non perde
    // la risposta, ma non può scriverla in un round già giudicato
    if (f.fase !== "input") return no("ROUND_GIA_CHIUSO");
    var i = f.indice;
    if ((((cur.rush || {}).punteggiRound || {})[i])) return no("ROUND_GIA_PUNTEGGIATO");
    if (((((cur.rush || {}).risposte || {})[i] || {})[me])) return no("HAI_GIA_RISPOSTO");
    return { ok: true, round: f, indice: i, t: Math.max(0, Math.round(f.ciclo.inputMs - (f.entroInputMs || 0))) };
  }

  /** Etichette per la rivelazione: chi ha detto cosa, ed era solo? */
  function rivela(risposte, esito) {
    var out = {};
    chi(risposte).forEach(function (nome) {
      var r = risposte[nome] || {}, d = (esito.dettagli || {})[nome] || {};
      out[nome] = {
        parola: r.parola, ok: r.ok !== false, motivo: r.motivo || null,
        originale: (d.condivisa || 0) === 1 && r.ok !== false,
        condivisa: (d.condivisa || 0) >= 2,
        t: r.t || 0
      };
    });
    return out;
  }

  /* ------------------------------ classifica ----------------------------- */

  /**
   * Ordine: punti → numero di risposte uniche → tempo medio di risposta → nome.
   * I criteri sono dichiarati nelle regole e sono gli stessi su ogni client:
   * un pareggio non dipende mai da chi ha scritto per primo sul database.
   */
  function classifica(punteggi, statistiche) {
    var nomi = Object.keys(punteggi || {});
    var out = nomi.map(function (n) {
      var s = (statistiche || {})[n] || {};
      return {
        nome: n,
        punti: punteggi[n] || 0,
        uniche: s.uniche || 0,
        valide: s.valide || 0,
        mancate: s.mancante || 0,
        tempoMedio: s.tetti && s.tetti.length ? Math.round(s.tetti.reduce(function (a, b) { return a + b; }, 0) / s.tetti.length) : Infinity
      };
    });
    out.sort(function (a, b) {
      if (b.punti !== a.punti) return b.punti - a.punti;
      if (b.uniche !== a.uniche) return b.uniche - a.uniche;
      if (a.tempoMedio !== b.tempoMedio) return a.tempoMedio - b.tempoMedio;
      return a.nome < b.nome ? -1 : (a.nome > b.nome ? 1 : 0);
    });
    return out;
  }

  /** Cumula le statistiche di un round nel profilo di ogni giocatore. */
  function accumulaStati(cur, nome, esiti) {
    var out = JSON.parse(JSON.stringify(cur || {}));
    chi(esiti).forEach(function (n) {
      var e = esiti[n];
      var s = out[n] || (out[n] = { valide: 0, uniche: 0, tetti: [], mancante: 0 });
      if (e.parola == null) { s.mancante = (s.mancante || 0) + 1; return; }
      if (e.ok) {
        s.valide++;
        if (e.originale) s.uniche++;
        s.tetti.push(e.t || 0);
        if (s.tetti.length > 12) s.tetti.shift();
      }
    });
    return out;
  }

  /** Esito finale: vince uno solo, oppure è pareggio dichiarato. */
  function esito(grad) {
    if (!grad || !grad.length) return { campione: null, pareggio: false, motivo: "VUOTA" };
    if (grad.length === 1) return { campione: grad[0].nome, pareggio: false, pari: [] };
    var testa = grad[0].punti;
    var pari = grad.filter(function (c) { return c.punti === testa; });
    if (pari.length > 1) {
      // pareggio reale solo se anche i criteri di spareggio coincidono
      var stessoTempo = pari.every(function (c) { return c.tempoMedio === pari[0].tempoMedio && c.uniche === pari[0].uniche; });
      if (stessoTempo) return { campione: null, pareggio: true, pari: pari.map(function (c) { return c.nome; }) };
    }
    return { campione: grad[0].nome, pareggio: false, pari: [] };
  }

  /** Giocatori che non stanno rispondendo (per l'avviso, non per espellerli). */
  function inattivi(giocatori, risposte, roundIdx, da) {
    var min = da == null ? CFG.roundMinimiGiocatore : da;
    if (roundIdx + 1 < min) return [];
    return (giocatori || []).filter(function (n) {
      for (var i = 0; i <= roundIdx; i++) {
        if (((risposte || {})[i] || {})[n]) return false;
      }
      return true;
    });
  }

  /**
   * Punteggio dei round creativi (voto tra pari): partecipazione garantita a chi
   * ha risposto + un premio per ogni voto ricevuto. Se nessuno vota (giocatori
   * offline o partitella a due) il round non si blocca: vale solo la partecipazione.
   */
  function punteggiVotazione(risposte, voti, opts) {
    opts = opts || {};
    var punti = {}, dettagli = {};
    var nomi = chi(risposte).concat((opts.giocatori || []).filter(function (n) { return !risposte[n]; }));
    var cont = {};
    chi(voti || {}).forEach(function (mittente) {
      var t = voti[mittente];
      if (t && t.voto && t.voto !== mittente) cont[t.voto] = (cont[t.voto] || 0) + 1;
    });
    nomi.forEach(function (nome) {
      var r = risposte[nome];
      var v = cont[nome] || 0;
      if (!r) { punti[nome] = 0; dettagli[nome] = { base: 0, voti: 0, motivo: "MANCANTE" }; return; }
      var ammessa = r.ok !== false;
      if (!ammessa) { punti[nome] = 0; dettagli[nome] = { base: 0, voti: 0, motivo: r.motivo || "NON_VALIDA" }; return; }
      punti[nome] = CFG.puntiPartecipazione + v * CFG.puntiVoto;
      dettagli[nome] = { base: CFG.puntiPartecipazione, voti: v, motivo: null };
    });
    return { punti: punti, dettagli: dettagli };
  }

  /**
   * Quando un round può essere chiuso (e quindi punteggiato): solo quando il
   * tempo condiviso dice che la finestra di scrittura — e, nella modalità
   * creativa, anche quella di voto — è finita. `risultati` del round sono scritti
   * una volta sola (claim), quindi più client che ci provano non duplicano i punti.
   */
  function puoChiudere(cur, i, opts) {
    opts = opts || {};
    if (!cur || i == null || i < 0) return false;
    if (cur.stato === "conclusa" || cur.stato === "annullata") return false;
    if (cur.stato !== "in_corso" && cur.stato !== "pronto" && cur.stato !== "chiusura") return false;
    var modale = opts.modale;
    var durata = opts.durataMs || cur.durata || 0;
    var n = numeroRound(durata, ciclo(modale).roundMs);
    if (i >= n) return false;
    var f = faseRound(cur.startAt || 0, opts.ora == null ? 0 : opts.ora, { rounds: n, modale: modale });
    if (i < f.indice) return true;
    if (i === f.indice && (f.fase === "rivela" || f.fase === "finita")) return true;
    if (f.fase === "finita") return true;
    return false;
  }

  function chi(o) { return o ? Object.keys(o) : []; }

  return {
    CFG: CFG, norm: norm, ciclo: ciclo,
    numeroRound: numeroRound, roundsDaSeed: roundsDaSeed, faseRound: faseRound,
    punteggiVotazione: punteggiVotazione,
    valutaRisposta: valutaRisposta, punteggiRound: punteggiRound, rivela: rivela,
    puoScrivere: puoScrivere, puoChiudere: puoChiudere,
    classifica: classifica, accumulaStati: accumulaStati, esito: esito, inattivi: inattivi
  };
});
