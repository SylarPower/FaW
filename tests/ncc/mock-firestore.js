/* Mock Firestore "compat" per i test E2E di Nomi, Cose, Città.
   Espone la stessa superficie usata dai giochi FaW:
   db.collection(x).doc(id).{onSnapshot,update,set,get}
   db.collection(x).doc(id).collection(y)...
   db.collection(x).where(f,'==',v).onSnapshot(...)
   firebase.firestore.FieldValue.{arrayUnion,arrayRemove,delete}
   Con contatori di letture/scritture per le verifiche di quota. */
'use strict';

function setPath(obj, path, value) {
  const parts = String(path).split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (value && value.__op === 'delete') delete cur[last];
  else if (value && value.__op === 'union') {
    if (!Array.isArray(cur[last])) cur[last] = [];
    (value.items || []).forEach((it) => {
      const sig = JSON.stringify(it);
      if (!cur[last].some((x) => JSON.stringify(x) === sig)) cur[last].push(it);
    });
  } else if (value && value.__op === 'remove') {
    if (!Array.isArray(cur[last])) return;
    const firme = (value.items || []).map((it) => JSON.stringify(it));
    cur[last] = cur[last].filter((x) => firme.indexOf(JSON.stringify(x)) === -1);
  } else cur[last] = value;
}

function createMockFirestore() {
  const m = {
    store: new Map(),
    subs: new Map(),
    readsGet: 0,
    readsListener: 0,
    writes: 0
  };

  function clone(d) { return d === undefined ? undefined : JSON.parse(JSON.stringify(d)); }

  function notifyDoc(p) {
    const subs = m.subs.get(p);
    if (!subs || !subs.size) return;
    const doc = m.store.get(p);
    const snap = { exists: !!doc, data: () => clone(doc), metadata: { fromCache: false, hasPendingWrites: false } };
    subs.forEach((cb) => queueMicrotask(() => cb(snap)));
  }
  function queryKey(prefix, field, value) { return 'Q:' + prefix + ':' + field + '=' + value; }
  function hits(prefix, field, value) {
    const out = [];
    m.store.forEach((doc, p) => {
      if (p.indexOf(prefix + '/') !== 0) return;
      if (p.slice(prefix.length + 1).indexOf('/') !== -1) return;   // solo figli diretti
      if (doc[field] !== value) return;
      out.push({ id: p.split('/').pop(), data: () => clone(doc) });
    });
    return out;
  }
  function notifyQuery(prefix, field, value) {
    const subs = m.subs.get(queryKey(prefix, field, value));
    if (!subs || !subs.size) return;
    const list = hits(prefix, field, value);
    const snap = { forEach: (fn) => list.forEach(fn), size: list.length, docs: list };
    subs.forEach((cb) => queueMicrotask(() => cb(snap)));
  }
  function applyPatch(p, patch, merge) {
    const doc = merge ? (m.store.get(p) || {}) : {};
    Object.keys(patch).forEach((k) => {
      const v = patch[k];
      if (v && v.__mockDelete) setPath(doc, k, { __op: 'delete' });
      else if (v && v.__mockUnion) setPath(doc, k, { __op: 'union', items: v.__mockUnion });
      else if (v && v.__mockRemove) setPath(doc, k, { __op: 'remove', items: v.__mockRemove });
      else setPath(doc, k, v);
    });
    m.store.set(p, doc);
    notifyDoc(p);
    const sub = /^(.*\/risposte)\/[^/]+$/.exec(p);
    if (sub && doc.round !== undefined) notifyQuery(sub[1], 'round', doc.round);
    else if (!sub && doc.roundData && doc.roundData.round !== undefined) {
      /* il documento partita non è in query: nessuna notifica aggiuntiva */
    }
  }

  function collection(prefix) {
    return {
      doc(id) {
        const p = prefix + '/' + id;
        return {
          id,
          path: p,
          collection: (sub) => collection(p + '/' + sub),
          get() {
            m.readsGet++;
            const doc = m.store.get(p);
            return Promise.resolve({ exists: !!doc, data: () => clone(doc) });
          },
          onSnapshot(cb) {
            const s = m.subs.get(p) || new Set();
            s.add(cb);
            m.subs.set(p, s);
            if (m.store.has(p)) m.readsListener++;
            const doc = m.store.get(p);
            queueMicrotask(() => cb({
              exists: !!doc,
              data: () => clone(doc),
              metadata: { fromCache: false, hasPendingWrites: false }
            }));
            return () => s.delete(cb);
          },
          update(patch) { m.writes++; applyPatch(p, patch, true); return Promise.resolve(); },
          set(data, opts) { m.writes++; applyPatch(p, data, !!(opts && opts.merge)); return Promise.resolve(); },
          delete() { m.writes++; m.store.delete(p); notifyDoc(p); return Promise.resolve(); }
        };
      },
      where(field, op, value) {
        return {
          onSnapshot(cb) {
            const key = queryKey(prefix, field, value);
            const s = m.subs.get(key) || new Set();
            s.add(cb);
            m.subs.set(key, s);
            const list = hits(prefix, field, value);
            m.readsListener += list.length;
            queueMicrotask(() => cb({ forEach: (fn) => list.forEach(fn), size: list.length, docs: list }));
            return () => s.delete(cb);
          }
        };
      }
    };
  }

  const db = {
    collection: (name) => collection(name),
    enableIndexedDbPersistence: () => Promise.resolve(false)
  };
  m.db = db;
  m.collection = collection;
  m.FieldValue = {
    arrayUnion: (...items) => ({ __mockUnion: items }),
    arrayRemove: (...items) => ({ __mockRemove: items }),
    delete: () => ({ __mockDelete: true })
  };
  return m;
}

/* Costruisce l'oggetto `firebase` compat da iniettare in una finestra jsdom. */
function makeFirebaseGlobal(mock) {
  const firestore = () => mock.db;
  firestore.FieldValue = mock.FieldValue;
  return {
    apps: [],
    initializeApp: () => ({}),
    firestore
  };
}

module.exports = { createMockFirestore, makeFirebaseGlobal };
