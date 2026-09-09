/* E2E (jsdom) di "Nomi, Cose, Città" in ALLENAMENTO SOLO.
   Usa la pagina reale (index.html + js/core.js + js/backend.js + js/ui.js)
   con un campione del dizionario Ruzzle reale.
   Verifica: boot, lobby, compilazione, STOP, punteggio di allenamento,
   assenza totale di scritture multiplayer, refresh senza riavvio del round,
   schermata finale e statistiche scritte una volta sola. */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'games/nomi-cose-citta/index.html'), 'utf8');
const coreJs = fs.readFileSync(path.join(ROOT, 'games/nomi-cose-citta/js/core.js'), 'utf8');
const backendJs = fs.readFileSync(path.join(ROOT, 'games/nomi-cose-citta/js/backend.js'), 'utf8');
const uiJs = fs.readFileSync(path.join(ROOT, 'games/nomi-cose-citta/js/ui.js'), 'utf8');

/* Campione del dizionario reale: una riga ogni dieci, cosi' il campione copre
   tutto l'alfabeto (il file e' ordinato: le prime righe sono solo parole con "a"). */
const dictSample = fs.readFileSync(path.join(ROOT, 'dizionario.txt'), 'utf8')
  .split('\n').filter((_, i) => i % 10 === 0).join('\n');

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  \u2714', msg); }
  else { failed++; console.log('  \u2718', msg); }
}
function eq(a, b, msg) {
  if (JSON.stringify(a) === JSON.stringify(b)) { passed++; console.log('  \u2714', msg); }
  else { failed++; console.log('  \u2718', msg, '\n    atteso:', JSON.stringify(b), '\n    ottenuto:', JSON.stringify(a)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (fn()) return true;
    await sleep(80);
  }
  console.log('  \u2718 timeout in attesa di:', what);
  failed++;
  return false;
}

function norm(w) {
  return String(w).trim().toUpperCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z]/g, '');
}
const PAROLE = {};
dictSample.split('\n').forEach((w) => {
  const n = norm(w);
  if (n.length >= 4) (PAROLE[n.charAt(0)] = PAROLE[n.charAt(0)] || []).push(w.trim());
});

