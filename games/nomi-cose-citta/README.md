# 📝 Nomi, Cose, Città

Il gioco di parole classico per FaW: una **lettera condivisa**, le **categorie
condivise**, una risposta per giocatore per categoria, poi una **revisione
collettiva** in cui una risposta si annulla solo **all'unanimità**.

- **Sfida**: `games/nomi-cose-citta/index.html?matchId=<ID>` (partita creata dall'hub).
- **Allenamento solo**: `games/nomi-cose-citta/index.html` (senza `matchId`), zero scritture Firestore.

---

## 1. Regole implementate

1. Ogni round ha **una lettera** e **un insieme di categorie** comuni a tutti.
2. Ogni giocatore scrive **una risposta per categoria**.
3. Una risposta è **automaticamente valida** se: non è vuota, la sua forma
   normalizzata **inizia con la lettera** del round e la forma normalizzata
   **esiste nel dizionario effettivo** (base + override).
   I motivi di invalidità sono mostrati esplicitamente: *vuota*, *non inizia
   per X*, *assente dal dizionario*.
4. **Revisione**: la tabella mostra tutte le risposte (righe = categorie,
   colonne = giocatori) con testo, validità automatica + motivo, voti,
   stato e punteggio provvisorio.
5. **Due voti, stessa regola dell'unanimità** (obbligatoria):
   - **🚫 NON VALIDA** (annullamento): una risposta automaticamente valida è
     annullata **solo se tutti i partecipanti del round votano "Non valida",
     autore incluso**;
   - **✅ VALIDA** (validazione): una risposta scritta che il dizionario non
     riconosce (*assente dal dizionario*, *non inizia per X*) diventa valida
     **solo se tutti votano "Valida", autore incluso**. Il responso del
     dizionario resta registrato (`motivoAutomatico`): la parola è *validata
     dai giocatori*, non "presente nel dizionario".
   Nessuna maggioranza, nessun voto dei soli avversari, nessun silenzio-assenso.
   Alla scadenza della revisione un voto **non unanime lascia le cose come
   stanno** (la valida resta valida, la non riconosciuta resta a 0).
   I due voti si escludono: un giocatore ha **un solo voto per cella** e una
   risposta vuota non è recuperabile. A parità di unanimità vince
   l'annullamento.
6. **Stato di voto evidente**: appena esiste almeno un voto, la cella si
   evidenzia (bordo animato + nastro "🗳️ IN VOTO") e sopra la tabella compare
   la striscia **"IN VOTAZIONE"** con parola, autore, categoria, direzione del
   voto, voti raccolti e **chi manca** all'unanimità.
7. Il **quorum è congelato a inizio round** (`roundData.partecipanti`): un
   giocatore che si disconnette non lo riduce, chi entra dopo non lo aumenta,
   chi torna rientra con il proprio voto.
8. Ogni giocatore conferma **"Revisione conclusa"**; cambiare voto **revoca**
   la propria conferma. La revisione si chiude quando tutti hanno confermato
   o alla scadenza.
9. **Punteggio (variante classica, dichiarata in UI)**:

   | caso | punti |
   |------|-------|
   | vuota / infine non valida | 0 |
   | valida (anche **validata dal voto**), duplicata da almeno un'altra valida | 5 |
   | valida e distinta, con altre valide nella categoria | 10 |
   | **unica** risposta valida della categoria | **20** |

   Il 20 **sostituisce** il 10 (non si sommano). I duplicati si confrontano
   sulla forma **normalizzata**, stessa categoria e stesso round; la stessa
   parola in categorie diverse è ammessa. Dopo un annullamento o una
   validazione **l'intera categoria viene ricalcolata**.
10. **Fine turno**: il riepilogo del round mostra subito la **classifica
    provvisoria** (posizione, totale aggiornato, punti del round e barra
    proporzionale) prima del dettaglio per categoria.
11. **Fine partita**: **podio con gradini decrescenti** (il vincitore è il più
    alto, poi il secondo, il terzo e così via per tutti), **pulsante RIVINCITA
    in alto** (visibile senza scorrere), dettaglio per round e per categoria,
    totali per round, classifica con pareggi. La rivincita riusa le stesse
    opzioni in una nuova sessione logica, senza residui di risposte/voti/esiti.

### Categorie

Id stabili separati dalle etichette: `nomi, cose, citta, animali, mestieri,
piante` (preset `classic`, 6) e `nomi, cose, citta` (preset `light`, 3).
Categorie personalizzate: id sanificato in `[A-Z0-9]`, etichetta conservata a
parte; massimo 10.

### Lettere

`A B C D E F G I L M N O P Q R S T U V Z` (configurabile via `opzioni.lettere`).
Sequenza generata con Fisher-Yates a sacchetti da `seed + '::ncc-lettere::'`:
stessa sequenza su tutti i client, **senza ripetizioni finché possibile**,
zero scritture. Il valore autorevole del round è `roundData.lettera`.

---

## 2. Architettura

```
games/nomi-cose-citta/
├── index.html
├── css/style.css
└── js/
    ├── core.js      → logica pura (UMD, zero DOM/Firebase): validazione,
    │                  punteggio, machine a stati, chiavi, dizionario, mutatori
    ├── backend.js   → trasporto: SoloBackend (memoria) e FirebaseBackend
    │                  (onSnapshot + applyAtomic + ActionGate)
    └── ui.js        → solo DOM: render, input, overlay, toast, statistiche
```

`core.js` non conosce `document` né `firebase`; `ui.js` non scrive regole di
gioco: chiama **mutatori puri** `mutX(state, ctx) → update | {__error} | null`
(`null` = transizione non applicabile, quindi **no-op idempotente**).
Lo stesso `core.js` è usato dall'allenamento e dalla sfida.

### Macchina a stati

`stato`: `attesa` → `in_corso` → `conclusa`; dentro `in_corso`,
`roundData.fase`: `compilazione` → `revisione` → `risultati`.
In allenamento la `revisione` è saltata (un solo giocatore, nessun quorum):
`compilazione` → `risultati` con punteggio di allenamento.

Un **refresh ricostruisce tutto dallo stato condiviso** senza riavviare il
round: le risposte tornano dal documento del giocatore, la revisione dalla
query di round, il recap dall'esito congelato.

---

## 3. Dizionario

Lo stesso di Ruzzle/Patata: `../../dizionario.txt` (min. 4 lettere) + override
condivisi in Firestore `config/dizionario` (`extra` / `excluded`, l'esclusione
vince). Cache in `localStorage` (`faw_ncc_dict_override`, TTL 24 h) con
fallback sulla copia scaduta se il fetch fallisce. **Non viene ricaricato a
ogni round.**

**Fingerprint**: `'v1:' + fnv1a(minLunghezza + ':' + nParole + ':' + extra + '|' + excluded)`
(sul dizionario completo senza override vale `v1:ceeacbd1`, misurato in
`tests/ncc/core.test.js`), mostrato nel topbar, scritto in `roundData.dictVersion`
all'avvio del round e **ricontrollato alla preparazione del round**: se non
corrisponde, l'UI tenta un riallineamento e, se non riesce, **blocca la
chiusura** invece di invalidare risposte valide. Finché il dizionario non è
pronto le risposte sono marcate *non verificata*, **mai invalide**.

Le risposte composte sono verificate **come un'unica stringa normalizzata**
(`SAN GIOVANNI` → `SANGIOVANNI`), non parola per parola.

---

## 4. Schema dati

### `partite/<matchId>` (documento hub, esteso)

Creato dall'hub come per gli altri giochi (`gioco: 'ncc'`, `partecipanti`,
`punteggi`, `pronti`, `stato`, `opzioni`, `timestamp`, …). Il gioco aggiunge:

