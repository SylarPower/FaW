/**
 * FAWCategorie — dataset controllato di categorie e risposte ammesse (FaW).
 *
 * Perché il solo `dizionario.txt` non basta: il dizionario stabilisce se una
 * parola ESISTE, non se appartiene a una categoria. Nella modalità competitiva
 * la validazione è ammissione/esclusione dall'elenco chiuso della categoria,
 * locale e verificabile: nessun servizio AI, nessuna API a pagamento.
 *
 * Come si amplia: una stringa in più in `risposte` (o in `varianti`, che mappa
 * un sinonimo sulla forma canonica senza cambiare il punteggio) rende la
 * risposta accettata in modo deterministico; il generatore di round ricalcola
 * da solo le combinazioni lettera/categoria abbastanza ricche.
 *
 * Le liste sono in minuscolo, al singolare dove possibile, senza accenti
 * (la normalizzazione li rimuove); le parole multi-sezione sono ammesse.
 * `tests/unit/categorie.test.js` verifica che le risposte siano parole reali del
 * dizionario del progetto (categorie `no_dict`: nomi propri) e che ogni lettera
 * offerta abbia un numero minimo di risposte.
 *
 * File generato/ordinato: mantenere l'ordine alfabetico per lettura agevole.
 */
(function (root, factory) {
  var mod = factory(root);
  if (typeof module === "object" && module.exports) module.exports = mod;
  if (root) root.FAWCategorie = mod;
})(typeof window !== "undefined" ? window : globalThis, function (global) {
  "use strict";

  var CORE = global && global.FAWCore ? global.FAWCore : null;
  function norm(s) {
    if (CORE) return CORE.normText(s);
    return String(s == null ? "" : s).trim().toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9'\s]/g, " ").replace(/'/g, "")
      .replace(/\s+/g, " ").trim();
  }

  var CATEGORIE = [
    {
      id: "citta", nome: "Città italiane", tipo: "oggettiva", noDict: true,
      risposte: [
        "ancona", "aosta", "aquileia", "arezzo", "assisi", "avellino", "bari", "barletta", "benevento",
        "bergamo", "biella", "bologna", "bolzano", "brescia", "brindisi", "cagliari", "caltanissetta",
        "campobasso", "caserta", "catania", "catanzaro", "chieti", "como", "cosenza", "cremona", "crotone",
        "ferrara", "firenze", "foggia", "forli", "genova", "gorizia", "grosseto", "imperia", "lecce",
        "livorno", "lodi", "lucca", "macerata", "mantova", "massa", "matera", "messina", "milano", "modena",
        "napoli", "novara", "nuoro", "oristano", "padova", "palermo", "parma", "pavia", "perugia", "pesaro",
        "pescara", "piacenza", "pisa", "pordenone", "potenza", "prato", "ragusa", "ravenna", "rieti",
        "rimini", "roma", "salerno", "sassari", "savona", "siena", "siracusa", "sondrio", "taranto",
        "teramo", "torino", "trapani", "trento", "treviso", "trieste", "udine", "venezia", "verbania",
        "vercelli", "verona", "vicenza", "viterbo", "l aquila", "la spezia", "reggio emilia", "reggio calabria"
      ],
      varianti: { "l’aquila": "l aquila", "laquila": "l aquila" }
    },
    {
      id: "animali", nome: "Animali", tipo: "oggettiva",
      risposte: [
        "agnello", "airone", "alligatore", "alpaca", "anatra", "anguilla", "antilope", "ape", "aragosta",
        "asino", "avvoltoio", "balena", "barbagianni", "beccaccia", "bisonte", "blatta", "bue", "bufala",
        "cane", "capra", "cavalletta", "cavallo", "cicogna", "cigno", "cincia", "cinghiale", "cobra",
        "coleottero", "coniglio", "cornacchia", "corvo", "crotalo", "daino", "delfino", "dromedario",
        "elefante", "ermellino", "falco", "faraona", "fenicottero", "formica", "furetto", "gambero", "gatto",
        "gazza", "germano", "ghiro", "giaguaro", "giraffa", "grifone", "grillo", "gru", "ibis", "iena",
        "istrice", "leone", "lepre", "libellula", "lince", "lontra", "luccio", "lucertola", "lupo",
        "mantide", "merlo", "moffetta", "mosca", "moscerino", "mucca", "mulo", "nibbio", "nutria", "oca",
        "oritteropo", "orso", "ostrica", "otaria", "palombo", "pantera", "pernice", "picchio", "pipistrello",
        "ornitorinco", "rana", "pulce", "quaglia", "ragno", "ratto", "riccio", "rondine", "sardina", "scoiattolo",
        "serpente", "siluro", "stambecco", "struzzo", "tacchino", "tarantola", "tartaruga", "testuggine",
        "tigre", "topo", "toro", "tritone", "upupa", "usignolo", "vacca", "vigogna", "vipera", "vitello",
        "volpe", "zebra", "zibetto", "coccodrillo", "pappagallo", "pesce", "puma", "renna", "uccello"
      ],
      varianti: { "cani": "cane", "cavalli": "cavallo", "gatti": "gatto", "serpenti": "serpente", "leoni": "leone",
        "lepri": "lepre", "tigri": "tigre", "lupi": "lupo", "orsi": "orso", "volpi": "volpe", "oche": "oca",
        "mucche": "mucca", "vacche": "mucca", "vacca": "mucca", "topi": "topo", "pesci": "pesce", "uccelli": "uccello",
        "rane": "rana", "elefanti": "elefante", "giraffe": "giraffa", "zebre": "zebra", "conigli": "coniglio" }
    },
    {
      id: "cibo", nome: "Cibi e piatti", tipo: "oggettiva",
      risposte: [
        "agnello", "amatriciana", "anolini", "antipasto", "arancino", "arrosticini", "baccala", "bigne",
        "bistecca", "bollito", "brasato", "bresaola", "bruschetta", "burrata", "cannelloni", "caprese",
        "carbonara", "carpaccio", "cassata", "ciambella", "cicerchiata", "cotechino", "cotoletta", "dolce",
        "fegato", "flan", "focaccia", "frattaglie", "frittura", "fusilli", "garganelli", "gelato", "gnocchi",
        "lasagna", "lenticchie", "lombata", "melanzane", "minestra", "minestrone", "nocciole", "noci",
        "olio", "olive", "orata", "paccheri", "panettone", "panzanella", "pappardelle", "parmigiana",
        "pasta", "penne", "piadina", "pizza", "polenta", "prosciutto", "ragu", "ravioli", "ribollita",
        "ricotta", "riso", "risotto", "salmone", "salsiccia", "saltimbocca", "sartu", "seppie", "spaghetti",
        "tagliatelle", "tiramisu", "tonno", "torta", "tortellini", "tozzetti", "trippa", "uovo", "vellutata",
        "verdura", "vitello", "zeppola", "zucca", "zuppa"
      ],
      varianti: { "gelato al cioccolato": "gelato", "lasagne": "lasagna", "pizza margherita": "pizza", "spaghetti alla carbonara": "spaghetti", "uova": "uovo" }
    },
    {
      id: "ufficio", nome: "Oggetti da ufficio", tipo: "oggettiva",
      risposte: [
        "agenda", "archivio", "astuccio", "blocco", "busta", "calcolatrice", "cancelleria", "cartella",
        "cartoncino", "cartuccia", "clip", "colla", "copertina", "cornetta", "cuffie", "diario", "etichetta",
        "evidenziatore", "faldone", "fascicolo", "fax", "graffetta", "inchiostro", "laminatrice", "lavagna",
        "matita", "modulo", "monitor", "mouse", "nastro", "notebook", "occhiali", "penna", "pennarello",
        "portamine", "portapenne", "post it", "proiettore", "riga", "righello", "risma", "scanner",
        "schedario", "spillatrice", "squadra", "stampante", "taccuino", "tastiera", "telefono", "temperino",
        "webcam"
      ],
      varianti: { "biro": "penna", "blocco notes": "blocco", "calcolatrice elettronica": "calcolatrice", "nastro adesivo": "nastro", "penna biro": "penna", "post-it": "post it" }
    },
    {
      id: "nomi_f", nome: "Nomi propri femminili", tipo: "oggettiva", noDict: true,
      risposte: [
        "alessia", "alice", "anna", "antonia", "beatrice", "benedetta", "bianca", "camilla", "carla",
        "chiara", "clara", "costanza", "cristina", "daniela", "deborah", "donatella", "elena", "elisabetta",
        "emanuela", "eva", "flora", "francesca", "giorgia", "giovanna", "giulia", "grazia", "ilaria",
        "irene", "iris", "laura", "lucia", "ludovica", "luigia", "maria", "marta", "martina", "michela",
        "monica", "nadia", "nicole", "nicoletta", "paola", "patrizia", "perla", "rita", "rosa", "serena",
        "silvia", "sofia", "stefania", "teresa", "valentina", "veronica", "virginia", "vittoria", "zaira"
      ],
      varianti: { "elisa": "elisabetta", "giuli": "giulia", "mary": "maria", "sophie": "sofia" }
    },
    {
      id: "nomi_m", nome: "Nomi propri maschili", tipo: "oggettiva", noDict: true,
      risposte: [
        "alberto", "alessandro", "andrea", "antonio", "danilo", "dario", "davide", "diego", "edoardo",
        "elia", "emanuele", "emilio", "enzo", "fabio", "federico", "flavio", "francesco", "gabriele",
        "gianluca", "giorgio", "giovanni", "giuseppe", "ivan", "lorenzo", "luca", "luciano", "marcello",
        "marco", "matteo", "mattia", "maurizio", "michele", "nicola", "nicolo", "paolo", "pasquale",
        "pietro", "riccardo", "roberto", "samuele", "sergio", "simone", "stefano", "tommaso", "ubaldo",
        "umberto", "valerio", "vincenzo", "vittorio"
      ],
      varianti: { "alex": "alessandro", "frank": "francesco", "luki": "luca", "mike": "michele" }
    },
    {
      id: "sport", nome: "Sport", tipo: "oggettiva",
      risposte: [
        "arrampicata", "atletica", "badminton", "baseball", "basket", "beach volley", "bob", "bowling",
        "calcio", "canoa", "canottaggio", "ciclismo", "corsa", "dama", "equitazione", "ginnastica", "golf",
        "judo", "kart", "kayak", "kitesurf", "lotta", "maratona", "nuoto", "orientamento", "padel",
        "pallacanestro", "pallanuoto", "pallavolo", "pentathlon", "pesistica", "ping pong", "podismo",
        "polo", "rafting", "rugby", "scherma", "sci", "snowboard", "surf", "taekwondo", "tennis",
        "tiro con l arco", "triathlon", "tuffi", "vela", "voga", "waterpolo", "yoga", "zumba"
      ],
      varianti: { "basket ball": "basket", "pallacanestro": "basket", "waterpolo": "pallanuoto", "calcio a cinque": "calcio", "tennis tavolo": "ping pong", "volley": "pallavolo" }
    },
    {
      id: "bevande", nome: "Bevande", tipo: "oggettiva",
      risposte: [
        "acqua", "amaro", "anice", "aperitivo", "aranciata", "birra", "bitter", "bollicine", "brodo",
        "caffe", "caffelatte", "chinotto", "cioccolata", "cocktail", "cordiale", "frappe", "frullato", "gin",
        "granita", "grog", "idromele", "infuso", "lambrusco", "latte", "limonata", "liquore", "malto",
        "matcha", "mirto", "mosto", "orzata", "prosecco", "punch", "sangria", "sidro",
        "spremuta", "spritz", "spumante", "succo", "tisana", "vermouth", "vino", "vodka", "whisky",
        "zabaione"
      ],
      varianti: { "acqua frizzante": "acqua", "aranciata rossa": "aranciata", "birra bionda": "birra", "caffe espresso": "caffe" }
    },
    {
      id: "strumenti", nome: "Strumenti musicali", tipo: "oggettiva",
      risposte: [
        "armonica", "arpa", "banjo", "basso", "batteria", "campana", "celesta", "chitarra", "clarinetto",
        "contrabbasso", "cornamusa", "corno", "fagotto", "fisarmonica", "flauto", "gong", "grancassa",
        "liuto", "mandolino", "maracas", "oboe", "organetto", "organo", "pianoforte", "saxofono", "tamburo",
        "timpano", "tromba", "trombone", "tuba", "ukulele", "viola", "violino", "violoncello", "xilofono",
        "zampogna"
      ],
      varianti: { "basso elettrico": "basso", "chitarra elettrica": "chitarra", "piano": "pianoforte", "sax": "saxofono" }
    },
    {
      id: "mestieri", nome: "Mestieri e professioni", tipo: "oggettiva",
      risposte: [
        "architetto", "avvocato", "badante", "bancario", "bibliotecario", "bidello", "cameriere",
        "carpentiere", "commercialista", "commesso", "contadino", "cuoco", "dentista", "disegnatore",
        "elettricista", "fabbro", "falegname", "farmacista", "fiorista", "fotografo", "geometra",
        "giardiniere", "giornalista", "idraulico", "impiegato", "infermiere", "ingegnere", "magazziniere",
        "maestro", "medico", "meccanico", "muratore", "notaio", "ostetrica", "parrucchiere", "pasticciere", "pittore",
        "poliziotto", "postino", "programmatore", "sarta", "segretaria", "sindacalista", "tagliapietre",
        "traduttore", "vetraio", "vigile", "zappatore"
      ],
      varianti: { "avvocata": "avvocato", "infermiera": "infermiere", "maestra": "maestro", "cameriera": "cameriere", "cuoca": "cuoco", "dottoressa": "medico", "dev": "programmatore", "developer": "programmatore", "impiegata": "impiegato", "sarto": "sarta" }
    },
    {
      id: "casa", nome: "Oggetti di casa", tipo: "oggettiva",
      risposte: [
        "armadio", "aspirapolvere", "bacinella", "barattolo", "biancheria", "bicchiere", "candela",
        "cassetta", "cassettiera", "comodino", "cucchiaio", "detersivo", "divano", "ferro da stiro", "forno",
        "frigo", "gruccia", "innaffiatoio", "lampadario", "lavandino", "lavatrice", "letto", "mestolo",
        "mobile", "pentola", "piatto", "quadro", "scrivania", "sgabello", "spazzola", "specchio", "stendino",
        "tappeto", "tavolo", "televisore", "tovaglia", "vaso", "zanzariera"
      ],
      varianti: { "divano letto": "divano", "ferro": "ferro da stiro", "letto singolo": "letto", "tv": "televisore" }
    },
    {
      id: "trasporti", nome: "Mezzi di trasporto", tipo: "oggettiva",
      risposte: [
        "aereo", "autobus", "autocarro", "automobile", "barca", "barcone", "bici", "bicicletta", "camion",
        "carro", "gommone", "jet", "kayak", "monopattino", "motobarca", "motocicletta", "nave", "quad",
        "roulotte", "scafo", "slitta", "sommergibile", "tram", "trattore", "treno", "triciclo", "veicolo",
        "yacht", "zattera"
      ],
      varianti: { "bus": "autobus", "bici": "bicicletta", "auto": "automobile", "macchina": "automobile", "macchina a noleggio": "automobile", "moto": "motocicletta" }
    }  ];

  /** Categorie creative: non validate sul dizionario, votazione rapida tra pari. */
  var CREATIVE = [
    { id: "scusa", nome: "Una scusa per saltare una riunione", tipo: "votazione", min: 3 },
    { id: "collega", nome: "Un collega raccontato con una parola", tipo: "votazione", min: 3 },
    { id: "scrivania", nome: "Una cosa assurda trovata su una scrivania", tipo: "votazione", min: 3 },
    { id: "mensa", nome: "Il peggio che si può mangiare in mensa", tipo: "votazione", min: 3 },
    { id: "fuga", nome: "Una meta per il pranzo fuori del team", tipo: "votazione", min: 3 }  ];

  var aggiunte = global.FAWCategorieAggiunte || (typeof require === "function" ? require("./faw-categorie-aggiunte.js") : {});
  CATEGORIE.forEach(function (c) { c.risposte = Array.from(new Set(c.risposte.concat(aggiunte[c.id] || []))).sort(); });
  Object.assign(CATEGORIE.find(function (c) { return c.id === "mestieri"; }).varianti, {
    "commessa": "commesso", "contadina": "contadino", "poliziotta": "poliziotto", "pasticcere": "pasticciere",
    "attrice": "attore", "autrice": "scrittore", "dottore": "medico", "segretario": "segretaria",
    "biologa": "biologo", "psicologa": "psicologo", "veterinaria": "veterinario", "fotografa": "fotografo"
  });
  var nuoviAlias = {
    cibo: { melanzane: "melanzana", lenticchie: "lenticchia", nocciole: "nocciola", noci: "noce", olive: "oliva", tortellini: "tortellino" },
    bevande: { vermut: "vermouth" }, strumenti: { sassofono: "saxofono", cembalo: "clavicembalo", bassotuba: "tuba" },
    ufficio: { cucitrice: "spillatrice", temperino: "temperamatite", riga: "righello" },
    mestieri: { agricoltore: "contadino", fornaio: "panettiere" }
  };
  CATEGORIE.forEach(function (c) { Object.assign(c.varianti, nuoviAlias[c.id] || {}); });
  delete CATEGORIE.find(function (c) { return c.id === "casa"; }).varianti.tv; // minimo di gioco: 3 lettere
  // Overlay pubblicati: oggetti nuovi, senza modificare i dataset base o altre
  // partite. Escludere una canonica esclude anche i suoi alias, non li resuscita.
  var overlayCache = new Map();
  function applicaOverlay(base, patch) {
    if (!base || !patch || !(patch.extra || []).length && !(patch.excluded || []).length && !Object.keys(patch.varianti || {}).length) return base;
    var key = base.id + ":" + JSON.stringify([base.risposte, base.varianti, patch]);
    if (overlayCache.has(key)) return overlayCache.get(key);
    var idx = Object.assign(Object.create(null), indice(base));
    (patch.extra || []).forEach(function (w) { idx[norm(w)] = idx[norm(w)] || norm(w); });
    Object.keys(patch.varianti || {}).forEach(function (w) {
      var target = norm(patch.varianti[w]);
      if (Object.prototype.hasOwnProperty.call(idx, target)) idx[norm(w)] = idx[target];
    });
    var excluded = new Set((patch.excluded || []).map(norm));
    Object.keys(idx).forEach(function (w) { if (excluded.has(w) || excluded.has(idx[w])) delete idx[w]; });
    var out = Object.assign({}, base, { risposte: Array.from(new Set(Object.values(idx))), varianti: {}, __idx: idx });
    Object.keys(idx).forEach(function (w) { if (w !== idx[w]) out.varianti[w] = idx[w]; });
    if (overlayCache.size >= 96) overlayCache.clear();
    overlayCache.set(key, out); return out;
  }
  function categorie(snapshot) { return CATEGORIE.map(function (c) { return applicaOverlay(c, ((snapshot || {}).categorie || {})["sprint-" + c.id]); }); }

  /* --------------------------------- indici -------------------------------- */

  function indice(categoria) {
    if (categoria.__idx) return categoria.__idx;
    var idx = Object.create(null);
    (categoria.risposte || []).forEach(function (r) { idx[norm(r)] = norm(r); });
    Object.keys(categoria.varianti || {}).forEach(function (v) {
      var canonical = norm(categoria.varianti[v]);
      if (idx[canonical]) idx[norm(v)] = canonical;
    });
    categoria.__idx = idx;
    return idx;
  }

  function rispostePer(categoria, lettera) {
    if (!categoria) return [];
    var l = norm(lettera).charAt(0);
    return Object.keys(indice(categoria)).filter(function (r) { return r.charAt(0) === l && r.length >= 3; });
  }

  var comboCache = new Map();
  function comboDisponibili(opts) {
    opts = opts || {};
    var min = opts.min == null ? 4 : opts.min, prefer = opts.prefer == null ? 8 : opts.prefer;
    var key = min + ":" + prefer + ":" + JSON.stringify(opts.lessico || null);
    if (comboCache.has(key)) return comboCache.get(key).slice();
    var out = [];
    categorie(opts.lessico).forEach(function (c) {
      var idx = indice(c);
      for (var code = 97; code <= 122; code++) {
        var l = String.fromCharCode(code);
        // Quattro sinonimi dello stesso oggetto non fanno quattro risposte diverse.
        var n = new Set(rispostePer(c, l).map(function (r) { return idx[r]; })).size;
        if (n >= min) out.push({ id: c.id, categoria: c, lettera: l.toUpperCase(), n: n, ricco: n >= prefer });
      }
    });
    out.sort(function (a, b) { return b.n - a.n || a.id.localeCompare(b.id) || a.lettera.localeCompare(b.lettera); });
    if (comboCache.size > 64) comboCache.clear();
    comboCache.set(key, out);
    return out.slice();
  }

  function pickCombo(rng, opts) {
    opts = opts || {};
    var pool = comboDisponibili(opts).filter(function (c) {
      return (opts.escludi || []).indexOf(c.id + ":" + c.lettera) < 0;
    });
    if (opts.lettera) pool = pool.filter(function (c) { return c.lettera === norm(opts.lettera).toUpperCase(); });
    var nuove = pool.filter(function (c) { return (opts.escludiCategorie || []).indexOf(c.id) < 0; });
    if (nuove.length) pool = nuove;
    var nuoveLettere = pool.filter(function (c) { return c.lettera !== opts.ultimaLettera; });
    if (nuoveLettere.length) pool = nuoveLettere;
    var c = pool[Math.floor((rng ? rng() : Math.random()) * pool.length)];
    return c ? { id: c.id, categoria: c.categoria, nome: c.categoria.nome, lettera: c.lettera, n: c.n } : null;
  }

  /**
   * Valida una risposta della modalità competitiva.
   * Motivi: VUOTO, LUNGA, CARATTERI, LETTERA, NON_CATEGORIA.
   */
  function valida(risposta, categoria, lettera) {
    var n = norm(risposta);
    function ko(motivo) { return { ok: false, motivo: motivo, normalizzata: n, canonical: n, categoriaId: categoria && categoria.id }; }
    if (!n) return ko("VUOTO");
    if (n.length < 3) return ko("CORTA");
    if (n.length > 40) return ko("LUNGA");
    if (/[^a-zà-öø-ÿ\s'’\-]/i.test(String(risposta).trim())) return ko("CARATTERI");
    if (lettera && n.charAt(0) !== norm(lettera).charAt(0)) return ko("LETTERA");
    if (categoria) {
      var idx = indice(categoria);
      if (idx[n]) return { ok: true, normalizzata: n, canonical: idx[n], categoriaId: categoria.id };
      return ko("NON_CATEGORIA");
    }
    return { ok: true, normalizzata: n, canonical: n };
  }

  /** Chiave di raggruppamento dei duplicati: le varianti canoniche contano uguali. */
  function groupKey(risposta, categoria) {
    var v = valida(risposta, categoria, null);
    return v.canonical || v.normalizzata || "";
  }

  function byId(id, snapshot) {
    var all = CATEGORIE.concat(CREATIVE);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return applicaOverlay(all[i], ((snapshot || {}).categorie || {})["sprint-" + id]);
    return null;
  }

  /** Quante categorie sono giocabili per ogni lettera (metrica di qualità). */
  function copertura(min) {
    var out = {};
    for (var code = 65; code <= 90; code++) {
      var l = String.fromCharCode(code), n = 0;
      CATEGORIE.forEach(function (c) { if (rispostePer(c, l.toLowerCase()).length >= (min == null ? 3 : min)) n++; });
      out[l] = n;
    }
    return out;
  }

  /** Lista piana per i test di integrità. */
  function listePiatte() {
    var all = [];
    CATEGORIE.forEach(function (c) {
      (c.risposte || []).forEach(function (r) { all.push({ categoria: c.id, parola: norm(r), noDict: !!c.noDict, multi: norm(r).indexOf(" ") >= 0 }); });
      Object.keys(c.varianti || {}).forEach(function (v) { all.push({ categoria: c.id, parola: norm(v), noDict: !!c.noDict, multi: true }); });
    });
    return all;
  }

  return {
    CATEGORIE: CATEGORIE, CREATIVE: CREATIVE, categorie: categorie, applicaOverlay: applicaOverlay,
    norm: norm, indice: indice, rispostePer: rispostePer,
    comboDisponibili: comboDisponibili, pickCombo: pickCombo,
    valida: valida, groupKey: groupKey, byId: byId, copertura: copertura, listePiatte: listePiatte
  };
});
