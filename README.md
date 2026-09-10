# Focus at Work (FaW)

Portale giochi multiplayer per pause al lavoro.

## Struttura

```
FaW/
├── index.html              # Hub: login, sfide, statistiche
├── dizionario.txt          # Dizionario condiviso (Ruzzle)
├── exercises.json          # Dati palestra
├── gym-icon.png
├── esercizi/               # Asset legacy (non usati dalla palestra)
└── games/
    ├── shared/firebase-config.js   # Config Firebase condivisa (unica fonte)
    ├── shared/faw-ui.css           # Design system premium condivisa (token + componenti)
    ├── shared/faw-layout.js        # Riserva lo spazio dei banner fissi in cima
    ├── shared/podio.js             # Podio di fine partita (posizioni + gradini)
    ├── shared/podio.css            # Stile del podio (colori via --podio-*)
    ├── ruzzle/index.html
    ├── patata/                  # Patata Bollente (index.html + css/ + js/)
    ├── nomi-cose-citta/         # Nomi, Cose, Città (index.html + css/ + js/, README dedicato)
    ├── pictionary/index.html
    ├── gameof15/index.html
    ├── neonwar/index.html
    └── palestra/            # UI mobile + logica + stili (vedi README dedicato)
```

Ogni gioco vive nella propria cartella. L'hub punta a `games/<nome>/index.html`.

## Come aggiungere un gioco

Crea una cartella in `games/`:

```
games/mio-gioco/
├── index.html
├── README.md
├── css/
│   └── style.css
└── js/
    ├── main.js
    ├── game.js
    └── ...
```

Poi registra il gioco in `index.html`:

1. Aggiungi una card in **Scegli il Gioco**
2. Aggiungi il path in `GAME_PATHS`
3. Aggiungi la configurazione in `GIOCHI_CONFIG` (nome, icone, opzioni, modalità, min/max giocatori)

Dalla pagina del gioco, il ritorno alla home è `../../index.html`.

## Design system (faw-ui.css)

`games/shared/faw-ui.css` è il layer visivo condiviso: token (colori, font Nunito,
shadow, radius) e componenti (`.faw-*`, `.fixed-home-btn`).

- L'**hub** (`index.html`) e i giochi **ruzzle, patata, nomi-cose-citta, pictionary, gameof15, neonwar** la
  caricano *prima* dei loro `<style>`/`css`, così le regole locali restano a governare
  l'identità del singolo gioco.
- **Palestra** è mobile-first e non la usa (ha i propri stili dedicati, ma definisce gli
  stessi token `--faw-home-safe-*` in locale).

Quando aggiungi un gioco, linka `../shared/faw-ui.css` nel `<head>` (dopo i font, prima
dei tuoi stili) per ereditare la base e il pulsante HOME standard.

### Area di sicurezza del pulsante HOME

`.fixed-home-btn` è fisso in alto a sinistra, quindi **nessun contenuto deve finirci
sotto**. Usa i token condivisi invece di misure hardcoded:

- `var(--faw-home-safe-x)` (148px) come `padding-left` della barra in alto;
- `var(--faw-home-safe-y)` (72px) come scostamento verticale del primo contenuto.

Entrambi si riducono da soli sotto i 480px. Il test `tests/static/syntax.test.js` verifica
che ogni gioco li usi.

### Banner di stato fissi in cima (faw-layout.js)

I giochi mostrano banner `position: fixed` in alto (attesa giocatori, verifica, fine
turno). `games/shared/faw-layout.js` ne misura l'altezza reale e la pubblica in
`--faw-banner-h`; `faw-ui.css` riserva quello spazio con uno spacer in flusso
(`body.faw-has-banner::before`), così header e testo scendono invece di essere coperti.

Se il tuo gioco ha un banner fisso in cima, caricalo nel `<head>` con `defer`:

```html
<script src="../shared/faw-layout.js" defer></script>
```

> Nota: per capire se un elemento è visibile **non** usare il genitore di offset
> (`offsetParent`): il CSSOM View lo impone a `null` sugli elementi `position: fixed`,
> quindi la riserva di spazio non scatterebbe mai.

