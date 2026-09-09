# Giochi

Ogni sottocartella è un gioco autonomo con il proprio `index.html`.

Rush (`categoria-rush/`) e La Bomba (`bomba-parole/`) condividono sala e trasporto in
`shared/`. Rush offre **Sprint**, **Creativo** e **Nomi, Cose, Città** (schede da 3/6 categorie),
con tempi massimi e chiusura anticipata quando tutti hanno finito. Regole, fonti, architettura e test: [GAMES.md](../GAMES.md).

Struttura consigliata per un gioco con sala condivisa:

```
games/<nome>/
├── index.html
├── css/style.css
└── js/
    ├── regole.js   # reducer puri, senza DOM né rete
    └── partita.js  # controller e rendering, usa shared/faw-room e faw-net
```

Pong mantiene la propria struttura modulare: [README](Pong/README.md).

Collega il gioco dall'hub (`../../index.html` → `GAME_PATHS` + card + `GIOCHI_CONFIG`).

In Rush, `js/nomi-cose-citta.js` isola dati/validazione/punteggi NCC; `js/scheda.js`
gestisce l'editor e le bozze revisionate. L'orologio di gioco legge `fasePartita`,
non la vecchia formula `indice × durata nominale`.
