/**
 * FAWWords — dizionario e utilità parole condivise.
 *
 * Usa LO STESSO dizionario di Ruzzle: `dizionario.txt` nella root del repo,
 * caricato con la stessa normalizzazione (`games/ruzzle/index.html`,
 * `loadDictionary()`), così le decisioni "parola valida / no" sono identiche
 * tra Ruzzle, Parole in Arena e La Bomba delle Parole.
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

  var words = null;      // Set<string>
  var byLen = null;      // Map<number, string[]>
  var tri = null;        // Map<string, number>  trigrammi -> n. parole
  var trieRoot = null;

  function addWordsFrom(text, set, minLen, excluded) {
    var n = 0;
    text.split("\n").forEach(function (line) {
      var clean = norm(line);
      if (clean.length >= (minLen || MIN_LEN) && /^[A-Z]+$/.test(clean) && !(excluded || []).includes(clean)) {
        if (!set.has(clean)) { set.add(clean); n++; }
      }
    });
    return n;
  }

  function buildIndex() {
    byLen = new Map();
    tri = new Map();
    words.forEach(function (w) {
      if (!byLen.has(w.length)) byLen.set(w.length, []);
      byLen.get(w.length).push(w);
      for (var i = 0; i + 3 <= w.length; i++) {
        var g = w.slice(i, i + 3);
        tri.set(g, (tri.get(g) || 0) + 1);
      }
    });
    trieRoot = Object.create(null);
    words.forEach(function (w) {
      var node = trieRoot;
      for (var i = 0; i < w.length; i++) {
        var c = w[i];
        if (!node[c]) node = node[c] = Object.create(null);
        else node = node[c];
      }
      node.$ = true;
    });
  }

  function load(opts) {
    opts = opts || {};
    var urls = opts.urls || DICT_URLS;
    var minLen = opts.minLen || MIN_LEN;
    var set = new Set();
    function tryUrl(i) {
      if (i >= urls.length) return Promise.reject(new Error("dizionario non raggiungibile"));
      return fetch(urls[i]).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      }).then(function (text) {
        addWordsFrom(text, set, minLen, opts.excluded);
        return set;
      }).catch(function (e) {
        global.console && console.warn("[FAWWords] fallback", urls[i], e && e.message);
        return tryUrl(i + 1);
      });
    }
    return tryUrl(0).then(function (s) {
      words = s;
      buildIndex();
      (opts.extra || []).forEach(function (w) {
        var c = norm(w);
        if (c.length >= minLen) { words.add(c); buildIndex(); }
      });
      return { size: words.size };
    });
  }

  /** Permette ai test (Node) di iniettare un dizionario minimo. */
  function setWords(list, opts) {
    words = new Set(list.map(norm).filter(function (w) { return w.length >= ((opts && opts.minLen) || MIN_LEN); }));
    buildIndex();
    return { size: words.size };
  }

  function isDictionaryReady() { return !!words; }
  function dictionarySize() { return words ? words.size : 0; }
  function isWord(w) { return !!words && words.has(norm(w)); }
  function hasPrefix(p) {
    if (!trieRoot) return false;
    var node = trieRoot, s = norm(p);
    for (var i = 0; i < s.length; i++) { if (!node[s[i]]) return false; node = node[s[i]]; }
    return true;
  }
  function wordsOfLength(n) { return (byLen && byLen.get(n)) || []; }

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

  /** Numero di parole del dizionario che contengono la sequenza. */
  function sequenceCount(seq) {
    var s = norm(seq);
    if (!tri) return 0;
    if (s.length === 3) return tri.get(s) || 0;
    // per lunghezze diverse si scorre il dizionario (usato raramente / cache)
    var n = 0;
    words.forEach(function (w) { if (w.indexOf(s) >= 0) n++; });
    return n;
  }

  var seqCache = new Map();

  /**
   * Campione di sequenze giocabili (default trigrammi): richieste per la Bomba.
   * `minWords` scarta le sequenze quasi impossibili; `maxWords` quelle banali.
   */
  function sampleSequences(opts) {
    opts = opts || {};
    var len = opts.len || 3;
    var minWords = opts.minWords || 40;
    var maxWords = opts.maxWords || 900;
    var size = opts.size || 24;
    var rng = opts.rng || Math.random;
    var cacheKey = len + ":" + minWords + ":" + maxWords + ":" + size;
    if (seqCache.get(cacheKey)) return seqCache.get(cacheKey);
    var pool = [];
    var keys;
    if (len === 3 && tri) {
      keys = tri;
      keys.forEach(function (cnt, g) { if (cnt >= minWords && cnt <= maxWords) pool.push(g); });
    } else {
      // costruisce un indice ad-hoc scorrendo le parole
      var m = new Map();
      words.forEach(function (w) {
        var seen = new Set();
        for (var i = 0; i + len <= w.length; i++) {
          var g = w.slice(i, i + len);
          if (!seen.has(g)) { seen.add(g); m.set(g, (m.get(g) || 0) + 1); }
        }
      });
      m.forEach(function (cnt, g) { if (cnt >= minWords && cnt <= maxWords) pool.push(g); });
    }
    var out = [];
    var used = new Set();
    var guard = 0;
    while (out.length < size && pool.length && guard++ < size * 40) {
      var g = pool[Math.floor(rng() * pool.length)];
      if (used.has(g)) continue;
      used.add(g);
      out.push({ seq: g, count: (tri && tri.get(g)) || 0 });
    }
    seqCache.set(cacheKey, out);
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
    norm: norm, load: load, setWords: setWords,
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
