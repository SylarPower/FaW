/**
 * faw-relay — server di test per FaW.
 *
 * Serve due cose, con un solo processo e zero dipendenze npm:
 *  1) i file statici del repo (come `python3 -m http.server`);
 *  2) un mini backend "stile Firestore" in memoria con le semantiche che i giochi
 *     usano davvero: patch con chiavi dotted, arrayUnion/arrayRemove/increment/
 *     delete, **versione ottimistica (CAS)** per le transazioni e watch via
 *     long-polling, per far sì che più contesti browser separati vedano lo stesso
 *     documento nello stesso ordine di aggiornamenti.
 *
 * NON tocca mai il progetto Firebase reale e non richiede credenziali: i test
 * multiplayer girano qui. `GET /api/time` fornisce un orologio condiviso, così si
 * può verificare la stima dell'offset usata dai giochi.
 *
 * Uso: `node tests/support/faw-relay.js [porta]`
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".mp4": "video/mp4", ".ico": "image/x-icon"
};

/** path -> {version, data} */
const docs = new Map();
let seq = 1;
const watchers = new Set(); // {res, paths:Set, since, timer}

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

function getIn(obj, key) {
  const parts = String(key).split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}
function setIn(obj, key, value) {
  const parts = String(key).split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== "object") cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}
function delIn(obj, key) {
  const parts = String(key).split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null) return;
    cur = cur[parts[i]];
  }
  delete cur[parts[parts.length - 1]];
}

function applyPatch(target, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === "object" && v.__op) {
      const cur = getIn(target, k);
      if (v.__op === "arrayUnion") {
        const arr = Array.isArray(cur) ? cur.slice() : [];
        for (const x of Array.isArray(v.value) ? v.value : [v.value]) if (!arr.includes(x)) arr.push(x);
        setIn(target, k, arr);
      } else if (v.__op === "arrayRemove") {
        const arr = Array.isArray(cur) ? cur.slice() : [];
        for (const x of Array.isArray(v.value) ? v.value : [v.value]) {
          const i = arr.indexOf(x);
          if (i >= 0) arr.splice(i, 1);
        }
        setIn(target, k, arr);
      } else if (v.__op === "increment") {
        setIn(target, k, (typeof cur === "number" ? cur : 0) + v.value);
      } else if (v.__op === "delete") {
        delIn(target, k);
      }
    } else setIn(target, k, v);
  }
  return target;
}

function snapshot(p) {
  const d = docs.get(p);
  return d ? { id: p.split("/").pop(), version: d.version, data: clone(d.data) } : null;
}

function notify() {
  for (const w of [...watchers]) {
    const out = {};
    let touched = false;
    for (const p of w.paths) {
      const cur = docs.get(p);
      const v = cur ? cur.version : -1;
      if (v !== w.seenVersion.get(p)) {
        w.seenVersion.set(p, v);
        touched = true;
        out[p] = snapshot(p);
      }
    }
    if (touched) {
      watchers.delete(w);
      clearTimeout(w.timer);
      json(w.res, 200, { seq, serverNow: Date.now(), docs: out });
    }
  }
}

