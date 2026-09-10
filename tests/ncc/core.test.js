/* Test del core logico di "Nomi, Cose, Città" (senza DOM, senza Firebase).
   Copre: normalizzazione/override, dizionario mancante o non allineato,
   punteggi 0/5/10/20, duplicati dopo annullamento, voto dell'autore e
   unanimità, quorum invariato, timeout, finalizzazione idempotente,
   punteggio di allenamento. */
'use strict';
const path = require('path');
const fs = require('fs');
const C = require(path.join(__dirname, '../../games/nomi-cose-citta/js/core.js'));

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

/* ---------- dizionario di prova ---------- */
const TESTO_BASE = ['roma', 'ravenna', 'milano', 'matera', 'lucca', 'latina', 'torino',
  'cane', 'casa', 'cavallo', 'leone', 'lupo', 'rosa', 'rovere', 'pino',
  'medico', 'muratore', 'marco', 'maria', 'sara', 'anna'].join('\n');
function dict(overrides) { return C.costruisciDizionario(TESTO_BASE, overrides); }
const D = dict();

/* Le risposte dei test devono iniziare con la lettera del round, che dipende
   dal seed: le scegliamo dal dizionario di prova in base all'iniziale. */
const PER_INIZIALE = {};
TESTO_BASE.split('\n').forEach((w) => {
  const n = C.normalizeWord(w);
  const i = n.charAt(0);
  (PER_INIZIALE[i] = PER_INIZIALE[i] || []).push(n);
});
function parolePer(lettera, n) {
  const lista = PER_INIZIALE[String(lettera).toUpperCase()] || [];
  const out = [];
  for (let i = 0; i < (n || 1); i++) out.push(lista[i % Math.max(1, lista.length)] || 'ZZZZ');
  return out;
}

console.log('\n[1] normalizeWord (stessa normalizzazione di Ruzzle/Patata)');
eq(C.normalizeWord('  Città '), 'CITTA', 'accenti e spazi rimossi');
eq(C.normalizeWord("sant'Eufemia"), 'SANTEUFEMIA', 'apostrofo rimosso (input composto)');
eq(C.normalizeWord('Reggio Emilia'), 'REGGIOEMILIA', 'spazio rimosso (input composto)');
eq(C.normalizeWord(''), '', 'stringa vuota');
eq(C.normalizeWord(null), '', 'valore nullo');
eq(C.normalizeWord('  roma  '), C.normalizeWord('ROMA'), 'duplicati: stessa forma normalizzata');

console.log('\n[2] Dizionario: precedenza degli override (base → extra → excluded)');
{
  const d1 = dict({ extra: ['udine'] });
  ok(d1.parole.has('UDINE'), 'extra aggiunto');
  const d2 = dict({ excluded: ['roma'] });
  ok(!d2.parole.has('ROMA'), 'excluded rimosso');
  const d3 = dict({ extra: ['udine'], excluded: ['udine'] });
  ok(!d3.parole.has('UDINE'), 'l’esclusione vince sull’aggiunta');
  const d4 = dict({ extra: ['bo'] });
  ok(!d4.parole.has('BO'), 'extra più corto di MIN_WORD_LENGTH ignorato (come in Patata)');
  ok(d1.conteggio === D.conteggio + 1, 'conteggio aggiornato con gli extra');
  ok(d1.fingerprint !== D.fingerprint, 'fingerprint diverso con override diversi');
  eq(C.fingerprintDizionario({ conteggio: d1.conteggio, extra: d1.extra, excluded: d1.excluded }),
    d1.fingerprint, 'fingerprint ricalcolabile in modo indipendente');
  const d5 = dict({ extra: ['UDINE ', 'udine'] });
  eq(d5.fingerprint, d1.fingerprint, 'override normalizzati e deduplicati: stesso fingerprint');
}

console.log('\n[3] validazione: vuota / iniziale / dizionario');
eq(C.validaRisposta('Roma', 'R', D).ok, true, 'parola esistente con iniziale corretta → valida');
eq(C.validaRisposta('  ', 'R', D).motivo, 'VUOTA', 'risposta vuota');
eq(C.validaRisposta('', 'R', D).motivo, 'VUOTA', 'stringa vuota');
eq(C.validaRisposta('Milano', 'R', D).motivo, 'INIZIALE', 'iniziale errata');
eq(C.validaRisposta('Rutigliano', 'R', D).motivo, 'ASSENTE', 'parola assente dal dizionario');
eq(C.validaRisposta('Roma', 'R', null).motivo, 'DIZIONARIO_NON_PRONTO', 'dizionario non caricato');
eq(C.validaRisposta('roma', 'r', D).ok, true, 'maiuscole/minuscole ininfluenti');
eq(C.validaRisposta('Reggio Emilia', 'R', dict({ extra: ['reggioemilia'] })).ok, true,
  'risposta composta: valida solo se l’intera forma normalizzata è nel dizionario');
eq(C.validaRisposta('Reggio Emilia', 'R', D).motivo, 'ASSENTE',
  'risposta composta: ogni singola parola esistente NON basta');
ok(C.motivoTesto('ASSENTE', 'R').length > 0, 'motivo di invalidità leggibile');

