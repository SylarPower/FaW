# Focus at Work (FaW)

Portale giochi multiplayer per pause al lavoro.

## Struttura

```
FaW/
├── index.html              # Hub: login, sfide, statistiche
├── lessico/                # catalogo consultabile, CSV, proposte e storico
├── dizionario.txt          # Dizionario condiviso (Ruzzle/Bomba)
├── exercises.json          # Dati palestra
├── gym-icon.png
├── esercizi/               # Asset legacy (non usati dalla palestra)
├── tests/
│   ├── unit/               # regole pure dei nuovi giochi (node --test, niente browser)
│   ├── faw/                # Playwright multi-contesto su relay finto (Rush/Bomba/Ruzzle/lessico/hub)
│   ├── gym/                # 42 test regressivi della palestra (non toccati dal redesign)
│   └── support/faw-relay.js  # statici + mini-Firestore in memoria per i test
└── games/
    ├── shared/firebase-config.js   # Config Firebase condivisa (unica fonte)
    ├── shared/faw-design.css       # design system: token + componenti
    ├── shared/faw-core.js          # utente, storage, id, vibrazione, dialog, utils
    ├── shared/faw-net.js           # Firestore o relay fake: transazioni, clock, presenza
    ├── shared/faw-room.js          # sala: stati, invite, pronto, countdown, rivincita
    ├── shared/faw-words.js         # dizionario (stesso `dizionario.txt` di Ruzzle)
    ├── shared/faw-lessico.js       # snapshot e consenso atomico per pubblicare parole
    ├── shared/faw-categorie.js     # dataset categorie/risposte di Categoria Rush
    ├── ruzzle/index.html
    ├── pictionary/index.html
    ├── gameof15/index.html
    ├── neonwar/index.html
    ├── categoria-rush/      # categorie a tempo (2–8 giocatori)
    ├── bomba-parole/        # passa la bomba con le parole (2–6 giocatori)
    ├── palestra/            # UI mobile + logica + stili (vedi README dedicato)
    └── Pong/                 # index.html + css/ + js/
```

Ogni gioco vive nella propria cartella. L'hub punta a `games/<nome>/index.html`.
Rush include **Sprint**, **Creativo** e **Nomi, Cose, Città**, con chiusure anticipate e
schede NCC da 3/6 categorie autosalvate. Le durate sono massime: non si aspettano
secondi inutili dopo l’ultima consegna.

Regole, fonti degli adattamenti, architettura, dati e verifiche di Rush e Bomba: [GAMES.md](GAMES.md).
Piano di lavoro e audit: [PIANO.md](PIANO.md).

Parole in Arena è stato rimosso. Gli eventuali documenti storici restano su Firestore, ma
non sono più esposti come inviti o statistiche nell’hub.

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
la forma del documento è ciò che ha reso opachi i giochi nati prima di questi impianti.

## Configurazione Firebase

La config Firebase sta in **un solo file**: `games/shared/firebase-config.js`.
È uno script browser classico (non un modulo ES) che espone `window.FAW_FIREBASE_CONFIG`.

- Pagine **compat** (`index.html`, ruzzle, pictionary, gameof15, palestra, categoria-rush, bomba-parole):
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
`http://127.0.0.1:8090/games/categoria-rush/index.html?solo=1&net=fake`
(o `games/bomba-parole/index.html?solo=1&net=fake`).
Su un hostname di anteprima remoto usare `?net=fake`; il backend viene ricordato per quell’origine.
Per tornare a Firebase usare `?net=firebase`.

Alcuni test servono uno shim SDK compat e verificano anche il ramo Firebase del trasporto,
sempre sul relay: non sono una verifica dei permessi del progetto live.

Se un browser non è installabile nel tuo ambiente (a volte succede con WebKit) i test
girano solo su Chromium: va dichiarato nei risultati, non dato per superato.

## Lessico e contributi

Dal portale apri **[Lessico e proposte](lessico/index.html)**. Liste Sprint/NCC,
dizionario Ruzzle/Bomba, ricerca, varianti e CSV; aggiunte/esclusioni con unanimità
del gruppo e storico. Le pubblicazioni valgono solo per nuove partite.
Il dizionario generale è ampio, le categorie restano non esaustive.

Dettagli e limiti di sicurezza/rilascio: [docs/LESSICO.md](docs/LESSICO.md).
Tutti i giochi sono senza audio; Ruzzle esegue le analisi pesanti in un Worker annullabile.
Il catalogo base si verifica con `node scripts/copertura-lessico.js --check`.

## Palestra mobile

La palestra mantiene gli account e i dati esistenti, con una nuova esperienza mobile, modalità focus e salvataggio locale prima della sincronizzazione. Dettagli, verifiche e limiti: [games/palestra/README.md](games/palestra/README.md).

Test UI: `npm ci`, `npx playwright install --with-deps chromium webkit`, `npm run test:gym`. Non è necessario npm per pubblicare o utilizzare il sito statico.