(async () => {
  const dom = new JSDOM(html, {
    url: 'http://localhost/games/nomi-cose-citta/index.html?round=1&tempo=120&revisione=60&categorie=light',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const { window } = dom;
  const { document } = window;

  window.fetch = async (url) => {
    if (String(url).indexOf('dizionario') !== -1) {
      return { ok: true, status: 200, text: async () => dictSample };
    }
    throw new Error('no network: ' + url);
  };

  window.eval(coreJs);
  window.eval(backendJs);
  window.eval(uiJs);

  console.log('\n[1] Boot: dizionario → lobby di allenamento');
  ok(await until(() => {
    const b = document.getElementById('btn-start-solo');
    return b && !b.classList.contains('hidden');
  }, 'pulsante INIZIA ALLENAMENTO'), 'lobby mostrata con il dizionario caricato');
  ok(document.getElementById('screen-loading').classList.contains('hidden'), 'schermata di caricamento nascosta');
  const count = document.getElementById('load-count').textContent;
  ok(/parole nel dizionario/.test(count), 'conteggio parole mostrato: ' + count.split('·')[0].trim());
  ok(/versione v1:/.test(count), 'fingerprint del dizionario mostrato');
  ok(window.__NCC.dizionario.conteggio > 10000, 'dizionario reale caricato (' + window.__NCC.dizionario.conteggio + ')');
  ok(window.__NCC.backend.solo === true, 'backend di allenamento (SoloBackend)');
  eq(typeof window.firebase, 'undefined', 'nessun Firebase nella pagina di allenamento');

  console.log('\n[2] Configurazione partita dalla lobby');
  eq(document.getElementById('cfg-round').textContent, '1', 'round dalla URL');
  eq(document.getElementById('cfg-tempo').textContent, '120s', 'tempo di compilazione');
  eq(document.getElementById('cfg-revisione').textContent, '60s', 'tempo di revisione');
  const chips = document.querySelectorAll('#lobby-cats .cat-chip');
  eq(chips.length, 3, 'preset light: 3 categorie');
  ok(/Nomi/.test(chips[0].textContent), 'categoria Nomi');
  ok(/Città/.test(chips[2].textContent), 'categoria Città');
  ok(document.querySelector('.punti-regola').textContent.indexOf('20') !== -1, 'regola dei punti dichiarata in UI');

  console.log('\n[3] Avvio: compilazione con campi e timer');
  document.getElementById('btn-start-solo').dispatchEvent(new window.Event('click'));
  ok(await until(() => !document.getElementById('screen-gioco').classList.contains('hidden'), 'schermata di gioco'),
    'schermata di gioco visibile');
  const lettera = document.getElementById('lettera-tile').textContent;
  ok(/^[A-Z]$/.test(lettera), 'lettera del round mostrata: ' + lettera);
  const inputs = document.querySelectorAll('#campi input');
  eq(inputs.length, 3, 'un campo per categoria');
  ok(document.getElementById('btn-stop').disabled, 'STOP disabilitato con campi vuoti');
  await sleep(300);
  ok(parseInt(document.getElementById('timer-num').textContent, 10) > 0,
    'timer locale attivo: ' + document.getElementById('timer-num').textContent + 's');
  eq(document.getElementById('fase-chip').textContent, 'COMPILAZIONE', 'fase compilazione');
  eq(window.__NCC.state.roundData.partecipanti, ['GIOCATORE'], 'allenamento: un solo partecipante, nessun quorum');

  console.log('\n[4] Digitazione: validità in tempo reale e STOP abilitato');
  const parole = (PAROLE[lettera] || ['zzzz']).slice(0, 3);
  ok(parole.length === 3, 'tre parole reali con iniziale ' + lettera + ': ' + parole.join(', '));
  for (let i = 0; i < inputs.length; i++) {
    inputs[i].value = parole[i];
    inputs[i].dispatchEvent(new window.Event('input', { bubbles: true }));
  }
  await sleep(50);
  ok(!document.getElementById('btn-stop').disabled, 'STOP abilitato con tutti i campi pieni');
  const stati = document.querySelectorAll('#campi .campo-stato');
  ok(Array.prototype.every.call(stati, (s) => s.classList.contains('ok')), 'tutte le risposte risultano nel dizionario');
  inputs[0].value = lettera + 'ZZZQX';
  inputs[0].dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(50);
  ok(/assente/i.test(document.querySelectorAll('#campi .campo-stato')[0].textContent),
    'motivo di invalidità mostrato: ' + document.querySelectorAll('#campi .campo-stato')[0].textContent);
  ok(!document.getElementById('btn-stop').disabled, 'STOP resta disponibile: parole sbagliate incluse');
  inputs[0].value = parole[0];
  inputs[0].dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(1400);   // oltre il debounce di salvataggio
  ok(/salvato/i.test(document.getElementById('save-state').textContent),
    'indicatore di salvataggio: ' + document.getElementById('save-state').textContent);

  console.log('\n[5] STOP → riepilogo con punteggio di allenamento');
  document.getElementById('btn-stop').dispatchEvent(new window.Event('click'));
  ok(await until(() => !document.getElementById('overlay-risultati').classList.contains('hidden'),
    'overlay risultati'), 'overlay dei risultati del round');
  const st = window.__NCC.state;
  eq(st.roundData.fase, 'risultati', 'fase risultati');
  eq(st.punteggi.GIOCATORE, 30, '3 risposte valide × 10 punti (allenamento)');
  const celle = st.risultati[0].celle;
  ok(celle.every((c) => c.punti === 10), 'nessuna risposta da 20 in allenamento');
  eq(st.risultati[0].allenamento, true, 'risultato marcato come allenamento');
  ok(/Allenamento: 10 punti/.test(document.getElementById('res-body').textContent),
    'punteggio di allenamento spiegato in UI');

  console.log('\n[6] Annullamento MANUALE distinto dalla validazione automatica');
  const btnManuale = document.querySelector('#res-body .btn-manuale');
  ok(!!btnManuale, 'pulsante di annullamento manuale presente in allenamento');
  btnManuale.dispatchEvent(new window.Event('click'));
  await sleep(80);
  eq(window.__NCC.state.punteggi.GIOCATORE, 20, 'annullamento manuale → 20 punti');
  const annullata = window.__NCC.state.risultati[0].celle.filter((c) => c.annullataManuale)[0];
  ok(!!annullata, 'cella marcata come annullata manualmente');
  eq(annullata.motivoAutomatico, null, 'la validità automatica resta registrata a parte');
  ok(/annullata manualmente/i.test(document.getElementById('res-body').textContent),
    'distinzione visibile in UI');

  console.log('\n[7] Nessun dato multiplayer scritto');
  eq(window.__NCC.backend.scrittureFirestore, 0, 'zero scritture Firestore in allenamento');
  ok(!window.__NCC.backend.db, 'nessuna istanza Firestore nel backend di allenamento');
  eq(window.__NCC.backend.statoSalvataggio() === 'salvato', true, 'salvataggio solo in memoria');

  console.log('\n[8] Refresh: lo stato condiviso non riavvia il round');
  {
    const prima = window.__NCC.state.roundData.id;
    const puntiPrima = window.__NCC.state.punteggi.GIOCATORE;
    window.__NCC.backend._emit();
    window.__NCC.backend._emit();
    await sleep(120);
    eq(window.__NCC.state.roundData.id, prima, 'stesso round dopo il re-render');
    eq(window.__NCC.state.punteggi.GIOCATORE, puntiPrima, 'punteggi invariati');
    eq(window.__NCC.state.risultati.length, 1, 'un solo risultato, non duplicato');
    ok(!document.getElementById('overlay-risultati').classList.contains('hidden'), 'schermata coerente dopo il refresh');
  }

  console.log('\n[9] Fine partita e statistiche');
  ok(await until(() => !document.getElementById('overlay-fine').classList.contains('hidden'),
    'overlay fine partita', 25000), 'schermata finale dopo il recap');
  eq(window.__NCC.state.stato, 'conclusa', 'partita conclusa');
  ok(document.getElementById('btn-rivincita').classList.contains('hidden'), 'nessuna rivincita in allenamento');
  ok(document.getElementById('fine-dettaglio').textContent.indexOf('Round 1') !== -1, 'dettaglio per round');
  const stats = JSON.parse(window.localStorage.getItem('funatwork_daily_stats') || '{}');
  const oggi = new Date().toISOString().split('T')[0];
  eq(stats.days && stats.days[oggi] && stats.days[oggi].ncc, 1, 'statistica registrata una volta sola');
  eq(stats.totals && stats.totals.ncc, 1, 'totale aggiornato');
  await sleep(1500);
  eq(JSON.parse(window.localStorage.getItem('funatwork_daily_stats')).days[oggi].ncc, 1,
    'nessun doppio conteggio dopo altri render');

  console.log('\n=================');
  console.log('PASSATI: ' + passed + '  FALLITI: ' + failed);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('ERRORE TEST BROWSER:', e);
  process.exit(1);
});
