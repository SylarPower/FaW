/**
 * Rush — reducer puri, condivisi tra multiplayer e allenamento.
 * Sprint: massimo 26+4 s, punti 100 + velocità 0..40 + originalità 60/15/0.
 * Creativo: massimo 26+7+5 s, partecipazione 40 + 100 per voto ricevuto.
 * NCC: schede con la stessa lettera, massimo 50+10 s, punteggi 20/10/5/0.
 * L'ultima consegna/voto/conferma accorcia la fase nella stessa transazione.
 * Le durate persistite sono relative: startAt e i tempi dei round chiusi non
 * vengono riscritti, il bonus Sprint continua a riferirsi ai 26 secondi nominali.
 */
(function (root, factory) {
  var mod = factory(root);
  if (typeof module === "object" && module.exports) module.exports = mod;
  if (root) root.FAWRushRules = mod;
})(typeof window !== "undefined" ? window : globalThis, function (global) {
  "use strict";

  var CAT = global.FAWCategorie || (typeof require === "function" ? require("../../shared/faw-categorie.js") : null);
  var CORE = global.FAWCore || (typeof require === "function" ? require("../../shared/faw-core.js") : null);
  var NCC = global.FAWNcc || (typeof require === "function" ? require("./nomi-cose-citta.js") : null);

  var CFG = {
    // Sprint: fino a 26 s per rispondere + 4 s di rivelazione = 30 s massimi
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
    if (modale === NCC.MODE) return { roundMs: NCC.CFG.roundMs, inputMs: NCC.CFG.inputMs, votoMs: 0, rivelaMs: NCC.CFG.rivelaMs, scheda: true };
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
  var roundsCache = new Map();
  function roundsDaSeed(seed, n, opts) {
    opts = opts || {};
    var key = [seed, n, opts.modale || "classiche", opts.min || 4, JSON.stringify(opts.lessico || null)].join(":");
    if (roundsCache.has(key)) return roundsCache.get(key);
    var out = [];
    var usati = [], categorieUsate = [];
    for (var i = 0; i < n; i++) {
      var rng = CORE ? CORE.rngFrom(seed + ":rush:" + i) : Math.random;
      if (opts.modale === "creative") {
        var lista = (CAT && CAT.CREATIVE) || [];
        if (!lista.length) break;
        var nuove = lista.filter(function (c) { return categorieUsate.indexOf(c.id) < 0; });
        if (!nuove.length) nuove = lista;
        var c = nuove[Math.floor(rng() * nuove.length)];
        categorieUsate.push(c.id);
        out.push({ i: i, categoria: c.id, nome: c.nome, lettera: null, votazione: true });
        continue;
      }
      var cb = CAT ? CAT.pickCombo(rng, { lessico: opts.lessico, escludi: usati, escludiCategorie: categorieUsate, ultimaLettera: out.length ? out[out.length - 1].lettera : null, min: opts.min == null ? 4 : opts.min }) : null;
      if (!cb) continue;
      usati.push(cb.id + ":" + cb.lettera);
      categorieUsate.push(cb.id);
      out.push({ i: i, categoria: cb.id, nome: cb.nome, lettera: cb.lettera, possibili: cb.n });
    }
    if (roundsCache.size > 64) roundsCache.clear();
    roundsCache.set(key, out);
    return out;
  }

  /** Timeline nominale/compatibilità. Il gioco usa fasePartita con rush.tempi. */
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
    if (/[^a-zà-öø-ÿ\s'’\-]/i.test(String(testo).trim())) return ko("CARATTERI");
    if (!CAT) return ko("DIZIONARIO_ASSENTE");
    if (!combo) return ko("CATEGORIA_SCONOSCIUTA");
    if (combo.votazione || opts.creativo) {
      // modalità creativa: nessun elenco chiuso da consultare, la risposta è
      // giudicata a voto tra giocatori; qui si filtra solo l'assurdo
      return { ok: true, parola: n, canonica: n, categoriaId: combo.categoria, creativo: true };
    }
    var categoria = combo.categoriaId ? CAT.byId(combo.categoriaId, opts.lessico) : CAT.byId(combo.categoria, opts.lessico);
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
        parola: norm(r.parola), ok: !!norm(r.parola) && r.ok !== false, motivo: r.motivo || null,
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
    if ((cur.partecipanti || []).indexOf(me) < 0) return no("NON_PARTECIPANTE");
    if (!cur.startAt) return no("COUNTDOWN_IN_CORSO");
    if (!Number.isFinite(opts.ora)) return no("ROUND_GIA_CHIUSO");
    var f = fasePartita(cur, opts.ora);
    if (f.fase === "attesa") return no("COUNTDOWN_IN_CORSO");
    // Il payload appartiene alla domanda vista: mai riciclarlo nel round nuovo.
    if (f.fase !== "input") return no("ROUND_GIA_CHIUSO");
    var i = f.indice;
    if (opts.roundIdx != null && opts.roundIdx !== i) return no("ROUND_SUPERATO");
    if ((((cur.rush || {}).punteggiRound || {})[i])) return no("ROUND_GIA_PUNTEGGIATO");
    if (((((cur.rush || {}).risposte || {})[i] || {})[me])) return no("HAI_GIA_RISPOSTO");
    return { ok: true, round: f, indice: i, t: Math.max(0, opts.ora - cur.startAt - f.inizioRound) };
  }

  /** Etichette per la rivelazione: chi ha detto cosa, ed era solo? */
  function rivela(risposte, esito) {
    var out = {};
    chi(esito.dettagli).forEach(function (nome) {
      var r = risposte[nome] || {}, d = (esito.dettagli || {})[nome] || {};
      out[nome] = {
        parola: r.parola || null, ok: !!r.parola && r.ok !== false, motivo: r.motivo || d.motivo || null,
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
  function classifica(punteggi, statistiche, opts) {
    var nomi = Object.keys(punteggi || {});
    var out = nomi.map(function (n) {
      var s = (statistiche || {})[n] || {};
      return {
        nome: n,
        punti: punteggi[n] || 0,
        uniche: s.uniche || 0,
        valide: s.valide || 0,
        mancate: s.mancante || 0,
        tempoMedio: s.tetti && s.tetti.length ? Math.round(s.tetti.reduce(function (a, b) { return a + b; }, 0) / s.tetti.length) : null
      };
    });
    out.sort(function (a, b) {
      if (b.punti !== a.punti) return b.punti - a.punti;
      if (opts && opts.modale === NCC.MODE) return a.nome.localeCompare(b.nome);
      if (b.uniche !== a.uniche) return b.uniche - a.uniche;
      if (a.tempoMedio !== b.tempoMedio) return (a.tempoMedio == null ? Infinity : a.tempoMedio) - (b.tempoMedio == null ? Infinity : b.tempoMedio);
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
      if (e.scheda) {
        s.valide = (s.valide || 0) + (e.valide || 0); s.uniche = (s.uniche || 0) + (e.uniche || 0); s.mancante = (s.mancante || 0) + (e.mancante || 0);
        return;
      }
      if (e.parola == null) { s.mancante = (s.mancante || 0) + 1; return; }
      if (e.ok) {
        s.valide = (s.valide || 0) + 1;
        if (e.originale) s.uniche = (s.uniche || 0) + 1;
        s.tetti = s.tetti || [];
        s.tetti.push(e.t || 0);
        if (s.tetti.length > 12) s.tetti.shift();
      }
    });
    return out;
  }

  /** Esito finale: vince uno solo, oppure è pareggio dichiarato. */
  function esito(grad, opts) {
    if (!grad || !grad.length) return { campione: null, pareggio: false, motivo: "VUOTA" };
    if (grad.length === 1) return { campione: grad[0].nome, pareggio: false, pari: [] };
    var primo = grad[0];
    var pari = grad.filter(function (c) { return c.punti === primo.punti && ((opts && opts.modale === NCC.MODE) || (c.uniche === primo.uniche && c.tempoMedio === primo.tempoMedio)); });
    if (pari.length > 1) return { campione: null, pareggio: true, pari: pari.map(function (c) { return c.nome; }) };
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
      if (t && t.voto && t.voto !== mittente && (opts.giocatori || chi(risposte)).indexOf(mittente) >= 0 && risposte[t.voto] && risposte[t.voto].ok !== false) cont[t.voto] = (cont[t.voto] || 0) + 1;
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
    if (!cur || !Number.isInteger(i) || i < 0 || !Number.isFinite(opts.ora) || !cur.startAt) return false;
    if (["pronto", "in_corso", "chiusura"].indexOf(cur.stato) < 0) return false;
    var source = opts.modale ? Object.assign({}, cur, { opzioni: Object.assign({}, cur.opzioni, { mode: opts.modale }) }) : cur;
    var piano = tempiPartita(source)[i];
    return !!piano && opts.ora >= cur.startAt + piano.fineVoto;
  }

  /** Durata nominale fissa, scadenze effettive variabili; mai spostare startAt. */
  function impostazioni(cur) {
    var o = cur.opzioni || {}, mode = ["creative", NCC.MODE].indexOf(o.mode) >= 0 ? o.mode : "classiche";
    var c = ciclo(mode);
    var n = numeroRound(cur.durata || Number(o.durata || 120) * 1000, c.roundMs);
    var domande = (cur.rush || {}).domande || (mode === NCC.MODE
      ? NCC.rounds(o.seed || cur.seed || "SEED", n, o.colonne, cur.lessico)
      : roundsDaSeed(o.seed || cur.seed || "SEED", n, { modale: mode, lessico: cur.lessico }));
    return { modale: mode, ciclo: c, domande: domande, rounds: domande.length };
  }

  // Durate in ms RELATIVE al via del round. Quelle mancanti mantengono il limite
  // nominale: i documenti precedenti e i round non ancora giocati restano leggibili.
  function tempiPartita(cur, config) {
    config = config || impostazioni(cur);
    var c = config.ciclo, start = 0, stored = (cur.rush || {}).tempi || {};
    function durata(value, max) { return Number.isFinite(value) && value >= 0 ? Math.min(value, max) : max; }
    return config.domande.map(function (_, i) {
      var t = stored[i] || {};
      var scrittura = durata(t.scritturaMs, c.inputMs), voto = durata(t.votoMs, c.votoMs), confronto = durata(t.confrontoMs, c.rivelaMs);
      var out = { inizio: start, fineInput: start + scrittura, fineVoto: start + scrittura + voto,
        fine: start + scrittura + voto + confronto, scritturaMs: scrittura, votoMs: voto, confrontoMs: confronto };
      start = out.fine;
      return out;
    });
  }
  function fasePartita(cur, ora) {
    var config = impostazioni(cur), piani = tempiPartita(cur, config), t = ora - (cur.startAt || 0);
    var fine = piani.length ? piani[piani.length - 1].fine : 0;
    var f = { rounds: config.rounds, indice: -1, fase: "attesa", entroMs: Math.max(0, -t), entroInputMs: 0,
      fineMatch: (cur.startAt || 0) + fine, ciclo: config.ciclo, inizioRound: 0, fineInput: 0, faseMs: config.ciclo.inputMs };
    if (t < 0 || !Number.isFinite(t)) return f;
    for (var i = 0; i < piani.length; i++) {
      var p = piani[i];
      if (t >= p.fine) continue;
      f.indice = i; f.inizioRound = p.inizio; f.fineInput = p.fineInput;
      if (t < p.fineInput) { f.fase = "input"; f.entroMs = f.entroInputMs = p.fineInput - t; f.faseMs = p.scritturaMs; }
      else if (t < p.fineVoto) { f.fase = "voto"; f.entroMs = p.fineVoto - t; f.faseMs = p.votoMs; }
      else { f.fase = "rivela"; f.entroMs = p.fine - t; f.faseMs = p.confrontoMs; }
      return f;
    }
    f.indice = Math.max(0, config.rounds - 1); f.fase = "finita"; f.entroMs = 0;
    return f;
  }
  function giocatoriRound(cur, i) {
    var t = (((cur.rush || {}).tempi || {})[i] || {});
    return (t.giocatori || cur.partecipanti || []).slice();
  }
  function consegnata(r) { return !!r && (r.passo === true || r.scheda === true || (r.ok === true && !!r.parola)); }
  function tuttiConsegnati(cur, i) {
    var players = giocatoriRound(cur, i), rows = (((cur.rush || {}).risposte || {})[i] || {});
    return players.length > 0 && players.every(function (nome) { return consegnata(rows[nome]); });
  }
  function elettori(cur, i) {
    var players = giocatoriRound(cur, i), rows = (((cur.rush || {}).risposte || {})[i] || {});
    return players.filter(function (nome) { return players.some(function (altro) { return altro !== nome && rows[altro] && rows[altro].ok === true && !!rows[altro].parola; }); });
  }
  function tuttiVotato(cur, i) {
    var voti = (((cur.rush || {}).voti || {})[i] || {});
    return elettori(cur, i).every(function (nome) { return !!voti[nome]; });
  }
  function tuttiAvanti(cur, i) {
    var pronti = (((cur.rush || {}).avanti || {})[i] || {}), nomi = giocatoriRound(cur, i);
    return nomi.length > 0 && nomi.every(function (nome) { return pronti[nome] === true; });
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function completaMutazione(cur, rush, ora) {
    var next = Object.assign({}, cur, { rush: rush });
    // L'ultima consegna/voto e la chiusura hanno lo STESSO commit, non due gare.
    return Object.assign({ rush: rush }, avanza(next, ora) || {});
  }

  function giaUsate(cur, me, primaDi) {
    var risposte = (cur.rush || {}).risposte || {};
    return chi(risposte).filter(function (i) { return Number(i) < primaDi; }).map(function (i) {
      var r = risposte[i][me];
      return r && r.ok !== false ? (r.canonica || r.parola) : "";
    }).filter(Boolean);
  }

  function rispostaPatch(cur, me, richiesta, ora) {
    richiesta = richiesta || {};
    if (!Number.isInteger(richiesta.roundIdx)) return { ok: false, motivo: "ROUND_SUPERATO" };
    var guard = puoScrivere(cur, me, { ora: ora, roundIdx: richiesta.roundIdx });
    if (!guard.ok) return guard;
    var config = impostazioni(cur), i = guard.indice, rush = clone(cur.rush || {}), response;
    rush.risposte = rush.risposte || {}; rush.risposte[i] = rush.risposte[i] || {};
    if (config.modale === NCC.MODE) {
      var v = NCC.valuta(richiesta.valori, config.domande[i], cur.lessico);
      if (Object.keys(v.errori).length) return { ok: false, motivo: "SCHEDA_NON_VALIDA", errori: v.errori };
      var precedente = ((rush.bozze || {})[i] || {})[me], rev = richiesta.rev == null ? 0 : richiesta.rev;
      if (!Number.isInteger(rev) || rev < 0 || (precedente && rev < precedente.rev)) return { ok: false, motivo: "BOZZA_SUPERATA" };
      response = { scheda: true, valori: v.valori, rev: richiesta.rev || 0, completa: v.completa, t: guard.t };
      // Chi completa davvero la scheda dà lo Stop; mai allungare una scadenza.
      if (v.completa) {
        rush.tempi = rush.tempi || {}; var tm = rush.tempi[i] || (rush.tempi[i] = {});
        if (!tm.stopDa) { tm.stopDa = me; tm.motivo = "stop"; tm.scritturaMs = Math.min(tempiPartita(cur, config)[i].scritturaMs, guard.t + NCC.CFG.stopMs); }
      }
    } else if (richiesta.passo === true) {
      response = { passo: true, parola: "", ok: false, motivo: "PASSO", t: guard.t };
    } else {
      var validita = valutaRisposta(richiesta.testo, config.domande[i], { giaUsate: giaUsate(cur, me, i), lessico: cur.lessico });
      if (!validita.ok) return validita;
      response = { parola: validita.parola, canonica: validita.canonica, ok: true, t: guard.t };
    }
    rush.risposte[i][me] = response;
    return { ok: true, patch: completaMutazione(cur, rush, ora) };
  }
  function bozzaPatch(cur, me, richiesta, ora) {
    if (!richiesta || !Number.isInteger(richiesta.roundIdx) || !Number.isInteger(richiesta.rev) || richiesta.rev < 1) return false;
    var guard = puoScrivere(cur, me, { ora: ora, roundIdx: richiesta.roundIdx });
    if (!guard.ok || impostazioni(cur).modale !== NCC.MODE) return false;
    var rush = clone(cur.rush || {}), i = guard.indice;
    rush.bozze = rush.bozze || {}; rush.bozze[i] = rush.bozze[i] || {};
    if (rush.bozze[i][me] && rush.bozze[i][me].rev >= richiesta.rev) return false;
    rush.bozze[i][me] = { valori: NCC.pulisci(richiesta.valori, impostazioni(cur).domande[i]), rev: richiesta.rev, t: guard.t };
    return { rush: rush };
  }
  function votoPatch(cur, me, richiesta, ora) {
    if (!cur || !richiesta || !Number.isInteger(richiesta.roundIdx) || !Number.isFinite(ora) || ["in_corso", "pronto"].indexOf(cur.stato) < 0 || (cur.partecipanti || []).indexOf(me) < 0) return false;
    var f = fasePartita(cur, ora), rush = clone(cur.rush || {});
    var rows = (rush.risposte || {})[richiesta.roundIdx] || {}, target = rows[richiesta.nome];
    if (f.fase !== "voto" || f.indice !== richiesta.roundIdx || elettori(cur, f.indice).indexOf(me) < 0) return false;
    if (!richiesta.astieni && (!target || target.ok !== true || !target.parola || richiesta.nome === me || giocatoriRound(cur, f.indice).indexOf(richiesta.nome) < 0)) return false;
    if (((rush.voti || {})[f.indice] || {})[me]) return false;
    rush.voti = rush.voti || {}; rush.voti[f.indice] = rush.voti[f.indice] || {};
    rush.voti[f.indice][me] = { voto: richiesta.astieni ? null : richiesta.nome, astensione: !!richiesta.astieni, t: ora };
    return completaMutazione(cur, rush, ora);
  }
  function avantiPatch(cur, me, richiesta, ora) {
    if (!cur || !richiesta || !Number.isFinite(ora) || ["pronto", "in_corso"].indexOf(cur.stato) < 0 || (cur.partecipanti || []).indexOf(me) < 0) return false;
    var f = fasePartita(cur, ora), i = richiesta.roundIdx;
    if (!Number.isInteger(i) || f.fase !== "rivela" || f.indice !== i || giocatoriRound(cur, i).indexOf(me) < 0 || !((cur.rush || {}).punteggiRound || {})[i]) return false;
    var rush = clone(cur.rush);
    rush.avanti = rush.avanti || {}; rush.avanti[i] = rush.avanti[i] || {};
    if (rush.avanti[i][me]) return false;
    rush.avanti[i][me] = true;
    return completaMutazione(cur, rush, ora);
  }

  /**
   * Risolve TUTTI i round scaduti e congela i risultati nella stessa transazione.
   * Idempotente: rientro dopo minuti offline, due resolver e ultimo invio simultaneo
   * non perdono né raddoppiano punti. Nessuna promessa concorrente per singolo round.
   */
  function avanza(cur, ora) {
    if (!cur || !cur.startAt || !Number.isFinite(ora) || ["pronto", "in_corso", "chiusura"].indexOf(cur.stato) < 0 || ora < cur.startAt) return false;
    var config = impostazioni(cur), next = clone(cur), patch = {}, changed = false, scored = false;
    var rush = next.rush || (next.rush = {});
    if (!rush.domande) { rush.domande = config.domande; changed = true; }
    if (cur.stato === "pronto") patch.stato = "in_corso";
    rush.tempi = rush.tempi || {};
    var f = fasePartita(next, ora), piani = tempiPartita(next, config), elapsed = ora - cur.startAt;
    function tempo(i) { return rush.tempi[i] || (rush.tempi[i] = {}); }
    if (f.fase === "input" && tuttiConsegnati(next, f.indice)) {
      var tm = tempo(f.indice); tm.scritturaMs = Math.max(0, elapsed - f.inizioRound); tm.motivo = "tutti";
      tm.giocatori = giocatoriRound(next, f.indice); changed = true;
      f = fasePartita(next, ora);
    }
    if ((f.fase === "voto" || f.fase === "rivela") && !tempo(f.indice).giocatori) {
      tempo(f.indice).giocatori = (cur.partecipanti || []).slice(); changed = true;
    }
    if (f.fase === "voto" && tuttiVotato(next, f.indice)) {
      var p = tempiPartita(next, config)[f.indice];
      tempo(f.indice).votoMs = elettori(next, f.indice).length ? Math.max(0, elapsed - p.fineInput) : 0;
      changed = true; f = fasePartita(next, ora);
    }
    if (f.fase === "rivela" && tuttiAvanti(next, f.indice)) {
      tempo(f.indice).confrontoMs = Math.max(0, elapsed - tempiPartita(next, config)[f.indice].fineVoto);
      changed = true; f = fasePartita(next, ora);
    }
    piani = tempiPartita(next, config);
    rush.punteggiRound = rush.punteggiRound || {}; rush.dettagliRound = rush.dettagliRound || {}; rush.rivela = rush.rivela || {};
    next.punteggi = next.punteggi || {};
    for (var i = 0; i < config.rounds; i++) {
      if (rush.punteggiRound[i] || elapsed < piani[i].fineVoto) continue;
      var originali = (rush.risposte || {})[i] || {}, risposte = {}, players = giocatoriRound(next, i), es;
      tempo(i).giocatori = players;
      players.forEach(function (nome) {
        var r = originali[nome];
        if (config.modale === NCC.MODE) {
          r = r || ((rush.bozze || {})[i] || {})[nome] || {};
          var inTempo = Number.isFinite(r.t) && r.t >= 0 && r.t < config.ciclo.inputMs && r.t <= piani[i].scritturaMs;
          risposte[nome] = { scheda: true, valori: NCC.pulisci(inTempo ? r.valori : {}, config.domande[i]), t: r.t || 0, rev: r.rev || 0 };
        } else if (r) {
          var v = r.passo ? { ok: false, motivo: "PASSO" } : valutaRisposta(r.parola, config.domande[i], { giaUsate: giaUsate(next, nome, i) });
          risposte[nome] = Object.assign({}, r, { canonica: v.canonica || r.canonica || "", motivo: v.motivo || null,
            ok: v.ok && r.ok !== false && Number.isFinite(r.t) && r.t >= 0 && r.t < config.ciclo.inputMs && r.t <= piani[i].scritturaMs });
        }
      });
      if (config.modale === NCC.MODE) {
        es = NCC.punteggi(risposte, config.domande[i], players, cur.lessico);
        rush.risposte = rush.risposte || {}; rush.risposte[i] = risposte;
        rush.rivela[i] = es.rivela;
      } else {
        es = config.modale === "creative" ? punteggiVotazione(risposte, (rush.voti || {})[i] || {}, { giocatori: players }) : punteggiRound(risposte, { giocatori: players });
        rush.rivela[i] = rivela(risposte, es);
      }
      rush.punteggiRound[i] = es.punti; rush.dettagliRound[i] = es.dettagli;
      rush.statistiche = accumulaStati(rush.statistiche, null, rush.rivela[i]);
      Object.keys(es.punti).forEach(function (n) { next.punteggi[n] = (next.punteggi[n] || 0) + es.punti[n]; });
      rush.roundChiuso = i; changed = scored = true;
    }
    var fine = Math.round(f.fineMatch);
    if (cur.endsAt !== fine) patch.endsAt = fine;
    if (changed) patch.rush = rush;
    if (scored) patch.punteggi = next.punteggi;
    if (f.fase === "finita") {
      var grad = classifica(next.punteggi, rush.statistiche, config);
      patch.stato = "conclusa"; patch.finito = (cur.partecipanti || []).slice(); patch.fine = fine;
      patch.risultati = { gioco: "categoria-rush", mode: config.modale, classifica: grad, esito: esito(grad, config),
        punteggiFinale: next.punteggi, round: config.rounds, endAt: fine, statistiche: rush.statistiche || {},
        secondiRisparmiati: Math.max(0, Math.floor((config.rounds * config.ciclo.roundMs - (fine - cur.startAt)) / 1000)) };
    }
    return Object.keys(patch).length ? patch : false;
  }

  function chi(o) { return o ? Object.keys(o) : []; }

  return {
    NCC: NCC, tempiPartita: tempiPartita, giocatoriRound: giocatoriRound, tuttiConsegnati: tuttiConsegnati,
    elettori: elettori, tuttiVotato: tuttiVotato, tuttiAvanti: tuttiAvanti, bozzaPatch: bozzaPatch, avantiPatch: avantiPatch,
    CFG: CFG, norm: norm, ciclo: ciclo,
    impostazioni: impostazioni, fasePartita: fasePartita, rispostaPatch: rispostaPatch, votoPatch: votoPatch, avanza: avanza, giaUsate: giaUsate,
    numeroRound: numeroRound, roundsDaSeed: roundsDaSeed, faseRound: faseRound,
    punteggiVotazione: punteggiVotazione,
    valutaRisposta: valutaRisposta, punteggiRound: punteggiRound, rivela: rivela,
    puoScrivere: puoScrivere, puoChiudere: puoChiudere,
    classifica: classifica, accumulaStati: accumulaStati, esito: esito, inattivi: inattivi
  };
});
