/** Vista/editor NCC. Autosalvataggio coalescente, una scrittura in volo,
 * revisioni monotone e bozza di sessione: gli snapshot non sostituiscono il testo
 * che si sta digitando. Nessun suggerimento di risposte prima dello stop. */
(function (global) {
  "use strict";
  global.FAWRushScheda = function (opts) {
    var $ = function (id) { return document.getElementById(id); };
    var N = global.FAWNcc, R = global.FAWRushRules, CORE = global.FAWCore;
    var view = { key: null, rev: 0, saved: 0, values: {}, errors: {}, dirty: false, request: null, failures: 0, cached: null, generation: 0 };
    var timer = null;
    function state() { return opts.state(); }
    function current() { var s = state(); return s.data && R.fasePartita(s.data, opts.now()); }
    function text(id, value) { if ($(id).textContent !== value) $(id).textContent = value; }
    function cache() {
      try {
        sessionStorage.setItem(view.key, JSON.stringify({ valori: view.values, rev: view.rev }));
        view.cached = true;
        var keys = Object.keys(sessionStorage).filter(function (k) { return k.indexOf("faw:rush:scheda:") === 0 && k !== view.key; });
        while (keys.length > 7) sessionStorage.removeItem(keys.shift());
      } catch (e) { view.cached = false; }
    }
    function local(key) { try { return JSON.parse(sessionStorage.getItem(key) || "null"); } catch (e) { return null; } }
    function delCache() { try { if (view.key) sessionStorage.removeItem(view.key); } catch (e) {} }
    function payload() { return { roundIdx: state().idx, valori: Object.assign({}, view.values), rev: view.rev }; }
    function paint() {
      var s = state(), f = current();
      if (!f || s.modale !== N.MODE || !s.rounds[Math.max(0, f.indice)]) return;
      var submitted = (((s.data.rush || {}).risposte || {})[f.indice] || {})[s.me];
      var disabled = f.fase !== "input" || !!s.pending || !!submitted;
      var v = N.valuta(view.values, s.rounds[Math.max(0, f.indice)], s.data.lessico);
      text("scheda-progress", v.valide + "/" + s.rounds[Math.max(0, f.indice)].categorie.length + " categorie complete");
      $("scheda-count-bar").style.transform = "scaleX(" + v.valide / s.rounds[Math.max(0, f.indice)].categorie.length + ")";
      $("scheda-fields").querySelectorAll("input[data-categoria]").forEach(function (input) {
        var id = input.dataset.categoria;
        input.readOnly = disabled; input.disabled = f.fase !== "input";
        input.setAttribute("aria-invalid", String(!!view.errors[id]));
        text("scheda-error-" + id, view.errors[id] ? opts.message(view.errors[id], { lettera: s.rounds[Math.max(0, f.indice)].lettera, nome: N.byId(id).nome }) : "");
      });
      $("btn-scheda").disabled = disabled;
      text("btn-scheda", s.pending ? "Consegna…" : submitted ? "Scheda consegnata ✓" : v.completa ? "Stop! Ho finito ↗" : "Consegna parziale ↗");
      $("frm-scheda").setAttribute("aria-busy", String(!!s.pending));
      var status = submitted ? "Consegna definitiva. Puoi confrontare le risposte allo stop."
        : view.request ? "Salvataggio in corso…"
        : view.failures >= 3 ? "Salvataggio non confermato. " + (view.cached === false ? "Non ricaricare: il testo è ancora qui. Riprova." : "La copia in questa scheda del browser è conservata: riprova.")
        : view.dirty ? "Modifiche da salvare…"
        : view.saved ? "Scheda salvata. Puoi ancora modificarla o consegnarla."
        : "Le risposte salvate valgono anche se il tempo scade. Puoi lasciare caselle vuote.";
      text("scheda-sync", status);
      $("btn-salva-scheda").hidden = view.failures < 3 || disabled;
    }
    function schedule(delay) {
      clearTimeout(timer);
      timer = setTimeout(function () { timer = null; flush(); }, delay == null ? 550 : delay);
    }
    function render(d, f) {
      if (state().modale !== N.MODE) { $("frm-scheda").hidden = true; return; }
      $("frm-scheda").hidden = false;
      var s = state(), combo = s.rounds[Math.max(0, f.indice)];
      var key = "faw:rush:scheda:" + (s.matchId || d.seed) + ":" + d.seed + ":" + Math.max(0, f.indice) + ":" + s.me;
      var row = (((d.rush || {}).bozze || {})[f.indice] || {})[s.me] || {};
      var submitted = (((d.rush || {}).risposte || {})[f.indice] || {})[s.me];
      if (key !== view.key) {
        delCache(); clearTimeout(timer); timer = null;
        view = { key: key, rev: row.rev || 0, saved: row.rev || 0, values: N.pulisci(row.valori, combo), errors: {}, dirty: false, request: null, failures: 0, cached: null, generation: view.generation + 1 };
        var old = local(key);
        if (!submitted && old && Number.isInteger(old.rev) && old.rev > view.rev) {
          view.values = N.pulisci(old.valori, combo); view.rev = old.rev; view.dirty = true; view.cached = true;
        }
        $("scheda-fields").innerHTML = combo.categorie.map(function (id, index) {
          var c = N.byId(id);
          return '<div class="ncc-field"><label for="scheda-' + id + '"><span>' + String(index + 1).padStart(2, "0") + '</span>' + CORE.escapeHtml(c.nome) + '</label>' +
            '<input class="faw-input" id="scheda-' + id + '" data-categoria="' + id + '" maxlength="40" autocomplete="off" spellcheck="false" autocapitalize="none" autocorrect="off" enterkeyhint="' + (index === combo.categorie.length - 1 ? "done" : "next") + '" aria-describedby="scheda-help-' + id + ' scheda-error-' + id + '" placeholder="' + combo.lettera + '…">' +
            '<small id="scheda-help-' + id + '">' + CORE.escapeHtml(c.hint) + '</small><p class="ncc-error" id="scheda-error-' + id + '" role="status"></p></div>';
        }).join("");
        $("scheda-fields").querySelectorAll("input[data-categoria]").forEach(function (input) { input.value = view.values[input.dataset.categoria] || ""; });
      }
      if (submitted) { clearTimeout(timer); timer = null; view.dirty = false; delCache(); }
      else if ((row.rev || 0) >= view.rev) {
        var newer = (row.rev || 0) > view.rev;
        view.saved = view.rev = row.rev || 0; view.dirty = false; view.failures = 0;
        if (newer) {
          view.values = N.pulisci(row.valori, combo);
          $("scheda-fields").querySelectorAll("input[data-categoria]").forEach(function (input) { input.value = view.values[input.dataset.categoria] || ""; });
        }
      }
      if (view.dirty && !view.request && !timer && view.failures < 3 && f.fase === "input") schedule();
      paint();
    }
    function flush() {
      clearTimeout(timer); timer = null;
      var f = current(), s = state();
      if (!view.dirty || view.request || view.failures >= 3 || !f || f.fase !== "input" || s.modale !== N.MODE || s.pending) return Promise.resolve(false);
      if ((((s.data.rush || {}).risposte || {})[f.indice] || {})[s.me]) return Promise.resolve(false);
      var request = payload(), generation = view.generation;
      view.request = request; paint();
      return opts.write(function (cur) { return R.bozzaPatch(cur, s.me, request, opts.now()); }).then(function (res) {
        if (generation !== view.generation) return;
        var saved = (((res.data || {}).rush || {}).bozze || {})[request.roundIdx] || {};
        if (saved[s.me] && saved[s.me].rev >= request.rev) {
          view.saved = Math.max(view.saved, request.rev); view.failures = 0;
          if (view.rev === request.rev) view.dirty = false;
        }
      }).catch(function () { if (generation === view.generation) view.failures++; })
        .finally(function () {
          if (generation !== view.generation) return;
          view.request = null; paint();
          if (view.dirty && view.failures < 3) schedule(600 * Math.max(1, view.failures));
        });
    }
    $("frm-scheda").addEventListener("submit", function (e) { e.preventDefault(); opts.submit(); });
    $("scheda-fields").addEventListener("input", function (e) {
      var input = e.target.closest("input[data-categoria]"); if (!input || input.readOnly) return;
      view.values[input.dataset.categoria] = input.value;
      view.rev++; view.dirty = true; view.failures = 0; delete view.errors[input.dataset.categoria];
      cache(); var f = current(); schedule(f && f.entroMs < 1200 ? 0 : 550); paint();
    });
    $("scheda-fields").addEventListener("focusout", function () { flush(); });
    $("scheda-fields").addEventListener("focusin", function (e) { if (e.target.matches("input")) CORE.keepInputVisible(e.target, 180); });
    $("scheda-fields").addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || e.isComposing || !e.target.matches("input[data-categoria]")) return;
      e.preventDefault();
      var fields = Array.from($("scheda-fields").querySelectorAll("input[data-categoria]")), i = fields.indexOf(e.target);
      if (fields[i + 1]) fields[i + 1].focus(); else $("btn-scheda").focus();
    });
    $("btn-salva-scheda").addEventListener("click", function () { view.failures = 0; flush(); });
    return {
      render: render, payload: payload, flush: flush,
      errors: function (errors) { view.errors = errors || {}; paint(); var id = Object.keys(view.errors)[0]; if (id && $("scheda-" + id)) $("scheda-" + id).focus(); },
      tick: function (f) { if (f && f.fase === "input" && f.entroMs < 1200) flush(); },
      stop: function () { clearTimeout(timer); timer = null; view.generation++; view.request = null; }
    };
  };
})(window);
