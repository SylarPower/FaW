# Focus at Work (FaW)

Portale giochi multiplayer per pause al lavoro.

## Struttura

```
FaW/
├── index.html              # Hub: login, sfide, statistiche
├── dizionario.txt          # Dizionario condiviso (Ruzzle)
├── exercises.json          # Dati palestra
├── gym-icon.png
├── esercizi/               # Video esercizi
└── games/
    ├── shared/firebase-config.js   # Config Firebase condivisa (unica fonte)
    ├── ruzzle/index.html
    ├── pictionary/index.html
    ├── gameof15/index.html
    ├── neonwar/index.html
    ├── palestra/index.html
    └── Pong/                 # index.html + css/ + js/
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

## Configurazione Firebase

La config Firebase sta in **un solo file**: `games/shared/firebase-config.js`.
È uno script browser classico (non un modulo ES) che espone `window.FAW_FIREBASE_CONFIG`.

- Pagine **compat** (`index.html`, `test.html`, ruzzle, pictionary, gameof15, palestra):
  includono `games/shared/firebase-config.js` (o `../shared/firebase-config.js`)
  **prima** dello script che chiama `firebase.initializeApp(firebaseConfig)`.
- **Pong** (Firebase modulare): `games/Pong/index.html` carica lo stesso file prima di
  `js/main.js`; `games/Pong/js/firebase-config.js` è solo un adapter che ri-esporta
  la config come modulo ES e fornisce `isFirebaseConfigured()`.

Per cambiare progetto Firebase basta modificare `games/shared/firebase-config.js`.

Le sfide multiplayer usano Firestore (`partite` o una collection dedicata). Per i giochi “tipo Ruzzle” basta `gioco: 'mio-gioco'` nel documento `partite` e il link `games/mio-gioco/index.html?matchId=...`.
