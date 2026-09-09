(function (global) {
  "use strict";
  var worker = null, words = null, sequence = 0, pending = null, timeout = null;
  var src = new URL("solver-worker.js", document.currentScript.src).href;
  function cancel(message) {
    if (worker) worker.terminate(); worker = null; clearTimeout(timeout);
    if (pending) { var e = new Error(message || "Calcolo annullato"); e.code = message ? "worker-error" : "cancelled"; pending.reject(e); pending = null; }
  }
  function setWords(list) { if (words === list) return; cancel(); words = list; }
  function solve(input) {
    if (pending) cancel(); // una richiesta corrente, nessuna coda obsoleta
    if (!global.Worker || !words) return Promise.reject(new Error("Analisi in background non disponibile in questo browser."));
    return new Promise(function (resolve, reject) {
      var id = ++sequence;
      pending = { id: id, resolve: resolve, reject: reject };
      if (!worker) {
        try {
          worker = new Worker(src);
          worker.onmessage = function (event) {
            var m = event.data;
            if (!pending || m.type === "ready" || m.id && m.id !== pending.id) return;
            var task = pending; pending = null; clearTimeout(timeout);
            if (m.error) { worker.terminate(); worker = null; task.reject(new Error(m.error)); } else task.resolve(m.result);
          };
          worker.onerror = function () { cancel("Il risolutore non è disponibile. Puoi riprovare senza interrompere il gioco."); };
          worker.postMessage({ type: "init", words: Array.from(words) });
        } catch (e) { var task = pending; pending = null; cancel(); task.reject(e); return; }
      }
      worker.postMessage({ id: id, input: input });
      timeout = setTimeout(function () { cancel("Analisi non completata. Riprova."); }, 15000);
    });
  }
  global.FAWRuzzleAnalysis = { setWords: setWords, solve: solve, cancel: cancel };
  global.addEventListener("pagehide", function () { cancel(); words = null; });
})(window);
