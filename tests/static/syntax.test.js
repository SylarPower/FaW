/* Verifica statica: sintassi JS di tutte le pagine/giochi + regole condivise
   che non si possono misurare senza un browser (niente audio, pulsante HOME
   con spazio riservato, nessun flag "disponibile"). */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  \u2714', msg); }
  else { failed++; console.log('  \u2718', msg); }
}

const PAGINE = [
  'index.html',
  'games/ruzzle/index.html',
  'games/patata/index.html',
  'games/nomi-cose-citta/index.html',
  'games/pictionary/index.html',
  'games/gameof15/index.html',
  'games/neonwar/index.html',
  'games/palestra/index.html'
];
const JS = [
  'games/patata/js/game.js',
  'games/nomi-cose-citta/js/core.js',
  'games/nomi-cose-citta/js/backend.js',
  'games/nomi-cose-citta/js/ui.js',
  'games/palestra/app.js',
  'games/palestra/premium.js',
  'games/palestra/workout-metrics.js',
  'games/palestra/cargo-art.js',
  'games/shared/firebase-config.js'
];
const GIOCHI = [
  { dir: 'games/ruzzle', cssInHtml: true },
  { dir: 'games/patata', cssInHtml: false },
  { dir: 'games/nomi-cose-citta', cssInHtml: false },
  { dir: 'games/pictionary', cssInHtml: true },
  { dir: 'games/gameof15', cssInHtml: true },
  { dir: 'games/neonwar', cssInHtml: true },
  { dir: 'games/palestra', cssInHtml: false }
];

function inlineScripts(html) {
  const out = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}
function allCss(rel) {
  const dir = path.join(ROOT, path.dirname(rel));
  const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  let css = '';
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = re.exec(html)) !== null) css += m[1] + '\n';
  const links = html.match(/<link[^>]+href="([^"]+\.css)"/gi) || [];
  links.forEach((l) => {
    const href = l.match(/href="([^"]+)"/)[1];
    if (/^https?:/.test(href)) return;
    const f = path.join(dir, href);
    if (fs.existsSync(f)) css += fs.readFileSync(f, 'utf8') + '\n';
  });
  return css;
}
const leggi = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

console.log('\n[1] Sintassi JavaScript (tutte le pagine e gli script)');
PAGINE.forEach((rel) => {
  const html = leggi(rel);
  const blocchi = inlineScripts(html);
  let errore = null;
  blocchi.forEach((b, i) => {
    try { new vm.Script(b, { filename: rel + '#inline' + i }); }
    catch (e) { errore = (errore || '') + e.message + ' '; }
  });
  ok(!errore, rel + ' — ' + blocchi.length + ' script inline validi' + (errore ? ' → ' + errore : ''));
});
JS.forEach((rel) => {
  let errore = null;
  try { new vm.Script(leggi(rel), { filename: rel }); }
  catch (e) { errore = e.message; }
  ok(!errore, rel + ' valido' + (errore ? ' → ' + errore : ''));
});

console.log('\n[2] Nessun avviso sonoro in tutta la webapp');
const AUDIO_RE = /AudioContext|webkitAudioContext|createOscillator|new\s+Audio\s*\(|HTMLAudioElement|\.play\s*\(\s*\)|<audio\b/i;
[...PAGINE, ...JS].forEach((rel) => {
  const src = leggi(rel);
  const hit = src.match(AUDIO_RE);
  ok(!hit, rel + ' senza costrutti audio' + (hit ? ' → ' + hit[0] : ''));
});
/* La vibrazione non e' un suono, ma gli avvisi restano solo visivi:
   l'unica eccezione e' la palestra, app mobile dove l'haptic e' feedback
   tattile sul tocco (mai una notifica). */
[...PAGINE, ...JS].forEach((rel) => {
  if (rel.startsWith('games/palestra/')) return;
  ok(!/navigator\.vibrate/.test(leggi(rel)), rel + ' senza vibrazione di notifica');
});

console.log('\n[3] Pulsante HOME: presente e con spazio riservato');
GIOCHI.forEach(({ dir }) => {
  const rel = dir + '/index.html';
  const html = leggi(rel);
  ok(/class="[^"]*fixed-home-btn/.test(html), rel + ' ha il pulsante HOME condiviso');
  const css = allCss(rel);
  // Convenzione: il contenuto in alto a sinistra usa l'area di sicurezza
  // --faw-home-safe-x (padding-left) oppure --faw-home-safe-y (scostamento).
  const usaToken = /var\(--faw-home-safe-[xy]\)/.test(css);
  const definisceToken = /--faw-home-safe-x:\s*\d+px/.test(css);
  ok(usaToken, rel + ' usa l\u2019area di sicurezza del pulsante HOME');
  ok(definisceToken, rel + ' ha i token definiti (faw-ui.css o locali)');
  ok(/prefers-reduced-motion/.test(css), rel + ' rispetta prefers-reduced-motion');
});

