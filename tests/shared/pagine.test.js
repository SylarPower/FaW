/* Check globale della piattaforma: quello che deve valere su OGNI pagina
   (hub compreso) e che nessuna suite di singolo gioco può garantire.

   Non carica le pagine: controlla i file. È veloce, non è mai intermittente e
   copre le regressioni che si vedono a occhio nudo ("sul Gioco del 15 il testo
   è tornato microscopico", "la pagina X non carica più il tema", "manca un
   file"). Le suite per gioco restano quelle che verificano il comportamento. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  \u2714', msg); }
  else { failed++; console.log('  \u2718', msg); }
}

/* Le pagine della piattaforma: l'hub e i giochi raggiungibili dalle card. */
const PAGINE = [
  'index.html',
  'games/patata/index.html',
  'games/nomi-cose-citta/index.html',
  'games/ruzzle/index.html',
  'games/pictionary/index.html',
  'games/gameof15/index.html',
  'games/neonwar/index.html',
];

/* Finestre di gioco per pagina: gli id che devono risultare registrati con il
   modulo condiviso (ruolo di dialogo, stato aria, Esc e sfondo dove è sicuro).
   Il Pictionary non ne ha: attese e vincitore passano dai banner, e le sue
   "overlay-screen" sono schermate, non finestre da chiudere. */
const FINESTRE = {
  'games/patata/index.html': ['overlay-recap', 'overlay-pausa', 'overlay-target', 'overlay-fine'],
  'games/nomi-cose-citta/index.html': ['overlay-revisione', 'overlay-risultati', 'overlay-fine'],
  'games/ruzzle/index.html': ['missed-words-modal', 'new-game-modal', 'stats-modal', 'legend-modal', 'game-end-modal'],
  'games/gameof15/index.html': ['mode-screen', 'shop-screen', 'stats-screen', 'pause-screen'],
  'games/pictionary/index.html': [],
};

const FOGLI = PAGINE.map((p) => p.replace(/index\.html$/, '') + 'index.html')
  .concat(['games/patata/css/style.css', 'games/nomi-cose-citta/css/style.css',
    'games/shared/faw-ui.css', 'games/shared/podio.css', 'games/shared/rivincita.css']);

const leggi = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
/* Il markup senza gli script: dentro gli script ci sono template HTML e
   controllarli come se fossero DOM statico dà falsi allarmi. */
const soloMarkup = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '');

/* Il minimo di leggibilità della piattaforma (scala in faw-ui.css). */
const MIN_FONT_REM = 0.6875;   // 11px, e solo per micro-etichette
const MIN_TESTO_REM = 0.75;    // 12px per il testo che si legge

console.log('\n[1] Ogni pagina è una pagina della piattaforma');
PAGINE.forEach((f) => {
  const html = leggi(f);
  ok(/<html[^>]*\slang="it"/.test(html), f + ': lingua dichiarata (lang="it")');
  ok(/<meta name="viewport"/.test(html), f + ': viewport dichiarata');
  ok(/<title>[^<]{3,}<\/title>/.test(html), f + ': titolo di pagina');
  ok(/name="description"/.test(html), f + ': descrizione per i motori di ricerca');
  ok(/fonts\.googleapis\.com\/css2\?family=Nunito/.test(html), f + ': carica il font di piattaforma (Nunito)');
  ok(/Nunito:wght@400;500;600;700;800;900/.test(html),
    f + ': carica tutti i pesi usati (500 compreso: altrimenti il browser ne inventa uno)');
  ok(/rel="preconnect"/.test(html), f + ': preconnect ai font (niente lampo di testo)');
  ok(/rel="icon"/.test(html), f + ': favicon');
});

console.log('\n[2] Il tema scelto sull\'hub non si perde entrando in partita');
PAGINE.forEach((f) => {
  const html = leggi(f);
  if (f === 'index.html') return;                     // l'hub il tema lo decide
  const iTema = html.indexOf('faw-theme.js');
  const iCss = html.indexOf('<link rel="stylesheet"');
  ok(iTema !== -1 && iCss !== -1 && iTema < iCss,
    f + ': faw-theme.js prima dei fogli di stile (niente lampo chiaro/scuro)');
  ok(/faw-ui\.css/.test(html), f + ': carica il design system condiviso');
});

