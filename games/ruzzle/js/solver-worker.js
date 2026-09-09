/* Il lavoro oneroso non entra mai nel thread di interazione. */
"use strict";
importScripts("solver.js");
var trie = null;
self.onmessage = function (event) {
  var data = event.data;
  try {
    if (data.type === "init") { trie = self.FAWRuzzleSolver.build(data.words); self.postMessage({ type: "ready" }); return; }
    if (!trie) throw new Error("Dizionario del risolutore non pronto");
    var result = self.FAWRuzzleSolver.solve(trie, data.input);
    if (data.input.summary) delete result.words;
    self.postMessage({ id: data.id, result: result });
  } catch (e) { self.postMessage({ id: data.id, error: e.message }); }
};
