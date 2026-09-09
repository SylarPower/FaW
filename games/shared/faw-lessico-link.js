/** Un solo collegamento/contatore per pagina, mai popup o pubblicazioni automatiche. */
(function (global) {
  "use strict";
  var stop = null, timer = null, link = null, rows = [], active = false;
  function href() {
    if (!link) return;
    var game = new URLSearchParams(location.search).get("matchId"), base = document.body.dataset.lessicoBase || "../../lessico/index.html";
    link.href = base + (game ? "?matchId=" + encodeURIComponent(game) : "");
  }
  function render() {
    if (!link) return;
    href();
    var me = global.FAWCore.user(), now = global.FAWNet.clock();
    var n = rows.filter(function (r) {
      var p = r.data; return global.FAWLessico.status(p, now) === "pending" && !(p.voti || {})[me];
    }).length;
    link.textContent = n ? "Lessico · " + n + " da valutare" : "Lessico e proposte";
  }
  function cleanup() { active = false; if (stop) stop(); stop = null; clearInterval(timer); timer = null; }
  function init() {
    if (active || !global.FAWNet || !global.FAWLessico || !global.FAWCore) return;
    var target = document.querySelector("[data-lessico-slot]") || document.querySelector(".faw-main") || document.querySelector("main");
    if (!target) return;
    link = document.getElementById("faw-lessico-link");
    if (!link) {
      link = document.createElement("a"); link.id = "faw-lessico-link"; link.className = "faw-lessico-link";
      ["pointerdown", "focus", "click"].forEach(function (event) { link.addEventListener(event, href); });
      target.prepend(link);
    }
    active = true; render();
    var me = global.FAWCore.user();
    if (!me) return;
    try {
      stop = global.FAWNet.onCol(global.FAWLessico.COL, [{ field: "elettori", op: "array-contains", value: me }], function (docs, meta) {
        if (!active) return;
        if (meta && meta.error) { link.textContent = "Lessico · verificare connessione"; return; }
        rows = docs; render();
      });
      timer = setInterval(render, 60000);
    } catch (_) { link.textContent = "Lessico e proposte"; }
  }
  global.addEventListener("pagehide", cleanup);
  global.addEventListener("pageshow", function (e) { if (e.persisted) init(); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})(window);