```
stato            'attesa' | 'in_corso' | 'conclusa'
round            1..N
punteggi         { [nome]: int }            ← sempre ricalcolato da risultati[]
risultati        [ esito ]                  ← arrayUnion, uno per round
roundData {
  id             'r3'                       ← identificatore univoco del round
  round          3
  lettera        'M'
  categorie      ['nomi','cose',…]          ← id stabili
  partecipanti   ['ALFA','BETA']            ← QUORUM CONGELATO
  fase           'compilazione'|'revisione'|'risultati'
  faseVersion    int                        ← cresce a ogni transizione di fase
  inizio         ms
  deadline       ms                         ← scadenza assoluta condivisa
  stop           null | { da, ts }          ← 'TEMPO' se chiusura a tempo
  voti           { 'c0_p1': ['ALFA'] }      ← voti "NON VALIDA", chiavi c<cat>_p<giocatore>
  votiValida     { 'c0_p1': ['ALFA'] }      ← voti "VALIDA" (stessa forma, mappa separata)
  conferme       ['ALFA']                   ← revisione conclusa
  esitoId        null | 'r3'                ← esito congelato (idempotenza)
  dictVersion    'v1:ceeacbd1'
  annullateManuali []                       ← solo allenamento (mai condivisa)
  validateManuali  []                       ← solo allenamento (mai condivisa)
}
esito (elemento di risultati[]) {
  id 'r3', round 3, lettera 'M',
  celle [ { k, c, p, cat, nome, raw, norm, valida, motivo, motivoAutomatico,
            voti, votiValida, annullata, validata, punti } ],
  punti { ALFA: 40, BETA: 20 }
}
```