## Nessuna segnalazione sonora

In FaW **non esistono avvisi sonori**: niente `AudioContext`, niente `<audio>`, niente
`navigator.vibrate` come notifica. Gli eventi (inviti, turno, fine partita) si annunciano
solo in modo visivo. Unica eccezione: la palestra è un'app mobile e usa l'haptic come
feedback tattile sul tocco, mai come notifica.

## Configurazione Firebase

La config Firebase sta in **un solo file**: `games/shared/firebase-config.js`.
È uno script browser classico (non un modulo ES) che espone `window.FAW_FIREBASE_CONFIG`.

- Pagine **compat** (`index.html`, ruzzle, patata, nomi-cose-citta, pictionary, gameof15,
  neonwar, palestra): includono `games/shared/firebase-config.js` (o `../shared/firebase-config.js`)
  **prima** dello script che chiama `firebase.initializeApp(firebaseConfig)`.

Per cambiare progetto Firebase basta modificare `games/shared/firebase-config.js`.

Le sfide multiplayer usano Firestore (`partite` o una collection dedicata). Per i giochi “tipo Ruzzle” basta `gioco: 'mio-gioco'` nel documento `partite` e il link `games/mio-gioco/index.html?matchId=...`.

### Quota Firestore: regole da rispettare

Il piano gratuito ha un tetto giornaliero di letture/scritture; superarlo fa rispondere
Firestore con **429 Too Many Requests** e il gioco resta bloccato in lobby. Per questo:

- **Una transazione = una lettura in più** (`BatchGetDocuments`). Se l'aggiornamento è un
  `arrayUnion` (pronti, conferme, flag) usa una scrittura diretta, non una transazione.
  In Patata questo passa da `transact()` ad `applyAtomic()`.
- **Mai scrivere in loop**: le azioni di avanzamento le tenta un solo client per volta
  (`ActionGate` in `games/patata/js/game.js`), con scaglionamento e backoff esponenziale
  sui fallimenti (2s → 30s).
- **Nessun polling a pochi secondi**: l'hub aggiorna la lista partite ogni 60 secondi
  (o a mano con il pulsante ⟳), e la presenza ogni 30 secondi.
- **Gli inviti non usano il polling**: hanno un listener dedicato, limitato alle
  partite in attesa (`partecipanti array-contains me` + `stato == 'attesa'`, stessa
  coppia di filtri dello storico quindi stesso indice composito) e alle room
  pictionary in lobby. L'invito arriva in ~1s e costa meno del vecchio refresh,
  perché lo snapshot contiene solo le partite in attesa e poi solo le variazioni.
  Se l'indice composito non esiste il listener ripiega sulla query senza filtro di
  stato e filtra lato client: gli inviti restano in tempo reale, cambiano solo le
  letture.
- **Rifiutare un invito non rompe la partita**: il rifiuto va in `invitoRifiutatoDa`
  (non in `rivincitaRifiutataDa`, che resta il rifiuto della rivincita fatto dentro
  la partita) e chi rifiuta viene tolto da `partecipanti`, così la lobby parte con
  chi resta e il pulsante RIVINCITA non resta bloccato.

`tests/patata/quota.test.js` misura letture e scritture reali di una lobby a 3 client e
blocca le regressioni. `tests/ncc/quota.test.js` fa lo stesso per Nomi, Cose, Città:
una partita completa a 3 giocatori e 2 round costa 0 letture `get`/transazioni, 21
letture da listener e 22 scritture; l'allenamento solo scrive zero.

## Ruzzle: punteggi finali

Il risultato di una partita multiplayer si calcola **una volta sola** e con una
regola unica (`calcolaPunteggiFinali` in `games/ruzzle/index.html`): parola
trovata anche da un altro giocatore = 0 punti, parola eliminata per votazione o
esclusa dal dizionario = 0 punti, ogni partecipante ha sempre una voce.

- Chiude la partita **un solo client** (l'arbitro = primo partecipante in ordine
  alfabetico), che rilegge il documento prima di scrivere; se l'arbitro ha la
  scheda chiusa, dopo 6 secondi subentra il primo client vivo.