function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(s),
    "access-control-allow-origin": "*",
    // niente keep-alive: in un test con molti contesti la chiusura dell'socket
    // inattivo da parte del server si scontrava con una richiesta nuova
    // (ERR_CONNECTION_CLOSED) e una scrittura poteva sembrare persa
    "connection": "close",
    "cache-control": "no-store"
  });
  res.end(s);
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => { if (b.length < 4e6) b += c; });
    req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const p = u.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type"
    });
    return res.end();
  }

  if (p === "/api/time") return json(res, 200, { serverNow: Date.now(), seq });

  if (p === "/api/reset" && req.method === "POST") {
    docs.clear(); seq++;
    notify();
    return json(res, 200, { ok: true, serverNow: Date.now(), seq });
  }

  if (p === "/api/get" && req.method === "POST") {
    const body = await readBody(req);
    const out = {};
    for (const path of body.paths || []) out[path] = snapshot(path);
    return json(res, 200, { docs: out, seq, serverNow: Date.now() });
  }

  if (p === "/api/reset" && req.method === "POST") {
    // SOLO per i test: azzera lo store in memoria così ogni test parte pulito
    // (niente presenze o partite lasciate dai test precedenti).
    docs.clear();
    seq += 1;
    notify();   // chi stava già guardando qualcosa riceve subito il nuovo stato
    return json(res, 200, { ok: true, seq, serverNow: Date.now() });
  }

  if (p === "/api/query" && req.method === "POST") {
    const body = await readBody(req);
    const col = String(body.col || "");
    const filters = body.filters || [];
    const out = [];
    const depth = col ? col.split("/").length + 1 : 0;   // figli diretti della collection
    for (const [key, val] of docs) {
      const parts = key.split("/");
      if (parts.length !== depth) continue;
      if (col && key.slice(0, col.length + 1) !== col + "/") continue;
      const data = val.data || {};
      let ok = true;
      for (const f of filters) {
        const v = getIn(data, f.field);
        if (f.op === "in") { if (!f.value.includes(v)) ok = false; }
        else if (f.op === "array-contains") { if (!Array.isArray(v) || !v.includes(f.value)) ok = false; }
        else if (f.op === "==") { if (v !== f.value) ok = false; }
        else if (f.op === "!=") { if (v === f.value) ok = false; }
        else if (f.op === ">") { if (!(v > f.value)) ok = false; }
        else if (f.op === "<") { if (!(v < f.value)) ok = false; }
      }
      if (ok) out.push({ id: key.split("/").pop(), version: val.version, data: clone(val.data) });
    }
    if (body.orderBy) {
      const f = String(body.orderBy.field), dir = body.orderBy.dir === "desc" ? -1 : 1;
      out.sort((a, b) => {
        const va = getIn(a.data || {}, f), vb = getIn(b.data || {}, f);
        return va === vb ? 0 : (va > vb ? dir : -dir);
      });
    }
    if (body.limit) out.length = Math.min(out.length, Number(body.limit) || out.length);
    return json(res, 200, { docs: out, seq, serverNow: Date.now() });
  }

  if (p === "/api/watch") {
    const paths = (u.searchParams.get("paths") || "").split(",").filter(Boolean);
    const since = parseInt(u.searchParams.get("since") || "0", 10);
    const w = { res, paths: new Set(paths), out: {}, seenVersion: new Map(), timer: null };
    // si registrano SOLO i cambiamenti successivi a `since`: lo stato corrente
    // il client lo ha già letto con /api/get
    for (const path of paths) w.seenVersion.set(path, docs.get(path) ? docs.get(path).version : -1);
    watchers.add(w);
    w.timer = setTimeout(() => {
      if (!watchers.has(w)) return;
      watchers.delete(w);
      json(res, 200, { docs: {}, seq, serverNow: Date.now(), timeout: true });
    }, 12000);
    w.timer.unref && w.timer.unref();
    // se nel frattempo qualcosa è già cambiato rispetto a `since`, risponde subito
    if (seq !== since) notify();
    return;
  }

  if (p === "/api/write" && req.method === "POST") {
    const body = await readBody(req);
    const results = [];
    for (const op of body.ops || []) {
      if (!op || !op.path) { results.push({ error: "bad-op" }); continue; }
      const cur = docs.get(op.path);
      if (typeof op.ifVersion === "number" && (cur ? cur.version : 0) !== op.ifVersion) {
        results.push({ error: "conflict", version: cur ? cur.version : 0 });
        continue;
      }
      if (op.delete) {
        docs.delete(op.path);
        seq++;
        results.push({ ok: true, version: 0, deleted: true });
        continue;
      }
      let next;
      if (op.set !== undefined) next = clone(op.set);
      else next = cur ? clone(cur.data) : {};
      if (op.patch) applyPatch(next, op.patch);
      const version = (cur ? cur.version : 0) + 1;
      docs.set(op.path, { version, data: next });
      seq++;
      results.push({ ok: true, version });
    }
    notify();
    return json(res, 200, { results, seq, serverNow: Date.now() });
  }

  // --------------------------- static ---------------------------
  if (req.method !== "GET") return json(res, 405, { error: "method" });
  let file = decodeURIComponent(p);
  if (file === "/" || file === "") file = "/index.html";
  const abs = path.join(ROOT, file);
  if (!abs.startsWith(ROOT)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(abs, (err, buf) => {
    if (err) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("not found: " + file); }
    res.writeHead(200, { "content-type": MIME[path.extname(abs)] || "application/octet-stream", "cache-control": "no-store", "connection": "close" });
    res.end(buf);
  });
});

// watch a lunga scadenza: ogni 700 ms ricontrolla (semplifica i client e basta
// per test con più contesti; non è un server di produzione)
setInterval(notify, 700).unref();

const PORT = parseInt(process.argv[2] || process.env.PORT || "8090", 10);
server.keepAliveTimeout = 2000;
server.requestTimeout = 0;
process.on("uncaughtException", (e) => { console.error("[faw-relay] errore non gestito:", e && e.message); });
process.on("unhandledRejection", (e) => { console.error("[faw-relay] promise:", e && e.message); });
server.listen(PORT, "0.0.0.0", () => {
  console.log("[faw-relay] http://127.0.0.1:" + PORT + " (root: " + ROOT + ")");
});
