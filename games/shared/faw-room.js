/**
 * FAWRoom — macchina a stati della partita condivisa da Rush e Bomba.
 *
 * Un solo posto per: creazione, invito, lobby, pronto/non pronto, countdown,
 * avvio, chiusura, risultati, abbandono, inattività, rivincita.
 * Ogni gioco aggiunge solo le proprie regole.
 *
 * Stati (campo `stato` del documento `partite/{id}`, nomenclatura già usata da
 * Ruzzle per non rompere l'hub):
 *
 *   attesa    → invito creato, si aspettano accettazione + "pronto"
 *   pronto    → tutti pronti, countdown verso `startAt` (timestamp assoluto)
 *   in_corso  → si gioca; `endsAt` è la scadenza assoluta
 *   chiusura  → un client ha reclamato il calcolo finale (idempotente)
 *   risultati → classifica e statistiche leggibili; si può proporre rivincita
 *   conclusa  → archiviata (l'hub la legge per lo storico)
 *   annullata → annullata da host o scaduta
 *
 * Regole di robustezza implementate qui:
 *  - `startAt`/`endsAt` in tempo server stimato (FAWNet.clock): nessun timer locale
 *    indipendente decide l'esito; i timer locali muovono solo l'animazione.
 *  - scritture ad alta frequenza aggregate (`queue` + flush) — mai un campo
 *    scritto per ogni tocco;
 *  - transazioni con CAS per i passaggi critici (punteggi, reclamo risoluzione);
 *  - operazioni idempotenti tramite `chiave` (id deterministico) e claim con TTL;
 *  - chi non scrive il proprio heartbeat da >25 s è `inattivo`; l'host perso
 *    viene rivendicato da un altro client; i round scaduti vengono risolti da
 *    chiunque, così un cliente morto non blocca il gruppo.
 */
