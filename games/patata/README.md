# 🥔 Patata Bollente

Il gioco delle parole a staffetta per FaW: la patata passa di mano in mano
mentre il timer corre. Chi la tiene quando arriva a zero… si scotta.

## Regole

1. Il turno (round) inizia con **N lettere casuali** (2–4) e un countdown
   (30 / 60 / 120 s).
2. A turno, ogni giocatore deve scrivere una parola (minimo 4 lettere,
   presente nel dizionario Ruzzle) che **contenga tutte le lettere
   richieste** — in qualsiasi posizione: inizio, mezzo o fine.
3. **Parola corretta** → `+5 secondi` al timer e la patata passa al
   giocatore successivo.
4. **Parola sbagliata** → `−5 secondi` e tocca ancora a te.
5. **Tempo a zero** → chi tiene la patata subisce la scottatura
   (`−10 punti`) e si apre il **recap del turno**: tutte le parole scritte,
   i punti e lo scottato. Ogni parola può essere **contestata** con il 🚩
   (se la maggioranza degli *altri* giocatori la segnala, viene rimossa con
   i relativi punti).
6. **Tutti confermano** il recap → si passa al turno successivo con nuove
   lettere (il giocatore iniziale ruota a ogni turno).
7. A fine partita (tutti i turni giocati) → **classifica finale**: vince chi
   ha più punti. Disponibile la **rivincita** a tutti i giocatori.

### Lettere "ovviamente non impossibili"

Le lettere di ogni turno sono estratte **deterministicamente** da
`seed + numero di turno` (stessa combinazione su tutti i client, senza
scritture extra) e vengono accettate solo se nel dizionario esistono almeno
12 parole che le contengono tutte (conteggio in tempo reale via indice a
bitset: ~1 ms sul dizionario completo di 286k parole). L'UI mostra sempre
quante parole valide esistono per il turno in corso.

### Punteggio parola (come Ruzzle)

| Lunghezza | Punti |
|-----------|-------|
| 4         | 1     |
| 5         | 2     |
| 6         | 3     |
| 7         | 5     |
| 8+        | 11    |

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
  `conclusa`; le transizioni avvengono con **transazioni Firestore**
  (passaggio di turno, scottatura, conferme, nuovo turno, rivincita) così i
  client concorrenti non si calpestano.
- Il timer è un `deadline` assoluto condiviso: ogni client lo mostra in
  locale (tolleranza di 2,5 s prima di dichiarare la scottatura).
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
new C.SoloBackend('TU', opzioni);
```

## Test

```bash
npm run test:patata
```

Tre suite in [`tests/patata/`](../../tests/patata/):

- `core.test.js` — 95 test sul core puro: normalizzazione, indice a bitset,
  estrazione lettere (determinismo + risolvibilità), validazione, mutatori,
  simulazione completa 3 giocatori / 2 turni, SoloBackend, performance con il
  dizionario reale (286k parole: indice ~50 ms, estrazione lettere ≤ 2 ms).
- `multiplayer.test.js` — 20 test multi-client su mock Firestore (transazioni
  serializzate, `arrayUnion`/`delete`, gare su timeout/next-round → esatta una
  transazione vince, contestazioni, rotazione turni, fine partita).
- `browser.test.js` — E2E 38 test in jsdom sulla pagina reale: boot → lobby →
  partita → parola corretta (+5 s, punti, feed) → parola sbagliata (−5 s) →
  timeout (scottatura) → recap → conferma → fine (podio + statistiche hub).

## Note / limiti

- Il nome giocatore viene usato come **path di campo Firestore**
  (`punteggi.NOME`, `roundData.parlate.NOME`): evita i punti nei nomi
  (stessa limitazione di Ruzzle).
- Se un giocatore abbandona a metà turno, la sua patata scade al timer e
  subisce la scottatura; la partita prosegue con gli altri.
- La validazione avviene sul client attivo (dizionario identico per tutti);
  in fase di recap le parole possono comunque essere contestate con il 🚩.
