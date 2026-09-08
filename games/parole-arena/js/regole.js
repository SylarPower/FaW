/**
 * Parole in Arena — regole pure (nessun DOM, nessun Firebase).
 *
 * Tutto ciò che decide un punteggio sta qui, così è verificabile con i test
 * Node (`tests/unit/arena.test.js`) e identico su ogni client: i client calcolano
 * la stessa cosa a partire da `seed` e dagli timestamp assoluti della partita.
 *
 * Punteggio (semplice e visibile in interfaccia):
 *   base   = 2 × lettere            (parola da 4 lettere → 8)
 *            = 3 × lettere          (da 8 lettere in su)
 *   +4     se la parola ha ≥ 6 lettere
 *   +5     se inizia con la lettera dell'evento attivo
 *   +6     se ha ≥ 7 lettere durante l'evento «parole lunghe»
 *   +6     se usa la casella speciale dell'evento «casella»
 *   ×2     con «Raddio» attivo (massimo 3 parole)
 *   I bonus evento/casella decadono se si subisce «Sabbiatura» (la base resta,
 *   e i punti già guadagnati non vengono mai tolti).
 *
 * Energia: +1 per parola valida, +2 extra da 7 lettere in su, tetto 10.
 */
(function (root, factory) {
  var mod = factory(root);
  if (typeof module === "object" && module.exports) module.exports = mod;
  if (root) root.FAWArenaRules = mod;
})(typeof window !== "undefined" ? window : globalThis, function (global) {
  "use strict";

  var WORDS = global && global.FAWWords ? global.FAWWords : null;

  var CFG = {
    minLen: 4,
    lenMedie: 6,
    lenLunga: 7,
    lenEnorme: 8,
    bonusMedie: 4,
    bonusLettera: 5,
    bonusLunghe: 6,
    bonusCasella: 6,
    eventoOgni: 25000,
    eventoDurata: 25000,
    energiaMax: 10,
    energiaParola: 1,
    energiaLunga: 2,
    energiaDa: 7
  };

  var POWERUP = {
    raddio: { id: "raddio", nome: "Raddio", costo: 4, durata: 12000, maxParole: 3, tipo: "me",
      testo: "×2 punti sulle prossime 3 parole (max 12 s)" },
    scudo: { id: "scudo", nome: "Scudo", costo: 3, durata: 15000, tipo: "me",
      testo: "Annulla il prossimo disturbo che ti arriva (15 s)" },
    sabbiatura: { id: "sabbiatura", nome: "Sabbiatura", costo: 5, durata: 8000, tipo: "altro",
      testo: "Per 8 s un avversario perde i bonus evento e casella (le sue parole restano valide)" }
  };

  var GRIGLIE = { 4: 4, 5: 5, 6: 6 };

  /* ------------------------------- validazione ---------------------------- */

  /**
   * Controlla una selezione: adiacenza (incluse diagonali), niente celle
   * duplicate, lunghezza minima, parola nel dizionario, già trovata o no.
   * Ritorna {ok, motivo, parola, puntiBase}.
   */
  function valutaSelezione(sel, opts) {
    opts = opts || {};
    var size = opts.size || 5;
    var letters = opts.letters || [];
    var idx = (sel || []).map(function (c) { return typeof c === "object" ? c.i : c; });
    if (!idx.length) return { ok: false, motivo: "VUOTA" };
    for (var i = 1; i < idx.length; i++) {
      if (idx.indexOf(idx[i]) !== i) return { ok: false, motivo: "CELLA_DOPPIA" };
      if (WORDS && !WORDS.isAdjacent(idx[i - 1], idx[i], size)) return { ok: false, motivo: "NON_ADJACENT" };
    }
    var parola = idx.map(function (k) { return String(letters[k] || "").toUpperCase(); }).join("");
    if (parola.length < CFG.minLen) return { ok: false, motivo: "CORTA", parola: parola };
    if (opts.giocate && opts.giocate.has(parola)) return { ok: false, motivo: "GIÀ_TROVATA", parola: parola };
    if (opts.giocateLista && opts.giocateLista.indexOf(parola) >= 0) return { ok: false, motivo: "GIÀ_TROVATA", parola: parola };
    if (WORDS && !WORDS.isWord(parola)) return { ok: false, motivo: "NON_TROVATA", parola: parola };
    return { ok: true, parola: parola, lunghezza: parola.length, celle: idx, puntiBase: puntiBase(parola.length) };
  }

  function puntiBase(len) {
    if (len < CFG.minLen) return 0;
    return len >= CFG.lenEnorme ? len * 3 : len * 2;
  }

  /**
   * Punteggio completo di una parola.
   * `evento` = evento attivo (o null); `effetti` = {raddio, sabbiato, casella}
   * Ritorna {punti, dettagli:[{k, v}]} dove `dettagli` è ciò che si mostra in UI.
   */
  function punteggi(parola, opts) {
    opts = opts || {};
    var len = parola.length;
    var dettagli = [];
    var p = puntiBase(len);
    dettagli.push({ k: len + " lettere", v: p });
    var bloccato = !!opts.effetti || {};
    var sabbiato = !!(opts.effetti && opts.effetti.sabbiato);
    var extra = 0;
    if (len >= CFG.lenMedie) { extra += CFG.bonusMedie; dettagli.push({ k: "parola da " + CFG.lenMedie + "+", v: CFG.bonusMedie }); }
    var ev = opts.evento;
    if (ev && !sabbiato) {
      if (ev.tipo === "lettera" && parola.charAt(0) === ev.payload) { extra += CFG.bonusLettera; dettagli.push({ k: "evento lettera " + ev.payload, v: CFG.bonusLettera }); }
      if (ev.tipo === "lunghezza" && len >= CFG.lenLunga) { extra += CFG.bonusLunghe; dettagli.push({ k: "evento parole lunghe", v: CFG.bonusLunghe }); }
      if (ev.tipo === "casella" && opts.effetti && opts.effetti.casellaSpeciale) { extra += CFG.bonusCasella; dettagli.push({ k: "casella speciale", v: CFG.bonusCasella }); }
    }
    p += extra;
    var mult = 1;
    if (opts.effetti && opts.effetti.raddio) {
      mult = 2;
      dettagli.push({ k: "Raddio", v: "×2" });
    }
    if (sabbiato && extra > 0) dettagli.push({ k: "Sabbiatura: bonus evento non contati", v: -extra });
    return { punti: Math.round(p * mult), dettagli: dettagli, base: p, moltiplicatore: mult };
  }

  function energiaDopo(corrente, len) {
    var add = CFG.energiaParola + (len >= CFG.energiaDa ? CFG.energiaLunga : 0);
    return Math.min(CFG.energiaMax, (corrente || 0) + add);
  }

  /* --------------------------------- eventi -------------------------------- */

  /**
   * Evento attivo all'istante `t` della partita (ms da `startAt`).
   * Deterministico: `seed` + indice dell'evento. Nessun campo scritto su
   * Firebase → non può disallinearsi tra client e non tocca le lettere già
   * trascinare: la casella speciale aggiunge solo un bordo e un bonus.
   */
  function eventoAttivo(seed, elapsedMs, opts) {
    opts = opts || {};
    if (opts.senzaEventi) return null;
    if (elapsedMs < 0) return null;
    var i = Math.floor(elapsedMs / CFG.eventoOgni);
    if (i < 0) return null;
    var dentro = elapsedMs - i * CFG.eventoOgni;
    var durata = Math.min(CFG.eventoDurata, (opts.durataMs == null ? Infinity : opts.durataMs) - i * CFG.eventoOgni);
    if (durata <= 0) return null;
    var rng = (global.FAWCore ? global.FAWCore.rngFrom(seed + ":evento:" + i) : Math.random);
    var r = typeof rng === "function" ? rng() : rng;
    var tipo = r < 0.42 ? "lettera" : (r < 0.76 ? "lunghezza" : "casella");
    var payload = null;
    if (tipo === "lettera") {
      var alf = "ABCDEFGHIILMNOPQRSTUUV"; // niente J/K/W/X/Y: quasi assenti in italiano
      payload = alf.charAt(Math.floor((typeof rng === "function" ? rng() : Math.random()) * alf.length));
    } else if (tipo === "casella") {
      payload = Math.floor((typeof rng === "function" ? rng() : Math.random()) * (opts.celle || 25));
    }
    var etichette = {
      lettera: "Bonus +5: parole che iniziano per " + payload,
      lunghezza: "Bonus +6: parole da 7 lettere in su",
      casella: "Bonus +6: usa la casella speciale"
    };
    return {
      i: i, tipo: tipo, payload: payload, etichetta: etichette[tipo],
      inizioMs: i * CFG.eventoOgni, fineMs: i * CFG.eventoOgni + durata,
      entroMs: durata - dentro, progressione: dentro / durata
    };
  }

  /* ------------------------------ potenziamenti ---------------------------- */

  /**
   * Può attivare il potenziamento adesso?
   * Vincoli: mai bloccare i comandi, niente catene di attacchi sullo stesso
   * giocatore, costo/durata/bersaglio chiari (il motivo lo dice all'utente).
   */
  function puoAttivare(id, stato, t) {
    t = t == null ? Date.now() : t;
    var cfg = POWERUP[id];
    if (!cfg) return { ok: false, motivo: "Potenziamento sconosciuto" };
    var me = stato.me;
    var arena = stato.arena || {};
    var attivi = arena.attivi || {};
    var miei = attivi[me] || {};
    if ((arena.energia || {})[me] < cfg.costo) return { ok: false, motivo: "Serve energia " + cfg.costo };
    if (cfg.tipo === "me" && miei[id] && miei[id].fine > t) return { ok: false, motivo: "Già attivo" };
    if (id === "sabbiatura") {
      var bersagli = bersagliAttacabili(stato, t);
      if (!bersagli.length) return { ok: false, motivo: "Nessun bersaglio libero" };
      var scelto = stato.bersaglio && bersagli.indexOf(stato.bersaglio) >= 0 ? stato.bersaglio : bersagli[0];
      if (arena.ultimoBersaglio === scelto && (arena.ultimoColpo || 0) + CFG.eventoOgni > t) {
        var altro = bersagli.filter(function (b) { return b !== scelto; })[0];
        if (!altro) return { ok: false, motivo: "Bersaglio già colpito adesso: " + scelto + " è immune 12 s" };
        scelto = altro;
      }
      return { ok: true, bersaglio: scelto, costo: cfg.costo, durata: cfg.durata };
    }
    return { ok: true, costo: cfg.costo, durata: cfg.durata };
  }

  /** Avversagli attaccabili: vivi, non sotto scudo, non appena colpiti. */
  function bersagliAttacabili(stato, t) {
    t = t == null ? Date.now() : t;
    var arena = stato.arena || {};
    var attivi = arena.attivi || {};
    var immune = arena.immune || {};
    return (stato.giocatori || []).filter(function (n) {
      if (n === stato.me) return false;
      if ((attivi[n] || {}).scudo && attivi[n].scudo.fine > t) return false;
      if (immune[n] && immune[n] > t) return false;
      return true;
    });
  }

  /** Patch Firestore per l'attivazione (chiavi dotted, idempotente per tasto). */
  function patchAttivazione(id, me, bersaglio, t, arena) {
    t = t == null ? Date.now() : t;
    var cfg = POWERUP[id];
    var out = {};
    out["arena.energia." + me] = Math.max(0, ((arena && arena.energia || {})[me] || 0) - cfg.costo);
    if (cfg.tipo === "me") {
      out["arena.attivi." + me + "." + id] = { inizio: t, fine: t + cfg.durata, parole: id === "raddio" ? cfg.maxParole : 0 };
    } else {
      out["arena.colpito." + bersaglio] = { da: me, fine: t + cfg.durata };
      out["arena.immune." + bersaglio] = t + cfg.durata + 12000;
      out["arena.ultimoBersaglio"] = bersaglio;
      out["arena.ultimoColpo"] = t;
    }
    out["logUltimo"] = { t: t, tipo: id, da: me, su: bersaglio || null };
    return out;
  }

  /* ------------------------------ classifica -------------------------------- */

  function classifica(data, opts) {
    opts = opts || {};
    var pun = (data && data.punteggi) || {};
    var parole = (data && data.parole) || {};
    var arena = (data && data.arena) || {};
    var energia = arena.energia || {};
    var nomi = Object.keys(pun);
    if (opts.giocatori) nomi = opts.giocatori.slice();
    return nomi.map(function (n) {
      var list = parole[n] || [];
      var max = 0;
      list.forEach(function (w) { if (w.length > max) max = w.length; });
      return {
        nome: n, punti: pun[n] || 0, parole: list.length,
        piuLunga: max, energia: energia[n] || 0,
        inattivo: !!(arena.inattivi || []).includes(n)
      };
    }).sort(function (a, b) {
      if (b.punti !== a.punti) return b.punti - a.punti;
      if (b.parole !== a.parole) return b.parole - a.parole;
      return a.nome < b.nome ? -1 : 1;
    });
  }

  /** Parola più lunga della partita (con autore). */
  function piuLunga(data) {
    var parole = (data && data.parole) || {};
    var best = { parola: "", len: 0, chi: "" };
    Object.keys(parole).forEach(function (n) {
      (parole[n] || []).forEach(function (w) {
        if (w.length > best.len) best = { parola: w, len: w.length, chi: n };
      });
    });
    return best.len ? best : null;
  }

  /**
   * Miglior rimonta reale: massimo recupero di distacco dal primo, calcolato
   * sulla curva dei punteggi campionata ai flush. Serve almeno 4 campioni,
   * altrimenti si risponde null (nessun numero inventato).
   */
  function migliorRimonta(curve, nomi) {
    if (!curve || curve.length < 4) return null;
    var out = null;
    nomi.forEach(function (n) {
      var i = nomi.indexOf(n);
      var best = 0, maxGap = 0;
      curve.forEach(function (row) {
        var me = row[i + 1] || 0;
        var leader = Math.max.apply(null, nomi.map(function (_, j) { return row[j + 1] || 0; }));
        var gap = leader - me;
        if (gap > maxGap) maxGap = gap;
        var rec = maxGap - gap;
        if (rec > best) best = rec;
      });
      if (best > 0 && (!out || best > out.recupero)) out = { nome: n, recupero: best };
    });
    return out;
  }

  function curvaRow(t, ordine, punteggiMap) {
    return [t].concat(ordine.map(function (n) { return punteggiMap[n] || 0; }));
  }

  /** Esito finale: chi vince, eventuali pareggi dichiarati come tali. */
  function esito(classifica) {
    if (!classifica || !classifica.length) return { tipo: "vuoto" };
    var top = classifica[0];
    var pari = classifica.filter(function (c) { return c.punti === top.punti; });
    if (pari.length > 1) return { tipo: "pareggio", nomi: pari.map(function (p) { return p.nome; }), punti: top.punti };
    return { tipo: "vittoria", nome: top.nome, punti: top.punti };
  }

  return {
    CFG: CFG, POWERUP: POWERUP, GRIGLIE: GRIGLIE,
    puntiBase: puntiBase, punteggi: punteggi, energiaDopo: energiaDopo,
    valutaSelezione: valutaSelezione, eventoAttivo: eventoAttivo,
    puoAttivare: puoAttivare, bersagliAttacabili: bersagliAttacabili, patchAttivazione: patchAttivazione,
    classifica: classifica, piuLunga: piuLunga, migliorRimonta: migliorRimonta,
    curvaRow: curvaRow, esito: esito
  };
});
