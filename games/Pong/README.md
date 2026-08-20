# Pong

Pong neon per pause al lavoro: vs CPU, due giocatori sulla stessa macchina, o sfida online dal portale FaW.

## Struttura

```
games/Pong/
├── index.html
├── README.md
├── css/style.css
└── js/
    ├── models.js
    ├── save.js
    ├── audio.js
    ├── particles.js
    ├── arenas.js
    ├── physics.js
    ├── powerups.js
    ├── ai.js
    ├── input.js
    ├── engine.js
    ├── ui.js
    ├── game.js
    └── main.js
```

## Controlli

- **Giocatore 1 (sinistra):** W / S, o touch/mouse sul lato sinistro
- **Giocatore 2 (destra):** frecce, o touch/mouse sul lato destro
- **Pausa:** Esc o P
- **Menu:** Home in basso a destra

## Modalità

- Classica — primo a N punti
- Power-up — item casuali in campo
- Hardcore — palla più veloce, paddle più piccoli

Dal portale puoi sfidare un amico: l’host simula la fisica, l’ospite muove la racchetta destra.