console.log('\n[3b] Copertura reale del dizionario condiviso (limiti documentati)');
{
  const raw = fs.readFileSync(path.join(__dirname, '../../dizionario.txt'), 'utf8');
  const reale = C.costruisciDizionario(raw, {});
  console.log('   parole effettive:', reale.conteggio, '· fingerprint', reale.fingerprint);
  const singole = ['ROMA', 'MILANO', 'NAPOLI', 'TORINO', 'PALERMO', 'GENOVA', 'BOLOGNA',
    'FIRENZE', 'BARI', 'CATANIA', 'VENEZIA', 'VERONA', 'PADOVA', 'TRIESTE', 'BRESCIA',
    'TARANTO', 'MODENA', 'PERUGIA', 'RAVENNA', 'LIVORNO', 'CAGLIARI', 'FOGGIA', 'RIMINI',
    'SALERNO', 'FERRARA', 'SASSARI', 'LATINA', 'MONZA', 'SIRACUSA', 'PESCARA', 'BERGAMO',
    'TRENTO', 'VICENZA', 'TERNI', 'BOLZANO', 'NOVARA', 'PIACENZA', 'ANCONA', 'AREZZO',
    'UDINE', 'CESENA', 'LECCE', 'PESARO', 'BARLETTA'];
  const trovate = singole.filter((w) => reale.parole.has(w)).length;
  console.log('   città di una sola parola trovate:', trovate + '/' + singole.length);
  ok(trovate >= 40, 'copertura città singole >= 40/' + singole.length + ' (' + trovate + ')');

  const composte = ['SANGIOVANNI', 'REGGIOEMILIA', 'CITTADELMESSICO', 'SANMARINO', 'CASTELFRANCO'];
  const trovateComp = composte.filter((w) => reale.parole.has(w)).length;
  console.log('   risposte composte trovate:', trovateComp + '/' + composte.length,
    '→ limite noto: le forme composte non sono nel dizionario');
  ok(trovateComp === 0, 'nessuna risposta composta nel dizionario (limite dichiarato, nessuna eccezione silenziosa)');

  const nomi = ['MARCO', 'LUCA', 'ANNA', 'GIULIA', 'FRANCESCO', 'SOFIA', 'GIUSEPPE', 'CHIARA',
    'MATTEO', 'SARA', 'ANDREA', 'ELENA', 'PAOLO', 'LAURA'];
  const nomiOk = nomi.filter((w) => reale.parole.has(w)).length;
  console.log('   nomi propri trovati:', nomiOk + '/' + nomi.length);
  ok(nomiOk >= 12, 'copertura nomi propri >= 12/' + nomi.length + ' (' + nomiOk + ')');
  const corte = ['BO', 'LU', 'RE', 'UGO'];
  ok(corte.every((w) => !reale.parole.has(w)),
    'nessuna parola sotto MIN_WORD_LENGTH: le risposte di 2-3 lettere non sono validabili');
}

console.log('\n[4] Lettere: seed condiviso, niente ripetizioni, nessun sorteggio per client');
{
  const a = C.generaSequenzaLettere('SEEDX', null, 8);
  const b = C.generaSequenzaLettere('SEEDX', null, 8);
  eq(a, b, 'stesso seed → stessa sequenza su ogni client');
  ok(new Set(a).size === a.length, 'nessuna lettera ripetuta nel primo blocco');
  const c = C.generaSequenzaLettere('SEEDY', null, 8);
  ok(JSON.stringify(a) !== JSON.stringify(c), 'seed diverso → sequenza diversa');
  const pool = C.LETTERE_BASE;
  ok(a.every((l) => pool.indexOf(l) !== -1), 'lettere dall’insieme supportato');
  eq(C.letteraPerRound('SEEDX', null, 3), a[2], 'letteraPerRound coerente con la sequenza');
  const custom = C.generaSequenzaLettere('SEEDX', ['A', 'B', 'C'], 7);
  ok(custom.every((l) => ['A', 'B', 'C'].indexOf(l) !== -1), 'insieme di lettere configurabile');
  ok(new Set(custom.slice(0, 3)).size === 3, 'nessuna ripetizione finché il blocco non è esaurito');
}

console.log('\n[5] Categorie: id stabili separati dalle etichette');
{
  const preset = C.categoriePerPartita('classic');
  eq(preset.map((c) => c.id), ['nomi', 'cose', 'citta', 'animali', 'mestieri', 'piante'], 'preset classic');
  eq(C.categoriePerPartita('light').map((c) => c.id), ['nomi', 'cose', 'citta'], 'preset light');
  const custom = C.categoriePerPartita([{ id: 'Marchi Auto!', label: 'Marchi auto' }, { id: 'nomi', label: 'Nomi' }]);
  eq(custom.map((c) => c.id), ['MARCHIAUTO', 'nomi'], 'id personalizzati sanificati');
  eq(custom[0].label, 'Marchi auto', 'etichetta originale conservata');
  ok(!/[.\s]/.test(custom[0].id), 'nessun punto/spazio nell’id (sicuro nei dot-path)');
  eq(C.etichettaCategoria(custom, 'MARCHIAUTO'), 'Marchi auto', 'etichetta risolta dall’id');
  ok(C.categoriePerPartita(null).length === 6, 'default: 6 categorie classiche');
  eq(C.categoriePerPartita(['nomi', 'nomi']).length, 1, 'categorie duplicate eliminate');
}

