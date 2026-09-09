/* =========================================================
   NOMI, COSE, CITTÀ — backend (Focus at Work)

   Due backend con la STESSA interfaccia, così la macchina a stati e
   l'interfaccia non cambiano fra allenamento e sfida:

     subscribe(cb) -> unsub
     applyAtomic(mutator, ctxExtra) -> Promise<{ok}|{aborted}|{failed}>
     apriMieRisposte(round) / apriRisposte(round) / chiudiRisposte()
     salvaRisposte(risposte) -> Promise<{ok}|{aborted}|{failed}>
     getRisposte() / rispostePronte() / statoSalvataggio()
     onRisposte(cb) / onSalvataggio(cb)
     stop()

   MULTIPLAYER (FirebaseBackend)
   - Firebase compat 9.1.1, sintassi db.collection(...).
   - ZERO runTransaction, ZERO BatchGetDocuments: lo stato arriva da
     onSnapshot e le scritture sono update() parziali "ciechi"
     (applyAtomic), come in Ruzzle e Patata Bollente.
   - Riservatezza: le risposte NON stanno nel documento condiviso.
     Durante la compilazione vive un solo documento per giocatore e
     round (partite/<id>/risposte/r1__p0), leggibile in modo sensato
     solo dal proprietario; in revisione i partecipanti leggono la
     query del round. Costo: 1 listener in più e N letture per round.
   - Concorrenza: ActionGate + referente + scaglionamento + backoff
     riducono le collisioni ma NON garantiscono esclusione. La garanzia
     viene dalle guardie nei mutatori (fase/round/esitoId) e dagli ID
     documento con scope di round.

   ALLENAMENTO (SoloBackend)
   - Tutto in memoria: nessun documento partite, presenza o voto viene
     scritto su Firestore.
   ========================================================= */
