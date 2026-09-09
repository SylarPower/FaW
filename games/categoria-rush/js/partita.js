/**
 * Rush — controller e viste. Le transizioni sono tutte in regole.js.
 * Allenamento e multiplayer consumano lo stesso documento e gli stessi reducer.
 * Il ticker anima il tempo; solo risposte, voti e confini di fase scrivono in rete.
 */
(function (global) {
  "use strict";
  var CORE = global.FAWCore, NET = global.FAWNet, ROOM = global.FAWRoom;
  var CAT = global.FAWCategorie, N = global.FAWNcc, R = global.FAWRushRules, CFG = R.CFG;
  var $ = function (id) { return document.getElementById(id); };
  var esc = CORE.escapeHtml;
  var ora = function () { return NET.clock(); };
  var setup = { durata: 120, giocatori: 2, mode: "classiche", colonne: 6 };
  var stato = {
    me: "", matchId: null, room: null, data: null, dataLocale: null, solo: false,
    rounds: [], idx: -1, fase: "attesa", modale: "classiche", inGioco: false,
    pending: null, pendingVote: null, pendingNext: null, reviewCat: null, reviewIdx: -1, serial: 0, closing: false, retryAt: 0,
    feedback: null, joining: false, screen: "boot"
  };
  var scheda = null;
  var timer = null, retryTimer = null, statusOff = null;
  var MOTIVI = {
    SCHEDA_NON_VALIDA: "Correggi i campi segnalati, oppure svuotali per una consegna parziale.",
    BOZZA_SUPERATA: "È già stata salvata una bozza più recente. Ricarica prima di consegnare.",
    VUOTO: "Scrivi una risposta.", CORTA: "Servono almeno 3 lettere.", LUNGA: "Massimo 40 caratteri.",
    CARATTERI: "Usa solo lettere, spazi, apostrofi o trattini. Niente numeri o simboli.",
    LETTERA: "La risposta deve iniziare con «{L}».",
    NON_CATEGORIA: "Non è nell’elenco di «{C}». Prova un’altra risposta: hai ancora tempo.",
    GIA_DATA: "Hai già usato questa risposta. Scegline un’altra.",
    CATEGORIA_SCONOSCIUTA: "Categoria non disponibile. Ricarica la pagina.",
    DIZIONARIO_ASSENTE: "Database categorie non caricato. Ricarica la pagina.",
    ROUND_SUPERATO: "Il round è cambiato. Questa risposta non è stata inviata nel nuovo round.",
    ROUND_GIA_CHIUSO: "Tempo scaduto: la risposta non è arrivata entro il round.",
    ROUND_GIA_PUNTEGGIATO: "Questo round è già concluso.",
    HAI_GIA_RISPOSTO: "La risposta di questo round è definitiva: vale quella già inviata.",
    COUNTDOWN_IN_CORSO: "Aspetta il via.", NON_PARTECIPANTE: "Non sei tra i giocatori di questa sala.",
    PARTITA_NON_IN_GIOCO: "La partita non è in corso.", PARTITA_NON_TROVATA: "Partita non trovata."
  };
  function messaggio(motivo, combo) {
    return (MOTIVI[motivo] || "Invio non riuscito. Riprova.").replace("{L}", (combo || {}).lettera || "?").replace("{C}", (combo || {}).nome || "questa categoria");
  }
  function text(id, value) { var n = $(id), v = String(value); if (n && n.textContent !== v) n.textContent = v; }
  function html(id, value) { var n = $(id); if (n && n._html !== value) { n.innerHTML = value; n._html = value; } }
  function show(screen) {
    if (stato.screen === screen && document.body.dataset.schermo === screen) return;
    ["boot", "crea", "lobby", "gioco", "risultati"].forEach(function (s) { $("schermo-" + s).hidden = s !== screen; });
    stato.screen = screen;
    global.scrollTo(0, 0);
    document.body.dataset.schermo = screen;
  }
  function errore(titolo, descrizione, retry) {
    stato.inGioco = false;
    show("boot");
    $("boot-spinner").hidden = true;
    text("boot-title", titolo); text("boot-msg", descrizione);
    $("btn-riprova").hidden = !retry;
  }
  function feedback(testo, ko) {
    stato.feedback = { round: stato.idx, testo: testo, ko: !!ko };
    text("feedback", testo);
    $("feedback").classList.toggle("is-ko", !!ko);
    $("inp-risposta").setAttribute("aria-invalid", String(!!ko));
  }
  function connesso(status) {
    $("conn").hidden = status === "online" || stato.solo;
    $("conn").querySelector(".t").textContent = "Connessione interrotta. Il tempo continua: l’invio vale solo se confermato entro il round.";
  }
  function attuale() { return stato.data ? R.fasePartita(stato.data, ora()) : null; }
  function risposte(d, i) { return (((d || {}).rush || {}).risposte || {})[i] || {}; }
  function mia(d, i) { return risposte(d, i)[stato.me]; }
  function membro(d) { return (d.partecipanti || []).indexOf(stato.me) >= 0; }

  /* -------------------------- sala / stato -------------------------- */
  function ricevi(d) {
    if (!d) return;
    stato.serial++;
    stato.data = d;
    if (stato.solo) stato.dataLocale = d;
    var conf = R.impostazioni(d);
    stato.rounds = conf.domande; stato.modale = conf.modale;
    stato.roundMs = conf.ciclo.roundMs; stato.inputMs = conf.ciclo.inputMs;
    stato.durataMs = conf.rounds * conf.ciclo.roundMs;
    stato.seed = (d.opzioni || {}).seed || d.seed;
    document.body.dataset.mode = stato.modale;
    if (d.stato === "annullata") { errore("Sfida annullata", "Questa sala è stata chiusa. Puoi creare un nuovo Rush dal portale."); return; }
    if (d.stato === "conclusa" || d.stato === "risultati") { renderRisultati(d); return; }
    var f = attuale();
    if (d.stato === "attesa" || (d.stato === "pronto" && f.fase === "attesa")) {
      stato.inGioco = false; show("lobby"); renderLobby(d); countdown(d);
    } else {
      stato.inGioco = true; show("gioco"); renderRound(d, f);
    }
    avanza();
  }

  function scrivi(mutate) {
    if (stato.solo) {
      var patch = mutate(stato.data);
      if (patch) ricevi(NET.applyPatch(stato.data, patch));
      return Promise.resolve({ applied: !!patch, data: stato.data });
    }
    var serial = stato.serial;
    return NET.transact(stato.room.path, mutate).then(function (res) {
      // Una risposta di transazione non deve riportare indietro uno snapshot più recente.
      if (res.applied && serial === stato.serial) ricevi(res.data);
      return res;
    });
  }

  function collegati() {
    if (stato.room) stato.room.stop();
    stato.joining = false;
    stato.room = ROOM.open({ matchId: stato.matchId, nome: stato.me, net: NET });
    stato.room.start({
      state: function (d) {
        if (d.gioco !== "categoria-rush") { errore("Questo invito non è per Rush", "Apri il gioco corretto dalla lista delle sfide."); return; }
        if (membro(d)) { ricevi(d); return; }
        if (stato.joining) return;
        if (ROOM.isStale(d) || ["attesa", "pronto", "in_corso"].indexOf(d.stato) < 0) { errore("Sala chiusa", "L’invito è scaduto o la partita è già terminata."); return; }
        if ((d.partecipanti || []).length >= (d.maxGiocatori || 8)) { errore("La sala è al completo", "Chiedi un nuovo invito al tuo amico."); return; }
        if (!CORE.user()) { errore("Accedi per entrare", "Torna al portale ed effettua l’accesso, poi riapri questo invito."); return; }
        stato.joining = true;
        stato.room.addPlayer(stato.me).then(function (res) {
          if (res.data && membro(res.data)) ricevi(res.data);
          else errore("Ingresso non riuscito", "La sala è piena o non è più aperta.");
        }).catch(function () { errore("Connessione non riuscita", "Non siamo riusciti a entrare nella sala.", true); })
          .finally(function () { stato.joining = false; });
      },
      gone: function () { errore("Invito non disponibile", "La sala è stata rimossa oppure il link non è corretto."); },
      error: function (code) { if (!stato.data) errore("Sala non raggiungibile", code === "permission-denied" ? "Firebase non consente l’accesso a questa sala. Torna al portale e riprova." : "Controlla la connessione e riprova.", true); },
      status: connesso
    });
    stato.room.startWatchdog(function () {
      if (!stato.data || !membro(stato.data)) return;
      avanza();
      var d = stato.data, visto = ((d.giocatori || {})[d.host] || {}).visto || 0;
      if (["attesa", "pronto", "in_corso"].indexOf(d.stato) >= 0 && d.host !== stato.me && ora() - visto > 45000) {
        stato.room.claimHost().catch(function () {});
      }
    }, 2500);
    startTimer();
  }

  function renderLobby(d) {
    var pronti = d.pronti || [], nomi = d.partecipanti || [], countdownOn = d.stato === "pronto";
    text("top-stato", "Sala d’attesa · " + nomi.length + " giocatori");
    text("lobby-count", pronti.length + "/" + nomi.length + " pronti");
    text("lobby-meta", stato.rounds.length + " round · " + (stato.modale === "creative" ? "Creativo · voto tra amici" : stato.modale === N.MODE ? "Nomi, Cose, Città · " + stato.rounds[0].categorie.length + " categorie" : "Sprint · lettera e categoria"));
    html("lobby-lista", nomi.map(function (n) {
      var pronto = pronti.indexOf(n) >= 0;
      return '<div class="faw-row"><span class="faw-avatar">' + esc(CORE.initials(n)) + '</span><span class="faw-row__main"><b class="faw-row__name">' + esc(n) + (n === stato.me ? " (tu)" : "") + '</b><small class="faw-row__meta">' + (d.host === n ? "Organizzatore" : "Giocatore") + '</small></span><span class="faw-badge ' + (pronto ? "faw-badge--ok" : "") + '">' + (pronto ? "Pronto ✓" : "In attesa") + '</span></div>';
    }).join(""));
    var io = pronti.indexOf(stato.me) >= 0;
    text("btn-pronto", io ? "Non sono pronto" : "Sono pronto");
    $("btn-pronto").setAttribute("aria-pressed", String(io));
    $("btn-pronto").disabled = countdownOn || !membro(d);
    $("btn-avvia-subito").hidden = d.host !== stato.me || countdownOn || nomi.length < 2;
    text("lobby-hint", nomi.length < 2 ? "Manca un avversario. Condividi l’invito: la sala non parte da sola." : "Tutti pronti? Si parte automaticamente. L’organizzatore può avviare anche chi è in attesa.");
  }
  function countdown(d) {
    var on = d.stato === "pronto";
    $("countdown").hidden = !on;
    if (on) text("countdown-num", Math.max(0, Math.ceil((d.startAt - ora()) / 1000)));
  }

  /* -------------------------- viste di gioco ------------------------- */
  function renderRound(d, f) {
    if (!f) return;
    var combo = stato.rounds[Math.max(0, f.indice)];
    if (!combo) return;
    var faseCambiata = stato.idx !== f.indice || stato.fase !== f.fase;
    if (stato.idx !== f.indice) {
      stato.idx = f.indice; stato.feedback = null;
      $("inp-risposta").value = ""; $("inp-risposta").setAttribute("aria-invalid", "false");
      text("feedback", "");
      if (stato.pending && stato.pending.roundIdx !== f.indice) { clearTimeout(retryTimer); stato.pending = null; }
      if (stato.pendingVote && stato.pendingVote.roundIdx !== f.indice) stato.pendingVote = null;
      if (stato.pendingNext && stato.pendingNext.roundIdx !== f.indice) stato.pendingNext = null;
      $("box-altre").open = false;
    }
    stato.fase = f.fase;
    document.body.dataset.phase = f.fase;
    text("top-stato", stato.solo ? "Allenamento · solo tu e le idee" : (d.partecipanti || []).length + " giocatori · in contemporanea");
    text("game-mode", stato.solo ? "ALLENAMENTO" : (stato.modale === "creative" ? "CREATIVO" : stato.modale === N.MODE ? "NOMI, COSE, CITTÀ" : "SPRINT"));
    text("round-n", (Math.max(0, f.indice) + 1) + "/" + f.rounds);
    html("round-progress", stato.rounds.map(function (_, i) { return '<span class="' + (i < f.indice ? "is-done" : i === f.indice ? "is-current" : "") + '"></span>'; }).join(""));
    text("round-lettera", combo.lettera || "✳");
    text("round-categoria", combo.nome);
    text("round-category-label", stato.modale === N.MODE ? "LA SCHEDA È" : "LA CATEGORIA È");
    text("round-aiuto", stato.modale === N.MODE ? "Una lettera, " + combo.categorie.length + " categorie. Completa la scheda e chiama lo Stop." : combo.lettera ? "Inizia con «" + combo.lettera + "». Almeno 3 lettere." : "Nessuna lettera obbligatoria. Sorprendi gli altri.");
    text("round-sr", "Round " + (Math.max(0, f.indice) + 1) + " di " + f.rounds + ". " + (combo.lettera ? "Lettera " + combo.lettera + ". " : "") + "Categoria: " + combo.nome + ". " + (f.fase === "voto" ? "Vota la tua risposta preferita." : f.fase === "rivela" ? "Consegne chiuse. Confrontiamo le risposte." : ""));
    $("solo-note").hidden = !stato.solo;
    $("score-guide").hidden = stato.modale !== "classiche";
    $("ncc-score-guide").hidden = stato.modale !== N.MODE;
    text("solo-note", stato.modale === N.MODE ? "Allenamento NCC: ogni risposta valida vale 20 punti. Consegna e prosegui al tuo ritmo." : "Allenamento Sprint. Le alternative si sbloccano dopo l’invio o a tempo scaduto.");
    $("late-note").hidden = !(((d.giocatori || {})[stato.me] || {}).entraInCorsa);
    document.querySelectorAll("[data-phase]").forEach(function (n) {
      if (!n.dataset.phase || n === document.body) return;
      if (n.dataset.phase === "voto") n.hidden = stato.modale !== "creative";
      if (n.dataset.phase === "rivela") n.textContent = (stato.modale === "creative" ? "03" : "02") + " Confronta";
      n.classList.toggle("is-active", n.dataset.phase === f.fase);
    });
    renderInput(d, f);
    scheda.render(d, f);
    renderRisposte(d, f);
    html("classifica", classificaHtml(R.classifica(d.punteggi || {}, (d.rush || {}).statistiche, { modale: stato.modale })));
    text("punti-solo", (d.punteggi || {})[stato.me] || 0);
    var inattivi = stato.solo ? [] : R.inattivi(d.partecipanti, (d.rush || {}).risposte, f.indice - 1);
    $("chip-inattivi").hidden = !inattivi.length;
    text("chip-inattivi", inattivi.join(", ") + " non sta rispondendo. La partita continua.");
    var alternative = stato.solo && stato.modale === "classiche" && combo.lettera && (mia(d, f.indice) || f.fase === "rivela");
    $("box-altre").hidden = !alternative;
    if (alternative) text("altre", CAT.rispostePer(CAT.byId(combo.categoria, stato.data.lessico), combo.lettera).join(" · "));
    renderTimer(f);
    if (faseCambiata) global.scrollTo(0, 0);
  }

  function renderInput(d, f) {
    var m = mia(d, f.indice), p = stato.pending && stato.pending.roundIdx === f.indice;
    $("frm-risposta").hidden = stato.modale === N.MODE;
    var timing = (((d.rush || {}).tempi || {})[f.indice] || {});
    var reason = timing.motivo === "tutti" ? "Tutti hanno consegnato: nessun secondo da aspettare."
      : timing.stopDa ? timing.stopDa + " ha dato lo Stop! Al massimo 10 secondi agli altri." : "";
    $("round-reason").hidden = !reason;
    text("round-reason", reason);
    var aperto = f.fase === "input" && membro(d);
    var input = $("inp-risposta"), btn = $("btn-invia");
    input.disabled = !aperto;
    input.readOnly = !!m || !!p;
    btn.disabled = !aperto || !!m || !!p;
    $("btn-passo").disabled = btn.disabled;
    text("btn-invia", p ? "Invio…" : m ? "Inviata ✓" : "Invia ↗");
    input.placeholder = f.fase === "attesa" ? "Si parte tra poco…" : !aperto ? "Tempo scaduto" : "La tua risposta…";
    $("frm-risposta").classList.toggle("is-lock", !aperto || !!m || !!p);
    $("frm-risposta").setAttribute("aria-busy", String(!!p));
    $("receipt").hidden = !m || stato.modale === N.MODE;
    if (m && stato.modale !== N.MODE) {
      if (input.value !== m.parola) input.value = m.parola;
      text("receipt", m.passo ? "✓ Hai passato. Zero punti, ma nessuna attesa inutile." : (stato.solo ? "✓ Accettata: " : "✓ Risposta inviata: ") + m.parola + ". " + (f.fase === "input" ? "I punti arrivano a fine round." : "Risposta definitiva."));
      stato.inviatoRound = f.indice;
    } else stato.inviatoRound = -1;
    var rows = risposte(d, f.indice), nomi = R.giocatoriRound(d, f.indice);
    var count = nomi.filter(function (n) { return !!rows[n]; }).length;
    text("round-avanzati", count + "/" + nomi.length);
    text("chip-stato", f.fase === "input" ? (m ? (stato.solo ? "Risposta acquisita" : "Aspettiamo gli altri") : p ? "In attesa di conferma" : "Tocca anche a te") : f.fase === "voto" ? "Scegli la tua preferita" : f.fase === "attesa" ? "Pronti al via" : "Confrontiamo le risposte");
    html("giocatori-stato", nomi.map(function (n) { return '<span class="rush-player ' + (rows[n] ? "is-ready" : "") + '">' + (rows[n] ? "✓ " : "· ") + esc(n === stato.me ? "Tu" : n) + '</span>'; }).join(""));
  }

  function renderTimer(f) {
    text("timer", CORE.fmtTime(Math.max(0, Math.ceil(f.entroMs / 1000))));
    text("timer-label", f.fase === "input" ? "Tempo rimasto" : f.fase === "voto" ? "Per votare" : f.fase === "attesa" ? "Si parte tra" : "Prossimo round");
    $("timer").classList.toggle("is-urgente", f.fase === "input" && f.entroMs <= 5000);
    var total = f.faseMs || 1;
    $("round-bar").style.transform = "scaleX(" + Math.max(0, Math.min(1, f.entroMs / total)) + ")";
  }

  function renderRisposte(d, f) {
    var i = f.fase === "input" ? f.indice - 1 : f.indice;
    var rush = d.rush || {}, es = (rush.punteggiRound || {})[i], dettagli = (rush.dettagliRound || {})[i] || {};
    var votazione = f.fase === "voto", combo = stato.rounds[i];
    $("rivela").hidden = i < 0 || (!es && !votazione && f.fase !== "rivela");
    $("box-voto").hidden = !votazione;
    $("ncc-review-tabs").hidden = stato.modale !== N.MODE || !es;
    $("box-avanti").hidden = f.fase !== "rivela" || !es;
    if ($("rivela").hidden) return;
    text("rivela-conta", "ROUND " + (i + 1) + (combo && combo.lettera ? " / " + combo.lettera + " · " + combo.nome : ""));
    text("rivela-title", votazione ? "Chi ti ha sorpreso?" : f.fase === "input" ? "Il round appena finito" : "Le vostre risposte");
    text("rivela-sub", stato.modale === N.MODE ? "20 solo tu · 10 diversa · 5 condivisa · 0 vuota o non valida. Scegli una categoria." : votazione ? "Vota un’altra risposta. Un solo voto, definitivo." : es ? "Velocità e originalità, punto per punto." : "Calcolo dei punti in corso…");
    var entries = (rush.rivela || {})[i] || risposte(d, i);
    renderAvanti(d, f);
    if (stato.modale === N.MODE && es) {
      if (stato.reviewIdx !== i) { stato.reviewIdx = i; stato.reviewCat = combo.categorie[0]; }
      html("ncc-review-tabs", combo.categorie.map(function (id) { return '<button class="faw-btn" type="button" data-categoria="' + id + '" aria-pressed="' + (stato.reviewCat === id) + '">' + esc(N.byId(id).nome) + '</button>'; }).join(""));
      html("rivela-lista", tabellaSchede(entries, R.giocatoriRound(d, i), stato.reviewCat));
      return;
    }
    html("rivela-lista", R.giocatoriRound(d, i).map(function (n) {
      var r = entries[n], det = dettagli[n] || {}, good = r && r.parola && r.ok !== false;
      var tag = !good ? "Nessuna risposta valida" : votazione ? "Da votare" : stato.modale === "creative" ? (det.voti || 0) + " voti" : det.condivisa === 1 ? "Unica ✳" : "In comune";
      var breakdown = es && good ? (stato.modale === "creative" ? (det.base || 0) + " partecipazione + " + (det.voti || 0) * CFG.puntiVoto + " voti" : (det.base || 0) + " base + " + (det.velocita || 0) + " velocità + " + (det.originalita || 0) + " originalità") : "";
      return '<div class="riv-riga ' + (n === stato.me ? "is-me" : "") + '"><p class="chi">' + esc(n) + (n === stato.me ? " · tu" : "") + '</p><p class="cosa ' + (good ? "" : "is-ko") + '">' + esc(good ? r.parola : r && r.motivo === "PASSO" ? "Passo" : "Tempo scaduto") + '</p><div class="riv-meta"><span>' + esc(tag) + '</span><b>' + (es ? "+" + (es[n] || 0) : "—") + '</b></div>' + (breakdown ? '<p class="riv-breakdown">' + esc(breakdown) + '</p>' : "") + '</div>';
    }).join(""));
    if (votazione) {
      var voto = ((rush.voti || {})[i] || {})[stato.me], locked = !!voto || !!stato.pendingVote;
      var candidati = R.giocatoriRound(d, i).filter(function (n) { return n !== stato.me && entries[n] && entries[n].parola && entries[n].ok !== false; });
      text("voto-hint", voto ? (voto.astensione ? "✓ Astensione registrata." : "✓ Hai votato " + voto.voto + ". Grazie!") : stato.pendingVote ? "Conferma del voto…" : candidati.length ? "Scegli chi merita il bonus, oppure astieniti. Tutti finiti? Avanti subito." : "Nessun’altra risposta da votare. Si prosegue automaticamente.");
      $("btn-astieni").disabled = locked || !candidati.length;
      html("voto-bottoni", candidati.map(function (n) { return '<button type="button" class="faw-btn" data-voto="' + esc(n) + '" aria-pressed="' + String(!!voto && voto.voto === n) + '"' + (locked ? " disabled" : "") + '>👏 ' + esc(n) + '</button>'; }).join(""));
    }
  }

  function ragioneNcc(r) {
    if (!r) return "Non compilata";
    return { ESCLUSIVA: "Solo tu", UNICA: "Diversa", CONDIVISA: "Condivisa", MANCANTE: "Non compilata", LETTERA: "Lettera errata", NON_CATEGORIA: "Fuori elenco", CORTA: "Troppo corta", LUNGA: "Troppo lunga", CARATTERI: "Caratteri non ammessi" }[r.esito] || "Non valida";
  }
  function tabellaSchede(entries, players, id) {
    return '<table class="ncc-table"><caption class="faw-sr">' + esc(N.byId(id).nome) + '</caption><thead><tr><th scope="col">Giocatore</th><th scope="col">Risposta</th><th scope="col">Punti</th></tr></thead><tbody>' + players.map(function (nome) {
      var cell = ((entries[nome] || {}).scheda || {})[id];
      return '<tr class="' + (nome === stato.me ? "is-me" : "") + '"><th scope="row">' + esc(nome === stato.me ? "Tu" : nome) + '</th><td>' + esc(cell && cell.parola || "—") + '<small>' + esc(ragioneNcc(cell)) + '</small></td><td><b>+' + (cell && cell.punti || 0) + '</b></td></tr>';
    }).join("") + '</tbody></table>';
  }
  function renderAvanti(d, f) {
    if (f.fase !== "rivela") return;
    var a = (((d.rush || {}).avanti || {})[f.indice] || {}), players = R.giocatoriRound(d, f.indice);
    $("btn-avanti").disabled = !!a[stato.me] || !!stato.pendingNext || players.indexOf(stato.me) < 0;
    text("btn-avanti", a[stato.me] ? "Pronto ✓" : stato.pendingNext ? "Conferma…" : f.indice === f.rounds - 1 ? "Pronto, risultati ↗" : "Pronto, avanti ↗");
    text("avanti-hint", players.filter(function (n) { return !!a[n]; }).length + "/" + players.length + " pronti. Si prosegue anche allo scadere.");
  }
  function avanti() {
    if (stato.pendingNext || !stato.data) return;
    var req = { roundIdx: stato.idx };
    if (!R.avantiPatch(stato.data, stato.me, req, ora())) return;
    stato.pendingNext = req; renderAvanti(stato.data, attuale());
    scrivi(function (cur) { return R.avantiPatch(cur, stato.me, req, ora()); })
      .catch(function () { CORE.toast("Conferma non riuscita. Il prossimo round partirà comunque.", "warn"); })
      .finally(function () { if (stato.pendingNext === req) stato.pendingNext = null; if (stato.inGioco) renderAvanti(stato.data, attuale()); });
  }

  function classificaHtml(c) {
    var rank = 1;
    return c.map(function (r, i) { if (i && (stato.modale !== N.MODE || r.punti !== c[i - 1].punti)) rank = i + 1; return '<li class="faw-rank ' + (r.nome === stato.me ? "is-me " : "") + ((i === 0 || stato.modale === N.MODE && r.punti === c[0].punti) && r.punti > 0 ? "is-top" : "") + '"><span class="n">' + rank + '</span><span class="nm">' + esc(r.nome) + (r.nome === stato.me ? " (tu)" : "") + '</span><span class="pw">' + r.uniche + ' uniche</span><span class="pt">' + r.punti + '</span></li>'; }).join("");
  }

  /* ------------------------ una risposta / un voto -------------------- */
  function invia(passo) {
    if (stato.pending || !stato.data) return;
    var f = attuale(), combo = stato.rounds[stato.idx];
    if (mia(stato.data, stato.idx)) { feedback(MOTIVI.HAI_GIA_RISPOSTO, true); return; }
    if (f.indice !== stato.idx) { feedback(MOTIVI.ROUND_SUPERATO, true); return; }
    var request = stato.modale === N.MODE ? scheda.payload() : { roundIdx: stato.idx, testo: $("inp-risposta").value.trim(), passo: passo === true };
    request.tentativi = 0;
    var local = R.rispostaPatch(stato.data, stato.me, request, ora());
    if (!local.ok) { feedback(messaggio(local.motivo, combo), true); if (local.errori) scheda.errors(local.errori); return; }
    feedback("", false);
    if (stato.solo) { ricevi(NET.applyPatch(stato.data, local.patch)); return; }
    stato.pending = request;
    renderInput(stato.data, f); scheda.render(stato.data, f);
    tentaInvio(request);
  }
  function tentaInvio(request) {
    if (stato.pending !== request) return;
    request.tentativi++;
    var motivo = null;
    scrivi(function (cur) {
      var result = R.rispostaPatch(cur, stato.me, request, ora());
      motivo = result.motivo;
      return result.ok ? result.patch : false;
    }).then(function (res) {
      if (stato.pending !== request) return;
      stato.pending = null;
      if (res.applied || (res.data && mia(res.data, request.roundIdx))) {
        if (stato.idx === request.roundIdx) feedback("", false);
      } else if (stato.idx === request.roundIdx) feedback(messaggio(motivo, stato.rounds[request.roundIdx]), true);
      if (stato.inGioco) renderRound(stato.data, attuale());
    }).catch(function (e) {
      if (stato.pending !== request) return;
      var f = attuale();
      var retry = request.tentativi < 3 && f.indice === request.roundIdx && f.fase === "input" && e.code !== "permission-denied";
      if (retry) {
        feedback("Invio in attesa di conferma. Riprovo " + request.tentativi + "/3: il tempo continua.", false);
        retryTimer = setTimeout(function () { tentaInvio(request); }, request.tentativi * 600);
      } else {
        stato.pending = null;
        if (f.indice === request.roundIdx) feedback("Invio non confermato. Controlla la connessione e riprova se c’è ancora tempo.", true);
        if (stato.inGioco) renderRound(stato.data, f);
      }
    });
  }
  function vota(nome, astieni) {
    if (stato.pendingVote || !stato.room) return;
    var request = { roundIdx: stato.idx, nome: nome, astieni: !!astieni };
    if (!R.votoPatch(stato.data, stato.me, request, ora())) return;
    stato.pendingVote = request;
    renderRisposte(stato.data, attuale());
    scrivi(function (cur) { return R.votoPatch(cur, stato.me, request, ora()); })
      .then(function (res) { if (!res.applied) CORE.toast("Voto già registrato o tempo scaduto.", "warn"); })
      .catch(function () { CORE.toast("Voto non confermato. Riprova se c’è tempo.", "warn"); })
      .finally(function () { if (stato.pendingVote === request) stato.pendingVote = null; if (stato.inGioco) renderRisposte(stato.data, attuale()); });
  }

  /* ------------------------- orologio / avanzamento ------------------- */
  function daAvanzare(d) {
    if (!d || !d.startAt || ["pronto", "in_corso", "chiusura"].indexOf(d.stato) < 0 || ora() < d.startAt) return false;
    if (d.stato === "pronto" || !(d.rush || {}).domande) return true;
    var f = attuale();
    if (f.fase === "finita") return true;
    if ((f.fase === "voto" || f.fase === "rivela") && !((((d.rush || {}).tempi || {})[f.indice] || {}).giocatori)) return true;
    if (f.fase === "input" && R.tuttiConsegnati(d, f.indice)) return true;
    if (f.fase === "voto" && R.tuttiVotato(d, f.indice)) return true;
    if (f.fase === "rivela" && R.tuttiAvanti(d, f.indice)) return true;
    return stato.rounds.some(function (_, i) { return !((d.rush || {}).punteggiRound || {})[i] && R.puoChiudere(d, i, { ora: ora() }); });
  }
  function avanza() {
    var d = stato.data;
    if (!daAvanzare(d) || stato.closing || ora() < stato.retryAt) return Promise.resolve(false);
    if (stato.solo) {
      var patch = R.avanza(d, ora());
      if (patch) ricevi(NET.applyPatch(d, patch));
      return Promise.resolve(!!patch);
    }
    if (!stato.room || !membro(d)) return Promise.resolve(false);
    stato.closing = true;
    return scrivi(function (cur) { return R.avanza(cur, ora()); })
      .catch(function () { stato.retryAt = ora() + 1500; return false; })
      .finally(function () { stato.closing = false; });
  }
  function startTimer() { if (!timer) timer = setInterval(tick, 150); }
  function tick() {
    var d = stato.data;
    if (!d || ["attesa", "pronto", "in_corso", "chiusura"].indexOf(d.stato) < 0) return;
    if (d.stato === "attesa") return;
    var f = attuale();
    if (stato.screen === "lobby") {
      countdown(d);
      if (f.fase !== "attesa") { stato.inGioco = true; show("gioco"); renderRound(d, f); }
    } else if (f.indice !== stato.idx || f.fase !== stato.fase) renderRound(d, f);
    else renderTimer(f);
    scheda.tick(f);
    avanza();
  }

  /* --------------------------- risultati / rivincita ----------------- */
  function renderRisultati(d) {
    stato.inGioco = false; stato.pending = null; stato.pendingNext = null; clearTimeout(retryTimer); scheda.stop();
    show("risultati"); text("top-stato", "Al traguardo");
    var c = (d.risultati || {}).classifica || R.classifica(d.punteggi, (d.rush || {}).statistiche, { modale: stato.modale });
    var es = (d.risultati || {}).esito || R.esito(c, { modale: stato.modale }), io = c.find(function (r) { return r.nome === stato.me; }) || {};
    text("ris-titolo", stato.solo ? "Allenamento finito!" : es.pareggio ? "Un Rush alla pari." : es.campione === stato.me ? "Questo Rush è tuo!" : "Che sfida!");
    text("ris-esito", stato.solo ? (io.punti || 0) + " punti. Pronto a sfidare gli amici?" : es.pareggio ? "Pareggio tra " + es.pari.join(" e ") : (es.campione || "—") + " vince con " + (c[0] || {}).punti + " punti.");
    html("ris-classifica", classificaHtml(c));
    var cells = stato.modale === N.MODE ? stato.rounds.length * stato.rounds[0].categorie.length : stato.rounds.length;
    var stats = [["Punti", io.punti || 0], ["Valide", (io.valide || 0) + "/" + cells], ["Uniche", io.uniche || 0], stato.modale === N.MODE ? ["Categorie", stato.rounds[0].categorie.length] : ["Tempo medio", io.tempoMedio == null ? "—" : (io.tempoMedio / 1000).toFixed(1) + " s"]];
    html("ris-stats", stats.map(function (s) { return '<div class="faw-stat"><span class="faw-stat__k">' + s[0] + '</span><b class="faw-stat__v">' + esc(String(s[1])) + '</b></div>'; }).join(""));
    var saved = (d.risultati || {}).secondiRisparmiati || 0;
    $("ris-tempo").hidden = !saved;
    text("ris-tempo", saved + " secondi di attesa risparmiati. Stessi round, più ritmo.");
    html("ris-rounds", stato.rounds.map(function (q, i) {
      var r = mia(d, i), punti = (((d.rush || {}).punteggiRound || {})[i] || {})[stato.me] || 0;
      if (stato.modale === N.MODE) {
        var entry = (((d.rush || {}).rivela || {})[i] || {})[stato.me] || {};
        return '<details class="ncc-history"><summary><span>Round ' + (i + 1) + ' · Lettera ' + esc(q.lettera) + '</span><b>+' + punti + ' ⌄</b></summary><table class="ncc-table"><caption class="faw-sr">La tua scheda</caption><thead><tr><th scope="col">Categoria</th><th scope="col">Risposta</th><th scope="col">Punti</th></tr></thead><tbody>' + q.categorie.map(function (id) {
          var cell = (entry.scheda || {})[id];
          return '<tr><th scope="row">' + esc(N.byId(id).nome) + '</th><td>' + esc(cell && cell.parola || "—") + '<small>' + esc(ragioneNcc(cell)) + '</small></td><td>+' + (cell && cell.punti || 0) + '</td></tr>';
        }).join("") + '</tbody></table></details>';
      }
      return '<div class="roundo"><span class="q">' + String(i + 1).padStart(2, "0") + '</span><div><small>' + esc((q.lettera ? q.lettera + " · " : "") + q.nome) + '</small><span class="w">' + esc(r ? r.passo ? "Passo" : r.parola : "Nessuna risposta") + '</span></div><b class="p">+' + punti + '</b></div>';
    }).join(""));
    $("box-rivincita").hidden = !d.prossimaPartita;
    $("btn-rivincita").disabled = false;
    text("btn-rivincita", d.prossimaPartita ? "Entra nella rivincita ↗" : stato.solo ? "Mi alleno ancora ↗" : "Un altro Rush ↗");
    if (d.prossimaPartita) text("box-rivincita-testo", (d.prossimaPartitaCreataDa === stato.me ? "Hai proposto" : d.prossimaPartitaCreataDa + " propone") + " la rivincita. " + (d.rivincitaAccettataDa || []).length + "/" + (d.partecipanti || []).length + " hanno accettato.");
  }
  function entraRivincita() {
    return stato.room.acceptRematch().then(function (id) { if (id) location.href = "index.html?matchId=" + encodeURIComponent(id); })
      .catch(function () { CORE.toast("Ingresso non riuscito. Riprova.", "warn"); });
  }
  function rivincita() {
    if (stato.solo) { avviaSolo(); return; }
    if (stato.data.prossimaPartita) { entraRivincita(); return; }
    $("btn-rivincita").disabled = true;
    stato.room.proposeRematch().then(function () { CORE.toast("Rivincita pronta. Entra e invita gli altri a seguirti.", "ok"); })
      .catch(function () { CORE.toast("Rivincita non riuscita. Riprova.", "warn"); })
      .finally(function () { $("btn-rivincita").disabled = false; });
  }

  /* ---------------------------- setup / allenamento ------------------- */
  function renderSetup() {
    document.querySelectorAll("#schermo-crea [data-seg]").forEach(function (seg) {
      seg.querySelectorAll("[data-v]").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.dataset.v === String(setup[seg.dataset.seg])));
        if (seg.dataset.seg === "durata") {
          var c = R.ciclo(setup.mode), n = R.numeroRound(Number(b.dataset.v) * 1000, c.roundMs);
          b.querySelector("small").textContent = n + " round";
        }
      });
    });
    var ciclo = R.ciclo(setup.mode), n = R.numeroRound(Number(setup.durata) * 1000, ciclo.roundMs);
    var ncc = setup.mode === N.MODE;
    text("crea-hint", n + (ncc ? " lettere · scheda da " + setup.colonne + " categorie. 50 s + 10 s di confronto al massimo. Stop: ultimi 10 s." : " round · fino a 26 s" + (setup.mode === "creative" ? " + 7 s di voto + 5 s di confronto." : " + 4 s di confronto.")) + " Tutti finiti? Si prosegue subito. Limite totale: " + CORE.fmtTime(n * ciclo.roundMs / 1000) + ".");
    $("opzioni-ncc").hidden = !ncc;
    text("ncc-categorie-hint", N.categorie(setup.colonne).map(function (c) { return c.nome; }).join(" · "));
    text("crea-eyebrow", ncc ? "IL GRANDE CLASSICO, A RITMO RUSH" : "UNA LETTERA. MILLE POSSIBILITÀ.");
    text("crea-descrizione", ncc ? "Nomi, cose, città: la stessa lettera su tutta la scheda. Compila, chiama lo Stop e confronta le tue idee con quelle degli amici." : "La categoria cambia, la sfida no: trova la risposta più originale prima che finisca il tempo.");
    text("stamp-number", ncc ? "50" : "26");
    html("rush-how", (ncc ? [["Compila la scheda", "La stessa lettera per nomi, cose, città e le altre categorie."], ["Chiama lo Stop", "Tutte valide? 10 secondi agli altri. Tutti consegnati? Si chiude subito."], ["Confronta le risposte", "20 / 10 / 5 / 0 punti per categoria. Conta l’idea, non la velocità."]]
      : setup.mode === "creative" ? [["Libera le idee", "Una domanda aperta, nessuna lettera obbligatoria."], ["Scegli la preferita", "Un voto per un’altra risposta, oppure ti astieni."], ["Pronti, avanti", "40 punti di partecipazione e 100 a voto. Tutti finiti? Si prosegue."]]
      : [["Trova una risposta", "Animali con la C? Scegli bene: non c’è solo cane."], ["Inviala in tempo", "Se è ammessa, è definitiva. Non la sai? Puoi passare."], ["Fai la differenza", "100 punti di base, fino a 40 per la velocità e 60 se sei l’unico."]]).map(function (h, i) { return '<div><span>0' + (i + 1) + '</span><p><b>' + h[0] + '</b>' + h[1] + '</p></div>'; }).join(""));
    $("btn-solo").disabled = setup.mode === "creative";
    text("solo-hint", setup.mode === "creative" ? "Il creativo richiede amici che votino. Per allenarti scegli Sprint o Nomi, Cose, Città." : "L’allenamento è locale: nessun invito, nessuna attesa.");
  }
  function creaStanza() {
    if (!CORE.user()) { CORE.toast("Accedi dal portale per invitare gli amici. Puoi già allenarti da solo.", "warn", 5000); return; }
    var btn = $("btn-crea-stanza"); if (btn.disabled) return; btn.disabled = true;
    var c = R.ciclo(setup.mode), n = R.numeroRound(Number(setup.durata) * 1000, c.roundMs);
    ROOM.create({ gioco: "categoria-rush", creator: stato.me, giocatori: [stato.me],
      maxGiocatori: Number(setup.giocatori), durata: n * c.roundMs,
      opzioni: { durata: String(setup.durata), mode: setup.mode, colonne: Number(setup.colonne), countdown: 3 }
    }).then(function (id) {
      stato.matchId = id;
      history.replaceState(null, "", "index.html?matchId=" + encodeURIComponent(id));
      collegati();
    }).catch(function () { CORE.toast("Sala non creata. Controlla la connessione e riprova.", "warn"); })
      .finally(function () { btn.disabled = false; });
  }
  var startingSolo = false;
  async function avviaSolo() {
    if (startingSolo) return; startingSolo = true;
    var lex;
    try { lex = await global.FAWLessico.loadSolo(NET); }
    finally { startingSolo = false; }
    if (stato.room) { stato.room.stop(); stato.room = null; }
    clearTimeout(retryTimer);
    stato.solo = true; stato.idx = -1; stato.pending = null; stato.pendingVote = null; stato.pendingNext = null;
    stato.retryAt = 0; stato.feedback = null;
    var mode = setup.mode === "creative" ? "classiche" : setup.mode, c = R.ciclo(mode);
    var n = R.numeroRound(Number(setup.durata) * 1000, c.roundMs);
    var start = ora() + 2000;
    var d = ROOM.buildMatch({ gioco: "categoria-rush", creator: stato.me, giocatori: [stato.me],
      durata: n * c.roundMs, opzioni: { mode: mode, colonne: Number(setup.colonne), durata: String(setup.durata) } });
    d.lessico = lex.snapshot;
    if (lex.origine !== "pubblicato") CORE.toast("Lessico: " + lex.origine, "warn", 6000);
    d.stato = "in_corso"; d.startAt = start; d.endsAt = start + d.durata;
    stato.t0 = start;
    connesso("online"); ricevi(d); startTimer();
  }
  function esci() {
    if (stato.inGioco && !global.confirm("Lasciare questo Rush? Il tempo continuerà per gli altri giocatori.")) return;
    var p = stato.room && stato.data && stato.data.stato === "attesa" ? stato.room.removePlayer(stato.me) : Promise.resolve();
    p.then(function () { location.href = stato.solo ? "index.html" : "../../index.html"; })
      .catch(function () { CORE.toast("Uscita non confermata. Riprova.", "warn"); });
  }
  function ready(force) {
    if (!stato.room || !stato.data) return;
    var btn = $(force ? "btn-avvia-subito" : "btn-pronto");
    if (btn.disabled) return; btn.disabled = true;
    var p = force ? stato.room.maybeStart({ forza: true, nome: stato.me }) : stato.room.markReady((stato.data.pronti || []).indexOf(stato.me) < 0);
    p.catch(function () { CORE.toast("Conferma non riuscita. Riprova.", "warn"); })
      .finally(function () { btn.disabled = stato.data.stato !== "attesa"; });
  }

  function init() {
    CORE.initTheme(); NET.init({ backend: "auto" });
    stato.me = CORE.user() || "OSPITE";
    if (["120", "180"].indexOf(CORE.qs("durata")) >= 0) setup.durata = Number(CORE.qs("durata"));
    if (["creative", N.MODE].indexOf(CORE.qs("mode")) >= 0) setup.mode = CORE.qs("mode");
    if (["3", "6"].indexOf(CORE.qs("colonne")) >= 0) setup.colonne = Number(CORE.qs("colonne"));
    scheda = global.FAWRushScheda({ state: function () { return stato; }, now: ora, write: scrivi, submit: invia, message: messaggio });
    document.body.addEventListener("click", function (e) {
      var b = e.target.closest("[data-action]");
      if (!b) return;
      if (b.dataset.action === "regole") CORE.showDialog($("dlg-regole"));
      if (b.dataset.action === "chiudi-dialogo") $("dlg-regole").close();
      if (b.dataset.action === "tema") CORE.toggleTheme();
      if (b.dataset.action === "esci") esci();
    });
    document.querySelectorAll("#schermo-crea [data-seg]").forEach(function (seg) { seg.addEventListener("click", function (e) {
      var b = e.target.closest("[data-v]"); if (!b) return; setup[seg.dataset.seg] = b.dataset.v; renderSetup();
    }); });
    $("frm-risposta").addEventListener("submit", function (e) { e.preventDefault(); invia(); });
    $("btn-passo").addEventListener("click", function () { invia(true); });
    $("btn-astieni").addEventListener("click", function () { vota(null, true); });
    $("btn-avanti").addEventListener("click", avanti);
    $("ncc-review-tabs").addEventListener("click", function (e) { var b = e.target.closest("[data-categoria]"); if (b) { stato.reviewCat = b.dataset.categoria; renderRisposte(stato.data, attuale()); } });
    $("inp-risposta").addEventListener("input", function () { if (!stato.pending) feedback("", false); });
    $("inp-risposta").addEventListener("focus", function () { CORE.keepInputVisible($("inp-risposta"), 200); });
    if (global.visualViewport) global.visualViewport.addEventListener("resize", function () { if (document.activeElement && document.activeElement.matches("#inp-risposta, #scheda-fields input")) CORE.keepInputVisible(document.activeElement, 60); });
    $("box-voto").addEventListener("click", function (e) { var b = e.target.closest("[data-voto]"); if (b && !b.disabled) vota(b.dataset.voto); });
    $("btn-crea-stanza").addEventListener("click", creaStanza);
    $("btn-solo").addEventListener("click", avviaSolo);
    $("btn-pronto").addEventListener("click", function () { ready(false); });
    $("btn-avvia-subito").addEventListener("click", function () { ready(true); });
    $("btn-esci-lobby").addEventListener("click", esci);
    $("btn-rivincita").addEventListener("click", rivincita);
    $("btn-accetta-rivincita").addEventListener("click", entraRivincita);
    $("btn-riprova").addEventListener("click", function () { location.reload(); });
    $("btn-copia-invito").addEventListener("click", function () {
      if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(function () { CORE.toast("Link copiato. Mandalo ai tuoi amici!", "ok"); }, function () { CORE.toast("Copia il link dalla barra degli indirizzi.", "warn"); });
      else CORE.toast("Copia il link dalla barra degli indirizzi.", "warn");
    });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) tick(); else scheda.flush(); });
    global.addEventListener("pagehide", function () {
      clearInterval(timer); clearTimeout(retryTimer); scheda.stop(); if (statusOff) statusOff(); if (stato.room) stato.room.close();
    });
    global.addEventListener("pageshow", function (e) { if (e.persisted) location.reload(); });
    statusOff = NET.status(connesso);
    renderSetup();
    stato.matchId = CORE.qs("matchId");
    if (stato.matchId) collegati();
    else if (CORE.qs("solo") === "1") avviaSolo();
    else show("crea");
  }
  global.FAWRush = { stato: stato, invia: invia, chiudiRound: avanza, renderRound: renderRound };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})(window);
