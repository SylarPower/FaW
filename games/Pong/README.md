# PONG: NEXT LEVEL — Edizione interna

Replica migliorativa 3D di *Pong: The Next Level* (1999). Un giocatore per computer. Tastiera only.

## Modi

- **1 vs Computer** — campagna, sblocco arene (vittoria con 2 di scarto)
- **1 vs Giocatore** — due PC, stanza con codice (Firebase)
- **Triangolo 1v1v1** — campo a triangolo, vs 2 CPU oppure 3 PC online

## Comandi (ogni PC)

| Azione | Tasti |
|---|---|
| Racchetta | `W` `S` oppure `↑` `↓` |
| Seconda racchetta | `A` `D` oppure `←` `→` |
| Presa / lancio (quando disponibile) | `Spazio` |
| Pausa | `Esc` |

I power-up si attivano automaticamente appena la palla colpisce il gettone. Gli effetti sono cumulabili; non esiste più una borsa con selezione e uso manuale.

## Online (Firebase)

1. Crea un progetto su [Firebase Console](https://console.firebase.google.com)
2. Aggiungi un’app **Web**, copia la config
3. Crea un **Realtime Database** (regione Europa)
4. Incolla le chiavi in `games/shared/firebase-config.js` (config condivisa con il portale e gli altri giochi; `js/firebase-config.js` è solo l'adapter ES module che la rilegge)
5. Pubblica le regole: `database.rules.json`
6. Hosting: `firebase deploy` (opzionale) oppure GitHub Pages sulla cartella

Finché la config è placeholder, vs CPU e triangolo vs 2 CPU funzionano lo stesso.

## Deploy GitHub

Repo personale, cartella `pong-next-level` come root Pages, oppure Firebase Hosting:

```
firebase init hosting
firebase deploy
```

Due colleghi aprono lo stesso URL. Uno crea la stanza, manda il codice, l’altro entra.