console.log('\n[6] Chiavi stabili (dot-path e ID documento sicuri)');
{
  eq(C.cellKey(2, 1), 'c2_p1', 'chiave cella dagli indici');
  eq(C.docIdRisposta(3, 0), 'r3__p0', 'ID documento risposta con scope di round');
  ok(!/[.`/]/.test(C.docIdRisposta(3, 0)), 'ID documento senza caratteri problematici');
  eq(C.safeId('Mario Rossi!', 'X'), 'MARIOROSSI', 'safeId rimuove spazi e punteggiatura');
  eq(C.safeId('!!!', 'FALLBACK'), 'FALLBACK', 'safeId con fallback');
}

/* ---------- helper per round ---------- */
function mkRound(lettera, cats, players, extra) {
  return Object.assign({
    id: 'r1', round: 1, lettera,
    categorie: cats, partecipanti: players,
    fase: 'revisione', faseVersion: 1,
    inizio: 0, deadline: 0, stop: null,
    voti: {}, conferme: [], esitoId: null, dictVersion: null, annullateManuali: []
  }, extra || {});
}
function puntiPer(celle) {
  const out = {};
  celle.forEach((c) => { out[c.nome] = (out[c.nome] || 0) + c.punti; });
  return out;
}

console.log('\n[7] Punteggi 0/5/10/20 (variante classica)');
{
  const players = ['A', 'B', 'C'];
  const casi = [
    { nome: 'Roma, Roma, Ravenna → 5/5/10', ris: { A: 'Roma', B: 'roma', C: 'Ravenna' }, att: { A: 5, B: 5, C: 10 } },
    { nome: 'una valida e due invalide → 20/0/0', ris: { A: 'Roma', B: '', C: 'Zzzz' }, att: { A: 20, B: 0, C: 0 } },
    { nome: 'due valide distinte + vuota → 10/10/0', ris: { A: 'Roma', B: 'Ravenna', C: '' }, att: { A: 10, B: 10, C: 0 } },
    { nome: 'tre valide uguali → 5/5/5', ris: { A: 'Roma', B: 'Roma', C: 'ROMA' }, att: { A: 5, B: 5, C: 5 } },
    { nome: 'nessuna valida → 0/0/0', ris: { A: '', B: 'Zzzz', C: 'Milano' }, att: { A: 0, B: 0, C: 0 } }
  ];
  casi.forEach((caso) => {
    const rd = mkRound('R', ['citta'], players);
    const risposte = {};
    players.forEach((p) => { risposte[p] = { citta: { raw: caso.ris[p] } }; });
    const es = C.calcolaEsitoRound({ roundData: rd, risposte, dizionario: D });
    eq(puntiPer(es.celle), caso.att, caso.nome);
  });

  // 20 ha precedenza sul 10
  const rd1 = mkRound('R', ['citta'], ['A', 'B']);
  const es1 = C.calcolaEsitoRound({
    roundData: rd1,
    risposte: { A: { citta: { raw: 'Roma' } }, B: { citta: { raw: '' } } },
    dizionario: D
  });
  eq(puntiPer(es1.celle), { A: 20, B: 0 }, 'unica valida della categoria → 20 (non 10)');

  // i punti non si sommano
  ok([0, 5, 10, 20].indexOf(es1.celle[0].punti) !== -1, 'una risposta vale 0, 5, 10 oppure 20');

  // stessa parola in categorie diverse: vietata? no
  const rd2 = mkRound('R', ['citta', 'cose'], ['A', 'B']);
  const es2 = C.calcolaEsitoRound({
    roundData: rd2,
    risposte: {
      A: { citta: { raw: 'Roma' }, cose: { raw: 'Rosa' } },
      B: { citta: { raw: 'Ravenna' }, cose: { raw: 'Rosa' } }
    },
    dizionario: D
  });
  eq(puntiPer(es2.celle), { A: 15, B: 15 }, 'stessa parola in categorie diverse ammessa (10 + 5)');
}

console.log('\n[8] Contestazioni: unanimità con autore incluso');
{
  const players = ['A', 'B', 'C'];
  const rd = mkRound('R', ['citta'], players, { voti: { c0_p0: ['A', 'B', 'C'] } });
  const risposte = {
    A: { citta: { raw: 'Roma' } }, B: { citta: { raw: 'Roma' } }, C: { citta: { raw: 'Ravenna' } }
  };
  const es = C.calcolaEsitoRound({ roundData: rd, risposte, dizionario: D });
  const cellaA = es.celle[0];
  eq(cellaA.annullata, true, 'unanimità (autore incluso) → risposta annullata');
  eq(puntiPer(es.celle), { A: 0, B: 10, C: 10 },
    'annullata una delle due "Roma": restano due valide distinte → 10 ciascuna');

  // duplicato rimasto SOLO → 20
  const rdSolo = mkRound('R', ['citta'], players, { voti: { c0_p0: ['A', 'B', 'C'] } });
  const esSolo = C.calcolaEsitoRound({
    roundData: rdSolo,
    risposte: { A: { citta: { raw: 'Roma' } }, B: { citta: { raw: 'roma' } }, C: { citta: { raw: 'Zzzz' } } },
    dizionario: D
  });
  eq(puntiPer(esSolo.celle), { A: 0, B: 20, C: 0 },
    'dopo l’annullamento il duplicato rimasto solo diventa 20');

  // senza il voto dell'autore NON è annullata
  const rd2 = mkRound('R', ['citta'], players, { voti: { c0_p0: ['B', 'C'] } });
  const es2 = C.calcolaEsitoRound({ roundData: rd2, risposte, dizionario: D });
  eq(es2.celle[0].annullata, false, 'senza il voto dell’autore la risposta resta valida');
  eq(puntiPer(es2.celle), { A: 5, B: 5, C: 10 }, 'punteggi invariati senza unanimità');

  // assenza di voto NON è consenso
  const rd3 = mkRound('R', ['citta'], players, { voti: {} });
  const es3 = C.calcolaEsitoRound({ roundData: rd3, risposte, dizionario: D });
  eq(es3.celle[0].annullata, false, 'nessun voto → risposta valida');
  eq(C.rispostaAnnullata([], players), false, 'quorum non raggiunto con zero voti');
  eq(C.rispostaAnnullata(['A', 'B', 'C'], players), true, 'quorum raggiunto con tutti i voti');

  // maggioranza semplice NON basta (3 giocatori, 2 voti)
  eq(C.rispostaAnnullata(['A', 'B'], players), false, 'la maggioranza non annulla');

  // ricalcolo dell'intera categoria dopo annullamento: 5 → 10
  const rd4 = mkRound('R', ['citta'], ['A', 'B', 'C', 'D'], { voti: { c0_p1: ['A', 'B', 'C', 'D'] } });
  const risp4 = {
    A: { citta: { raw: 'Roma' } }, B: { citta: { raw: 'Roma' } },
    C: { citta: { raw: 'Ravenna' } }, D: { citta: { raw: 'Ravenna' } }
  };
  const es4 = C.calcolaEsitoRound({ roundData: rd4, risposte: risp4, dizionario: D });
  eq(puntiPer(es4.celle), { A: 10, B: 0, C: 5, D: 5 },
    'annullando una delle due "Roma" la superstite passa da 5 a 10');
}

console.log('\n[8b] Voto "Valida": stessa regola (unanimità) dell\'annullamento');
{
  const players = ['A', 'B', 'C'];
  const risposte = {
    A: { citta: { raw: 'Roma' } },
    B: { citta: { raw: 'Ravenna' } },
    C: { citta: { raw: 'Roccasicura' } }   // parola reale, assente dal dizionario di prova
  };

  // tutti votano "valida" → la parola è recuperata
  const rd = mkRound('R', ['citta'], players, { votiValida: { c0_p2: ['A', 'B', 'C'] } });
  const es = C.calcolaEsitoRound({ roundData: rd, risposte, dizionario: D });
  eq(es.celle[2].validata, true, 'unanimità "valida" (autore incluso) → parola recuperata');
  eq(es.celle[2].valida, true, 'la parola votata conta come valida');
  eq(es.celle[2].motivo, null, 'nessun motivo di invalidità dopo il voto');
  eq(es.celle[2].motivoAutomatico, 'ASSENTE', 'il responso del dizionario resta registrato a parte');
  eq(puntiPer(es.celle), { A: 10, B: 10, C: 10 }, 'tre valide distinte → 10 ciascuna');

  // la maggioranza NON basta (stessa regola dell'annullamento)
  const rd2 = mkRound('R', ['citta'], players, { votiValida: { c0_p2: ['A', 'B'] } });
  const es2 = C.calcolaEsitoRound({ roundData: rd2, risposte, dizionario: D });
  eq(es2.celle[2].validata, false, 'senza il voto di tutti la parola resta non valida');
  eq(puntiPer(es2.celle), { A: 10, B: 10, C: 0 }, 'punteggi invariati senza unanimità');
  eq(C.rispostaValidata(['A', 'B'], players), false, 'quorum "valida" non raggiunto con 2 voti su 3');
  eq(C.rispostaValidata(['A', 'B', 'C'], players), true, 'quorum "valida" raggiunto con tutti i voti');

  // una risposta vuota non è recuperabile
  const rd3 = mkRound('R', ['citta'], players, { votiValida: { c0_p2: ['A', 'B', 'C'] } });
  const es3 = C.calcolaEsitoRound({
    roundData: rd3,
    risposte: { A: { citta: { raw: 'Roma' } }, B: { citta: { raw: 'Ravenna' } }, C: { citta: { raw: '' } } },
    dizionario: D
  });
  eq(es3.celle[2].validata, false, 'il voto non può rendere valida una risposta vuota');

  // l'annullamento unanime ha la precedenza
  const rd4 = mkRound('R', ['citta'], players, {
    voti: { c0_p0: ['A', 'B', 'C'] }, votiValida: { c0_p0: ['A', 'B', 'C'] }
  });
  const es4 = C.calcolaEsitoRound({ roundData: rd4, risposte, dizionario: D });
  eq(es4.celle[0].annullata, true, 'con entrambi i voti unanimi vince l’annullamento');
  eq(es4.celle[0].validata, false, 'nessuna doppia marca sulla stessa cella');

  // mutatore: mappa separata, ritiro del voto opposto, conferma revocata
  const st = {
    stato: 'in_corso', round: 1, partecipanti: players.slice(),
    opzioni: C.normOpzioni({ round: '1', categorie: 'light', seed: 'S', lettere: ['R'] }),
    punteggi: C.mapZero(players), risultati: [],
    roundData: mkRound('R', ['citta'], players, { votiValida: {}, conferme: ['A'] })
  };
  const up = C.mutVotaValida(st, { me: 'A', now: 1, key: 'c0_p2', vota: true });
  eq(up['roundData.votiValida.c0_p2'], { __op: 'union', items: ['A'] }, 'voto "valida" nella mappa dedicata');
  eq(up['roundData.conferme'], { __op: 'remove', items: ['A'] }, 'cambiare voto revoca la conferma');
  C.applyPartial(st, up);
  eq(st.roundData.votiValida.c0_p2, ['A'], 'voto registrato in votiValida');
  eq(st.roundData.voti.c0_p2 || [], [], 'la mappa dei voti di annullamento resta vuota');
  const up2 = C.mutVota(st, { me: 'A', now: 2, key: 'c0_p2', vota: true });
  eq(up2['roundData.votiValida.c0_p2'], { __op: 'remove', items: ['A'] },
    'votando "non valida" si ritira il voto "valida"');
  C.applyPartial(st, up2);
  eq(st.roundData.votiValida.c0_p2, [], 'un solo voto per giocatore e per cella');
  eq(C.mutVotaValida(st, { me: 'A', now: 3, key: 'c0_p2', vota: false }), null,
    'ritiro di un voto "valida" inesistente: nessuna scrittura');
  const stChiuso = Object.assign({}, st, { roundData: Object.assign({}, st.roundData, { fase: 'risultati' }) });
  eq(C.mutVotaValida(stChiuso, { me: 'A', now: 4, key: 'c0_p2', vota: true }).__error.code, 'REVISIONE_CHIUSA',
    'voto "valida" a revisione chiusa: rifiutato');
  eq(C.mutVotaValida(st, { me: 'Z', now: 5, key: 'c0_p2', vota: true }).__error.code, 'NON_PARTECIPANTE',
    'chi non è nel round non può votare "valida"');
}

console.log('\n[9] Quorum fissato a inizio round');
{
  const quorum = ['A', 'B', 'C'];
  const disconnesso = ['A', 'B', 'C'];    // il quorum NON si riduce
  eq(C.rispostaAnnullata(['A', 'B'], disconnesso), false, 'la disconnessione non riduce il quorum');
  const nuovoIngresso = ['A', 'B', 'C'];  // un nuovo ingresso non lo aumenta
  eq(C.rispostaAnnullata(['A', 'B', 'C'], nuovoIngresso), true, 'unanimità del quorum originario');
  const rd = mkRound('R', ['citta'], quorum, { voti: { c0_p0: ['A', 'B', 'C'] } });
  const es = C.calcolaEsitoRound({
    roundData: rd,
    risposte: { A: { citta: { raw: 'Roma' } }, B: { citta: { raw: 'Ravenna' } }, C: { citta: { raw: 'Lucca' } } },
    dizionario: D
  });
  eq(es.celle[0].annullata, true, 'rientro: lo stato dei voti è quello congelato nel round');
  eq(C.rispostaAnnullata(['A', 'B'], []), false, 'quorum vuoto → nessun annullamento');
}

console.log('\n[10] Macchina a stati: fasi, STOP, timeout, avanzamento');
{
  const st = C.normState({
    partecipanti: ['A', 'B'],
    opzioni: { round: '2', tempo: '120', revisione: '90', categorie: 'classic', seed: 'TEST', lettere: ['R', 'M', 'C'] },
    stato: 'attesa', pronti: []
  });
  eq(st.opzioni.round, 2, 'opzioni normalizzate (round)');
  eq(st.opzioni.tempo, 120, 'opzioni normalizzate (tempo)');
  eq(st.opzioni.revisione, 90, 'opzioni normalizzate (revisione)');
  eq(st.opzioni.categorie.length, 6, 'categorie del preset');

  let now = 1_000_000;
  const ctx = (me, extra) => Object.assign({ me, now, dizionarioPronto: true, dizionario: D, dictVersion: D.fingerprint }, extra || {});
  eq(C.mutStart(st, ctx('A')), null, 'start rifiutato: non tutti pronti');
  st.pronti = ['A', 'B'];
  const up = C.mutStart(st, ctx('A'));
  C.applyPartial(st, up);
  eq(st.stato, 'in_corso', 'start → in_corso');
  eq(st.roundData.fase, 'compilazione', 'fase compilazione');
  eq(st.roundData.lettera, C.letteraPerRound('TEST', st.opzioni.lettere, 1), 'lettera derivata dal seed');
  eq(st.roundData.partecipanti, ['A', 'B'], 'partecipanti fissati a inizio round');
  eq(st.roundData.categorie, st.opzioni.categorie.map((c) => c.id), 'categorie fissate a inizio round');
  eq(st.roundData.deadline, now + 120000, 'deadline condivisa della compilazione');
  eq(st.roundData.dictVersion, D.fingerprint, 'fingerprint del dizionario scritto nel round');
  eq(C.mutStart(st, ctx('A')), null, 'start non ripetibile');
  eq(C.mutStart(st, ctx('A', { dizionarioPronto: false })), null, 'nessun secondo start');

  // STOP del primo arrivato vince, gli altri abortiscono
  now += 5000;
  const stop1 = C.mutStop(st, ctx('A'));
  C.applyPartial(st, stop1);
  eq(st.roundData.fase, 'revisione', 'STOP → revisione');
  eq(st.roundData.stop, { da: 'A', ts: now }, 'STOP attribuito');
  eq(st.roundData.deadline, now + 90000, 'deadline condivisa della revisione');
  eq(C.mutStop(st, ctx('B')), null, 'secondo STOP abortito (transizione idempotente)');
  eq(C.mutTimeoutCompilazione(st, ctx('B', { now: now + 200000 })), null, 'timeout dopo lo STOP: niente doppia transizione');

  // voti e conferma
  const key = C.cellKey(0, 0);
  const voto = C.mutVota(st, ctx('A', { key, vota: true }));
  C.applyPartial(st, voto);
  eq(st.roundData.voti[key], ['A'], 'voto registrato');
  C.applyPartial(st, C.mutConfermaRevisione(st, ctx('A')));
  eq(st.roundData.conferme, ['A'], 'conferma registrata');
  const cambia = C.mutVota(st, ctx('A', { key, vota: false }));
  C.applyPartial(st, cambia);
  eq(st.roundData.voti[key], [], 'voto ritirato');
  eq(st.roundData.conferme, [], 'cambiare voto revoca la propria conferma');
  eq(C.mutVota(st, ctx('A', { key, vota: false })), null, 'ritiro di un voto inesistente: abortito');
  eq(C.mutVota(st, ctx('A', { key: key, vota: true })).constructor, Object, 'nuovo voto accettato');

  // chiusura revisione: serve la conferma di tutti
  eq(C.mutChiudiRevisione(st, ctx('A', { risposte: {}, rispostePronte: true })), null,
    'chiusura rifiutata: manca una conferma');
  C.applyPartial(st, C.mutConfermaRevisione(st, ctx('B')));
  C.applyPartial(st, C.mutConfermaRevisione(st, ctx('A')));   // dopo il ritiro si può riconfermare
  eq(st.roundData.conferme.length, 2, 'conferme di entrambi i partecipanti');
  eq(C.mutChiudiRevisione(st, ctx('A', { risposte: {}, rispostePronte: false })).__error.code,
    'RISPOSTE_NON_PRONTE', 'chiusura rifiutata: risposte non ancora caricate');
  const L1 = st.roundData.lettera;
  const [w1a, w1b] = parolePer(L1, 2);
  const risposte = { A: { nomi: { raw: w1a } }, B: { nomi: { raw: w1b } } };
  const chiudi = C.mutChiudiRevisione(st, ctx('A', { risposte, rispostePronte: true }));
  ok(!!chiudi && !chiudi.__error, 'chiusura con tutte le conferme');
  C.applyPartial(st, chiudi);
  eq(st.roundData.fase, 'risultati', 'fase risultati');
  eq(st.roundData.esitoId, 'r1', 'esito congelato');
  eq(st.risultati.length, 1, 'risultato del round scritto una volta');
  eq(st.punteggi, { A: 10, B: 10 }, 'punti derivati dal risultato congelato');

  // finalizzazione ripetuta: nessun doppio punteggio
  eq(C.mutChiudiRevisione(st, ctx('B', { risposte, rispostePronte: true })), null, 'seconda finalizzazione abortita');
  eq(st.risultati.length, 1, 'nessun risultato duplicato');
  eq(st.punteggi, { A: 10, B: 10 }, 'punteggi invariati dopo il secondo tentativo');

  // anche un arrayUnion ripetuto non duplica (stesso oggetto)
  const prima = JSON.parse(JSON.stringify(st.risultati));
  C.applyPartial(st, { risultati: { __op: 'union', items: [st.risultati[0]] } });
  eq(st.risultati, prima, 'arrayUnion deduplica lo stesso risultato');
  eq(C.punteggiDaRisultati([st.risultati[0], st.risultati[0]], ['A', 'B']), { A: 10, B: 10 },
    'totali contati una volta sola per round (id univoco)');

  // avanzamento al round successivo
  eq(C.mutProssimoRound(st, ctx('A')), null, 'avanzamento prima della scadenza del recap: rifiutato');
  const dopo = st.roundData.deadline + 1;
  const av = C.mutProssimoRound(st, ctx('A', { now: dopo, dictVersion: D.fingerprint }));
  C.applyPartial(st, av);
  eq(st.round, 2, 'round 2');
  eq(st.roundData.fase, 'compilazione', 'nuova compilazione');
  eq(st.roundData.voti, {}, 'voti del round precedente azzerati');
  eq(st.roundData.conferme, [], 'conferme azzerate');
  eq(st.roundData.esitoId, null, 'esito azzerato');
  eq(st.risultati.length, 1, 'i risultati restano');
  ok(st.roundData.lettera !== undefined && st.roundData.lettera.length === 1, 'nuova lettera');

  // fine partita: round 2 completo
  const L2 = st.roundData.lettera;
  const [w2a, w2b] = parolePer(L2, 2);
  const risposte2 = { A: { nomi: { raw: w2a } }, B: { nomi: { raw: w2b } } };
  C.applyPartial(st, C.mutStop(st, ctx('B', { now: dopo + 1000 })));
  C.applyPartial(st, C.mutConfermaRevisione(st, ctx('A', { now: dopo + 2000 })));
  C.applyPartial(st, C.mutConfermaRevisione(st, ctx('B', { now: dopo + 2000 })));
  const ch2 = C.mutChiudiRevisione(st, ctx('A', { now: dopo + 3000, risposte: risposte2, rispostePronte: true }));
  ok(!!ch2 && !ch2.__error, 'round 2: revisione chiusa');
  C.applyPartial(st, ch2);
  eq(st.risultati.length, 2, 'due risultati, uno per round');
  eq(C.punteggiDaRisultati(st.risultati, st.partecipanti), st.punteggi, 'punteggi = somma dei due round');
  const fine = C.mutProssimoRound(st, ctx('A', { now: st.roundData.deadline + 1, risposte: risposte2, rispostePronte: true }));
  ok(!!fine, 'avanzamento dopo l’ultimo round produce una transizione');
  C.applyPartial(st, fine);
  eq(st.stato, 'conclusa', 'partita conclusa dopo l’ultimo round');
  eq(st.punteggi, C.punteggiDaRisultati(st.risultati, st.partecipanti), 'totali = somma dei round');
}

console.log('\n[11] Timeout della revisione: contestazione non unanime lascia valida');
{
  const now = 1_000_000;
  const st = C.normState({
    partecipanti: ['A', 'B', 'C'],
    opzioni: { round: '1', tempo: '60', revisione: '30', categorie: 'light', seed: 'TO', lettere: ['R'] },
    stato: 'attesa', pronti: ['A', 'B', 'C']
  });
  C.applyPartial(st, C.mutStart(st, { me: 'A', now, dizionarioPronto: true, dizionario: D, dictVersion: D.fingerprint }));
  C.applyPartial(st, C.mutStop(st, { me: 'B', now: now + 1000 }));
  const key = C.cellKey(0, 0);
  C.applyPartial(st, C.mutVota(st, { me: 'B', now: now + 2000, key, vota: true }));
  C.applyPartial(st, C.mutVota(st, { me: 'C', now: now + 2000, key, vota: true }));
  eq(st.roundData.lettera, 'R', 'lettera del round dal seed');
  const risposte = { A: { citta: { raw: 'Roma' } }, B: { citta: { raw: 'Roma' } }, C: { citta: { raw: 'Ravenna' } } };
  const scaduto = st.roundData.deadline + C.TIMEOUT_GRACE + 1;
  const up = C.mutChiudiRevisione(st, { me: 'C', now: scaduto, risposte, rispostePronte: true, dizionario: D, dizionarioPronto: true });
  ok(!!up && !up.__error, 'chiusura alla scadenza senza conferme');
  C.applyPartial(st, up);
  const cella = st.risultati[0].celle[0];
  eq(cella.annullata, false, 'contestazione non unanime alla scadenza → risposta valida');
  eq(st.punteggi.A, 5, 'punti assegnati sulla risposta rimasta valida');
}

console.log('\n[12] Scritture riferite a round/fasi superate');
{
  const st = C.normState({
    partecipanti: ['A', 'B'], opzioni: { round: '2', tempo: '60', revisione: '30', seed: 'X' },
    stato: 'in_corso', round: 2,
    roundData: { id: 'r2', round: 2, lettera: 'M', categorie: ['nomi'], partecipanti: ['A', 'B'], fase: 'risultati', esitoId: 'r2' }
  });
  eq(C.mutStop(st, { me: 'A', now: 1 }), null, 'STOP in fase risultati: rifiutato');
  eq(C.mutVota(st, { me: 'A', now: 1, key: 'c0_p0', vota: true }).__error.code, 'REVISIONE_CHIUSA', 'voto a revisione chiusa: rifiutato');
  eq(C.mutConfermaRevisione(st, { me: 'A', now: 1 }).__error.code, 'REVISIONE_CHIUSA', 'conferma a revisione chiusa: rifiutata');
  eq(C.mutChiudiRevisione(st, { me: 'A', now: 1, risposte: {}, rispostePronte: true }), null, 'chiusura con esito già congelato: rifiutata');
  const fuori = C.normState({ partecipanti: ['A', 'B'], opzioni: {}, stato: 'in_corso', round: 1, roundData: { id: 'r1', round: 1, lettera: 'M', categorie: ['nomi'], partecipanti: ['A'], fase: 'revisione' } });
  eq(C.mutVota(fuori, { me: 'B', now: 1, key: 'c0_p0', vota: true }).__error.code, 'NON_PARTECIPANTE', 'chi non è nel round non può votare');
}

console.log('\n[13] Allenamento solo: 10 punti per risposta valida, mai 20 automatici');
{
  const now = 5_000_000;
  const st = C.normState({
    partecipanti: ['TU'],
    opzioni: { round: '2', tempo: '60', revisione: '30', categorie: 'classic', seed: 'SOLO', lettere: ['R', 'M', 'C'] },
    stato: 'attesa', pronti: ['TU']
  });
  C.applyPartial(st, C.mutStart(st, { me: 'TU', now, dizionarioPronto: true, dizionario: D, dictVersion: D.fingerprint }));
  const LS = st.roundData.lettera;
  const [s1, s2, s3, s4, s5, s6] = parolePer(LS, 6);
  const risposte = {
    TU: {
      nomi: { raw: s1 }, cose: { raw: s2 }, citta: { raw: s3 },
      animali: { raw: s4 }, mestieri: { raw: s5 }, piante: { raw: s6 }
    }
  };
  const ctx = { me: 'TU', now: now + 1000, risposte, rispostePronte: true, dizionario: D, dizionarioPronto: true };
  const up = C.mutConsegnaSolo(st, ctx);
  C.applyPartial(st, up);
  eq(st.roundData.fase, 'risultati', 'consegna → risultati (nessuna revisione in solo)');
  eq(st.punteggi.TU, 60, '6 risposte valide × 10 punti');
  ok(st.risultati[0].celle.every((c) => c.punti === 10), 'nessuna risposta da 20 in allenamento');
  eq(st.risultati[0].allenamento, true, 'risultato marcato come allenamento');

  // risposta invalida → 0
  const st2 = C.normState({ partecipanti: ['TU'], opzioni: { round: '1', categorie: 'light', seed: 'S2', lettere: ['R', 'M', 'C'] }, stato: 'attesa', pronti: ['TU'] });
  C.applyPartial(st2, C.mutStart(st2, { me: 'TU', now, dizionarioPronto: true, dizionario: D, dictVersion: D.fingerprint }));
  const lettera = st2.roundData.lettera;
  const risp2 = { TU: { nomi: { raw: lettera + 'zzzz' }, citta: { raw: '' } } };
  C.applyPartial(st2, C.mutConsegnaSolo(st2, { me: 'TU', now: now + 10, risposte: risp2, rispostePronte: true, dizionario: D, dizionarioPronto: true }));
  eq(st2.punteggi.TU, 0, 'risposte invalide → 0 punti');

  // annullamento MANUALE, distinto dalla validazione automatica
  const key = C.cellKey(0, 0);
  const st3 = C.normState({ partecipanti: ['TU'], opzioni: { round: '1', categorie: 'light', seed: 'SOLO', lettere: ['R', 'M', 'C'] }, stato: 'attesa', pronti: ['TU'] });
  C.applyPartial(st3, C.mutStart(st3, { me: 'TU', now, dizionarioPronto: true, dizionario: D, dictVersion: D.fingerprint }));
  const L3 = st3.roundData.lettera;
  const [q1, q2, q3] = parolePer(L3, 3);
  const risp3 = { TU: { nomi: { raw: q1 }, cose: { raw: q2 }, citta: { raw: q3 } } };
  C.applyPartial(st3, C.mutConsegnaSolo(st3, { me: 'TU', now: now + 10, risposte: risp3, rispostePronte: true, dizionario: D, dizionarioPronto: true }));
  eq(st3.punteggi.TU, 30, 'tre risposte valide → 30');
  const kNomi = st3.risultati[0].celle.filter((c) => c.cat === 'nomi')[0].k;
  ok(!!kNomi, 'chiave della cella "nomi"');
  C.applyPartial(st3, C.mutAnnullaManualeSolo(st3, { me: 'TU', now: now + 20, key: kNomi, annulla: true, risposte: risp3, dizionario: D, dizionarioPronto: true }));
  eq(st3.punteggi.TU, 20, 'annullamento manuale → 20');
  const cellaManuale = st3.risultati[0].celle.filter((c) => c.k === kNomi)[0];
  eq(cellaManuale.annullataManuale, true, 'cella marcata come annullata manualmente');
  eq(cellaManuale.motivoAutomatico, null, 'la validità automatica resta distinguibile');
  eq(cellaManuale.motivo, 'ANNULLATA_MANUALE', 'motivo esplicito e distinto');
  eq(cellaManuale.annullata, false, 'non è un annullamento per votazione');
  C.applyPartial(st3, C.mutAnnullaManualeSolo(st3, { me: 'TU', now: now + 30, key: kNomi, annulla: false, risposte: risp3, dizionario: D, dizionarioPronto: true }));
  eq(st3.punteggi.TU, 30, 'ripristino dell’annullamento manuale');

  // validazione MANUALE: l'equivalente "solo" del voto "Valida"
  const st4 = C.normState({ partecipanti: ['TU'], opzioni: { round: '1', categorie: 'light', seed: 'SOLO', lettere: ['R', 'M', 'C'] }, stato: 'attesa', pronti: ['TU'] });
  C.applyPartial(st4, C.mutStart(st4, { me: 'TU', now, dizionarioPronto: true, dizionario: D, dictVersion: D.fingerprint }));
  const L4 = st4.roundData.lettera;
  const [w1, w2] = parolePer(L4, 2);
  const risp4 = { TU: { nomi: { raw: w1 }, cose: { raw: w2 }, citta: { raw: L4 + 'zzzz' } } };
  C.applyPartial(st4, C.mutConsegnaSolo(st4, { me: 'TU', now: now + 10, risposte: risp4, rispostePronte: true, dizionario: D, dizionarioPronto: true }));
  eq(st4.punteggi.TU, 20, 'due valide + una assente dal dizionario → 20');
  const kCitta = st4.risultati[0].celle.filter((c) => c.cat === 'citta')[0].k;
  C.applyPartial(st4, C.mutValidaManualeSolo(st4, { me: 'TU', now: now + 20, key: kCitta, valida: true, risposte: risp4, dizionario: D, dizionarioPronto: true }));
  eq(st4.punteggi.TU, 30, 'validazione manuale → la parola conta come valida');
  const cellaValidata = st4.risultati[0].celle.filter((c) => c.k === kCitta)[0];
  eq(cellaValidata.validataManuale, true, 'cella marcata come validata manualmente');
  eq(cellaValidata.validata, true, 'marca di validazione collettiva/manuale');
  eq(cellaValidata.valida, true, 'risposta valida dopo la validazione manuale');
  eq(cellaValidata.motivoAutomatico, 'ASSENTE', 'il responso del dizionario resta registrato');
  // le due azioni manuali si escludono
  C.applyPartial(st4, C.mutAnnullaManualeSolo(st4, { me: 'TU', now: now + 30, key: kCitta, annulla: true, risposte: risp4, dizionario: D, dizionarioPronto: true }));
  const cellaDopo = st4.risultati[0].celle.filter((c) => c.k === kCitta)[0];
  eq(cellaDopo.validataManuale, false, 'annullando si toglie la validazione manuale');
  eq(cellaDopo.annullataManuale, true, 'annullamento manuale attivo');
  eq(st4.punteggi.TU, 20, 'punti ricalcolati dopo il cambio di scelta');
}

console.log('\n[14] Classifica con pari merito');
{
  const c = C.classifica({ A: 30, B: 30, C: 10, D: 0 }, ['A', 'B', 'C', 'D']);
  eq(c.map((r) => r.posizione), [1, 1, 3, 4], 'pari merito: 1,1,3,4');
  eq(c[0].punti, 30, 'ordinamento per punti');
  const v = C.vincitore({ A: 30, B: 30, C: 10 }, ['A', 'B', 'C']);
  eq(v.length, 2, 'due vincitori a pari merito');
  eq(C.classifica({}, []).length, 0, 'nessun partecipante → classifica vuota');
}

console.log('\n[15] Totali deterministici e non ripetibili');
{
  const r1 = { id: 'r1', round: 1, lettera: 'M', celle: [], punti: { A: 10, B: 5 } };
  const r2 = { id: 'r2', round: 2, lettera: 'S', celle: [], punti: { A: 5, B: 20 } };
  eq(C.punteggiDaRisultati([r1, r2], ['A', 'B']), { A: 15, B: 25 }, 'somma dei round');
  eq(C.punteggiDaRisultati([r1, r2, r1, r2], ['A', 'B']), { A: 15, B: 25 }, 'round duplicati contati una volta');
  eq(C.punteggiDaRisultati([], ['A', 'B']), { A: 0, B: 0 }, 'nessun round → zero');
}

console.log('\n[16] Update a punteggiato: union / remove / delete');
{
  const o = { roundData: { voti: { c0_p0: ['A'] }, conferme: ['A'] } };
  C.applyPartial(o, {
    'roundData.voti.c0_p0': { __op: 'union', items: ['B'] },
    'roundData.conferme': { __op: 'remove', items: ['A'] }
  });
  eq(o.roundData.voti.c0_p0, ['A', 'B'], 'arrayUnion');
  eq(o.roundData.conferme, [], 'arrayRemove');
  C.applyPartial(o, { 'roundData.voti.c0_p1': { __op: 'delete' } });
  ok(!('c0_p1' in o.roundData.voti), 'delete');
  const FV = {
    arrayUnion: (...i) => ({ __u: i }),
    arrayRemove: (...i) => ({ __r: i }),
    delete: () => ({ __d: true })
  };
  const up = C.toFirestoreUpdate({ a: { __op: 'union', items: [1] }, b: { __op: 'remove', items: [2] }, c: { __op: 'delete' }, d: 5 }, { FieldValue: FV });
  ok(!!up.a.__u && !!up.b.__r && !!up.c.__d && up.d === 5, 'traduzione in FieldValue');
  ok(C.docExists({ exists: true }), 'docExists (compat: proprietà)');
  ok(C.docExists({ exists: () => true }), 'docExists (modulare: metodo)');
  ok(C.isRateLimitError(Object.assign(new Error('status 429'), { code: 'unknown' })), 'riconosce 429 "unknown"');
  ok(C.isRateLimitError({ code: 'resource-exhausted' }), 'riconosce resource-exhausted');
  ok(!C.isRateLimitError(new Error('permission-denied')), 'altri errori non sono rate limit');
}

console.log('\n=================');
console.log('PASSATI: ' + passed + '  FALLITI: ' + failed);
process.exit(failed ? 1 : 0);
