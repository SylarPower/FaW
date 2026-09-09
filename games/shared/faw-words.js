/**
 * FAWWords — dizionario e utilità parole condivise.
 *
 * Usa LO STESSO dizionario di Ruzzle: `dizionario.txt` nella root del repo,
 * caricato con la stessa normalizzazione (`games/ruzzle/index.html`,
 * `loadDictionary()`), così le decisioni "parola valida / no" sono identiche
 * tra Ruzzle e La Bomba delle Parole.
 * Nessuna API esterna, nessun secondo dizionario.
 *
 * Perché un modulo condiviso: duplicare il parser del dizionario in tre giochi
 * avrebbe prodotto regole divergenti (accenti, J/K/X/W, lunghezza minima).
 *
 * Parti pure (norm, punteggio, adiacenza, indice sequenze, risolutore) esportate
 * anche come modulo Node per i test unitari.
 */
(function (root, factory) {
  var mod = factory(root);
  if (typeof module === "object" && module.exports) module.exports = mod;
  if (root) root.FAWWords = mod;
})(typeof window !== "undefined" ? window : globalThis, function (global) {
  "use strict";

  var CORE = global && global.FAWCore ? global.FAWCore : null;

  var MIN_LEN = 4;                                  // come Ruzzle
  var DICT_URLS = ["../../dizionario.txt", "/dizionario.txt", "../dizionario.txt"];
  // Pool di Ruzzle (52 lettere): stesso feel di distribuzione delle vocali.
  var LETTER_POOL = "AAAAAAAABBCCDDEEEEEEEEFFGGGHHIIIIIILLLMMNNOOOOOOPPQRRSSTTTUUUVVZ";
  // scale di punteggio per lunghezza, derivata da `calculateScoreWithBonuses` di Ruzzle
  var LEN_SCORE = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 2, 6: 3, 7: 5, 8: 11, 9: 14, 10: 17, 11: 20, 12: 23 };

  function norm(w) {
    if (CORE) return CORE.normWord(w);
    return String(w || "").trim().toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, "").toUpperCase();
  }

  /* ------------------------------ dizionario ------------------------------ */

  var words = null, baseWords = null, publicationKey = null;
  var byLen = null;
  var trieRoot = null;
  var loading = null;
  var sequenceIndexes = new Map();
  var sequencePools = new Map();

  function resetIndexes() {
    byLen = null; trieRoot = null;
    sequenceIndexes.clear(); sequencePools.clear();
  }

  function buildTrie() {
    if (trieRoot || !words) return;
    trieRoot = Object.create(null);
    words.forEach(function (w) {
      var node = trieRoot;
      for (var i = 0; i < w.length; i++) node = node[w[i]] || (node[w[i]] = Object.create(null));
      node.$ = true;
    });
  }

  function load(opts) {
    opts = opts || {};
    if (isDictionaryReady() && !opts.urls) return Promise.resolve({ size: words.size });
    if (loading) return loading;
    var urls = opts.urls || DICT_URLS;
    function tryUrl(i) {
      if (i >= urls.length) return Promise.reject(new Error("Dizionario non raggiungibile. Controlla la connessione e riprova."));
      var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      var timeout = setTimeout(function () { if (controller) controller.abort(); }, 12000);
      return fetch(urls[i], controller ? { signal: controller.signal } : {}).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      }).then(function (text) {
        // Alcuni hosting restituiscono index.html con HTTP 200 sui path mancanti.
        if (/<(?:!doctype|html|body)\b/i.test(text)) throw new Error("Il file ricevuto non è un dizionario");
        var list = text.split(/\r?\n/).map(norm).filter(function (w) { return w.length >= (opts.minLen || MIN_LEN); });
        if (!list.length) throw new Error("Dizionario vuoto");
        setWords(list, opts);
        return setPublication(opts.publication || { extra: opts.extra || [], excluded: opts.excluded || [] });
      }).catch(function () { return tryUrl(i + 1); })
        .finally(function () { clearTimeout(timeout); });
    }
    loading = tryUrl(0).finally(function () { loading = null; });
    return loading;
  }

  function setWords(list, opts) {
    words = new Set(list.map(norm).filter(function (w) { return w.length >= ((opts && opts.minLen) || MIN_LEN); }));
    baseWords = words; publicationKey = null;
    resetIndexes();
    return { size: words.size };
  }
  // Il corpus scaricato resta immutato: sostituzioni di uguale lunghezza,
  // esclusioni revocate e ritorno al lessico base invalidano davvero gli indici.
  function setPublication(snapshot) {
    snapshot = snapshot || {};
    var extra = Array.from(new Set((snapshot.extra || []).map(norm))).sort();
    var excluded = Array.from(new Set((snapshot.excluded || []).map(norm))).sort();
    var key = JSON.stringify([extra, excluded]);
    if (publicationKey === key && words) return { size: words.size };
    if (!baseWords) throw new Error("Carica prima il dizionario base");
    words = new Set(baseWords);
    extra.forEach(function (w) { if (w.length >= MIN_LEN) words.add(w); });
    excluded.forEach(function (w) { words.delete(w); });
    publicationKey = key; resetIndexes();
    return { size: words.size };
  }
  function isBaseWord(w) { return !!baseWords && baseWords.has(norm(w)); }
  function isDictionaryReady() { return !!baseWords && baseWords.size > 0; }
  function dictionarySize() { return words ? words.size : 0; }
  function isWord(w, snapshot) {
    var n = norm(w);
    if (snapshot) return (isBaseWord(n) || (snapshot.extra || []).indexOf(n) >= 0) && (snapshot.excluded || []).indexOf(n) < 0;
    return !!words && words.has(n);
  }
  function hasPrefix(p) {
    buildTrie();
    if (!trieRoot) return false;
    var node = trieRoot, s = norm(p);
    for (var i = 0; i < s.length; i++) { if (!node[s[i]]) return false; node = node[s[i]]; }
    return true;
  }
  function wordsOfLength(n) {
    if (!byLen) {
      byLen = new Map();
      if (words) words.forEach(function (w) {
        if (!byLen.has(w.length)) byLen.set(w.length, []);
        byLen.get(w.length).push(w);
      });
    }
    return byLen.get(n) || [];
  }

  /* ------------------------------- punteggio ------------------------------ */

  /** Punteo base in stile Ruzzle: lunghezza, con progressione oltre gli 8. */
  function scoreForLength(len) {
    if (len < MIN_LEN) return 0;
    if (len <= 12) return LEN_SCORE[len] || 1;
    return 23 + (len - 12) * 3;
  }

  /* ---------------------- griglia, adiacenza, solvibilità ------------------ */

  function neighborsOf(idx, size) {
    var r = Math.floor(idx / size), c = idx % size, out = [];
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        var nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < size && nc >= 0 && nc < size) out.push(nr * size + nc);
      }
    }
    return out;
  }
  function isAdjacent(i1, i2, size) {
    return neighborsOf(i1, size).indexOf(i2) >= 0;
  }

  function makeGridLetters(size, rng, pool) {
    var total = size * size, out = [];
    var p = pool || LETTER_POOL;
    for (var i = 0; i < total; i++) out.push(p.charAt(Math.floor(rng() * p.length)));
    return out;
  }

  /**
   * Enumera le parole contenibili nella griglia (backtracking con potatura
   * per prefisso). Limite di tempo e di numero per non bloccare il thread.
   */
  function solveGrid(letters, size, opts) {
    opts = opts || {};
    var limit = opts.limit || 400;
    var maxLen = opts.maxLen || 12;
    var timeBudget = opts.timeMs || 350;
    var out = [];
    buildTrie();
    if (!trieRoot) return out;
    var t0 = Date.now();
    var n = letters.length;
    var visited = new Array(n);
    function walk(idx, node, word, path) {
      if (out.length >= limit || Date.now() - t0 > timeBudget) return;
      var ch = letters[idx];
      var next = node[ch];
      if (!next) return;
      var w = word + ch;
      visited[idx] = true;
      path.push(idx);
      if (next.$ && w.length >= (opts.minLen || MIN_LEN)) out.push({ word: w, path: path.slice(), points: scoreForLength(w.length) });
      if (w.length < maxLen) {
        var nb = neighborsOf(idx, size);
        for (var i = 0; i < nb.length; i++) if (!visited[nb[i]]) walk(nb[i], next, w, path);
      }
      path.pop();
      visited[idx] = false;
    }
    for (var s = 0; s < n; s++) walk(s, trieRoot, "", []);
    return out;
  }

  /**
   * Genera una griglia "buona": almeno `minWords` parole trovabili e una
   * distribuzione sensata di lettere. Riprova cambiando sale sul seed.
   */
  function generateGrid(opts) {
    opts = opts || {};
    var size = opts.size || 5;
    var rng = opts.rng || Math.random;
    var minWords = opts.minWords || 18;
    var best = null;
    for (var attempt = 0; attempt < (opts.attempts || 14); attempt++) {
      var letters = makeGridLetters(size, rng, opts.pool);
      var found = words ? solveGrid(letters, size, { limit: 120, timeMs: 260 }) : [];
      var cand = { letters: letters, found: found, count: found.length, seed: (opts.seed || "") + "#" + attempt };
      if (!best || cand.count > best.count) best = cand;
      if (cand.count >= minWords) break;
    }
    if (!best.letters) best.letters = makeGridLetters(size, rng, opts.pool);
    best.letters = best.letters || makeGridLetters(size, rng, opts.pool);
    return best;
  }

  /* --------------------------- sequenze (Bomba) --------------------------- */

  function sequenceIndex(len, minLen, maxLen) {
    var key = len + ":" + minLen + ":" + maxLen;
    if (sequenceIndexes.has(key)) return sequenceIndexes.get(key);
    var index = new Map();
    if (!words) return index; // non mettere in cache un dizionario ancora assente
    words.forEach(function (w) {
      if (w.length < minLen || w.length > maxLen) return;
      var seen = new Set();
      for (var i = 0; i + len <= w.length; i++) {
        var g = w.slice(i, i + len);
        if (!seen.has(g)) { seen.add(g); index.set(g, (index.get(g) || 0) + 1); }
      }
    });
    sequenceIndexes.set(key, index);
    return index;
  }

  /** Conta parole distinte, non le occorrenze della sillaba nella stessa parola. */
  function sequenceCount(seq, opts) {
    opts = opts || {};
    var s = norm(seq);
    if (!s) return 0;
    return sequenceIndex(s.length, opts.minLen || MIN_LEN, opts.maxLen || Infinity).get(s) || 0;
  }

  function sampleSequences(opts) {
    opts = opts || {};
    if (!words) return [];
    var len = opts.len || 3, minWords = opts.minWords || 40, maxWords = opts.maxWords || 900;
    var size = opts.size || 24, rng = opts.rng || Math.random;
    var key = [len, minWords, maxWords, opts.minLen || MIN_LEN, opts.maxLen || Infinity].join(":");
    var pool = sequencePools.get(key);
    if (!pool) {
      pool = [];
      sequenceIndex(len, opts.minLen || MIN_LEN, opts.maxLen || Infinity).forEach(function (count, seq) {
        if (count >= minWords && count <= maxWords) pool.push({ seq: seq, count: count });
      });
      pool.sort(function (a, b) { return a.seq < b.seq ? -1 : 1; });
      sequencePools.set(key, pool);
    }
    // Cache SOLO del pool. Il campione va rigenerato con il seed di questa partita,
    // non ereditato dal primo allenamento aperto sul dispositivo.
    var available = pool.filter(function (c) { return (opts.exclude || []).indexOf(c.seq) < 0; });
    var out = [];
    while (out.length < size && available.length) {
      var i = Math.floor(rng() * available.length);
      out.push(available.splice(i, 1)[0]);
    }
    return out;
  }

  /** Parole che contengono la sequenza (per suggerimenti/verifica offline). */
  function wordsContaining(seq, opts) {
    opts = opts || {};
    var s = norm(seq);
    var out = [];
    if (!words || !s) return out;
    var maxLen = opts.maxLen || 10;
    var minLen = opts.minLen || MIN_LEN;
    var limit = opts.limit || 400;
    words.forEach(function (w) {
      if (out.length >= limit) return;
      if (w.length >= minLen && w.length <= maxLen && w.indexOf(s) >= 0) out.push(w);
    });
    return out;
  }

  /** Motivo dell'errore su una risposta (Bomba): distinguere i casi. */
  function checkWord(word, used, seq) {
    var w = norm(word);
    if (w.length < MIN_LEN) return { ok: false, reason: "CORTA", word: w };
    if (!/^[A-Z]+$/.test(w)) return { ok: false, reason: "CARATTERI", word: w };
    if (seq && w.indexOf(norm(seq)) < 0) return { ok: false, reason: "SENZA_SEQUENZA", word: w };
    if (used && used.has(w)) return { ok: false, reason: "GIÀ_USATA", word: w };
    if (!isWord(w)) return { ok: false, reason: "NON_TROVATA", word: w };
    return { ok: true, word: w, points: scoreForLength(w.length) };
  }

  return {
    MIN_LEN: MIN_LEN, LETTER_POOL: LETTER_POOL, DICT_URLS: DICT_URLS,
    norm: norm, load: load, setWords: setWords, setPublication: setPublication, isBaseWord: isBaseWord,
    isDictionaryReady: isDictionaryReady, dictionarySize: dictionarySize,
    isWord: isWord, hasPrefix: hasPrefix, wordsOfLength: wordsOfLength,
    scoreForLength: scoreForLength, LEN_SCORE: LEN_SCORE,
    neighborsOf: neighborsOf, isAdjacent: isAdjacent,
    makeGridLetters: makeGridLetters, solveGrid: solveGrid, generateGrid: generateGrid,
    sequenceCount: sequenceCount, sampleSequences: sampleSequences, wordsContaining: wordsContaining,
    checkWord: checkWord,
    all: function () { return words; }
  };
});
