# Giochi

Ogni sottocartella è un gioco autonomo con il proprio `index.html`.

Per un gioco nuovo con CSS/JS separati:

```
games/<nome>/
├── index.html
├── README.md
├── css/style.css
└── js/
    ├── ai.js
    ├── arenas.js
    ├── audio.js
    ├── engine.js
    ├── game.js
    ├── input.js
    ├── main.js
    ├── models.js
    ├── particles.js
    ├── physics.js
    ├── powerups.js
    ├── save.js
    └── ui.js
```

Collega il gioco dall'hub (`../../index.html` → `GAME_PATHS` + card + `GIOCHI_CONFIG`).
