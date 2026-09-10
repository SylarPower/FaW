/* =========================================================
   NOMI, COSE, CITTÀ — interfaccia (Focus at Work)

   Solo DOM ed eventi: la logica sta in core.js, l'accesso ai dati
   in backend.js. Ogni schermata viene RICOSTRUITA dallo stato
   condiviso (onSnapshot), quindi un refresh a metà partita non
   avvia un nuovo round e non azzera quello corrente.

   Nessun audio e nessuna vibrazione: solo feedback visivi.
   ========================================================= */
(function (global) {
  'use strict';

  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  var C = global.__NCC_CORE;
  var B = global.__NCC_BACKEND;
  if (!C || !B) {
    console.error('[NCC] core.js/backend.js non caricati');
    return;
  }

  /* ---------------- COSTANTI UI ---------------- */
  var SALVA_DEBOUNCE_MS = 1200;   // salvataggio progressivo
  var STATS_KEY = 'funatwork_daily_stats';
  var STATS_GIOCO = 'ncc';
  var AVATAR_COLORS = ['#ddd6fe', '#bae6fd', '#bbf7d0', '#fecdd3', '#fde68a', '#99f6e0', '#fed7aa', '#fecaca'];

  /* ---------------- STATO APPLICATIVO ---------------- */
  var urlParams = new URLSearchParams(window.location.search);
  var matchId = urlParams.get('matchId');
  var solo = !matchId;
  var me = localStorage.getItem('mioNome') || (solo ? 'GIOCATORE' : '');

  var G = {
    solo: solo,
    matchId: matchId,
    me: me,
    db: null,
    fs: null,
    backend: null,
    state: null,
    testoBase: null,          // dizionario.txt: serve al riallineamento override
    dizionario: null,
    dictBloccato: false,
    dictAllineamentoInCorso: false,
    dictTentativi: 0,
    busy: false,
    gate: null,
    campi: {},                // catId -> testo digitato
    touched: {},              // catId -> modificato dall'utente (non sovrascrivere)
    roundAperto: 0,
    saveTimer: null,
    risposteViste: {},
    risposteSolo: {},
    annullateManuali: [],     // solo allenamento (mai condivise)
    listenerKey: '',
    prevRound: 0,
    prevFase: null,
    statsSaved: false,
    redirected: false,
    rateLimited: false,
    ultimoStatoSalvataggio: 'idle'
  };

  /* ---------------- ELEMENTI ---------------- */
  var $ = function (id) { return document.getElementById(id); };
  var el = {};
  ['screen-loading', 'load-status', 'load-count', 'app', 'dict-badge', 'round-badge',
    'screen-lobby', 'cfg-round', 'cfg-tempo', 'cfg-revisione', 'cfg-mode', 'lobby-cats',
    'lobby-players', 'lobby-status', 'lobby-status-text', 'btn-start-solo', 'lobby-hint',
    'screen-gioco', 'lettera-tile', 'timer-num', 'timer-label', 'timer-fill', 'fase-chip',
    'risposte-card', 'risposte-progress', 'campi', 'save-state', 'btn-stop', 'risposte-hint',
    'giocatori', 'punteggi', 'storico',
    'overlay-revisione', 'rev-round', 'rev-lettera', 'rev-timer-num', 'rev-timer-fill',
    'rev-voti', 'rev-body', 'conf-progress', 'btn-conferma',
    'overlay-risultati', 'res-round', 'res-classifica', 'res-body', 'res-countdown',
    'overlay-fine', 'fine-emoji', 'fine-title', 'fine-sub', 'podio', 'fine-dettaglio',
    'fine-top-actions', 'fine-stats', 'btn-rivincita', 'banner', 'toast'
  ].forEach(function (id) { el[id] = $(id); });

  /* ---------------- UTILITY UI ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function avatarColor(name) {
    var h = 0;
    for (var i = 0; i < String(name).length; i++) h = (h * 31 + String(name).charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }
  function avatar(nome) {
    return '<span class="avatar" style="background:' + avatarColor(nome) + '">' +
      esc(String(nome).slice(0, 2).toUpperCase()) + '</span>';
  }
  function secondiTra(a, b) { return Math.max(0, Math.ceil((a - b) / 1000)); }
  /* Gli id categoria sono già [A-Za-z0-9] (safeId in core.js): qui si rimuove
     comunque qualsiasi carattere non sicuro prima di usarli nei selettori. */
  function sel(id) { return String(id == null ? '' : id).replace(/[^A-Za-z0-9_-]/g, ''); }

  /** Payload di salvataggio: testo originale + normalizzato, per categoria. */
  function rispostePayload() {
    var rd = G.state && G.state.roundData;
    var out = {};
    if (!rd) return out;
    rd.categorie.forEach(function (catId) {
      var t = String(G.campi[catId] == null ? '' : G.campi[catId]);
      out[catId] = { raw: t, norm: C.normalizeWord(t) };
    });
    return out;
  }

  var toastTimer = null;
  function toast(msg, kind) {
    el.toast.textContent = msg;
    el.toast.className = 'toast' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.className = 'toast hidden'; }, 2800);
  }
  var bannerTimer = null;
  function banner(opts) {
    el.banner.innerHTML =
      '<span class="b-emoji">' + (opts.icon || '📝') + '</span>' +
      '<div class="b-text"><div class="b-title">' + esc(opts.title) + '</div>' +
      (opts.subtitle ? '<div class="b-sub">' + esc(opts.subtitle) + '</div>' : '') + '</div>' +
      '<div class="b-actions">' +
      (opts.spinner ? '<span class="spinner"></span>' : '') +
      (opts.buttons || []).map(function (b) {
        return '<button class="btn btn-sm ' + (b.kind || 'btn-ghost') + '" data-bid="' + esc(b.id) + '">' + esc(b.label) + '</button>';
      }).join('') +
      '</div>';
    el.banner.classList.remove('hidden');
    (opts.buttons || []).forEach(function (b) {
      var btn = el.banner.querySelector('[data-bid="' + b.id + '"]');
      if (btn) btn.addEventListener('click', b.fn);
    });
    if (global.FAW_SYNC_BANNER_SPACE) global.FAW_SYNC_BANNER_SPACE();
    clearTimeout(bannerTimer);
    if (opts.sticky !== true) {
      bannerTimer = setTimeout(function () { hideBanner(); }, 6000);
    }
  }
  function hideBanner() {
    clearTimeout(bannerTimer);
    el.banner.classList.add('hidden');
    if (global.FAW_SYNC_BANNER_SPACE) global.FAW_SYNC_BANNER_SPACE();
  }
  function setLoadStatus(msg, isErr) {
    el['load-status'].textContent = msg;
    el['load-status'].style.color = isErr ? 'var(--danger)' : '';
  }

  /* ---------------- DIZIONARIO ---------------- */
  function fetchWithTimeout(url, timeout) {
    return Promise.race([
      fetch(url),
      new Promise(function (_, reject) { setTimeout(function () { reject(new Error('Timeout di rete')); }, timeout); })
    ]);
  }

  function leggiOverrideDaCache() {
    var chiavi = [C.DICT_CACHE_KEY, C.DICT_CACHE_KEY_ALT];
    for (var i = 0; i < chiavi.length; i++) {
      try {
        var cached = localStorage.getItem(chiavi[i]);
        if (!cached) continue;
        var parsed = JSON.parse(cached);
        if (!parsed || !parsed.ts) continue;
        if (Date.now() - parsed.ts < C.DICT_CACHE_TTL) {
          return { extra: parsed.extra || [], excluded: parsed.excluded || [], daCache: true };
        }
      } catch (e) { /* cache corrotta: si ignora */ }
    }
    return null;
  }
  function leggiOverrideScaduta() {
    var chiavi = [C.DICT_CACHE_KEY, C.DICT_CACHE_KEY_ALT];
    for (var i = 0; i < chiavi.length; i++) {
      try {
        var cached = localStorage.getItem(chiavi[i]);
        if (!cached) continue;
        var parsed = JSON.parse(cached);
        if (parsed) return { extra: parsed.extra || [], excluded: parsed.excluded || [], daCache: true, scaduta: true };
      } catch (e) { /* noop */ }
    }
    return null;
  }

  /**
   * Override condivisi (config/dizionario) con cache locale di 24 ore.
   * Se la cache è valida NON si legge Firestore: niente letture extra a ogni
   * apertura. `forza` salta la cache e serve solo al riallineamento mirato.
   */
  function leggiOverride(forza) {
    if (!forza) {
      var hit = leggiOverrideDaCache();
      if (hit) return Promise.resolve(hit);
    }
    if (!G.db) return Promise.resolve(leggiOverrideScaduta() || { extra: [], excluded: [] });
    return Promise.race([
      G.db.collection('config').doc('dizionario').get(),
      new Promise(function (_, rej) { setTimeout(function () { rej(new Error('fb timeout')); }, 5000); })
    ]).then(function (doc) {
      if (!C.docExists(doc)) return { extra: [], excluded: [] };
      var d = doc.data() || {};
      var out = { extra: d.extra || [], excluded: d.excluded || [] };
      try { localStorage.setItem(C.DICT_CACHE_KEY, JSON.stringify({ ts: Date.now(), extra: out.extra, excluded: out.excluded })); } catch (e) { /* noop */ }
      return out;
    }).catch(function (e) {
      console.warn('[NCC] override dizionario non disponibili:', e && e.message);
      return leggiOverrideScaduta() || { extra: [], excluded: [] };
    });
  }

  function caricaDizionario() {
    setLoadStatus('Scarico il dizionario…');
    return fetchWithTimeout('../../dizionario.txt', 20000).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }).then(function (testo) {
      G.testoBase = testo;
      setLoadStatus('Carico le parole condivise…');
      return leggiOverride(false);
    }).then(function (overrides) {
      G.dizionario = C.costruisciDizionario(G.testoBase, overrides);
      el['load-count'].textContent = G.dizionario.conteggio.toLocaleString('it-IT') +
        ' parole nel dizionario · versione ' + G.dizionario.fingerprint;
      setLoadStatus('Dizionario pronto');
    });
  }

  /**
   * Riallineamento MIRATO: scatta solo se il fingerprint del round non
   * coincide con quello locale (cache override diversa fra client).
   */
  function allineaDizionario(versioneAttesa) {
    if (G.dictAllineamentoInCorso || !G.testoBase) return Promise.resolve(false);
    G.dictAllineamentoInCorso = true;
    banner({ icon: '🔄', title: 'ALLINEO IL DIZIONARIO', subtitle: 'Un altro giocatore ha una versione diversa degli override…', spinner: true, sticky: true });
    return leggiOverride(true).then(function (overrides) {
      var nuovo = C.costruisciDizionario(G.testoBase, overrides);
      G.dizionario = nuovo;
      var ok = nuovo.fingerprint === versioneAttesa;
      G.dictAllineamentoInCorso = false;
      if (ok) {
        G.dictBloccato = false;
        G.dictTentativi = 0;
        hideBanner();
        toast('✅ Dizionario riallineato', 'ok');
      } else {
        G.dictBloccato = true;
      }
      if (G.state) render(G.state);
      return ok;
    }).catch(function () {
      G.dictAllineamentoInCorso = false;
      G.dictBloccato = true;
      if (G.state) render(G.state);
      return false;
    });
  }

  /** Confronta il fingerprint del round con quello locale. */
  function verificaDizionario(s) {
    var rd = s && s.roundData;
    if (G.solo || !rd || !rd.dictVersion || !G.dizionario) { G.dictBloccato = false; return; }
    if (rd.dictVersion === G.dizionario.fingerprint) {
      if (G.dictBloccato) { G.dictBloccato = false; hideBanner(); }
      G.dictTentativi = 0;
      return;
    }
    if (G.dictTentativi === 0) {
      G.dictTentativi = 1;
      allineaDizionario(rd.dictVersion);
      return;
    }
    // Discrepanza persistente: blocco esplicito, nessuna validazione silenziosa.
    if (!G.dictBloccato) {
      G.dictBloccato = true;
      banner({
        icon: '⚠️', title: 'DIZIONARIO NON ALLINEATO',
        subtitle: 'La tua versione (' + G.dizionario.fingerprint + ') differisce da quella del round (' +
          rd.dictVersion + '). Le risposte non vengono validate su questo dispositivo.',
        sticky: true,
        buttons: [{ id: 'reload', label: '🔄 RICARICA', kind: 'btn-fire', fn: function () { window.location.reload(); } }]
      });
    }
  }

  function dizionarioPerUI() { return G.dictBloccato ? null : G.dizionario; }
  function dizionarioPronto() { return !!G.dizionario && !G.dictBloccato; }

  /* ---------------- LISTENER RISPOSTE (privacy) ---------------- */
  function syncListenerRisposte(s) {
    if (!G.backend || !s) return;
    var rd = s.roundData;
    var key = (s.stato === 'in_corso' && rd) ? (rd.id + ':' + rd.fase) : 'off';
    if (key === G.listenerKey) return;
    G.listenerKey = key;
    if (key === 'off') { G.backend.chiudiRisposte(); return; }
    if (rd.fase === 'compilazione') G.backend.apriMieRisposte(rd.round);
    else if (rd.fase === 'revisione') G.backend.apriRisposte(rd.round);
    else G.backend.chiudiRisposte();
  }

  /* ---------------- RENDER: LOBBY ---------------- */
  function renderLobby(s) {
    var op = s.opzioni;
    el['cfg-round'].textContent = op.round;
    el['cfg-tempo'].textContent = op.tempo + 's';
    el['cfg-revisione'].textContent = op.revisione + 's';
    el['cfg-mode'].textContent = String(op.mode || 'classica').toUpperCase();
    el['lobby-cats'].innerHTML = op.categorie.map(function (c) {
      return '<span class="cat-chip">' + esc(c.icona || '📝') + ' ' + esc(c.label) + '</span>';
    }).join('');

    el['lobby-players'].innerHTML = s.partecipanti.map(function (p) {
      return '<span class="pchip' + (p === G.me ? ' mine' : '') + '">' + avatar(p) + esc(p) +
        (p === G.me ? ' (TU)' : '') +
        (s.pronti.indexOf(p) !== -1 ? '<span class="ready-dot" title="pronto"></span>' : '') + '</span>';
    }).join('');

    if (G.solo) {
      el['lobby-status'].classList.add('hidden');
      el['btn-start-solo'].classList.remove('hidden');
      el['lobby-hint'].textContent =
        'Allenamento: 10 punti per risposta valida, nessun avversario e nessuna votazione.';
    } else {
      el['btn-start-solo'].classList.add('hidden');
      el['lobby-status'].classList.remove('hidden');
      var pronti = s.pronti.length, tot = s.partecipanti.length;
      if (pronti >= tot) {
        el['lobby-status-text'].textContent = 'Tutti pronti: si parte!';
      } else {
        var manca = s.partecipanti.filter(function (p) { return s.pronti.indexOf(p) === -1; });
        el['lobby-status-text'].textContent = 'In attesa di ' + manca.map(function (p) { return p.toUpperCase(); }).join(', ') +
          ' (' + pronti + '/' + tot + ' pronti)…';
      }
      if (G.rateLimited) {
        el['lobby-status-text'].textContent += ' · Connessione limitata dal server: nuovo tentativo automatico.';
      }
    }
  }

  /* ---------------- RENDER: COMPILAZIONE ---------------- */
  function buildCampi(s) {
    var rd = s.roundData;
    var cats = s.opzioni.categorie.filter(function (c) { return rd.categorie.indexOf(c.id) !== -1; });
    rd.categorie.forEach(function (id) {
      if (!cats.some(function (c) { return c.id === id; })) {
        cats.push({ id: id, label: C.etichettaCategoria(s.opzioni.categorie, id), icona: '📝' });
      }
    });
    el.campi.innerHTML = cats.map(function (c) {
      return '<label class="campo" data-cat="' + esc(c.id) + '">' +
        '<span class="campo-label"><span>' + esc(c.icona || '📝') + ' ' + esc(c.label) + '</span>' +
        '<span class="campo-stato" data-stato="' + esc(c.id) + '"></span></span>' +
        '<input type="text" maxlength="30" autocomplete="off" autocorrect="off" spellcheck="false" ' +
        'data-input="' + esc(c.id) + '" aria-label="' + esc(c.label) + '" ' +
        'placeholder="' + esc(rd.lettera) + '…">' +
        '</label>';
    }).join('');
    Array.prototype.forEach.call(el.campi.querySelectorAll('input'), function (input) {
      var catId = input.getAttribute('data-input');
      input.addEventListener('input', function () { onInput(catId, input.value); });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); focusProssimo(catId); }
      });
    });
  }

  function focusProssimo(catId) {
    var inputs = Array.prototype.slice.call(el.campi.querySelectorAll('input'));
    var i = inputs.findIndex(function (x) { return x.getAttribute('data-input') === catId; });
    if (i >= 0 && i < inputs.length - 1) inputs[i + 1].focus();
  }

  function tuttiCampiPieni() {
    var rd = G.state && G.state.roundData;
    if (!rd) return false;
    return rd.categorie.every(function (id) {
      return String(G.campi[id] || '').trim().length > 0;
    });
  }

  function onInput(catId, value) {
    G.campi[catId] = value;
    G.touched[catId] = true;
    aggiornaCampoStato(catId);
    aggiornaStop();
    clearTimeout(G.saveTimer);
    G.saveTimer = setTimeout(function () { salva(false); }, SALVA_DEBOUNCE_MS);
  }

  function aggiornaCampoStato(catId) {
    var s = G.state;
    var rd = s && s.roundData;
    if (!rd) return;
    var chip = el.campi.querySelector('[data-stato="' + sel(catId) + '"]');
    var campo = el.campi.querySelector('.campo[data-cat="' + sel(catId) + '"]');
    var txt = String(G.campi[catId] || '');
    if (campo) campo.classList.toggle('filled', txt.trim().length > 0);
    if (!chip) return;
    if (!txt.trim()) { chip.textContent = ''; chip.className = 'campo-stato'; return; }
    var v = C.validaRisposta(txt, rd.lettera, dizionarioPerUI());
    if (v.motivo === 'DIZIONARIO_NON_PRONTO') { chip.textContent = 'non verificata'; chip.className = 'campo-stato'; return; }
    chip.textContent = v.ok ? '✓ nel dizionario' : C.motivoTesto(v.motivo, rd.lettera);
    chip.className = 'campo-stato ' + (v.ok ? 'ok' : 'ko');
  }

  function aggiornaStop() {
    var s = G.state;
    var rd = s && s.roundData;
    var mioTurno = rd && rd.fase === 'compilazione' && s.stato === 'in_corso';
    el['btn-stop'].disabled = !mioTurno || !tuttiCampiPieni();
    var n = rd ? rd.categorie.filter(function (id) { return String(G.campi[id] || '').trim(); }).length : 0;
    el['risposte-progress'].textContent = rd ? '(' + n + '/' + rd.categorie.length + ')' : '';
  }

  function setSaveState(st) {
    G.ultimoStatoSalvataggio = st;
    var m = {
      idle: ['—', ''],
      sporco: ['modifiche non salvate…', 'warn'],
      salvo: ['salvataggio…', ''],
      salvato: ['✓ salvato', 'ok'],
      in_coda: ['in coda (offline)', 'warn'],
      rifiutata: ['round chiuso: modifiche non salvate', 'err'],
      errore: ['salvataggio non riuscito', 'err']
    };
    var info = m[st] || m.idle;
    el['save-state'].textContent = info[0];
    el['save-state'].className = 'save-state ' + info[1];
  }

  function salva(flush) {
    clearTimeout(G.saveTimer);
    G.saveTimer = null;
    var s = G.state;
    var rd = s && s.roundData;
    if (!rd || rd.fase !== 'compilazione' || s.stato !== 'in_corso') {
      setSaveState('rifiutata');
      return Promise.resolve({ aborted: true, error: { code: 'ROUND_CHIUSO' } });
    }
    setSaveState('salvo');
    return G.backend.salvaRisposte(rispostePayload()).then(function (r) {
      if (r && r.ok) setSaveState('salvato');
      else if (r && r.failed) {
        setSaveState('errore');
        // L'errore di salvataggio deve restare visibile, non nascosto.
        toast(r.rateLimited
          ? '⏳ Server sovraccarico: salvataggio rimandato'
          : '⚠️ Salvataggio non riuscito: riprova', 'err');
      } else if (r && r.error && r.error.code === 'ROUND_CHIUSO') {
        setSaveState('rifiutata');
      }
      return r;
    });
  }

  function premiStop() {
    var s = G.state;
    var rd = s && s.roundData;
    if (!rd || rd.fase !== 'compilazione') return;
    if (!tuttiCampiPieni()) { toast('Completa tutti i campi prima di STOP'); return; }
    el['btn-stop'].disabled = true;
    // Prima si completa il proprio salvataggio, poi la transizione di fase:
    // due richieste separate, nessuna atomicità promessa fra di esse.
    salva(true).then(function (r) {
      if (!(r && r.ok)) {
        el['btn-stop'].disabled = false;
        toast('Salvataggio non completato: STOP annullato', 'err');
        return null;
      }
      return G.backend.applyAtomic(G.solo ? C.mutConsegnaSolo : C.mutStop, ctxAvanzamento(G.state));
    }).then(function (res) {
      if (res && res.failed) {
        el['btn-stop'].disabled = false;
        toast(res.rateLimited ? '⏳ Server sovraccarico: STOP rimandato' : 'Connessione instabile: STOP non inviato', 'err');
      } else if (res && res.aborted) {
        toast('Il round è già stato fermato');
      } else if (res && res.ok) {
        toast(G.solo ? '⏹ Consegna registrata' : '⏹ STOP! Si apre la revisione', 'ok');
      }
    });
  }

  /* ---------------- RENDER: GIOCO ---------------- */
  function renderGioco(s) {
    var rd = s.roundData;
    if (!rd) return;

    if (rd.round !== G.roundAperto || rd.id !== el.campi.dataset.round) {
      G.roundAperto = rd.round;
      G.campi = {};
      G.touched = {};
      el.campi.dataset.round = rd.id;
      buildCampi(s);
      var mie = (G.backend && G.backend.getMieRisposte) ? G.backend.getMieRisposte() : {};
      Object.keys(mie).forEach(function (catId) {
        G.campi[catId] = mie[catId].raw || '';
      });
      applicaCampi();
      if (!G.solo) toast('✏️ Round ' + rd.round + ' — lettera ' + rd.lettera);
    }

    el['lettera-tile'].textContent = rd.lettera;
    el['round-badge'].classList.remove('hidden');
    el['round-badge'].textContent = 'ROUND ' + rd.round + '/' + s.opzioni.round + ' · LETTERA ' + rd.lettera;
    var fasi = { compilazione: 'COMPILAZIONE', revisione: 'REVISIONE', risultati: 'RISULTATI' };
    el['fase-chip'].textContent = fasi[rd.fase] || String(rd.fase).toUpperCase();
    el['fase-chip'].className = 'fase-chip ' + (rd.fase === 'compilazione' ? '' : rd.fase);

    var attivo = rd.fase === 'compilazione';
    Array.prototype.forEach.call(el.campi.querySelectorAll('input'), function (i) { i.disabled = !attivo; });
    el['risposte-card'].classList.toggle('hidden', !attivo);
    aggiornaStop();
    el['risposte-hint'].textContent = attivo
      ? 'Una parola è valida se esiste nel dizionario e inizia per ' + rd.lettera +
        '. STOP non controlla il significato: puoi fermarti anche con parole sbagliate.'
      : '';

    renderGiocatori(s);
    renderPunteggi(s);
    renderStorico(s);
  }

  function applicaCampi() {
    var rd = G.state && G.state.roundData;
    if (!rd) return;
    rd.categorie.forEach(function (catId) {
      var input = el.campi.querySelector('[data-input="' + sel(catId) + '"]');
      if (!input) return;
      var val = G.campi[catId] == null ? '' : String(G.campi[catId]);
      if (document.activeElement !== input) input.value = val;
      aggiornaCampoStato(catId);
    });
  }

  function renderGiocatori(s) {
    var rd = s.roundData;
    el.giocatori.innerHTML = s.partecipanti.map(function (p) {
      var nelRound = rd && rd.partecipanti.indexOf(p) !== -1;
      var stop = rd && rd.stop && rd.stop.da === p;
      var nota = !nelRound ? 'non partecipa al round'
        : (rd.fase === 'revisione' ? (rd.conferme.indexOf(p) !== -1 ? 'ha confermato' : 'in revisione')
          : (stop ? 'ha premuto STOP' : 'sta scrivendo'));
      return '<span class="pchip' + (p === G.me ? ' mine' : '') + (stop ? ' active' : '') + '">' +
        avatar(p) + esc(p) + (p === G.me ? ' (TU)' : '') +
        '<span class="mini">' + esc(nota) + '</span></span>';
    }).join('');
  }

  function renderPunteggi(s) {
    var righe = C.classifica(s.punteggi, s.partecipanti);
    el.punteggi.innerHTML = righe.map(function (r) {
      var ultimo = (s.risultati || []).filter(function (x) { return x.punti && x.punti[r.nome] != null; }).pop();
      var delta = ultimo ? ultimo.punti[r.nome] : null;
      return '<div class="srow' + (r.nome === G.me ? ' mine' : '') + '">' +
        '<span class="rank">' + (r.posizione === 1 ? '🥇' : r.posizione === 2 ? '🥈' : r.posizione === 3 ? '🥉' : r.posizione) + '</span>' +
        avatar(r.nome) +
        '<span class="sname">' + esc(r.nome) + (r.nome === G.me ? ' (TU)' : '') + '</span>' +
        (delta != null ? '<span class="sdelta">+' + delta + '</span>' : '') +
        '<span class="spts">' + r.punti + '</span></div>';
    }).join('');
  }

  function renderStorico(s) {
    var lista = s.risultati || [];
    if (!lista.length) {
      el.storico.innerHTML = '<div class="storico-empty">Nessun round chiuso.</div>';
      return;
    }
    el.storico.innerHTML = lista.map(function (r) {
      var tot = r.punti || {};
      return '<div class="st-row"><span class="st-lettera">' + esc(r.lettera) + '</span>' +
        '<span>round ' + esc(r.round) + '</span>' +
        '<span class="st-pts">' + s.partecipanti.map(function (p) {
          return esc(p.slice(0, 3)) + ' ' + (tot[p] || 0);
        }).join(' · ') + '</span></div>';
    }).join('');
  }

  /* ---------------- RENDER: REVISIONE ---------------- */
  function celleDelRound(s, risposte, dizionario) {
    var rd = s.roundData;
    var quorum = rd.partecipanti;
    var celle = [];
    rd.categorie.forEach(function (catId, ci) {
      quorum.forEach(function (nome, pi) {
        var k = C.cellKey(ci, pi);
        var r = (risposte[nome] && risposte[nome][catId]) || null;
        var v = C.validaRisposta(r ? r.raw : '', rd.lettera, dizionario);
        var voti = (rd.voti && rd.voti[k]) ? rd.voti[k] : [];
        var votiValida = (rd.votiValida && rd.votiValida[k]) ? rd.votiValida[k] : [];
        var annullata = v.ok && C.rispostaAnnullata(voti, quorum);
        celle.push({
          k: k, ci: ci, pi: pi, cat: catId, nome: nome,
          raw: r ? r.raw : '', norm: v.norm,
          validaAutomatica: v.ok,
          valida: v.ok || (!annullata && !!v.norm && C.rispostaValidata(votiValida, quorum)),
          validata: !v.ok && !annullata && !!v.norm && C.rispostaValidata(votiValida, quorum),
          motivo: v.motivo,
          voti: voti.slice(),
          votiValida: votiValida.slice(),
          annullata: annullata
        });
      });
    });
    return celle;
  }

  function renderRevisione(s) {
    var rd = s.roundData;
    var diz = dizionarioPerUI();
    var risposte = G.solo ? G.risposteSolo : (G.backend.getRisposte ? G.backend.getRisposte() : {});
    var celle = celleDelRound(s, risposte, diz);
    var perCat = {};
    celle.forEach(function (c) { (perCat[c.ci] = perCat[c.ci] || []).push(c); });
    Object.keys(perCat).forEach(function (ci) { C.assegnaPuntiCategoria(perCat[ci]); });

    el['rev-round'].textContent = rd.round;
    el['rev-lettera'].textContent = rd.lettera;

    var head = '<tr><th>CATEGORIA</th>' + rd.partecipanti.map(function (p) {
      return '<th>' + esc(p) + (p === G.me ? ' (TU)' : '') + '</th>';
    }).join('') + '</tr>';

    var body = rd.categorie.map(function (catId, ci) {
      var label = C.etichettaCategoria(s.opzioni.categorie, catId);
      var tds = rd.partecipanti.map(function (nome, pi) {
        var c = celle.filter(function (x) { return x.ci === ci && x.pi === pi; })[0];
        var inVoto = (c.voti.length + c.votiValida.length) > 0;
        return '<td class="rev-cell' + (nome === G.me ? ' mine' : '') + (inVoto ? ' in-voto' : '') + '">' +
          cellaHtml(c, rd, s) + '</td>';
      }).join('');
      return '<tr><th>' + esc(label) + '</th>' + tds + '</tr>';
    }).join('');

    el['rev-body'].innerHTML = '<table class="rev-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';

    renderVotiAperti(s, celle);

    Array.prototype.forEach.call(el['rev-body'].querySelectorAll('.vote-btn'), function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-key');
        var vota = btn.getAttribute('data-vota') === '1';
        var perValida = btn.getAttribute('data-tipo') === 'valida';
        var mut = perValida ? C.mutVotaValida : C.mutVota;
        G.backend.applyAtomic(mut, { key: key, vota: vota }).then(function (r) {
          if (r && r.error && r.error.code === 'REVISIONE_CHIUSA') toast('La revisione è già chiusa');
          else if (r && r.error && r.error.code === 'NON_PARTECIPANTE') toast('Non partecipi a questo round');
        });
      });
    });

    var quorum = rd.partecipanti;
    var k = quorum.filter(function (p) { return rd.conferme.indexOf(p) !== -1; }).length;
    var iDone = rd.conferme.indexOf(G.me) !== -1;
    var mancano = quorum.filter(function (p) { return rd.conferme.indexOf(p) === -1; });
    el['conf-progress'].innerHTML =
      (iDone ? '✔ Hai confermato — ' : 'Conferme: ') + '<b>' + k + '/' + quorum.length + '</b>' +
      (mancano.length ? ' · mancano ' + esc(mancano.join(', ')) : '') +
      '<div class="conf-bar"><i style="width:' + Math.round((k / quorum.length) * 100) + '%"></i></div>';
    el['btn-conferma'].disabled = iDone || quorum.indexOf(G.me) === -1;
    el['btn-conferma'].textContent = quorum.indexOf(G.me) === -1
      ? 'NON PARTECIPI A QUESTO ROUND'
      : (iDone ? '⏳ IN ATTESA DEGLI ALTRI…' : '✔ REVISIONE CONCLUSA');
  }

  /**
   * Striscia "IN VOTAZIONE": elenca in modo evidente le risposte su cui
   * qualcuno ha già votato — per renderle VALIDE o per ANNULLARLE — con
   * autore, categoria, voti raccolti e chi manca all'unanimità.
   */
  function renderVotiAperti(s, celle) {
    if (!el['rev-voti']) return;
    var rd = s.roundData;
    var quorum = rd.partecipanti;
    var aperte = (celle || []).filter(function (c) {
      return (c.voti.length + c.votiValida.length) > 0;
    });
    if (!aperte.length) {
      el['rev-voti'].className = 'rev-voti hidden';
      el['rev-voti'].innerHTML = '<span class="rv-empty">Nessuna parola in votazione.</span>';
      return;
    }
    el['rev-voti'].className = 'rev-voti';
    el['rev-voti'].innerHTML =
      '<div class="rv-title">🗳️ IN VOTAZIONE — ' + aperte.length +
      ' parol' + (aperte.length === 1 ? 'a' : 'e') +
      ' <span class="rv-sub">serve il voto di tutti, autore incluso</span></div>' +
      '<div class="rv-list">' + aperte.map(function (c) {
        var perValida = c.votiValida.length > 0;
        var voti = perValida ? c.votiValida : c.voti;
        var mancano = quorum.filter(function (p) { return voti.indexOf(p) === -1; });
        var risolto = c.annullata || c.validata;
        return '<span class="rv-item ' + (perValida ? 'valida' : 'invalida') + (risolto ? ' risolto' : '') + '">' +
          '<b>' + esc(c.raw) + '</b>' +
          '<span class="rv-who">' + esc(c.nome) + ' · ' + esc(C.etichettaCategoria(s.opzioni.categorie, c.cat)) + '</span>' +
          '<span class="rv-voti">' + (perValida ? '✅ valida' : '🚫 non valida') + ' ' +
            voti.length + '/' + quorum.length + '</span>' +
          (risolto
            ? '<span class="rv-esito">' + (c.annullata ? 'ANNULLATA' : 'VALIDATA') + '</span>'
            : '<span class="rv-mancano">mancano ' + esc(mancano.join(', ')) + '</span>') +
          '</span>';
      }).join('') + '</div>';
  }

  function cellaHtml(c, rd, s) {
    if (!String(c.raw || '').trim()) {
      return '<span class="cell-empty">nessuna risposta</span>' +
        '<div class="cell-meta"><span class="tag mute">VUOTA</span><span class="tag pts zero">0</span></div>';
    }
    var diz = dizionarioPerUI();
    var quorum = rd.partecipanti;
    var posso = quorum.indexOf(G.me) !== -1 && rd.fase === 'revisione';
    var tagValidita;
    if (!diz) {
      tagValidita = '<span class="tag mute">NON VERIFICATA</span>';
    } else if (c.validata) {
      tagValidita = '<span class="tag ok">VALIDA · VOTATA DA TUTTI</span>';
    } else if (c.valida) {
      tagValidita = '<span class="tag ok">VALIDA</span>';
    } else {
      tagValidita = '<span class="tag ko">' + esc(C.motivoTesto(c.motivo, rd.lettera).toUpperCase()) + '</span>';
    }

    /* Voto "NON VALIDA": solo su una risposta automaticamente valida e non
       ancora annullata. Voto "VALIDA": solo su una risposta scritta che il
       dizionario non riconosce. Stessa regola per entrambi: unanimità. */
    var hoInvalida = c.voti.indexOf(G.me) !== -1;
    var votoInvalida = '<button class="vote-btn' + (hoInvalida ? ' votato' : '') +
      '" data-key="' + esc(c.k) + '" data-tipo="invalida" data-vota="' + (hoInvalida ? '0' : '1') + '"' +
      ((diz && c.validaAutomatica && !c.annullata && posso) ? '' : ' disabled') +
      ' title="Vota per annullare questa risposta">' +
      (hoInvalida ? '↩ RITIRA' : '🚫 NON VALIDA') + '</button>';
    var hoValida = c.votiValida.indexOf(G.me) !== -1;
    var votoValida = '<button class="vote-btn valida' + (hoValida ? ' votato' : '') +
      '" data-key="' + esc(c.k) + '" data-tipo="valida" data-vota="' + (hoValida ? '0' : '1') + '"' +
      ((diz && !c.validaAutomatica && !!c.norm && posso) ? '' : ' disabled') +
      ' title="Vota per rendere valida questa parola">' +
      (hoValida ? '↩ RITIRA' : '✅ VALIDA') + '</button>';

    var conteggioInvalida = c.voti.length
      ? '<span class="tag ' + (c.annullata ? 'ko' : 'info') + '">🚫 ' + c.voti.length + '/' + quorum.length +
        (c.annullata ? ' · ANNULLATA' : '') + '</span>'
      : '';
    var conteggioValida = c.votiValida.length
      ? '<span class="tag ' + (c.validata ? 'ok' : 'info') + '">✅ ' + c.votiValida.length + '/' + quorum.length +
        (c.validata ? ' · VALIDATA' : '') + '</span>'
      : '';
    /* "Stato di voto": appena esiste almeno un voto (in un senso o
       nell'altro) la cella lo dichiara in modo evidente. */
    var inVoto = (c.voti.length + c.votiValida.length) > 0;
    var nastro = inVoto
      ? '<span class="tag voto">🗳️ IN VOTO ' + (c.votiValida.length ? 'per VALIDARE' : 'per ANNULLARE') + '</span>'
      : '';
    return '<div class="cell-word' + (c.annullata ? ' annullata' : '') + (c.validata ? ' validata' : '') + '">' +
      esc(c.raw) + '</div>' +
      '<div class="cell-meta">' + tagValidita + nastro + conteggioInvalida + conteggioValida +
      '<span class="tag pts' + (c.punti ? '' : ' zero') + '">' + (c.punti || 0) + ' pt</span>' +
      votoInvalida + votoValida + '</div>';
  }

  /* ---------------- RENDER: RISULTATI ROUND ---------------- */
  function renderRisultati(s) {
    var rd = s.roundData;
    var r = (s.risultati || []).filter(function (x) { return x.id === rd.esitoId || x.round === rd.round; })[0];
    el['res-round'].textContent = rd.round;
    // La classifica provvisoria si mostra a OGNI fine turno, anche se l'esito
    // del round non è ancora disponibile sul client.
    renderClassificaProvvisoria(s, r);
    if (!r) {
      el['res-body'].innerHTML = '<div class="storico-empty">Esito non ancora disponibile.</div>';
      return;
    }
    var perCat = {};
    (r.celle || []).forEach(function (c) { (perCat[c.cat] = perCat[c.cat] || []).push(c); });
    el['res-body'].innerHTML = Object.keys(perCat).map(function (catId) {
      var label = C.etichettaCategoria(s.opzioni.categorie, catId);
      var righe = perCat[catId].map(function (c) {
        var stato = !String(c.raw || '').trim() ? 'vuota'
          : c.annullataManuale ? 'annullata manualmente'
            : c.validataManuale ? 'validata manualmente'
              : c.validata ? 'validata all’unanimità'
                : c.annullata ? 'annullata all’unanimità'
                  : c.valida ? 'valida' : C.motivoTesto(c.motivoAutomatico || c.motivo, r.lettera).toLowerCase();
        /* In allenamento le due scelte sono MANUALI e dichiarate come tali:
           non esiste votazione né quorum con un solo giocatore. */
        var azione = '';
        if (G.solo && String(c.raw || '').trim()) {
          azione = '<button class="vote-btn btn-manuale" data-key="' + esc(c.k) +
            '" data-azione="annulla" data-valore="' + (c.annullataManuale ? '0' : '1') + '">' +
            (c.annullataManuale ? '↩ RIPRISTINA' : '✖ ANNULLA') + '</button>' +
            '<button class="vote-btn valida btn-manuale" data-key="' + esc(c.k) +
            '" data-azione="valida" data-valore="' + (c.validataManuale ? '0' : '1') + '"' +
            (c.motivoAutomatico ? '' : ' disabled') +
            ' title="Il dizionario non la conosce: dichiarala corretta">' +
            (c.validataManuale ? '↩ RIPRISTINA' : '✅ VALIDA') + '</button>';
        }
        return '<div class="st-row"><span>' + esc(c.nome) + '</span>' +
          '<span class="st-lettera' + (c.annullataManuale ? ' annullata' : '') + '">' + esc(c.raw || '—') + '</span>' +
          '<span class="mini">' + esc(stato) + '</span>' + azione +
          '<span class="st-pts">' + (c.punti || 0) + '</span></div>';
      }).join('');
      return '<div class="det-round"><h4>' + esc(label) + '</h4>' + righe + '</div>';
    }).join('');
    var tot = r.punti || {};
    el['res-body'].innerHTML += '<div class="det-round"><h4>TOTALE ROUND</h4>' +
      s.partecipanti.map(function (p) {
        return '<div class="st-row"><span>' + esc(p) + '</span><span class="st-pts">+' + (tot[p] || 0) + '</span></div>';
      }).join('') + '</div>' +
      (G.solo
        ? '<p class="hint">Allenamento: 10 punti per risposta automaticamente valida. ' +
          'Annullamento e validazione manuali sono scelte tue, distinte dal dizionario.</p>'
        : '');

    Array.prototype.forEach.call(el['res-body'].querySelectorAll('.btn-manuale'), function (btn) {
      btn.addEventListener('click', function () {
        var ctx = ctxAvanzamento(G.state);
        ctx.key = btn.getAttribute('data-key');
        var valore = btn.getAttribute('data-valore') === '1';
        if (btn.getAttribute('data-azione') === 'valida') {
          ctx.valida = valore;
          G.backend.applyAtomic(C.mutValidaManualeSolo, ctx);
        } else {
          ctx.annulla = valore;
          G.backend.applyAtomic(C.mutAnnullaManualeSolo, ctx);
        }
      });
    });
  }

  /**
   * Classifica provvisoria di fine turno: totali aggiornati, punti del round
   * appena chiuso e una barra proporzionale al vantaggio.
   */
  function renderClassificaProvvisoria(s, esito) {
    if (!el['res-classifica']) return;
    var righe = C.classifica(s.punteggi, s.partecipanti);
    var delta = (esito && esito.punti) || {};
    var max = righe.reduce(function (m, r) { return Math.max(m, r.punti); }, 0) || 1;
    var ultimo = s.opzioni.round === s.round;
    el['res-classifica'].innerHTML =
      '<div class="rc-head">🏁 CLASSIFICA PROVVISORIA' +
      '<span class="rc-sub">dopo il round ' + esc(s.round) + ' di ' + esc(s.opzioni.round) +
      (ultimo ? ' · ultimo round' : '') + '</span></div>' +
      righe.map(function (r, i) {
        var medaglie = ['🥇', '🥈', '🥉'];
        return '<div class="rc-row' + (r.nome === G.me ? ' mine' : '') + '">' +
          '<span class="rc-pos">' + (medaglie[i] || r.posizione) + '</span>' +
          avatar(r.nome) +
          '<span class="rc-name">' + esc(r.nome) + (r.nome === G.me ? ' (TU)' : '') + '</span>' +
          (delta[r.nome] ? '<span class="rc-delta">+' + delta[r.nome] + '</span>' : '') +
          '<span class="rc-bar"><i style="width:' + Math.round((r.punti / max) * 100) + '%"></i></span>' +
          '<span class="rc-pts">' + r.punti + '</span></div>';
      }).join('');
  }

  /* ---------------- RENDER: FINE PARTITA ---------------- */

  function renderFine(s) {
    var righe = C.classifica(s.punteggi, s.partecipanti);
    var top = C.vincitore(s.punteggi, s.partecipanti) || [];
    var iWon = top.some(function (r) { return r.nome === G.me; });

    el['fine-emoji'].textContent = top.length > 1 ? '🤝' : '🏆';
    if (top.length > 1) {
      el['fine-title'].textContent = 'PAREGGIO!';
      el['fine-sub'].textContent = top.map(function (r) { return r.nome; }).join(' e ') +
        ' vincono con ' + top[0].punti + ' punti';
    } else if (iWon && s.partecipanti.length > 1) {
      el['fine-title'].textContent = 'HAI VINTO!';
      el['fine-sub'].textContent = 'Con ' + top[0].punti + ' punti 🎉';
    } else if (iWon) {
      el['fine-title'].textContent = 'ALLENAMENTO COMPLETATO';
      el['fine-sub'].textContent = 'Punteggio di allenamento: ' + top[0].punti + ' punti';
    } else {
      el['fine-title'].textContent = 'HA VINTO ' + String(top[0].nome).toUpperCase();
      el['fine-sub'].textContent = 'Con ' + top[0].punti + ' punti';
    }

    /* Podio condiviso (../shared/podio.js): ordine per punteggio decrescente,
       gradino del 1° più alto e via via più basso, tutti i giocatori visibili. */
    window.FAWPodio.render(el.podio, righe.map(function (r) {
      return { nome: r.nome, punti: r.punti, sottotitolo: 'posizione ' + r.posizione };
    }), { io: G.me });

    el['fine-dettaglio'].innerHTML = (s.risultati || []).map(function (r) {
      var tot = r.punti || {};
      var celle = r.celle || [];
      return '<div class="det-round"><h4>Round ' + esc(r.round) + ' — lettera ' + esc(r.lettera) + '</h4>' +
        celle.map(function (c) {
          return '<div class="st-row"><span>' + esc(C.etichettaCategoria(s.opzioni.categorie, c.cat)) + '</span>' +
            '<span>' + esc(c.nome) + '</span>' +
            '<span class="st-lettera">' + esc(c.raw || '—') + '</span>' +
            '<span class="st-pts">' + (c.punti || 0) + '</span></div>';
        }).join('') +
        '<div class="st-row"><b>Totale round</b><span class="st-pts">' +
        s.partecipanti.map(function (p) { return esc(p.slice(0, 3)) + ' ' + (tot[p] || 0); }).join(' · ') +
        '</span></div></div>';
    }).join('') || '<div class="storico-empty">Nessun round completato.</div>';

    var celleTotali = (s.risultati || []).reduce(function (a, r) { return a + (r.celle || []).length; }, 0);
    var valide = (s.risultati || []).reduce(function (a, r) {
      return a + (r.celle || []).filter(function (c) { return c.valida && !c.annullata; }).length;
    }, 0);
    var annullate = (s.risultati || []).reduce(function (a, r) {
      return a + (r.celle || []).filter(function (c) { return c.annullata; }).length;
    }, 0);
    el['fine-stats'].innerHTML =
      '<div class="fs-item"><div class="fs-val">' + (s.risultati || []).length + '</div><div class="fs-lab">ROUND</div></div>' +
      '<div class="fs-item"><div class="fs-val">' + valide + '/' + celleTotali + '</div><div class="fs-lab">RISPOSTE VALIDE</div></div>' +
      '<div class="fs-item"><div class="fs-val">' + annullate + '</div><div class="fs-lab">ANNULLATE ALL’UNANIMITÀ</div></div>';

    // Statistiche giornaliere (stesso store dell'hub), una volta sola
    if (!G.statsSaved) {
      G.statsSaved = true;
      try {
        var today = new Date().toISOString().split('T')[0];
        var stats = JSON.parse(localStorage.getItem(STATS_KEY) || '{"days":{},"totals":{}}');
        if (!stats.days) stats.days = {};
        if (!stats.totals) stats.totals = {};
        if (!stats.days[today]) stats.days[today] = {};
        stats.days[today][STATS_GIOCO] = (stats.days[today][STATS_GIOCO] || 0) + 1;
        stats.totals[STATS_GIOCO] = (stats.totals[STATS_GIOCO] || 0) + 1;
        localStorage.setItem(STATS_KEY, JSON.stringify(stats));
      } catch (e) { /* noop */ }
    }

    el['btn-rivincita'].classList.toggle('hidden', G.solo);
    // La rivincita sta IN ALTO nella schermata finale: si vede e si preme
    // senza scorrere tutto il dettaglio dei round.
    if (el['fine-top-actions']) el['fine-top-actions'].classList.toggle('hidden', G.solo);
    renderRematch(s);
  }

  /* ---------------- RIVINCITA (flusso Patata Bollente) ---------------- */
  function creaRivincita() {
    var s = G.state;
    if (!s || s.stato !== 'conclusa') return;
    if (G.solo || !G.db) { toast('Rivincita disponibile solo in sfida'); return; }
    if (s.prossimaPartita) { toast('Rivincita già creata, in attesa…'); return; }
    var nuove = {};
    s.partecipanti.forEach(function (p) { nuove[p] = 0; });
    var newRef = G.db.collection('partite').doc();
    return newRef.set({
      gioco: 'nomi-cose-citta',
      partecipanti: s.partecipanti,
      punteggi: nuove,
      pronti: [],
      risultati: [],
      roundData: null,
      round: 0,
      stato: 'attesa',
      rivincitaAccettataDa: [],
      rivincitaRifiutataDa: [],
      dataOra: new Date().toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
      timestamp: Date.now(),
      opzioni: {
        round: String(s.opzioni.round),
        tempo: String(s.opzioni.tempo),
        revisione: String(s.opzioni.revisione),
        categorie: s.opzioni.categorie.map(function (c) { return { id: c.id, label: c.label }; }),
        mode: 'classica',
        // seed nuovo: nessuna contaminazione con la partita appena finita
        seed: Math.random().toString(36).substring(7).toUpperCase()
      }
    }).then(function () {
      return G.backend.ref.update({
        prossimaPartita: newRef.id,
        prossimaPartitaCreataDa: G.me,
        rivincitaAccettataDa: [],
        rivincitaRifiutataDa: []
      });
    }).then(function () { hideBanner(); })
      .catch(function (e) {
        console.error('[NCC] rivincita:', e);
        toast('Errore nella creazione della rivincita', 'err');
      });
  }

  function accettaRivincita() {
    if (!G.backend || !G.backend.ref || !G.fs) return;
    G.backend.ref.update({ rivincitaAccettataDa: G.fs.FieldValue.arrayUnion(G.me) }).catch(function () { });
  }
  function rifiutaRivincita() {
    if (!G.backend || !G.backend.ref || !G.fs) return;
    G.backend.ref.update({ rivincitaRifiutataDa: G.fs.FieldValue.arrayUnion(G.me) }).catch(function () { });
  }

  function renderRematch(s) {
    if (G.solo) return;
    var N = s.partecipanti.length;
    var rifiutanti = s.rivincitaRifiutataDa || [];
    var accettanti = s.rivincitaAccettataDa || [];
    var id = s.prossimaPartita;
    if (!id) {
      el['btn-rivincita'].disabled = rifiutanti.length > 0;
      return;
    }
    if (rifiutanti.length > 0) {
      el['btn-rivincita'].disabled = true;
      el['btn-rivincita'].textContent = '🔁 RIVINCITA RIFIUTATA';
      banner({
        icon: '👋', title: 'RIVINCITA RIFIUTATA',
        subtitle: rifiutanti.join(', ') + ' ha rifiutato la rivincita',
        buttons: [{ id: 'home', label: '🏠 HOME', kind: 'btn-ghost', fn: hideBanner }]
      });
      return;
    }
    if (accettanti.length >= N - 1) {
      if (!G.redirected) {
        G.redirected = true;
        el['btn-rivincita'].disabled = true;
        el['btn-rivincita'].textContent = '🔄 REINDIRIZZAMENTO…';
        banner({ icon: '✅', title: 'RIVINCITA ACCETTATA DA TUTTI!', subtitle: 'Ripartenza imminente…', spinner: true, sticky: true });
        setTimeout(function () { window.location.href = 'index.html?matchId=' + id; }, 1600);
      }
      return;
    }
    if (s.prossimaPartitaCreataDa === G.me) {
      el['btn-rivincita'].disabled = true;
      el['btn-rivincita'].textContent = '⏳ RIVINCITA IN ATTESA…';
      banner({
        icon: '🔁', title: 'RIVINCITA CREATA',
        subtitle: 'In attesa di ' + s.partecipanti.filter(function (p) {
          return p !== G.me && accettanti.indexOf(p) === -1;
        }).join(', ') + '…',
        sticky: true
      });
      return;
    }
    if (accettanti.indexOf(G.me) !== -1) {
      el['btn-rivincita'].disabled = true;
      el['btn-rivincita'].textContent = '⏳ HAI ACCETTATO…';
      banner({ icon: '✅', title: 'RIVINCITA ACCETTATA', subtitle: 'In attesa che tutti accettino…', sticky: true });
      return;
    }
    el['btn-rivincita'].disabled = false;
    el['btn-rivincita'].textContent = '🔁 RIVINCITA';
    banner({
      icon: '🔁', title: 'RIVINCITA PROPOSTA',
      subtitle: s.prossimaPartitaCreataDa + ' vuole rifare la partita',
      sticky: true,
      buttons: [
        { id: 'acc', label: '✅ ACCETTA', kind: 'btn-fire', fn: accettaRivincita },
        { id: 'rif', label: '❌ RIFIUTA', kind: 'btn-ghost', fn: rifiutaRivincita }
      ]
    });
  }

  /* ---------------- RENDER PRINCIPALE ---------------- */
  function render(s) {
    G.state = s;
    if (!s) return;

    el.app.classList.remove('hidden');
    var showLobby = s.stato === 'attesa';
    el['screen-lobby'].classList.toggle('hidden', !showLobby);
    el['screen-gioco'].classList.toggle('hidden', showLobby);
    el['round-badge'].classList.toggle('hidden', showLobby);

    // Badge versione dizionario
    if (G.dizionario) {
      el['dict-badge'].classList.remove('hidden');
      el['dict-badge'].textContent = 'DIZ ' + G.dizionario.fingerprint;
      el['dict-badge'].classList.toggle('mismatch', G.dictBloccato);
    }

    verificaDizionario(s);
    syncListenerRisposte(s);

    if (showLobby) {
      if (G.prevFase !== 'attesa') hideBanner();
      G.prevFase = 'attesa';
      renderLobby(s);
      nascondiOverlay();
      return;
    }

    var rd = s.roundData;
    G.prevFase = rd ? rd.fase : s.stato;

    if (rd) renderGioco(s);

    var mostraRevisione = s.stato === 'in_corso' && rd && rd.fase === 'revisione';
    var mostraRisultati = s.stato === 'in_corso' && rd && rd.fase === 'risultati';
    el['overlay-revisione'].classList.toggle('hidden', !mostraRevisione);
    el['overlay-risultati'].classList.toggle('hidden', !mostraRisultati);
    el['overlay-fine'].classList.toggle('hidden', s.stato !== 'conclusa');

    if (mostraRevisione) renderRevisione(s);
    if (mostraRisultati) renderRisultati(s);
    if (s.stato === 'conclusa') { renderFine(s); nascondiOverlay('fine'); }

    // Fine round: si puliscono i campi locali (nessuna contaminazione)
    if (rd && rd.fase !== 'compilazione' && G.saveTimer) {
      clearTimeout(G.saveTimer);
      G.saveTimer = null;
    }
  }

  function nascondiOverlay(tranne) {
    ['overlay-revisione', 'overlay-risultati', 'overlay-fine'].forEach(function (id) {
      if (tranne && id.indexOf(tranne) !== -1) return;
      el[id].classList.add('hidden');
    });
  }

  /* ---------------- TICK LOGICO (avanzamenti) ---------------- */
  function mioStaggerMs(s) {
    var i = (s.partecipanti || []).indexOf(G.me);
    return (i < 0 ? 0 : i) * 900;
  }
  function actionKey(s, key) { return s.stato + ':' + (s.round || 0) + ':' + key; }
  function mayAct(s, key, referent) {
    return G.gate.mayAct(actionKey(s, key), {
      now: Date.now(),
      isReferent: referent === G.me,
      staggerMs: mioStaggerMs(s)
    });
  }
  function actionOk(s, key) { G.gate.ok(actionKey(s, key)); }
  function actionFailed(s, key, res) { G.gate.failed(actionKey(s, key), res); }

  function ctxAvanzamento(s) {
    return {
      dizionario: dizionarioPerUI(),
      dizionarioPronto: dizionarioPronto(),
      dictVersion: G.dizionario ? G.dizionario.fingerprint : null,
      risposte: G.solo ? G.risposteSolo : (G.backend.getRisposte ? G.backend.getRisposte() : {}),
      rispostePronte: G.solo ? true : !!(G.backend.rispostePronte && G.backend.rispostePronte())
    };
  }

  function tick() {
    var s = G.state;
    if (!s || G.busy) return;
    if (G.backend && G.backend.rateLimitedUntil > Date.now()) return;
    G.busy = true;

    var referent = C.referenteAzione(s);

    if (s.stato === 'attesa') {
      if (G.solo) { G.busy = false; return; }
      if (s.pronti.indexOf(G.me) === -1) {
        if (mayAct(s, 'ready:' + G.me, G.me)) {
          G.backend.applyAtomic(C.mutReady).then(function (r) {
            if (r && r.ok) actionOk(s, 'ready:' + G.me); else actionFailed(s, 'ready:' + G.me, r);
          });
        }
        G.busy = false;
        return;
      }
      if (s.pronti.length >= s.partecipanti.length && mayAct(s, 'start', s.partecipanti[0])) {
        G.backend.applyAtomic(C.mutStart, ctxAvanzamento(s)).then(function (r) {
          if (r && r.ok) actionOk(s, 'start'); else actionFailed(s, 'start', r);
        });
      }
      G.busy = false;
      return;
    }

    if (s.stato !== 'in_corso' || !s.roundData) { G.busy = false; return; }
    var rd = s.roundData;
    var ctx = ctxAvanzamento(s);

    if (rd.fase === 'compilazione') {
      if (Date.now() > rd.deadline + C.TIMEOUT_GRACE && mayAct(s, 'stop-timeout', referent)) {
        var mut = G.solo ? C.mutConsegnaSolo : C.mutTimeoutCompilazione;
        G.backend.applyAtomic(mut, ctx).then(function (r) {
          if (r && r.ok) {
            actionOk(s, 'stop-timeout');
            toast(G.solo ? '⏰ Tempo scaduto: risposte consegnate' : '⏰ Tempo scaduto: si apre la revisione');
          } else actionFailed(s, 'stop-timeout', r);
        });
      }
      G.busy = false;
      return;
    }

    if (rd.fase === 'revisione') {
      // Chiudere il round serve solo a chi ha davvero le risposte caricate.
      if (ctx.rispostePronte && dizionarioPronto() && mayAct(s, 'chiudi', referent)) {
        G.backend.applyAtomic(C.mutChiudiRevisione, ctx).then(function (r) {
          if (r && r.ok) { actionOk(s, 'chiudi'); toast('🧮 Revisione chiusa: punti assegnati', 'ok'); }
          else actionFailed(s, 'chiudi', r);
        });
      }
      G.busy = false;
      return;
    }

    if (rd.fase === 'risultati' && mayAct(s, 'avanti', referent)) {
      G.backend.applyAtomic(C.mutProssimoRound, ctx).then(function (r) {
        if (r && r.ok) actionOk(s, 'avanti'); else actionFailed(s, 'avanti', r);
      });
    }
    G.busy = false;
  }

  /* ---------------- TIMER LOCALE (solo rappresentazione) ---------------- */
  function timerFrame() {
    var s = G.state;
    var rd = s && s.roundData;
    if (s && s.stato === 'in_corso' && rd && rd.deadline) {
      var now = Date.now();
      var span = Math.max(1, rd.deadline - (rd.inizio || (rd.deadline - 1)));
      var rest = Math.max(0, rd.deadline - now);
      var frac = Math.min(1, rest / span);
      var sec = secondiTra(rd.deadline, now);
      var danger = sec <= 10;
      el['timer-num'].textContent = String(sec);
      el['timer-num'].classList.toggle('danger', danger);
      el['timer-fill'].style.width = Math.round(frac * 100) + '%';
      el['timer-fill'].classList.toggle('danger', danger);
      el['timer-label'].textContent = rd.fase === 'revisione' ? 'SECONDI ALLA CHIUSURA'
        : rd.fase === 'risultati' ? 'SECONDI AL PROSSIMO ROUND' : 'SECONDI ALLA CONSEGNA';
      if (rd.fase === 'revisione') {
        el['rev-timer-num'].textContent = String(sec);
        el['rev-timer-fill'].style.width = Math.round(frac * 100) + '%';
        el['rev-timer-fill'].classList.toggle('danger', danger);
      }
      if (rd.fase === 'risultati') {
        el['res-countdown'].textContent = s.round >= s.opzioni.round
          ? 'Classifica finale tra ' + sec + ' s…'
          : 'Prossimo round tra ' + sec + ' s…';
      }
    }
    requestAnimationFrame(timerFrame);
  }

  /**
   * Categorie dell'allenamento dalla URL:
   *  ?categorie=light|classic          → preset condiviso;
   *  ?categorie=nomi,cose,MARCHI       → lista di id (anche personalizzati).
   */
  function categorieDaParam(val) {
    if (!val) return 'classic';
    var v = String(val).trim();
    if (C.PRESET_CATEGORIE[v]) return v;
    var lista = v.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    return lista.length ? lista : 'classic';
  }

  /* ---------------- BOOT ---------------- */
  function startSolo() {
    G.backend.applyAtomic(C.mutStart, ctxAvanzamento(G.state));
  }

  function confermaRevisione() {
    G.backend.applyAtomic(C.mutConfermaRevisione).then(function (r) {
      if (r && r.ok) toast('✔ Revisione confermata', 'ok');
      else if (r && r.error && r.error.code === 'NON_PARTECIPANTE') toast('Non partecipi a questo round');
      else if (r && r.error && r.error.code === 'REVISIONE_CHIUSA') toast('La revisione è già chiusa');
    });
  }

  function boot() {
    G.gate = new B.ActionGate();

    el['btn-stop'].addEventListener('click', premiStop);
    el['btn-conferma'].addEventListener('click', confermaRevisione);
    el['btn-start-solo'].addEventListener('click', startSolo);
    el['btn-rivincita'].addEventListener('click', creaRivincita);

    if (!G.solo && !G.me) {
      alert('Effettua il login per giocare in multiplayer.');
      window.location.href = '../../index.html';
      return;
    }

    if (typeof firebase !== 'undefined' && window.FAW_REQUIRE_FIREBASE_CONFIG) {
      try {
        var cfg = window.FAW_REQUIRE_FIREBASE_CONFIG();
        if (cfg && !G.db) {
          if (typeof firebase.firestore === 'undefined') {
            console.warn('[NCC] firebase-firestore-compat.js non caricato: solo allenamento disponibile.');
          } else {
            if (!firebase.apps || firebase.apps.length === 0) firebase.initializeApp(cfg);
            G.fs = firebase.firestore;
            G.db = firebase.firestore();
            if (window.FAW_ENABLE_PERSISTENCE) window.FAW_ENABLE_PERSISTENCE(G.db);
          }
        }
      } catch (e) {
        console.warn('[NCC] init Firebase non riuscito:', e && e.message);
      }
    }

    caricaDizionario().then(function () {
      el['screen-loading'].classList.add('hidden');
      if (G.solo) {
        G.backend = new B.SoloBackend(G.me, {
          round: Math.min(10, Math.max(1, parseInt(urlParams.get('round'), 10) || 3)),
          tempo: Math.min(600, Math.max(30, parseInt(urlParams.get('tempo'), 10) || 120)),
          revisione: Math.min(600, Math.max(20, parseInt(urlParams.get('revisione'), 10) || 90)),
          categorie: categorieDaParam(urlParams.get('categorie')),
          seed: 'SOLO' + Math.random().toString(36).slice(2, 9).toUpperCase()
        });
      } else {
        if (!G.db || !G.fs) {
          setLoadStatus('❌ Firebase non disponibile: impossibile giocare in multiplayer', true);
          el['screen-loading'].classList.remove('hidden');
          return;
        }
        G.backend = new B.FirebaseBackend(G.fs, G.matchId, G.me);
        G.backend.onDead = function () {
          alert('Partita rimossa.');
          window.location.href = '../../index.html';
        };
        G.backend.onError = function () { toast('Errore di connessione a Firebase', 'err'); };
        G.backend.onRateLimit = function (ms) {
          var sec = Math.max(1, Math.ceil(ms / 1000));
          G.rateLimited = true;
          toast('⏳ Server sovraccarico: riprovo automaticamente tra ' + sec + ' s', 'err');
        };
        G.backend.onRecover = function () {
          G.rateLimited = false;
          toast('Connessione ripristinata', 'ok');
        };
        G.backend.start();
      }

      G.backend.subscribe(render);
      G.backend.onRisposte(function (d) {
        G.risposteViste = d || {};
        if (G.solo) G.risposteSolo = d || {};
        var rd = G.state && G.state.roundData;
        if (!rd) return;
        if (rd.fase === 'compilazione') {
          // Ripristino (refresh/riconnessione): si riempiono solo i campi che
          // l'utente non sta modificando, senza sovrascrivere la digitazione.
          var mie = (d && d[G.me]) || {};
          Object.keys(mie).forEach(function (catId) {
            if (!G.touched[catId]) G.campi[catId] = (mie[catId] && mie[catId].raw) || '';
          });
          applicaCampi();
          aggiornaStop();
        }
        if (rd.fase === 'revisione') renderRevisione(G.state);
      });
      G.backend.onSalvataggio(function (st) {
        // Lo stato del backend (coda offline / server) prevale su quello locale.
        if (st === 'in_coda' || st === 'salvato') setSaveState(st);
      });

      setInterval(tick, C.TICK_MS);
      requestAnimationFrame(timerFrame);
    }).catch(function (e) {
      console.error('[NCC] errore dizionario:', e);
      setLoadStatus('❌ Errore caricamento dizionario: ' + (e && e.message), true);
      el['load-count'].className = 'load-count error';
      el['load-count'].innerHTML =
        '<button class="btn btn-fire" onclick="location.reload()">🔄 RIPROVA</button>';
    });
  }

  /* Finestra chiusa/ricaricata: prova a salvare le modifiche pendenti. */
  window.addEventListener('beforeunload', function () {
    if (G.saveTimer) {
      clearTimeout(G.saveTimer);
      G.saveTimer = null;
      try { G.backend.salvaRisposte(rispostePayload()); } catch (e) { /* noop */ }
    }
  });

  /* Hook di debug/verifica (usato anche dai test E2E) */
  global.__NCC = {
    get state() { return G.state; },
    get dizionario() { return G.dizionario; },
    get campi() { return G.campi; },
    get backend() { return G.backend; },
    salva: salva,
    stop: premiStop
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
