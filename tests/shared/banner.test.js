/* Test del banner condiviso: variante compatta, accessibilità e aggiornamento
   delle classi senza effetti residui tra un banner e il successivo. */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const js = fs.readFileSync(path.join(ROOT, 'games/shared/faw-banner.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'games/shared/faw-ui.css'), 'utf8');
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  \u2714', msg); }
  else { failed++; console.log('  \u2718', msg); }
}

const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously' });
const w = dom.window;
let syncCalls = 0;
w.FAW_SYNC_BANNER_SPACE = () => { syncCalls++; };
w.eval(js);

console.log('\n[1] Variante compatta del banner');
const compatto = w.FAW_BANNER.banner({
  id: 'game-banner', icon: '⏳', title: 'IN ATTESA', subtitle: 'La sfida continua',
  compact: true, sticky: true, buttons: []
});
ok(!!compatto && compatto.classList.contains('faw-banner--compatto'), 'compact aggiunge la classe compatta');
ok(compatto.classList.contains('faw-banner--pannello') && !compatto.classList.contains('faw-banner--tinta'),
  'senza tinta usa il pannello del tema');
ok(compatto.getAttribute('role') === 'status' && compatto.getAttribute('aria-live') === 'polite',
  'mantiene il ruolo accessibile di stato');
ok(syncCalls === 1, 'la nuova altezza viene comunicata al layout condiviso');

console.log('\n[2] Aggiornamento senza classi rimaste');
const tinta = w.FAW_BANNER.banner({ id: 'game-banner', title: 'ALTRO', color: '#336699', sticky: true });
ok(tinta === compatto, 'riusa lo stesso elemento');
ok(tinta.classList.contains('faw-banner--tinta') && !tinta.classList.contains('faw-banner--compatto'),
  'aggiornando il banner rimuove la variante compatta precedente');
const vittoria = w.FAW_BANNER.banner({ id: 'game-banner', title: 'VITTORIA', compact: true, vibrate: true, sticky: true });
ok(vittoria.classList.contains('faw-banner--compatto') && vittoria.classList.contains('faw-banner--vittoria'),
  'la variante vittoria si combina con il layout compatto');
w.FAW_BANNER.chiudi('game-banner');
ok(vittoria.classList.contains('hidden'), 'chiudi nasconde il banner');
ok(syncCalls === 4, 'ogni aggiornamento e chiusura riallinea lo spazio riservato');

console.log('\n[3] Stili di compattezza e area HOME');
ok(/\.faw-banner--compatto\s*\{[\s\S]{0,450}padding:\s*8px 18px/.test(css),
  'la variante riduce padding e altezza');
const mobile = css.slice(css.indexOf('@media (max-width: 600px)'));
ok(/\.faw-banner--compatto\s*\{[\s\S]{0,300}padding-left:\s*var\(--faw-home-safe-x\)/.test(mobile),
  'su mobile riserva lo spazio del pulsante HOME');
ok(/body\.faw-has-banner::before/.test(css) && /--faw-banner-h/.test(css),
  'resta attivo lo spacer che evita sovrapposizioni con il contenuto');

console.log('\n=================');
console.log('PASSATI: ' + passed + '  FALLITI: ' + failed);
w.close();
process.exit(failed ? 1 : 0);