console.log('\n[3b] Banner di stato fissi in cima: spazio riservato');
{
  const ui = leggi('games/shared/faw-ui.css');
  ok(/body\.faw-has-banner::before/.test(ui), 'faw-ui.css riserva lo spazio con uno spacer in flusso');
  ok(/--faw-banner-h/.test(ui), 'lo spacer usa --faw-banner-h');
  const layout = leggi('games/shared/faw-layout.js');
  ok(/MutationObserver/.test(layout) && /ResizeObserver/.test(layout),
    'faw-layout.js osserva comparsa e altezza del banner');
  /* I banner sono position:fixed e il CSSOM View impone offsetParent === null
     sui fixed: usarlo per la visibilita' disattiverebbe la riserva di spazio. */
  ok(!/offsetParent/.test(layout), 'faw-layout.js non usa offsetParent (null sui fixed)');
  ok(/getComputedStyle/.test(layout), 'faw-layout.js usa getComputedStyle per la visibilita\'');
  // i giochi con un banner fisso in cima devono caricare lo script
  ['games/ruzzle/index.html', 'games/pictionary/index.html', 'games/patata/index.html',
    'games/nomi-cose-citta/index.html'].forEach((rel) => {
    ok(/faw-layout\.js/.test(leggi(rel)), rel + ' carica faw-layout.js');
  });
  // e i banner non devono avere un padding-left hardcoded fuori token
  ['games/ruzzle/index.html', 'games/pictionary/index.html', 'games/patata/css/style.css',
    'games/nomi-cose-citta/css/style.css'].forEach((rel) => {
    const src = leggi(rel);
    ok(!/padding-left:\s*148px/.test(src), rel + ' nessuna misura hardcoded per il HOME');
  });
}

console.log('\n[4] Hub: niente Disponibili / Non disturbare');
{
  const hub = leggi('index.html');
  ok(!/btn-disponibilita/.test(hub), 'nessun pulsante disponibilita\'');
  ok(!/toggleDisponibilita|aggiornaUIDisponibilita/.test(hub), 'nessuna funzione disponibilita\'');
  ok(!/Non disturbare/i.test(hub), 'nessuna etichetta "Non disturbare"');
  ok(!/disponibile:\s*localStorage/.test(hub), 'nessun flag disponibilita\' nella presenza');
}

console.log('\n[5] Hub: lista partite con refresh manuale e cadenza 1 minuto');
{
  const hub = leggi('index.html');
  ok(/id="btn-refresh-partite"/.test(hub), 'pulsante di aggiornamento manuale');
  ok(/REFRESH_PARTITE_MS\s*=\s*60000/.test(hub), 'cadenza automatica di 60s');
  ok(!/setInterval\([^)]*,\s*5000\s*\)/.test(hub), 'nessun polling a 5 secondi');
  ok(/firmaListaPartite/.test(hub), 'render saltato quando i dati non cambiano');
}

console.log('\n[5b] Hub: inviti in tempo reale, rifiuto non distruttivo');
{
  const hub = leggi('index.html');
  ok(/avviaListenerInviti\(\);/.test(hub), 'listener dedicato agli inviti avviato al login');
  ok(/ascoltaInviti\('partite', 'partecipanti', 'attesa', 'partite'\)/.test(hub),
    'listener partite limitato a chi partecipa e a stato attesa');
  ok(/ascoltaInviti\('pictionary_rooms', 'players', 'lobby', 'pictionary'\)/.test(hub),
    'listener pictionary limitato alle room in lobby');
  ok(/ripiego sul listener senza filtro di stato/.test(hub),
    'ripiego se manca l\'indice composito');
  ok(/invitoRifiutatoDa: firebase\.firestore\.FieldValue\.arrayUnion/.test(hub),
    'il rifiuto di un invito ha un campo suo');
  ok(/partecipanti: firebase\.firestore\.FieldValue\.arrayRemove/.test(hub),
    'chi rifiuta esce dai partecipanti (la lobby non lo aspetta)');
  ok(!/rivincitaRifiutataDa: firebase\.firestore\.FieldValue\.arrayUnion/.test(hub),
    'l\'hub non scrive piu\' nel campo della rivincita');
  ok(/function chiudiInvito\(\)[\s\S]{0,400}aggiornaInviti\(\);/.test(hub),
    'la ✖ passa all\'invito successivo invece di nascondere tutto');
  ok(/id="invite-more"/.test(hub), 'riga "altri inviti in attesa" nel popup');
  ok(/function rinviaRefreshPartite/.test(hub),
    'anti-rimbalzo: il refresh viene rimandato, non scartato');
}

