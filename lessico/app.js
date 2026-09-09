(function () {
  "use strict";
  var L = window.FAWLessico, NET = window.FAWNet, W = window.FAWWords, C = window.FAWCategorie, CORE = window.FAWCore;
  var $ = function (id) { return document.getElementById(id); }, esc = CORE.escapeHtml;
  var me = CORE.user(), pub = L.snapshot(), verified = false, allRows = [], shown = [], page = 0, size = 60;
  var canonicalRows = null, canonicalCount = 0;
  var proposals = [], games = [], reviewPage = 0, stops = [], alive = true, timer, searchTimer, legacyEpoch = 0, voteId = null, dictLoading = null;
  var query = new URLSearchParams(location.search), baseGeneralRows = null, busy = false, busyVotes = new Set();
  var labels = { pending: "In attesa", published: "Pubblicata", rejected: "Rifiutata", expired: "Scaduta", superseded: "Superata" };
  var date = function (ts) { return new Date(ts).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }); };
  var fmt = function (n) { return n.toLocaleString("it-IT"); };
  function scope() { return $("ambito").value; }
  function message(id, text) { $(id).textContent = text; }
  function gameSelected() { return games.find(function (g) { return g.id === $("partita").value; }); }
  function filterRows() {
    var q = L.norm($("cerca").value, scope()), letter = $("lettera").value;
    shown = allRows.filter(function (r) { return (!q || r.parola.indexOf(q) >= 0 || r.canonica.indexOf(q) >= 0) && (!letter || r.parola.charAt(0).toUpperCase() === letter); });
    if (canonicalRows !== allRows) { canonicalRows = allRows; canonicalCount = new Set(allRows.map(function (r) { return r.canonica; })).size; }
    var groups = canonicalCount;
    message("conteggio", allRows.length ? fmt(shown.length) + " risultati · " + fmt(allRows.length) + " voci ammesse / " + fmt(groups) + " canoniche nella lista" : scope() === "dizionario" && !W.isDictionaryReady() ? "Corpus non ancora caricato." : "Nessuna voce ammessa in questa lista.");
    renderRows();
  }
  function renderRows() {
    var pages = Math.max(1, Math.ceil(shown.length / size)); page = Math.min(page, pages - 1);
    $("voci").innerHTML = shown.slice(page * size, (page + 1) * size).map(function (r) {
      return '<tr><td>' + esc(r.parola) + '</td><td>' + (r.canonica === r.parola ? 'Voce principale' : esc(r.canonica) + '<small>Variante</small>') + '</td><td>' + r.origine + '</td></tr>';
    }).join("");
    message("pagina", (page + 1) + " / " + pages); $("precedente").disabled = page === 0; $("successiva").disabled = page + 1 >= pages;
    $("esporta").disabled = !shown.length;
  }
  function catalog() {
    var s = L.definition(scope()), bucket = pub.categorie[scope()] || { extra: [], varianti: {} };
    message("scope-hint", s.gruppo + " · " + s.hint);
    $("dictionary-load").hidden = scope() !== "dizionario" || W.isDictionaryReady();
    if (scope() === "dizionario") {
      if (W.isDictionaryReady()) {
        W.setPublication(pub);
        if (!baseGeneralRows || baseGeneralRows.key !== JSON.stringify([pub.extra, pub.excluded])) {
          var extras = new Set(pub.extra);
          baseGeneralRows = { key: JSON.stringify([pub.extra, pub.excluded]), rows: Array.from(W.all()).sort().map(function (w) { return { parola: w, canonica: w, origine: extras.has(w) ? "Pubblicata" : "Base" }; }) };
        }
        allRows = baseGeneralRows.rows;
      } else allRows = [];
    } else {
      var c = L.category(scope(), pub), candidates = new Set(c.risposte.concat(Object.keys(c.varianti || {})).map(CORE.normText));
      allRows = Array.from(candidates).map(function (w) {
        var v = C.valida(w, c);
        return v.ok ? { parola: w, canonica: v.canonical, origine: bucket.extra.indexOf(w) >= 0 || Object.prototype.hasOwnProperty.call(bucket.varianti || {}, w) ? "Pubblicata" : "Base" } : null;
      }).filter(Boolean).sort(function (a,b) { return a.parola.localeCompare(b.parola, "it"); });
    }
    filterRows(); formState();
  }
  function loadDictionary() {
    if (dictLoading) return dictLoading;
    $("carica-dizionario").disabled = true; message("carica-dizionario", "Caricamento…");
    dictLoading = W.load({ urls: ["../dizionario.txt"] }).then(function () { if (alive) catalog(); }).finally(function () { dictLoading = null; $("carica-dizionario").disabled = false; message("carica-dizionario", "Carica il dizionario"); });
    return dictLoading;
  }
  function formState() {
    var general = scope() === "dizionario", alias = $("tipo").value === "alias";
    $("tipo").querySelector('option[value="alias"]').disabled = general;
    if (general && alias) { $("tipo").value = "extra"; alias = false; }
    $("canonica-field").hidden = !alias; $("canonica").required = alias;
    $("parola").minLength = general ? 4 : 3;
    $("invia-proposta").disabled = busy || !verified || !me || !$("partita").value || general && !W.isDictionaryReady();
    var g = gameSelected();
    message("elettori", g ? "Tutti devono approvare: " + L.members(g.data).join(" · ") : "Scegli un gruppo già formato nel portale. Nessuna auto-approvazione in solitaria.");
    message("identita", me ? "Stai contribuendo come " + me + ". Lista: " + L.definition(scope()).gruppo + " / " + L.definition(scope()).nome + (general && !W.isDictionaryReady() ? ". Carica prima il dizionario." : ".") : "Puoi consultare tutte le liste. Per proporre e votare, accedi dal portale.");
  }
  function exportCsv() {
    var quote = function (s) { return '"' + String(s).replace(/"/g, '""') + '"'; };
    var csv = '\ufefflista;voce;canonica;origine\r\n' + shown.map(function (r) { return [scope(), r.parola, r.canonica, r.origine].map(quote).join(';'); }).join('\r\n');
    var url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), a = document.createElement('a');
    a.href = url; a.download = 'faw-' + scope() + '-v' + pub.versione + '.csv'; a.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function renderProposals() {
    var now = NET.clock(), pending = $("filtro-stato").value === "pending";
    var filtered = proposals.filter(function (r) { return !pending || L.status(r.data, now) === "pending"; }).sort(function (a,b) { return b.data.creata - a.data.creata || a.id.localeCompare(b.id); });
    var pages = Math.max(1, Math.ceil(filtered.length / 12)); reviewPage = Math.min(reviewPage, pages - 1);
    message("review-info", !me ? "Accedi dal portale per consultare le revisioni del tuo gruppo." : filtered.length ? filtered.length + " proposte · voto definitivo, pubblicazione solo unanime." : "Nessuna proposta " + (pending ? "in attesa" : "nello storico") + " per il tuo gruppo.");
    $("proposte").innerHTML = filtered.slice(reviewPage * 12, (reviewPage + 1) * 12).map(function (r) {
      var p = r.data, state = L.status(p, now), d = L.definition(p.ambito), votes = p.voti || {}, canVote = state === "pending" && !Object.prototype.hasOwnProperty.call(votes, me) && !busyVotes.has(r.id);
      var yes = p.elettori.filter(function (n) { return votes[n] && votes[n].si; }).length;
      return '<article class="proposal" data-id="' + esc(r.id) + '"><span class="state">' + esc(labels[state] || state) + ' · ' + yes + '/' + p.elettori.length + ' sì</span>' +
        '<h3>' + (p.tipo === "exclude" ? "Escludi " : p.tipo === "alias" ? "Variante: " : "Aggiungi ") + esc(p.parola) + (p.canonica ? ' → ' + esc(p.canonica) : '') + '</h3><p>' + esc(d ? d.gruppo + " / " + d.nome : p.ambito) + ' · ' + esc(p.proponente) + '</p><p>' + esc(p.motivo) + '</p>' +
        (p.fonte && /^https?:\/\//i.test(p.fonte) ? '<p><a href="' + esc(p.fonte) + '" target="_blank" rel="noopener noreferrer">Consulta la fonte ↗</a></p>' : '') +
        '<ul class="votes">' + p.elettori.map(function (n) { var v = votes[n]; return '<li>' + esc(n) + ': ' + (v ? v.si ? 'sì' : 'no — ' + esc(v.motivo) : 'in attesa') + '</li>'; }).join('') + '</ul>' +
        '<p>Partita ' + esc(p.partita) + ' · ' + (state === "pending" ? 'Scade ' + date(p.scade) : state === "expired" ? 'Scaduta il ' + date(p.scade) : 'Chiusa ' + date(p.chiusa)) + '</p>' +
        (p.versionePubblicata ? '<p>Versione ' + p.versionePubblicata + ' · valida per le nuove partite</p>' : '') +
        '<details><summary>Traccia della decisione</summary><ul>' + (p.storico || []).map(function (e) { return '<li>' + date(e.quando) + ' · ' + esc(e.evento) + ' · ' + esc(e.da) + '</li>'; }).join('') + '</ul></details>' +
        (canVote ? '<div class="faw-btn-row"><button class="faw-btn faw-btn--primary" data-vote="yes">Approva</button><button class="faw-btn" data-vote="no">Rifiuta</button></div>' : '') + '</article>';
    }).join('');
    message("review-page", (reviewPage + 1) + " / " + pages); $("review-prev").disabled = reviewPage === 0; $("review-next").disabled = reviewPage + 1 >= pages;
  }
  async function doVote(id, yes, why) {
    if (busyVotes.has(id)) return;
    busyVotes.add(id); renderProposals();
    var outcome = "", target = "review-info";
    try {
      var row = proposals.find(function (p) { return p.id === id; });
      if (!row) throw new Error("Proposta non più disponibile. Aggiorna la pagina.");
      if (row.data.ambito === "dizionario" && !W.isDictionaryReady()) await loadDictionary();
      var result = await L.vote(id, me, yes, why, NET);
      if (result.data[L.COL + "/" + id]) row.data = result.data[L.COL + "/" + id];
      if (!yes) $("rifiuto").close();
      outcome = "Decisione registrata. Se la proposta era già chiusa, non viene modificata.";
    } catch (e) { target = yes ? "review-info" : "rifiuto-error"; outcome = "Voto non confermato: " + e.message + " Puoi riprovare."; }
    finally { busyVotes.delete(id); renderProposals(); message(target, outcome); }
  }
  function legacyList() {
    var g = gameSelected(), epoch = ++legacyEpoch; $("legacy-list").textContent = "";
    if (!g || g.data.gioco !== "ruzzle") { message("legacy-list", "Seleziona una partita Ruzzle nel modulo sopra."); return; }
    Promise.all(["proposte", "eliminazioni"].map(function (col) { return NET.list("partite/" + g.id + "/" + col, []); })).then(function (lists) {
      if (!alive || epoch !== legacyEpoch) return;
      var old = lists[0].concat(lists[1]);
      if (!old.length) { message("legacy-list", "Nessuna proposta precedente salvata per questa partita."); return; }
      $("legacy-list").innerHTML = old.slice(0, 100).map(function (r, i) { return '<p>' + esc(r.data.parola || r.id) + ' · ' + esc(r.data.proponente || "Autore non registrato") + ' <button class="faw-btn" data-legacy="' + i + '">Ripresenta</button></p>'; }).join('');
      $("legacy-list").onclick = function (e) { var b = e.target.closest("[data-legacy]"); if (!b) return; var p = old[Number(b.dataset.legacy)].data; $("ambito").value = "dizionario"; $("parola").value = p.parola || ""; $("tipo").value = p.tipo === "extra" ? "extra" : "exclude"; catalog(); $("proponi").scrollIntoView(); $("motivo").focus(); };
    }).catch(function () { if (epoch === legacyEpoch) message("legacy-list", "Archivio precedente non raggiungibile o non autorizzato. Nessun dato è stato cancellato."); });
  }
  async function refresh() {
    $("aggiorna").disabled = true;
    try {
      pub = await L.load(NET); verified = true; message("connessione", "Catalogo base " + L.BASE + " · pubblicazione " + pub.versione + ". Le partite conservano il lessico con cui sono iniziate.");
      if (!alive) return; catalog();
      if (me) {
        var list = await NET.list("partite", [{ field: "partecipanti", op: "array-contains", value: me }]);
        games = list.filter(function (r) { return ["ruzzle", "categoria-rush", "bomba-parole"].indexOf(r.data.gioco || "ruzzle") >= 0 && L.members(r.data).length >= 2 && L.members(r.data).length <= 8 && r.data.stato !== "annullata"; });
        games.sort(function (a,b) { return (b.data.creata || b.data.createdAt || 0) - (a.data.creata || a.data.createdAt || 0); });
        var selected = $("partita").value || query.get("matchId");
        $("partita").innerHTML = '<option value="">Seleziona il gruppo</option>' + games.map(function (g) { return '<option value="' + esc(g.id) + '">' + esc((g.data.gioco || "ruzzle") + " · " + g.id + " · " + L.members(g.data).join(", ")) + '</option>'; }).join('');
        if (games.some(function (g) { return g.id === selected; })) $("partita").value = selected;
        else if (query.get("matchId")) message("esito-proposta", "Partita indicata non disponibile tra i tuoi gruppi: scegline una qui sopra.");
        if (!games.length) message("esito-proposta", "Non hai ancora partite con un gruppo. Crea una sfida con almeno un amico dal portale; potrai tornare qui anche dopo la partita.");
        formState(); legacyList();
      }
    } catch (e) { verified = false; message("connessione", "Pubblicazioni non verificate: mostro il catalogo base o l’ultima lettura della pagina. Proposte disattivate. " + e.message); formState(); }
    finally { $("aggiorna").disabled = false; }
  }
  function cleanup() { alive = false; stops.forEach(function (s) { s(); }); stops = []; clearInterval(timer); clearTimeout(searchTimer); }
  function init() {
    CORE.initTheme(); NET.init({ backend: "auto" });
    var groups = {};
    L.SCOPES.forEach(function (s) { (groups[s.gruppo] || (groups[s.gruppo] = [])).push(s); });
    $("ambito").innerHTML = Object.keys(groups).map(function (g) { return '<optgroup label="' + esc(g) + '">' + groups[g].map(function (s) { return '<option value="' + s.id + '">' + esc(s.nome) + '</option>'; }).join('') + '</optgroup>'; }).join('');
    $("ambito").value = L.definition(query.get("ambito")) ? query.get("ambito") : "sprint-animali";
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach(function (l) { $("lettera").add(new Option(l,l)); });
    $("parola").value = (query.get("parola") || "").slice(0,40); if (["extra", "exclude", "alias"].includes(query.get("tipo"))) $("tipo").value = query.get("tipo");
    $("spunti").innerHTML = C.CREATIVE.map(function (c) { return '<li>' + esc(c.nome) + '</li>'; }).join('');
    $("tema").onclick = CORE.toggleTheme;
    $("ambito").onchange = function () { page = 0; $("cerca").value = ""; $("lettera").value = ""; catalog(); };
    $("cerca").oninput = function () { clearTimeout(searchTimer); searchTimer = setTimeout(function () { page = 0; filterRows(); }, 160); };
    $("lettera").onchange = function () { page = 0; filterRows(); };
    $("carica-dizionario").onclick = function () { loadDictionary().catch(function (e) { message("conteggio", e.message + " Puoi riprovare."); }); };
    $("precedente").onclick = function () { page--; renderRows(); }; $("successiva").onclick = function () { page++; renderRows(); }; $("esporta").onclick = exportCsv;
    $("tipo").onchange = formState; $("partita").onchange = function () { formState(); legacyList(); };
    $("filtro-stato").onchange = function () { reviewPage = 0; renderProposals(); };
    $("review-prev").onclick = function () { reviewPage--; renderProposals(); }; $("review-next").onclick = function () { reviewPage++; renderProposals(); };
    $("aggiorna").onclick = refresh;
    $("proposta-form").onsubmit = async function (event) {
      event.preventDefault(); if (busy || $("invia-proposta").disabled) return; busy = true; formState();
      try {
        var result = await L.create({ partita: $("partita").value, ambito: scope(), tipo: $("tipo").value, parola: $("parola").value, canonica: $("canonica").value, motivo: $("motivo").value, fonte: $("fonte").value }, me, NET);
        message("esito-proposta", result.created ? "Proposta inviata. Il tuo sì è registrato: attendiamo il resto del gruppo." : "Esiste già una proposta per questa voce, lista e partita. I voti precedenti non sono stati modificati: consulta lo storico.");
      } catch (e) { message("esito-proposta", "Non inviata: " + e.message); }
      finally { busy = false; formState(); }
    };
    $("proposte").onclick = function (e) {
      var b = e.target.closest("[data-vote]"); if (!b) return;
      var id = b.closest("[data-id]").dataset.id;
      if (b.dataset.vote === "yes") doVote(id, true, "");
      else { voteId = id; $("rifiuto-motivo").value = ""; message("rifiuto-error", ""); CORE.showDialog($("rifiuto")); }
    };
    $("annulla-rifiuto").onclick = function () { $("rifiuto").close(); };
    $("rifiuto-form").onsubmit = async function (e) { e.preventDefault(); $("conferma-rifiuto").disabled = true; await doVote(voteId, false, $("rifiuto-motivo").value); $("conferma-rifiuto").disabled = false; };
    catalog(); renderProposals(); refresh();
    if (me) {
      try { stops.push(NET.onCol(L.COL, [{ field: "elettori", op: "array-contains", value: me }], function (rows, meta) {
        if (!alive) return;
        if (meta && meta.error) { message("review-info", "Revisioni non disponibili: controlla connessione e permessi, poi aggiorna."); return; }
        proposals = rows; renderProposals();
      })); } catch (_) { message("review-info", "Revisioni non disponibili."); }
    }
    stops.push(NET.onDoc(L.PUB, function (data, meta) {
      if (!alive) return;
      if (meta && meta.error) { verified = false; formState(); message("connessione", "Aggiornamento del catalogo non disponibile: controlla connessione e permessi, poi aggiorna."); return; }
      pub = L.snapshot(data); verified = true; catalog();
      message("connessione", "Catalogo base " + L.BASE + " · pubblicazione " + pub.versione + ". Valida per le nuove partite.");
    }));
    timer = setInterval(renderProposals, 30000);
    fetch("copertura.json").then(function (r) { if (!r.ok) throw new Error(); return r.json(); }).then(function (d) {
      message("dict-size", fmt(d.dizionario)); $("copertura").innerHTML = d.categorie.map(function (c) { return '<tr><td>' + esc(c.gruppo + " / " + c.nome) + '</td><td>' + c.voci + ' / ' + c.canoniche + '</td><td>' + c.lettereConQuattro.split('').join(' · ') + '</td></tr>'; }).join('');
    }).catch(function () { message("dict-size", "—"); message("copertura", "Rapporto base non disponibile: i conteggi della lista selezionata restano consultabili."); });
    window.addEventListener("pagehide", cleanup); window.addEventListener("pageshow", function (e) { if (e.persisted) location.reload(); });
  }
  init();
})();