(function (root, factory) {
  var mod = factory(root);
  if (typeof module === "object" && module.exports) module.exports = mod;
  if (root) root.FAWRoom = mod;
})(typeof window !== "undefined" ? window : globalThis, function (global) {
  "use strict";

  var NET = global && global.FAWNet ? global.FAWNet : null;
  var CORE = global && global.FAWCore ? global.FAWCore : null;

  var COLLECTION = "partite";
  var STAGES = ["attesa", "pronto", "in_corso", "chiusura", "risultati", "conclusa", "annullata"];
  var IDLE_MS = 25000;      // nessun heartbeat da così tanto → inattivo
  var HOST_LOST_MS = 45000; // host muto da così tanto → rivendicabile
  var MAX_LOG = 24;
  var FLUSH_MS = 900;

  function now() { return NET ? NET.clock() : Date.now(); }
  function deepClone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

  function seedFrom(id) {
    return CORE ? CORE.hashKey(String(id || "FAW")) : String(id || "FAW");
  }

  /** Costruisce il documento iniziale di una partita. */
  function buildMatch(o) {
    var giocatori = Array.from(new Set(o.giocatori));
    var punteggi = {}, parole = {}, giocatoriMap = {};
    giocatori.forEach(function (n) { punteggi[n] = 0; parole[n] = []; giocatoriMap[n] = { nome: n, visto: now(), pronto: false }; });
    return {
      gioco: o.gioco,
      versione: 2,
      minGiocatori: o.minGiocatori || 2,
      maxGiocatori: o.maxGiocatori || 8,
      stato: "attesa",
      creator: o.creator || giocatori[0],
      host: o.creator || giocatori[0],
      partecipanti: giocatori,
      giocatori: giocatoriMap,
      pronti: [],
      punteggi: punteggi,
      parole: parole,
      opzioni: o.opzioni || {},
      cfg: o.cfg || {},
      seed: o.seed || (CORE ? CORE.shortId("S").slice(0, 8).toUpperCase() : "SEED"),
      createdAt: Date.now(),
      timestamp: Date.now(),
      // c'è solo se il gioco ha chiesto l'identità (FAWNet.ensureSignedIn): null di default,
      // così una regola Firestore può richiedere `request.auth != null` senza rompere i giochi esistenti
      authUid: (global.FAWNet && typeof global.FAWNet.uid === "function" && global.FAWNet.uid()) || null,
      dataOra: new Date().toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
      log: [],
      claim: {},
      round: 0,
      durata: o.durata || 180000,
      startAt: null,
      endsAt: null,
      fine: null,
      rivincitaAccettataDa: [],
      rivincitaRifiutataDa: []
    };
  }

  /** Transizioni legali; tutto il resto è ignorato (aggiornamenti tardivi/fuori ordine). */
  function canMove(from, to) {
    if (from === to) return true;
    if (from === "annullata" || from === "conclusa") return false;
    var i = STAGES.indexOf(from), j = STAGES.indexOf(to);
    if (i < 0 || j < 0) return false;
    if (to === "annullata") return true;
    // La chiusura può saltare gli stati intermedi SOLO da una partita realmente
    // avviata (`pronto` dopo lo startAt o `in_corso`): un match mai iniziato non
    // deve produrre risultati, e `attesa → conclusione` resta vietato.
    if ((from === "pronto" || from === "in_corso") && (to === "chiusura" || to === "risultati" || to === "conclusa")) return true;
    return j === i + 1;
  }

  /**
   * Verifica se un match è "fresco". Oltre la TTL l'hub può nasconderlo e il
   * gioco mostra "stanza terminata" con opzione di rivincita.
   */
  function isStale(data, ttlMs) {
    if (!data) return true;
    if (data.stato === "risultati" || data.stato === "conclusa") return true;
    var limit = ttlMs || 6 * 3600000;
    return (Date.now() - (data.createdAt || 0)) > limit;
  }


  /* --------------------- compat con i doc creati dall'hub ------------------- */

  /**
   * Durata in ms: `durata` del room (ms) oppure `opzioni.durata|tempo` (secondi),
   * così una partita creata dal banner dell'hub funziona senza campi extra.
   */
  function durataMs(data) {
    if (!data) return 180000;
    if (typeof data.durata === "number" && data.durata > 5000) return data.durata;
    var o = data.opzioni || {};
    var sec = parseInt(o.durata || o.tempo || o.roundSeconds || 0, 10);
    if (sec > 0 && sec < 3600) return sec * 1000;
    return 180000;
  }

  function countdownSeconds(cur) {
    var value = Number((cur.opzioni || {}).countdown);
    return Number.isFinite(value) && (cur.opzioni || {}).countdown != null ? Math.max(0, Math.min(10, value)) : 5;
  }

  /** Mappa giocatori tolerant: i doc creati dall'hub hanno solo `partecipanti`. */
  function giocatoriMap(data) {
    var out = {};
    ((data && data.giocatori) || {});
    var nomi = ((data && data.partecipanti) || []).slice();
    Object.keys((data && data.giocatori) || {}).forEach(function (n) { if (nomi.indexOf(n) < 0) nomi.push(n); });
    nomi.forEach(function (n) {
      var g = (data.giocatori || {})[n] || {};
      out[n] = {
        nome: n,
        visto: g.visto || 0,
        pronto: !!(data.pronti || []).length ? (data.pronti || []).indexOf(n) >= 0 : !!g.pronto,
        entraInCorsa: !!g.entraInCorsa,
        uscito: !!g.uscito
      };
    });
    return out;
  }

  /** Fase locale derivata dagli timestamp assoluti (solo animazione/leggibilità). */
  function fase(data, t) {
    if (!data) return "assente";
    t = t == null ? now() : t;
    if (data.stato === "pronto") return t < (data.startAt || 0) ? "countdown" : "gioco";
    if (data.stato === "in_corso") return "gioco";
    if (data.stato === "risultati" || data.stato === "conclusa") return "risultati";
    if (data.stato === "annullata") return "annullata";
    return "lobby";
  }

  /* ------------------------------- istanza ------------------------------- */

  function open(opts) {
    opts = opts || {};
    var net = opts.net || NET;
    var me = opts.nome;
    var matchId = opts.matchId;
    var path = COLLECTION + "/" + matchId;

    var self = {
      id: matchId,
      path: path,
      me: me,
      data: null,
      subs: [],
      pending: null,
      pendingOps: null,
      flushTimer: null,
      hbTimer: null,
      un: null,
      lastErr: null,
      closed: false,
      writing: false
    };

    /* ---- scritture aggregate (throttle) ---- */

    function schedule() {
      if (self.closed || self.flushTimer) return;
      self.flushTimer = setTimeout(function () { self.flushTimer = null; flush(); }, FLUSH_MS);
    }

    /** Accoda un patch (chiavi dotted supportate) e lo scrive al prossimo flush. */
    function queue(patch, ops) {
      if (self.closed) return;
      if (!self.pending) self.pending = {};
      Object.keys(patch || {}).forEach(function (k) { self.pending[k] = patch[k]; });
      if (ops) {
        if (!self.pendingOps) self.pendingOps = {};
        Object.keys(ops).forEach(function (k) {
          var cur = self.pendingOps[k];
          if (cur && cur.__op === "arrayUnion" && ops[k].__op === "arrayUnion") {
            var a = cur.value.slice();
            (Array.isArray(ops[k].value) ? ops[k].value : [ops[k].value]).forEach(function (x) { if (a.indexOf(x) < 0) a.push(x); });
            self.pendingOps[k] = net.ops.arrayUnion(a);
          } else self.pendingOps[k] = ops[k];
        });
      }
      schedule();
    }

    function flush() {
      if (self.writing) return Promise.resolve(false);
      if (self.flushTimer) { clearTimeout(self.flushTimer); self.flushTimer = null; }
      if (!self.pending && !self.pendingOps) return Promise.resolve(false);
      var patch = self.pending, ops = self.pendingOps;
      self.pending = null; self.pendingOps = null;
      var out = {};
      Object.keys(patch || {}).forEach(function (k) { out[k] = patch[k]; });
      Object.keys(ops || {}).forEach(function (k) { out[k] = ops[k]; });
      self.writing = true;
      return net.update(self.path, out).then(function () {
        self.writing = false; self.lastErr = null; emit("status", "online"); return true;
      }).catch(function (e) {
        self.writing = false;
        self.lastErr = e;
        emit("status", "offline");
        // rimetti in coda ciò che non è stato scritto, poi ritenta con backoff
        if (!self.closed) {
          // Le nuove foglie (soprattutto la presenza) prevalgono sul tentativo fallito.
          self.pending = Object.assign({}, patch || {}, self.pending || {});
          var recentOps = self.pendingOps;
          self.pendingOps = ops || {};
          queue({}, recentOps);
        }
        return false;
      });
    }

    /* ---- eventi ---- */

    function emit(kind, payload) {
      self.subs.slice().forEach(function (s) {
        if (s[kind]) { try { s[kind](payload, self.data); } catch (e) { console.warn("[FAWRoom]", kind, e); } }
      });
    }

    function on(handlers) { self.subs.push(handlers); return function () { var i = self.subs.indexOf(handlers); if (i >= 0) self.subs.splice(i, 1); }; }

    /* ---- heartbeat / presenza di partita ---- */

    function heartbeat() {
      if (self.closed || !self.data) return;
      var d = self.data;
      if ((d.partecipanti || []).indexOf(me) < 0 || ["attesa", "pronto", "in_corso"].indexOf(d.stato) < 0) return;
      var visto = now();
      var changed = !d.giocatori || !d.giocatori[me] || Math.abs((d.giocatori[me].visto || 0) - visto) > 8000;
      if (!changed) return;
      queue({ ["giocatori." + me + ".visto"]: visto });
    }

    function inattivi(data) {
      var t = now(), out = [];
      Object.keys((data && data.giocatori) || {}).forEach(function (n) {
        if (n === me) return;
        if (t - ((data.giocatori[n] || {}).visto || 0) > IDLE_MS) out.push(n);
      });
      return out;
    }

    /* ---- transizioni di stato ---- */

    /**
     * Cambia stato in transazione, con guardia di legalità e callback di
     * calcolo. Ritorna {applied, data}.
     */
    function setStage(to, extraFn) {
      if (STAGES.indexOf(to) < 0) return Promise.reject(new Error("stato sconosciuto " + to));
      return net.transact(self.path, function (cur) {
        if (!cur) return false;
        if (!canMove(cur.stato, to)) return false;
        var patch = { stato: to, riv: (cur.riv || 0) + 1 };
        if (to === "pronto") {
          var cd = countdownSeconds(cur);
          patch.startAt = now() + cd * 1000;
          patch.endsAt = patch.startAt + durataMs(cur);
        }
        if (to === "chiusura") patch.closeAt = now();
        if (extraFn) Object.assign(patch, extraFn(cur) || {});
        return patch;
      });
    }

    /**
     * Esegue `work` una sola volta per (chiave, round) nel match.
     * Chi reclama scrive `claim[chiave]=nome+ts`; gli altri lo saltano.
     * Se il reclamante muore, dopo `ttlMs` un altro può riprovare.
     * `work(data)` deve tornare il patch da applicare (o false per niente).
     */
    function resolveOnce(key, work) {
      // Claim e risultato nella STESSA transazione. Il vecchio doppio passaggio
      // scriveva __claim/patch come dati e non controllava mai `fatto`.
      return net.transact(self.path, function (cur) {
        if (!cur || ((cur.claim || {})[key] || {}).fatto) return false;
        var out = work(cur);
        if (out === false) return false;
        var patch = out || {};
        patch["claim." + key] = { by: me, t: now(), fatto: true };
        return patch;
      });
    }

    /**
     * Operazione idempotente "una volta sola" per chiave deterministica
     * (parola inviata, risposta confermata, passaggio bomba).
     *
     *   room.once('parola:ROCCA', function (data) { return patch | false })
     *
     * Se la chiave è già stata consumata il patch non viene applicato: un doppio
     * tocco, un retry di rete o una risposta arrivata dopo la fine del round non
     * producono mai un secondo effetto. Il marcatore viene rimosso alla rivincita
     * perché i nuovi round ripartono da zero (vedi `resetIdem`).
     */
    function once(key, buildPatch) {
      var k = key + ":" + (CORE ? CORE.hashKey(key) : "x");
      return net.transact(self.path, function (cur) {
        if (!cur) return false;
        if ((cur.idem || {})[k]) return false;
        var patch = buildPatch ? buildPatch(cur) : {};
        if (patch === false) return false;
        patch = patch || {};
        patch["idem." + k] = 1;
        return patch;
      }).then(function (r) { return !!(r && r.applied); });
    }

    /** Azzera i marcatori di idempotenza (fine round / rivincita). */
    function resetIdem() {
      queue({ idem: {} });
      return flush();
    }

    /* ---- pronto / lobby ---- */

    function markReady(v) {
      return net.transact(self.path, function (cur) {
        if (!cur || cur.stato !== "attesa" || (cur.partecipanti || []).indexOf(me) < 0) return false;
        var p = cur.pronti || [];
        var has = p.indexOf(me) >= 0;
        if (has === !!v) return false;
        var patch = v
          ? { pronti: net.ops.arrayUnion(me), ["giocatori." + me]: Object.assign({}, (cur.giocatori || {})[me] || {}, { nome: me, pronto: true, visto: now() }) }
          : { pronti: net.ops.arrayRemove(me), ["giocatori." + me]: Object.assign({}, (cur.giocatori || {})[me] || {}, { nome: me, pronto: false, visto: now() }) };
        return patch;
      }).then(function (res) {
        if (res && res.applied && v) return maybeStart().then(function () { return res; });
        return res;
      });
    }

    /** Tutti pronti → passa a `pronto` (countdown). Idempotente. */

    /**
     * Avvia il countdown quando tutti sono pronti. Con `{forza:true, nome:host}`
     * lo start è deciso solo dall'host: chi non era pronto entra comunque (giocherà
     * il tempo rimasto) invece di restare bloccato in una lobby morta.
     */
    function maybeStart(opts) {
      opts = opts || {};
      function transition(cur) {
        if (!cur || cur.stato !== "attesa") return false;
        var tot = (cur.partecipanti || []).length;
        var pronti = (cur.pronti || []).filter(function (n) { return cur.partecipanti.indexOf(n) >= 0; });
        if (tot < (cur.minGiocatori || 2)) return false;
        if (opts.forza) {
          if (cur.host !== me || opts.nome !== me || !tot) return false;
        } else if (pronti.length < tot) return false;
        var cd = countdownSeconds(cur);
        var startAt = now() + cd * 1000;
        var patch = { stato: "pronto", startAt: startAt, endsAt: startAt + durataMs(cur) };
        if (opts.forza) { patch.forzatoDa = opts.nome; patch.pronti = (cur.partecipanti || []).slice(); }
        return patch;
      }
      var lessico = global.FAWLessico;
      if (!lessico || !net.transactMany) return net.transact(self.path, transition);
      return net.transactMany([self.path, lessico.PUB], function (docs) {
        var cur = docs[self.path], patch = transition(cur);
        if (!patch) return false;
        if (["categoria-rush", "bomba-parole"].indexOf(cur.gioco) >= 0 && !cur.lessico) patch.lessico = lessico.forMatch(cur, docs[lessico.PUB]);
        var writes = {}; writes[self.path] = patch; return writes;
      }).then(function (r) { return { applied: r.applied, data: r.data[self.path] }; });
    }

    function addPlayer(nome) {
      if (!nome) return Promise.resolve(false);
      return net.transact(self.path, function (cur) {
        if (!cur || isStale(cur) || ["attesa", "pronto", "in_corso"].indexOf(cur.stato) < 0) return false;
        if ((cur.partecipanti || []).indexOf(nome) >= 0) return false;
        if ((cur.partecipanti || []).length >= (cur.maxGiocatori || 8)) return false;
        var mid = cur.stato === "in_corso" || cur.stato === "pronto" || cur.stato === "chiusura";
        var patch = {
          partecipanti: net.ops.arrayUnion(nome),
          ["punteggi." + nome]: 0,
          ["parole." + nome]: [],
          ["giocatori." + nome]: { nome: nome, visto: now(), pronto: false, entraInCorsa: mid }
        };
        return patch;
      });
    }

    function removePlayer(nome) {
      nome = nome || me;
      return net.transact(self.path, function (cur) {
        if (!cur) return false;
        var restanti = (cur.partecipanti || []).filter(function (n) { return n !== nome; });
        var patch = {
          partecipanti: restanti,
          pronti: (cur.pronti || []).filter(function (n) { return n !== nome; })
        };
        if (cur.stato === "attesa" && restanti.length === 0) {
          // l'ultimo che se ne va in lobby marca la stanza come annullata:
          // l'hub la nasconde e la pulizia resta un'azione esplicita/umana
          patch.stato = "annullata";
          patch.annullataMotivo = "vuota";
        }
        if (cur.host === nome) patch.host = restanti[0] || null;
        return patch;
      });
    }

    /** L'host non risponde: il primo che arriva reclama l'hosting. */
    function claimHost() {
      return net.transact(self.path, function (cur) {
        if (!cur || (cur.partecipanti || []).indexOf(me) < 0 || ["attesa", "pronto", "in_corso"].indexOf(cur.stato) < 0) return false;
        var t = now();
        var hostVisto = ((cur.giocatori || {})[cur.host] || {}).visto || 0;
        if (cur.host === me) return false;
        if (t - hostVisto < HOST_LOST_MS) return false;
        var patch = { host: me, hostClaim: { by: me, t: t } };
        patch["giocatori." + me] = Object.assign({}, (cur.giocatori || {})[me] || {}, { nome: me, visto: t });
        return patch;
      });
    }

    function pushLog(entry) {
      if (self.closed) return;
      queue({ logUltimo: entry });
    }

    /* ---- rivincita ---- */

    var rematchPromise = null;
    function proposeRematch(overrides) {
      if (rematchPromise) return rematchPromise;
      rematchPromise = net.get(self.path).then(function (snap) {
        var base = snap.data;
        if (!base || ["risultati", "conclusa"].indexOf(base.stato) < 0 || (base.partecipanti || []).indexOf(me) < 0) {
          throw new Error("La rivincita si propone a partita finita.");
        }
        if (base.prossimaPartita) return base.prossimaPartita;
        var id = self.id + "_r";
        var opzioni = Object.assign({}, base.opzioni, (overrides && overrides.opzioni) || {});
        delete opzioni.seed; // il seed della partita precedente non deve prevalere sul nuovo
        var nuovo = buildMatch({
          gioco: base.gioco, creator: me,
          giocatori: (overrides && overrides.giocatori) || base.partecipanti,
          opzioni: opzioni, cfg: Object.assign({}, base.cfg, (overrides && overrides.cfg) || {}),
          durata: (overrides && overrides.durata) || base.durata,
          maxGiocatori: base.maxGiocatori, minGiocatori: base.minGiocatori, seed: seedFrom(id)
        });
        nuovo.rivincitaDi = self.id;
        return net.transact(COLLECTION + "/" + id, function (cur) { return cur ? false : nuovo; })
          .then(function () {
            return net.transact(self.path, function (cur) {
              if (!cur || cur.prossimaPartita) return false;
              return { prossimaPartita: id, prossimaPartitaCreataDa: me,
                rivincitaAccettataDa: [me], rivincitaRifiutataDa: [] };
            });
          }).then(function (res) { return (res.data && res.data.prossimaPartita) || id; });
      }).finally(function () { rematchPromise = null; });
      return rematchPromise;
    }

    function acceptRematch() {
      var nxt = self.data && self.data.prossimaPartita;
      if (!nxt) return Promise.resolve(false);
      return net.transact(path, function (cur) {
        if (!cur || !cur.prossimaPartita || (cur.partecipanti || []).indexOf(me) < 0) return false;
        if ((cur.rivincitaAccettataDa || []).indexOf(me) >= 0) return false;
        return { rivincitaAccettataDa: net.ops.arrayUnion(me) };
      }).then(function () { return nxt; });
    }

    function rejectRematch() {
      return net.transact(self.path, function (cur) {
        if (!cur) return false;
        return { rivincitaRifiutataDa: net.ops.arrayUnion(me) };
      });
    }

    function annulla() {
      return net.transact(self.path, function (cur) {
        if (!cur || cur.stato === "conclusa") return false;
        return { stato: "annullata", endsAt: now(), chiusoDa: me };
      });
    }

    /** Archivia i risultati come `conclusa` (l'hub legge `punteggi`). */
    function archive() {
      return net.transact(self.path, function (cur) {
        if (!cur || cur.stato !== "risultati") return false;
        return { stato: "conclusa", conclusoAt: Date.now() };
      });
    }

    /* ---- ticker di watchdog (fine round/parte persi, claim scaduti) ---- */

    function startWatchdog(fn, ms) {
      var t = setInterval(function () {
        if (typeof document !== "undefined" && document.hidden) return;
        try { fn(); } catch (e) {}
      }, ms || 4000);
      self.subs.push({ __timer: t });
      return function () { clearInterval(t); };
    }

    /* ---- sottoscrizione + avvio ---- */

    function start(handlers) {
      if (handlers) on(handlers);
      if (self.un) return self;
      self.un = net.onDoc(self.path, function (data, meta) {
        if (self.closed) return;
        if (data === null && meta && meta.missing) {
          emit("gone", meta);
          return;
        }
        if (meta && meta.error) { self.lastErr = meta.error; emit("status", "offline"); emit("error", meta.error); return; }
        if (!data) return;
        self.lastErr = null;
        self.data = data;
        emit("status", "online");
        emit("state", data);
        heartbeat();
        // all'avvio: se la partita è ferma a metà da una ricarica, riprende
        if (data && data.stato === "attesa" && (data.pronti || []).indexOf(me) >= 0) maybeStart().catch(function () { emit("status", "offline"); });
      });
      self.hbTimer = setInterval(heartbeat, 12000);
      if (global.addEventListener) {
        self._vis = function () { if (!document.hidden) { heartbeat(); flush(); maybeStart().catch(function () { emit("status", "offline"); }); } };
        document.addEventListener("visibilitychange", self._vis);
      }
      return self;
    }

    function stop() {
      self.closed = true;
      if (self.un) self.un();
      clearInterval(self.hbTimer);
      if (self.flushTimer) clearTimeout(self.flushTimer);
      if (self._vis && document) document.removeEventListener("visibilitychange", self._vis);
      self.subs.slice().forEach(function (s) { if (s.__timer) clearInterval(s.__timer); });
      self.subs = [];
    }

    function close() { flush(); stop(); }

    Object.assign(self, {
      queue: queue, flush: flush, on: on, emit: emit,
      setStage: setStage, canMove: canMove, resolveOnce: resolveOnce, once: once, resetIdem: resetIdem,
      markReady: markReady, maybeStart: maybeStart, addPlayer: addPlayer, removePlayer: removePlayer,
      claimHost: claimHost, pushLog: pushLog, inattivi: inattivi,
      proposeRematch: proposeRematch, acceptRematch: acceptRematch, rejectRematch: rejectRematch,
      annulla: annulla, archive: archive, start: start, stop: stop, close: close,
      startWatchdog: startWatchdog, heartbeat: heartbeat
    });
    return self;
  }

  function create(opts) {
    var net = opts.net || NET;
    var id = opts.id || (CORE ? CORE.shortId("M").toUpperCase() : "M" + Date.now());
    var doc = buildMatch(Object.assign({}, opts, { seed: opts.seed || seedFrom(id) }));
    // Scegli prima l'id: una risposta di rete persa non crea una seconda sala.
    return net.transact(COLLECTION + "/" + id, function (cur) { return cur ? false : doc; })
      .then(function () { return id; });
  }

  function remaining(data, field) {
    if (!data) return 0;
    var target = data[field];
    if (!target) return 0;
    return Math.max(0, (target - now()) / 1000);
  }

  return {
    COLLECTION: COLLECTION, STAGES: STAGES, IDLE_MS: IDLE_MS,
    buildMatch: buildMatch, canMove: canMove, isStale: isStale, open: open, create: create,
    remaining: remaining, seedFrom: seedFrom, now: now,
    durataMs: durataMs, giocatoriMap: giocatoriMap, fase: fase
  };
});
