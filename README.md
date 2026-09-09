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
- **Palestra** è mobile-first e non la usa (ha i propri stili dedicati).

Quando aggiungi un gioco, linka `../shared/faw-ui.css` nel `<head>` (dopo i font, prima
dei tuoi stili) per ereditare la base e il pulsante HOME standard.

## Configurazione Firebase

La config Firebase sta in **un solo file**: `games/shared/firebase-config.js`.
È uno script browser classico (non un modulo ES) che espone `window.FAW_FIREBASE_CONFIG`.

- Pagine **compat** (`index.html`, ruzzle, patata, pictionary, gameof15, neonwar,
  palestra): includono `games/shared/firebase-config.js` (o `../shared/firebase-config.js`)
  **prima** dello script che chiama `firebase.initializeApp(firebaseConfig)`.

Per cambiare progetto Firebase basta modificare `games/shared/firebase-config.js`.

Le sfide multiplayer usano Firestore (`partite` o una collection dedicata). Per i giochi “tipo Ruzzle” basta `gioco: 'mio-gioco'` nel documento `partite` e il link `games/mio-gioco/index.html?matchId=...`.

## Palestra mobile

La palestra mantiene gli account e i dati esistenti, con una nuova esperienza mobile, modalità focus e salvataggio locale prima della sincronizzazione. Dettagli, verifiche e limiti: [games/palestra/README.md](games/palestra/README.md).

Test UI: `npm ci`, `npx playwright install --with-deps chromium webkit`, `npm run test:gym`. Non è necessario npm per pubblicare o utilizzare il sito statico.