`valida` è `true` per validazione automatica **oppure** per voto unanime
"Valida"; in quest'ultimo caso `validata` è `true` e `motivoAutomatico`
conserva il responso del dizionario (`ASSENTE`, `INIZIALE`, …).

**Nessun dato dei giocatori in chiaro nel documento partita durante la
compilazione**: il documento contiene solo voti, conferme ed esiti congelati.

### `partite/<matchId>/risposte/<docId>` (sottocollezione)

Un documento per **giocatore × round**, scritto **solo dal proprietario**:

```
docId      'r3__p1'                         ← roundId + indice giocatore
round      3
roundId    'r3'
giocatore  'BETA'
indice     1
categorie  ['nomi','cose',…]
risposte   { c0: { raw:'MILANO', norm:'MILANO' } | null, c1: … }
aggiornato ms
```

Le chiavi sono **indici** (`c0`, `c1`, …) perché gli id delle categorie
personalizzate potrebbero non essere sicuri in un dot-path; `raw` è troncato a
60 caratteri.

### Id sicuri

Nomi utente e categorie **non finiscono mai** in id documento o in dot-path:
gli id sono `r<N>`, `p<i>`, `c<i>`, `r<N>__p<i>` (`safeId` / `docIdRisposta`).
I nomi utente dell'hub possono contenere spazi e punti, quindi sono ammessi
solo nei **valori** (`partecipanti`, `voti`), mai nei percorsi.

---

## 5. Concorrenza senza transazioni

Il progetto ha il vincolo **zero `runTransaction` e zero `BatchGetDocuments`**
(verify con `tests/static/syntax.test.js`). La consistenza si ottiene così:

1. **Scritture parziali**: ogni azione produce un `update` con dot-path mirati
   (`roundData.fase`, `roundData.voti.c0_p1`, …); mai la riscrittura del
   documento per una risposta o un voto.
2. **Guardie di fase nel mutatore**: `mutStop` si applica solo se
   `fase === 'compilazione'` e `!stop`; `mutVota`/`mutConfermaRevisione` solo
   in `revisione`; `mutChiudiRevisione` solo se `!esitoId`; `mutProssimoRound`
   solo se `esitoId` e deadline trascorsa. Una transizione già avvenuta
   restituisce `null` → no-op.
3. **`faseVersion`** cresce a ogni transizione di fase: un client in ritardo
   rileva dal proprio snapshot locale di essere obsoleto e si allinea invece
   di riscrivere.
4. **`esitoId`** rende la chiusura dell'esito idempotente: `risultati` si
   aggiorna con `arrayUnion` di un oggetto identificato da `id: 'r<N>'` e
   `punteggi` è **sempre ricalcolato** da `risultati` (`punteggiDaRisultati`
   deduplica per `id`). Tre chiusure concorrenti non raddoppiano i punti
   (verificato nei test).
5. **`ActionGate`** locale: una sola azione in volo per tipo, con finestra di
   prenotazione (`visti: -1` = situazione mai osservata), retry esponenziale
   2 s → 30 s, subentro al referente dopo `STUCK_FALLBACK_MS` (12 s) con
   scaglionamento `indice × 900 ms` per evitare scritture simultanee.
6. **Scadenze condivise assolute** (`deadline`) con tolleranza
   `TIMEOUT_GRACE` (2,5 s) prima di dichiarare il timeout; il countdown è
   solo locale (**nessun timer scritto su Firestore**, verificato).
