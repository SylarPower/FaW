/**
 * Categoria Rush — client di gioco (DOM + rete).
 *
 * Le decisioni di punteggio stanno in `js/regole.js` (pure, testate). Questo file
 * fa solo tre cose: mostrare lo stato, raccogliere UNA risposta per round, e
 * chiudere i round con una transazione per round (mai per tasto premuto).
 *
 * Timing: i round derivano da `startAt` (timestamp del server stimato da
 * FAWNet.clock()), quindi un reload o un ritardo di rete non spostano la domanda:
 * si riprende il round in corso con il tempo vero rimasto.
 *
 * Limite dichiarato: la validazione è client-side e chiude il round il primo
 * client che ci arriva. È un gioco tra amici, non un sistema anti-cheat.
 */
(function (global) {
  "use strict";

  var CORE = global.FAWCore;
  var NET = global.FAWNet;
  var ROOM = global.FAWRoom;
  var CAT = global.FAWCategorie;
  var R = global.FAWRushRules;
  var CFG = R.CFG;

  var $ = function (id) { return document.getElementById(id); };
  function el(id) { return $(id); }
  var stato = {
    me: "", matchId: null, room: null, data: null,
    solo: false, seed: "", rounds: [], idx: -1, fase: "attesa",
    modale: "classiche", roundMs: CFG.roundMs, inputMs: CFG.inputMs,
    inviatoRound: -1, inGioco: false, t0: 0, risultatiShown: false,
    dataLocale: null, error: null, _chiudendo: false
  };

  var MOTIVI = {
    VUOTO: "Scrivi una parola.",
    CORTA: "Servono almeno 3 lettere.",
    LUNGA: "Troppo lunga: massimo 40 caratteri.",
    CARATTERI: "Solo lettere, niente numeri.",
    LETTERA: "Deve iniziare con «{L}».",
    NON_CATEGORIA: "Non è una risposta di «{C}».",
    GIA_DATA: "L'avevi già data in un round precedente.",
    TROPPO_CORTA: "Serve una risposta di almeno 8 lettere (o due parole).",
    CATEGORIA_SCONOSCIUTA: "Categoria non disponibile: riprova a ricaricare.",
    DIZIONIONARIO_ASSENTE: "Database categorie non caricato."
  };
  function motivoTesto(m, combo) {
    var t = MOTIVI[m] || "Risposta non accettata.";
    return t.replace("{L}", (combo && combo.lettera) || "?").replace("{C}", (combo && combo.nome) || "categoria");
  }

  function ora() { return NET && NET.clock ? NET.clock() : Date.now(); }
  var tocca = (typeof matchMedia === "function" && matchMedia("(hover: none)").matches);
  function comboDi(i) { return stato.rounds[i] || null; }
  function roundDi(data, i) { return (((data || {}).rush || {}).risposte || {})[i] || {}; }

  /* ------------------------------- avvio -------------------------------- */

  function avvio() {
    CORE.initTheme();
    CORE.armaSuoni();
    stato.me = CORE.user() || "OSPITE";
    var matchId = CORE.qs("matchId");
    var gUrl = CORE.qs("griglia"), dUrl = parseInt(CORE.qs("durata"), 10);
    if (dUrl === 120 || dUrl === 180) stato.durataScelta = dUrl;
    if (gUrl === "creative") stato.modeScelto = "creative";
    if (!matchId) {
      if (CORE.qs("solo") === "1") avviaSolo();
      else { mostra("crea"); bindCrea(); }
      return;
    }
    stato.matchId = matchId;
    NET.init({ backend: "auto" });
      // opt-in (?auth=anon / faw:auth:anon=1): mette l'uid di Firebase Auth nel
      // documento partita (`authUid`). Di default è un no-op: nessun comportamento
      // cambia, e i test girano con il backend finto dove è dichiaratamente null.
      NET.ensureSignedIn();
    collegati();
  }

  function mostra(quale) {
    var mappa = { boot: "schermo-boot", crea: "schermo-crea", lobby: "schermo-lobby", gioco: "schermo-gioco", risultati: "schermo-risultati" };
    Object.keys(mappa).forEach(function (k) {
      var n = $(mappa[k]);
      if (n) n.hidden = k !== quale;
    });
    document.body.setAttribute("data-schermo", quale);
  }

  /* --------------------------------- sala -------------------------------- */

  function collegati() {
    mostra("lobby");
    NET.init({ backend: "auto" });
    stato.room = ROOM.open({ matchId: stato.matchId, nome: stato.me, net: NET });
    stato.room.on({
      state: function (d) { unisciti(d); onStato(d); },
      gone: function () { CORE.toast("Partita terminata o rimossa", "warn"); location.href = "../../index.html"; },
      status: function (s) {
        var b = el("conn");
        if (!b) return;
        b.hidden = s === "online";
        b.querySelector(".t").textContent = s === "online" ? "" : "Connessione persa: riprovo, le risposte restano in coda";
      }
    });
    stato.room.start();
    stato.room.startWatchdog(function () { watchdog(); }, 2500);
    avviaTicking();
  }

  function unisciti(d) {
    if (!d || stato._join) return;
    if ((d.partecipanti || []).indexOf(stato.me) >= 0) { stato._join = true; return; }
    if (d.stato === "conclusa" || d.stato === "annullata") {
      stato._join = true;
      CORE.toast("Partita già chiusa: crea una nuova sfida dall'hub", "warn", 4000);
      return;
    }
    if ((d.partecipanti || []).length >= (d.maxGiocatori || 8)) {
      stato._join = true;
      CORE.toast("Posti esauriti in questa partita", "warn", 4000);
      return;
    }
    stato._join = true;
    stato.room.addPlayer(stato.me).then(function (ok) {
      if (!ok) CORE.toast("Non sei entrato in partita (posti pieni o partita chiusa)", "warn", 4000);
    });
  }

  function onStato(data) {
    if (!data) return;
    stato.data = data;
    var opts = data.opzioni || {};
    stato.modale = opts.mode === "creative" ? "creative" : "classiche";
    var ciclo = R.ciclo(stato.modale);
    stato.roundMs = ciclo.roundMs;
    stato.inputMs = ciclo.inputMs;
    stato.durataMs = ROOM.durataMs(data);
    var n = R.numeroRound(stato.durataMs, ciclo.roundMs);
    stato.seed = String(opts.seed || data.seed || "SEED");
    var gen = R.roundsDaSeed(stato.seed, n, { modale: stato.modale });
    if (gen.length !== n) gen = R.roundsDaSeed(stato.seed, n, { modale: "classiche" }).slice(0, n);
    stato.rounds = gen.length ? gen : [{ i: 0, categoria: "-", nome: "In attesa del database categorie", lettera: "-", possibili: 0 }];

    var f = R.faseRound(data.startAt || 0, ora(), { rounds: n, modale: stato.modale });
    stato.fase = f.fase;
    if (data.stato === "attesa") { stato.inGioco = false; mostra("lobby"); renderLobby(data); }
    else if (data.stato === "pronto") {
      if (!stato.inGioco) { renderLobby(data); mostra("lobby"); }
      countdownView(data, f);
    } else if (data.stato === "in_corso" || data.stato === "chiusura") {
      entraInGioco(data, f);
      chiudiRoundSospesi(data, f);
    } else if (data.stato === "risultati" || data.stato === "conclusa") {
      chiudiPartita(data, f, true);
    } else if (data.stato === "annullata") {
      mostra("lobby");
      CORE.toast("Partita annullata dall'host", "warn", 5000);
    }
    var late = ((data.giocatori || {})[stato.me] || {}).entraInCorsa;
    if (late && el("late-note")) el("late-note").hidden = false;
  }

  /* ------------------------------- lobby --------------------------------- */

  function renderLobby(data) {
    var g = ROOM.giocatoriMap(data);
    var pronti = data.pronti || [];
    var lista = el("lobby-lista");
    if (lista) {
      lista.innerHTML = Object.keys(g).map(function (n) {
        var ok = pronti.indexOf(n) >= 0;
        return '<div class="faw-row" style="cursor:default">' +
          '<span class="faw-avatar">' + CORE.escapeHtml(CORE.initials(n)) + "</span>" +
          '<span class="faw-row__main"><span class="faw-row__name">' + CORE.escapeHtml(n) + (n === stato.me ? " (tu)" : "") + "</span>" +
          '<span class="faw-row__meta">' + (ok ? "pronto" : "in attesa") + "</span></span>" +
          '<span class="faw-badge ' + (ok ? "faw-badge--ok" : "") + '">' + (ok ? "✅" : "⏳") + "</span></div>";
      }).join("");
    }
    var ioPronto = pronti.indexOf(stato.me) >= 0;
    var btn = el("btn-pronto");
    if (btn) {
      btn.textContent = ioPronto ? "⏸️ NON SONO PRONTO" : "✅ SONO PRONTO";
      btn.setAttribute("aria-pressed", String(ioPronto));
    }
    var tot = (data.partecipanti || []).length;
    if (el("lobby-count")) el("lobby-count").textContent = Math.min(pronti.length, tot) + "/" + tot;
    if (el("lobby-seed")) el("lobby-seed").textContent = stato.seed;
    if (el("lobby-meta")) {
      el("lobby-meta").textContent = stato.rounds.length + " round da " + Math.round(stato.inputMs / 1000) + " s · " +
        (stato.modale === "creative" ? "categorie creative (voto tra pari)" : "categorie con elenco risposte") +
        " · " + tot + " giocatori";
    }
    var avvia = el("btn-avvia-subito");
    if (avvia) avvia.hidden = data.host !== stato.me || data.stato !== "attesa";
  }

  function countdownView(data, f) {
    var rem = Math.max(0, ((data.startAt || 0) - ora()) / 1000);
    var box = el("countdown");
    if (!box) return;
    if (rem <= 0) { box.hidden = true; entraInGioco(data, f); return; }
    box.hidden = false;
    el("countdown-num").textContent = String(Math.ceil(rem));
    clearTimeout(stato._cd);
    stato._cd = setTimeout(function () { if (stato.data) countdownView(stato.data, R.faseRound(stato.data.startAt || 0, ora(), { rounds: stato.rounds.length, modale: stato.modale })); }, 200);
  }

  /* ------------------------------- partita -------------------------------- */

  function entraInGioco(data, f) {
    if (data && data.stato === "pronto" && (data.startAt || 0) > ora()) return;
    if (!stato.inGioco) {
      stato.inGioco = true;
      mostra("gioco");
      if (el("solo-note")) el("solo-note").hidden = !stato.solo;
      var i = el("inp-risposta");
      if (i && !stato.solo && !tocca) { try { i.focus({ preventScroll: true }); } catch (e) {} }
    }
    // lo stato del documento passa a `in_corso` allo scadere del countdown:
    // un solo client lo scrive, gli altri lo vedono dal watch
    if (!stato.solo && data && data.stato === "pronto" && (data.startAt || 0) <= ora() && !stato._passato) {
      stato._passato = true;
      NET.transact(stato.room.path, function (cur) {
        if (!cur || cur.stato !== "pronto" || (cur.startAt || 0) > ora()) return false;
        return { stato: "in_corso", iniziatoDa: stato.me };
      }).catch(function () { stato._passato = false; });
    }
    renderRound(data || stato.dataLocale, f || R.faseRound((data || {}).startAt || 0, ora(), { rounds: stato.rounds.length, modale: stato.modale }));
  }

  /** A ogni stato utile: se un round è chiuso ma non ancora punteggiato, chiudilo. */
  function chiudiRoundSospesi(data, f) {
    if (stato.solo || !data || !stato.room) return;
    var fino = f.indice - 1;
    if (f.fase === "finita") fino = f.rounds - 1;
    for (var i = 0; i <= fino; i++) chiudiRound(i, data);
  }

  function chiudiRound(i, data) {
    if (i < 0 || !stato.room) return Promise.resolve(false);
    var cur = data || stato.data || {};
    if ((((cur.rush || {}).punteggiRound || {})[i])) return Promise.resolve(false);
    if (stato._closing && stato._closing[i]) return Promise.resolve(false);
    stato._closing = stato._closing || {};
    stato._closing[i] = true;
    var ciclo = R.ciclo(stato.modale);
    return stato.room.resolveOnce("rush:round:" + i, function (d) {
      if (!d) return false;
      if ((((d.rush || {}).punteggiRound || {})[i])) return false;
      // il round deve essere davvero chiuso nel tempo condiviso: niente chiusure
      // anticipate (ruberebbero il tempo di risposta agli altri)
      if (!R.puoChiudere(d, i, { ora: ora(), modale: stato.modale, durataMs: ROOM.durataMs(d) })) return false;
      var risposte = ((d.rush || {}).risposte || {})[i] || {};
      var es = stato.modale === "creative"
        ? R.punteggiVotazione(risposte, ((d.rush || {}).voti || {})[i] || {}, { giocatori: d.partecipanti || [] })
        : R.punteggiRound(risposte, { giocatori: d.partecipanti || [], inputMs: ciclo.inputMs });
      var riv = R.rivela(risposte, es);
      var patch = { ["rush.punteggiRound." + i]: es.punti, ["rush.rivela." + i]: riv };
      Object.keys(es.punti).forEach(function (nome) {
        if (es.punti[nome]) patch["punteggi." + nome] = NET.ops.increment(es.punti[nome]);
      });
      patch["rush.statistiche"] = R.accumulaStati((d.rush || {}).statistiche, "sala", riv);
      patch["rush.roundChiuso"] = i;
      return patch;
    }).then(function (res) {
      stato._closing[i] = false;
      var ok = !!(res && res.applied);
      if (ok) CORE.beep("ok");
      return ok;
    }).catch(function () { stato._closing[i] = false; return false; });
  }

  /* -------------------------------- rendering ----------------------------- */

  function renderRound(data, f) {
    var combo = comboDi(f.indice) || stato.rounds[0];
    if (!combo) return;
    var anteprima = f.indice < 0;
    if (f.indice !== stato.idx) {
      stato.idx = f.indice;
      stato.inviatoRound = -1;
      var i = el("inp-risposta");
      if (i) { i.value = ""; i.disabled = false; }
      var form = el("frm-risposta");
      if (form) form.classList.remove("is-lock");
      var rec = el("receipt");
      if (rec) rec.hidden = true;
      el("feedback").textContent = "";
      try { i && i.focus({ preventScroll: true }); } catch (e) {}
      CORE.beep("click");
    }
    el("round-n").textContent = (Math.max(0, f.indice) + 1) + "/" + f.rounds;
    el("round-lettera").textContent = combo.lettera || "★";
    el("round-categoria").textContent = combo.nome;
    el("round-aiuto").textContent = combo.lettera
      ? "Una parola da 3 lettere in su che inizia con «" + combo.lettera + "»."
      : "Risposta libera: la giudicano i giocatori col voto.";
    el("round-sr").textContent = "Round " + (Math.max(0, f.indice) + 1) + " di " + f.rounds + ". " +
      (combo.lettera ? "Lettera " + combo.lettera + ". " : "") + "Categoria: " + combo.nome + ".";
    if (anteprima) el("chip-stato").textContent = "si parte";
    else el("chip-stato").textContent = f.fase === "input" ? "si scrive" : (f.fase === "voto" ? "si vota" : (f.fase === "rivela" ? "rivelazione" : "finita"));

    // chi non sta rispondendo si vede (ma non blocca niente): avviso discreto
    var chipIn = el("chip-inattivi");
    if (chipIn) {
      var fermiss = stato.solo ? [] : R.inattivi((data && data.partecipanti) || [], (data && data.rush && data.rush.risposte) || {}, f.indice - 1);
      if (fermiss.length) {
        chipIn.hidden = false;
        chipIn.textContent = "⚠️ " + fermiss.join(", ") + " non sta rispondendo";
        chipIn.title = "I round si chiudono comunque: nessuno può bloccare la partita";
      } else chipIn.hidden = true;
    }

    var tot = 0;
    if (data && data.rush && data.rush.risposte) {
      var r = data.rush.risposte[f.indice] || {};
      tot = Object.keys(r).length;
    } else if (stato.solo) tot = 0;
    el("round-avanzati").textContent = String(tot);

    // la barra del tempo è animazione locale: il verdetto resta il tempo del server
    var frac = f.fase === "input" ? Math.max(0, Math.min(1, (f.entroInputMs || 0) / CFG.inputMs)) : (anteprima ? 1 : 0);
    var bar = el("round-bar");
    if (bar) bar.style.width = Math.round(frac * 100) + "%";

    renderRivela(data, f, combo);
    renderClassifica(data);
    renderInputStato(f);
    renderAltreSolo(f, combo);
  }

  function renderInputStato(f) {
    var i = el("inp-risposta"), b = el("btn-invia");
    var inAnteprima = f.indice < 0;   // countdown: la domanda si vede, si scrive dopo
    var blocca = inAnteprima || f.fase !== "input" || (stato.inviatoRound === f.indice && !stato.solo);
    if (i) { i.disabled = blocca; i.placeholder = f.fase === "input" ? "La tua parola…" : (blocca && f.fase === "input" ? "Risposta inviata" : "Round chiuso"); }
    if (b) b.disabled = blocca;
    var form = el("frm-risposta");
    if (form) form.classList.toggle("is-lock", blocca);
  }

  function renderRivela(data, f, combo) {
    var box = el("rivela"), lista = el("rivela-lista");
    if (!box || !lista) return;
    var i = f.fase === "input" ? f.indice - 1 : f.indice;
    var rush = (data && data.rush) || {};
    var inVoto = f.fase === "voto";
    var riv = rush.rivela ? rush.rivela[i] : null;
    // nella finestra di voto i punteggi non esistono ancora: si mostrano le parole
    // (è ciò su cui si vota), tenendo la colonna punti vuota
    if (!riv && inVoto && rush.risposte && rush.risposte[i]) {
      riv = {};
      Object.keys(rush.risposte[i]).forEach(function (n) {
        var r = rush.risposte[i][n] || {};
        riv[n] = { parola: r.parola, ok: r.ok !== false, motivo: r.motivo || null, t: r.t || 0, originale: false, condivisa: false };
      });
    }
    if (stato.solo) {
      var s2 = (stato.rivelaSolo || {})[f.indice];
      if (s2) { riv = {}; riv[stato.me] = s2; }
      i = f.indice;
    }
    if (!riv || !Object.keys(riv).length) {
      box.hidden = true;
      var vecchio = el("box-voto");
      if (vecchio) vecchio.remove();
      return;
    }
    box.hidden = false;
    var punti = (!inVoto && rush.punteggiRound) ? (rush.punteggiRound[i] || {}) : null;
    var nomi = Object.keys(riv).sort(function (a, b) {
      if (punti) return (punti[b] || 0) - (punti[a] || 0) || (a < b ? -1 : 1);
      return (riv[a].t || 0) - (riv[b].t || 0);
    });
    lista.innerHTML = nomi.map(function (n) {
      var r = riv[n] || {};
      var tag = !r.ok ? '<span class="faw-badge faw-badge--bad">' + CORE.escapeHtml(motivoTesto(r.motivo, combo)) + "</span>"
        : r.originale ? '<span class="faw-badge faw-badge--acc">unica</span>'
        : r.condivisa ? '<span class="faw-badge faw-badge--warn">in comune</span>' : "";
      var destra = punti ? '<div class="punti">+' + (punti[n] || 0) + "</div>" + tag
        : '<span class="faw-badge faw-badge--ok">da votare</span>';
      return '<div class="riv-riga ' + (r.originale ? "is-unica " : "") + (n === stato.me ? "is-me" : "") + '">' +
        '<div><div class="chi">' + CORE.escapeHtml(n) + (n === stato.me ? " (tu)" : "") + " · " + Math.round((r.t || 0) / 1000) + "s</div>" +
        '<div class="cosa ' + (r.ok ? "" : "is-ko") + '">' + CORE.escapeHtml(r.parola || "—") + "</div></div>" +
        '<div style="text-align:right">' + destra + "</div></div>";
    }).join("");
    if (el("rivela-conta")) el("rivela-conta").textContent = nomi.length + " risposte";
    if (inVoto) renderVoti(data, f, riv);
    else { var bv = el("box-voto"); if (bv) bv.remove(); }
  }

  /** Finestra di voto (solo modalità creativa): un voto a testa, poi si chiude il round. */
  function renderVoti(data, f, riv) {
    var box = el("rivela");
    if (!box) return;
    var altri = Object.keys(riv).filter(function (n) { return n !== stato.me && riv[n] && riv[n].ok; });
    var mio = ((data.rush || {}).voti || {})[f.indice] || {};
    var vecchio = el("box-voto");
    if (vecchio) vecchio.remove();
    var wrap = document.createElement("div");
    wrap.className = "faw-btn-row";
    wrap.id = "box-voto";
    if (!altri.length) {
      wrap.innerHTML = '<p class="faw-dim2">Nessuna risposta da votare: vale la partecipazione.</p>';
    } else if (mio.voto) {
      wrap.innerHTML = '<p class="faw-dim2">Voto dato a ' + CORE.escapeHtml(mio.voto) + " ✓</p>";
    } else {
      wrap.innerHTML = '<span class="faw-caps">La risposta più riuscita?</span>' + altri.map(function (n) {
        return '<button class="faw-btn faw-btn--sm" type="button" data-voto="' + CORE.escapeHtml(n) + '">👏 ' + CORE.escapeHtml(n) + "</button>";
      }).join("");
      wrap.addEventListener("click", function (e) {
        var bt = e.target.closest("[data-voto]");
        if (!bt) return;
        var nome = bt.getAttribute("data-voto");
        Array.prototype.forEach.call(wrap.querySelectorAll("[data-voto]"), function (x) { x.disabled = true; });
        NET.transact(stato.room.path, function (cur) {
          if (!cur) return false;
          var f2 = R.faseRound(cur.startAt || 0, ora(), { rounds: stato.rounds.length, modale: "creative" });
          if (f2.fase !== "voto" || f2.indice !== f.indice) return false;
          return { ["rush.voti." + f.indice + "." + stato.me]: { voto: nome, t: ora() } };
        }).then(function () { CORE.toast("Voto dato", "ok"); });
      });
    }
    box.appendChild(wrap);
  }

  function renderClassifica(data) {
    var box = el("classifica");
    if (!box) return;
    var punteggi = (data && data.punteggi) || {};
    var stat = (data && data.rush && data.rush.statistiche) || {};
    var c = R.classifica(punteggi, stat);
    box.innerHTML = c.map(function (x, i) {
      return '<li class="faw-rank ' + (i === 0 ? "is-top " : "") + (x.nome === stato.me ? "is-me" : "") + '">' +
        '<span class="n">' + (i + 1) + "</span>" +
        '<span class="nm">' + CORE.escapeHtml(x.nome) + (x.nome === stato.me ? " (tu)" : "") + "</span>" +
        '<span class="pw">' + x.uniche + " uniche</span>" +
        '<span class="pt">' + x.punti + "</span></li>";
    }).join("");
  }

  /** Allenamento: sotto alla domanda compaiono le altre risposte ammesse (ripasso). */
  function renderAltreSolo(f, combo) {
    var box = el("box-altre");
    if (!box || !stato.solo || !CAT || !combo || !combo.lettera) { if (box) box.hidden = true; return; }
    var cat = CAT.byId(combo.categoria);
    var liste = cat ? CAT.rispostePer(cat, combo.lettera) : [];
    el("altre").textContent = liste.length ? liste.slice(0, 24).join(" · ") : "Nessuna risposta in elenco per questa lettera.";
    box.hidden = false;
  }

  /* --------------------------------- invio -------------------------------- */

  function giaUsate() {
    var d = stato.data || stato.dataLocale || {};
    var ris = (d.rush || {}).risposte || {};
    var out = [];
    Object.keys(ris).forEach(function (i) {
      var r = ris[i][stato.me];
      if (r && (r.ok !== false) && Number(i) !== stato.idx) out.push(r.parola);
    });
    return out;
  }

  function invia() {
    var input = el("inp-risposta");
    var testo = input ? input.value : "";
    var combo = comboDi(stato.idx) || stato.rounds[0];
    if (!combo) return;
    var f = R.faseRound((stato.data || {}).startAt || stato.t0, ora(), { rounds: stato.rounds.length, modale: stato.modale });
    if (f.fase !== "input") { mostraFeedback("Il round è chiuso: niente recuperi.", true); return; }
    if (stato.inviatoRound === f.indice) {
      if (el("inp-risposta") && el("inp-risposta").value) {
        mostraFeedback("Hai già mandato la risposta di questo round: è definitiva.", true);
        return;
      }
      stato.inviatoRound = -1;   // era un tentativo locale non registrato: si può riprovare
    }

    // feedback immediato sul dato locale: la stessa regola viene riapplicata
    // dentro la transazione, così un client manomesso non passa comunque
    var v = R.valutaRisposta(testo, combo, { giaUsate: giaUsate() });
    if (!v.ok) {
      mostraFeedback(motivoTesto(v.motivo, combo), true);
      CORE.beep("nope");
      CORE.vibrate([14, 40, 14]);
      return;
    }

    if (stato.solo) {
      var iSolo = f.indice;
      if (stato.inviatoRound === iSolo) return;
      var es = R.punteggiRound({ [stato.me]: { parola: v.parola, canonica: v.canonica, ok: true, t: Math.max(0, CFG.inputMs - f.entroInputMs) } }, { inputMs: CFG.inputMs });
      stato.rivelaSolo = stato.rivelaSolo || {};
      stato.rivelaSolo[iSolo] = { parola: v.parola, ok: true, t: Math.max(0, Math.round(CFG.inputMs - (f.entroInputMs || 0))), originale: true, condivisa: false };
      stato.punteggiSolo = stato.punteggiSolo || {};
      stato.punteggiSolo[iSolo] = es.punti[stato.me];
      stato.puntiSolo = (stato.puntiSolo || 0) + es.punti[stato.me];
      stato.inviatoRound = iSolo;
      var ps = el("punti-solo");
      if (ps) ps.textContent = String(stato.puntiSolo);
      var cs = el("chip-solo");
      if (cs) cs.hidden = false;
      receipt("Accettata: +" + es.punti[stato.me] + " punti", false);
      CORE.beep("ok");
      if (input) input.disabled = true;
      var bb = el("btn-invia");
      if (bb) bb.disabled = true;
      renderRivela(stato.dataLocale, f, combo);
      return;
    }

    var me = stato.me, modale = stato.modale, roundVisto = f.indice, scritto = v;
    var tentativi = 0;
    // UNA scrittura per round, dentro una transazione con guard: doppio tocco,
    // retry di rete e risposte tardive non producono mai un secondo effetto
    NET.transact(stato.room.path, function (cur) {
      if (!cur) return false;
      var via = R.puoScrivere(cur, me, { ora: ora(), modale: modale, durataMs: cur.durata });
      if (!via.ok) { stato._rifiuto = via.motivo; return false; }
      var i = via.indice;
      var v2 = R.valutaRisposta(testo, comboDi(i) || combo, { giaUsate: giaUsateDa(cur, i) });
      if (!v2.ok) { stato._rifiuto = v2.motivo + "@" + i; return false; }
      var t = Math.max(1, via.t);
      var patch = {};
      patch["rush.risposte." + i + "." + me] = { parola: v2.parola, canonica: v2.canonica, ok: true, t: t };
      stato._accettata = { i: i, parola: v2.parola };
      return patch;
    }).then(function (res) {
      if (res && res.applied) {
        clearTimeout(stato._ritenta);
        var acc = stato._accettata || { i: roundVisto, parola: scritto.parola };
        stato.inviatoRound = acc.i;
        receipt("Risposta inviata: " + acc.parola, false);
        CORE.beep("ok");
        if (input) input.disabled = true;
        var bt = el("btn-invia");
        if (bt) bt.disabled = true;
        el("feedback").textContent = "";
      } else {
        var motivo = String(stato._rifiuto || "ROUND_GIA_CHIUSO");
        var at = motivo.indexOf("@");
        var motivoPuro = at < 0 ? motivo : motivo.slice(0, at);
        var comboGiudizio = at < 0 ? combo : (comboDi(Number(motivo.slice(at + 1))) || combo);
        if (motivoPuro === "HAI_GIA_RISPOSTO") {
          var gia = (((((stato.data || {}).rush || {}).risposte || {})[roundVisto] || {})[me]);
          receipt("Avevi già inviato «" + (gia ? gia.parola : scritto.parola) + "»: vale quella.", false);
        } else if (MOTIVI[motivoPuro]) mostraFeedback(motivoTesto(motivoPuro, comboGiudizio), true);
        else if (motivoPuro === "COUNTDOWN_IN_CORSO") mostraFeedback("Aspetta il via del round.", true);
        else mostraFeedback("Il round è chiuso: niente recuperi.", true);
      }
    }).catch(function () {
      // errore di rete: si ritenta un paio di volte (la transazione è idempotente
      // per round, quindi un doppio invio non può contare due volte)
      if ((tentativi += 1) <= 3) {
        stato._ritenta = setTimeout(function () { invia(); }, 350 * tentativi);
        mostraFeedback("Invio in sospeso: riprovo (" + tentativi + "/3)", true);
        var campo = el("inp-risposta");
        if (campo) campo.disabled = true;   // si blocca l'input, non la risposta
        return;
      }
      var campo2 = el("inp-risposta");
      if (campo2) campo2.disabled = false;
      mostraFeedback("Invio non arrivato: riprova tu (la risposta non è stata registrata).", true);
    });
  }

  /** Risposte già date dalla stessa persona (per il round `i`, le esclude). */
  function giaUsateDa(data, i) {
    var ris = ((data || {}).rush || {}).risposte || {};
    var out = [];
    Object.keys(ris).forEach(function (k) {
      if (Number(k) === i) return;
      var r = ris[k][stato.me];
      if (r && r.ok !== false) out.push(r.parola);
    });
    return out;
  }

  function receipt(txt, ko) {
    var r = el("receipt");
    if (!r) return;
    r.hidden = false;
    r.classList.toggle("is-ko", !!ko);
    r.innerHTML = "<span aria-hidden=\"true\">" + (ko ? "⚠️" : "✅") + "</span><span>" + CORE.escapeHtml(txt) + "</span>";
  }
  function mostraFeedback(txt, ko) {
    var f = el("feedback");
    if (!f) return;
    f.textContent = txt;
    f.classList.toggle("is-ko", !!ko);
  }

  /** In solo non c'è un documento: lo stato locale ha la stessa forma, per riusare i render. */
  function flushLocale() {
    if (!stato.solo) return;
    var d = {
      partecipanti: [stato.me], host: stato.me, punteggi: { [stato.me]: stato.puntiSolo || 0 },
      parole: {}, stato: "in_corso", rush: { risposte: { 0: {} }, punteggiRound: stato.punteggiSolo ? { 0: { [stato.me]: stato.puntiSolo } } : {}, statistiche: {} },
      startAt: stato.t0, endsAt: stato.t0 + stato.durataMs
    };
    stato.dataLocale = d;
    stato.data = d;
  }

  /* -------------------------------- ticker -------------------------------- */

  var tickTimer = null;
  function avviaTicking() {
    if (tickTimer) return;
    tickTimer = setInterval(tick, 150);
  }
  function tick() {
    var data = stato.data || stato.dataLocale;
    if (!data || !stato.inGioco) return;
    var f = R.faseRound(data.startAt || stato.t0, ora(), { rounds: stato.rounds.length, modale: stato.modale });
    if (f.fase === "finita") {
      if (!stato.solo) chiudiRound(f.rounds - 1, data);
      chiudiPartita(data, f, false);
      return;
    }
    if (f.fase === "rivela" && !stato.solo) chiudiRound(f.indice, data);
    if (f.indice !== stato.idx || f.fase !== stato.fase) {
      stato.fase = f.fase;
      renderRound(data, f);
      return;
    }
    stato.fase = f.fase;
    // aggiorna solo timer e barra: niente riscritture del DOM a raffica
    var ms = f.entroMs;
    var tm = el("timer");
    if (tm) {
      var s = Math.max(0, Math.ceil(ms / 1000));
      var txt = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
      if (tm.textContent !== txt) tm.textContent = txt;
      tm.classList.toggle("is-urgente", f.fase === "input" && s <= 5);
    }
    if (f.fase === "input") {
      var bar = el("round-bar");
      if (bar) bar.style.width = Math.round(Math.max(0, Math.min(1, f.entroInputMs / CFG.inputMs)) * 100) + "%";
    }
    var tot = Object.keys(roundDi(data, f.indice)).length;
    var chip = el("round-avanzati");
    if (chip && chip.textContent !== String(tot)) chip.textContent = String(tot);
    if (f.fase === "input" && f.entroInputMs < 6000 && !stato._avvisatoRound) {
      stato._avvisatoRound = f.indice;
      if (tot === 0 || !data.punteggi) { /* nessuno panico: solo un bip di avviso */ }
      CORE.beep("tick");
    }
  }

  function watchdog() {
    var data = stato.data;
    if (!data || stato.solo) return;
    if (data.stato === "attesa" || data.stato === "pronto") return;
    var f = R.faseRound(data.startAt || 0, ora(), { rounds: stato.rounds.length, modale: stato.modale });
    for (var i = Math.max(0, f.indice - 1); i <= f.indice; i++) chiudiRound(i, data);
    if (f.fase === "finita") chiudiPartita(data, f, false);
    var hv = ((data.giocatori || {})[stato.me] || {}).visto;
    if (data.host !== stato.me && hv && ora() - hv > ROOM.IDLE_MS + 20000) stato.room.claimHost();
  }

  /* ------------------------------ fine partita ---------------------------- */

  function chiudiPartita(data, f, giaChiusa) {
    if (stato._chiudendo && !giaChiusa) return;
    if (stato.solo) { renderRisultatiSolo(); return; }
    if (giaChiusa) { renderRisultati(data); return; }
    stato._chiudendo = true;
    var n = stato.rounds.length;
    // chiude l'ultimo round (se serve) e poi congela i risultati
    chiudiRound(n - 1, data).then(function () {
      return stato.room.resolveOnce("rush:chiudi", function (cur) {
        if (!cur) return false;
        if (cur.stato === "conclusa" || cur.stato === "risultati") return false;
        var c = R.classifica(cur.punteggi || {}, (cur.rush || {}).statistiche || {});
        return {
          stato: "conclusa",
          finito: (cur.partecipanti || []).slice(),
          "risultati.classifica": c,
          "risultati.esito": R.esito(c),
          "risultati.punteggiFinale": cur.punteggi || {},
          "risultati.parole": (cur.rush || {}).risposte || {},
          "risultati.round": cur.rounds || cur.rush && cur.rush.punteggiRound || {},
          "risultati.endAt": ora(),
          "risultati.chiusoDa": stato.me,
          "rush.rounds": n
        };
      });
    }).then(function (res) {
      stato._chiudendo = false;
      if (res && res.applied && stato.data) renderRisultati(stato.data);
    }).catch(function () { stato._chiudendo = false; });
  }

  function renderRisultati(data) {
    if (!data) return;
    var ris = data.risultati || {};
    var c = ris.classifica || R.classifica(data.punteggi || {}, (data.rush || {}).statistiche || {});
    var es = ris.esito || R.esito(c);
    stato.inGioco = false;
    mostra("risultati");
    el("ris-titolo").textContent = "Risultati";
    el("ris-esito").textContent = es.pareggio ? "Pareggio" : (es.campione === stato.me ? "Hai vinto tu" : "Vinse " + (es.campione || "—"));
    el("ris-classifica").innerHTML = c.map(function (x, i) {
      return '<li class="faw-rank faw-rank--lg ' + (i === 0 ? "is-top " : "") + (x.nome === stato.me ? "is-me" : "") + '">' +
        '<span class="n">' + (i + 1) + "</span><span class=\"nm\">" + CORE.escapeHtml(x.nome) + (x.nome === stato.me ? " (tu)" : "") + "</span>" +
        '<span class="pw">' + x.uniche + " uniche</span><span class=\"pt\">" + x.punti + "</span></li>";
    }).join("");
    var mio = c.filter(function (x) { return x.nome === stato.me; })[0] || {};
    var stat = ((data.rush || {}).statistiche || {})[stato.me] || {};
    el("ris-stats").innerHTML = [
      statista("Punti", mio.punti || 0),
      statista("Valide", (stat.valide || 0) + "/" + stato.rounds.length),
      statista("Uniche", stat.uniche || 0),
      statista("Tempo medio", stat.tetti && stat.tetti.length ? (Math.round(stat.tetti.reduce(function (a, b) { return a + b; }, 0) / stat.tetti.length / 100) / 10 + " s") : "—")
    ].join("");
    var pr = (data.rush || {}).punteggiRound || {};
    el("ris-rounds").innerHTML = stato.rounds.map(function (rc, i) {
      var mia = roundDi(data, i)[stato.me];
      var punti = (pr[i] || {})[stato.me] || 0;
      return '<div class="roundo"><span class="q">' + (i + 1) + "</span>" +
        '<span class="w ' + (mia && mia.ok ? "" : "is-ko") + '">' + CORE.escapeHtml((rc.lettera || "") + " · " + (mia ? mia.parola : "niente")) + "</span>" +
        '<span class="t">' + (mia ? Math.round((mia.t || 0) / 1000) + "s" : "—") + "</span>" +
        '<span class="p">+' + punti + "</span></div>";
    }).join("");
    renderBoxRivincita(data);
    CORE.beep("ok");
  }

  function statista(k, v) {
    return '<div class="faw-stat"><span class="faw-stat__k">' + CORE.escapeHtml(k) + "</span><span class=\"faw-stat__v\">" + CORE.escapeHtml(String(v)) + "</span></div>";
  }

  function renderRisultatiSolo() {
    stato.inGioco = false;
    mostra("risultati");
    var punti = stato.puntiSolo || 0;
    el("ris-titolo").textContent = "Allenamento finito";
    el("ris-esito").textContent = punti + " punti";
    var mine = stato.rivelaSolo || {};
    el("ris-classifica").innerHTML = Object.keys(mine).sort().map(function (i) {
      var r = mine[i];
      return '<li class="faw-rank"><span class="n">' + (Number(i) + 1) + "</span>" +
        '<span class="nm">' + CORE.escapeHtml(r.parola) + "</span><span class=\"pw\">" + Math.round((r.t || 0) / 1000) + "s</span>" +
        '<span class="pt">+' + ((stato.punteggiSolo || {})[i] || 0) + "</span></li>";
    }).join("");
    el("ris-stats").innerHTML = [statista("Round", stato.rounds.length), statista("Punti", punti)].join("");
    el("ris-rounds").innerHTML = "";
    var b = el("btn-rivincita");
    if (b) b.textContent = "🔁 ANCORA UNA VOLTA";
    var box = el("box-rivincita");
    if (box) box.hidden = true;
  }

  /* -------------------------------- rivincita ------------------------------ */

  function rivincita() {
    if (stato.solo) { location.href = "index.html?solo=1"; return; }
    el("btn-rivincita").disabled = true;
    var d = stato.data || {};
    stato.room.proposeRematch({
      giocatori: (d.partecipanti || [stato.me]).slice(),
      opzioni: d.opzioni || {},
      durata: d.durata
    }).then(function (id) {
      if (!id) { CORE.toast("Rivincita non riuscita: la partita è già archiviata", "warn"); return; }
      CORE.toast("Rivincita proposta: si entra quando accettano", "ok");
      renderBoxRivincita(stato.data);
    }).catch(function () {
      el("btn-rivincita").disabled = false;
      CORE.toast("Rivincita non riuscita: riprova", "error");
    });
  }

  function accettaRivincita() {
    var d = stato.data || {};
    var nxt = d.prossimaPartita;
    if (!nxt) return;
    stato.room.acceptRematch().then(function () { location.href = "index.html?matchId=" + nxt; });
  }

  function renderBoxRivincita(data) {
    var box = el("box-rivincita");
    if (!box) return;
    var nxt = data && data.prossimaPartita;
    var daMe = data && data.prossimaPartitaCreataDa === stato.me;
    if (nxt && !daMe) {
      box.hidden = false;
      el("box-rivincita-testo").textContent = (data.prossimaPartitaCreataDa || "Un avversario") + " propone la rivincita.";
    } else if (nxt && daMe) {
      box.hidden = false;
      el("box-rivincita-testo").textContent = "Rivincita proposta: si entra quando gli altri accettano.";
    } else box.hidden = true;
    var btn = el("btn-rivincita");
    if (btn && nxt && daMe) btn.textContent = "⏳ RIVINCITA PROPOSTA";
  }

  /* ------------------------------- pannello ------------------------------- */

  var crea = { durata: 120, giocatori: 2, mode: "classiche" };

  function bindCrea() {
    Array.prototype.forEach.call(document.querySelectorAll("#schermo-crea [data-seg]"), function (seg) {
      seg.addEventListener("click", function (e) {
        var b = e.target.closest("[data-v]");
        if (!b) return;
        Array.prototype.forEach.call(seg.querySelectorAll("[data-v]"), function (x) {
          x.setAttribute("aria-pressed", String(x === b));
        });
        crea[seg.getAttribute("data-seg")] = b.getAttribute("data-v");
        renderHintCrea();
      });
    });
    renderHintCrea();
    el("btn-crea-stanza").addEventListener("click", function () { creaStanza(el("btn-crea-stanza")); });
    el("btn-solo").addEventListener("click", function () { avviaSolo(); });
  }

  function renderHintCrea() {
    var ciclo = R.ciclo(crea.mode);
    var n = R.numeroRound(parseInt(crea.durata, 10) * 1000, ciclo.roundMs);
    var h = el("crea-hint");
    if (h) {
      h.textContent = n + " round da " + Math.round(ciclo.inputMs / 1000) + " s" +
        (crea.mode === "creative" ? " · risposte giudicate a voto (7 s di voto, poi i punti)" : " · elenco di risposte ammesse nel gioco") +
        ". Durata effettiva " + Math.round(n * ciclo.roundMs / 1000) + " s.";
    }
  }

  function creaStanza(btn) {
    btn.disabled = true;
    var durata = parseInt(crea.durata, 10) * 1000;
    var ciclo = R.ciclo(crea.mode);
    var n = R.numeroRound(durata, ciclo.roundMs);
    ROOM.create({
      gioco: "categoria-rush",
      creator: stato.me,
      giocatori: [stato.me],
      maxGiocatori: parseInt(crea.giocatori, 10) || 2,
      durata: n * ciclo.roundMs,
      opzioni: { durata: String(Math.round(n * ciclo.roundMs / 1000)), mode: crea.mode, countdown: 5 }
    }).then(function (id) {
      stato.matchId = id;
      if (history.replaceState) history.replaceState(null, "", "index.html?matchId=" + id);
      collegati();
      CORE.toast("Stanza creata: condividi il link", "ok");
    }).catch(function (e) {
      btn.disabled = false;
      CORE.toast("Creazione non riuscita (" + (e && e.message || "errore") + ")", "error");
    });
  }

  /* ---------------------------------- solo --------------------------------- */

  function avviaSolo() {
    stato.solo = true;
    NET.init({ backend: "auto" });
    stato.modale = crea && crea.mode === "creative" ? "creative" : "classiche";
    var ciclo = R.ciclo(stato.modale);
    var durata = (stato.durataScelta || crea.durata || 120) * 1000;
    var n = R.numeroRound(durata, ciclo.roundMs);
    stato.durataMs = n * ciclo.roundMs;
    stato.roundMs = ciclo.roundMs;
    stato.inputMs = ciclo.inputMs;
    stato.seed = CORE.shortId("SOLO").toUpperCase();
    stato.rounds = R.roundsDaSeed(stato.seed, n, { modale: stato.modale });
    stato.t0 = Date.now() + 2000;
    stato.idx = -1;
    stato.inGioco = true;
    stato.me = stato.me || CORE.user() || "OSPITE";
    flushLocale();
    mostra("gioco");
    avviaTicking();
    var i = el("inp-risposta");
    if (i) i.value = "";
    renderRound(stato.dataLocale, R.faseRound(stato.t0, Date.now(), { rounds: n, modale: stato.modale }));
    CORE.toast("Allenamento: " + n + " round, nessuna classifica", "", 2600);
  }

  /* --------------------------------- top bar ------------------------------- */

  function bindTop() {
    document.body.addEventListener("click", function (e) {
      var b = e.target.closest("[data-action]");
      if (!b) return;
      var a = b.getAttribute("data-action");
      if (a === "regole") { el("dlg-regole") && CORE.showDialog(el("dlg-regole")); }
      if (a === "chiudi-dialogo") { var dlg = el("dlg-regole"); if (dlg) dlg.close(); }
      if (a === "audio") {
        var nuovo = !CORE.soundOn();
        CORE.setSoundOn(nuovo);
        b.setAttribute("aria-pressed", String(nuovo));
        b.innerHTML = (nuovo ? "🔊" : "🔇") + '<span class="faw-sr"> audio</span>';
      }
      if (a === "tema") CORE.toggleTheme();
      if (a === "esci") esci();
    });
    var form = el("frm-risposta");
    if (form) form.addEventListener("submit", function (e) { e.preventDefault(); invia(); });
    var inp = el("inp-risposta");
    if (inp) {
      // tastiera virtuale: la casella resta centrata nel pezzo di schermo visibile,
      // così la domanda non viene mai coperta e la pagina non "salta"
      inp.addEventListener("focus", function () { CORE.keepInputVisible(inp, 240); });
      if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", function () {
          if (document.activeElement === inp) CORE.keepInputVisible(inp, 60);
        });
      }
    }
    if (inp) inp.addEventListener("input", function () {
      // nessuna scrittura per tasto: si valida solo in locale, il documento
      // viene toccato quando premi INVIA
      var v = el("feedback");
      if (v && v.classList.contains("is-ko")) { v.textContent = ""; v.classList.remove("is-ko"); }
    });
    el("btn-rivincita").addEventListener("click", rivincita);
    el("btn-accetta-rivincita").addEventListener("click", accettaRivincita);
    el("btn-pronto").addEventListener("click", function () {
      var d = stato.data;
      if ((d.partecipanti || []).length < 2) {
        CORE.toast("Sei solo: invita un amico col link, oppure avvia tu", "warn", 3500);
        return;
      }
      var ioPronto = (d.pronti || []).indexOf(stato.me) >= 0;
      stato.room.markReady(!ioPronto).then(function () {
        return NET.get(stato.room.path);
      }).then(function (snap) { if (snap.exists) onStato(snap.data); });
    });
    el("btn-avvia-subito").addEventListener("click", function () {
      stato.room.maybeStart({ forza: true, nome: stato.me }).then(function (ok) {
        CORE.toast(ok ? "Countdown avviato" : "Start non riuscito: partita già iniziata o non sei l'host", ok ? "ok" : "warn");
      });
    });
    el("btn-copia-invito").addEventListener("click", function () {
      var url = location.href;
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { CORE.toast("Link copiato: invialo a chi vuoi sfidare", "ok"); });
      else CORE.toast(url, "", 6000);
    });
    el("btn-esci-lobby").addEventListener("click", esci);
  }

  function esci() {
    if (stato.solo) { location.href = "index.html"; return; }
    if (stato.room) {
      if (stato.data && stato.data.stato === "attesa") stato.room.removePlayer(stato.me);
      stato.room.flush();
    }
    location.href = "../../index.html";
  }

  function init() {
    NET.init({ backend: "auto" });
    bindTop();
    avvio();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  global.FAWRush = { stato: stato, invia: invia, chiudiRound: chiudiRound, renderRound: renderRound };
})(typeof window !== "undefined" ? window : globalThis);
