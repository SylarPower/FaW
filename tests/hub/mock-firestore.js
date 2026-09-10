/* Mock Firestore per i test dell'hub (index.html).
   La funzione creaMockFirestore viene SERIALIZZATA dentro la pagina
   (window.__makeDb__ = creaMockFirestore.toString()), quindi il suo corpo deve
   restare autonomo: niente require, niente riferimenti allo scope esterno.

   Rispetto al mock "storico" del test di login qui le query filtrano davvero
   (array-contains / == / in / != / >), i listener riemettono quando i documenti
   cambiano e le scritture vengono applicate ai documenti (arrayUnion,
   arrayRemove, delete): cosi' si puo' misurare il comportamento in tempo reale
   degli inviti senza un progetto Firebase vero. */
'use strict';

function creaMockFirestore(passwordHash, nomeUtente) {
  const utente = nomeUtente || 'TEST';
  const docs = {
    utenti: [{ id: utente, __obj: { passwordHash: passwordHash } }],
    partite: [],
    pictionary_rooms: [],
    presenze: [],
    amicizie: []
  };
  const scritture = [];
  const queryLog = [];
  const listeners = [];
  const contatori = { letture: 0, snapshot: 0, scritture: 0 };
  let erroreQuery = null;      // { messaggio } -> forza il ramo di errore
  let seqAdd = 0;

  /* I documenti possono essere inseriti dai test in due forme:
     { id, data: () => ({...}) } oppure { id, campo: valore, ... }. */
  function normalizza(nome) {
    const arr = docs[nome] || (docs[nome] = []);
    arr.forEach((d, i) => {
      if (d && typeof d === 'object' && typeof d.__obj === 'undefined') {
        const id = d.id || (nome.toUpperCase() + '-' + (i + 1));
        const obj = typeof d.data === 'function' ? d.data() : Object.assign({}, d);
        delete obj.id;
        arr[i] = { id: id, __obj: obj, data: function () { return this.__obj; } };
      }
    });
    return arr;
  }

  function rispetta(obj, filtri) {
    return filtri.every((f) => {
      const v = obj[f.campo];
      if (f.op === 'array-contains') return Array.isArray(v) && v.indexOf(f.valore) !== -1;
      if (f.op === '==') return v === f.valore;
      if (f.op === '!=') return v !== undefined && v !== f.valore;
      if (f.op === 'in') return Array.isArray(f.valore) && f.valore.indexOf(v) !== -1;
      if (f.op === '>') return v > f.valore;
      if (f.op === '<') return v < f.valore;
      return true;
    });
  }

  function snapshot(nome, filtri) {
    const list = normalizza(nome).filter((d) => rispetta(d.__obj, filtri));
    return {
      size: list.length,
      empty: list.length === 0,
      docs: list,
      forEach: (fn) => list.forEach(fn),
      docChanges: () => []
    };
  }

  function emetti(nome) {
    listeners.filter((l) => l.nome === nome && !l.morto).forEach((l) => {
      contatori.snapshot++;
      l.cb(snapshot(nome, l.filtri));
    });
  }

  function applica(nome, id, patch) {
    const d = normalizza(nome).find((x) => x.id === id);
    if (!d) return false;
    Object.keys(patch).forEach((k) => {
      const v = patch[k];
      if (v && v.__op === 'array-union') {
        const arr = Array.isArray(d.__obj[k]) ? d.__obj[k].slice() : [];
        v.args.forEach((a) => { if (arr.indexOf(a) === -1) arr.push(a); });
        d.__obj[k] = arr;
      } else if (v && v.__op === 'array-remove') {
        const arr = Array.isArray(d.__obj[k]) ? d.__obj[k] : [];
        d.__obj[k] = arr.filter((a) => v.args.indexOf(a) === -1);
      } else if (v && v.__op === 'delete') {
        delete d.__obj[k];
      } else {
        d.__obj[k] = v;
      }
    });
    return true;
  }

  function descrivi(nome, filtri) {
    return nome + (filtri.length ? ' where ' + filtri.map((f) => f.campo + ' ' + f.op + ' ' + JSON.stringify(f.valore)).join(' and ') : '');
  }

  function query(nome, filtri) {
    const q = {
      where: function (campo, op, valore) {
        return query(nome, filtri.concat([{ campo: campo, op: op, valore: valore }]));
      },
      get: async function () {
        queryLog.push({ tipo: 'get', nome: nome, filtri: filtri, testo: descrivi(nome, filtri) });
        contatori.letture++;
        return snapshot(nome, filtri);
      },
      onSnapshot: function (cb, err) {
        queryLog.push({ tipo: 'listener', nome: nome, filtri: filtri, testo: descrivi(nome, filtri) });
        const haFiltroStato = filtri.some((f) => f.campo === 'stato');
        const l = { nome: nome, filtri: filtri, cb: cb, err: err, morto: false };
        listeners.push(l);
        setTimeout(() => {
          if (l.morto) return;
          if (erroreQuery && haFiltroStato) {
            listeners.splice(listeners.indexOf(l), 1);
            l.morto = true;
            if (typeof err === 'function') err(new Error(erroreQuery.messaggio));
            return;
          }
          contatori.snapshot++;
          cb(snapshot(nome, filtri));
        }, 0);
        return function () {
          l.morto = true;
          const i = listeners.indexOf(l);
          if (i !== -1) listeners.splice(i, 1);
        };
      }
    };
    return q;
  }

  const db = {
    collection: function (nome) {
      if (!docs[nome]) docs[nome] = [];
      const q = query(nome, []);
      q.doc = function (id) {
        return {
          id: id,
          get: async function () {
            contatori.letture++;
            const d = normalizza(nome).find((x) => x.id === id);
            return {
              exists: !!d,
              id: id,
              data: function () { return d ? Object.assign({}, d.__obj) : undefined; }
            };
          },
          set: async function (data) {
            contatori.scritture++;
            scritture.push({ coll: nome, id: id, data: data });
            const arr = normalizza(nome);
            const trovato = arr.find((x) => x.id === id);
            if (trovato) trovato.__obj = Object.assign({}, data);
            else arr.push({ id: id, __obj: Object.assign({}, data), data: function () { return this.__obj; } });
            emetti(nome);
          },
          update: async function (patch) {
            contatori.scritture++;
            scritture.push({ coll: nome, id: id, update: patch });
            applica(nome, id, patch);
            emetti(nome);
          },
          delete: async function () {
            contatori.scritture++;
            scritture.push({ coll: nome, id: id, delete: true });
            const arr = normalizza(nome);
            const i = arr.findIndex((x) => x.id === id);
            if (i !== -1) arr.splice(i, 1);
            emetti(nome);
          }
        };
      };
      q.add = async function (data) {
        contatori.scritture++;
        seqAdd++;
        const id = 'NUOVA-' + seqAdd;
        scritture.push({ coll: nome, id: id, add: data });
        normalizza(nome).push({ id: id, __obj: Object.assign({}, data), data: function () { return this.__obj; } });
        emetti(nome);
        return { id: id };
      };
      return q;
    }
  };

  /* --- API di test --- */
  db.__docs = docs;
  db.__scritture = scritture;
  db.__queryLog = queryLog;
  db.__contatori = contatori;
  /* sostituisce i documenti di una collezione e riemette i listener */
  db.__setDocs = function (nome, list) { docs[nome] = list || []; normalizza(nome); emetti(nome); };
  /* aggiunge un documento ({ id, ...campi } oppure { id, data: () => ({}) }) */
  db.__pushDoc = function (nome, doc) {
    const arr = normalizza(nome);
    const id = doc.id || (nome.toUpperCase() + '-' + (arr.length + 1));
    const obj = typeof doc.data === 'function' ? doc.data() : Object.assign({}, doc);
    delete obj.id;
    arr.push({ id: id, __obj: obj, data: function () { return this.__obj; } });
    emetti(nome);
    return id;
  };
  db.__updateDoc = function (nome, id, patch) {
    const ok = applica(nome, id, patch);
    if (ok) emetti(nome);
    return ok;
  };
  db.__deleteDoc = function (nome, id) {
    const arr = normalizza(nome);
    const i = arr.findIndex((x) => x.id === id);
    if (i !== -1) arr.splice(i, 1);
    emetti(nome);
  };
  db.__emit = emetti;
  /* forza il ramo di errore dei listener/query con filtro su "stato"
     (indice composito mancante) per provare il ripiego */
  db.__forzaErroreQuery = function (messaggio) { erroreQuery = { messaggio: messaggio || 'The query requires an index.' }; };
  db.__azzeraContatori = function () { contatori.letture = 0; contatori.snapshot = 0; };
  return db;
}

module.exports = { creaMockFirestore };
