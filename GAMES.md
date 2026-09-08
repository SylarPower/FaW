# Giochi multiplayer FaW — regole, architettura, dati, test

Documento di consegna per le tre modalità nuove e per gli impianti condivisi che le
reggono. Scritto per chi deve mantenere il codice: ogni affermazione qui sotto è
verificabile nel repository (file + test), e i limiti sono elencati con la stessa
cura dei risultati.

Stato: **tre giochi funzionanti e integrati nell'hub**, con test automatici.
Non è "a prova di tutto": vedi [Limiti noti](#limiti-noti).

---

## 1. Come si avvia e come si testa

```bash
npm ci                      # due sole devDependency: @playwright/test, @axe-core/playwright
npm run serve               # relay di sviluppo: statici + finto Firestore in memoria (porta 8090)
npm run test:unit           # regole pure, senza browser né rete    (node --test)
npm run test:faw:chromium   # test multiplayer, chromium             (Playwright)
npm run test:faw            # tutti i project (chromium, chromium-desktop, webkit)
```

- Il sito è statico: non c'è build. Aprire `index.html` (o `games/<gioco>/index.html`)
  da un server qualsiasi.
- I test **non toccano il progetto Firebase reale**: usano `tests/support/faw-relay.js`,
  un server Node che serve i file statici e implementa un mini-Firestore in memoria
  (`/api/get`, `/api/write` con CAS optimisitico, `/api/query`, `/api/watch` long-poll,
  `/api/reset` per l'isolamento dei test). Ogni spec mette `faw:net:backend=fake` in
  localStorage prima del caricamento.
- Ogni giocatore è un **contesto browser separato** (`browser.newContext()`), mai una
  simulazione in pagina: la sincronizzazione passa davvero per la rete.
- WebKit in questa sandbox non è installabile (i binari non si scaricano): i test
  girano su Chromium e Chromium-desktop. **Safari/iOS restano da verificare su device.**

## 2. I tre giochi

Tutti e tre: partita da 2–4 minuti, regole in una schermata, rivincita con un tap,
mobile-first, nessuna dipendenza da servizi a pagamento o AI.

### 2.1 Parole in Arena (`games/parole-arena/`)

Griglia condivisa, stessi 5×5 (o 4/6) lettere per tutti, selezione a trascinamento
(44 px di bersaglio, con alternativa tap-sequenza), vicinato comprese le diagonali, ogni
cella una sola volta per parola, minimo 4 lettere, dizionario del progetto.

- Punteggio: `2 × lunghezza` (×3 da 8 lettere), +4 da 6 lettere, bonus cella
  speciale +5/+6, bonus evento +6. Parola conta **una sola volta per giocatore**.
- Energia: +1 per parola valida, +2 extra per le parole da 7 lettere, massimo 10.
- Potenziamenti (3, costi diversi, effetto breve e non letale):
  Raddio (4 → ×2 sulle prossime 3 parole o 12 s), Scudo (3 →免疫 a una sabbiatura),
  Sabbiatura (5 → il bersaglio perde solo i bonus evento/cella per 10 s, **le sue
  parole restano valide e i punti non vengono tolti**). Nessun concatenamento sullo
  stesso bersaglio (`immune`/`ultimoBersaglio`).
- Evento ogni ~25 s (3 tipi: riga/colonna bonus, lettera jolly, doppia parola),
  derivato **dal seed** (`seed + ":evento:" + k`) → zero scritture, mai una lettera
  che cambia sotto al dito.
- Ranking live discreto, feed dei traguardi altrui senza mostrare le parole.
- Risultanze: classifica, parole valide, più lunga, miglior rimonta (solo se la
  curva ha ≥ 4 campioni), statistiche personali, rivincita.

### 2.2 Categoria Rush (`games/categoria-rush/`)

Stessa lettera + stessa categoria per tutti, round brevi simultanei (26 s di input +
rivelazione), 2–8 giocatori, 2–3 minuti.

- Punteggio: 100 di base (validità) + bonus velocità fino a 40 (`40·(1−t/26 s)`)
  + bonus originalità 60 se la risposta è unica, 15 se siete in due, 0 se in tre o più.
- **Il dizionario non basta** per giudicare l'appartenenza a una categoria: servono
  liste ammesse. `games/shared/faw-categorie.js` contiene 12 categorie oggettive con
  735 risposte (con `varianti` per i duplicati canonici e `noDict` per nomi/città,
  dove il dizionario comune non è il criterio) e 5 categorie creative `tipo:"votazione"`.
- Le combinazioni lettera/categoria sono scelte con un vincolo di fattibilità:
  **almeno 4 risposte ammesse** per round (`CAT.pickCombo`), e nessun
  `categoria:lettera` ripetuto nella partita. Le domande derivano dal `seed`.
- Normalizzazione condivisa (`norm` = minuscole, accenti rimossi, non-lettere via):
 ricevuta esplicita, risposta **definitiva** per round, duplicati penalizzati,
  classifica con tie-break punti → uniche → tempo medio → nome.
- Modalità creativa (voto tra pari): round 26 s + 7 s di voto + 5 s di rivelazione;
  punteggio `40 + 100/voti`; il round **si chiude anche senza voti**; non tocca e non
  blocca la modalità classica (nessun campo `rush` in comune, UI di voto assente nel classico).

### 2.3 La Bomba delle Parole (`games/bomba-parole/`)

Si passa la bomba con una parola italiana che **contiene** la sequenza mostrata
(con `TRA` valgono STRADA e TRAMONTINA; RETE no), 2–6 giocatori, 2–4 minuti.

- La miccia **non si azzera mai al passaggio**: `bomba.round.inizioAlle + micciaMs`
  è l'unica scadenza, identica per tutti. Fine round = esplosione o fine partita.
- Parola non valida → la bomba **non passa** e non perdi punti: i motivi sono
  distinti (senza sequenza / non italiana / già detta in partita / troppo corta /
  numeri o spazi) e si può riprovare subito.
- Parola già usata **in tutta la partita**: vietata (`bomba.usate`).
- Esplosione: −100 a chi la tiene, si resta in gioco, round nuovo con sequenza nuova.
  La partita finisce al tempo scelto o alla terza esplosione totale.
- Il tempo residuo **non è scritto**: barra + colore + icona + parola
  (calma → tiepida → calda → fervente → critica) e ticchettio opzionale.
  L'audio non veicola nessuna informazione essenziale e si spegne dal topbar.
- Chi è offline non blocca il giro: dopo `CFG.offlineMs` la bomba passa al successivo
  **presente** senza penalità per l'assente (`bomba.saltati`), e la miccia non si sposta.
- Sequenze garantite dal dizionario: `FAWWords.sampleSequences` con `minWords`
  (120 / 45 / 25 a seconda della difficoltà) e verifica in test → nessun round
  impossibile. La sequenza del round viene scritta nel documento (una scrittura per
  round), quindi tutti vedono la stessa domanda anche arrivando in ritardo.
- Layout: il blocco bomba sta **in cima al flusso** (niente barre ancorate in basso) e
  la viewport usa `interactive-widget=resizes-content`: aprendo la tastiera il blocco
  non si sposta (assertito in test a 320 px).

## 3. Impianti condivisi (`games/shared/`)

| file | cosa fa |
|---|---|
| `faw-design.css` | token `--faw-*`, componenti (topbar, card, bottoni, lista, badge, HUD, timer, dialog, toast, skeleton), accento per gioco con `body[data-game]`, `prefers-reduced-motion`, breakpoint piccoli. **Mai** selettori globali, mai collegato dalla palestra. |
| `faw-core.js` | utente, localStorage a chiave `faw:*` con `clearSession()` mirata, id corti, hash/rng deterministici, normalizzazione testo, formati tempo, `escapeHtml`, suono/vibrazione (solo dopo il primo gesto), toast/dialog, `keepInputVisible`, `withRetry`, `onceGuard`. |
| `faw-net.js` | due backend (Firestore compat e relay finto) con la stessa interfaccia: `get/set/update/add/del/transact/onDoc/onCol`, ops `arrayUnion|arrayRemove|increment|delete`, `clock()` con offset stimato dal server, presenza a heartbeat, `detectBackend()` (`?net=`, `faw:net:backend`, host `LOCALI` → relay). |
| `faw-words.js` | dizionario del progetto (`dizionario.txt`, stessa via di Ruzzle), trie/indici, `isWord/hasPrefix/scoreForLength`, griglie, adiacenze, `sequenceCount/sampleSequences/wordsContaining/checkWord`. |
| `faw-categorie.js` | dataset locale estendibile di categorie/risposte per Rush (`valida`, `pickCombo`, `copertura`, `rispostePer`). |
| `faw-room.js` | sala: `buildMatch`, macchina a stati `attesa → pronto → in_corso → (chiusura) → risultati → conclusa` (+ `annullata`), `canMove`/`isStale`, `open()` con scritture aggregate e coda con re-queue, `transact`, `resolveOnce`/`once` (operazioni idempotenti per chiave), `markReady`, `maybeStart`, `addPlayer/removePlayer`, `claimHost`, `inattivi`, `proposeRematch/acceptRematch/rejectRematch`, `archive`, `startWatchdog`, `durataMs`, `seedFrom`. |

Un gioco nuovo nasce con `FAWRoom.create` e ~150 righe di regole pure: la parte di
rete, rivincita, abbandono, presenza e watchdog è già risolta e già testata.

### 3.1 Autorevolezza del tempo (e cosa NON è)

- Ogni scadenza è un **timestamp assoluto stimato del server** (`FAWNet.clock()`):
  countdown, fine round, fine partita, esplosione. I timer locali **animano e basta**;
  le decisioni vengono prese dentro `transact`, quindi reload, tab in background o
  client in ritardo non cambiano l'esito.
- Le operazioni idempotenti usano chiavi deterministiche (`once("parola:ROCCA")`,
  `resolveOnce("rush:chiudi")`, `resolveOnce("bomba:espl:<round>")`) e il claim è
  rivendicabile dopo un TTL: doppio tocco, retry di rete e più client che arrivano
  insieme producono **un solo effetto**.
- Le scritture sono aggregate (max N parole / ogni 2,5 s in Arena; una per risposta
  in Rush e Bomba): **nessuna scrittura per fotogramma, per drag o per singolo tasto**.
- Limite dichiarato e non aggirabile qui: l'autorità è client-side con transazioni
  Firestore. Serve a garantire coerenza, non a impedire il cheating: chi modifica il
  proprio browser può falsare i punteggi. Un `functions/` (Cloud Functions) sarebbe il
  passo successivo, ed è l'unico modo di chiamare questo sistema "server-authoritative".

### 3.2 Casi gestiti (con test dove indicato)

doppio invio/duplicati · aggiornamenti tardivi o fuori ordine (`isStale`, guardie di
transazione) · reload a metà round/partita ✓ · disconnessione breve e rientro ✓ ·
host perso (`claimHost` + watchdog) ✓ · giocatori inattivi (avviso, mai rimozione) ✓ ·
stanza conclusa/scaduta (join rifiutato con messaggio) ✓ · fine simultanea (claim
unico) ✓ · pareggio (dichiarato in `esito`) ✓ · entrata a partita iniziata
(`entraInCorsa`, Bomba: eleggibile dal passaggio successivo) ✓ · rete lenta o interrotta
(scritture in coda, re-queue, chip «in attesa di conferma») ✓ · retry idempotenti ✓.

## 4. Integrazione con l'hub (`index.html`)

- `GAME_PATHS` + `NOMI_GIOCHI`: i giochi nuovi hanno percorso ed etichetta leggibile
  (i nomi interni non compaiono più nei banner).
- `GIOCHI_CONFIG`: tre voci con le **opzioni che i giochi implementano davvero**
  (Arena: durata+griglia e modalità arena/solo-parole; Rush: durata e modalità
  classiche/creative; Bomba: durata + miccia, una sola modalità — niente etichette
  decorative). `faw: true` marca i giochi nati con la shared room.
- `creaPartitaDaBanner` per `faw:true` costruisce il documento con
  `FAWRoom.buildMatch` (gli script condivisi sono caricati nell'hub solo per questo:
  nessun CSS, nessun tema applicato) → la forma del documento non può divergere dal gioco.
- `renderTutteLePartite` instrada per `gioco` e `renderPartitaFAW` mostra stato reale
  (`in attesa (1/2)`, `sta per cominciare`, `in gioco`, `finita · 2°`) con ENTRA /
  RISULTATI 🗑️.
- Debiti risposti: `logout()` non fa più `localStorage.clear()` (cancella sessione e
  chiavi `faw:*`, tiene `gym-*`, `paroliere_data`, `gameof15_save`, `df_legends_save`,
  `funatwork_daily_stats`, `ultimo_*`) ✓ test; tolta la modalità «Emoji» dal Gioco del 15
  (il gioco non la implementa) ✓ test; `showStatsTab` riceve il pulsante dall'alto, non
  dall'`event` globale ✓ test. Palestra: nessun intervento su UI, logica o dati.

## 5. Dati e config Firebase

- Progetto usato dai giochi esistenti: `funatwork-cd237`, configurazione unica in
  `games/shared/firebase-config.js` (nessuna duplicazione, nessuna chiave nuova).
- Collections usate: `partite/{id}` (tutti i giochi), `presenze/{NOME}`,
  `amicizie/{A}_{B}`, `utenti/{NOME}` (auth custom esistente),
  `pictionary_rooms/{codice}` (esistente, non toccata).
- Campi aggiunti dalle modalità nuove dentro `partite/{id}`: `arena{...}`,
  `rush{risposte,punteggiRound,rivela,statistiche,voti,roundChiuso}`,
  `bomba{round,roundIdx,possessore,usate,storico,passaggi,esplosioni,saltati,cronologia,sequences,finitaPer}`,
  più `opzioni{durata,mode,countdown,griglia,miccia,seed}`, `cfg.griglia`, `cfg.bomba`,
  `claim`, `startAt`, `endsAt`, `risultati`, `rivincitaDi`, `prossimaPartita*`.
- Nessun cambio di chiave o migrazione: i documenti dei giochi esistenti restano
  leggibili così come sono (i nuovi campi sono aggiuntivi e opzionali per i giochi vecchi).
- Indici: le query attuali usano un solo `array-contains` su `partite` (hub) oppure
  `==`/`in` su campi singoli (coda istantanea di Bomba), quindi **nessun indice
  composito nuovo è richiesto** (le liste vengono ordinate in JavaScript proprio per
  non dipendere da indici non ancora creati). Se si passerà all'ordinamento in query
  serviranno: `partite: gioco ASC, createdAt DESC` e
  `partite: partecipanti ARRAY, stato ASC, createdAt DESC`.
- Regole: **nel repository non esiste alcun file di regole Firestore** per
  `partite/presenze/amicizie/utenti`; l'unico file di regole presente è
  `games/Pong/database.rules.json` (Realtime Database, non toccato da questo lavoro).
  Cosa sia online davvero sul progetto `funatwork-cd237` non è verificabile da qui:
  `docs/firestore-suggerite.rules.txt` è un punto di partenza
  commentato, **non** una conferma di ciò che è online. Nota importante: con l'auth
  custom client-side (non Firebase Authentication) le rules non possono identificare
  l'utente, quindi non possono proteggere davvero le scritture: è il limite strutturale
  da risolvere prima di parlare di anti-cheat o di dati multi-tenant.

## 6. Test eseguiti (non "da eseguire")

| suite | cosa copre | esito |
|---|---|---|
| `tests/unit/*.test.js` (4 file) | 80 test: fondamenti (core, parole, categorie, design tokens), Arena (selezione, punteggio, energia, eventi, power-up, antimultipli, classifica, esito), Rush (normalizzazione, combinazioni, punteggi, duplicati, tie-break, creativo), Bomba (validità con dizionario reale, miccia, passaggio, idempotenza, esplosione, offline, classifica) | **80/80** |
| `tests/faw/arena.spec.js` | solo, flusso multiplayer completo invite→countdown→parole→risultati→rivincita, power-up con doppio tocco, parole giocate offline, griglie + evento a schermo piccolo, dialog regole/accessibilità | 6/6 su chromium |
| `tests/faw/rush.spec.js` | solo + opzioni, multiplayer con rivelazione e rivincita, giocatore inattivo, voto tra pari nel creativo, 320 px con tastiera | 5/5 su chromium |
| `tests/faw/bomba.spec.js` | allenamento, turno e passaggio tra due contesti, doppio tocco, esplosione condivisa e input tardivo, offline che non blocca, reload a metà round, risultati+rivincita, 320 px/overflow/tastiera/audio | 8/8 su chromium |
| `tests/faw/hub.spec.js` | config dei nuovi giochi e link, «crea sfida» → documento che il gioco apre, lista partite per stato, logout che conserva i salvataggi, tab statistiche senza `event` globale (shim `firebase` sopra il relay) | 5/5 su chromium |

Comandi di riproduzione: `npm run test:unit` e
`npx playwright test --config=playwright.faw.config.js --project=chromium tests/faw/`.

### Verifiche manuali/simulate da segnalare

- `chromium-desktop` (1280×800): **eseguito** su Bomba e hub (13 test verdi: layout,
  dialog, focus da tastiera, sfida dal banner) e in una passata precedente su Arena.
  **Non ancora eseguito** su Rush e sui suoi 5 test: da rieseguire dopo ogni modifica
  condivisa.
- Accessibilità verificata nei test: `prefers-reduced-motion` (animazioni spente — i test
  contano i giri di manciata e non il tempo reale),
  focus visibile sui bottoni, `aria-pressed` sui toggle, etichette sui campi, feedback
  mai solo cromatico, dialog con `showModal` e chiusura `Esc`. **Non** è stata eseguita
  una scansione automatica con axe-core sull'intera piattaforma (`@axe-core/playwright`
  è tra le devDependency ma non è ancora integrato in una spec: prossimo passo).
- Da fare su dispositivo reale: iOS Safari (apertura tastiera, safe area, `100dvh`),
  Android con tastiere Gboard/Swiftkey, rete 3G reale, audio on/off in vivavoce,
  landscape con notch.

## 7. Limiti noti

1. **Autorità client-side**: coerente e idempotente, non anti-cheat (vedi §3.1).
2. **Auth custom ≠ Firebase Authentication**: `passwordHash` in locale + letture/scritture su
   `utenti/{nome}`; nessun refresh token, nessuna regola affidabile. Va valutato un
   passaggio a Firebase Auth (o a Cloud Functions) prima di accettare dati sensibili.
3. **Regole Firestore non verificate**: non c'è un file di rules versionato per le
   collection usate; il draft in `docs/` va confrontato con la console del progetto.
4. **Dizionario**: 286 305 parole, niente sotto le 4 lettere, prestiti recenti e
   alcuni singolari assenti (`oca`, `bue`, `carpaccio`, `fax`…) → falsi negativi
   tollerati in Arena/Bomba (un «non è una parola» fastidioso ma non letale); Rush
   **non** lo usa per giudicare le categorie, e i suoi dati hanno un'eccezione
   documentata per categoria (`noDict`).
5. **Rush creativo**: il voto tra pari conta solo se qualcuno vota; senza voti il
   round assegnа 40 punti di partecipazione e niente bonus (per non bloccare mai la
   classifica). In a 2 giocatori i voti sono reciproci → stesso punteggio: è il
   comportamento dichiarato, non un bug.
6. **Bomba**: dopo l'esplosione il round riparte con una pausa fissa di 2 s; se tutti
   i giocatori sono offline la miccia non viene reclamata da nessuno (nessun client
   attivo = nessuna scrittura — ovvio, ma significa che la partita resta "aperta" finché
   non c'è un host vivo).
7. **Palestra**: fuori scope per richiesta; le uniche modifiche condivise che la
   sfiorano sono `logout()` mirata (la sua cache ora sopravvive al logout) e nessun
   altro intervento.

## 8. Prossime priorità

1. Cloud Functions (o un realtime server) per l'autorità reale + Firebase Auth: è il
   collo di bottiglia di 2, 3 e 1.
2. `firestore.rules` definitive + test delle regole (emulator suite) prima di aprire le
   scritture a più utenti.
3. Spec axe-core su hub + tre giochi (color contrast, label, ordine di tab) e run su
   Safari iOS/Android reale.
4. Rush: un dataset categorie più ampio (obiettivo 25–30 categorie oggettive) e
   import/export in un formato ispezionabile; oggi 12 + 5 creative.
5. Arena: territorialità solo come modalità separata e opzionale (decisione v1: non farla),
   più un "coach mode" per partite 1-contro-1 d'allenamento.
6. Storia/statistiche per新模式 nella pagina stats dell'hub (i `risultati` sono già
   nello shape che l'hub legge: manca solo il rendering dei tre giochi nel riepilogo).