- La UI legge sempre `punteggiAllineati`: punteggio, classifica, banner e live
  score mostrano gli stessi numeri su ogni client, anche se il documento non è
  ancora aggiornato (chi manca vale 0).
- A ogni snapshot di una partita conclusa l'arbitro confronta il documento con il
  calcolo atteso e, se non tornano, lo riscrive: i punteggi restano allineati
  anche dopo un'eliminazione tardiva o una scrittura concorrente.
- Il live score (`punteggi.<nome>`) viene scritto solo durante la partita: a fine
  partita non sovrascrive più il risultato calcolato con la regola condivisa.

`tests/ruzzle/punteggi-finali.test.js` apre tre client reali sullo stesso
`matchId` (mock Firestore) e verifica: una sola scrittura di chiusura, risultato
corretto, stessi numeri sui tre schermi, ricalcolo dopo un'eliminazione e
riconciliazione di un punteggio sbagliato senza loop di scritture.

## Leggibilità nel tema chiaro

Il tema bianco di Ruzzle usa superfici chiare (`--item-bg`): tutto il testo che ci
sta sopra deve seguire il tema, altrimenti resta chiaro su chiaro e sparisce.

- `--item-text`, `--accent-strong` e `--primary-strong` sono definiti sia in
  `:root` (tema chiaro) sia in `body.dark-mode`, e hanno un contrasto ≥ 4.5:1 sul
  rispettivo sfondo (verificato da `tests/ruzzle/punteggi-finali.test.js`).
- Le schede dentro i modali ("Cosa mi sono perso", statistiche) usano
  `--item-text`: il modale resta scuro in entrambi i temi, ma le sue schede no.
- La barra "MOSTRA PAROLE DI:" dell'analisi ha sfondo sempre scuro, quindi il
  testo è chiaro in modo esplicito.
- Il podio usa `--item-text`/`--item-bg`, così resta leggibile in entrambi i temi.

## Nomi, Cose, Città

Gioco di parole a round: lettera e categorie condivise, una risposta per giocatore
per categoria, revisione collettiva in cui una risposta si annulla **solo
all'unanimità** (autore incluso). Schema dati, regole Firestore proposte,
compromesso privacy/letture, limiti noti e verifiche:
[games/nomi-cose-citta/README.md](games/nomi-cose-citta/README.md).

Senza `matchId` nella URL si apre l'**allenamento solo**: stessa UI e stessa logica,
zero scritture Firestore.

## Podio di fine partita

Ogni gioco multiplayer (Ruzzle, Patata Bollente, Nomi Cose Città, Gioco del 15,
Pictionary) mostra a fine partita un podio con **tutte le posizioni e i punteggi
corretti**, generato da un unico modulo condiviso:

- `games/shared/podio.js` — `FAWPodio.render(oggetto, righe, { io })`: ordina per
  punteggio decrescente (parità: nome in ordine alfabetico), assegna il gradino
  più alto al 1° e scende di 16 px a ogni posizione (minimo 32 px), marca il
  giocatore corrente con `(TU)` ed escaping dei nomi.
- `games/shared/podio.css` — struttura e colori di base; ogni gioco sovrascrive
  le variabili `--podio-*` con il proprio tema.

Regole valide per tutti i giochi: entrano nel podio **tutti** i giocatori (non
solo i primi tre) e l'altezza dei gradini segue la classifica, mai il contrario.
Ruzzle riempie il podio con `punteggiAllineati`, quindi mostra gli stessi numeri
del documento; Pictionary e Gioco del 15 usano i punteggi della partita.

`tests/shared/podio.test.js` copre ordine, gradini, medaglie, `(TU)`, escaping e
CSS; ogni gioco è verificato anche dal test statico `[9]`.

## Palestra mobile

La palestra mantiene gli account e i dati esistenti, con una nuova esperienza mobile, modalità focus e salvataggio locale prima della sincronizzazione. Dettagli, verifiche e limiti: [games/palestra/README.md](games/palestra/README.md).

Test UI: `npm ci`, `npx playwright install --with-deps chromium webkit`, `npm run test:gym`. Non è necessario npm per pubblicare o utilizzare il sito statico.
