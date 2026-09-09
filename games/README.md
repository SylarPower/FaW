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

Esempio già collegato: `games/patata/`.

Collega il gioco dall'hub (`../../index.html` → `GAME_PATHS` + card + `GIOCHI_CONFIG`).
