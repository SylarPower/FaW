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
    ├── ruzzle/index.html
    ├── patata/                  # Patata Bollente (index.html + css/ + js/)
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

- L'**hub** (`index.html`) e i giochi **ruzzle, patata, pictionary, gameof15, neonwar** la
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

- Pagine **compat** (`index.html`, ruzzle, patata, pictionary, gameof15, neonwar,
  palestra): includono `games/shared/firebase-config.js` (o `../shared/firebase-config.js`)
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

`tests/patata/quota.test.js` misura letture e scritture reali di una lobby a 3 client e
blocca le regressioni.

## Palestra mobile

La palestra mantiene gli account e i dati esistenti, con una nuova esperienza mobile, modalità focus e salvataggio locale prima della sincronizzazione. Dettagli, verifiche e limiti: [games/palestra/README.md](games/palestra/README.md).

Test UI: `npm ci`, `npx playwright install --with-deps chromium webkit`, `npm run test:gym`. Non è necessario npm per pubblicare o utilizzare il sito statico.
