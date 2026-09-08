/**
 * Parole in Arena — interfaccia, input e sincronizzazione.
 *
 * Divide nettamente due mondi:
 *  • locale/animazione: griglia, drag, timer visivo, countdown
 *  • condiviso/decisione: il documento `partite/{id}` (punteggi, energia, effetti,
 *    fine partita) scritto in transazione con chiavi idempotenti
 *
 * Nessuna scrittura durante il trascinamento: le parole accettate vengono
 * accodate e inviate in un'unica transazione (max 4 parole o ogni 2,5 s).
 */
(function (global) {
  "use strict";

  var CORE = global.FAWCore, NET = global.FAWNet, ROOM = global.FAWRoom, WORDS = global.FAWWords, R = global.FAWArenaRules;

  var GIOCO = "parole-arena";
  var FLUSH_PAROLE = 4, FLUSH_MS = 2500;

  var el = {};
  var stato = {
    me: "", matchId: null, room: null, data: null, solo: false,
    size: 5, letters: [], seed: "",
    found: new Map(), // parola -> {p, t}
    sel: [], dragging: false, pointerId: null,
    energia: 0, mieiEffetti: { raddio: null, scudo: null }, sabbiatoFine: 0,
    coda: [], flushTimer: null, eventoCorrente: null,
    inputMode: "trascina", inGioco: false, t0: 0, durateMs: 180000,
    started: false, resultsShown: false, busy: CORE ? CORE.onceGuard(600) : function () { return true; },
    timerTick: null, unsub: [], bersaglio: null, senzaPowerup: false, senzaEventi: false
  };

  function $(id) { return document.getElementById(id); }
  function mostra(id) {
    var attivo = "schermo-" + id;
    document.querySelectorAll("main > section[id^=\"schermo-\"]").forEach(function (n) {
      n.hidden = n.id !== attivo;
    });
  }
  function ora() { return NET.clock(); }

  /* ------------------------------- boot ------------------------------- */

  var crea = { durata: 180, griglia: "5", giocatori: 4, mode: "eventi" };

  function avvio() {
    CORE.initTheme();
    CORE.armaSuoni();
    el = {
      griglia: $("griglia"), linea: $("linea"), timer: $("timer"), punti: $("punti"), energia: $("energia"),
      evento: $("evento"), eventoBar: $("evento-bar"), classifica: $("classifica"), feed: $("feed"),
      powerbar: $("powerbar"), word: $("word"), lobby: $("lobby-lista"), countdown: $("countdown-num"),
      bootMsg: $("boot-msg"), bootState: $("boot-state")
    };
    var matchId = CORE.qs("matchId");
    stato.me = (localStorage.getItem("mioNome") || "OSPITE").toUpperCase();
    if (!matchId) {
      // opzioni da URL: le passa l'hub per l'allenamento rapidissimo
      var gUrl = CORE.qs("griglia"), dUrl = parseInt(CORE.qs("durata"), 10);
      if (R.GRIGLIE[gUrl]) stato.size = crea.griglia = gUrl;
      if (dUrl >= 120 && dUrl <= 240) stato.durateMs = dUrl * 1000;
      stato.matchId = null;
      if (CORE.qs("solo") === "1") { stato.solo = true; stato.seed = CORE.shortId("solo").toUpperCase(); avviaSolo(); }
      else mostra("crea");
    } else {
      stato.matchId = matchId;
      NET.init({ backend: "auto" });
      // opt-in (?auth=anon / faw:auth:anon=1): mette l'uid di Firebase Auth nel
      // documento partita (`authUid`). Di default è un no-op: nessun comportamento
      // cambia, e i test girano con il backend finto dove è dichiaratamente null.
      NET.ensureSignedIn();
      collegati();
    }
    bindTop();
    caricadizionario();
  }

  function caricadizionario() {
    if (WORDS.isDictionaryReady()) { onDizionario(WORDS.dictionarySize()); return Promise.resolve(); }
    el.bootState && (el.bootState.hidden = false);
    return WORDS.load({}).then(function (r) {
      onDizionario(r.size);
    }).catch(function (e) {
      if (el.bootMsg) {
        el.bootMsg.innerHTML = '<div class="faw-state"><span class="faw-state__icon">⚠️</span>' +
          "<p>Non riesco a caricare il dizionario.</p>" +
          '<button class="faw-btn faw-btn--primary" data-action="retry">Riprova</button></div>';
      }
    });
  }
  function onDizionario(n) {
    if (el.bootMsg) el.bootMsg.textContent = "Dizionario pronto: " + n.toLocaleString("it-IT") + " parole.";
    var bs = $("btn-solo");
    if (bs) { bs.disabled = false; bs.title = ""; }
    if (stato.solo && !stato.letters.length) { preparaGrigliaSolo(); renderGriglia(); }
    // in multiplayer è la sala (stato del documento) a decidere la schermata:
    // nascondere il boot qui basterebbe a sovrascrivere un "gioco" già ripreso
  }

  /** Pannello "nuova partita": poche scelte, tutte con esito visibile, poi si entra in lobby. */
  function bindCrea() {
    Array.prototype.forEach.call(document.querySelectorAll("#schermo-crea [data-seg]"), function (seg) {
      seg.addEventListener("click", function (e) {
        var b = e.target.closest("[data-v]");
        if (!b) return;
        Array.prototype.forEach.call(seg.querySelectorAll("[data-v]"), function (x) {
          x.setAttribute("aria-pressed", String(x === b));
        });
        crea[seg.getAttribute("data-seg")] = b.getAttribute("data-v");
      });
    });
    var btn = $("btn-crea-stanza");
    if (btn) btn.addEventListener("click", function () { creaStanza(btn); });
    var solo = $("btn-solo");
    if (solo) solo.addEventListener("click", function () {
      if (solo.disabled) return;
      stato.solo = true;
      stato.size = R.GRIGLIE[crea.griglia] || stato.size;
      stato.seed = CORE.shortId("solo").toUpperCase();
      avviaSolo();
    });
  }

  function creaStanza(btn) {
    btn.disabled = true;
    ROOM.create({
      gioco: "parole-arena",
      creator: stato.me,
      giocatori: [stato.me],
      maxGiocatori: parseInt(crea.giocatori, 10) || 4,
      durata: parseInt(crea.durata, 10) * 1000,
      opzioni: {
        griglia: String(crea.griglia), durata: String(crea.durata),
        mode: crea.mode, countdown: 5
      }
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

  /** Chi apre il link entra nella lista: un solo tentativo per caricamento. */
  function unisciti(d) {
    if (!d || stato._join) return;
    if ((d.partecipanti || []).indexOf(stato.me) >= 0) { stato._join = true; return; }
    if (d.stato === "conclusa" || d.stato === "annullata") {
      stato._join = true;
      CORE.toast("Partita già conclusa: torna all'hub per crearne una nuova", "warn", 4000);
      return;
    }
    if ((d.partecipanti || []).length >= (d.maxGiocatori || 6)) {
      stato._join = true;
      CORE.toast("Posti esauriti in questa partita", "warn", 4000);
      return;
    }
    stato._join = true;
    stato.room.addPlayer(stato.me).then(function (ok) {
      if (!ok) CORE.toast("Non sei entrato in partita (posti pieni o partita chiusa)", "warn", 4000);
    });
  }

  function bindTop() {
    document.body.addEventListener("click", function (e) {
      var b = e.target.closest("[data-action]");
      if (!b) return;
      var a = b.getAttribute("data-action");
      if (a === "retry") { el.bootMsg && (el.bootMsg.textContent = "Caricamento dizionario…"); caricadizionario(); }
      if (a === "home") { esci(); }
      if (a === "tema") { CORE.toggleTheme(); }
      if (a === "audio") {
        var on = !CORE.soundOn(); CORE.setSoundOn(on);
        b.setAttribute("aria-pressed", String(on));
        b.setAttribute("data-off", on ? "false" : "true");
        if (on) CORE.beep("ping");
      }
      if (a === "input") {
        stato.inputMode = stato.inputMode === "trascina" ? "tocca" : "trascina";
        b.setAttribute("aria-pressed", String(stato.inputMode === "tocca"));
        b.querySelector(".txt").textContent = stato.inputMode === "trascina" ? "Trascina" : "Tocco a tocco";
        CORE.toast(stato.inputMode === "tocca" ? "Tocca le lettere in sequenza, Invio per confermare" : "Trascina sulle lettere");
      }
      if (a === "regole") { $("dlg-regole") && CORE.showDialog($("dlg-regole")); }
    });
    document.querySelectorAll("[data-action]").forEach(function (b) {
      if (b.getAttribute("data-action") === "audio") b.setAttribute("aria-pressed", String(CORE.soundOn()));
    });
  }

  function esci() {
    if (stato.inGioco) {
      CORE.confirmDialog({ title: "Uscire dalla partita?", message: "Esce ora; gli altri continuano. La partita resta nella lista del portale.", okLabel: "Esci", danger: true })
        .then(function (v) { if (v) location.href = "../../index.html"; });
      return;
    }
    location.href = "../../index.html";
  }

  /* ------------------------------ multiplayer ----------------------------- */

  function collegati() {
    mostra("lobby");
    stato.room = ROOM.open({ matchId: stato.matchId, nome: stato.me, net: NET });
    stato.room.on({
      state: function (d) { unisciti(d); onStato(d); },
      gone: function () { CORE.toast("Partita terminata o rimossa", "warn"); location.href = "../../index.html"; },
      status: function (s) { $("conn").hidden = s === "online"; $("conn").querySelector(".t").textContent = s === "online" ? "" : "Connessione persa: riprovo"; }
    });
    stato.room.start();
    stato.room.startWatchdog(function () { watchdog(); }, 3000);
  }

  function onStato(data) {
    if (!data) return;
    stato.data = data;
    var opts = data.opzioni || {};
    stato.size = R.GRIGLIE[opts.griglia] || 5;
    // tre livelli di «rumorismo» della partita: eventi + potenziamenti,
    // solo potenziamenti, oppure parole e basta (scelta visibile in lobby)
    stato.senzaPowerup = opts.mode === "solo-parole";
    stato.senzaEventi = opts.mode !== "eventi";
    stato.durateMs = ROOM.durataMs(data);
    stato.seed = (opts.seed || data.seed || "SEED") + "";
    if ($("lobby-seed")) $("lobby-seed").textContent = stato.seed;
    $("lobby-meta").textContent = stato.size + "×" + stato.size + " • " + Math.round(stato.durateMs / 60000) + " min • " + (data.partecipanti || []).length + " giocatori";
    var cfg = data.cfg || {};
    if (cfg.griglia && cfg.griglia.letters && cfg.griglia.size === stato.size) {
      stato.letters = cfg.griglia.letters;
    } else if (!stato.letters.length || stato.letters.length !== stato.size * stato.size) {
      stato.letters = costruisciLettere(stato.seed, stato.size);
    }
    // energia/effetti miei dallo stato condiviso
    var arena = data.arena || {};
    stato.energia = (arena.energia || {})[stato.me] || 0;
    var mieAtt = (arena.attivi || {})[stato.me] || {};
    stato.mieiEffetti = mieAtt;
    stato.sabbiatoFine = ((arena.colpito || {})[stato.me] || {}).fine || 0;
    if (data.parole && data.parole[stato.me]) {
      data.parole[stato.me].forEach(function (w) { if (!stato.found.has(w)) stato.found.set(w, { p: 0, locale: false }); });
    }
    renderLobby(data);
    var fase = ROOM.fase(data);
    if (data.stato === "attesa") { stato.inGioco = false; mostra("lobby"); }
    else if (data.stato === "pronto") { mostra("lobby"); countdownView(data); }
    else if (data.stato === "in_corso") { entraInGioco(data); }
    else if (data.stato === "risultati" || data.stato === "conclusa") {
      if (stato.inGioco) finisci(data, true);
      else { renderRisultati(data); mostra("risultati"); }
    }
    var late = ((data.giocatori || {})[stato.me] || {}).entraInCorsa;
    if (late && $("late-note")) $("late-note").hidden = false;
  }

  /**
   * Lettere della griglia: funzione PURA del seed.
   * Non si usa un risolutore con budget di tempo qui dentro: due dispositivi
   * con prestazioni diverse avrebbero generato griglie diverse. Il primo client
   * che entra in `pronto` pubblica `cfg.griglia` e gli altri (anche chi arriva
   * tardi o ricarica) leggono quella lista: una sola fonte di verità.
   * La qualità della griglia è garantita dal pool di Ruzzle (ricco di vocali),
   * verificata da `tests/unit/arena-griglia.test.js`.
   */
  function costruisciLettere(seed, size) {
    var rng = CORE.rngFrom(seed + ":griglia");
    var pool = WORDS.LETTER_POOL;
    var out = [];
    for (var i = 0; i < size * size; i++) out.push(pool.charAt(Math.floor(rng() * pool.length)));
    return out;
  }

  /** Griglia dell'allenamento solo: qui si può cercare la migliore, non serve sincronizzarla. */
  function preparaGrigliaSolo() {
    var g = WORDS.generateGrid({
      size: stato.size,
      rng: CORE.rngFrom(stato.seed + ":solo"),
      minWords: 14 + stato.size * 4,
      attempts: 10
    });
    stato.letters = g.letters;
    stato.possibili = g.count;
    return g;
  }

  function renderSospeso() {
    var chip = document.getElementById("chip-sospeso");
    if (!chip) return;
    var n = (stato.coda || []).length;
    chip.hidden = !stato.inSospeso;
    chip.textContent = n ? ("⏳ " + n + " parole in attesa di conferma") : "⏳ invio in attesa di conferma";
    chip.title = "Le parole restano in coda e partono da sole appena la connessione o la partita lo permettono";
  }

  function renderLobby(data) {
    var g = ROOM.giocatoriMap(data);
    var pronti = data.pronti || [];
    el.lobby.innerHTML = Object.keys(g).map(function (n) {
      var ok = pronti.indexOf(n) >= 0;
      return '<div class="faw-row" style="cursor:default">' +
        '<span class="faw-avatar">' + CORE.escapeHtml(CORE.initials(n)) + "</span>" +
        '<span class="faw-row__main"><span class="faw-row__name">' + CORE.escapeHtml(n) + (n === stato.me ? " (tu)" : "") + "</span>" +
        '<span class="faw-row__meta">' + (ok ? "pronto" : "in attesa") + "</span></span>" +
        '<span class="faw-badge ' + (ok ? "faw-badge--ok" : "") + '">' + (ok ? "✅" : "⏳") + "</span></div>";
    }).join("");
    var ioPronto = pronti.indexOf(stato.me) >= 0;
    var btn = $("btn-pronto");
    btn.textContent = ioPronto ? "⏸️ NON SONO PRONTO" : "✅ SONO PRONTO";
    btn.setAttribute("aria-pressed", String(ioPronto));
    var tot = (data.partecipanti || []).length;
    $("lobby-count").textContent = Math.min(pronti.length, tot) + "/" + tot;
    var avvia = $("btn-avvia-subito");
    if (avvia) avvia.hidden = data.host !== stato.me || data.stato !== "attesa";
  }

  function countdownView(data) {
    var rem = Math.max(0, ((data.startAt || 0) - ora()) / 1000);
    if (rem <= 0) { $("countdown").hidden = true; entraInGioco(data); return; }
    $("countdown").hidden = false;
    el.countdown.textContent = String(Math.ceil(rem));
    clearTimeout(stato._cd);
    stato._cd = setTimeout(function () { if (stato.data) countdownView(stato.data); }, 200);
    if (stato.inGioco) return;
    if (!stato.data.cfg || !stato.data.cfg.griglia) pubblicaGriglia();
  }

  /** Chi arriva per primo in `pronto` scrive la griglia: una sola scrittura per match. */
  function pubblicaGriglia() {
    if (stato._pubbGriglia) return;
    stato._pubbGriglia = true;
    NET.transact(stato.room.path, function (cur) {
      if (!cur || cur.stato !== "pronto" || (cur.cfg && cur.cfg.griglia)) return false;
      return { "cfg.griglia": { size: stato.size, letters: stato.letters, seed: stato.seed } };
    }).then(function () { if (el.griglia) renderGriglia(); });
  }

  /* -------------------------------- gioco --------------------------------- */

  function entraInGioco(data) {
    if (!stato.inGioco) {
      stato.inGioco = true;
      stato.found = new Map();
      (data.parole && data.parole[stato.me] || []).forEach(function (w) { stato.found.set(w, { p: 0 }); });
      mostra("gioco");
      renderGriglia();
      renderPowerbar();
      avviaTicking();
      pubblicaGriglia();
      CORE.beep("start");
      if (!stato.solo) CORE.vibrate(30);
    }
    renderClassifica();
    renderFeed();
  }

  function avviaTicking() {
    clearInterval(stato.timerTick);
    stato.timerTick = setInterval(tick, 120);
    tick();
  }

  function tick() {
    var d = stato.data || {};
    if (!stato.solo && d.stato === "pronto" && (d.startAt || 0) <= ora() && !stato._passato) {
      stato._passato = true;
      NET.transact(stato.room.path, function (cur) {
        if (!cur || cur.stato !== "pronto" || (cur.startAt || 0) > ora()) return false;
        return { stato: "in_corso", iniziatoDa: stato.me };
      }).catch(function () { stato._passato = false; });
    }
    var end = d.endsAt || (stato.t0 + stato.durateMs);
    var rem = Math.max(0, (end - ora()) / 1000);
    el.timer.textContent = CORE.fmtTime(rem);
    el.timer.className = "faw-timer" + (rem <= 10 ? " faw-timer--bad" : rem <= 30 ? " faw-timer--warn" : "");
    if (rem <= 10 && !stato._warned && stato.inGioco) { stato._warned = true; CORE.beep("tick"); CORE.vibrate([40, 60, 40]); }
    // evento attivo
    var start = d.startAt || stato.t0;
    var ev = R.eventoAttivo(stato.seed, ora() - start, {
      senzaEventi: stato.senzaEventi, durataMs: stato.durateMs, celle: stato.size * stato.size
    });
    applicaEvento(ev);
    // fine
    if (rem <= 0 && stato.inGioco) finisci(d, false);
    renderPowerbar(rem);
  }

  function applicaEvento(ev) {
    var vecchio = stato.eventoCorrente;
    stato.eventoCorrente = ev;
    if (!ev) {
      el.evento.hidden = true;
      document.querySelectorAll(".tile.is-spec").forEach(function (t) { t.classList.remove("is-spec"); });
      return;
    }
    el.evento.hidden = false;
    el.evento.querySelector(".etichetta").textContent = ev.etichetta;
    el.eventoBar.style.width = Math.round((1 - (ev.progressione || 0)) * 100) + "%";
    if (!vecchio || vecchio.i !== ev.i) {
      CORE.beep("ping");
      CORE.toast("⚡ " + ev.etichetta, "ok", 2200);
      var spec = el.griglia.querySelector(".is-spec");
      if (spec) spec.classList.remove("is-spec");
      if (ev.tipo === "casella" && el.griglia.children[ev.payload]) {
        el.griglia.children[ev.payload].classList.add("is-spec");
      }
    }
  }

  function finisci(data, soloSegno) {
    stato.inGioco = false;
    clearInterval(stato.timerTick);
    svuotaCoda(true);
    if (stato.solo) { renderRisultati(soloData()); mostra("risultati"); return; }
    if (data && data.stato === "conclusa") { renderRisultati(data); mostra("risultati"); return; }
    chiudiPartita();
  }

  /** Chiusura autoritativa: un solo client calcola e scrive i risultati. */
  function chiudiPartita() {
    if (stato._chiuso) return;
    stato._chiuso = true;
    var nomi = (stato.data && stato.data.partecipanti) || [stato.me];
    stato.room.resolveOnce("chiudi", function (cur) {
      if (!cur) return false;
      var pun = cur.punteggi || {};
      var parole = cur.parole || {};
      var ordine = nomi.slice();
      var classifica = R.classifica(cur, { giocatori: ordine });
      var curva = (cur.arena && cur.arena.curve) || [];
      var patch = {
        stato: "conclusa",
        conclusoAt: Date.now(),
        finito: ordine.slice(),
        "risultati.classifica": classifica,
        "risultati.piuLunga": R.piuLunga(cur),
        "risultati.rimonta": R.migliorRimonta(curva, ordine),
        "risultati.esito": R.esito(classifica),
        "risultati.endAt": cur.endsAt || ora(),
        "risultati.chiusoDa": stato.me,
        "risultati.punteggiFinale": JSON.parse(JSON.stringify(pun)),
        "arena.curve": curva.slice(-80)
      };
      return patch;
    }).then(function () {
      return NET.get(stato.room.path);
    }).then(function (snap) {
      if (snap && snap.exists) { stato.data = snap.data; renderRisultati(snap.data); }
      mostra("risultati");
    }).catch(function (e) {
      stato._chiuso = false;
      CORE.toast("Chiusura non riuscita, riprovo", "warn");
    });
  }

  function soloData() {
    return {
      partecipanti: [stato.me], punteggi: (function () { var o = {}; o[stato.me] = puntiMiei(); return o; })(),
      parole: (function () { var o = {}; o[stato.me] = Array.from(stato.found.keys()); return o; })(),
      risultati: {
        classifica: [{ nome: stato.me, punti: puntiMiei(), parole: stato.found.size, piuLunga: piuLungaMia() }],
        piuLunga: (function () { var l = piuLungaMia(); return l ? { parola: l.parola, len: l.len, chi: stato.me } : null; })(),
        rimonta: null, esito: { tipo: "solo", nome: stato.me, punti: puntiMiei() }
      }
    };
  }
  function puntiMiei() { var s = 0; stato.found.forEach(function (v) { s += v.p || 0; }); return s; }
  function piuLungaMia() {
    var best = null;
    stato.found.forEach(function (v, w) { if (!best || w.length > best.len) best = { parola: w, len: w.length }; });
    return best;
  }

  /* -------------------------------- griglia -------------------------------- */

  function renderGriglia() {
    var g = el.griglia;
    if (!g) return;
    if (!stato.letters.length || stato.letters.length !== stato.size * stato.size) {
      stato.letters = costruisciLettere(stato.seed, stato.size);
    }
    g.style.setProperty("--cols", stato.size);
    var firma = stato.seed + ":" + stato.letters.join("");
    if (g.dataset.firma === firma && g.children.length === stato.letters.length) return;
    g.dataset.firma = firma;
    g.innerHTML = "";
    var ev = stato.eventoCorrente;
    stato.letters.forEach(function (ch, i) {
      var b = document.createElement("button");
      b.className = "tile";
      b.type = "button";
      b.dataset.i = i;
      b.textContent = ch;
      b.setAttribute("aria-label", "Lettera " + ch + ", posizione " + (Math.floor(i / stato.size) + 1) + "," + (i % stato.size + 1));
      if (ev && ev.tipo === "casella" && ev.payload === i) b.classList.add("is-spec");
      g.appendChild(b);
    });
    disegnaLinea();
  }

  function tileDaEvento(e) {
    var x = e.clientX, y = e.clientY;
    var node = document.elementFromPoint(x, y);
    var tile = node && node.closest ? node.closest(".tile") : null;
    return tile ? parseInt(tile.dataset.i, 10) : -1;
  }

  function selAdd(i) {
    if (i < 0) return;
    var last = stato.sel[stato.sel.length - 1];
    if (last === i) return;
    if (stato.sel.length === 1 && stato.sel[0] === i) return;
    if (stato.sel.indexOf(i) >= 0) {
      // ripercorrere all'indietro = annullare l'ultima lettera (comodo su mobile)
      if (stato.sel[stato.sel.length - 2] === i) { stato.sel.pop(); aggiornaSel(); }
      return;
    }
    if (last != null && !WORDS.isAdjacent(last, i, stato.size)) {
      if (stato.sel.length === 1) { stato.sel = [i]; aggiornaSel(); return; }
      return;
    }
    stato.sel.push(i);
    aggiornaSel();
  }

  function aggiornaSel() {
    var parola = stato.sel.map(function (i) { return stato.letters[i]; }).join("");
    el.word.textContent = parola.toUpperCase();
    el.word.className = "word" + (parola.length >= R.CFG.minLen ? " is-ok" : "");
    Array.prototype.forEach.call(el.griglia.children, function (t, i) {
      t.classList.toggle("is-sel", stato.sel.indexOf(i) >= 0);
    });
    disegnaLinea();
  }

  function disegnaLinea() {
    var svg = el.linea, g = el.griglia;
    if (!svg || !g) return;
    var gb = g.getBoundingClientRect();
    svg.setAttribute("viewBox", "0 0 " + gb.width + " " + gb.height);
    svg.setAttribute("width", gb.width);
    svg.setAttribute("height", gb.height);
    var pts = stato.sel.map(function (i) {
      var r = g.children[i].getBoundingClientRect();
      return (r.left - gb.left + r.width / 2) + "," + (r.top - gb.top + r.height / 2);
    });
    var last = pointerPos;
    if (pts.length && last) pts.push(last);
    svg.innerHTML = pts.length ? '<polyline points="' + pts.join(" ") + '" />' : "";
  }

  var pointerPos = null;

  function bindInput() {
    var g = el.griglia;
    g.addEventListener("pointerdown", function (e) {
      if (!stato.inGioco) return;
      var i = tileDaEvento(e);
      if (i < 0) return;
      if (stato.inputMode === "tocca") {
        stato.sel = stato.sel.length ? stato.sel : [];
        if (stato.sel.indexOf(i) < 0) selAdd(i); else invia();
        return;
      }
      stato.dragging = true;
      stato.pointerId = e.pointerId;
      try { g.setPointerCapture(e.pointerId); } catch (err) {}
      stato.sel = [i];
      aggiornaSel();
      e.preventDefault();
    });
    g.addEventListener("pointermove", function (e) {
      if (!stato.dragging || e.pointerId !== stato.pointerId) return;
      pointerPos = (function () {
        var gb = g.getBoundingClientRect();
        return (e.clientX - gb.left) + "," + (e.clientY - gb.top);
      })();
      var i = tileDaEvento(e);
      if (i >= 0 && stato.sel[stato.sel.length - 1] !== i) selAdd(i);
      else disegnaLinea();
      e.preventDefault();
    }, { passive: false });
    function end(e) {
      if (!stato.dragging) return;
      stato.dragging = false;
      pointerPos = null;
      invia();
    }
    g.addEventListener("pointerup", end);
    g.addEventListener("pointercancel", function () { stato.dragging = false; stato.sel = []; aggiornaSel(); });
    g.addEventListener("lostpointercapture", end);
    global.addEventListener("keydown", function (e) {
      if (!stato.inGioco) return;
      if (e.key === "Enter") { invia(); }
      if (e.key === "Backspace") { stato.sel.pop(); aggiornaSel(); e.preventDefault(); }
      if (e.key === "Escape") { stato.sel = []; aggiornaSel(); }
      if (/^[a-zA-Zàéèìòù]$/.test(e.key)) {
        var ch = e.key.toUpperCase();
        var start = -1;
        for (var i = 0; i < stato.letters.length; i++) if (stato.letters[i] === ch) { start = i; break; }
        if (start >= 0) { stato.sel = stato.sel.length ? stato.sel : []; selAdd(start); }
      }
    });
  }

  /* ------------------------------ invio parole ----------------------------- */

  function invia() {
    var cells = stato.sel.slice();
    stato.sel = [];
    aggiornaSel();
    if (!cells.length) return;
    var giocate = new Set(Array.from(stato.found.keys()));
    var v = R.valutaSelezione(cells, { size: stato.size, letters: stato.letters, giocate: giocate });
    if (!v.ok) {
      feedback(cells, v.motivo);
      return;
    }
    var effetti = {
      raddio: !!(stato.mieiEffetti.raddio && stato.mieiEffetti.raddio.fine > ora() && stato.mieiEffetti.raddio.parole > 0),
      sabbiato: stato.sabbiatoFine > ora(),
      casellaSpeciale: !!(stato.eventoCorrente && stato.eventoCorrente.tipo === "casella" && cells.indexOf(stato.eventoCorrente.payload) >= 0)
    };
    var sc = R.punteggi(v.parola, { evento: stato.senzaEventi ? null : stato.eventoCorrente, effetti: effetti });
    stato.found.set(v.parola, { p: sc.punti, t: ora() });
    stato.energia = R.energiaDopo(stato.energia, v.parola.length);
    if (effetti.raddio && stato.mieiEffetti.raddio) stato.mieiEffetti.raddio.parole--;
    feedback(cells, "OK", sc.punti);
    CORE.beep("ok");
    CORE.vibrate(18);
    renderPunti();
    if (!stato.solo) {
      stato.coda.push({ parola: v.parola, punti: sc.punti, len: v.parola.length, celle: cells });
      if (stato.coda.length >= FLUSH_PAROLE) svuotaCoda();
      else programmaFlush();
    }
  }

  function programmaFlush() {
    if (stato.flushTimer) return;
    stato.flushTimer = setTimeout(function () { stato.flushTimer = null; svuotaCoda(); }, FLUSH_MS);
  }

  /** Un'unica transazione per più parole: idempotente per parola già registrata. */
  function svuotaCoda(force) {
    if (stato.flushTimer) { clearTimeout(stato.flushTimer); stato.flushTimer = null; }
    var batch = stato.coda.slice();
    if (!batch.length) return Promise.resolve(false);
    if (!force) stato.coda = [];
    var room = stato.room;
    var perche = "";
    return NET.transact(room.path, function (cur) {
      var giocabile = cur && (cur.stato === "in_corso" ||
        (cur.stato === "pronto" && ora() >= (cur.startAt || 0)));
      if (!giocabile) { perche = cur && (cur.stato === "conclusa" || cur.stato === "annullata") ? "finita" : "non_ancora"; return false; }
      var mie = ((cur.parole || {})[stato.me]) || [];
      var patch = {};
      var aggiunte = 0, puntiNuovi = 0;
      batch.forEach(function (w) {
        if (mie.indexOf(w.parola) >= 0) return;
        mie.push(w.parola);
        aggiunte++; puntiNuovi += w.punti;
      });
      if (!aggiunte) { perche = "gia_contate"; return false; }
      var maxlen = 0;
      mie.forEach(function (w) { maxlen = Math.max(maxlen, w.length); });
      patch["parole." + stato.me] = mie.slice(-140);
      patch["punteggi." + stato.me] = ((cur.punteggi || {})[stato.me] || 0) + puntiNuovi;
      patch["arena.energia." + stato.me] = Math.min(R.CFG.energiaMax, ((cur.arena && cur.arena.energia || {})[stato.me] || 0) + batch.length + batch.filter(function (b) { return b.len >= R.CFG.energiaDa; }).length * R.CFG.energiaLunga);
      patch["arena.paroleTrovate." + stato.me] = mie.length;
      patch["arena.piuLunga." + stato.me] = maxlen;
      patch["arena.attivi." + stato.me] = { raddio: stato.mieiEffetti.raddio || null, scudo: stato.mieiEffetti.scudo || null };
      var t = ora();
      var ordine = (cur.partecipanti || []).slice();
      var pun = Object.assign({}, cur.punteggi || {});
      pun[stato.me] = (pun[stato.me] || 0) + puntiNuovi;
      var curva = ((cur.arena && cur.arena.curve) || []).slice(-60);
      curva.push(R.curvaRow(t, ordine, pun));
      patch["arena.curve"] = curva;
      // avviso sulle imprese (lunghezza, mai la parola)
      var maxLen = Math.max.apply(null, batch.map(function (b) { return b.len; }));
      patch.logUltimo = { t: t, tipo: "parole", da: stato.me, len: maxLen, n: aggiunte, punti: puntiNuovi };
      return patch;
    }).then(function (res) {
      if (res && res.applied) {
        stato.inSospeso = false;
        stato._tentativi = 0;
        renderSospeso();
        renderClassifica();
        return true;
      }
      // Le parole NON conteggiate per un motivo transitorio restano in coda:
      // un client in ritardo di qualche secondo o una partita che sta partendo
      // non devono far perdere il lavoro del giocatore. Se la partita è finita
      // o risultano già contate, la coda si chiude.
      if (perche === "non_ancora" && (stato._tentativi || 0) < 12) {
        stato._tentativi = (stato._tentativi || 0) + 1;
        stato.coda = batch.concat(stato.coda);
        stato.inSospeso = true;
        programmaFlush();
      } else {
        stato.inSospeso = false;
        stato._tentativi = 0;
      }
      renderSospeso();
      return false;
    }).catch(function (e) {
      stato.coda = batch.concat(stato.coda);
      stato.inSospeso = true;
      programmaFlush();
      renderSospeso();
      return false;
    });
  }

  /* ------------------------------ feedback UI ----------------------------- */

  function feedback(cells, motivo, punti) {
    var ok = motivo === "OK";
    cells.forEach(function (i) {
      var t = el.griglia.children[i];
      if (!t) return;
      t.classList.add(ok ? "anim-ok" : "anim-ko");
      setTimeout(function () { t.classList.remove("anim-ok", "anim-ko"); }, 260);
    });
    if (!ok) {
      CORE.beep("bad");
      var testi = {
        CORTA: "Servono almeno " + R.CFG.minLen + " lettere",
        NON_TROVATA: "Parola non nel dizionario",
        GIÀ_TROVATA: "L'avevi già trovata",
        NON_ADJACENT: "Lettere non vicine",
        CELLA_DOPPIA: "Stessa cella due volte"
      };
      el.word.textContent = testi[motivo] || "Non vale";
      el.word.className = "word is-ko";
      setTimeout(function () { el.word.textContent = ""; el.word.className = "word"; }, 900);
    } else {
      el.word.textContent = "+" + punti;
      el.word.className = "word is-ok";
      setTimeout(function () { if (!stato.sel.length) { el.word.textContent = ""; el.word.className = "word"; } }, 700);
    }
  }

  function renderPunti() {
    var condivisi = stato.data && stato.data.punteggi ? (stato.data.punteggi[stato.me] || 0) : 0;
    var extra = 0;
    stato.coda.forEach(function (w) { extra += w.punti; });
    el.punti.textContent = (stato.solo ? puntiMiei() : condivisi + extra);
    el.energia.textContent = stato.energia;
    var pips = $("energia-pips");
    if (pips) {
      pips.innerHTML = "";
      for (var i = 0; i < R.CFG.energiaMax; i++) {
        var s = document.createElement("i");
        s.className = i < stato.energia ? "on" : "";
        pips.appendChild(s);
      }
    }
    renderPowerbar();
  }

  function renderPowerbar() {
    if (!el.powerbar) return;
    if (stato.senzaPowerup) { el.powerbar.hidden = true; return; }
    el.powerbar.hidden = false;
    var t = ora();
    Array.prototype.forEach.call(el.powerbar.querySelectorAll("[data-pw]"), function (b) {
      var id = b.getAttribute("data-pw");
      var st = R.puoAttivare(id, { me: stato.me, giocatori: (stato.data && stato.data.partecipanti) || [stato.me], arena: (stato.data && stato.data.arena) || {}, bersaglio: stato.bersaglio }, t);
      var cfg = R.POWERUP[id];
      b.disabled = !st.ok && !b.getAttribute("data-force");
      b.classList.toggle("is-ready", !!(st.ok));
      b.title = st.ok ? cfg.testo : st.motivo;
      b.setAttribute("aria-label", cfg.nome + ": " + cfg.testo + (st.ok ? "" : " — " + st.motivo));
      var badge = b.querySelector(".costo");
      if (badge) badge.textContent = cfg.costo;
      var attivi = ((stato.data && stato.data.arena || {}).attivi || {})[stato.me] || {};
      var attivo = attivi[id] && attivi[id].fine > t;
      b.classList.toggle("is-active", !!attivo);
      if (id === "sabbiatura") {
        var tgt = b.querySelector(".tgt");
        if (tgt) tgt.textContent = st.ok ? "→ " + st.bersaglio : "";
      }
    });
    var mine = ((stato.data && stato.data.arena || {}).attivi || {})[stato.me] || {};
    $("effetto-raddio").hidden = !(mine.raddio && mine.raddio.fine > t);
    if (mine.raddio) $("effetto-raddio").textContent = "Raddio ×2 · " + Math.max(0, Math.ceil((mine.raddio.fine - t) / 1000)) + "s · " + mine.raddio.parole + " parole";
    $("effetto-scudo").hidden = !(mine.scudo && mine.scudo.fine > t);
    if (mine.scudo) $("effetto-scudo").textContent = "Scudo · " + Math.max(0, Math.ceil((mine.scudo.fine - t) / 1000)) + "s";
    var sab = ((stato.data && stato.data.arena || {}).colpito || {})[stato.me];
    $("effetto-sabbiato").hidden = !(sab && sab.fine > t);
    if (sab && sab.fine > t) $("effetto-sabbiato").textContent = "Sabbiato: bonus evento sospesi · " + Math.ceil((sab.fine - t) / 1000) + "s";
  }

  function attiva(id) {
    var t = ora();
    var st = R.puoAttivare(id, {
      me: stato.me, giocatori: (stato.data && stato.data.partecipanti) || [stato.me],
      arena: (stato.data && stato.data.arena) || {}, bersaglio: stato.bersaglio
    }, t);
    if (!st.ok) { CORE.toast(st.motivo, "warn"); return; }
    if (stato.solo) {
      stato.energia = Math.max(0, stato.energia - R.POWERUP[id].costo);
      stato.mieiEffetti[id] = { fine: t + R.POWERUP[id].durata, parole: id === "raddio" ? R.POWERUP[id].maxParole : 0 };
      CORE.beep("ping");
      renderPunti();
      return;
    }
    NET.transact(stato.room.path, function (cur) {
      if (!cur || cur.stato !== "in_corso") return false;
      var check = R.puoAttivare(id, {
        me: stato.me, giocatori: cur.partecipanti || [], arena: cur.arena || {}, bersaglio: st.bersaglio
      }, t);
      if (!check.ok) return false;
      return R.patchAttivazione(id, stato.me, check.bersaglio || null, t, cur.arena);
    }).then(function (res) {
      if (res && res.applied) {
        CORE.beep("ping");
        stato.energia = Math.max(0, stato.energia - R.POWERUP[id].costo);
        renderPunti();
      } else CORE.toast("Non più disponibile", "warn");
    });
  }

  /* -------------------------- classifica e feed --------------------------- */

  function renderClassifica() {
    var d = stato.data || {};
    var lista = R.classifica(d, { giocatori: (d.partecipanti || [stato.me]) });
    if (stato.solo) {
      var extra = 0; stato.coda.forEach(function (w) { extra += w.punti; });
      lista = [{ nome: stato.me, punti: puntiMiei() + extra, parole: stato.found.size, piuLunga: (piuLungaMia() || {}).len || 0 }];
    } else {
      var extra2 = 0; stato.coda.forEach(function (w) { extra2 += w.punti; });
      lista.forEach(function (r) { if (r.nome === stato.me) r.punti += extra2; });
      lista.sort(function (a, b) { return b.punti - a.punti; });
    }
    el.classifica.innerHTML = lista.map(function (r, i) {
      var mio = r.nome === stato.me;
      return '<div class="faw-rank ' + (i === 0 ? "is-top " : "") + (mio ? "is-me" : "") + '">' +
        '<span class="n">' + (i + 1) + "</span>" +
        '<span class="nm">' + CORE.escapeHtml(r.nome) + "</span>" +
        '<span class="pt faw-num">' + r.punti + "</span>" +
        '<span class="pw">' + r.parole + "</span></div>";
    }).join("");
    renderPunti();
  }

  function renderFeed() {
    var d = stato.data || {};
    var log = [];
    if (d.logUltimo) log.push(d.logUltimo);
    (d.log || []).forEach(function (x) { log.push(x); });
    var t = ora();
    log = log.filter(function (x) { return x && x.t && t - x.t < 30000; }).slice(-4);
    if (!log.length) { el.feed.innerHTML = ""; return; }
    el.feed.innerHTML = log.map(function (x) {
      var txt = "";
      if (x.tipo === "parole") txt = "🔎 " + x.da + " ha trovato " + x.n + (x.n > 1 ? " parole" : " parola") + " (fino a " + x.len + " lettere)";
      if (x.tipo === "raddio") txt = "⚡ " + x.da + " ha attivato Raddio";
      if (x.tipo === "scudo") txt = "🛡 " + x.da + " alza lo Scudo";
      if (x.tipo === "sabbiatura") txt = "🌪 " + x.da + " sabbia " + x.su;
      return '<div class="faw-feed-item">' + CORE.escapeHtml(txt) + "</div>";
    }).join("");
  }

  /* ------------------------------- risultati ------------------------------- */

  function renderRisultati(data) {
    renderRivincitaBox(data);
    var chiave = JSON.stringify(data && data.punteggi);
    if (stato.resultsShown && stato._risKey === chiave) return;
    stato.resultsShown = true;
    stato._risKey = chiave;
    var r = data && data.risultati ? data.risultati : {};
    var lista = r.classifica || R.classifica(data, { giocatori: (data.partecipanti || [stato.me]) });
    var mio = lista.filter(function (x) { return x.nome === stato.me; })[0] || { punti: 0, parole: 0, piuLunga: 0 };
    var pos = lista.indexOf(mio) + 1;
    var esito = r.esito || R.esito(lista);
    var titolo = esito.tipo === "vittoria" ? ("🏆 Vince " + esito.nome) :
      esito.tipo === "pareggio" ? ("🤝 Pareggio a " + esito.punti) :
        esito.tipo === "solo" ? ("Allenamento chiuso") : "Partita conclusa";
    $("ris-titolo").textContent = titolo;
    $("ris-body").innerHTML =
      '<div class="faw-stat-grid">' +
      stat(pos + "º", "Posizione") + stat(mio.punti, "Punti") + stat(mio.parole, "Parole") + stat(mio.piuLunga, "Più lunga") +
      "</div>" +
      ((r.piuLunga) ? '<p class="faw-dim">Parola più lunga: <b>' + CORE.escapeHtml(r.piuLunga.parola) + "</b> (" + r.piuLunga.len + ", " + CORE.escapeHtml(r.piuLunga.chi) + ")</p>" : "") +
      (r.rimonta ? '<p class="faw-dim">Miglior rimonta: <b>' + CORE.escapeHtml(r.rimonta.nome) + "</b> (+" + r.rimonta.recupero + " punti di svantaggio recuperati)</p>" : "") +
      '<div class="faw-list">' + lista.map(function (x, i) {
        return '<div class="faw-row" style="cursor:default">' + '<span class="faw-avatar">' + (i + 1) + "</span>" +
          '<span class="faw-row__main"><span class="faw-row__name">' + CORE.escapeHtml(x.nome) + "</span>" +
          '<span class="faw-row__meta">' + x.parole + " parole · più lunga " + (x.piuLunga || 0) + "</span></span>" +
          '<span class="faw-row__end faw-num faw-strong">' + x.punti + "</span></div>";
      }).join("") + "</div>" +
      '<details class="faw-card__details"><summary>Le tue parole (' + Array.from(stato.found.keys()).length + ")</summary>" +
      '<div class="faw-chips">' + Array.from(stato.found.keys()).sort().map(function (w) {
        return '<span class="faw-chip">' + CORE.escapeHtml(w) + '<i>' + (stato.found.get(w).p || 0) + "</i></span>";
      }).join("") + "</div></details>";
    var rematch = $("btn-rivincita");
    if (stato.solo) { rematch.textContent = "🔁 ANCORA UNA"; }
  }

  /**
   * Stato della rivincita aggiornato a ogni lettura del documento: il pulsante di
   * accettazione non deve dipendere dal render della classifica (che è deduplicato
   * e qui avrebbe nascosto la proposta arrivata dopo).
   */
  function renderRivincitaBox(data) {
    var box = $("box-rivincita");
    if (!box) return;
    var d = data && data.prossimaPartita;
    var daMe = data && data.prossimaPartitaCreataDa === stato.me;
    if (d && !daMe) {
      box.hidden = false;
      $("box-rivincita-testo").textContent = (data.prossimaPartitaCreataDa || "Un avversario") + " propone la rivincita.";
    } else if (d && daMe) {
      box.hidden = false;
      $("box-rivincita-testo").textContent = "Rivincita proposta: si entra quando gli altri accettano.";
    } else {
      box.hidden = true;
    }
    var btn = $("btn-rivincita");
    if (btn && d && daMe) btn.textContent = "⏳ RIVINCITA PROPOSTA";
  }
  function stat(v, k) { return '<div class="faw-stat"><span class="faw-stat__v">' + v + '</span><span class="faw-stat__k">' + k + "</span></div>"; }

  function rivincita() {
    if (stato.solo) { location.reload(); return; }
    if (!stato.busy("riv")) return;
    var proposta = (stato.data.prossimaPartita && stato.data.prossimaPartitaCreataDa === stato.me);
    if (proposta) { location.href = "index.html?matchId=" + stato.data.prossimaPartita; return; }
    stato.room.proposeRematch({
      giocatori: stato.data.partecipanti, durata: stato.durateMs,
      opzioni: { griglia: String(stato.size), mode: (stato.data.opzioni || {}).mode || "eventi", countdown: 5 },
      cfg: {}
    }).then(function (id) {
      CORE.toast("Rivincita proposta a " + (stato.data.partecipanti.length - 1) + " giocatori", "ok");
      $("btn-rivincita").textContent = "⏳ IN ATTESA…";
    }).catch(function () { CORE.toast("Rivincita non riuscita: riprova", "bad"); });
  }

  function accettaRivincita() {
    var id = stato.data && stato.data.prossimaPartita;
    if (!id) return;
    stato.room.acceptRematch().then(function () { location.href = "index.html?matchId=" + id; });
  }

  /* -------------------------------- watchdog ------------------------------- */

  function watchdog() {
    var d = stato.data;
    if (!d) return;
    if (d.stato === "pronto" && ora() >= (d.startAt || 0)) {
      if (!stato.inGioco) entraInGioco(d);
      if (!stato._passato) {
        stato._passato = true;
        NET.transact(stato.room.path, function (cur) {
          if (!cur || cur.stato !== "pronto" || (cur.startAt || 0) > ora()) return false;
          return { stato: "in_corso", iniziatoDa: stato.me };
        }).catch(function () { stato._passato = false; });
      }
    }
    if (d.stato === "in_corso" && ora() >= (d.endsAt || Infinity)) { if (!d.risultati) chiudiPartita(); }
    var gmap = ROOM.giocatoriMap(d);
    var t = ora();
    var inatt = Object.keys(gmap).filter(function (n) {
      return n !== stato.me && gmap[n].visto && t - gmap[n].visto > ROOM.IDLE_MS;
    });
    var vecchie = ((d.arena || {}).inattivi) || [];
    if (JSON.stringify(inatt) !== JSON.stringify(vecchie)) {
      NET.update(stato.room.path, { "arena.inattivi": inatt }).catch(function () {});
    }
    if (d.stato === "in_corso" && d.host && d.host !== stato.me) {
      var hv = (gmap[d.host] || {}).visto || 0;
      if (hv && t - hv > ROOM.IDLE_MS + 20000) stato.room.claimHost();
    }
    renderClassifica();
    renderFeed();
  }

  /* ------------------------------- solo mode ------------------------------- */

  function avviaSolo() {
    mostra("gioco");
    $("btn-torna").hidden = false;
    stato.t0 = ora();
    var data = { partecipanti: [stato.me], punteggi: {}, parole: {}, startAt: stato.t0, endsAt: stato.t0 + stato.durateMs, stato: "in_corso", arena: {} };
    stato.data = data;
    stato.inGioco = true;
    preparaGrigliaSolo();
    renderGriglia();
    renderPowerbar();
    avviaTicking();
    $("solo-note").hidden = false;
  }

  /* --------------------------------- init ---------------------------------- */

  function init() {
    CORE.initTheme();
    NET.init({ backend: "auto" });
    avvio();
    bindInput();
    $("btn-pronto").addEventListener("click", function () {
      var d = stato.data;
      if ((d.partecipanti || []).length < 2) {
        CORE.toast("Sei solo: invita un amico col link, oppure avvia tu dalla lobby", "warn", 3500);
        return;
      }
      var ioPronto = (d.pronti || []).indexOf(stato.me) >= 0;
      stato.room.markReady(!ioPronto).then(function () {
        return NET.get(stato.room.path);
      }).then(function (snap) { if (snap.exists) onStato(snap.data); })
        .catch(function () { CORE.toast("Non è stato possibile registrare il «pronto»: riprova", "error"); });
    });
    $("btn-avvia-subito").addEventListener("click", function () {
      stato.room.maybeStart({ forza: true, nome: stato.me }).then(function (ok) {
        if (ok) CORE.toast("Countdown avviato", "ok");
        else CORE.toast("Start non riuscito: la partita è già iniziata o non sei l'host", "warn");
      });
    });
    $("btn-esci-lobby").addEventListener("click", esci);
    $("btn-copia-invito").addEventListener("click", function () {
      var url = location.href;
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { CORE.toast("Link copiato: invialo a chi vuoi sfidare", "ok"); });
      else CORE.toast(url, "", 6000);
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-pw]"), function (b) {
      b.addEventListener("click", function () { attiva(b.getAttribute("data-pw")); });
    });
    bindCrea();
    $("btn-rivincita").addEventListener("click", rivincita);
    $("btn-accetta-rivincita").addEventListener("click", accettaRivincita);
    $("btn-nuova-solo").addEventListener("click", function () { location.href = "index.html"; });
    document.querySelectorAll("dialog.faw-dialog").forEach(function (d) {
      d.addEventListener("click", function (e) { if (e.target === d) CORE.closeDialog(d); });
      d.addEventListener("cancel", function (e) { e.preventDefault(); CORE.closeDialog(d); });
      d.querySelectorAll("[data-close]").forEach(function (b) { b.addEventListener("click", function () { CORE.closeDialog(d); }); });
    });
    global.addEventListener("pagehide", function () { if (stato.coda.length) { try { navigator.sendBeacon && navigator.sendBeacon; } catch (e) {} svuotaCoda(true); } });
    CORE.onVisible(function (vis) { if (vis && stato.room) { stato.room.maybeStart(); } });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  global.FAWArena = { stato: stato, svuotaCoda: svuotaCoda, tick: tick, finisci: finisci, renderClassifica: renderClassifica, invia: invia };
})(window);
