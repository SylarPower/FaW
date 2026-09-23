# 🥔 Patata Bollente

Il gioco delle parole a staffetta per FaW: la patata passa di mano in mano
mentre il timer corre. Chi la tiene quando arriva a zero… si scotta.

## Regole

1. Il turno (round) inizia con **N lettere casuali** (2–4) e un countdown
   (30 / 60 / 120 s).
2. A turno, ogni giocatore deve scrivere una parola (minimo 4 lettere,
   presente nel dizionario Ruzzle) che **contenga tutte le lettere
   richieste** — in qualsiasi posizione: inizio, mezzo o fine.
   **La casella si attiva solo al proprio turno**: chi non ha la patata la
   vede disabilitata e vuota (placeholder `⏳ Aspetta il tuo turno…`), quindi
   **non si può preparare la parola in anticipo**. Il mutatore rifiuta
   comunque ogni scrittura fuori turno: la regola è applicata due volte,
   nell'interfaccia e nel core.
3. **Parola corretta** → `+5 secondi` al timer (vedi *Bonus a scalare*), la
   patata passa al giocatore successivo e i **punti valgono quanto la parola
   è lunga** (4 lettere = 4 pt, 8 lettere = 8 pt, …).
4. **Parola sbagliata** → feedback di errore, **tempo invariato** e tocca
   ancora a te.
5. **Tempo a zero** → la chiusura è **immediata** (nessuna tolleranza: al
   raggiungimento dello zero la scottatura parte dallo stesso frame), chi
   tiene la patata subisce la scottatura (`−10 punti`) e si apre il
   **recap del turno**: tutte le parole scritte, i punti e lo scottato. Ogni
   parola può essere **contestata** con il 🚩 (se la maggioranza degli *altri*
   giocatori la segnala, viene rimossa con i relativi punti).
6. **Tutti confermano** il recap → si passa al turno successivo con nuove
   lettere (il giocatore iniziale ruota a ogni turno).
7. A fine partita (tutti i turni giocati) → **classifica finale su podio**:
   il vincitore sta sul gradino **più alto**, il secondo su quello
   intermedio, il terzo più in basso, e così via per tutti gli altri
   giocatori (altezza `104 − 16 × posizione`, minimo `32 px`). Vince chi ha
   più punti. Disponibile la **rivincita** a tutti i giocatori.

### Pausa per tutti ⏸

Chiunque, durante la fase di gioco, può premere **⏸ PAUSA** (in alto a
destra): il cronometro si **congela per tutti** (l'overlay lo comunica a
ogni client), non scatta mai la scottatura e alla ripresa il tempo
riparte **esattamente** da dove si era fermato — nemmeno gli scalini del
bonus conteggiano la pausa (deadline, riferimento e inizio vengono spostati
della durata della pausa). Durante la pausa le caselle sono disabilitate.
L'unica eccezione è la votazione sul vocabolario (sotto), che gestisce la
pausa in prima persona.

### Proporre una parola al vocabolario 📖 (come in Ruzzle)

Se la tua parola non è nel dizionario, al tuo turno compare il pulsante
**📖 Proponi "…" al vocabolario**:

1. la proposta **mette in pausa il gioco per tutti**;
2. l'overlay mostra la parola, il proponente e i voti di ogni giocatore
   (il proponente conta subito come 👍);
3. **tutti** devono votare `👍 INSERISCI` oppure `👎 NON INSERIRE` — solo a
   votazione completa il gioco riprende;
4. vince la **maggioranza di sì**: la parola viene aggiunta al dizionario
   condiviso (`config/dizionario → extra`, scritto **una sola volta** dal
   client referente) e diventa giocabile subito da tutti; a parità o
   maggioranza di no la proposta cade;
5. il proponente può **✖ ritirare** la proposta in qualsiasi momento per
   sbloccare tutti.

### Power-up 🚀 "Passa la patata"

Un **unico power-up per round**, estratto in modo **deterministico** da
`seed + numero di turno` (stessa estrazione su tutti i client, come le
lettere, zero scritture extra) e assegnato a **un giocatore casuale**:

