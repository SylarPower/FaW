/**
 * La Bomba delle Parole — client (DOM + rete).
 *
 * Le decisioni stanno in `js/regole.js` (pure e testate): qui si mostra lo stato,
 * si raccoglie una parola, e si scrive UNA transazione per passaggio.
 *
 * Miccia: un solo orologio condiviso (`round.inizioAlle` + `round.micciaMs`,
 * timestamp del server stimato da FAWNet.clock()). I timer locali servono solo ad
 * animare la barra; quando scade, chi arriva primo reclama l'esplosione con
 * `resolveOnce`, e il verdetto viene ri-validato dentro la transazione: un input
 * arrivato dopo lo scoppio non può salvare nessuno.
 *
 * Limite dichiarato (onesto): l'autorità è client-side con transazioni Firestore.
 * Non è un sistema anti-cheat: impedisce doppi invii, corse e scritture tardive,
 * non chi modifica il proprio browser.
 */
(function (global) {
  "use strict";

  var CORE = global.FAWCore, NET = global.FAWNet, ROOM = global.FAWRoom;
  var R = global.FAWBombaRules, WORDS = global.FAWWords;
  var CFG = R.CFG;
  var GIOCO = "bomba-parole";
  var TICK_MS = 120;

  var stato = {
    me: "", matchId: null, room: null, data: null, solo: false,
    diff: "media", micciaMs: CFG.micciaMs.media,
    roundIdx: -1, roundVisto: -1, inGioco: false, t0: 0,
    durataMs: 180000, datiLocali: null, esplosoRound: -1, liv: -1,
    tentativiPasso: 0, chiusa: false, pending: null, serial: 0, retryAt: 0,
    busy: CORE ? CORE.onceGuard(400) : function () { return true; }
  };

  function $(id) { return document.getElementById(id); }
  function el(id) { return $(id); }
  function ora() { return NET && NET.clock ? NET.clock() : Date.now(); }
  function esc(s) { return CORE.escapeHtml(String(s == null ? "" : s)); }
  var tocca = (typeof matchMedia === "function" && matchMedia("(hover: none)").matches);

  function round() { return ((stato.data || {}).bomba || {}).round || null; }

  /**
   * Round 0: nasce qui, dentro la stessa transazione che apre la partita, così
   * un documento creato dall'hub (o una sala vuota) funziona senza passaggi
   * manuali e senza una scrittura in più per ogni campo.
   */
  function inizializzaRound(cur, perche) {
    var b = cur.bomba || {};
    // difficoltà: campo del gioco → cfg scritto da chi crea → opzioni dell'hub
    var diff = b.difficolta || ((cur.cfg || {}).bomba || {}).difficolta || ((cur.opzioni || {}).miccia) || stato.diff;
    var micciaMs = b.micciaMs || ((cur.cfg || {}).bomba || {}).micciaMs || CFG.micciaMs[diff] || CFG.micciaMs.media;
    if (!Number.isFinite(micciaMs) || micciaMs <= 0) micciaMs = CFG.micciaMs[diff] || CFG.micciaMs.media;
    var idx = Number.isInteger(b.roundIdx) && b.roundIdx >= 0 ? b.roundIdx : 0;
    var rr = Object.assign({}, b.round || {});
    if (!/^[A-Z]{2,3}$/.test(rr.seq || "")) {
      var s = R.scegliSequenza(cur.seed || "SEED", idx, diff, { escluse: b.sequences || [] });
      rr.seq = s.seq; rr.possibili = s.count;
    }
    var inizio = Math.max(ora(), (cur.startAt || 0) + 200);
    rr.i = idx; rr.inizioAlle = inizio; rr.micciaMs = micciaMs;
    var nomi = cur.partecipanti || [];
    var poss = nomi.indexOf(b.possessore) >= 0 ? b.possessore : (nomi.indexOf(cur.host) >= 0 ? cur.host : nomi[0]);
    var patch = {
      stato: "in_corso",
      "bomba.difficolta": diff,
      "bomba.roundIdx": idx,
      "bomba.round": rr,
      "bomba.possessore": poss,
      "bomba.usate": b.usate || [],
      "bomba.storico": b.storico || [],
      "bomba.passaggi": b.passaggi || {},
      "bomba.esplosioni": b.esplosioni || {},
      "bomba.saltati": b.saltati || {},
      "bomba.sequences": (b.sequences || []).concat([rr.seq]),
      "bomba.ultimoPasso": inizio,
      "bomba.roundsMax": b.roundsMax || Math.max(3, Math.round((cur.durata || 180000) / (micciaMs + CFG.pausaRoundMs))),
      "maxEsplosioni": cur.maxEsplosioni || ((cur.cfg || {}).bomba || {}).esplosioniMax || CFG.esplosioniMax,
      logUltimo: { t: ora(), tipo: perche || "start", da: stato.me }
    };
    return patch;
  }
  function possessore() { return ((stato.data || {}).bomba || {}).possessore || null; }
  function eIlMioTurno() { return !!stato.data && possessore() === stato.me && stato.inGioco; }

  /* ------------------------------- avvio -------------------------------- */

  function avvio() {
    CORE.initTheme();
    stato.me = CORE.user() || "OSPITE";
    var dUrl = CORE.qs("durata"), mic = CORE.qs("miccia");
    if (dUrl === "120" || dUrl === "180" || dUrl === "240") stato.durataScelta = parseInt(dUrl, 10);
    if (CFG.micciaMs[mic]) stato.diff = mic;
    stato.micciaMs = CFG.micciaMs[stato.diff];
    NET.init({ backend: "auto" });
    bindRegole();

    var matchId = CORE.qs("matchId");
    if (!matchId) {
      sePronti(function () {
        if (CORE.qs("solo") === "1") avviaSolo();
        else { mostra("crea"); bindCrea(); }
      });
      return;
    }
    stato.matchId = matchId;
    NET.init({ backend: "auto" });
      // opt-in (?auth=anon / faw:auth:anon=1): mette l'uid di Firebase Auth nel
      // documento partita (`authUid`). Di default è un no-op: nessun comportamento
      // cambia, e i test girano con il backend finto dove è dichiaratamente null.
      NET.ensureSignedIn();
    sePronti(collegati);
  }

  /** Il dizionario è indispensabile (validità delle parole): si parte da lì. */
  function sePronti(fn) {
    var avvioTs = Date.now();
    function fine(err) {
      if (err) {
        var c = document.querySelector("#schermo-boot .faw-card");
        if (c) {
          c.innerHTML = '<p class="faw-eyebrow">Dizionario</p><h1 class="faw-title">Non l’ho caricato</h1>' +
            '<p class="faw-lead">Senza dizionario non si può stabilire se una parola esiste. ' +
            'Riprova a ricaricare la pagina.</p>' +
            '<p class="faw-hint">' + esc(String(err.message || err)) + "</p>" +
            '<div class="bomba__actions"><button class="faw-btn faw-btn--primary faw-btn--lg" id="btn-rip-rova" type="button">Ricarica</button></div>';
          var b = $("btn-rip-rova");
          if (b) b.addEventListener("click", function () { location.reload(); });
        }
        return;
      }
      preparaSequenze();
      fn();
    }
    if (!WORDS) { fine(new Error("FAWWords non disponibile")); return; }
    var p = WORDS.isDictionaryReady && WORDS.isDictionaryReady() ? Promise.resolve(true) : (WORDS.load ? WORDS.load() : Promise.reject(new Error("caricamento non disponibile")));
    p.then(function () {
      // non più di 1,5 s di «preparazione» artificiale: il bottone deve apparire subito
      var attesa = Math.max(0, 350 - (Date.now() - avvioTs));
      setTimeout(function () { fine(null); }, attesa);
    }).catch(function (e) { fine(e || new Error("errore")); });
  }

  function preparaSequenze() {
    // scalda la cache delle sequenze per la difficoltà scelta (il costo è una
    // volta sola per sessione e resta dentro il turno di caricamento)
    if (!WORDS || !WORDS.sampleSequences) return;
    var c = CFG.seq[stato.diff] || CFG.seq.media;
    try { WORDS.sampleSequences({ len: c.len, minWords: c.minWords, maxWords: c.maxWords, size: 18, minLen: CFG.minLen, maxLen: CFG.maxLen }); } catch (e) {}
  }

  function mostra(quale) {
    var mappa = { boot: "schermo-boot", crea: "schermo-crea", lobby: "schermo-lobby", gioco: "schermo-gioco", risultati: "schermo-risultati" };
    Object.keys(mappa).forEach(function (k) {
      var n = $(mappa[k]);
      if (n) n.hidden = k !== quale;
    });
    if (document.body.getAttribute("data-schermo") !== quale) global.scrollTo(0, 0);
    document.body.setAttribute("data-schermo", quale);
  }

  /* --------------------------------- sala -------------------------------- */

  function collegati() {
    if (stato.room) stato.room.stop();
    mostra("lobby");
    NET.init({ backend: "auto" });
    stato.room = ROOM.open({ matchId: stato.matchId, nome: stato.me, net: NET });
    stato.room.on({
      state: function (d) { if (!d) return; if (d.gioco !== GIOCO) { erroreSala("Questo invito è per un altro gioco. Torna al portale."); return; } unisciti(d); if (!stato._accessDenied) onStato(d); },
      gone: function () { erroreSala("Invito non disponibile: la sala è stata rimossa o il codice non è corretto."); },
      error: function () { if (!stato.data) erroreSala("Non riesco a caricare la sala. Controlla la connessione e riprova."); },
      status: function (s) {
        var b = el("chip-sospeso");
        if (b) b.hidden = s === "online";
        if (b) b.textContent = s === "online" ? "" : "⏳ connessione persa: riprovo";
        var c = el("chip-conn");
        if (c) c.hidden = s === "online";
      }
    });
    try { stato.room.start(); } catch (e) { erroreSala("Connessione non disponibile. Ricarica la pagina o torna al portale."); return; }
    stato.room.startWatchdog(function () { watchdog(); }, 2000);
    avviaTicking();
    bindGioco();
  }

  function erroreSala(testo) {
    stato.inGioco = false;
    if (stato.room) stato.room.stop();
    clearInterval(stato.tick);
    mostra("boot");
    var box = document.querySelector("#schermo-boot .faw-card");
    box.innerHTML = '<h1 class="faw-title">Sala non disponibile</h1><p>' + esc(testo) + '</p><div class="bomba__actions"><button class="faw-btn" type="button" id="btn-riprova-sala">Riprova</button><a class="faw-btn" href="../../index.html">Torna al portale</a></div>';
    $("btn-riprova-sala").addEventListener("click", function () { location.reload(); });
  }

  function scrivi(mutate) {
    var serial = stato.serial;
    return NET.transact(stato.room.path, mutate).then(function (res) {
      if (res.applied && serial === stato.serial) onStato(res.data);
      return res;
    });
  }

  function unisciti(d) {
    if (!d || stato._join) return;
    if ((d.partecipanti || []).indexOf(stato.me) >= 0) { stato._join = true; return; }
    if (ROOM.isStale(d) || ["attesa", "pronto", "in_corso"].indexOf(d.stato) < 0) {
      stato._accessDenied = true;
      erroreSala("Questa sala non è più aperta. Crea una nuova sfida dal portale.");
      stato._join = true;
      CORE.toast("Partita già chiusa: crea una nuova sfida dall’hub", "warn", 4000);
      return;
    }
    if ((d.partecipanti || []).length >= (d.maxGiocatori || 6)) {
      stato._accessDenied = true;
      erroreSala("Posti esauriti in questa sala.");
      stato._join = true;
      CORE.toast("Posti esauriti in questa partita", "warn", 4000);
      return;
    }
    if (!CORE.user()) { stato._accessDenied = true; erroreSala("Accedi dal portale per entrare nella sala."); return; }
    stato._join = true;
    stato.room.addPlayer(stato.me).then(function (res) {
      if (!res.data || (res.data.partecipanti || []).indexOf(stato.me) < 0) {
        stato._accessDenied = true; erroreSala("Non è stato possibile entrare: la sala è piena o è terminata.");
      }
    }).catch(function () {
      stato._accessDenied = true; erroreSala("Ingresso non riuscito. Controlla la connessione e riprova.");
    });
  }

  function onStato(d) {
    if (!d) return;
    WORDS.setPublication(d.lessico || {});
    stato.data = d;
    stato.serial++;
    // la difficoltà la decide chi crea (dal banner dell'hub o dalla sala): il
    // documento ha sempre l'ultima parola, così tutti giocano la stessa partita
    var sceltaDoc = ((d.opzioni || {}).miccia) || ((d.cfg || {}).bomba || {}).difficolta || (d.bomba || {}).difficolta;
    if (sceltaDoc && CFG.micciaMs[sceltaDoc] && sceltaDoc !== stato.diff) {
      stato.diff = sceltaDoc;
      stato.micciaMs = (d.bomba || {}).micciaMs || ((d.cfg || {}).bomba || {}).micciaMs || CFG.micciaMs[sceltaDoc];
    }
    var s = d.stato;
    if (s === "attesa" && ROOM.isStale(d)) { erroreSala("Questo invito è scaduto. Crea una nuova sala dal portale."); return; }
    if (s === "annullata") { erroreSala("La partita è stata annullata. Puoi creare una nuova sfida dal portale."); return; }
    if (s === "attesa") {
      $("top-stato").textContent = "sala d’attesa";
      mostra("lobby");
      renderLobby(d);
      return;
    }
    if (s === "pronto" || s === "in_corso" || s === "chiusura") {
      stato.inGioco = true;
      mostra("gioco");
      render(d);
      if (s === "pronto") $("top-stato").textContent = "si parte tra poco";
      else $("top-stato").textContent = d.bomba && d.bomba.possessore ? "in corso" : "in corso";
      return;
    }
    if (s === "conclusa" || s === "risultati") {
      stato.inGioco = false;
      mostra("risultati");
      renderRisultati(d);
      $("top-stato").textContent = s === "annullata" ? "annullata" : "finita";
      return;
    }
  }

  /* --------------------------------- crea --------------------------------- */

  var crea = { durata: 180, maxGiocatori: 4 };

  function bindCrea() {
    var sel = $("sel-durata");
    if (sel && !sel.options.length) {
      sel.innerHTML = CFG.durate.map(function (s) {
        return '<option value="' + s + '">' + Math.round(s / 60) + " minuti</option>";
      }).join("");
    }
    if (sel) sel.value = String(stato.durataScelta || crea.durata);
    var seg = $("seg-miccia");
    if (seg && !seg._b) {
      seg._b = true;
      seg.querySelectorAll(".faw-seg__btn").forEach(function (b) {
        b.addEventListener("click", function () {
          stato.diff = b.getAttribute("data-miccia") || "media";
          stato.micciaMs = CFG.micciaMs[stato.diff];
          seg.querySelectorAll(".faw-seg__btn").forEach(function (x) {
            var on = x === b;
            x.classList.toggle("is-active", on);
            x.setAttribute("aria-pressed", String(on));
          });
          $("miccia-hint").textContent = hintDifficolta(stato.diff);
          preparaSequenze();
        });
      });
    }
    if (seg) seg.querySelectorAll(".faw-seg__btn").forEach(function (b) {
      var on = b.getAttribute("data-miccia") === stato.diff;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    $("miccia-hint").textContent = hintDifficolta(stato.diff);
    var bCrea = $("btn-crea");
    if (bCrea) bCrea.addEventListener("click", function () { creaStanza(bCrea); });
    $("btn-solo").addEventListener("click", function () {
      stato.durataScelta = parseInt($("sel-durata").value, 10);
      avviaSolo();
    });
    var bCoda = $("btn-coda");
    if (bCoda) bCoda.addEventListener("click", function () { entraInCoda(bCoda); });
    var bU = $("btn-unisciti");
    if (bU) bU.addEventListener("click", entraCodice);
    var inp = $("inp-code");
    if (inp) inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); entraCodice(); } });
    bindRegole();

  }

  function bindRegole() {
    var r = $("btn-regole");
    if (r && !r._b) { r._b = true; r.addEventListener("click", apriRegole); }
    var rc = $("btn-regole-close");
    if (rc && !rc._b) { rc._b = true; rc.addEventListener("click", function () { $("dlg-regole").close(); }); }
  }

  function hintDifficolta(d) {
    var c = CFG.seq[d] || CFG.seq.media;
    var parole = d === "facile" ? "moltissime parole possibili" : (d === "dura" ? "poche parole possibili: si soffre un po’" : "abbastanza parole possibili");
    return (c.len === 2 ? "Sequenza di 2 lettere" : "Sequenza di 3 lettere") + ", miccia " + Math.round(CFG.micciaMs[d] / 1000) + " s: " + parole + ", nessun round impossibile.";
  }

  function creaStanza(btn) {
    if (btn.disabled) return;
    if (!CORE.user()) { CORE.toast("Accedi dal portale per creare una sala, oppure scegli Allenamento solo.", "warn", 4500); return; }
    btn.disabled = true;
    var durata = (parseInt(($("sel-durata") || {}).value, 10) || crea.durata) * 1000;
    ROOM.create({
      gioco: GIOCO,
      creator: stato.me,
      giocatori: [stato.me],
      maxGiocatori: 6,
      durata: durata,
      opzioni: {
        durata: String(Math.round(durata / 1000)), miccia: stato.diff, countdown: $("chk-countdown").checked ? 3 : 0
      },
      cfg: { bomba: { difficolta: stato.diff, micciaMs: CFG.micciaMs[stato.diff], esplosioniMax: CFG.esplosioniMax } }
    }).then(function (id) {
      stato.matchId = id;
      if (history.replaceState) history.replaceState(null, "", "index.html?matchId=" + id);
      collegati();
      CORE.toast("Sala creata: condividi il codice", "ok");
      return id;
    }).catch(function (e) {
      btn.disabled = false;
      CORE.toast("Creazione non riuscita (" + (e && e.message || "errore") + ")", "error", 4000);
    });
  }

  function entraCodice() {
    var v = ($("inp-code").value || "").trim();
    try { if (/^https?:\/\//i.test(v)) v = new URL(v).searchParams.get("matchId") || ""; } catch (e) { v = ""; }
    // Gli id Firestore sono case-sensitive e possono superare i 12 caratteri.
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(v)) { CORE.toast("Inserisci il codice completo o il link dell’invito.", "warn"); return; }
    var btn = $("btn-unisciti"); if (btn.disabled) return; btn.disabled = true;
    NET.get("partite/" + v).then(function (snap) {
      var data = snap.data;
      if (!snap.exists || !data || data.gioco !== GIOCO) { CORE.toast("Nessuna sala Bomba con questo codice.", "warn"); return; }
      if (ROOM.isStale(data) || ["attesa", "pronto", "in_corso"].indexOf(data.stato) < 0) { CORE.toast("Questa partita è già finita o l’invito è scaduto.", "warn"); return; }
      if ((data.partecipanti || []).indexOf(stato.me) < 0 && data.partecipanti.length >= (data.maxGiocatori || 6)) { CORE.toast("La sala è al completo.", "warn"); return; }
      location.href = "index.html?matchId=" + encodeURIComponent(v);
    }).catch(function () { CORE.toast("Controllo non riuscito. Riprova.", "warn"); })
      .finally(function () { btn.disabled = false; });
  }

  function entraInCoda(btn) {
    if (stato._coda) return;
    if (!CORE.user()) { CORE.toast("Accedi dal portale per unirti agli altri, oppure prova da solo.", "warn", 4000); return; }
    btn.disabled = true; stato._coda = true;
    CORE.toast("Cerco una sala aperta…", "", 1800);
    NET.ready().then(function () {
      var cerca = NET.onCol("partite", [{ field: "gioco", op: "==", value: GIOCO }], function (docs) {
        if (!stato._coda) return;
        var aperta = (docs || []).filter(function (d) {
          var x = d.data || {};
          return x.stato === "attesa" && !ROOM.isStale(x) && (x.partecipanti || []).length < (x.maxGiocatori || 6) && (x.partecipanti || []).indexOf(stato.me) < 0;
        }).sort(function (a, b) { return b.data.createdAt - a.data.createdAt; })[0];
        if (!aperta) return;
        stato._codaFatto = true; stato._coda = false;
        if (cerca) cerca();
        location.href = "index.html?matchId=" + encodeURIComponent(aperta.id);
      });
      stato.stopCoda = cerca;
      stato.codaTimer = setTimeout(function () {
        if (!stato._coda) return;
        stato._coda = false; btn.disabled = false; cerca();
        CORE.toast("Nessuna sala aperta. Creane una e invita un amico.", "warn", 3500);
      }, 4000);
    }).catch(function () {
      stato._coda = false; btn.disabled = false;
      CORE.toast("Ricerca non riuscita. Controlla la connessione e riprova.", "warn", 4000);
    });
  }

  /* -------------------------------- lobby -------------------------------- */

  function renderLobby(d) {
    $("lobby-code").textContent = d.id || stato.matchId || "—";
    var g = ROOM.giocatoriMap(d);
    var pronti = d.pronti || [];
    var nomi = Object.keys(g);
    $("lobby-lista").innerHTML = nomi.map(function (n) {
      var ok = pronti.indexOf(n) >= 0;
      return '<div class="faw-row" style="cursor:default">' +
        '<span class="faw-avatar">' + esc(CORE.initials(n)) + "</span>" +
        '<span class="faw-row__main"><span class="faw-row__name">' + esc(n) + (n === stato.me ? " (tu)" : "") + "</span>" +
        '<span class="faw-row__meta">' + (g[n].entraInCorsa ? "entra in corsa" : (ok ? "pronto" : "in attesa")) + "</span></span>" +
        '<span class="faw-badge ' + (ok ? "faw-badge--ok" : "") + '">' + (ok ? "✅" : "⏳") + "</span></div>";
    }).join("");
    var max = d.maxGiocatori || 6;
    $("lobby-hint").textContent = nomi.length + "/" + max + " giocatori · miccia " +
      Math.round((((d.cfg || {}).bomba || {}).micciaMs || stato.micciaMs) / 1000) + " s · " + (nomi.length < 2 ? "invita almeno un amico per iniziare" : "si parte quando siete pronti");
    var b = $("btn-pronto");
    if (b) {
      var sonPronto = pronti.indexOf(stato.me) >= 0;
      b.setAttribute("aria-pressed", String(sonPronto));
      b.textContent = sonPronto ? "Sei pronto ✓" : "Sono pronto";
    }
    var avviaSubito = d.host === stato.me && nomi.length >= 2;
    b.classList.toggle("faw-btn--primary", !avviaSubito);
    b.textContent = avviaSubito ? (sonPronto ? "Avvia ora" : "Sono pronto") : (sonPronto ? "Sei pronto ✓" : "Sono pronto");
    if (!stato._lobbyBind) {
      stato._lobbyBind = true;
      b.addEventListener("click", function () {
        var sonoPronto = (stato.data && (stato.data.pronti || []).indexOf(stato.me) >= 0);
        if (!sonoPronto) {
          stato.room.markReady(true).catch(function (e) {
            CORE.toast("Pronti non registrato (" + (e && e.message || "errore di rete") + "): riprova", "error", 4000);
          });
          return;
        }
        var tot = (stato.data.partecipanti || []).length;
        if (stato.data.host === stato.me && tot >= 2) {
          stato.room.maybeStart({ forza: true, nome: stato.me }).catch(function () { CORE.toast("Avvio non riuscito: riprova", "error"); });
          return;
        }
        if (tot === 1) { CORE.toast("Invita un amico: in sala servono almeno due giocatori.", "warn"); return; }
        CORE.toast("Aspetta che anche gli altri premano «Sono pronto»", "warn", 3000);
      });
      $("btn-regole-lobby").addEventListener("click", apriRegole);
      $("btn-copia").addEventListener("click", function () {
        var code = stato.matchId || "";
        var ok = function () { CORE.toast("Codice copiato", "ok", 1800); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(ok, function () { CORE.toast("Codice: " + code, "warn", 5000); });
        else CORE.toast("Codice: " + code, "warn", 5000);
      });
    }
  }

  /* -------------------------------- gioco -------------------------------- */

  function bindGioco() {
    if (stato._giocoBind) return;
    stato._giocoBind = true;
    var frm = $("frm-parola");
    if (frm) frm.addEventListener("submit", function (e) { e.preventDefault(); passa(); });
    var inp = $("inp-parola");
    if (inp) {
      inp.addEventListener("focus", function () { CORE.keepInputVisible(inp, 180); });
      inp.addEventListener("input", function () {
        if (!stato.pending) mostraFeedback("", false);
      });
    }
    bindRegole();

  }

  function apriRegole() {
    var d = $("dlg-regole");
    if (!d) return;
    if (typeof d.showModal === "function") d.showModal();
    else d.setAttribute("open", "");
    var c = $("btn-regole-close");
    if (c) setTimeout(function () { c.focus(); }, 30);
  }

  function render(d) {
    if (!d) return;
    var b = d.bomba || {};
    if (b.roundIdx != null && b.roundIdx !== stato.roundVisto) onNuovoRound(b);
    stato.roundVisto = b.roundIdx == null ? -1 : b.roundIdx;

    var poss = b.possessore;
    var mio = poss === stato.me;
    $("holder-avatar").textContent = mio ? "🫵" : (CORE.initials(poss || "?").slice(0, 2) || "💣");
    $("holder-k").textContent = mio ? "Tocca a te" : "Ha la bomba";
    $("holder-nome").textContent = mio ? "Passala!" : (poss || "—");
    $("bomba-hero").setAttribute("data-mio", mio ? "1" : "0");

    var seq = (b.round || {}).seq || "";
    var box = $("seq-box");
    box.setAttribute("aria-label", "la parola deve contenere " + seq);
    box.innerHTML = seq.split("").map(function (c) { return "<b>" + esc(c) + "</b>"; }).join("");
    $("seq-aiuto").textContent = (b.round && b.round.possibili ? b.round.possibili + " parole possibili nel dizionario · " : "") +
      "ogni parola italiana che contenga «" + seq + "»";

    var ul = b.ultima;
    $("box-ultima").hidden = !ul;
    if (ul) $("ultima-text").textContent = ul.da + " → " + (ul.w || "");

    $("hud-round").textContent = "Round " + ((b.roundIdx || 0) + 1);
    $("hud-partite").textContent = (d.partecipanti || []).length + " giocatori";

    renderLista(d);
    renderFeed(d);
    renderTurno(d);
  }

  function renderTurno(d) {
    var b = d.bomba || {};
    var poss = b.possessore;
    var mio = poss === stato.me;
    var inp = $("inp-parola"), btn = $("btn-passa");
    var r = b.round || {};
    var pausa = !!r.inizioAlle && ora() < r.inizioAlle;
    var nonAncora = d.stato === "pronto" || !r.inizioAlle || pausa;
    var scaduta = !R.roundValido(r) || r.inizioAlle && (ora() >= R.esplodeAlle(r) || (d.endsAt && ora() >= d.endsAt));
    inp.disabled = !!nonAncora || !!scaduta;
    inp.readOnly = !!stato.pending;
    btn.disabled = !!nonAncora || !!scaduta || !mio || !!stato.pending;
    btn.textContent = nonAncora ? "Aspetta…" : stato.pending ? "Invio…" : mio ? "Passa" : "Aspetta il turno";
    inp.placeholder = mio ? "Parola con «" + (r.seq || "") + "»" : "Prepara la tua parola…";
    if (pausa) {
      $("attesa-k").textContent = "Nuovo round tra";
      $("attesa-n").textContent = String(Math.ceil((r.inizioAlle - ora()) / 1000));
      $("attesa-t").textContent = "La miccia riparte tra poco";
      $("box-attesa").hidden = false;
    } else if (!mio && !nonAncora) {
      $("attesa-k").textContent = "Il turno di";
      $("attesa-n").textContent = "💣";
      $("attesa-t").textContent = (poss || "?") + " · puoi già preparare la parola";
      $("box-attesa").hidden = false;
    } else $("box-attesa").hidden = true;
    var label = $("holder-fx");
    label.textContent = mio ? "🔥" : "";
  }

  function renderLista(d) {
    var b = d.bomba || {};
    var parole = b.passaggi || R.contaParole(b.storico);
    $("bomba-lista").innerHTML = (d.partecipanti || []).map(function (n) {
      var e = (b.esplosioni || {})[n] || 0;
      var p = ((d.punteggi || {})[n] || 0);
      var BombaInMano = b.possessore === n;
      var visto = ((d.giocatori || {})[n] || {}).visto || 0;
      var assente = (ora() - visto) > CFG.offlineMs;
      return '<div class="bomba__gioc" data-who="' + (n === stato.me ? "me" : "altro") + '" data-bomba="' + (BombaInMano ? 1 : 0) + '">' +
        '<span class="bomba__gioc__av" aria-hidden="true">' + (BombaInMano ? "💣" : esc(CORE.initials(n))) + "</span>" +
        '<span class="bomba__gioc__n">' + esc(n) + (n === stato.me ? " (tu)" : "") + (assente ? ' <span class="bomba__nota">offline</span>' : "") + "</span>" +
        '<span class="bomba__gioc__s"><span title="parole valide">' + (parole[n] || 0) + "📝</span>" +
        '<span class="' + (e ? "bomba__gioc__boom" : "") + '" title="esplosioni subite">' + (e ? e + "💥" : "—") + "</span>" +
        "<strong>" + p + "</strong></span>" +
        "</div>";
    }).join("");
  }

  function renderFeed(d) {
    var b = d.bomba || {};
    var righe = (b.storico || []).slice(-9).reverse().map(function (r) {
      return '<div class="faw-feed__riga">' + esc(R.rigaStorico(r)) + "</div>";
    });
    if (!righe.length) righe = ['<div class="faw-feed__riga is-vuoto">Ancora nessun passaggio: la bomba è in mano a ' + esc(b.possessore || "—") + "</div>"];
    $("bomba-feed").innerHTML = righe.join("");
  }

  function onNuovoRound(b) {
    if (stato.pending) { clearTimeout(stato.retryTimer); stato.pending = null; }
    var inp = $("inp-parola");
    if (inp) { inp.value = ""; inp.disabled = false; }
    var btn = $("btn-passa");
    if (btn) btn.disabled = false;
    mostraFeedback("", false);
    if (b.roundIdx > 0) {
      CORE.toast("Round " + (b.roundIdx + 1) + ": sequenza " + ((b.round || {}).seq || ""), "ok", 2500);
      if (!CORE.reducedMotion()) {
        var h = $("bomba-hero");
        h.classList.add("trema");
        setTimeout(function () { h.classList.remove("trema"); }, 900);
      }
    }
    CORE.vibrate([10, 30, 10]);
  }

  function mostraFeedback(testo, negativo) {
    var f = $("fb-parola");
    if (!f) return;
    f.textContent = testo || "";
    f.classList.toggle("is-no", !!negativo && !!testo);
    f.classList.toggle("is-ok", !negativo && !!testo);
  }

  /* ------------------------------- passaggio ------------------------------ */

  function passa() {
    if (stato.pending || !stato.data) return;
    if (stato.solo) { passaSolo(); return; }
    var b = stato.data.bomba || {};
    var request = { testo: $("inp-parola").value.trim(), roundIdx: b.roundIdx, tentativi: 0 };
    var local = R.puoPassare(stato.data, stato.me, { ora: ora(), testo: request.testo, roundIdx: request.roundIdx });
    if (!local.ok) { rifiuto(local.motivo, (b.round || {}).seq); return; }
    request.parola = local.parola;
    stato.pending = request;
    renderTurno(stato.data);
    tentaPassaggio(request);
  }
  function tentaPassaggio(request) {
    if (stato.pending !== request) return;
    request.tentativi++;
    var motivo = null, punti = 0, prossimo = null;
    scrivi(function (cur) {
      var v = R.puoPassare(cur, stato.me, { ora: ora(), testo: request.testo, roundIdx: request.roundIdx });
      if (!v.ok) { motivo = v.motivo; return false; }
      var eff = R.patchPassaggio(cur, stato.me, v, { ora: ora(), attivi: attivi(cur) });
      punti = v.punti; prossimo = eff.prossimo;
      return eff.patch;
    }).then(function (res) {
      if (stato.pending !== request) return;
      stato.pending = null;
      var confermata = res.applied || (((res.data || {}).bomba || {}).storico || []).some(function (r) { return r.r === request.roundIdx && r.da === stato.me && r.w === request.parola; });
      if (confermata) { CORE.vibrate(12);
        $("inp-parola").value = "";
        mostraFeedback("Passaggio confermato" + (prossimo ? " → " + prossimo : "") + (punti ? " (+" + punti + ")" : ""), false);
      } else rifiuto(motivo || "FUORI_TEMPO", ((stato.data.bomba || {}).round || {}).seq);
      renderTurno(stato.data);
    }).catch(function (err) {
      if (stato.pending !== request) return;
      var b = stato.data.bomba || {};
      if (request.tentativi < 3 && b.roundIdx === request.roundIdx && ora() < R.esplodeAlle(b.round) && err.code !== "permission-denied") {
        mostraFeedback("Invio in attesa di conferma. Riprovo " + request.tentativi + "/3: la miccia continua.", true);
        stato.retryTimer = setTimeout(function () { tentaPassaggio(request); }, 600 * request.tentativi);
      } else {
        stato.pending = null; renderTurno(stato.data);
        mostraFeedback("Passaggio non confermato. Riprova se hai ancora la bomba.", true);
      }
    });
  }
  function rifiuto(motivo, seq) {
    CORE.vibrate([14, 40, 14]);
    var t = R.motivoTesto(motivo, seq) || "Parola non accettata.";
    mostraFeedback(t, true);
    var f = $("fb-parola");
    if (f) { f.classList.add("trema"); setTimeout(function () { f.classList.remove("trema"); }, 700); }
  }

  function attivi(cur) {
    var t = ora();
    return (cur.partecipanti || []).filter(function (n) {
      return (t - (((cur.giocatori || {})[n] || {}).visto || 0)) < CFG.offlineMs;
    });
  }

  /* ------------------------------- miccia --------------------------------- */

  function avviaTicking() {
    if (stato.tick) return;
    stato.tick = setInterval(function () { try { tick(); } catch (e) { console.warn("[bomba]", e); } }, TICK_MS);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", function () { if (!document.hidden) tick(); });
    }
  }

  function tick() {
    var d = stato.data;
    if (!d || ["pronto", "in_corso"].indexOf(d.stato) < 0 || (!stato.solo && (d.partecipanti || []).indexOf(stato.me) < 0)) return;
    var b = d.bomba || {};
    var r = b.round || null;
    // countdown di inizio partita: chi arriva primo apre il round (transazione idempotente)
    if (d.stato === "pronto" && (d.startAt || 0) <= ora() && !stato._passato && !stato.solo && ora() >= stato.retryAt) {
      stato._passato = true;
      scrivi(function (cur) {
        if (!cur || cur.stato !== "pronto" || (cur.startAt || 0) > ora()) return false;
        return inizializzaRound(cur, "avvio");
      }).catch(function () { stato.retryAt = ora() + 1500; }).finally(function () { stato._passato = false; });
    }
    if (d.stato === "pronto") {
      var rest = Math.max(0, Math.ceil(((d.startAt || 0) - ora()) / 1000));
      $("box-attesa").hidden = false;
      $("attesa-k").textContent = "Si parte tra";
      $("attesa-n").textContent = String(rest);
      $("attesa-t").textContent = rest <= 0 ? "via!" : "secondi · la miccia parte con il round";
      $("hud-tempo").textContent = CORE.fmtTime(Math.max(0, ((d.endsAt || 0) - ora()) / 1000));
      return;
    }
    if (!R.roundValido(r) && d.stato === "in_corso" && !stato.solo && !stato._fixRound && ora() >= stato.retryAt) {
      stato._fixRound = true;
      scrivi(function (cur) {
        if (!cur || cur.stato !== "in_corso" || R.roundValido((cur.bomba || {}).round)) return false;
        return inizializzaRound(cur, "riavvio");
      }).catch(function () { stato.retryAt = ora() + 1500; }).finally(function () { stato._fixRound = false; });
      return;
    }
    if (!R.roundValido(r)) return;
    renderTurno(d);
    if (d.endsAt && ora() >= d.endsAt && d.endsAt < R.esplodeAlle(r)) { chiudiPerTempo(); return; }
    if (ora() < r.inizioAlle) return;
    var trascorso = ora() - (r.inizioAlle || 0);
    var micciaMs = r.micciaMs || stato.micciaMs;
    var m = R.statoMiccia(trascorso, micciaMs);
    var bar = $("fuse-barra");
    var lab = $("fuse-lab");
    var hero = $("bomba-hero");
    if (bar) bar.style.width = Math.round(m.frazione * 100) + "%";
    if (hero) hero.setAttribute("data-liv", String(m.livello));
    if (m.livello !== stato.liv) {
      stato.liv = m.livello;
      if (lab) lab.textContent = m.icona + " " + m.etichetta;
      if (m.livello >= 4 && m.livello !== 5) CORE.vibrate(8);
    }
    $("hud-tempo").textContent = CORE.fmtTime(Math.max(0, ((d.endsAt || 0) - ora()) / 1000));
    if (m.esplosa && stato.esplosoRound !== b.roundIdx && ora() >= stato.retryAt) {
      esplodi();
      return;
    }
    if (stato.inGioco && (d.endsAt || 0) <= ora() && !stato.chiusa) chiudiPerTempo();
  }

  function esplodi() {
    if (stato._esplodendo || !stato.data || !round() || ora() < R.esplodeAlle(round())) return;
    if (stato.solo) { esplodiSolo(); return; }
    var b = stato.data.bomba || {}, idx = b.roundIdx, vittima = b.possessore;
    stato._esplodendo = true;
    scrivi(function (cur) {
      if (!cur || (cur.bomba || {}).roundIdx !== idx) return false;
      var result = R.patchEsplosione(cur, { ora: ora(), attivi: attivi(cur) });
      return result ? result.patch : false;
    }).then(function (res) {
      if (!res.applied) return;
      stato.esplosoRound = idx; CORE.vibrate([30, 60, 30]);
      CORE.toast("💥 " + (vittima === stato.me ? "La bomba è esplosa nelle tue mani" : vittima + " ha la bomba") + " · −100 punti", "warn", 3000);
    }).catch(function () { stato.retryAt = ora() + 1500; })
      .finally(function () { stato._esplodendo = false; });
  }

  /** il possessore offline non blocca il giro */
  function autoPassa() {
    var d = stato.data;
    if (!d || stato.solo) return;
    var b = d.bomba || {};
    var holder = b.possessore;
    if (!holder) return;
    if (!R.puoAutoPassare(d, stato.me, { ora: ora() })) return;
    var chiave = "bomba:auto:" + (b.roundIdx || 0) + ":" + holder + ":" + Math.round(b.ultimoPasso || 0);
    stato.room.resolveOnce(chiave, function (cur) {
      if (!cur || (cur.bomba || {}).possessore !== holder || (cur.bomba || {}).roundIdx !== b.roundIdx || !R.puoAutoPassare(cur, stato.me, { ora: ora() })) return false;
      var out = R.patchAutoPassaggio(cur, { ora: ora(), attivi: attivi(cur) });
      if (!out.prossimo || out.prossimo === ((cur.bomba || {}).possessore)) return false;
      return out.patch;
    }).then(function (res) {
      if (res && res.applied && res.data && res.data.bomba && holder !== stato.me) {
        CORE.toast(holder + " non c’è: la bomba passa a " + res.data.bomba.possessore, "warn", 3000);
      }
    }).catch(function () {});
  }

  /* ------------------------------ fine partita ---------------------------- */

  function chiudiPerTempo() {
    if (stato.solo) { chiudiSolo(); return; }
    if (stato.chiusa || ora() < stato.retryAt) return;
    stato.chiusa = true;
    scrivi(function (cur) { return R.patchFineTempo(cur, ora()); })
      .catch(function () { stato.retryAt = ora() + 1500; })
      .finally(function () { stato.chiusa = false; });
  }

  function watchdog() {
    var d = stato.data;
    if (!d || stato.solo || ["attesa", "pronto", "in_corso"].indexOf(d.stato) < 0) return;
    tick();
    autoPassa();
    var hostVisto = ((d.giocatori || {})[d.host] || {}).visto || 0;
    if (d.host !== stato.me && ora() - hostVisto > 45000) stato.room.claimHost().catch(function () {});
  }

  /* ------------------------------- risultati ------------------------------ */

  function renderRisultati(d) {
    var r = (d.risultati || {}) ;
    var cls = r.classifica || R.classifica(d.punteggi || {}, d.bomba || {});
    var es = r.esito || R.esito(cls);
    var mio = cls.filter(function (c) { return c.nome === stato.me; })[0] || {};
    $("ris-titolo").textContent = es.pareggio ? "Pareggio" : (es.campione === stato.me ? "Hai vinto" : (es.campione || "Finita"));
    $("ris-sub").textContent = es.pareggio
      ? ("stesso punteggio e stessa fortuna: " + es.pari.join(", "))
      : (es.campione === stato.me ? "nessuna esplosione di troppo." : "ha vinto " + es.campione + ".");
    $("ris-fx").textContent = es.campione === stato.me ? "🏆" : "💥";
    var esitoBox = document.querySelector(".bomba__esito");
    if (esitoBox && !CORE.reducedMotion()) { esitoBox.classList.add("boom"); setTimeout(function () { esitoBox.classList.remove("boom"); }, 900); }
    var b = d.bomba || {};
    var parole = b.passaggi || R.contaParole(b.storico);
    $("ris-stats").innerHTML = [
      ["punti", mio.punti == null ? "—" : mio.punti],
      ["parole valide", parole[stato.me] || 0],
      ["esplosioni", ((b.esplosioni || {})[stato.me]) || 0],
      ["passaggi", ((b.passaggi || {})[stato.me]) || 0],
      ["round", (r.round || ((b.roundIdx || 0) + 1))],
      ["posizione", cls.length ? (cls.map(function (c) { return c.nome; }).indexOf(stato.me) + 1) : 1]
    ].map(function (p) {
      return '<div class="faw-stat"><span class="faw-stat__k">' + p[0] + '</span><span class="faw-stat__v">' + esc(p[1]) + "</span></div>";
    }).join("");

    $("classifica").innerHTML = cls.map(function (c, i) {
      return '<div class="faw-rank' + (c.nome === stato.me ? " is-me" : "") + '">' +
        '<span class="faw-rank__n">' + (i + 1) + "</span>" +
        '<span class="faw-rank__av" aria-hidden="true">' + esc(CORE.initials(c.nome)) + "</span>" +
        '<span class="faw-rank__nome">' + esc(c.nome) + (c.nome === stato.me ? " (tu)" : "") + "</span>" +
        '<span class="faw-rank__meta">' + (c.parole || 0) + " parole · " + (c.esplosioni || 0) + "💥</span>" +
        '<span class="faw-rank__v">' + (c.punti || 0) + "</span></div>";
    }).join("");

    $("ris-parole").innerHTML = ((b.storico || []).filter(function (x) { return x.w; })).slice(-40).reverse().map(function (x) {
      return '<span class="faw-chips__c">' + esc(x.w) + ' <small>' + esc(x.da) + "</small></span>";
    }).join("") || '<span class="faw-muted">Nessuna parola accettata: partita di pura resistenza.</span>';

    bindRisultati(d);
  }

  function bindRisultati(d) {
    var btn = $("btn-rivincita"), hint = $("rivincita-hint");
    if (btn._b) return;
    btn._b = true;
    function aggiornaRematch(dd0) {
      var dd = dd0 || stato.data || d;
      var altri = (dd.partecipanti || []).filter(function (n) { return n !== stato.me; });
      var acc = dd.rivincitaAccettataDa || [];
      if (dd.prossimaPartita) {
        hint.textContent = "Rivincita pronta: " + acc.length + "/" + (dd.partecipanti || []).length + " hanno accettato · entra tu";
        btn.textContent = "Entra in rivincita";
        btn.dataset.href = "index.html?matchId=" + encodeURIComponent(dd.prossimaPartita);
      } else {
        var voluti = (dd.rivincitaAccettataDa || []).length;
        hint.textContent = voluti ? (voluti + " di " + (altri.length + 1) + " vogliono la rivincita") : "";
        btn.textContent = "Rivincita";
        btn.dataset.href = "";
      }
    }
    aggiornaRematch();
    if (stato.room) stato.room.on({ state: function (dd) { if (dd) aggiornaRematch(dd); } });
    btn.addEventListener("click", function () {
      if (stato.solo) { avviaSolo(); return; }
      if (btn.disabled) return;
      if (btn.dataset.href) { stato.room.acceptRematch().then(function () { location.href = btn.dataset.href; }).catch(function () { CORE.toast("Ingresso non riuscito: riprova", "warn"); }); return; }
      btn.disabled = true;
      CORE.withRetry(function () {
        return stato.room.proposeRematch({
          durata: (stato.data || {}).durata,
          opzioni: { miccia: stato.diff, countdown: 0 },
          cfg: { bomba: { difficolta: stato.diff, micciaMs: CFG.micciaMs[stato.diff], esplosioniMax: CFG.esplosioniMax } }
        });
      }, 3, 400).then(function (id) {
        if (!id) { CORE.toast("Rivincita non riuscita: la partita è già archiviata", "warn"); return; }
        CORE.toast("Rivincita proposta: si entra quando accettano", "ok");
        aggiornaRematch();
      }).catch(function () { CORE.toast("Rivincita non riuscita: riprova", "error", 3500); }).finally(function () { btn.disabled = false; });
    });
    var home = $("btn-home");
    if (home) home.addEventListener("click", function () { location.href = "../../index.html"; });
    bindRegole();
  }

  /* --------------------------------- solo --------------------------------- */

  var startingSolo = false;
  async function avviaSolo() {
    if (startingSolo) return; startingSolo = true;
    var lex;
    try { lex = await global.FAWLessico.loadSolo(NET); WORDS.setPublication(lex.snapshot); }
    finally { startingSolo = false; }
    if (lex.origine !== "pubblicato") CORE.toast("Lessico: " + lex.origine, "warn", 6000);
    stato.solo = true;
    stato.esplosoRound = -1; stato.roundVisto = -1; stato.liv = -1; stato.chiusa = false; stato.pending = null;
    var seed = CORE.shortId("B").toUpperCase();
    var durataMs = (stato.durataScelta || 120) * 1000;
    var seq = R.scegliSequenza(seed, 0, stato.diff, {});
    stato.t0 = ora();
    var d = {
      id: "solo", lessico: lex.snapshot, gioco: GIOCO, stato: "in_corso", host: stato.me, creator: stato.me,
      partecipanti: [stato.me], giocatori: (function () { var o = {}; o[stato.me] = { nome: stato.me, visto: Date.now(), pronto: true }; return o; })(),
      punteggi: (function () { var o = {}; o[stato.me] = 0; return o; })(),
      opzioni: { miccia: stato.diff }, cfg: { bomba: { difficolta: stato.diff } },
      seed: seed, durata: durataMs, startAt: stato.t0, endsAt: stato.t0 + durataMs,
      maxEsplosioni: CFG.esplosioniMax, claim: {}, log: [],
      bomba: {
        difficolta: stato.diff, roundIdx: 0, roundsMax: 99,
        round: { i: 0, seq: seq.seq, possibili: seq.count, inizioAlle: stato.t0, micciaMs: stato.micciaMs },
        sequences: [seq.seq], possessore: stato.me, usate: [], storico: [], passaggi: {}, esplosioni: {}, saltati: {},
        ultimoPasso: stato.t0
      }
    };
    stato.dataLocale = d; stato.data = d;
    stato.inGioco = true;
    NET.init({ backend: "auto" });
    mostra("gioco");
    bindGioco();
    $("top-stato").textContent = "allenamento";
    avviaTicking();
    render(d);
    CORE.toast("Modalità allenamento: la miccia è la stessa, nessun altro ti aspetta", "ok", 3200);
  }

  function passaSolo() {
    var inp = $("inp-parola"), d = stato.dataLocale;
    var testo = (inp.value || "").trim();
    if (!testo) { mostraFeedback("Scrivi una parola.", true); return; }
    var b = d.bomba || {};
    var v = R.puoPassare(d, stato.me, { ora: ora(), testo: testo, roundIdx: b.roundIdx });
    if (!v.ok) { rifiuto(v.motivo, b.round.seq); return; }
    var eff = R.patchPassaggio(d, stato.me, v, { ora: ora(), attivi: [stato.me] });
    applica(d, eff.patch);
    d.bomba.possessore = stato.me;     // da solo la bomba torna subito a te
    d.bomba.ultimoPasso = ora();
    CORE.vibrate(12);
    mostraFeedback("Ok +" + v.punti + " — ancora", false);
    inp.value = "";
    render(d);
  }

  function esplodiSolo() {
    var d = stato.dataLocale;
    var out = R.patchEsplosione(d, { ora: ora(), attivi: [stato.me] });
    if (!out) return;
    stato.esplosoRound = d.bomba.roundIdx;
    applica(d, out.patch);
    if (out.finita) { d.stato = "conclusa"; renderRisultati(d); stato.inGioco = false; mostra("risultati"); return; }
    d.bomba.possessore = stato.me;
    CORE.vibrate([30, 60, 30]);
    CORE.toast("💥 −100: nuova sequenza", "warn", 2500);
    render(d);
  }

  function chiudiSolo() {
    var d = stato.dataLocale;
    var patch = R.patchFineTempo(d, ora());
    if (!patch) return;
    applica(d, patch);
    stato.inGioco = false;
    mostra("risultati");
    renderRisultati(d);
  }

  /** applica una patch (chiavi dotted) a un oggetto locale: stessa semantica del backend */
  function applica(obj, patch) {
    Object.keys(patch).forEach(function (k) {
      var parts = k.split("."), t = obj;
      for (var i = 0; i < parts.length - 1; i++) { if (!t[parts[i]] || typeof t[parts[i]] !== "object") t[parts[i]] = {}; t = t[parts[i]]; }
      t[parts[parts.length - 1]] = patch[k];
    });
    return obj;
  }

  global.addEventListener("pagehide", function () {
    clearInterval(stato.tick); clearTimeout(stato.retryTimer); clearTimeout(stato.codaTimer);
    if (stato.stopCoda) stato.stopCoda();
    if (stato.room) stato.room.close();
  });
  global.addEventListener("pageshow", function (e) { if (e.persisted) location.reload(); });

  /* -------------------------------- bootstrap ------------------------------ */

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", avvio);
    else avvio();
  }
  global.FAWBomba = { stato: stato, avvio: avvio, passa: passa, esplodi: esplodi, mostra: mostra, R: R };
})(typeof window !== "undefined" ? window : globalThis);