(function (global) {
  'use strict';

  var core = (typeof module !== 'undefined' && module.exports)
    ? require('./core.js')
    : (global.__NCC_CORE || null);
  if (!core) throw new Error('[NCC] core.js deve essere caricato prima di backend.js');

  var C = core;

  /* ---------------- CHI AGISCE (anti-storm, pattern Patata Bollente) ----------------
     Le azioni di avanzamento le tenta UN client per volta: il "referente"
     agisce subito, gli altri subentrano solo se la situazione resta ferma
     per STUCK_FALLBACK_MS (+ scaglionamento). Ogni fallimento vero allunga
     l'attesa del singolo client (2s → 30s): nessuno martella Firestore.
     Un `aborted` non è un errore: significa che un altro client ha già
     completato la transizione. */
  function ActionGate(opts) {
    var o = opts || {};
    this.stuckMs = o.stuckMs || C.STUCK_FALLBACK_MS;
    this.minRetry = o.minRetry || C.ACTION_RETRY_MIN;
    this.maxRetry = o.maxRetry || C.ACTION_RETRY_MAX;
    this.book = {};
  }
  ActionGate.prototype.mayAct = function (key, info) {
    var now = info.now;
    /* `visti: -1` significa "situazione non ancora osservata": lo 0 sarebbe
       ambiguo con un timestamp reale. */
    var b = this.book[key] || (this.book[key] = { visti: -1, next: 0, retry: this.minRetry });
    if (!info.isReferent) {
      if (b.visti < 0) { b.visti = now; return false; }
      if (now - b.visti <= this.stuckMs + (info.staggerMs || 0)) return false;
    }
    if (now < b.next) return false;
    b.next = now + b.retry;   // prenotazione: un solo tentativo in volo
    return true;
  };
  ActionGate.prototype.ok = function (key) {
    var b = this.book[key];
    if (b) { b.retry = this.minRetry; b.visti = -1; }
  };
  ActionGate.prototype.failed = function (key, res) {
    if (res && (res.ok || res.aborted)) return;
    var b = this.book[key] || (this.book[key] = { visti: -1, next: 0, retry: this.minRetry });
    b.retry = Math.min(b.retry * 2, this.maxRetry);
  };
  ActionGate.prototype.reset = function () { this.book = {}; };

  /* =========================================================
     ALLENAMENTO SOLO — backend in memoria
     ========================================================= */
  function SoloBackend(me, opzioni, opts) {
    this.me = me;
    this.solo = true;
    this.clock = (opts && opts.clock) || function () { return Date.now(); };
    this._subs = new Set();
    this._risposteSubs = new Set();
    this._salvataggioSubs = new Set();
    this._risposte = {};          // { nome: { catId: {raw, norm} } }
    this._tutteCaricate = false;
    this._statoSalvataggio = 'idle';
    this._roundAperto = 0;
    this.scrittureFirestore = 0;  // resta 0: l'allenamento non scrive su Firestore
    this.state = C.normState({
      partecipanti: [me],
      opzioni: opzioni,
      punteggi: {},
      pronti: [me]
    });
  }
  SoloBackend.prototype.subscribe = function (cb) {
    this._subs.add(cb);
    cb(this.state);
    var self = this;
    return function () { self._subs.delete(cb); };
  };
  SoloBackend.prototype._emit = function () {
    var snap = this.state;
    this._subs.forEach(function (cb) { cb(snap); });
  };
  SoloBackend.prototype.applyAtomic = function (mutator, extraCtx) {
    var ctx = Object.assign({ me: this.me, now: this.clock() }, extraCtx || {});
    var up = mutator(this.state, ctx);
    if (!up) return Promise.resolve({ aborted: true });
    if (up.__error) return Promise.resolve({ aborted: true, error: up.__error });
    C.applyPartial(this.state, up);
    this._emit();
    return Promise.resolve({ ok: true });
  };
  SoloBackend.prototype.apriMieRisposte = function (round) {
    if (this._roundAperto !== round) this._risposte = {};   // nuovo round: niente residui
    this._roundAperto = round;
    this._tutteCaricate = false;
    this._emitRisposte();
  };
  SoloBackend.prototype.apriRisposte = function (round) {
    this._roundAperto = round;
    this._tutteCaricate = true;   // in solo le "risposte di tutti" sono le mie
    this._emitRisposte();
  };
  SoloBackend.prototype.chiudiRisposte = function () {
    this._roundAperto = 0;
    this._tutteCaricate = false;
  };
  SoloBackend.prototype.getMieRisposte = function () {
    return JSON.parse(JSON.stringify(this._risposte[this.me] || {}));
  };
  SoloBackend.prototype.salvaRisposte = function (risposte) {
    var rd = this.state.roundData;
    if (!rd || rd.fase !== 'compilazione') {
      // Scrittura tardiva: in allenamento la rifiutiamo come fa il server.
      this._setSalvataggio('rifiutata');
      return Promise.resolve({ aborted: true, error: { code: 'ROUND_CHIUSO' } });
    }
    this._risposte[this.me] = JSON.parse(JSON.stringify(risposte || {}));
    this._setSalvataggio('salvato');
    this._emitRisposte();
    return Promise.resolve({ ok: true });
  };
  SoloBackend.prototype.getRisposte = function () {
    return JSON.parse(JSON.stringify(this._risposte));
  };
  SoloBackend.prototype.rispostePronte = function () { return this._tutteCaricate; };
  SoloBackend.prototype.statoSalvataggio = function () { return this._statoSalvataggio; };
  SoloBackend.prototype.onRisposte = function (cb) {
    this._risposteSubs.add(cb);
    var self = this;
    return function () { self._risposteSubs.delete(cb); };
  };
  SoloBackend.prototype.onSalvataggio = function (cb) {
    this._salvataggioSubs.add(cb);
    cb(this._statoSalvataggio);
    var self = this;
    return function () { self._salvataggioSubs.delete(cb); };
  };
  SoloBackend.prototype._setSalvataggio = function (st) {
    if (this._statoSalvataggio === st) return;
    this._statoSalvataggio = st;
    this._salvataggioSubs.forEach(function (cb) { cb(st); });
  };
  SoloBackend.prototype._emitRisposte = function () {
    var d = this.getRisposte();
    this._risposteSubs.forEach(function (cb) { cb(d); });
  };
  SoloBackend.prototype.stop = function () {
    this._subs.clear();
    this._risposteSubs.clear();
    this._salvataggioSubs.clear();
  };

  /* =========================================================
     MULTIPLAYER — Firebase (zero runTransaction)
     ========================================================= */

  /**
   * Traduce il documento risposte (chiavi `c0`,`c1`… sicure nei dot-path)
   * nella forma usata da core e UI (chiavi = id categoria).
   * Il documento porta con sé l'ordine delle categorie del proprio round,
   * così la traduzione resta corretta anche se la partita è andata avanti.
   */
  function rispostePerCategoria(docData) {
    var out = {};
    var cats = (docData && docData.categorie) || [];
    var src = (docData && docData.risposte) || {};
    Object.keys(src).forEach(function (k) {
      var v = src[k];
      if (!v) return;
      var catId = null;
      var m = /^c(\d+)$/.exec(k);
      if (m) catId = cats[parseInt(m[1], 10)] || k;
      else catId = k;
      out[catId] = { raw: v.raw == null ? '' : String(v.raw), norm: v.norm || C.normalizeWord(v.raw) };
    });
    return out;
  }

  function FirebaseBackend(fsMod, matchId, me) {
    this.fs = fsMod;
    this.db = fsMod();
    this.solo = false;
    this.matchId = matchId;
    this.me = me;
    this.ref = this.db.collection('partite').doc(matchId);
    this.collRisposte = this.ref.collection('risposte');
    this.state = null;
    this._subs = new Set();
    this.unsub = null;
    this.onDead = null;
    this.onError = null;
    // risposte del round corrente
    this._unsubRisposte = null;
    this._roundRisposte = 0;
    this._risposte = {};
    this._mie = {};
    this._tutteCaricate = false;
    this._risposteSubs = new Set();
    this._salvataggioSubs = new Set();
    this._statoSalvataggio = 'idle';
    this._docMio = null;
    this._unsubMio = null;
    this._salvataggiInVolo = 0;
    // backoff anti-429 (stesso schema di Patata Bollente)
    this.rateLimitedUntil = 0;
    this.rateLimitBackoff = C.RATE_LIMIT_BACKOFF_MIN;
    this.rateLimitEpisode = false;
    this.onRateLimit = null;
    this.onRecover = null;
  }

  FirebaseBackend.prototype.start = function () {
    var self = this;
    this.unsub = this.ref.onSnapshot(function (snap) {
      if (!C.docExists(snap)) {
        if (self.onDead) self.onDead();
        return;
      }
      self._rateLimitOk();
      self.state = C.normState(snap.data());
      self.state.__fromCache = !!(snap.metadata && snap.metadata.fromCache);
      self.state.__pending = !!(snap.metadata && snap.metadata.hasPendingWrites);
      self._subs.forEach(function (cb) { cb(self.state); });
    }, function (err) {
      if (C.isRateLimitError(err)) {
        var now = Date.now();
        self.rateLimitedUntil = now + self.rateLimitBackoff;
        self.rateLimitBackoff = Math.min(self.rateLimitBackoff * 2, C.RATE_LIMIT_BACKOFF_MAX);
        if (!self.rateLimitEpisode) {
          self.rateLimitEpisode = true;
          console.warn('[NCC] listener Firestore limitato (429): backoff attivo');
          if (self.onRateLimit) self.onRateLimit(self.rateLimitedUntil - now);
        }
      } else {
        console.error('[NCC] errore listener:', err);
      }
      if (self.onError) self.onError(err);
    });
    return this;
  };

  FirebaseBackend.prototype.subscribe = function (cb) {
    this._subs.add(cb);
    if (this.state) cb(this.state);
    var self = this;
    return function () { self._subs.delete(cb); };
  };

  /* Scrittura cieca senza lettura (modello Ruzzle/Patata): lo stato usato è
     quello già in cache da onSnapshot. Zero BatchGetDocuments.
     Un esito ambiguo di rete NON viene ritentato alla cieca: lo snapshot
     successivo dice la verità e il tick rivaluta la transizione. */
  FirebaseBackend.prototype.applyAtomic = function (mutator, extraCtx) {
    var self = this;
    var state = this.state;
    if (!state) return Promise.resolve({ aborted: true });
    var ctx = Object.assign({ me: this.me, now: Date.now() }, extraCtx || {});
    var up = mutator(state, ctx);
    if (!up) return Promise.resolve({ aborted: true });
    if (up.__error) return Promise.resolve({ aborted: true, error: up.__error });
    C.applyPartial(state, up);   // UI subito coerente, senza attendere il server
    this._subs.forEach(function (cb) { cb(state); });
    return this.ref.update(C.toFirestoreUpdate(up, this.fs))
      .then(function () { self._rateLimitOk(); return { ok: true }; })
      .catch(function (e) { return self._writeError(e, 'update'); });
  };

  /* ---------- RISPOSTE: documento per giocatore e round ---------- */
  /**
   * COMPILAZIONE — ascolto del SOLO documento proprio.
   * Le risposte degli altri non vengono lette: Firestore non nasconde i
   * singoli campi di un documento leggibile, quindi la riservatezza si
   * ottiene tenendole in documenti separati e non aprendo la query.
   */
  FirebaseBackend.prototype.apriMieRisposte = function (round) {
    if (this._roundRisposte === round && this._unsubMio) return;   // già in ascolto
    var cambiaRound = this._roundRisposte !== round;
    this.chiudiRisposte();
    this._roundRisposte = round;
    this._tutteCaricate = false;
    if (cambiaRound) this._mie = {};   // nuovo round: niente risposte del precedente
    var self = this;
    var idx = this._mioIndice();
    if (idx === -1) return;
    this._docMio = this.collRisposte.doc(C.docIdRisposta(round, idx));
    this._unsubMio = this._docMio.onSnapshot(function (snap) {
      if (C.docExists(snap)) {
        self._mie = rispostePerCategoria(snap.data());
      }
      var pending = !!(snap.metadata && snap.metadata.hasPendingWrites);
      if (pending) self._setSalvataggio('in_coda');
      else if (self._statoSalvataggio === 'in_coda') self._setSalvataggio('salvato');
      self._emitRisposte();
    }, function (err) {
      console.error('[NCC] errore listener proprie risposte:', err);
    });
  };

  /**
   * REVISIONE — query del round: un solo listener, N letture.
   * Chiusa (chiudiRisposte) appena il round è congelato.
   */
  FirebaseBackend.prototype.apriRisposte = function (round) {
    if (this._roundRisposte === round && this._unsubRisposte) return;
    this.chiudiRisposte();
    this._roundRisposte = round;
    this._risposte = {};
    this._tutteCaricate = false;
    var self = this;
    this._unsubRisposte = this.collRisposte
      .where('round', '==', round)
      .onSnapshot(function (snap) {
        var out = {};
        snap.forEach(function (doc) {
          var d = doc.data() || {};
          if (!d.giocatore) return;
          out[d.giocatore] = rispostePerCategoria(d);
        });
        self._risposte = out;
        self._tutteCaricate = true;
        self._emitRisposte();
      }, function (err) {
        console.error('[NCC] errore listener risposte:', err);
        if (self.onError) self.onError(err);
      });
  };

  FirebaseBackend.prototype.chiudiRisposte = function () {
    if (this._unsubRisposte) { this._unsubRisposte(); this._unsubRisposte = null; }
    if (this._unsubMio) { this._unsubMio(); this._unsubMio = null; }
    this._roundRisposte = 0;
    this._tutteCaricate = false;
  };

  FirebaseBackend.prototype.getMieRisposte = function () {
    var out = {};
    var src = this._mie;
    Object.keys(src).forEach(function (catId) { out[catId] = { raw: src[catId].raw, norm: src[catId].norm }; });
    return out;
  };

  FirebaseBackend.prototype._mioIndice = function () {
    var rd = this.state && this.state.roundData;
    var lista = (rd && rd.partecipanti && rd.partecipanti.length)
      ? rd.partecipanti
      : (this.state ? this.state.partecipanti : []);
    return lista.indexOf(this.me);
  };

  /**
   * Salvataggio delle proprie risposte.
   * Scrive SOLO il proprio documento (niente documento condiviso) e solo
   * finché il round è in compilazione: una scrittura tardiva è rifiutata.
   */
  FirebaseBackend.prototype.salvaRisposte = function (risposte) {
    var self = this;
    var state = this.state;
    var rd = state && state.roundData;
    if (!rd || rd.fase !== 'compilazione') {
      this._setSalvataggio('rifiutata');
      return Promise.resolve({ aborted: true, error: { code: 'ROUND_CHIUSO' } });
    }
    var idx = this._mioIndice();
    if (idx === -1) {
      this._setSalvataggio('rifiutata');
      return Promise.resolve({ aborted: true, error: { code: 'NON_PARTECIPANTE' } });
    }
    var docId = C.docIdRisposta(rd.round, idx);
    var ref = this.collRisposte.doc(docId);
    // Chiavi `c0`,`c1`… : gli id categoria personalizzati potrebbero non
    // essere sicuri in un dot-path, gli indici lo sono sempre.
    //
    // Le celle vanno in una MAPPA ANNIDATA `risposte: {c0: …}`, non con chiavi
    // "risposte.c0": nell'SDK Firestore 9.1.1 solo update() interpreta le
    // chiavi come dot-path, mentre con set(..., {merge:true}) "risposte.c0"
    // diventerebbe un campo letterale e le risposte sarebbero illeggibili in
    // revisione. Il merge di una mappa annidata è profondo, quindi le celle
    // già salvate non vengono perse.
    var celle = {};
    (rd.categorie || []).forEach(function (catId, ci) {
      var r = (risposte && risposte[catId]) || null;
      celle[C.catKey(ci)] = r
        ? { raw: String(r.raw == null ? '' : r.raw).slice(0, 60), norm: C.normalizeWord(r.raw) }
        : null;
    });
    var update = {
      round: rd.round,
      roundId: rd.id,
      giocatore: this.me,
      indice: idx,
      categorie: (rd.categorie || []).slice(),
      aggiornato: Date.now(),
      risposte: celle
    };
    this._setSalvataggio('salvo');
    this._salvataggiInVolo++;
    return ref.set(update, { merge: true })
      .then(function () {
        self._salvataggiInVolo = Math.max(0, self._salvataggiInVolo - 1);
        self._rateLimitOk();
        if (self._salvataggiInVolo === 0) self._setSalvataggio('salvato');
        return { ok: true };
      })
      .catch(function (e) {
        self._salvataggiInVolo = Math.max(0, self._salvataggiInVolo - 1);
        return self._writeError(e, 'risposte');
      });
  };

  FirebaseBackend.prototype.getRisposte = function () {
    var out = {};
    var src = this._risposte;
    Object.keys(src).forEach(function (nome) {
      var perCat = {};
      Object.keys(src[nome] || {}).forEach(function (catId) {
        var v = src[nome][catId];
        perCat[catId] = { raw: v.raw, norm: v.norm };
      });
      out[nome] = perCat;
    });
    return out;
  };
  FirebaseBackend.prototype.rispostePronte = function () { return this._tutteCaricate; };
  FirebaseBackend.prototype.statoSalvataggio = function () { return this._statoSalvataggio; };
  FirebaseBackend.prototype.onRisposte = function (cb) {
    this._risposteSubs.add(cb);
    var self = this;
    return function () { self._risposteSubs.delete(cb); };
  };
  FirebaseBackend.prototype.onSalvataggio = function (cb) {
    this._salvataggioSubs.add(cb);
    cb(this._statoSalvataggio);
    var self = this;
    return function () { self._salvataggioSubs.delete(cb); };
  };
  FirebaseBackend.prototype._setSalvataggio = function (st) {
    if (this._statoSalvataggio === st) return;
    this._statoSalvataggio = st;
    this._salvataggioSubs.forEach(function (cb) { cb(st); });
  };
  FirebaseBackend.prototype._emitRisposte = function () {
    var d = this.getRisposte();
    /* In compilazione la query non è aperta: si espongono SOLO le proprie
       risposte (ripristino dopo un refresh), mai quelle degli altri. */
    if (!this._tutteCaricate) d[this.me] = this.getMieRisposte();
    this._risposteSubs.forEach(function (cb) { cb(d); });
  };

  FirebaseBackend.prototype._rateLimitOk = function () {
    this.rateLimitedUntil = 0;
    this.rateLimitBackoff = C.RATE_LIMIT_BACKOFF_MIN;
    if (this.rateLimitEpisode) {
      this.rateLimitEpisode = false;
      if (this.onRecover) this.onRecover();
    }
  };
  FirebaseBackend.prototype._writeError = function (e, cosa) {
    if (C.isRateLimitError(e)) {
      var now = Date.now();
      this.rateLimitedUntil = now + this.rateLimitBackoff;
      this.rateLimitBackoff = Math.min(this.rateLimitBackoff * 2, C.RATE_LIMIT_BACKOFF_MAX);
      if (!this.rateLimitEpisode) {
        this.rateLimitEpisode = true;
        console.warn('[NCC] Firestore sta limitando le richieste (429): backoff attivo.');
        if (this.onRateLimit) this.onRateLimit(this.rateLimitedUntil - now);
      }
      if (cosa === 'risposte') this._setSalvataggio('errore');
      return { failed: true, rateLimited: true, error: { code: 'RATE_LIMIT', message: e && e.message } };
    }
    console.error('[NCC] errore ' + cosa + ':', e);
    if (cosa === 'risposte') this._setSalvataggio('errore');
    return { failed: true, error: { code: (e && e.code) ? e.code : 'NET', message: e && e.message } };
  };
  FirebaseBackend.prototype.stop = function () {
    if (this.unsub) { this.unsub(); this.unsub = null; }
    this.chiudiRisposte();
    this._subs.clear();
  };

  /* ---------------- ESPOSIZIONE ---------------- */
  var api = {
    ActionGate: ActionGate,
    SoloBackend: SoloBackend,
    FirebaseBackend: FirebaseBackend,
    rispostePerCategoria: rispostePerCategoria
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.__NCC_BACKEND = api;
})(typeof window !== 'undefined' ? window : globalThis);
