/**
 * FAWNet — trasporto dati condiviso dei giochi FaW.
 *
 * UNICA astrazione usata dai nuovi giochi per leggere/scrivere lo stato
 * di una partita. Due backend con la stessa API:
 *
 *  • `firebase` → Firestore (script compat già presenti nella pagina)
 *  • `fake`     → relay HTTP locale usato SOLO dai test (`tests/support/faw-relay.js`),
 *                 con le stesse semantica di versione/CSA per poter verificare
 *                 transazioni, doppie scritture, riconnessioni e fine partita.
 *
 * Perché esiste: i giochi precedenti scrivono `punteggi.{nome}` con `update()`
 * semplice → l'ultima scrittura vince e due risposte simultanee si cancellano.
 * Qui le operazioni critiche passano da `transact()` (read-modify-write con
 * controllo di versione) e le scritture ad alta frequenza sono aggregate.
 *
 * Limite dichiarato: la validazione resta client-side. `transact` garantisce
 * coerenza, NON è anti-cheat né un'autorità di server.
 *
 * API:
 *   init({backend, relayUrl}) / ready()
 *   get(path) -> {id, exists, data, version}
 *   set(path, data) / update(path, patch) / del(path) / add(col, data) -> id
 *   transact(path, mutate) -> {applied, data}         mutate(data|null) => patch|false
 *   onDoc(path, cb, opts) -> unsubscribe              cb(data, meta{id,version})
 *   onCol(col, filters, cb, opts) -> unsubscribe      filters:[{field,op,value}]
 *   clock() / clockOffset() / now()
 *   status(cb) -> 'online'|'offline'
 *   presence(nome, extra) -> stop()
 *   ops.arrayUnion/arrayRemove/increment/delete
 */
