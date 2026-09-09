/**
 * FAWLessico — catalogo pubblicato, proposte e consenso del gruppo.
 * Nessun listener pubblica: solo l'ultimo voto, con proposta + catalogo nella
 * stessa transazione. Il documento proposta è anche lo storico permanente.
 * Identità cooperativa (nickname del portale), NON moderazione autenticata.
 */
(function (root, factory) {
  var mod = factory(root);
  if (typeof module === "object" && module.exports) module.exports = mod;
  if (root) root.FAWLessico = mod;
})(typeof window !== "undefined" ? window : globalThis, function (global) {
  "use strict";
  var BASE = "2026-09-09", PUB = "config/dizionario", COL = "lessico_proposte";
  var TTL = 7 * 86400000, LIMIT_BYTES = 700000;
  var SPRINT = ["citta", "animali", "cibo", "ufficio", "nomi_f", "nomi_m", "sport", "bevande", "strumenti", "mestieri", "casa", "trasporti"];
  var NCC = ["nomi", "cose", "citta", "animali", "mestieri", "frutta"];
  var LABELS = { citta: "Città", animali: "Animali", cibo: "Cibo", ufficio: "In ufficio", nomi_f: "Nomi femminili", nomi_m: "Nomi maschili", sport: "Sport", bevande: "Bevande", strumenti: "Strumenti musicali", mestieri: "Mestieri", casa: "In casa", trasporti: "Trasporti", nomi: "Nomi", cose: "Cose", frutta: "Frutta" };
  var SCOPES = [{ id: "dizionario", nome: "Dizionario · Ruzzle e Bomba", gruppo: "Generale", hint: "Parole italiane di almeno 4 lettere. Bomba ammette al massimo 24 lettere; Ruzzle richiede un percorso sulla griglia." }];
  SPRINT.forEach(function (id) { SCOPES.push({ id: "sprint-" + id, nome: LABELS[id], gruppo: "Sprint", hint: id === "citta" ? "Città italiane. I nomi composti sono ammessi quando elencati." : "Lista di gioco, non esaustiva. Le varianti dichiarate valgono come la stessa risposta." }); });
  NCC.forEach(function (id) { SCOPES.push({ id: "ncc-" + id, nome: LABELS[id], gruppo: "Nomi, Cose, Città", hint: id === "citta" ? "Città italiane e del mondo, con varianti italiane esplicite." : "Lista NCC, distinta dallo Sprint. Un alias condivide il punteggio della sua canonica." }); });
  var own = function (o, k) { return Object.prototype.hasOwnProperty.call(o || {}, k); };
  function error(code, message) { var e = new Error(message); e.code = code; throw e; }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function norm(word, scope) {
    var s = String(word || "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return scope === "dizionario" ? s.replace(/[^a-z]/g, "").toUpperCase() : (global.FAWCore ? global.FAWCore.normText(word) : s.replace(/[^a-z0-9'\s]/g, " ").replace(/'/g, "").replace(/\s+/g, " ").trim());
  }
  function wordInput(word, scope) {
    if (typeof word !== "string" || /[^a-zà-öø-ÿ\s'’\-]/i.test(word.trim())) error("PAROLA", "Usa solo lettere, spazi, apostrofi o trattini.");
    var w = norm(word, scope), min = scope === "dizionario" ? 4 : 3;
    if (w.length < min || w.length > 40) error("PAROLA", "La voce deve avere da " + min + " a 40 caratteri.");
    if (scope === "dizionario" && !/^[a-zà-öø-ÿ]+$/i.test(word.trim())) error("PAROLA", "Il dizionario generale ammette una sola parola, senza spazi o segni.");
    return w;
  }
  function definition(scope) { return SCOPES.find(function (s) { return s.id === scope; }); }
  function listWords(a, scope) {
    return Array.from(new Set((Array.isArray(a) ? a : []).filter(function (v) { return typeof v === "string"; }).map(function (w) { return norm(w, scope); }).filter(function (w) { return w.length >= (scope === "dizionario" ? 4 : 3) && w.length <= 40 && /^[A-Za-z ]+$/.test(w); }))).sort();
  }
  function snapshot(raw) {
    raw = raw || {};
    var out = { base: BASE, versione: Number.isSafeInteger(raw.versione) && raw.versione >= 0 ? raw.versione : 0,
      extra: listWords(raw.extra, "dizionario"), excluded: listWords(raw.excluded, "dizionario"), categorie: {} };
    SCOPES.slice(1).forEach(function (s) {
      var c = (raw.categorie || {})[s.id]; if (!c) return;
      var variants = {};
      Object.keys(c.varianti || {}).sort().forEach(function (w) {
        var a = listWords([w], s.id)[0], b = listWords([c.varianti[w]], s.id)[0];
        if (a && b && a !== b) variants[a] = b;
      });
      out.categorie[s.id] = { extra: listWords(c.extra, s.id), excluded: listWords(c.excluded, s.id), varianti: variants };
    });
    return out;
  }
  function forMatch(match, publication) {
    if (match && match.lessico) return snapshot(match.lessico);
    // Non importare pubblicazioni nuove in una partita precedente già iniziata.
    return snapshot(match && match.stato !== "attesa" ? match.dizionarioCustom : publication);
  }
  function category(scope, publication) {
    var id = scope.replace(/^(sprint|ncc)-/, "");
    var api = scope.indexOf("sprint-") === 0 ? global.FAWCategorie : global.FAWNcc;
    if (!api) error("CATALOGO", "Carica il catalogo delle categorie prima di proporre o votare.");
    return api.byId(id, publication);
  }
  function entry(scope, word, publication) {
    var pub = snapshot(publication), bucket = scope === "dizionario" ? pub : pub.categorie[scope] || { extra: [], excluded: [], varianti: {} };
    if (!definition(scope)) error("AMBITO", "Categoria sconosciuta.");
    if (scope === "dizionario") {
      if (!global.FAWWords || !global.FAWWords.isDictionaryReady()) error("CATALOGO", "Carica il dizionario prima di proporre o votare.");
      var present = (global.FAWWords.isBaseWord(word) || bucket.extra.indexOf(word) >= 0) && bucket.excluded.indexOf(word) < 0;
      return { presente: present, canonica: present ? word : "" };
    }
    var result = global.FAWCategorie.valida(word, category(scope, pub));
    return { presente: result.ok, canonica: result.ok ? result.canonical : "" };
  }
  function members(match) { return Array.from(new Set((match && match.partecipanti || []).filter(function (n) { return typeof n === "string" && n.length > 0; }))).sort(); }
  function member(match, user) {
    if (!match || ["categoria-rush", "bomba-parole", "ruzzle"].indexOf(match.gioco || "ruzzle") < 0 || members(match).indexOf(user) < 0) error("GRUPPO", "Devi appartenere al gruppo della partita selezionata.");
  }
  function proposalId(matchId, scope, word) {
    if (typeof matchId !== "string" || !matchId || matchId.length > 150 || /\//.test(matchId)) error("PARTITA", "Codice partita non valido.");
    if (!definition(scope)) error("AMBITO", "Categoria sconosciuta.");
    return [matchId, scope, norm(word, scope)].map(encodeURIComponent).join("~");
  }
  function targetState(pub, scope, word, canonical) {
    return JSON.stringify([entry(scope, word, pub), canonical ? entry(scope, canonical, pub) : null]);
  }
  function makeProposal(match, pub, user, form, now) {
    member(match, user);
    var electorate = members(match);
    if (electorate.length < 2 || electorate.length > 8) error("GRUPPO", "Servono da 2 a 8 partecipanti: non puoi auto-approvare una voce da solo.");
    if (match.stato === "annullata") error("GRUPPO", "Questa partita è stata annullata.");
    var scope = form.ambito, kind = form.tipo;
    if (!definition(scope) || ["extra", "alias", "exclude"].indexOf(kind) < 0) error("PROPOSTA", "Tipo di proposta o categoria non valido.");
    if (scope === "dizionario" && kind === "alias") error("PROPOSTA", "Gli alias sono disponibili solo per le categorie.");
    var word = wordInput(form.parola, scope), canonical = "";
    var why = String(form.motivo || "").trim(), source = String(form.fonte || "").trim();
    if (why.length < 8 || why.length > 500) error("MOTIVO", "Spiega la proposta in 8–500 caratteri.");
    if (source) { try { var url = new URL(source); if (!/^https?:$/.test(url.protocol) || url.username || url.password || source.length > 600) throw new Error(); } catch (_) { error("FONTE", "La fonte deve essere un indirizzo http o https, senza credenziali."); } }
    var state = entry(scope, word, pub);
    if (kind === "alias") {
      canonical = wordInput(form.canonica, scope);
      var target = entry(scope, canonical, pub);
      if (!target.presente) error("CANONICA", "La voce di riferimento deve già essere presente nella categoria.");
      canonical = target.canonica;
      if (canonical === word) error("CANONICA", "La variante deve essere diversa dalla voce di riferimento.");
      if (state.presente && state.canonica === canonical) error("PRESENTE", "Questa variante è già riconosciuta.");
    } else if (kind === "extra" && state.presente) error("PRESENTE", "Questa voce è già ammessa: non occorre aggiungerla.");
    else if (kind === "exclude" && !state.presente) error("ASSENTE", "La voce non è attualmente ammessa in questa lista.");
    var votes = {}; votes[user] = { si: true, quando: now, motivo: "Proponente" };
    return { schema: 1, partita: form.partita, ambito: scope, tipo: kind, parola: word, canonica: canonical,
      motivo: why, fonte: source, proponente: user, elettori: electorate, voti: votes, stato: "pending",
      creata: now, scade: now + TTL, prima: targetState(pub, scope, word, canonical), versioneIniziale: snapshot(pub).versione,
      storico: [{ evento: "proposta", da: user, quando: now }] };
  }
  function publish(raw, p, now) {
    var out = snapshot(raw), bucket;
    if (p.ambito === "dizionario") bucket = out;
    else bucket = out.categorie[p.ambito] || (out.categorie[p.ambito] = { extra: [], excluded: [], varianti: {} });
    var w = p.parola;
    bucket.extra = bucket.extra.filter(function (x) { return x !== w; });
    bucket.excluded = bucket.excluded.filter(function (x) { return x !== w; });
    if (bucket.varianti) delete bucket.varianti[w];
    if (p.tipo === "exclude") bucket.excluded.push(w);
    else if (p.tipo === "alias") bucket.varianti[w] = p.canonica;
    else bucket.extra.push(w);
    out = snapshot(out); out.versione++; out.aggiornato = now;
    // Preservare eventuali ambiti legacy/non gestiti da questa versione.
    out.categorie = Object.assign({}, (raw || {}).categorie || {}, out.categorie);
    if (p.ambito.indexOf("ncc-") === 0 && global.FAWNcc && (global.FAWNcc.lettere(3, out).length < 3 || global.FAWNcc.lettere(6, out).length < 3)) error("COPERTURA", "La modifica lascerebbe meno di 3 iniziali giocabili in NCC. Amplia prima le categorie carenti.");
    // Margine sul limite Firestore di 1 MiB. Gli altri campi legacy si conservano.
    if (new TextEncoder().encode(JSON.stringify(Object.assign({}, raw || {}, out))).length > LIMIT_BYTES) error("CAPACITA", "Catalogo vicino al limite: serve archiviare/partizionare prima di pubblicare altre voci.");
    return out;
  }
  function status(p, now) { return p.stato === "pending" && now >= p.scade ? "expired" : p.stato; }
  function voteProposal(match, raw, proposal, user, yes, why, now) {
    member(match, user);
    if (!proposal || !Array.isArray(proposal.elettori) || proposal.elettori.indexOf(user) < 0) error("ELETTORI", "Non fai parte del gruppo che approva questa proposta.");
    if (proposal.stato !== "pending") return { proposta: proposal, applied: false };
    var p = clone(proposal), event;
    if (now >= p.scade) { p.stato = "expired"; event = "scaduta"; }
    else if (members(match).join("\n") !== p.elettori.join("\n")) { p.stato = "superseded"; event = "gruppo cambiato"; }
    else {
      if (own(p.voti, user)) return { proposta: p, applied: false };
      if (typeof yes !== "boolean") error("VOTO", "Scegli Approva o Rifiuta.");
      why = String(why || "").trim();
      if (!yes && (why.length < 5 || why.length > 280)) error("MOTIVO", "Motiva il rifiuto in 5–280 caratteri.");
      p.voti[user] = { si: yes, quando: now, motivo: yes ? "" : why };
      p.storico.push({ evento: yes ? "approvazione" : "rifiuto", da: user, quando: now });
      if (!yes) { p.stato = "rejected"; event = "rifiutata"; }
      else if (targetState(raw, p.ambito, p.parola, p.canonica) !== p.prima) { p.stato = "superseded"; event = "voce già modificata"; }
      else if (p.elettori.every(function (n) { return own(p.voti, n) && p.voti[n].si === true; })) {
        var publication = publish(raw, p, now);
        p.stato = "published"; p.versionePubblicata = publication.versione; event = "pubblicata";
      }
    }
    if (event) { p.chiusa = now; p.esito = event; p.storico.push({ evento: event, da: user, quando: now }); }
    return { proposta: p, pubblicazione: publication, applied: true };
  }
  function netOr(n) { return n || global.FAWNet; }
  function create(form, user, net) {
    net = netOr(net); var id = proposalId(form.partita, form.ambito, form.parola), path = COL + "/" + id, game = "partite/" + form.partita;
    return net.transactMany([game, PUB, path], function (docs) {
      member(docs[game], user);
      if (docs[path]) return false; // doppio tap/retry non azzera consenso o storico
      var patches = {}; patches[path] = makeProposal(docs[game], docs[PUB], user, form, net.clock()); return patches;
    }).then(function (r) { return { id: id, created: r.applied, proposta: r.data[path] }; });
  }
  function vote(id, user, yes, why, net) {
    net = netOr(net); var path = COL + "/" + id;
    if (!id || /\//.test(id) || id.length > 1000) return Promise.reject(new Error("Proposta non valida"));
    return net.get(path).then(function (snap) {
      if (!snap.exists) error("ASSENTE", "Proposta non trovata.");
      var game = "partite/" + snap.data.partita;
      return net.transactMany([game, PUB, path], function (docs) {
        var result = voteProposal(docs[game], docs[PUB], docs[path], user, yes, why, net.clock());
        if (!result.applied) return false;
        var patches = {}; patches[path] = result.proposta;
        if (result.pubblicazione) patches[PUB] = result.pubblicazione;
        return patches;
      });
    });
  }
  function prepareMatch(id, user, net) {
    net = netOr(net); proposalId(id, "dizionario", "test"); var path = "partite/" + id;
    return net.transactMany([path, PUB], function (docs) {
      var m = docs[path]; if (!m) error("PARTITA", "Partita non trovata.");
      if (m.lessico || m.stato === "conclusa" || m.stato === "annullata") return false;
      member(m, user); var patch = {}; patch[path] = { lessico: forMatch(m, docs[PUB]) }; return patch;
    }).then(function (r) { return forMatch(r.data[path], r.data[PUB]); });
  }
  var publicationLoading = null, CACHE = "faw:lessico:pubblicato:v1";
  function load(net) {
    if (publicationLoading) return publicationLoading;
    var timer;
    var read = Promise.race([Promise.resolve().then(function () { return netOr(net).get(PUB); }), new Promise(function (_, reject) { timer = setTimeout(function () { reject(new Error("Catalogo non raggiungibile: riprova.")); }, 8000); })]);
    publicationLoading = read.then(function (r) {
      var s = snapshot(r.data); try { global.localStorage.setItem(CACHE, JSON.stringify(s)); } catch (_) {} return s;
    }).finally(function () { clearTimeout(timer); publicationLoading = null; });
    return publicationLoading;
  }
  function loadSolo(net) {
    return load(net).then(function (s) { return { snapshot: s, origine: "pubblicato" }; }).catch(function () {
      var s = null; try { s = JSON.parse(global.localStorage.getItem(CACHE)); } catch (_) {}
      return { snapshot: snapshot(s), origine: s ? "copia locale (non verificata online)" : "base (pubblicazioni non disponibili)" };
    });
  }
  return { BASE: BASE, PUB: PUB, COL: COL, TTL: TTL, SCOPES: SCOPES, norm: norm, snapshot: snapshot, forMatch: forMatch,
    definition: definition, category: category, entry: entry, members: members, proposalId: proposalId, makeProposal: makeProposal,
    voteProposal: voteProposal, status: status, create: create, vote: vote, prepareMatch: prepareMatch, load: load, loadSolo: loadSolo };
});