console.log('\n[6] Ruzzle: verifica parole automatica');
{
  const rz = leggi('games/ruzzle/index.html');
  ok(!/onclick=['"]avviaVerificaUnificata/.test(rz), 'nessun pulsante "VERIFICA PAROLE"');
  ok(/verificaAutoInviata/.test(rz), 'verifica avviata automaticamente (con guardia anti-loop)');
  ok((rz.match(/avviaVerificaUnificata\(\)\.catch/g) || []).length >= 2,
    'auto-verifica sia a fine tempo sia nello stato verifica');
}

console.log('\n[6b] Ruzzle: punteggi finali condivisi e allineati');
{
  const rz = leggi('games/ruzzle/index.html');
  ok(/function calcolaPunteggiFinali/.test(rz), 'una sola funzione di calcolo dei punteggi finali');
  ok(/function punteggiAllineati/.test(rz), 'mappa punteggi completa per la UI (nessun undefined)');
  ok(/function arbitroPunteggi/.test(rz), 'un solo client scrive la chiusura (arbitro designato)');
  ok(/function allineaPunteggiFinali/.test(rz), 'riconciliazione del documento a partita conclusa');
  ok((rz.match(/calcolaPunteggiFinali\(/g) || []).length >= 5,
    'calcolo condiviso usato in chiusura, eliminazione, dizionario, toggle e riconciliazione');
  ok(!/let nuoviPunteggi = \{\};[\s\S]{0,500}pFinal/.test(rz),
    'nessun calcolo in linea dei punteggi finali dentro il listener');
  ok(!/const totalScore = data\.punteggi\[player\]/.test(rz),
    'la classifica non legge punteggi parziali dal documento');
  ok(/partitaFinita/.test(rz), 'il live score non sovrascrive il risultato finale');
  ok((rz.match(/headerDiv\.style = "background:#2c3e50; color:#eef1fa/g) || []).length === 2,
    'testo chiaro sulla barra di analisi (lo sfondo è sempre scuro)');
  ok(/\.words-list li \.pts \{[\s\S]{0,220}color: var\(--primary-strong\)/.test(rz),
    'punti dell\'elenco parole leggibili anche nel tema chiaro');
  ok(/#podio \{[\s\S]{0,300}--podio-text: var\(--item-text\)/.test(rz),
    'il podio di Ruzzle usa i colori del tema');
}

console.log('\n[7] Patata Bollente: zero runTransaction (modello Ruzzle)');
{
  const patataSrc = leggi('games/patata/js/game.js');
  // Nessuna chiamata a runTransaction nel codice JS di Patata
  ok(!/\.runTransaction\s*\(/.test(patataSrc), 'games/patata/js/game.js non usa runTransaction');
}

console.log('\n[8] Nomi, Cose, Città: regole strutturali');
{
  const core = leggi('games/nomi-cose-citta/js/core.js');
  const be = leggi('games/nomi-cose-citta/js/backend.js');
  const ui = leggi('games/nomi-cose-citta/js/ui.js');
  const pagina = leggi('games/nomi-cose-citta/index.html');
  const tutto = core + be + ui;
  /* Si tolgono i commenti: le note parlano di runTransaction/BatchGetDocuments
     proprio per dire che NON vengono usati. */
  const senzaCommenti = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const codice = senzaCommenti(tutto);

  ok(!/\.runTransaction\s*\(/.test(codice), 'nessun runTransaction nel gioco');
  ok(!/BatchGetDocuments/.test(codice), 'nessuna chiamata esplicita a BatchGetDocuments');
  ok(/onSnapshot/.test(be), 'stato letto con onSnapshot');
  ok(/applyAtomic/.test(be) && /\.update\(/.test(be), 'scritture parziali con update()');
  ok(/ActionGate/.test(be) && /staggerMs/.test(be), 'ActionGate con referente e scaglionamento');
  ok(/STUCK_FALLBACK_MS/.test(core), 'STUCK_FALLBACK_MS condiviso');
  ok(/RATE_LIMIT_BACKOFF_MAX/.test(core) && /isRateLimitError/.test(core), 'backoff esponenziale sui 429');

  /* Unanimità obbligatoria: niente maggioranze */
  ok(/quorum\.every/.test(core), 'annullamento solo con voto di TUTTI i partecipanti');
  ok(!/flagThreshold|Math\.ceil\(\s*\(.*length\s*-\s*1\)\s*\/\s*2/.test(core), 'nessuna regola di maggioranza');

  /* Punteggi dichiarati */
  ['PUNTI_DUPLICATO = 5', 'PUNTI_DISTINTA = 10', 'PUNTI_SOLO_VALIDA = 20', 'PUNTI_ALLENAMENTO = 10']
    .forEach((k) => ok(core.indexOf(k) !== -1, 'costante punteggio: ' + k));

  /* Riservatezza: risposte in sottocollezione, listener separati */
  ok(/collection\('risposte'\)|collection\("risposte"\)|\.collection\('risposte'\)/.test(be) ||
     /ref\.collection\('risposte'\)/.test(be), 'risposte in una sottocollezione dedicata');
  ok(/apriMieRisposte/.test(be) && /apriRisposte/.test(be), 'listener proprio in compilazione, query solo in revisione');
  ok(/chiudiRisposte/.test(be), 'cleanup dei listener quando non servono');
  ok(/hasPendingWrites/.test(be), 'gestione di hasPendingWrites (persistence)');

  /* Identità e chiavi sicure */
  ok(/safeId/.test(core) && /docIdRisposta/.test(core), 'ID documento e chiavi sanificati');
  ok(/localStorage\.getItem\('mioNome'\)/.test(ui), 'identità FaW esistente (nessun login separato)');

  /* Home e risorse condivise */
  ok(/class="fixed-home-btn" href="\.\.\/\.\.\/index\.html"/.test(pagina), 'pulsante HOME verso ../../index.html');
  ok(/shared\/faw-ui\.css/.test(pagina) && /shared\/faw-layout\.js/.test(pagina), 'risorse condivise collegate');
  ok(/shared\/firebase-config\.js/.test(pagina), 'config Firebase condivisa');
  ok(/9\.1\.1\/firebase-firestore-compat/.test(pagina), 'SDK compat 9.1.1');
  ok(!AUDIO_RE.test(codice), 'nessun costrutto audio');
  ok(!/navigator\.vibrate/.test(codice), 'nessuna vibrazione');
}

console.log('\n[9] Podio di fine partita in tutti i giochi multiplayer');
{
  const giochiMultiplayer = [
    'games/ruzzle/index.html',
    'games/patata/index.html',
    'games/nomi-cose-citta/index.html',
    'games/gameof15/index.html',
    'games/pictionary/index.html'
  ];
  giochiMultiplayer.forEach((g) => {
    const src = leggi(g);
    ok(src.indexOf('../shared/podio.css') !== -1, g + ': collega il CSS del podio');
    ok(src.indexOf('../shared/podio.js') !== -1, g + ': carica il modulo del podio');
    ok(/id="podio"/.test(src), g + ': ha il contenitore #podio');
    ok(!/gradinoPodio|podiumOrder/.test(src), g + ': nessun calcolo locale di gradini o posizioni');
  });
  const podio = leggi('games/shared/podio.js');
  ok(/punti\(b\) - punti\(a\)/.test(podio), 'podio.js: ordine per punteggio decrescente');
  ok(/Math\.max\(PODIO_MIN, PODIO_MAX - i \* PODIO_STEP\)/.test(podio),
    'podio.js: gradino più alto al 1°, poi via via più basso');
  ok(!/slice\(0,\s*3\)/.test(podio), 'podio.js: nessun limite ai primi tre classificati');
  ok(/esc\(/.test(podio), 'podio.js: i nomi vengono escapati');
}

console.log('\n=================');
console.log('PASSATI: ' + passed + '  FALLITI: ' + failed);
process.exit(failed ? 1 : 0);
