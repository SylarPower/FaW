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
| Potere | `Spazio` |
| Cambia potere | `E` |
| Pausa | `Esc` |

## Online (Firebase)

1. Crea un progetto su [Firebase Console](https://console.firebase.google.com)
2. Aggiungi un’app **Web**, copia la config
3. Crea un **Realtime Database** (regione Europa)
4. Incolla le chiavi in `js/firebase-config.js` (togli il prefisso `YOUR_`)
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
