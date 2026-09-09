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
 *   list(col, filters, opts) -> [{id,data}]
 *   transactMany(paths, mutate) -> {applied,data}     data e patch indicizzati per percorso
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
    var q = global.location ? new URLSearchParams(global.location.search) : null;
    var requested = q && q.get("net");
    if (requested === "relay") requested = "fake";
    try {
      if (requested === "fake" || requested === "firebase") {
        // Conserva la scelta anche navigando su inviti/rivincite senza query.
        global.localStorage.setItem("faw:net:backend", requested);
      }
      var forced = requested || global.localStorage.getItem("faw:net:backend");
      if (forced === "fake" || forced === "firebase") {
        if (forced === "fake" && !cfg.relayUrl) cfg.relayUrl = global.location ? global.location.origin : "";
        return forced;
      }
    } catch (e) {
      if (requested === "fake" || requested === "firebase") return requested;
    }
    if (cfg.relayUrl) return "fake";
    if (global.location && LOCALI.test(global.location.hostname)) {
      cfg.relayUrl = global.location.origin;
      return "fake";
    }
    // In produzione uno SDK mancante è un errore, NON un relay inesistente.
    return "firebase";
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
  function relayFetch(path, body, method, signal) {
    var base = (cfg.relayUrl || "").replace(/\/$/, "");
    var payload = body ? JSON.stringify(body) : undefined;
    function unaVolta() {
      var t0 = Date.now();
      return fetch(base + path, {
        method: method || (body ? "POST" : "GET"),
        headers: { "content-type": "application/json" },
        body: payload,
        cache: "no-store", signal: signal
      }).then(function (r) {
        if (!r.ok) throw new Error("relay " + r.status);
        return r.json();
      }).then(function (res) {
        var t1 = Date.now();
        // Un long-poll include attesa sul server: non è una misura del RTT.
        if (res && typeof res.serverNow === "number" && path.indexOf("/api/watch") !== 0) sampleClock(res.serverNow, t0, t1);
        return res;
      });
    }
    // una ritentativa sulle scritture: una risposta persa non deve far sparire
    // una parola o un "pronto" (le operazioni sono idempotenti per progetto)
    return unaVolta().catch(function (e) {
      if (signal && signal.aborted) throw e;
      if (/relay 4|relay 5/.test(String(e && e.message))) throw e;
      return new Promise(function (res) { setTimeout(res, 120); }).then(unaVolta);
    });
  }

  var fakeWatches = [];
  var watchRunning = false;
  var watchTimer = null;
  var watchController = null;
  function restartFakeWatch() {
    clearTimeout(watchTimer);
    // Un nuovo percorso non deve aspettare i 12 secondi del vecchio long-poll.
    // Il finally della richiesta annullata avvia il prossimo giro: mai due loop.
    if (watchController) watchController.abort();
    else fakeWatchLoop();
  }
  function fakeWatchLoop() {
    if (watchRunning || !fakeWatches.length) return;
    clearTimeout(watchTimer);
    var seen = {};
    fakeWatches.forEach(function (w) {
      w.paths.forEach(function (p) { var v = w.seen[p] == null ? -1 : w.seen[p]; seen[p] = seen[p] == null ? v : Math.min(seen[p], v); });
    });
    if (!Object.keys(seen).length) return;
    watchRunning = true;
    var controller = watchController = new AbortController();
    relayFetch("/api/watch?versions=" + encodeURIComponent(JSON.stringify(seen)), null, "GET", controller.signal)
      .then(function (res) {
        var docs = res.docs || {};
        fakeWatches.slice().forEach(function (w) {
          w.paths.forEach(function (p) {
            if (!Object.prototype.hasOwnProperty.call(docs, p)) return;
            var rec = docs[p], version = rec ? rec.version : 0;
            if (w.seen[p] === version) return;
            w.seen[p] = version;
            w.onDoc({ id: p.split("/").pop(), exists: !!rec, data: rec ? rec.data : null, version: version });
          });
        });
        setStatus("online");
        return 0;
      }).catch(function () { if (controller.signal.aborted) return 0; setStatus("offline"); return 1200; })
      .then(function (delay) { watchRunning = false; watchController = null; watchTimer = setTimeout(fakeWatchLoop, delay); });
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
    listenDoc: function (path, cb) {
      var w = {
        paths: [path], seen: {}, onDoc: function (snap) {
          cb(snap.data, { id: snap.id, version: snap.version, missing: !snap.exists });
        }
      };
      fakeWatches.push(w);
      restartFakeWatch();
      return function () {
        var i = fakeWatches.indexOf(w);
        if (i >= 0) fakeWatches.splice(i, 1);
        restartFakeWatch();
      };
    },
    listenCol: function (col, filters, cb, opts) {
      var w = {
        active: true, pulling: false, paths: [], col: col, filters: filters || [], seen: {}, onBatch: function () { w.pull(); }
      };
      w.pull = function () {
        if (!w.active || w.pulling) return;
        w.pulling = true;
        relayFetch("/api/query", { col: col, filters: w.filters, limit: opts && opts.limit }).then(function (r) {
          if (!w.active) return;
          var docs = r.docs || [];
          var versionKey = docs.map(function (d) { return d.id + ":" + d.version; }).join(",");
          if (w.vkey === versionKey) return;
          w.vkey = versionKey;
          cb(docs.map(function (d) { return { id: d.id, data: d.data }; }));
        }).catch(function () { setStatus("offline"); if (w.active) cb([], { error: "unavailable" }); }).then(function () { w.pulling = false; });
      };
      fakeWatches.push(w);
      w.pull();
      w._t = setInterval(w.pull, 900);
      return function () {
        w.active = false;
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
              if (attempt >= 12) { var e = new Error("transazione fallita per conflitti ripetuti"); e.code = "aborted"; throw e; }
              return go();
            }
            return { applied: true, data: next, version: r.results[0].version };
          });
        });
      }
      return go();
    }
  };

  // Transazioni multi-documento: anche i documenti di sola lettura partecipano
  // al controllo di versione. Serve per pubblicare lessico + voto + audit insieme.
  function validateMany(paths, patches) {
    if (!Array.isArray(paths) || !paths.length || paths.length > 8 || new Set(paths).size !== paths.length || paths.some(function (p) { return typeof p !== "string" || !/^[^/]+(?:\/[^/]+)+$/.test(p) || p.split("/").length % 2; })) throw new Error("Percorsi transazione non validi");
    if (patches && Object.keys(patches).some(function (p) { return paths.indexOf(p) < 0; })) throw new Error("Scrittura non dichiarata nella transazione");
  }
  fake.transactMany = function (paths, mutate) {
    validateMany(paths); var tries = 0;
    function step() {
      tries++;
      return relayFetch("/api/get", { paths: paths }).then(function (result) {
        var data = {}, checks = paths.map(function (path) {
          var snap = result.docs[path]; data[path] = snap ? clone(snap.data) : null;
          return { path: path, ifVersion: snap ? snap.version : 0 };
        });
        var patches = mutate(clone(data)); validateMany(paths, patches);
        if (patches === false || !Object.keys(patches || {}).length) return { applied: false, data: data };
        var writes = Object.keys(patches).map(function (path) {
          data[path] = applyOpsOnPatch(clone(patches[path]), clone(data[path] || {}));
          return { path: path, set: data[path] };
        });
        return relayFetch("/api/write", { atomic: true, checks: checks, ops: writes }).then(function (res) {
          if (res.conflict || (res.results || []).some(function (r) { return r.error === "conflict"; })) {
            if (tries < 12) return step();
            var e = new Error("Conflitti ripetuti: riprova"); e.code = "aborted"; throw e;
          }
          if ((res.results || []).some(function (r) { return r.error; })) throw new Error("Scrittura non riuscita");
          return { applied: true, data: data };
        });
      });
    }
    return step();
  };
  fake.list = function (col, filters, opts) {
    return relayFetch("/api/query", { col: col, filters: filters || [], limit: opts && opts.limit }).then(function (r) { return r.docs || []; });
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
      var F = global.firebase.firestore.FieldValue;
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

  function syncStamp(path) {
    var stamp = { t0: Date.now(), token: Math.random().toString(36).slice(2) + Date.now().toString(36) };
    if (path) fb._pendingSync[path] = stamp;
    return stamp;
  }
  function syncFields(stamp) {
    return { syncToken: stamp.token, syncAt: global.firebase.firestore.FieldValue.serverTimestamp() };
  }
  var fb = {
    get: function (path) {
      return fs().doc(path).get().then(function (d) {
        return { id: d.id, exists: d.exists, data: d.exists ? unwrapData(d.data()) : null, version: 0 };
      });
    },
    set: function (path, data) {
      var db = fs(), stamp = syncStamp(path);
      var withSync = Object.assign({}, data, syncFields(stamp));
      return db.doc(path).set(withSync).then(function () {
        return { version: 0 };
      });
    },
    update: function (path, patch, expectVersion) {
      var out = {};
      Object.keys(patch).forEach(function (k) { out[k] = toFirestoreValue(patch[k]); });
      return fs().doc(path).update(out).then(function () { return { version: 0 }; });
    },
    del: function (path) { return fs().doc(path).delete().then(function () { return {}; }); },
    add: function (col, data) {
      var db = fs(), stamp = syncStamp();
      var withSync = Object.assign({}, data, syncFields(stamp));
      return db.collection(col).add(withSync).then(function (r) { fb._pendingSync[col + "/" + r.id] = stamp; return r.id; });
    },
    listenDoc: function (path, cb, opts) {
      var dref = fs().doc(path);
      return dref.onSnapshot({ includeMetadataChanges: false }, function (snap) {
        if (!snap.exists) { cb(null, { id: snap.id, missing: true }); return; }
        var data = unwrapData(snap.data());
        if (data && typeof data.syncAt === "number") {
          // stima offset con il round-trip dell'ultima scrittura nota
          var w = fb._pendingSync && fb._pendingSync[path];
          if (w && data.syncToken === w.token && !(snap.metadata && snap.metadata.hasPendingWrites)) { sampleClock(data.syncAt, w.t0, Date.now()); delete fb._pendingSync[path]; }
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
      if (opts && opts.limit) q = q.limit(opts.limit);
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
      var dref = fs().doc(path);
      return fs().runTransaction(function (t) {
        return t.get(dref).then(function (snap) {
          var cur = snap.exists ? unwrapData(snap.data()) : null;
          var patch = mutate(cur ? clone(cur) : null);
          if (patch === false) return { applied: false, data: cur };
          var next = applyOpsOnPatch(clone(patch), clone(cur || {}));
          var sync = syncFields(syncStamp(path));
          if (snap.exists) {
            var out = Object.assign({}, sync);
            Object.keys(patch).forEach(function (k) { out[k] = toFirestoreValue(patch[k]); });
            t.update(dref, out);
          } else t.set(dref, Object.assign({}, next, sync));
          return { applied: true, data: next };
        });
      }, { maxAttempts: 12 });
    }
  };

  fb.transactMany = function (paths, mutate) {
    validateMany(paths); var db = fs();
    return db.runTransaction(function (tx) {
      return Promise.all(paths.map(function (p) { return tx.get(db.doc(p)); })).then(function (snaps) {
        var data = {};
        paths.forEach(function (p, i) { data[p] = snaps[i].exists ? unwrapData(snaps[i].data()) : null; });
        var patches = mutate(clone(data)); validateMany(paths, patches);
        if (patches === false || !Object.keys(patches || {}).length) return { applied: false, data: data };
        Object.keys(patches).forEach(function (p) {
          var exists = !!data[p], patch = patches[p], sync = syncFields(syncStamp(p));
          data[p] = applyOpsOnPatch(clone(patch), clone(data[p] || {}));
          if (exists) {
            var out = Object.assign({}, sync);
            Object.keys(patch).forEach(function (k) { out[k] = toFirestoreValue(patch[k]); });
            tx.update(db.doc(p), out);
          } else tx.set(db.doc(p), Object.assign({}, data[p], sync));
        });
        return { applied: true, data: data };
      });
    }, { maxAttempts: 12 });
  };
  fb.list = function (col, filters, opts) {
    var q = fs().collection(col);
    (filters || []).forEach(function (f) { q = q.where(f.field, f.op, f.value); });
    if (opts && opts.limit) q = q.limit(opts.limit);
    return q.get().then(function (snap) { var out = []; snap.forEach(function (d) { out.push({ id: d.id, data: unwrapData(d.data()) }); }); return out; });
  };

  /* ------------------------------- API pubblica ---------------------------- */
  function backend() {
    var b = detectBackend();
    return b === "firebase" ? fb : fake;
  }

  // Tutte le API asincrone rigettano una Promise anche se lo SDK non è caricato:
  // i controller devono poter ripristinare i pulsanti nei propri catch/finally.
  function invoke(name, args) {
    return Promise.resolve().then(function () {
      var b = backend();
      return b[name].apply(b, args);
    });
  }
  var api = {
    ops: ops,
    init: function (o) {
      o = o || {};
      Object.keys(o).forEach(function (k) { cfg[k] = o[k]; });
      if (detectBackend() === "fake" && !cfg.relayUrl) {
        // in test il relay è sulla stessa origine dei file
        if (global.location) cfg.relayUrl = global.location.origin;
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
        var u = user && (user.user || user);
        uidAttivo = u && u.uid ? u.uid : null;
        return uidAttivo;
      }).catch(function () { return null; });
    },

    ready: function () { return Promise.resolve().then(function () { if (detectBackend() === "firebase") fs(); return true; }); },
    /**
     * Ogni mutazione di gioco passa di qui: scrive e, su errore di rete,
     * rimanda in coda una volta sola (l'operazione è idempotente per progetto).
     */
    get: function (path) { return invoke("get", [path]); },
    set: function (path, data) { return invoke("set", [path, data]); },
    update: function (path, patch) { return invoke("update", [path, patch]); },
    del: function (path) { return invoke("del", [path]); },
    add: function (col, data) { return invoke("add", [col, data]); },
    transact: function (path, mutate) { return invoke("transact", [path, mutate]); },
    transactMany: function (paths, mutate) { return invoke("transactMany", [paths, mutate]); },
    list: function (col, filters, opts) { return invoke("list", [col, filters, opts]); },
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