7. **Esito di rete ambiguo**: nessuna riapplicazione ottimistica; si fa
   riconciliazione con lo snapshot (il mutatore applicato localmente viene
   scartato quando arriva il documento autorevole). Non si afferma
   "esattamente una volta" sulla base di blocchi locali.
8. **429 / quota**: backoff 4 s → 60 s con hook `onRateLimit` / `onRecover` e
   indicatore visibile in UI.

### Quota misurata (test, non stime)

| scenario | get/transazioni | letture listener | scritture |
|---|---|---|---|
| partita completa, 3 giocatori × 2 round (`tests/ncc/quota.test.js`) | **0** | 21 | 22 |
| partita completa reale via UI, 2 giocatori × 1 round (`tests/ncc/browser-multiplayer.test.js`) | 2 (`config/dizionario`) | 4 | 13 |
| allenamento solo (`tests/ncc/browser.test.js`) | 0 | 0 | **0** |

In compilazione i listener attivi sono **due**: il documento partita e il
proprio documento risposte. **Nessuna query** sulle risposte degli altri è
aperta prima della revisione. La salvataggio progressivo è in debounce
(1,2 s): una scrittura, non una per battuta.

---

## 6. Privacy e letture: il compromesso dichiarato

Il documento `partite/<matchId>` resta l'**hub di sottoscrizione** (stato,
fasi, voti, esiti) — un solo listener per tutti. Le risposte stanno in una
sottocollezione con un documento per giocatore e round:

- **durante la compilazione** ogni client legge **solo il proprio documento**;
  le risposte degli altri non sono né scaricate né visibili;
- **durante la revisione** si apre **una sola query** `where('round','==',N)`
  (campo singolo, nessun indice composito) e i partecipanti leggono i
  documenti del round;
- alla chiusura del round/`stop()` tutti i listener delle risposte vengono
  chiusi.

Il prezzo è in **letture**: N documenti per round invece di 1 documento
condiviso, e una query per round per giocatore. Il guadagno è che le risposte
non sono pubbliche durante il gioco e che una scrittura non riscrive mai i
dati altrui. Con 8 giocatori × 10 round sono ~80 documenti per partita:
accettabile, e resta un solo listener sul documento hub.

---

## 7. Sicurezza: cosa NON è garantito

- **FaW non usa Firebase Auth**: l'identità è `localStorage.mioNome` (login
  hub con hash password). Un nome in `localStorage` **non prova identità** e
  le Security Rules non possono verificarlo. Di conseguenza:
  - l'**ownership** del documento risposte,
  - il **voto personale** (un client modificato può votare per un altro nome),
  - la **segretezza** delle risposte durante la compilazione (è isolamento di
    *lettura*, non crittografia),
  **non sono garantiti lato server**. Sono mitigazioni di progetto, non
  controlli di sicurezza.
- I controlli nell'UI (STOP abilitato, pulsanti di voto disabilitati, quorum)
  sono **comodità e chiarezza**, non protezioni: la logica autorevole è nei
  mutatori e nei dati condivisi.
- `games/nomi-cose-citta/firestore.rules.proposed` contiene le regole
  consigliate (fase/versione precedenti e successive senza `runTransaction`,
  scrittura del proprio documento risposte limitata alla compilazione,
  `risultati`/`punteggi` solo in append). **Non è stata distribuita**: nel
  repository non esiste alcun file di regole attivo e l'applicazione richiede
  `firebase deploy --only firestore:rules`, fuori dallo scope di questa
  integrazione.
- Persistenza: con la cache offline di Firestore (`FAW_ENABLE_PERSISTENCE`)
  gli snapshot possono arrivare da cache (`fromCache`) e le scritture possono
  avere `hasPendingWrites`; l'UI non mostra mai una risposta locale come
  definitivamente accettata e segnala lo stato di salvataggio
  (`salvo…` / `salvato` / `in coda offline` / `non salvata`). Su dispositivi
  condivisi le risposte restano nella cache locale del browser.
- Rendering: ogni testo utente passa da `esc()` ed è inserito come testo;
  nessun `innerHTML` con dati non sanificati, selettori costruiti con `sel()`.

---

## 8. Allenamento solo

Stesso `core.js`, stessa UI, stessa macchina a stati, ma `SoloBackend`
(in memoria, stessa API `subscribe`/`applyAtomic`/`onRisposte`):