console.log('\n[3] Risorse: nessun file mancante, nessun riferimento morto');
PAGINE.forEach((f) => {
  const html = leggi(f);
  const mancanti = [];
  const re = /<(?:script|link)[^>]*?(?:src|href)="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const u = m[1];
    if (/^(https?:|\/\/|data:|#)/.test(u)) continue;
    const t = path.normalize(path.join(ROOT, path.dirname(f), u.split('?')[0]));
    if (!fs.existsSync(t)) mancanti.push(u);
  }
  ok(mancanti.length === 0, f + ': tutti gli script e i fogli esistono' + (mancanti.length ? ' → ' + mancanti.join(', ') : ''));
});

console.log('\n[4] Tipografia: leggibile su ogni pagina');
FOGLI.forEach((f) => {
  const src = leggi(f);
  const piccoli = [];
  let m;
  const re = /font-size:\s*(0?\.\d+)rem/g;
  while ((m = re.exec(src))) {
    const v = parseFloat(m[1]);
    if (v < MIN_FONT_REM - 1e-9) piccoli.push(m[1] + 'rem');
  }
  ok(piccoli.length === 0, f.split('/').pop() + ': nessun testo sotto gli 11px' +
    (piccoli.length ? ' → ' + [...new Set(piccoli)].sort().join(', ') : ''));
});

console.log('\n[5] Dettagli di prodotto (hub e giochi)');
PAGINE.forEach((f) => {
  const html = leggi(f);
  const usaFawUi = /faw-ui\.css/.test(html);
  ok(usaFawUi, f + ': eredita i dettagli condivisi (focus da tastiera, selezione, scrollbar)');
  /* Chi spegne l'anello di focus deve riaccenderlo per la tastiera. */
  const spegne = /outline:\s*none/.test(html);
  const riaccende = /:focus-visible/.test(html);
  ok(!spegne || riaccende, f + ': chi toglie l\'anello di focus lo ridà a chi usa Tab');
});

console.log('\n[6] Accessibilità minima del markup');
PAGINE.forEach((f) => {
  const html = soloMarkup(leggi(f));
  const imgSenzaAlt = (html.match(/<img\b(?![^>]*\balt=)[^>]*>/g) || []).length;
  ok(imgSenzaAlt === 0, f + ': ogni immagine ha un testo alternativo' + (imgSenzaAlt ? ' (' + imgSenzaAlt + ' senza)' : ''));

  /* Un controllo ha un nome se: c'è un aria-label, un placeholder, un <label for>
     oppure è racchiuso in un <label> con del testo (come i pulsanti-carica). */
  const senzaNome = [];
  const re = /<(input|select|textarea)\b[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    if (/type="(hidden|submit|button)"/.test(tag)) continue;
    const id = (tag.match(/id="([^"]+)"/) || [null, ''])[1];
    const aria = /aria-label=|aria-labelledby=/.test(tag);
    const placeholder = /\bplaceholder=/.test(tag);
    const forLabel = id && new RegExp('for="' + id + '"').test(html);
    const dentro = /<label\b[^>]*>(?:(?!<\/label>)[\s\S])*$/i.test(html.slice(0, m.index)) &&
      /<\/label>/i.test(html.slice(m.index));
    if (!aria && !placeholder && !forLabel && !dentro) senzaNome.push(id || '?');
  }
  ok(senzaNome.length === 0, f + ': i controlli hanno un nome accessibile' +
    (senzaNome.length ? ' → ' + senzaNome.join(', ') : ''));
});

console.log('\n[7] Un solo sistema di messaggi e di finestre');
/* Dove sta il codice: c'è chi tiene tutto nella pagina e chi ha file separati. */
const SORGENTI = {
  'games/patata/index.html': ['games/patata/index.html', 'games/patata/js/game.js'],
  'games/nomi-cose-citta/index.html': ['games/nomi-cose-citta/index.html', 'games/nomi-cose-citta/js/ui.js'],
  'games/ruzzle/index.html': ['games/ruzzle/index.html'],
  'games/pictionary/index.html': ['games/pictionary/index.html'],
  'games/gameof15/index.html': ['games/gameof15/index.html'],
};
Object.keys(SORGENTI).forEach((pagina) => {
  const html = leggi(pagina);
  const codice = SORGENTI[pagina].map(leggi).join('\n');

  ok(/faw-banner\.js/.test(html), pagina + ': carica il banner condiviso');
  ok(/FAW_BANNER\.(banner|toast)/.test(codice), pagina + ': i messaggi passano da FAW_BANNER');
  ok(!/class="game-banner"/.test(codice), pagina + ': nessun banner costruito a mano rimasto');
  ok(!/class="banner-left"|class="banner-right"/.test(codice),
    pagina + ': nessun banner con la vecchia struttura interna');
  ok(!/bannerVictoryPulse|adjustColor/.test(codice), pagina + ': nessun residuo del vecchio banner');

  /* Quante finestre di gioco ha la pagina: quelle registrate con il modulo
     condiviso (ruolo di dialogo, stato aria, Esc e sfondo dove è sicuro).
     Il Pictionary non ne ha più: attese e vincitore passano dai banner, e le
     sue "overlay-screen" sono schermate, non finestre da chiudere. */
  const finestre = FINESTRE[pagina];
  if (finestre.length) {
    ok(/faw-modale\.js/.test(html), pagina + ': carica il modulo condiviso delle finestre');
    ok(/FAW_MODALE\.attiva\(/.test(codice), pagina + ': registra le sue finestre con il modulo condiviso');
    const nonRegistrate = finestre.filter((id) => codice.indexOf("'" + id + "'") === -1 &&
      codice.indexOf('"' + id + '"') === -1);
    ok(nonRegistrate.length === 0, pagina + ': tutte le finestre sono registrate' +
      (nonRegistrate.length ? ' → manca ' + nonRegistrate.join(', ') : ''));
  } else {
    ok(!/faw-modale\.js/.test(html), pagina + ': nessuna finestra da gestire (niente modulo inutile)');
  }
});

console.log('\n[8] Il podio di fine partita è quello condiviso');
['games/patata/index.html', 'games/nomi-cose-citta/index.html', 'games/ruzzle/index.html',
  'games/pictionary/index.html', 'games/gameof15/index.html'].forEach((f) => {
  const html = leggi(f);
  ok(/podio\.css/.test(html) && /podio\.js/.test(html), f + ': usa podio.css + podio.js condivisi');
});

console.log('\n=================');
console.log('PASSATI: ' + passed + '  FALLITI: ' + failed);
process.exit(failed ? 1 : 0);
