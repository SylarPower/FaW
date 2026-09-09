/**
 * La Bomba delle Parole — regole pure (nessun DOM, nessun network).
 *
 * La bomba passa di mano con una parola italiana che CONTIENE la sequenza
 * mostrata: con TRA valgono STRADA e TRAMONTO, non RETE.
 * Regola unica: `parola.indexOf(sequenza) >= 0`.
 *
 * Miccia: un solo orologio. `round.inizioAlle` (tempo del server) + `micciaMs`:
 * il passaggio NON azzera mai la miccia, quindi il tempo totale del round è noto
 * a tutti e le decisioni non dipendono dai timer locali.
 *
 * Punteggio dichiarato (più è meglio, coerente con l'hub):
 *   +10 per ogni parola che passa la bomba
 *   +5 extra se la parola ha 8 lettere o più
 *   -100 quando esplode tra le mani
 * Una parola non valida non passa la bomba e non costa nulla: si riprova subito.
 * La stessa parola non può essere usata due volte in tutta la partita.
 *
 * Un giocatore offline non blocca il giro: viene saltato come possessore e il
 * passaggio automatico evita che la bomba resti in mano a un client morto.
 */
(function (root, factory) {
  var mod = factory(root);
  if (typeof module === "object" && module.exports) module.exports = mod;
  if (root) root.FAWBombaRules = mod;
})(typeof window !== "undefined" ? window : globalThis, function (global) {
  "use strict";

  var WORDS = global && global.FAWWords ? global.FAWWords : null;

  var CFG = {
    minLen: 4,
    maxLen: 24,
    micciaMs: { facile: 45000, media: 35000, dura: 25000 },
    pausaRoundMs: 2000,
    seq: { facile: { len: 2, minWords: 120, maxWords: 6000 }, media: { len: 3, minWords: 45, maxWords: 900 }, dura: { len: 3, minWords: 25, maxWords: 400 } },
    puntiParola: 10,
    puntiLunga: 5,
    lenLunga: 8,
    puntiEsplosione: -100,
    esplosioniMax: 3,
    roundMax: 12,
    sostaMs: 14000,
    offlineMs: 20000,
    storicoMax: 60,
    durate: [120, 180, 240]
  };

  // Messaggi corti e non colpevolizzanti: la causa si legge, si corregge, si riprova.
  var MOTIVI = {
    CORTA: "Servono almeno 4 lettere.",
    VUOTA: "Scrivi una parola.",
    SPAZI: "Una parola sola, senza spazi.",
    CARATTERI: "Solo lettere: niente numeri né simboli.",
    LUNGA: "Parola troppo lunga: massimo 24 lettere.",
    SENZA_SEQUENZA: "La parola deve contenere «{S}».",
    "GIÀ_USATA": "Questa parola è già stata detta in partita.",
    GIA_USATA: "Questa parola è già stata detta in partita.",
    NON_TROVATA: "Non è una parola italiana.",
    DIZIONARIO_ASSENTE: "Dizionario non caricato: ricarica la pagina.",
    NON_TUOI: "La bomba è in mano a un altro giocatore.",
    FUORI_TEMPO: "La bomba è già esplosa: troppo tardi.",
    ROUND_SUPERATO: "Round cambiato: riprova con la nuova sequenza.",
    ROUND_NON_PRONTO: "Aspetta l'inizio del round.",
    PARTITA_NON_IN_GIOCO: "La partita non è in corso.",
    PARTITA_NON_TROVATA: "Partita non trovata.",
    NON_PARTECIPANTE: "Non sei tra i giocatori di questa sala."
  };
  function motivoTesto(m, seq) {
    var t = MOTIVI[m];
    if (!t) return null;
    return seq ? t.replace("{S}", seq) : t.replace("«{S}»", "la sequenza");
  }

  function diz() { return global.FAWWords || WORDS; }
  function norm(s) {
    var d = diz();
    if (d && d.norm) return d.norm(s);
    return String(s == null ? "" : s).trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z]/g, "");
  }

  /* ------------------------------- miccia -------------------------------- */

  /**
   * Stati progressivi della miccia: l'orario preciso NON è mostrato (niente
   * conto alla rovescia esatto), ma tensione e segnale sono chiari e ridondanti
   * (icona + parola + lunghezza barra), così funzionano anche senza audio e
   * con daltonismo/contrasto ridotto.
   */
  function statoMiccia(trascorsoMs, micciaMs) {
    var f = Math.max(0, Math.min(1, (trascorsoMs || 0) / (micciaMs || 1)));
    var livello, etichetta, icona;
    if (f < 0.3) { livello = 1; etichetta = "calma"; icona = "🌫️"; }
    else if (f < 0.55) { livello = 2; etichetta = "tiepida"; icona = "💨"; }
    else if (f < 0.75) { livello = 3; etichetta = "calda"; icona = "🔥"; }
    else if (f < 0.92) { livello = 4; etichetta = "fervente"; icona = "🚨"; }
    else { livello = 5; etichetta = "critica"; icona = "💣"; }
    return { frazione: f, livello: livello, etichetta: etichetta, icona: icona, esplosa: f >= 1 };
  }

  /** Tempo rimasto (approssimativo, per il giocatore: la decisione è il tempo condiviso). */
  function rimastoMs(round, oraMs) {
    if (!round) return 0;
    return Math.max(0, (round.inizioAlle || 0) + (round.micciaMs || 0) - (oraMs || 0));
  }
  function roundValido(round) {
    return !!round && /^[A-Z]{2,3}$/.test(round.seq || "") && Number.isFinite(round.inizioAlle) &&
      Number.isFinite(round.micciaMs) && round.inizioAlle >= 0 && round.micciaMs > 0;
  }
  function esplodeAlle(round) { return round ? (round.inizioAlle || 0) + (round.micciaMs || 0) : 0; }

  /* ------------------------------ sequenze -------------------------------- */

  /**
   * Sequenza del round: si prende dal dizionario del progetto e si accetta solo
   * se ha abbastanza parole (numero minimo dichiarato) — così non esistono round
   * con una sola risposta possibile o impossibili.
   *
   * La scelta viene fatta da UN client per round e scritta nel documento
   * (`bomba.round.seq`): tutti leggono quella, come la griglia di Ruzzle.
   * Il seed la rende comunque riproducibile a posteriori.
   */
  function scegliSequenza(seed, roundIdx, diff, opts) {
    opts = opts || {};
    var d = diz();
    var cfgSeq = CFG.seq[diff] || CFG.seq.media;
    var rng = opts.rng || (global.FAWCore ? global.FAWCore.rngFrom(seed + ":bomba:" + roundIdx) : Math.random);
    if (!d || !d.isDictionaryReady()) throw new Error("Dizionario non caricato");
    var cand = d.sampleSequences({
      len: cfgSeq.len, minWords: cfgSeq.minWords, maxWords: cfgSeq.maxWords, minLen: CFG.minLen, maxLen: CFG.maxLen, size: 18, rng: rng, exclude: opts.escluse || []
    });
    var escluse = opts.escluse || [];
    var scelta = null;
    var n = cand.length;
    var inizio = n ? Math.floor(rng() * n) % n : 0;
    for (var i = 0; i < n; i++) {
      var c = cand[(inizio + i) % n];
      if (escluse.indexOf(c.seq) < 0) { scelta = c; break; }
    }
    if (!scelta) throw new Error("Nessuna sequenza disponibile per questa difficoltà");
    return { seq: scelta.seq, count: scelta.count || 0 };
  }

  /** Quante risposte possibili esistono (metrica usata anche nei test). */
  function ampiezzaSequenza(seq) {
    var d = diz();
    return d && d.sequenceCount ? d.sequenceCount(seq) : 0;
  }

  /* ------------------------------ validità -------------------------------- */

  /**
   * Controllo della parola. Usa lo stesso dizionario di Ruzzle (`dizionario.txt`)
   * e la stessa normalizzazione (accenti ignorati, solo lettere).
   * Motivi: CORTA, CARATTERI, SENZA_SEQUENZA, GIÀ_USATA, NON_TROVATA.
   */
  function valutaParola(testo, seq, usate, opts) {
    opts = opts || {};
    var d = diz();
    var grezzo = String(testo == null ? "" : testo).trim();
    if (!grezzo) return { ok: false, motivo: "VUOTA", parola: "" };
    // il controllo sul testo grezzo evita che «strada2» passi per STRADA: la
    // normalizzazione cancella i segni e l'utente non capirebbe cosa ha vinto
    if (/\s/.test(grezzo)) return { ok: false, motivo: "SPAZI", parola: norm(grezzo) };
    if (/[^A-Za-z\u00C0-\u017F'’-]/.test(grezzo)) return { ok: false, motivo: "CARATTERI", parola: norm(grezzo) };
    var w = norm(grezzo);
    if (!w) return { ok: false, motivo: "CARATTERI", parola: w };
    if (w.length < CFG.minLen) return { ok: false, motivo: "CORTA", parola: w };
    if (w.length > CFG.maxLen) return { ok: false, motivo: "LUNGA", parola: w };
    if (seq && w.indexOf(norm(seq)) < 0) return { ok: false, motivo: "SENZA_SEQUENZA", parola: w };
    var lista = usate || [];
    for (var i = 0; i < lista.length; i++) if (lista[i] === w) return { ok: false, motivo: "GIÀ_USATA", parola: w };
    if (!d || !d.isDictionaryReady || !d.isDictionaryReady()) return { ok: false, motivo: "DIZIONARIO_ASSENTE", parola: w };
    if (d && d.isWord && !d.isWord(w, opts.lessico)) return { ok: false, motivo: "NON_TROVATA", parola: w };
    if (!d || !d.isWord) return { ok: false, motivo: "DIZIONARIO_ASSENTE", parola: w };
    return { ok: true, parola: w, punti: CFG.puntiParola + (w.length >= CFG.lenLunga ? CFG.puntiLunga : 0) };
  }

  /* --------------------------- guard del passaggio ------------------------- */

  /**
   * Unica regola per «questa parola passa la bomba?»: valutata dentro la
   * transazione, quindi identica su ogni dispositivo e non scavalcabile da un
   * doppio tocco. Esiti: ok + {parola, punti, round} oppure motivo.
   */
  function puoPassare(cur, me, opts) {
    opts = opts || {};
    function no(motivo) { return { ok: false, motivo: motivo }; }
    if (!cur) return no("PARTITA_NON_TROVATA");
    if ((cur.partecipanti || []).indexOf(me) < 0) return no("NON_PARTECIPANTE");
    var b = cur.bomba || {};
    var round = b.round || null;
    if (cur.stato !== "in_corso" && !(cur.stato === "pronto" && (cur.startAt || 0) <= (opts.ora || 0))) return no("PARTITA_NON_IN_GIOCO");
    if (!roundValido(round) || !Number.isFinite(opts.ora) || opts.ora < round.inizioAlle) return no("ROUND_NON_PRONTO");
    if (cur.endsAt && opts.ora >= cur.endsAt) return no("FUORI_TEMPO");
    if (b.roundIdx != null && opts.roundIdx != null && opts.roundIdx !== b.roundIdx) return no("ROUND_SUPERATO");
    if (b.possessore !== me) return no("NON_TUOI");
    if (opts.ora >= esplodeAlle(round)) return no("FUORI_TEMPO");
    var v = valutaParola(opts.testo, round.seq, b.usate || [], Object.assign({}, opts, { lessico: cur.lessico }));
    if (!v.ok) return no(v.motivo);
    return { ok: true, parola: v.parola, punti: v.punti, round: round, t: Math.round(opts.ora - (round.inizioAlle || 0)) };
  }

  /** Patch del passaggio: bomba al prossimo, punti, storico. */
  function patchPassaggio(cur, me, esito, opts) {
    var b = cur.bomba || {};
    var round = b.round || {};
    var ordine = (cur.partecipanti || []).slice();
    var prossimo = dopo(ordine, me, opts.attivi || ordine);
    var usate = (b.usate || []).concat([esito.parola]);
    var storico = (b.storico || []).slice(-(CFG.storicoMax - 1));
    storico.push({ r: b.roundIdx || 0, da: me, w: esito.parola, t: esito.t, p: esito.punti });
    var patch = {};
    patch["bomba.possessore"] = prossimo;
    patch["bomba.usate"] = usate.slice(-900);
    patch["bomba.storico"] = storico;
    patch["bomba.passaggi." + me] = ((b.passaggi || {})[me] || 0) + 1;
    patch["punteggi." + me] = ((cur.punteggi || {})[me] || 0) + esito.punti;
    patch["bomba.ultima"] = { da: me, w: esito.parola, t: opts.ora };
    patch["bomba.ultimoPasso"] = opts.ora;
    patch.logUltimo = { t: opts.ora, tipo: "passo", da: me, w: esito.parola, punti: esito.punti };
    return { patch: patch, prossimo: prossimo };
  }

  /** turno successivo nell'ordine dei partecipanti (saltando chi è assente) */
  function dopo(ordine, attuale, attivi) {
    if (!ordine.length) return attuale;
    var i = ordine.indexOf(attuale);
    for (var k = 1; k <= ordine.length; k++) {
      var n = ordine[((i < 0 ? -1 : i) + k + ordine.length) % ordine.length];
      if (!attivi || !attivi.length || attivi.indexOf(n) >= 0) return n;
    }
    return ordine[((i + 1) % ordine.length + ordine.length) % ordine.length];
  }

  /* ------------------------------- esplosione ----------------------------- */

  /**
   * Esplosione: penalità al possessore e nuovo round (miccia nuova, sequenza
   * nuova), oppure fine partita se il tempo è finito o le esplosioni sono
   * bastate. Decide solo chi arriva primo nella transazione (claim), e il
   * verdetto dipende dal tempo condiviso, non dal client.
   */
  function patchEsplosione(cur, opts) {
    opts = opts || {};
    if (!Number.isFinite(opts.ora) || !cur || !cur.bomba || !roundValido(cur.bomba.round) || opts.ora < esplodeAlle(cur.bomba.round) || ["in_corso", "pronto"].indexOf(cur.stato) < 0) return false;
    if (cur.endsAt && cur.endsAt < esplodeAlle(cur.bomba.round)) return false;
    var b = cur.bomba || {};
    var round = b.round || {};
    var vittima = b.possessore;
    if ((cur.partecipanti || []).indexOf(vittima) < 0) return false;
    var esplosioni = Object.assign({}, b.esplosioni || {});
    if (vittima) esplosioni[vittima] = (esplosioni[vittima] || 0) + 1;
    var totEsp = Object.keys(esplosioni).reduce(function (a, k) { return a + esplosioni[k]; }, 0);
    var finita = (opts.ora >= (cur.endsAt || Infinity)) || totEsp >= (cur.maxEsplosioni || CFG.esplosioniMax) ||
      ((b.roundIdx || 0) + 1) >= (b.roundsMax || CFG.roundMax);
    var patch = {};
    patch["bomba.esplosioni"] = esplosioni;
    patch["punteggi." + vittima] = ((cur.punteggi || {})[vittima] || 0) + CFG.puntiEsplosione;
    var storico = (b.storico || []).slice(-(CFG.storicoMax - 1));
    storico.push({ r: b.roundIdx || 0, da: vittima, esplode: true, t: Math.round(opts.ora - (round.inizioAlle || 0)) });
    patch["bomba.storico"] = storico;
    patch["bomba.cronologia"] = ((b.cronologia || []).concat([{ r: b.roundIdx || 0, chi: vittima, alle: opts.ora }])).slice(-24);
    if (finita) {
      patch.stato = "conclusa";
      patch.finito = (cur.partecipanti || []).slice();
      patch["bomba.finitaPer"] = opts.ora >= (cur.endsAt || Infinity) ? "tempo" : (totEsp >= (cur.maxEsplosioni || CFG.esplosioniMax) ? "esplosioni" : "round");
      // L'ultima esplosione salva ANCHE i risultati, inclusa la penalità appena applicata.
      var finale = applica(cur, patch);
      Object.assign(patch, patchRisultati(finale, opts.ora, finale.bomba.finitaPer));
      return { patch: patch, finita: true };
    }
    var seq = scegliSequenza(cur.seed || "SEED", (b.roundIdx || 0) + 1, b.difficolta || "media", {
      rng: opts.rng, escluse: (b.sequences || [])
    });
    var inizio = Math.max(opts.ora + (CFG.pausaRoundMs || 0), esplodeAlle(round) + (CFG.pausaRoundMs || 0));
    patch["bomba.roundIdx"] = (b.roundIdx || 0) + 1;
    patch["bomba.round"] = { i: (b.roundIdx || 0) + 1, seq: seq.seq, possibili: seq.count, inizioAlle: inizio, micciaMs: round.micciaMs || CFG.micciaMs.media };
    patch["bomba.sequences"] = ((b.sequences || []).concat([seq.seq])).slice(-24);
    patch["bomba.possessore"] = dopo(cur.partecipanti || [], vittima, opts.attivi || cur.partecipanti || []);
    patch["bomba.ultimoPasso"] = inizio;
    patch["bomba.usate"] = b.usate || [];   // le parole restano vietate per tutta la partita
    patch.logUltimo = { t: opts.ora, tipo: "esplosione", da: vittima };
    return { patch: patch, finita: false, round: patch["bomba.round"] };
  }

  /** Il possessore è offline da troppo tempo? La bomba passa senza colpevoli. */
  function puoAutoPassare(cur, me, opts) {
    opts = opts || {};
    if (!cur || !cur.bomba || !cur.bomba.possessore || (cur.partecipanti || []).indexOf(me) < 0) return false;
    if (cur.stato !== "in_corso") return false;
    var b = cur.bomba, round = b.round || {};
    if (!roundValido(round) || !Number.isFinite(opts.ora) || opts.ora < round.inizioAlle || (cur.endsAt && opts.ora >= cur.endsAt)) return false;
    if (opts.ora >= esplodeAlle(round)) return false;         // troppo tardi: esplode e basta
    var det = ((cur.giocatori || {})[b.possessore] || {});
    var visto = det.visto || 0;
    var vistoDa = opts.ora - visto;
    var fermoDa = opts.ora - (b.ultimoPasso || round.inizioAlle || 0);
    var offline = vistoDa > CFG.offlineMs;
    return offline || (fermoDa > CFG.sostaMs * 2 && vistoDa > CFG.offlineMs / 2);
  }

  function patchAutoPassaggio(cur, opts) {
    var b = cur.bomba || {};
    var attivi = opts.attivi || (cur.partecipanti || []).filter(function (n) {
      return (opts.ora - (((cur.giocatori || {})[n] || {}).visto || 0)) < CFG.offlineMs;
    });
    if (!attivi.length) attivi = (cur.partecipanti || []).filter(function (n) { return n !== b.possessore; });
    var prossimo = dopo(cur.partecipanti || [], b.possessore, attivi);
    var storico = (b.storico || []).slice(-(CFG.storicoMax - 1));
    storico.push({ r: b.roundIdx || 0, da: b.possessore, salto: true, t: Math.round(opts.ora - ((b.round || {}).inizioAlle || 0)) });
    return {
      prossimo: prossimo,
      patch: {
        "bomba.possessore": prossimo,
        "bomba.ultimoPasso": opts.ora,
        "bomba.storico": storico,
        ["bomba.saltati." + b.possessore]: (((b.saltati || {})[b.possessore]) || 0) + 1
      }
    };
  }

  /* ------------------------------ classifica ------------------------------ */

  function classifica(punteggi, bomba) {
    var b = bomba || {};
    var nomi = Object.keys(punteggi || {});
    var out = nomi.map(function (n) {
      return {
        nome: n,
        punti: punteggi[n] || 0,
        esplosioni: (b.esplosioni || {})[n] || 0,
        parole: 0,
        passaggi: (b.passaggi || {})[n] || 0,
        saltati: (b.saltati || {})[n] || 0
      };
    });
    var conteggio = contaParole(b.storico);
    out.forEach(function (r) { r.parole = (b.passaggi || {})[r.nome] == null ? (conteggio[r.nome] || 0) : b.passaggi[r.nome]; });
    out.sort(function (a, b2) {
      if (b2.punti !== a.punti) return b2.punti - a.punti;
      if (a.esplosioni !== b2.esplosioni) return a.esplosioni - b2.esplosioni;
      if (b2.passaggi !== a.passaggi) return b2.passaggi - a.passaggi;
      return a.nome < b2.nome ? -1 : (a.nome > b2.nome ? 1 : 0);
    });
    return out;
  }

  /** Conteggio delle parole valide per giocatore, dallo storico dei passaggi. */
  function contaParole(storico) {
    var out = {};
    (storico || []).forEach(function (r) {
      if (r.w && r.da) out[r.da] = (out[r.da] || 0) + 1;
    });
    return out;
  }

  function esito(grad) {
    if (!grad || !grad.length) return { campione: null, pareggio: false, pari: [] };
    if (grad.length === 1) return { campione: grad[0].nome, pareggio: false, pari: [] };
    var top = grad[0].punti;
    var pari = grad.filter(function (c) { return c.punti === top && c.esplosioni === grad[0].esplosioni && c.passaggi === grad[0].passaggi; });
    if (pari.length > 1) return { campione: null, pareggio: true, pari: pari.map(function (c) { return c.nome; }) };
    return { campione: grad[0].nome, pareggio: false, pari: [] };
  }

  /** Frase breve per il flusso: «BOB ha passato STRADA». */
  function rigaStorico(r) {
    if (!r) return "";
    if (r.esplode) return r.da + " è rimasto con la bomba";
    if (r.salto) return r.da + " non c'era: bomba passata";
    return r.da + " ha passato «" + r.w + "» +" + r.p;
  }

  function applica(cur, patch) {
    var next = JSON.parse(JSON.stringify(cur));
    Object.keys(patch).forEach(function (path) {
      var keys = path.split("."), o = next;
      for (var i = 0; i < keys.length - 1; i++) o = o[keys[i]] || (o[keys[i]] = {});
      o[keys[keys.length - 1]] = patch[path];
    });
    return next;
  }

  function patchRisultati(cur, ora, motivo) {
    var b = cur.bomba || {}, cls = classifica(cur.punteggi, b);
    return { stato: "conclusa", finito: (cur.partecipanti || []).slice(), "bomba.finitaPer": motivo,
      risultati: { gioco: "bomba-parole", classifica: cls, esito: esito(cls), punteggiFinale: cur.punteggi || {},
        parole: b.usate || [], round: (b.roundIdx || 0) + 1, finePer: motivo, endAt: ora } };
  }

  function patchFineTempo(cur, ora) {
    if (!cur || ["in_corso", "pronto"].indexOf(cur.stato) < 0 || !Number.isFinite(ora) || !Number.isFinite(cur.endsAt) || ora < cur.endsAt) return false;
    // Se la miccia scade prima del tempo partita, va risolta prima l'esplosione.
    if (cur.bomba && roundValido(cur.bomba.round) && esplodeAlle(cur.bomba.round) <= cur.endsAt) return false;
    return patchRisultati(cur, ora, "tempo");
  }

  function chi(o) { return o ? Object.keys(o) : []; }

  return {
    patchFineTempo: patchFineTempo, patchRisultati: patchRisultati,
    CFG: CFG, MOTIVI: MOTIVI, norm: norm, motivoTesto: motivoTesto,
    roundValido: roundValido, statoMiccia: statoMiccia, rimastoMs: rimastoMs, esplodeAlle: esplodeAlle,
    scegliSequenza: scegliSequenza, ampiezzaSequenza: ampiezzaSequenza,
    valutaParola: valutaParola, puoPassare: puoPassare,
    patchPassaggio: patchPassaggio, patchEsplosione: patchEsplosione, dopo: dopo,
    puoAutoPassare: puoAutoPassare, patchAutoPassaggio: patchAutoPassaggio,
    classifica: classifica, contaParole: contaParole, esito: esito, rigaStorico: rigaStorico, chi: chi
  };
});