- **zero scritture Firestore** (contatore `scrittureFirestore` verificato = 0);
- punteggio di **allenamento dichiarato**: 10 punti per risposta
  automaticamente valida, 0 altrimenti; **mai 20 automatici** (con un solo
  giocatore ogni risposta sarebbe "unica");
- annullamento e validazione sono **manuali** (`annullataManuale` /
  `validataManuale`, mutuamente esclusivi) e distinti dalla validità
  automatica (`motivoAutomatico` conservato): in allenamento non esiste un
  quorum, quindi i due voti della revisione diventano due scelte dichiarate;
- nessun mescolamento con i record multiplayer: la rivincita multiplayer non
  è disponibile e le statistiche sono le stesse (`funatwork_daily_stats`,
  chiave `ncc`) come per gli altri giochi.

---

## 9. Test e verifica

```bash
npm run test:ncc      # logica + multiplayer + quota + UI (jsdom)
npm run test:static   # convenzioni di progetto, divieti, integrazione hub
npm test              # tutto
```

| file | cosa copre | tipo |
|---|---|---|
| `tests/ncc/core.test.js` | normalizzazione, iniziale, override, dizionario mancante/disallineato, punteggi 0/5/10/20, duplicati dopo annullamento, voto dell'autore e unanimità, **voto "Valida" (unanimità, precedenza dell'annullamento, ritiro del voto opposto)**, quorum stabile, timeout, rivincita senza residui, allenamento con annullamento/validazione manuali | unitario (logica pura) |
| `tests/ncc/multiplayer.test.js` | 3 client su Firestore simulato: STOP simultanei, subentro al referente, scritture in ritardo, riconnessione, doppia finalizzazione, refresh | integrazione (backend) |
| `tests/ncc/quota.test.js` | zero get/transazioni, scritture per azione, nessun timer scritto, listener minimi + cleanup, budget totale | quota |
| `tests/ncc/browser.test.js` | pagina reale in allenamento: boot, lobby, campi, STOP, punti, annullamento/validazione manuali, classifica provvisoria, statistiche | E2E (jsdom) |
| `tests/ncc/browser-multiplayer.test.js` | due pagine reali + Firestore simulato: privacy in compilazione, tabella di revisione, voti "non valida" e "valida", striscia "in votazione", conferme, esito, classifica provvisoria, podio, budget | E2E (jsdom) |

Le **Security Rules non sono testate automaticamente**: in questo ambiente
non è disponibile l'Emulator Suite (`firebase-tools` non installato, nessuna
configurazione di progetto). Checklist riproducibile in `firestore.rules.proposed`.

---

## 10. Limiti noti e decisioni aperte

1. **Nessuna classificazione semantica**: la validità è lessicale. "MILANO"
   sotto *Animali* è valida se la parola esiste e inizia con la lettera: è la
   revisione collettiva (unanimità) a correggere gli abusi, come nel gioco
   cartaceo.
2. **Il dizionario non contiene forme composte né parole sotto le 4 lettere**:
   `SAN GIOVANNI` → `SANGIOVANNI` **non** è nel dizionario e risulta non
   valida; `BO`, `UGO` pure. Misurato su `dizionario.txt`: 286.303 parole,
   44/44 città monolemma presenti, 14/14 nomi propri comuni presenti,
   **0/5 risposte composte presenti**, lunghezza minima 4. Rimedio previsto:
   override `extra` in `config/dizionario` (senza rilasci di codice).
3. **Nomi stranieri** in parte assenti (`KEVIN`, `SHARON`): stesso rimedio.
4. **Lettere escluse** dall'insieme base: H, J, K, W, X, Y (quasi nessuna
   parola italiana); set configurabile via `opzioni.lettere`.
5. **Regole Firestore non distribuite** (vedi §7) e **nessun Auth**: le
   garanzie di ownership/segretezza restano dichiarative.
6. **Quorum congelato**: se un partecipante abbandona definitivamente durante
   la revisione, serve la scadenza della revisione per chiudere (una
   contestazione non unanime lascia valida la risposta). È una scelta
   esplicita a favore della regola dell'unanimità.
7. **Modalità**: solo la variante classica (niente BONUS/CRAZY/MIX), per
   richiesta. Il punteggio è dichiarato in UI per evitare ambiguità.
8. **Test E2E in jsdom**: coprono DOM/logica ma non il rendering reale né il
   comportamento offline di Firestore; per quello resta la verifica manuale
   su browser.
