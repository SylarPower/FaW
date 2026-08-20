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
    ├── ruzzle/index.html
    ├── pictionary/index.html
    ├── gameof15/index.html
    ├── neonwar/index.html
    └── palestra/index.html
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

Le sfide multiplayer usano Firestore (`partite` o una collection dedicata). Per i giochi “tipo Ruzzle” basta `gioco: 'mio-gioco'` nel documento `partite` e il link `games/mio-gioco/index.html?matchId=...`.
