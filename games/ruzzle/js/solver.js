/** Risolutore Ruzzle puro. Nessun DOM: eseguito nel Worker e testabile in Node. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FAWRuzzleSolver = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";
  function build(words) {
    var root = Object.create(null), longest = 0;
    words.forEach(function (word) {
      if (!/^[A-Z]{4,}$/.test(word)) return;
      longest = Math.max(longest, word.length); var node = root;
      for (var i = 0; i < word.length; i++) node = node[word[i]] || (node[word[i]] = Object.create(null));
      node.$ = true;
    });
    return { root: root, longest: longest };
  }
  function score(word, path, bonuses) {
    var n = word.length, p = n < 4 ? 0 : n === 4 ? 1 : n === 5 ? 2 : n === 6 ? 3 : n === 7 ? 5 : 11, mult = 1;
    path.forEach(function (idx) { var b = bonuses[idx]; if (b === "2L") p += 2; else if (b === "3L") p += 3; else if (b === "2P") mult *= 2; else if (b === "3P") mult *= 3; });
    return p * mult;
  }
  function solve(trie, input) {
    var size = Number(input.size), letters = input.letters || [], bonuses = input.bonuses || [];
    if (!Number.isInteger(size) || size < 2 || size > 16 || letters.length !== size * size || !letters.every(function (l) { return /^[A-Z]$/.test(l) || l === "QU"; })) throw new Error("Griglia non valida");
    var now = typeof performance !== "undefined" ? function () { return performance.now(); } : Date.now;
    var start = now(), budget = Math.max(1, Math.min(5000, input.timeMs || 1000)), limit = input.limit || 50000;
    var maxSteps = input.maxSteps || Infinity, steps = 0, partial = false, out = new Map(), visited = new Uint8Array(letters.length), path = [];
    var maxLen = Math.min(trie.longest, size * size * 2);
    var adj = letters.map(function (_, i) {
      var r = Math.floor(i / size), c = i % size, result = [];
      for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) if ((dr || dc) && r + dr >= 0 && r + dr < size && c + dc >= 0 && c + dc < size) result.push((r + dr) * size + c + dc);
      return result;
    });
    function walk(i, node, word) {
      if (partial) return;
      steps++;
      if (steps > maxSteps || (steps % 256 === 0 && now() - start >= budget)) { partial = true; return; }
      var token = letters[i] === "Q" ? "QU" : letters[i];
      for (var t = 0; t < token.length; t++) { node = node[token[t]]; if (!node) return; }
      var next = word + token; if (next.length > maxLen) return;
      visited[i] = 1; path.push(i);
      if (node.$) {
        var p = score(next, path, bonuses), prev = out.get(next);
        if (!prev || p > prev.p) out.set(next, { w: next, p: p, path: path.slice() });
        if (out.size >= limit) partial = true;
      }
      if (next.length < maxLen) for (var n = 0; n < adj[i].length && !partial; n++) if (!visited[adj[i][n]]) walk(adj[i][n], node, next);
      visited[i] = 0; path.pop();
    }
    for (var i = 0; i < letters.length && !partial; i++) walk(i, trie.root, "");
    var words = Array.from(out.values()).sort(function (a,b) { return b.p - a.p || a.w.localeCompare(b.w); });
    return { words: words, count: words.length, complete: !partial, steps: steps, elapsedMs: Math.round(now() - start) };
  }
  return { build: build, solve: solve, score: score };
});
