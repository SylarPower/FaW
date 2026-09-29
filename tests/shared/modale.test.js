/* Modali condivise (games/shared/faw-modale.js): ruolo di dialogo, Esc,
   click sullo sfondo e gestione del focus. */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'games/shared/faw-modale.js'), 'utf8');
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  \u2714', msg); }
  else { failed++; console.log('  \u2718', msg); }
}
function eq(a, b, msg) {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja === jb) { passed++; console.log('  \u2714', msg); }
  else { failed++; console.log('  \u2718', msg, '\n    atteso:', jb, '\n    ottenuto:', ja); }
}
const attesa = (ms) => new Promise((r) => setTimeout(r, ms));

function pagina() {
  const dom = new JSDOM(`<!doctype html><html><body>
    <button id="apri">Apri</button>
    <div id="stats-modal" class="modal-overlay" style="display:none;">
      <div class="modal-content">
        <button id="dentro-1">Dentro</button>
        <button id="chiudi">Chiudi</button>
      </div>
    </div>
    <div id="gioca-modal" class="modal-overlay" style="display:none;">
      <div class="modal-content"><p>Devi scegliere una modalità</p></div>
    </div>
  </body></html>`, { url: 'http://localhost/games/ruzzle/index.html', runScripts: 'dangerously' });
  dom.window.eval(src);
  return dom.window;
}

const mostra = (w, id) => { w.document.getElementById(id).style.display = 'flex'; };
const nascondi = (w, id) => { w.document.getElementById(id).style.display = 'none'; };
const esc = (w) => w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

(async () => {
  console.log('\n[1] Ruolo di dialogo e focus');
  {
    const w = pagina();
    const M = w.FAW_MODALE;
    let chiusure = 0;
    const h = M.attiva('stats-modal', { chiudi: () => { chiusure++; nascondi(w, 'stats-modal'); }, etichetta: 'Statistiche' });
    const el = w.document.getElementById('stats-modal');
    ok(!!h, 'la modale viene registrata');
    eq(el.getAttribute('role'), 'dialog', 'role="dialog" impostato');
    eq(el.getAttribute('aria-modal'), 'true', 'aria-modal="true" impostato');
    eq(el.getAttribute('aria-label'), 'Statistiche', 'aria-label preso dall\'etichetta');
    ok(el.getAttribute('tabindex') === '-1', 'la modale è raggiungibile dal focus');

    /* il focus entra nella modale e torna da dove era partito */
    const apri = w.document.getElementById('apri');
    apri.focus();
    h.mostra();
    eq(w.document.activeElement.id, 'dentro-1', 'il focus entra sul primo controllo della modale');
    eq(el.style.display, 'flex', 'apertura con display flex (come prima)');
    ok(!el.hasAttribute('aria-hidden'), 'senza aria-hidden quando è aperta');
    eq(chiusure, 0, 'aprire non significa chiudere');

    /* La modale la nasconde il gioco (style.display), non l'helper: l'aria
       deve comunque tornare coerente. */
    nascondi(w, 'stats-modal');
    await attesa(20);
    ok(el.getAttribute('aria-hidden') === 'true', 'aria-hidden quando è nascosta dal gioco');
    h.mostra();
    h.nascondi();
    await attesa(20);
    eq(w.document.activeElement.id, 'apri', 'alla chiusura il focus torna al pulsante di partenza');
  }

  console.log('\n[2] Esc e click sullo sfondo');
  {
    const w = pagina();
    const M = w.FAW_MODALE;
    let chiusure = 0;
    M.attiva('stats-modal', { chiudi: () => { chiusure++; nascondi(w, 'stats-modal'); } });
    const el = w.document.getElementById('stats-modal');

    esc(w);
    eq(chiusure, 0, 'Esc con la modale chiusa non fa niente');
    mostra(w, 'stats-modal');
    esc(w);
    eq(chiusure, 1, 'Esc chiude la modale aperta');
    ok(el.style.display === 'none', 'la modale è a video chiusa');

    mostra(w, 'stats-modal');
    click(w, el);
    eq(chiusure, 2, 'click sullo sfondo chiude');
    mostra(w, 'stats-modal');
    click(w, w.document.querySelector('#stats-modal .modal-content'));
    eq(chiusure, 2, 'click sul contenuto non chiude');
  }

  console.log('\n[3] Modale senza chiusura automatica (flusso a pulsante)');
  {
    const w = pagina();
    const M = w.FAW_MODALE;
    const el = w.document.getElementById('gioca-modal');
    M.attiva('gioca-modal', { etichetta: 'Modalità' });   // nessun `chiudi`
    mostra(w, 'gioca-modal');
    esc(w);
    ok(el.style.display === 'flex', 'senza `chiudi` Esc non la fa sparire');
    click(w, el);
    ok(el.style.display === 'flex', 'nemmeno il click sullo sfondo la chiude');
    ok(!!M.attiva('gioca-modal', { etichetta: 'Modalità' }), 'registrabile più volte senza effetti');
    const h3 = M.attiva('stats-modal', { chiudi: () => nascondi(w, 'stats-modal'), esc: false });
    mostra(w, 'stats-modal');
    esc(w);
    ok(w.document.getElementById('stats-modal').style.display === 'flex', 'esc:false disattiva solo Esc');
    click(w, w.document.getElementById('stats-modal'));
    ok(w.document.getElementById('stats-modal').style.display === 'none', 'il click sullo sfondo resta attivo');
    h3.rilascia();
    ok(M.registrate.indexOf(h3) === -1, 'dopo rilascia() la modale esc:false esce dal registro');
  }

  console.log('\n[4] Due modali aperte: Esc chiude solo quella in cima');
  {
    const w = pagina();
    const M = w.FAW_MODALE;
    const ordine = [];
    M.attiva('stats-modal', { chiudi: () => { ordine.push('stats'); nascondi(w, 'stats-modal'); } });
    M.attiva('gioca-modal', { chiudi: () => { ordine.push('gioca'); nascondi(w, 'gioca-modal'); } });
    mostra(w, 'stats-modal');
    mostra(w, 'gioca-modal');
    esc(w);
    eq(ordine, ['gioca'], 'chiude la modale più recente');
    esc(w);
    eq(ordine, ['gioca', 'stats'], 'poi la precedente');
  }

  console.log('\n[5] rilascia() stacca i listener');
  {
    const w = pagina();
    const M = w.FAW_MODALE;
    let chiusure = 0;
    const h = M.attiva('stats-modal', { chiudi: () => { chiusure++; nascondi(w, 'stats-modal'); } });
    mostra(w, 'stats-modal');
    ok(M.registrate.indexOf(h) !== -1, 'la modale è nel registro');
    h.rilascia();
    esc(w);
    click(w, w.document.getElementById('stats-modal'));
    eq(chiusure, 0, 'dopo rilascia() non risponde più');
    ok(M.registrate.indexOf(h) === -1, 'uscita dal registro');
  }

  console.log('\n=================');
  console.log('PASSATI: ' + passed + '  FALLITI: ' + failed);
  process.exit(failed ? 1 : 0);
})();
