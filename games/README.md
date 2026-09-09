# Giochi

Ogni sottocartella è un gioco autonomo con il proprio `index.html`.

Per un gioco nuovo con CSS/JS separati:

```
games/<nome>/
├── index.html
├── README.md
├── css/style.css
└── js/
    ├── game.js
    └── ...
```

Esempi già collegati: `games/patata/`, `games/nomi-cose-citta/`.

Collega il gioco dall'hub (`../../index.html` → `GAME_PATHS` + card + `GIOCHI_CONFIG`).
