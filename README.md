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
├── tests/
│   ├── unit/               # regole pure dei nuovi giochi (node --test, niente browser)
│   ├── faw/                # Playwright multi-contesto su relay finto (Arena/Rush/Bomba/hub)
│   ├── gym/                # 42 test regressivi della palestra (non toccati dal redesign)
│   └── support/faw-relay.js  # statici + mini-Firestore in memoria per i test
└── games/
    ├── shared/firebase-config.js   # Config Firebase condivisa (unica fonte)
    ├── shared/faw-design.css       # design system: token + componenti
    ├── shared/faw-core.js          # utente, storage, id, suono, dialog, utils
    ├── shared/faw-net.js           # Firestore o relay fake: transazioni, clock, presenza
    ├── shared/faw-room.js          # sala: stati, invite, pronto, countdown, rivincita
    ├── shared/faw-words.js         # dizionario (stesso `dizionario.txt` di Ruzzle)
    ├── shared/faw-categorie.js     # dataset categorie/risposte di Categoria Rush
    ├── ruzzle/index.html
    ├── pictionary/index.html
    ├── gameof15/index.html
    ├── neonwar/index.html
    ├── parole-arena/        # nuovo: Arena di parole (2–6 giocatori)
    ├── categoria-rush/      # nuovo: categorie a tempo (2–8 giocatori)
    ├── bomba-parole/        # nuovo: passa la bomba con le parole (2–6 giocatori)
    ├── palestra/            # UI mobile + logica + stili (vedi README dedicato)
    └── Pong/                 # index.html + css/ + js/
```

Ogni gioco vive nella propria cartella. L'hub punta a `games/<nome>/index.html`.
Regole, architettura, dati e test dei tre giochi nuovi: [GAMES.md](GAMES.md).
Piano di lavoro e audit: [PIANO.md](PIANO.md).

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
2. Aggiungi il path in `GAME_PATHS` (e il nome leggibile in `NOMI_GIOCHI`)
3. Aggiungi la configurazione in `GIOCHI_CONFIG` (nome, icone, opzioni, modalità, min/max giocatori)

Dalla pagina del gioco, il ritorno alla home è `../../index.html`.

Se il gioco ha una **sala condivisa** (invito, pronto, countdown, risultati, rivincita) usa gli
impianti in `games/shared/` e metti `faw: true` nella sua voce di `GIOCHI_CONFIG`: l'hub costruisce
allora la partita con `FAWRoom.buildMatch` e la lista partite ne legge lo stato reale. Copiare a mano
la forma del documento è ciò che ha reso opachi `neonwar` e `gameof15`.

## Configurazione Firebase

La config Firebase sta in **un solo file**: `games/shared/firebase-config.js`.
È uno script browser classico (non un modulo ES) che espone `window.FAW_FIREBASE_CONFIG`.

- Pagine **compat** (`index.html`, ruzzle, pictionary, gameof15, palestra):
  includono `games/shared/firebase-config.js` (o `../shared/firebase-config.js`)
  **prima** dello script che chiama `firebase.initializeApp(firebaseConfig)`.
- **Pong** (Firebase modulare): `games/Pong/index.html` carica lo stesso file prima di
  `js/main.js`; `games/Pong/js/firebase-config.js` è solo un adapter che ri-esporta
  la config come modulo ES e fornisce `isFirebaseConfigured()`.

Per cambiare progetto Firebase basta modificare `games/shared/firebase-config.js`.

Le sfide multiplayer usano Firestore (`partite` o una collection dedicata). Per i giochi “tipo Ruzzle” basta `gioco: 'mio-gioco'` nel documento `partite` e il link `games/mio-gioco/index.html?matchId=...`;
i giochi con sala condivisa invece creano il documento con `FAWRoom.buildMatch` (stessa forma letta dal
gioco, niente copie divergenti).

## Come si testa

```bash
npm ci

# Regole pure dei nuovi giochi (nessun browser, nessuna rete)
npm run test:unit

# Multiplayer: contesti browser separati contro un relay finto in memoria
npm run test:faw:chromium          # oppure: npm run test:faw

# Test UI palestra (Playwright + Chromium/WebKit)
npx playwright install --with-deps chromium webkit
npx playwright test tests/gym
```

I test `tests/faw/*` avviano da soli `tests/support/faw-relay.js` (porta 8090): serve gli
statici e implementa un mini-Firestore (`get/set/update/transact/query/watch`, con CAS
ottimistico), quindi **nessun test scrive sul progetto Firebase reale**. Per provarlo a mano:
`npm run relay` e poi
`http://127.0.0.1:8090/games/parole-arena/?net=relay&url=http://127.0.0.1:8090&nome=ALICE`.

Se un browser non è installabile nella tua ambiente (a volte succede con WebKit) i test
girano solo su Chromium: va dichiarato nei risultati, non dato per superato.

## Palestra mobile

La palestra mantiene gli account e i dati esistenti, con una nuova esperienza mobile, modalità focus e salvataggio locale prima della sincronizzazione. Dettagli, verifiche e limiti: [games/palestra/README.md](games/palestra/README.md).

Test UI: `npm ci`, `npx playwright install --with-deps chromium webkit`, `npm run test:gym`. Non è necessario npm per pubblicare o utilizzare il sito statico.
