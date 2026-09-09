"use strict";

/**
 * Test double dello SDK compat, NON di FAWNet: FieldValue esiste solo sul
 * namespace firebase.firestore, come nello SDK vero. Le transazioni usano il CAS
 * del relay, i listener consegnano snapshot interi e rispettano unsubscribe.
 * Servito al posto dello script CDN: una pagina che dimentica di caricare Firebase
 * fallisce davvero, a differenza dell'iniezione indiscriminata via addInitScript.
 */
function shimFirebase() {
  const W = window;
  const newId = () => "F" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const post = async (url, body) => {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
    if (!r.ok) throw new Error("relay " + r.status);
    return r.json();
  };
  const get1 = (path) => post("/api/get", { paths: [path] }).then(r => r.docs[path]);
  class DocSnap {
    constructor(id, rec) { this.id = id; this.rec = rec; this.exists = !!rec; }
    data() { return this.rec ? structuredClone(this.rec.data) : undefined; }
  }
  class QuerySnap {
    constructor(docs) { this.docs = docs; this.size = docs.length; this.empty = !docs.length; }
    forEach(fn) { this.docs.forEach(fn); }
  }
  class DocRef {
    constructor(path) { this.path = path; this.id = path.split("/").pop(); }
    collection(name) { return new ColRef(this.path + "/" + name); }
    get() { return get1(this.path).then(rec => new DocSnap(this.id, rec)); }
    set(data) { return post("/api/write", { ops: [{ path: this.path, set: data }] }); }
    update(patch) { return post("/api/write", { ops: [{ path: this.path, patch }] }); }
    delete() { return post("/api/write", { ops: [{ path: this.path, delete: true }] }); }
    onSnapshot(options, cb, error) {
      if (typeof options === "function") { error = cb; cb = options; }
      return watch(() => get1(this.path).then(rec => ({ key: rec ? rec.version : 0, snap: new DocSnap(this.id, rec) })), cb, error);
    }
  }
  class ColRef {
    constructor(name, filters = []) { this.name = name; this.filters = filters; }
    where(field, op, value) { return new ColRef(this.name, this.filters.concat({ field, op, value })); }
    orderBy(field, dir = "asc") { const c = new ColRef(this.name, this.filters); c.order = { field, dir }; return c; }
    limit(n) { const c = new ColRef(this.name, this.filters); c.count = n; c.order = this.order; return c; }
    doc(id = newId()) { return new DocRef(this.name + "/" + id); }
    add(data) { const r = this.doc(); return r.set(data).then(() => r); }
    query() { return post("/api/query", { col: this.name, filters: this.filters, orderBy: this.order, limit: this.count }); }
    get() { return this.query().then(r => new QuerySnap(r.docs.map(d => new DocSnap(d.id, d)))); }
    onSnapshot(options, cb, error) {
      if (typeof options === "function") { error = cb; cb = options; }
      return watch(() => this.query().then(r => ({ key: r.docs.map(d => d.id + ":" + d.version).join(","), snap: new QuerySnap(r.docs.map(d => new DocSnap(d.id, d))) })), cb, error);
    }
  }
  const listeners = new Set();
  W.__firebaseListenerCount = () => listeners.size;
  function watch(pull, cb, error) {
    const l = { active: true, pulling: false, key: null };
    listeners.add(l);
    async function run() {
      if (!l.active || l.pulling) return;
      l.pulling = true;
      try {
        const r = await pull();
        if (l.active && l.key !== r.key) { l.key = r.key; cb(r.snap); }
      } catch (e) { if (l.active && error) error(e); else (W.__shimErrors ||= []).push(e.message); }
      finally { l.pulling = false; }
    }
    const t = setInterval(run, 120);
    run();
    return () => { l.active = false; clearInterval(t); listeners.delete(l); };
  }
  const db = {
    collection: name => new ColRef(name), doc: path => new DocRef(path), settings: () => {},
    runTransaction: async (work, options = {}) => {
      W.__firebaseTransactions = (W.__firebaseTransactions || 0) + 1;
      for (let attempt = 0; attempt < (options.maxAttempts || 10); attempt++) {
        const versions = new Map(), writes = [];
        const result = await work({
          get: async ref => { const rec = await get1(ref.path); versions.set(ref.path, rec ? rec.version : 0); return new DocSnap(ref.id, rec); },
          set: (ref, data) => writes.push({ path: ref.path, set: data, ifVersion: versions.get(ref.path) }),
          update: (ref, patch) => writes.push({ path: ref.path, patch, ifVersion: versions.get(ref.path) })
        });
        if (!writes.length) return result;
        const response = await post("/api/write", { atomic: true, checks: [...versions].map(([path, ifVersion]) => ({ path, ifVersion })), ops: writes });
        if (response.results.every(r => r.error !== "conflict")) return result;
      }
      throw new Error("Conflitti ripetuti");
    },
    batch: () => {
      const ops = [];
      return { delete: ref => ops.push({ path: ref.path, delete: true }), set: (ref, data) => ops.push({ path: ref.path, set: data }), update: (ref, patch) => ops.push({ path: ref.path, patch }), commit: () => post("/api/write", { ops }) };
    }
  };
  const firestore = () => db;
  firestore.FieldValue = {
    arrayUnion: (...value) => ({ __op: "arrayUnion", value }),
    arrayRemove: (...value) => ({ __op: "arrayRemove", value }),
    increment: value => ({ __op: "increment", value }),
    delete: () => ({ __op: "delete" }), serverTimestamp: () => Date.now()
  };
  W.firebase = {
    apps: [], firestore,
    initializeApp: () => { const app = {}; W.firebase.apps.push(app); return app; },
    auth: () => ({ signInAnonymously: () => Promise.resolve({ user: { uid: "test-anon" } }) })
  };
  W.__firebaseCompatLoaded = true;
}

module.exports = { shimFirebase };
