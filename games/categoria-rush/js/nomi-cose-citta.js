/**
 * Nomi, Cose, Città — dataset, schede e punteggi puri.
 * Variante FaW: 3/6 colonne, 50 s massimi, Stop + 10 s, punti 20/10/5/0.
 * Liste locali NON esaustive. Nessuna richiesta in rete per convalidare le parole.
 * Riferimenti e differenze rispetto al gioco su carta sono documentati in GAMES.md.
 */
(function (root, factory) {
  var mod = factory(root);
  if (typeof module === "object" && module.exports) module.exports = mod;
  if (root) root.FAWNcc = mod;
})(typeof window !== "undefined" ? window : globalThis, function (global) {
  "use strict";
  var CAT = global.FAWCategorie || (typeof require === "function" ? require("../../shared/faw-categorie.js") : null);
  var CORE = global.FAWCore || (typeof require === "function" ? require("../../shared/faw-core.js") : null);
  var MODE = "nomi-cose-citta";
  var CFG = { inputMs: 50000, stopMs: 10000, rivelaMs: 10000, roundMs: 60000, minRisposte: 2 };
  function unique(list) { return Array.from(new Set(list)).sort(); }
  function words(id) { return CAT.byId(id).risposte; }
  function merge(ids, extra) { return unique(ids.reduce(function (all, id) { return all.concat(words(id)); }, extra || [])); }
  function variants(ids) { return Object.assign.apply(Object, [{}].concat(ids.map(function (id) { return CAT.byId(id).varianti || {}; }))); }
  var CATEGORIE = [
    { id: "nomi", nome: "Nomi", hint: "Nomi di persona, maschili o femminili.", noDict: true,
      risposte: merge(["nomi_m", "nomi_f"], ["ada", "adamo", "adriano", "agata", "agnese", "aldo", "alessandra", "alfonso", "alfredo", "amelia", "angela", "angelo", "arianna", "arturo", "asia", "aurelio", "barbara", "bartolomeo", "bernardo", "bruno", "carlo", "caterina", "cesare", "claudia", "claudio", "corrado", "cosimo", "diana", "dina", "domenico", "dora", "doris", "egidio", "elisa", "ernesto", "ettore", "eugenio", "fabrizio", "fabiana", "fausto", "franca", "franco", "felice", "filippo", "fulvio", "gemma", "gina", "giovanna", "gloria", "guido", "ignazio", "isabella", "italo", "laila", "lea", "leandro", "leonardo", "lia", "lidia", "liliana", "linda", "livia", "luigi", "maddalena", "manuel", "manuela", "mario", "mirco", "mirko", "naomi", "natalia", "nello", "nina", "nino", "noemi", "nora", "olga", "olivia", "oriana", "orlando", "oscar", "ottavio", "pamela", "patrizio", "pierluigi", "rachele", "raffaele", "renato", "roberta", "romano", "rosario", "ruggero", "salvatore", "sandro", "sara", "saverio", "simonetta", "susanna", "tania", "teodoro", "tiziana", "tiziano", "ugo", "vanda", "vera", "walter", "yuri", "zaccaria", "zoe"]), varianti: {} },
    { id: "cose", nome: "Cose", hint: "Oggetti materiali: non animali, cibi o concetti.",
      risposte: merge(["casa", "ufficio", "trasporti"], ["accendino", "ago", "altalena", "anello", "antenna", "aquilone", "arco", "asciugamano", "asciugatrice", "ascia", "bambola", "bastone", "baule", "berretto", "bilancia", "binocolo", "boccia", "bottiglia", "bottone", "bracciale", "bullone", "cacciavite", "calza", "camicia", "cappello", "cappotto", "carrello", "casco", "cavatappi", "catena", "cesto", "chitarra", "chiave", "chiodo", "cintura", "coperta", "corda", "cornice", "cuscino", "dado", "disco", "drone", "elastico", "elica", "estintore", "faro", "fermaglio", "fischietto", "fisarmonica", "flauto", "forbice", "forchetta", "fotocamera", "frigorifero", "giacca", "gomma", "guanto", "imbuto", "interruttore", "laccio", "lampada", "lente", "lenzuolo", "libro", "lucchetto", "maglietta", "martello", "maschera", "medaglia", "microfono", "molla", "ombrello", "orecchino", "orologio", "pala", "pallone", "pantalone", "pattino", "pettine", "pianoforte", "pila", "pipa", "pistola", "poltrona", "portafoglio", "quaderno", "racchetta", "radio", "rasoio", "remo", "rete", "rubinetto", "ruota", "sacco", "sandalo", "scatola", "scarpa", "sciarpa", "scopa", "secchio", "sedia", "sega", "serratura", "siringa", "spada", "spugna", "tamburo", "tappo", "tazza", "tenda", "termometro", "torcia", "trapano", "trottola", "tubo", "valigia", "ventaglio", "ventilatore", "violino", "vite", "volante", "zaino", "zappa"]),
      varianti: Object.assign(variants(["casa", "ufficio", "trasporti"]), { "frigo": "frigorifero", "forbici": "forbice", "pantaloni": "pantalone", "scarpe": "scarpa", "sedie": "sedia", "penne": "penna", "matite": "matita", "quaderni": "quaderno", "bottiglie": "bottiglia", "occhiale": "occhiali" }) },
    { id: "citta", nome: "Città", hint: "Città italiane e straniere presenti nell’elenco.", noDict: true,
      risposte: merge(["citta"], ["abbiategrasso", "acireale", "acqui terme", "adria", "alba", "alessandria", "altamura", "amsterdam", "atene", "asolo", "asti", "bassano del grappa", "belluno", "berlino", "boston", "bruxelles", "bucarest", "budapest", "buenos aires", "caorle", "carpi", "castelfranco veneto", "cervia", "chioggia", "cittadella", "cividale del friuli", "conegliano", "copenaghen", "cortina d ampezzo", "dakar", "danzica", "delhi", "dolo", "domodossola", "dresda", "dubai", "dublino", "edimburgo", "empoli", "eraclea", "este", "faenza", "fano", "fidenza", "fiesole", "foligno", "formia", "francoforte", "gallipoli", "gela", "gerusalemme", "ginevra", "gubbio", "helsinki", "imola", "istanbul", "jakarta", "jesi", "jesolo", "johannesburg", "kiev", "kyoto", "las vegas", "lima", "lisbona", "londra", "los angeles", "madrid", "manchester", "manila", "marrakech", "marsiglia", "melbourne", "merano", "monaco di baviera", "montebelluna", "monza", "mosca", "nantes", "new york", "nizza", "oderzo", "osaka", "oslo", "ottawa", "oxford", "parigi", "pechino", "pontevedra", "portogruaro", "porto", "praga", "quebec", "reims", "rio de janeiro", "riva del garda", "rovereto", "rovigo", "sacile", "salisburgo", "san dona di piave", "san francisco", "san paolo", "seoul", "sesto san giovanni", "siviglia", "spoleto", "stoccolma", "sydney", "taipei", "tallinn", "teheran", "terni", "tokyo", "toronto", "urbino", "valencia", "varese", "varsavia", "viareggio", "vienna", "vigevano", "vittorio veneto", "volterra", "washington", "wellington", "zagabria", "zurigo"]),
      varianti: Object.assign(variants(["citta"]), { "newyork": "new york", "nyc": "new york", "paris": "parigi", "london": "londra", "beijing": "pechino", "kyiv": "kiev", "tokio": "tokyo", "venice": "venezia", "rio": "rio de janeiro" }) },
    Object.assign({}, CAT.byId("animali"), { hint: "Animali; le varianti previste contano come la stessa risposta." }),
    Object.assign({}, CAT.byId("mestieri"), { nome: "Mestieri", risposte: merge(["mestieri"], ["lattaio", "libraio", "liutaio", "lavapiatti", "logopedista", "macellaio", "musicista", "marinaio", "modellista", "operaio", "ottico", "panettiere", "pilota", "psicologo", "saldatore", "scultore", "tassista", "tecnico", "tappezziere", "restauratore", "ricercatore", "receptionist", "negoziante", "nutrizionista", "zoologo"]), hint: "Professioni; maschile e femminile previsti sono equivalenti." }),
    { id: "frutta", nome: "Frutta", hint: "Frutti comuni, non piatti o bevande.",
      risposte: ["albicocca", "amarena", "ananas", "anguria", "arancia", "avocado", "banana", "bergamotto", "cachi", "castagna", "cedro", "ciliegia", "clementina", "cocco", "corbezzolo", "dattero", "durian", "feijoa", "fico", "fico d india", "fragola", "giuggiola", "guava", "kiwi", "kumquat", "lampone", "lime", "limone", "litchi", "mandarancio", "mandarino", "mango", "mela", "melagrana", "melone", "mirtillo", "mora", "nespola", "noce", "nocciola", "papaya", "pera", "pesca", "pompelmo", "prugna", "ribes", "rambutan", "susina", "tamarindo", "uva", "uva spina", "visciola"],
      varianti: { "papaia": "papaya", "melograno": "melagrana", "kaki": "cachi", "caco": "cachi", "albicocche": "albicocca", "banane": "banana", "arance": "arancia", "ciliegie": "ciliegia", "fragole": "fragola", "mele": "mela", "pere": "pera", "pesche": "pesca", "prugne": "prugna", "susine": "susina", "limoni": "limone", "mandarini": "mandarino" } }
  ];
  // Non ereditare gli indici cache delle categorie copiate.
  CATEGORIE.forEach(function (c) { delete c.__idx; });
  function categorie(colonne, snapshot) { return CATEGORIE.slice(0, Number(colonne) === 3 ? 3 : 6).map(function (c) { return CAT.applicaOverlay(c, ((snapshot || {}).categorie || {})["ncc-" + c.id]); }); }
  function byId(id, snapshot) { return categorie(6, snapshot).find(function (c) { return c.id === id; }); }
  var lettersCache = new Map(), roundsCache = new Map();
  function lettere(colonne, snapshot) {
    var count = Number(colonne) === 3 ? 3 : 6, key = count + ":" + JSON.stringify(snapshot || null);
    if (!lettersCache.has(key)) {
      if (lettersCache.size > 64) lettersCache.clear();
      lettersCache.set(key, "ABCDEFGILMNOPRSTUVZ".split("").filter(function (l) {
        return categorie(count, snapshot).every(function (c) { return new Set(CAT.rispostePer(c, l).map(function (w) { return CAT.groupKey(w, c); })).size >= CFG.minRisposte; });
      }));
    }
    return lettersCache.get(key).slice();
  }
  function rounds(seed, count, colonne, snapshot) {
    var cats = categorie(colonne, snapshot), key = [seed, count, cats.length, JSON.stringify(snapshot || null)].join(":");
    if (roundsCache.has(key)) return roundsCache.get(key);
    var pool = lettere(colonne, snapshot), out = [], rng = CORE.rngFrom(seed + ":ncc");
    for (var i = 0; i < count && pool.length; i++) {
      var lettera = pool.splice(Math.floor(rng() * pool.length), 1)[0];
      out.push({ i: i, lettera: lettera, nome: "Nomi, Cose, Città", scheda: true, categorie: cats.map(function (c) { return c.id; }) });
    }
    if (roundsCache.size >= 64) roundsCache.clear();
    roundsCache.set(key, out);
    return out;
  }
  function pulisci(valori, combo) {
    var out = {};
    (combo.categorie || []).forEach(function (id) { out[id] = valori && typeof valori[id] === "string" ? valori[id].trim().slice(0, 80) : ""; });
    return out;
  }
  function valuta(valori, combo, snapshot) {
    var clean = pulisci(valori, combo), scheda = {}, errori = {}, valide = 0;
    combo.categorie.forEach(function (id) {
      var parola = clean[id];
      var v = parola ? CAT.valida(parola, byId(id, snapshot), combo.lettera) : { ok: false, motivo: "MANCANTE" };
      scheda[id] = { parola: v.normalizzata || CAT.norm(parola), canonica: v.canonical || CAT.norm(parola), ok: v.ok, motivo: v.ok ? null : v.motivo };
      if (v.ok) valide++; else if (parola) errori[id] = v.motivo;
    });
    return { valori: clean, scheda: scheda, valide: valide, completa: valide === combo.categorie.length, errori: errori };
  }
  function punteggi(risposte, combo, giocatori, snapshot) {
    var rivela = {}, punti = {}, dettagli = {};
    giocatori.forEach(function (nome) {
      var r = risposte[nome] || {}, v = valuta(r.valori || {}, combo, snapshot);
      punti[nome] = 0; dettagli[nome] = { categorie: {} };
      rivela[nome] = { scheda: v.scheda, valide: v.valide, uniche: 0, mancante: combo.categorie.length - v.valide, t: r.t || 0, parola: v.valide ? "Scheda" : null, ok: v.valide > 0 };
    });
    combo.categorie.forEach(function (id) {
      var validi = giocatori.filter(function (nome) { return rivela[nome].scheda[id].ok; });
      giocatori.forEach(function (nome) {
        var r = rivela[nome].scheda[id], altri = validi.filter(function (n) { return rivela[n].scheda[id].canonica === r.canonica; }).length;
        var p = !r.ok ? 0 : validi.length === 1 ? 20 : altri > 1 ? 5 : 10;
        var motivo = !r.ok ? r.motivo : p === 20 ? "ESCLUSIVA" : p === 10 ? "UNICA" : "CONDIVISA";
        r.punti = p; r.esito = motivo;
        if (r.ok && altri === 1) rivela[nome].uniche++;
        punti[nome] += p;
        dettagli[nome].categorie[id] = { punti: p, motivo: motivo };
      });
    });
    return { punti: punti, dettagli: dettagli, rivela: rivela };
  }
  return { MODE: MODE, CFG: CFG, categorie: categorie, byId: byId, lettere: lettere, rounds: rounds, pulisci: pulisci, valuta: valuta, punteggi: punteggi };
});