(function (root, factory) {
  var mod = factory(root);
  if (typeof module === "object" && module.exports) module.exports = mod;
  if (root) root.FAWNet = mod;
})(typeof window !== "undefined" ? window : globalThis, function (global) {
  "use strict";

  var cfg = { backend: "auto", relayUrl: "", debug: false };
  var listeners = [];
  var statusCbs = [];
  var online = (typeof navigator === "undefined") ? true : navigator.onLine !== false;
  var clockOffset = 0;      // serverMs - localMs
  var clockSamples = 0;
  var firestore = null;     // istanza firebase.firestore()
  var relaySeq = 0;
  var LOCALI = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

  function log() {
    if (!cfg.debug || !global.console) return;
    console.log.apply(console, ["[FAWNet]"].concat([].slice.call(arguments)));
  }

  function detectBackend() {
    if (cfg.backend !== "auto") return cfg.backend;
    try {
      if (global.localStorage) {
        var forced = global.localStorage.getItem("faw:net:backend");
        if (forced === "fake" || forced === "firebase") return forced;
        if (!cfg.relayUrl) {
          var u = global.localStorage.getItem("faw:net:relayUrl");
          if (u) cfg.relayUrl = u;
        }
      }
    } catch (e) {}
    if (cfg.relayUrl) return "fake";
    var q = global.location ? new URLSearchParams(location.search) : null;
    if (q && q.get("net") === "fake") return "fake";
    if (q && q.get("net") === "firebase") return "firebase";
    // localhost/IP private = ambiente di sviluppo o relay di test: si usa il relay,
    // così nessuna partita provata in locale scrive per errore sui dati reali.
    // L'override esplicito ?net=firebase serve quando si vuole provare Firebase.
    if (global.location && LOCALI.test(location.hostname)) {
      cfg.relayUrl = location.origin;
      try { if (global.localStorage) global.localStorage.setItem("faw:net:relayUrl", cfg.relayUrl); } catch (e) {}
      return "fake";
    }
    return (global.firebase && global.firebase.firestore) ? "firebase" : "fake";
  }

  /* ------------------------------- ops ------------------------------- */
  var ops = {
    arrayUnion: function (v) { return { __op: "arrayUnion", value: v }; },
    arrayRemove: function (v) { return { __op: "arrayRemove", value: v }; },
    increment: function (v) { return { __op: "increment", value: v }; },
    delete: function () { return { __op: "delete" }; }
  };

  function applyOpsOnPatch(patch, src) {
    // applica gli ops su un oggetto piano (backend fake / transazioni)
    Object.keys(patch).forEach(function (k) {
      var v = patch[k];
      var v0 = src ? getIn(src, k) : undefined;
      if (v && v.__op === "arrayUnion") {
        var a = Array.isArray(v0) ? v0.slice() : [];
        (Array.isArray(v.value) ? v.value : [v.value]).forEach(function (x) { if (a.indexOf(x) < 0) a.push(x); });
        setIn(src, k, a);
      } else if (v && v.__op === "arrayRemove") {
        var b = Array.isArray(v0) ? v0.slice() : [];
        (Array.isArray(v.value) ? v.value : [v.value]).forEach(function (x) { var i = b.indexOf(x); if (i >= 0) b.splice(i, 1); });
        setIn(src, k, b);
      } else if (v && v.__op === "increment") {
        setIn(src, k, (typeof v0 === "number" ? v0 : 0) + v.value);
      } else if (v && v.__op === "delete") {
        delIn(src, k);
      } else {
        setIn(src, k, v);
      }
    });
    return src;
  }

  function getIn(obj, path) {
    var parts = path.split(".");
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }
  function setIn(obj, path, value) {
    var parts = path.split(".");
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (cur[parts[i]] == null || typeof cur[parts[i]] !== "object") cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }
  function delIn(obj, path) {
    var parts = path.split(".");
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (cur[parts[i]] == null) return;
      cur = cur[parts[i]];
    }
    delete cur[parts[parts.length - 1]];
  }

  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

  /* ---------------------------- clock offset --------------------------- */
  /**
   * Stima `serverMs - localMs`. Campioni: risposte del relay (t0/t1 + RTT/2)
   * e `syncAt` (serverTimestamp di Firestore) delle proprie scritture.
   * Low-pass: il primo campione pesa di più, poi si smorza.
   */
  function sampleClock(serverMs, sentAt, recvAt) {
    if (typeof serverMs !== "number" || !isFinite(serverMs)) return;
    var localAt = sentAt + (recvAt - sentAt) / 2;
    var rtt = recvAt - sentAt;
    if (rtt > 4000) return; // campione inaffidabile (rete mossa/sospesa)
    var off = serverMs - localAt;
    if (clockSamples === 0) { clockOffset = off; clockSamples = 1; return; }
    var w = 1 / Math.min(1 + clockSamples, 6);
    clockOffset = clockOffset + (off - clockOffset) * w;
    clockSamples++;
  }
  function clock() { return Date.now() + clockOffset; }
  function clockOffsetMs() { return clockOffset; }
  function clockSamplesCount() { return clockSamples; }

  /* ------------------------------ status ------------------------------ */
  function setStatus(v) {
    if (online === (v === "online")) return;
    online = v === "online";
    statusCbs.forEach(function (cb) { try { cb(online ? "online" : "offline"); } catch (e) {} });
  }
  function status(cb) {
    if (typeof cb === "function") { statusCbs.push(cb); cb(online ? "online" : "offline"); }
    return function () { var i = statusCbs.indexOf(cb); if (i >= 0) statusCbs.splice(i, 1); };
  }
  if (global.addEventListener) {
    global.addEventListener("online", function () { setStatus("online"); });
    global.addEventListener("offline", function () { setStatus("offline"); });
  }

  /* ============================ backend: fake ============================ */
  function relayFetch(path, body, method) {
    var base = (cfg.relayUrl || "").replace(/\/$/, "");
    var payload = body ? JSON.stringify(body) : undefined;
    function unaVolta() {
      var t0 = Date.now();
      return fetch(base + path, {
        method: method || (body ? "POST" : "GET"),
        headers: { "content-type": "application/json" },
        body: payload,
        cache: "no-store"
      }).then(function (r) {
        if (!r.ok) throw new Error("relay " + r.status);
        return r.json();
      }).then(function (res) {
        var t1 = Date.now();
        if (res && typeof res.serverNow === "number") sampleClock(res.serverNow, t0, t1);
        return res;
      });
    }
    // una ritentativa sulle scritture: una risposta persa non deve far sparire
    // una parola o un "pronto" (le operazioni sono idempotenti per progetto)
    return unaVolta().catch(function (e) {
      if (/relay 4|relay 5/.test(String(e && e.message))) throw e;
      return new Promise(function (res) { setTimeout(res, 120); }).then(unaVolta);
    });
  }

  var fakeWatches = [];

  function fakeWatchLoop() {
    if (!cfg.relayUrl) return;
    var paths = {};
    fakeWatches.forEach(function (w) { w.paths.forEach(function (p) { paths[p] = true; }); });
    var list = Object.keys(paths);
    if (!list.length) return;
    relayFetch("/api/watch?since=" + relaySeq + "&paths=" + encodeURIComponent(list.join(",")))
      .then(function (res) {
        relaySeq = res.seq || relaySeq;
        var docs = res.docs || {};
        fakeWatches.slice().forEach(function (w) {
          var changed = false;
          w.paths.forEach(function (p) {
            if (Object.prototype.hasOwnProperty.call(docs, p)) {
              var rec = docs[p];
              if (w.seen[p] !== (rec && rec.version)) {
                w.seen[p] = rec && rec.version;
                changed = true;
                if (w.onDoc) w.onDoc(rec ? { id: p.split("/").pop(), exists: !!rec, data: rec ? rec.data : null, version: rec ? rec.version : 0 } : null);
              }
            }
          });
          if (changed && w.onBatch) w.onBatch();
        });
        setTimeout(fakeWatchLoop, 0);
      })
      .catch(function () {
        setTimeout(fakeWatchLoop, 1200);
      });
  }

  var fake = {
    get: function (path) {
      return relayFetch("/api/get", { paths: [path] }).then(function (r) {
        var d = (r.docs || {})[path];
        relaySeq = r.seq || relaySeq;
        return d ? { id: path.split("/").pop(), exists: true, data: d.data, version: d.version } : { id: path.split("/").pop(), exists: false, data: null, version: 0 };
      });
    },
    set: function (path, data) {
      return relayFetch("/api/write", { ops: [{ path: path, set: data }] }).then(function (r) {
        relaySeq = r.seq;
        if (r.error === "conflict") { var e = new Error("conflict"); e.code = "conflict"; throw e; }
        return { version: r.results[0].version };
      });
    },
    update: function (path, patch, expectVersion) {
      var op = { path: path, patch: patch };
      if (typeof expectVersion === "number") op.ifVersion = expectVersion;
      return relayFetch("/api/write", { ops: [op] }).then(function (r) {
        relaySeq = r.seq;
        if (r.results && r.results[0] && r.results[0].error === "conflict") {
          var e = new Error("conflict"); e.code = "conflict"; throw e;
        }
        return { version: r.results[0] && r.results[0].version };
      });
    },
    del: function (path) {
      return relayFetch("/api/write", { ops: [{ path: path, delete: true }] }).then(function (r) { relaySeq = r.seq; });
    },
    add: function (col, data) {
      var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      return fake.set(col + "/" + id, data).then(function () { return id; });
    },
    listenDoc: function (path, cb, opts) {
      var w = {
        paths: [path], seen: {}, onDoc: function (snap) {
          cb(snap.data || null, { id: path.split("/").pop(), version: snap.version });
        }
      };
      fakeWatches.push(w);
      // primo stato corrente immediato
      fake.get(path).then(function (snap) {
        w.seen[path] = snap.version;
        cb(snap.exists ? snap.data : null, { id: snap.id, version: snap.version, first: true });
      }).catch(function () { cb(null, { id: path.split("/").pop(), error: true }); });
      fakeWatchLoop();
      return function () {
        var i = fakeWatches.indexOf(w);
        if (i >= 0) fakeWatches.splice(i, 1);
      };
    },
    listenCol: function (col, filters, cb) {
      var w = {
        paths: [], col: col, filters: filters || [], seen: {}, onBatch: function () { w.pull(); }
      };
      w.pull = function () {
        relayFetch("/api/query", { col: col, filters: w.filters }).then(function (r) {
          var docs = r.docs || [];
          var versionKey = docs.map(function (d) { return d.id + ":" + d.version; }).join(",");
          if (w.vkey === versionKey) return;
          w.vkey = versionKey;
          cb(docs.map(function (d) { return { id: d.id, data: d.data }; }));
        }).catch(function () {});
      };
      fakeWatches.push(w);
      w.pull();
      w._t = setInterval(w.pull, 900);
      return function () {
        clearInterval(w._t);
        var i = fakeWatches.indexOf(w);
        if (i >= 0) fakeWatches.splice(i, 1);
      };
    },
    transact: function (path, mutate) {
      var attempt = 0;
      function go() {
        attempt++;
        return fake.get(path).then(function (snap) {
          var cur = snap.exists ? clone(snap.data) : null;
          var patch = mutate(cur ? clone(cur) : null);
          if (patch === false) return { applied: false, data: cur };
          var next = applyOpsOnPatch(clone(patch), clone(cur || {}));
          return relayFetch("/api/write", { ops: [{ path: path, set: next, ifVersion: snap.version }] }).then(function (r) {
            relaySeq = r.seq;
            if (r.results[0] && r.results[0].error === "conflict") {
              if (attempt >= 6) { var e = new Error("transazione fallita per conflitti ripetuti"); e.code = "aborted"; throw e; }
              return go();
            }
            return { applied: true, data: next, version: r.results[0].version };
          });
        });
      }
      return go();
    }
  };

  /* ============================ identità (opzionale) ====================== */
  // Il PROGETTO Firebase ha Authentication attiva (c'è `authDomain` in
  // games/shared/firebase-config.js), ma FINO A OGGI nessuna pagina del sito chiama
  // l'SDK di Auth: l'identità usata dal portale è il nome in `mioNome`, e le regole
  // Firestore non possono distinguere un client dall'altro. `ensureSignedIn()` serve
  // a colmare quel buco in modo reversibile: logga in anonimo, espone `FAWNet.uid` e
  // permette ai documenti partita di portare `authUid`, così una regola
  // `request.auth != null` diventa applicabile senza riscrivere i giochi.
  // È OPT-IN e SPENTO di default: si accende con `?auth=anon` o con
  // localStorage `faw:auth:anon = "1"`. Coi test (backend fake) è un no-op dichiarato:
  // risolve `null` senza toccare niente.
  var uidAttivo = null;
  function authRichiesto() {
    try {
      if (typeof localStorage !== "undefined" && localStorage.getItem("faw:auth:anon") === "1") return true;
      if (typeof location !== "undefined" && /[?&]auth=anon\b/.test(location.search || "")) return true;
    } catch (e) {}
    return false;
  }

  /* ========================== backend: Firestore ========================= */
  function fs() {
    if (firestore) return firestore;
    if (!global.firebase || !global.firebase.firestore) throw new Error("SDK Firestore non caricato");
    if (!global.firebase.apps || !global.firebase.apps.length) {
      global.firebase.initializeApp(global.FAW_REQUIRE_FIREBASE_CONFIG ? global.FAW_REQUIRE_FIREBASE_CONFIG() : global.FAW_FIREBASE_CONFIG);
    }
    firestore = global.firebase.firestore();
    try { firestore.settings({ ignoreUndefinedProperties: true }); } catch (e) {}
    return firestore;
  }

  function toFirestoreValue(v) {
    if (v && v.__op) {
      var F = fs().FieldValue;
      if (v.__op === "arrayUnion") return F.arrayUnion.apply(F, Array.isArray(v.value) ? v.value : [v.value]);
      if (v.__op === "arrayRemove") return F.arrayRemove.apply(F, Array.isArray(v.value) ? v.value : [v.value]);
      if (v.__op === "increment") return F.increment(v.value);
      if (v.__op === "delete") return F.delete();
    }
    return v;
  }

  function unwrap(v) {
    if (v && typeof v.toMillis === "function") return v.toMillis();
    return v;
  }
  function unwrapData(o) {
    if (!o || typeof o !== "object") return o;
    Object.keys(o).forEach(function (k) { o[k] = unwrap(o[k]); });
    return o;
  }

  var fb = {
    get: function (path) {
      return fs().doc(path).get().then(function (d) {
        return { id: d.id, exists: d.exists, data: d.exists ? unwrapData(d.data()) : null, version: 0 };
      });
    },
    set: function (path, data) {
      var t0 = Date.now();
      var withSync = Object.assign({}, data, { syncAt: fs().FieldValue.serverTimestamp() });
      return fs().doc(path).set(withSync).then(function () {
        return { version: 0, _t0: t0, _t1: Date.now() };
      });
    },
    update: function (path, patch, expectVersion) {
      var out = {};
      Object.keys(patch).forEach(function (k) { out[k] = toFirestoreValue(patch[k]); });
      return fs().doc(path).update(out).then(function () { return { version: 0 }; });
    },
    del: function (path) { return fs().doc(path).delete().then(function () { return {}; }); },
    add: function (col, data) {
      var withSync = Object.assign({}, data, { syncAt: fs().FieldValue.serverTimestamp() });
      return fs().collection(col).add(withSync).then(function (r) { return r.id; });
    },
    listenDoc: function (path, cb, opts) {
      var dref = fs().doc(path);
      return dref.onSnapshot({ includeMetadataChanges: false }, function (snap) {
        if (!snap.exists) { cb(null, { id: snap.id, missing: true }); return; }
        var data = unwrapData(snap.data());
        if (data && typeof data.syncAt === "number") {
          // stima offset con il round-trip dell'ultima scrittura nota
          var w = fb._pendingSync && fb._pendingSync[path];
          if (w && data.syncAt > w.t0) { sampleClock(data.syncAt, w.t0, Date.now()); delete fb._pendingSync[path]; }
        }
        cb(data, { id: snap.id });
      }, function (err) {
        log("errore snapshot", err && err.code, err && err.message);
        cb(null, { id: path.split("/").pop(), error: (err && err.code) || "unavailable" });
      });
    },
    listenCol: function (col, filters, cb, opts) {
      var q = fs().collection(col);
      (filters || []).forEach(function (f) { q = q.where(f.field, f.op, f.value); });
      var o = {};
      if (opts && opts.source === "cache") o.source = "cache";
      return q.onSnapshot(o, function (snap) {
        var out = [];
        snap.forEach(function (d) { out.push({ id: d.id, data: unwrapData(d.data()) }); });
        cb(out);
      }, function (err) { cb([], { error: err && err.code }); });
    },
    _pendingSync: {},
    transact: function (path, mutate) {
      fb._pendingSync[path] = { t0: Date.now() };
      var dref = fs().doc(path);
      return fs().runTransaction(function (t) {
        return t.get(dref).then(function (snap) {
          var cur = snap.exists ? unwrapData(snap.data()) : null;
          var patch = mutate(cur ? clone(cur) : null);
          if (patch === false) return { applied: false, data: cur };
          // dentro la transazione si scrive il documento intero ricostruito a mano:
          // niente FieldValue (non consentiti in set all'interno di runTransaction
          // per arrayUnion su campi nuovi) e nessuna dipendenza dall'ordine degli update.
          var next = applyOpsOnPatch(clone(patch), clone(cur || {}));
          t.set(dref, next);
          return { applied: true, data: next };
        });
      }).catch(function (e) {
        if (fb._pendingSync[path]) delete fb._pendingSync[path];
        throw e;
      });
    }
  };

  /* ------------------------------- API pubblica ---------------------------- */
  function backend() {
    var b = detectBackend();
    return b === "firebase" ? fb : fake;
  }

  var api = {
    ops: ops,
    init: function (o) {
      o = o || {};
      Object.keys(o).forEach(function (k) { cfg[k] = o[k]; });
      if (detectBackend() === "fake" && !cfg.relayUrl) {
        // in test il relay è sulla stessa origine dei file
        if (typeof location !== "undefined" && location.port) cfg.relayUrl = location.origin;
      }
      return api;
    },
    backendName: function () { return detectBackend(); },
    /** uid Firebase Auth se il gioco lo ha chiesto (`?auth=anon`), altrimenti null. */
    uid: function () { return uidAttivo; },
    /**
     * Login anonimo opt-in. ritorna `uid` (stringa) o `null` quando non richiesto,
     * quando l'SDK non c'è (backend dei test) o quando il login fallisce: in quel caso
     * il gioco continua a funzionare come prima, senza identità verificata.
     */
    ensureSignedIn: function () {
      if (!authRichiesto()) return Promise.resolve(null);
      if (uidAttivo) return Promise.resolve(uidAttivo);
      if (detectBackend() === "fake") return Promise.resolve(null);
      if (!global.firebase || !global.firebase.auth) {
        return Promise.resolve(null);
      }
      var auth = global.firebase.auth();
      var esistente = auth.currentUser;
      var p = esistente ? Promise.resolve(esistente) : auth.signInAnonymously();
      return p.then(function (user) {
        uidAttivo = user && user.uid ? user.uid : null;
        return uidAttivo;
      }).catch(function () { return null; });
    },

    ready: function () { return Promise.resolve(true); },
    /**
     * Ogni mutazione di gioco passa di qui: scrive e, su errore di rete,
     * rimanda in coda una volta sola (l'operazione è idempotente per progetto).
     */
    get: function (path) { return backend().get(path); },
    set: function (path, data) { return backend().set(path, data); },
    update: function (path, patch) { return backend().update(path, patch); },
    del: function (path) { return backend().del(path); },
    add: function (col, data) { return backend().add(col, data); },
    transact: function (path, mutate) { return backend().transact(path, mutate); },
    onDoc: function (path, cb, opts) { return backend().listenDoc(path, cb, opts); },
    onCol: function (col, filters, cb, opts) { return backend().listenCol(col, filters, cb, opts); },
    clock: clock,
    clockOffset: clockOffsetMs,
    clockSamples: clockSamplesCount,
    sampleClock: sampleClock,
    status: status,
    /** heartbeat presenza, stesso shape già usato dall'hub (`presenze/{NOME}`). */
    presence: function (nome, extra) {
      if (!nome) return function () {};
      var stop = false;
      var un = null;
      function beat() {
        if (stop) return;
        var payload = Object.assign({
          nome: nome,
          last: Date.now(),
          inPartita: false,
          partitaId: null,
          disponibile: (function () { try { return global.localStorage.getItem("disponibile") !== "false"; } catch (e) { return true; } })()
        }, extra || {});
        api.set("presenze/" + nome, payload).catch(function () {});
      }
      beat();
      var t = setInterval(beat, 20000);
      return function () { stop = true; clearInterval(t); if (un) un(); };
    },
    /** util per i test/giochi: applica una patch a un oggetto (stesse semantics ops). */
    applyPatch: function (target, patch) { return applyOpsOnPatch(clone(patch), clone(target || {})); }
  };

  return api;
});