- sul chip del detentore compare il badge **🚀**;
- al proprio turno, il detentore vede il pulsante **🚀 PASSA LA PATATA A…**
  e sceglie il bersaglio fra gli altri giocatori;
- la patata arriva subito al bersaglio con **0 punti** per chi passa, il
  clock **non cambia** e la rotazione successiva prosegue dalla posizione del
  ricevente;
- **una sola volta per round**: usato il power-up, badge e pulsante spariscono
  e ricompaiono col prossimo round (con un eventuale nuovo detentore);
- durante una pausa o una votazione non è utilizzabile.

Gli altri power-up valutati (scudo, +secondi, jolly lettera, furto punti)
sono stati **valutati e scartati** in fase di design: il gioco resta una
corsa pulita al timer con un solo colpo di scena sociale.

### Lettere "ovviamente non impossibili"

Le lettere di ogni turno sono estratte **deterministicamente** da
`seed + numero di turno` (stessa combinazione su tutti i client, senza
scritture extra) e vengono accettate solo se nel dizionario esistono almeno
12 parole che le contengono tutte (conteggio in tempo reale via indice a
bitset: ~1 ms sul dizionario completo di 286k parole). L'UI mostra sempre
quante parole valide esistono per il turno in corso.

### Punteggio parola = lunghezza effettiva

| Lunghezza | Punti |
|-----------|-------|
| 4         | 4     |
| 5         | 5     |
| 6         | 6     |
| 7         | 7     |
| 8         | 8     |
| 9+         | 9+    |

Ogni lettera vale un punto: una parola da 8 lettere costa 8 punti, una da 4
vale 4. Le round persi (scottature) sono contrassegnati con il **💀 teschio**
(es. `💀×2`) nella lista giocatori, nello scoreboard e sul podio — non con un
fuocherello, perché non sono un traguardo.

### Modalità

- **CLASSICA** → lettere anche staccate (ordine sparso)
- **SEQUENZA** → lettere consecutive (sottostringa)
- **MIX** → **50% classica e 50% sequenza con alternanza garantita** round per
  round (dispari = ordine sparso, pari = sequenza): deterministica su ogni
  client e indipendente dal seed, così su più turni il mix è davvero metà e
  metà (mai una raffica di round tutti uguali).

## Dizionario

Lo stesso identico usato da Ruzzle: [`../../dizionario.txt`](../../dizionario.txt)
più gli override condivisi in Firestore (`config/dizionario` → `extra`/`excluded`),
con la stessa normalizzazione (maiuscole, senza accenti, solo A–Z, min. 4 lettere).

## Multiplayer

Stesse convenzioni degli altri giochi FaW:

- Stanza = documento nella collezione Firestore `partite`
  (`gioco: 'patata'`, creato dall'hub con `partecipanti`, `opzioni`, …).
- URL: `games/patata/index.html?matchId=<id>`.
- Stati: `attesa` → `in_corso` (con `roundData.fase`: `giochi` → `recap`) →
  `conclusa`; le transizioni avvengono con **scritture atomiche**
  (passaggio di turno, scottatura, conferme, nuovo turno, rivincita, pausa,
  votazioni sul vocabolario) così i client concorrenti non si calpestano.
- Il timer è un `deadline` assoluto condiviso: ogni client lo mostra in
  locale e **al raggiungimento dello zero la scottatura scatta subito**
  (`TIMEOUT_GRACE = 0`, invocata anche dal frame rAF senza attendere il tick
  logico di 1 s). In pausa il clock è congelato e la scottatura è sospesa.
- **Bonus a scalare**: la parola corretta aggiunge secondi sempre più piccoli
  man mano che il turno si allunga — `+5s` nel primo minuto, poi `+4s`,
  `+3s`, `+2s` e infine `+1s` da 4 minuti in poi. Il bonus riparte da `+5s` a
  ogni nuovo turno. Il passaggio di scalino è evidente a tutti: il chip
  `+Ns` **lampeggia**, un toast annuncia il nuovo valore e una **barra
  secondo timer** sotto il cronometro si svuota indicando quando scatta il
  prossimo calo (es. «prossimo scalino (+3s) tra 42s»).
- **Tetto del cronometro**: il tempo mostrato non supera mai quello
  configurato (30/60/120 s). Se il cronometro è a 58 s e la parola vale `+5s`,
  si va a 60 s — mai 63. La partita può comunque durare di più, perché il
  tetto vale sull'istante del turno, non sulla partita.
- La rivincita riusa i campi `prossimaPartita` / `rivincitaAccettataDa` /
  `rivincitaRifiutataDa` già usati da Ruzzle e dall'hub.

## Allenamento solo

Apri `index.html` senza `matchId`: si gioca da soli contro il tempo (la
patata scotta lo stesso). Opzioni via URL: `?tempo=60&turni=3&lettere=3`.

## Struttura

```
games/patata/
├── index.html      # shell + screen (lobby, gioco, recap, fine)
├── css/style.css   # design "ember dark" premium
└── js/game.js      # core logico (testato in node) + controller browser
```

Il core logico (RNG, estrazione lettere, validazione, mutatori di stato,
backend locale) è puro e viene exportato per i test:

```js
const C = require('games/patata/js/game.js'); // in node
C.pickLetters('SEED', 1, 3, indice);
C.mutSubmitWord(stato, ctx);
C.powerPassFor(stato);      // detentore del power-up 🚀 del round
C.mutPassaPatata(stato, ctx);
new C.SoloBackend('TU', opzioni);
```

## Test

```bash
npm run test:patata
```

Cinque suite in [`tests/patata/`](../../tests/patata/):

- `core.test.js` — 199 test sul core puro: normalizzazione, indice a bitset,
  estrazione lettere (determinismo + risolvibilità), validazione, mutatori,
  simulazione completa 3 giocatori / 2 turni, timeout immediato (grazia 0),
  pausa per tutti (clock congelato/ripristinato), richiesta parola + voto di
  tutti, power-up 🚀 passa la patata (estrazione deterministica + mutatore),
  mix 50/50, SoloBackend, performance con il dizionario reale (286k
  parole: indice ~50 ms, estrazione lettere ≤ 2 ms).
- `multiplayer.test.js` — 35 test multi-client su mock Firestore (scritture
  serializzate, `arrayUnion`/`delete`, gare su timeout/next-round → esatta una
  transazione vince, contestazioni, rotazione turni, fine partita).
- `quota.test.js` — 42 test di consumo: zero letture nel percorso di gioco,
  ActionGate/backoff sui 429.
- `browser.test.js` — E2E 39 test in jsdom sulla pagina reale: boot → lobby →
  partita → parola corretta (bonus, punti = lunghezza, feed) → parola
  sbagliata (tempo invariato) → timeout (scottatura immediata) → recap →
  conferma → fine (podio + statistiche hub).
- `browser-multiplayer.test.js` — E2E 92 test con **due pagine reali** su
  mock Firestore: la casella di chi non ha la patata è **disabilitata e
  vuota** (nessuna parola preparata, nessuna scrittura), si attiva al
  passaggio della patata, il cronometro resta entro il tetto configurato, a
  fine partita il gradino del vincitore è il più alto — più il flusso
  completo **pausa per tutti**, **proposta parola con voto di tutti**
  (approvazione → dizionario condiviso scritto una volta → parola giocabile)
  e **power-up 🚀 passa la patata** (badge, scelta bersaglio, 0 punti,
  un solo utilizzo).

## Note / limiti

- Il nome giocatore viene usato come **path di campo Firestore**
  (`punteggi.NOME`, `roundData.parlate.NOME`): evita i punti nei nomi
  (stessa limitazione di Ruzzle).
- Se un giocatore abbandona a metà turno, la sua patata scade al timer e
  subisce la scottatura; la partita prosegue con gli altri.
- Se un giocatore si disconnette durante una **votazione sul vocabolario**
  resta in attesa del suo voto: il proponente può sempre **ritirare** la
  proposta per sbloccare la pausa.
- La validazione avviene sul client attivo (dizionario identico per tutti);
  in fase di recap le parole possono comunque essere contestate con il 🚩.
