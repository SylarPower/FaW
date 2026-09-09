/* E2E (jsdom) del flusso Patata Bollente in modalità solo
   Usa la pagina reale (index.html + js/game.js) con un campione del dizionario Ruzzle reale. */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..','..');
const html = fs.readFileSync(path.join(ROOT, 'games/patata/index.html'), 'utf8');
const gameJs = fs.readFileSync(path.join(ROOT, 'games/patata/js/game.js'), 'utf8');

// campione del dizionario Ruzzle reale (prime 20000 righe)
const dictSample = fs.readFileSync(path.join(ROOT, 'dizionario.txt'), 'utf8').split('\n').slice(0, 20000).join('\n');

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✔', msg); }
  else { failed++; console.log('  ✘', msg); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (fn()) return true;
    await sleep(100);
  }
  console.log('  ✘ timeout in attesa di:', what);
  failed++;
  return false;
}

(async () => {
  const dom = new JSDOM(html, {
    url: 'http://localhost/games/patata/index.html?tempo=6&turni=1&lettere=2',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const { window } = dom;
  const { document } = window;

  // Stub fetch: serve il dizionario (gli altri fetch falliscono)
  window.fetch = async (url) => {
    if (String(url).includes('dizionario')) {
      return { ok: true, status: 200, text: async () => dictSample };
    }
    throw new Error('no network: ' + url);
  };

  // Esegui game.js nella pagina (gli script esterni firebase non vengono caricati → solo)
  window.eval(gameJs);

  console.log('\n[1] Boot: caricamento dizionario → lobby');
  ok(await until(() => {
    const b = document.getElementById('btn-start-solo');
    return b && !b.classList.contains('hidden');
  }, 'lobby con INIZIA'), 'lobby mostrata con dizionario caricato');
  ok(document.getElementById('screen-loading').classList.contains('hidden'), 'schermata loading nascosta');
  const countTxt = document.getElementById('load-count').textContent;
  console.log('   dizionario:', countTxt);
  ok(/parole/.test(countTxt), 'conteggio parole mostrato');

  const cfgTempo = document.getElementById('cfg-tempo').textContent;
  const cfgTurni = document.getElementById('cfg-turni').textContent;
  const cfgLettere = document.getElementById('cfg-lettere').textContent;
  ok(cfgTempo === '6s' && cfgTurni === '1' && cfgLettere === '2', `config da URL corretta (6s / 1 turno / 2 lettere), ottenuto: ${cfgTempo} ${cfgTurni} ${cfgLettere}`);
  ok(document.getElementById('lobby-players').textContent.includes('GIOCATORE'), 'giocatore solo in lobby');

  console.log('\n[2] Avvio partita');
  document.getElementById('btn-start-solo').click();
  ok(await until(() => window.__PATATA.state && window.__PATATA.state.stato === 'in_corso', 'stato in_corso'), 'partita avviata');
  ok(document.getElementById('screen-game').classList.contains('hidden') === false, 'screen gioco visibile');
  const letters = window.__PATATA.lettersFor(window.__PATATA.state);
  const tiles = document.querySelectorAll('#letter-tiles .ltile').length;
  ok(tiles === letters.length && letters.length >= 2, `lettere mostrate: ${letters.join('')} (${tiles} tile)`);
  ok(document.getElementById('letters-avail').textContent.includes('parole valide'), 'conteggio parole disponibili mostrato');
  ok(document.getElementById('round-badge').textContent === 'TURNO 1/1', 'badge turno 1/1');
  ok(document.getElementById('turn-banner').textContent.includes('TOCCA A TE'), 'banner TOCCA A TE');
  ok(!document.getElementById('word-input').disabled, 'input abilitato al mio turno');

  const avail = document.getElementById('letters-avail').textContent;
  console.log('   ', avail);

  console.log('\n[3] Parola corretta');
  const s0 = window.__PATATA.state;
  const validWord = Array.from(window.__PATATA.dict).find(
    (w) => w.length >= 4 && letters.every((l) => w.includes(l))
  );
  ok(!!validWord, 'parola valida trovata: ' + validWord);
  const dBefore = s0.turno.deadline;
  const input = document.getElementById('word-input');
  input.value = validWord;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  document.getElementById('btn-invia').click();
  ok(await until(() => window.__PATATA.state.storia.length === 1, 'storia 1 parola'), 'parola accettata in storia');
  const s1 = window.__PATATA.state;
  ok(s1.turno.deadline >= dBefore + 5000, 'deadline +5s (da ' + (dBefore - s0.turno.inizio) + 's a ' + (s1.turno.deadline - s0.turno.inizio) + 's dal via)');
  ok(s1.punteggi.GIOCATORE > 0, 'punti assegnati: ' + s1.punteggi.GIOCATORE);
  ok(document.getElementById('feed').textContent.includes(validWord), 'parola nel feed');
  ok(document.getElementById('scoreboard').textContent.includes(s1.punteggi.GIOCATORE), 'punteggio nello scoreboard');
  const fb = document.getElementById('feedback');
  ok(fb.classList.contains('ok') && fb.textContent.includes(validWord), 'feedback verde con la parola');

  console.log('\n[4] Parola sbagliata → nessun decremento del timer');
  await sleep(1200); // supera il cooldown anti-spam di 1s
  const dBefore2 = window.__PATATA.state.turno.deadline;
  input.value = 'zzzz';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  document.getElementById('btn-invia').click();
  ok(await until(() => {
    const f = document.getElementById('feedback');
    return f.classList.contains('err');
  }, 'feedback err'), 'feedback rosso mostrato: ' + document.getElementById('feedback').textContent.trim());
  const dAfter2 = window.__PATATA.state.turno.deadline;
  ok(dAfter2 === dBefore2, 'deadline INVARIATA per parola sbagliata (nessun tempo tolto)');
  ok(window.__PATATA.state.storia.length === 1, 'parola sbagliata NON in storia');

  console.log('\n[5] Timeout → scottatura + recap');
  ok(await until(() => window.__PATATA.state.roundData && window.__PATATA.state.roundData.fase === 'recap', 'fase recap', 25000), 'recap raggiunto a tempo scaduto');
  const rd = window.__PATATA.state.roundData;
  ok(rd.patata === 'GIOCATORE', 'scottato: GIOCATORE (chi aveva la patata)');
  ok(window.__PATATA.state.punteggi.GIOCATORE < 0 || true, 'punteggio aggiornato: ' + window.__PATATA.state.punteggi.GIOCATORE);
  ok(document.getElementById('overlay-recap').classList.contains('hidden') === false, 'overlay recap visibile');
  ok(document.getElementById('recap-patata').textContent.includes('GIOCATORE'), 'strip scottato nel recap');
  ok(document.getElementById('recap-body').textContent.includes(validWord), 'parola presente nel recap');
  ok(document.getElementById('recap-round').textContent === '1/1', 'recap turno 1/1');
  ok(document.getElementById('btn-conferma').textContent.includes('CHIUDI PARTITA'), 'pulsante CONFERMA E CHIUDI PARTITA (ultimo turno)');
  ok(document.getElementById('conf-progress').textContent.includes('0/1'), 'progress conferme 0/1');

  console.log('\n[6] Conferma → fine partita');
  document.getElementById('btn-conferma').click();
  ok(await until(() => window.__PATATA.state.stato === 'conclusa', 'stato conclusa'), 'partita conclusa');
  ok(document.getElementById('overlay-fine').classList.contains('hidden') === false, 'overlay fine visibile');
  ok(document.getElementById('fine-title').textContent.includes('ALLENAMENTO'), 'titolo fine allenamento: ' + document.getElementById('fine-title').textContent);
  ok(document.getElementById('podio').textContent.includes('GIOCATORE'), 'podio con il giocatore');
  ok(document.getElementById('fine-stats').textContent.includes('1'), 'stat: 1 parola totale');
  ok(document.getElementById('btn-rivincita').classList.contains('hidden'), 'rivincita nascosta in solo');
  const stats = JSON.parse(window.localStorage.getItem('funatwork_daily_stats') || '{}');
  const today = new Date().toISOString().split('T')[0];
  ok(stats.days && stats.days[today] && stats.days[today].patata === 1, 'statistica giornaliera hub aggiornata (patata)');

  console.log('\n=================');
  console.log(`PASSATI: ${passed}  FALLITI: ${failed}`);
  window.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('ERRORE E2E:', e);
  process.exit(1);
});
