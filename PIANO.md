# Piano di lavoro — tre nuovi giochi + redesign premium

Stato: **in corso**. Questo file è il piano operativo derivato dall'audit del commit `db225e6` (main = merge PR #14, palestra già rifinita e presente nel checkout).

## 1. Audit (eseguito)

| Area | Cosa è stato verificato | Esito |
|---|---|---|
| Struttura | `index.html` (hub 2026 righe), `games/<nome>/`, nessun bundler, Firebase compat 10.7.1 via CDN | Confermato: HTML/CSS/JS vanilla + Firestore, Pong usa anche RTDB |
| Hub | `GAME_PATHS`, `GIOCHI_CONFIG`, `partite` collection, `pronti/finito/rivincita*`, listener presenze/amicizie/partite | Flusso sfida: doc `partite` con `stato: attesa → in_corso → conclusa` + `prossimaPartita` per la rivincita |
| Ruzzle | `loadDictionary()` carica `../../dizionario.txt`, normalizza (`NFD` + remove accent + `[^A-Z]`), `MIN_WORD_LENGTH=4`, trie per i prefissi, RNG `cyrb128`+`sfc32` seedato da `opzioni.seed`, `LETTER_POOL`, adiacenza 8-direzioni, punteggio per lunghezza (4→1, 5→2, 6→3, 7→5, 8+→11) moltiplicato bonus cella | Riusato come base; **non** copiati: `localStorage.clear()`, polling 500 ms, dedup solo locale |
| Dizionario | 286 314 parole, una per riga, minuscole | Unico dizionario usato anche dai nuovi giochi |
| Multiplayer giochi | `partite/{matchId}` + `onSnapshot`, `db...update({['punteggi.'+nome]})` | **Nessuna transazione**: ultimi-scrittori vincenti. I nuovi giochi usano `runTransaction` |
| Pictionary | Collezione separata `pictionary_rooms`, polling 5 s nel hub | Non toccato |
| Palestra | `games/palestra/` con `premium.css`, 42 test Playwright, chiavi `gym-data-v2:*`, `gym-theme`, `gym-timer` | **Esclusa dal redesign** (verificata sola assenza di regressioni) |

## 2. Debiti confermati (da correggere)

1. `index.html:1757 logout()` → `localStorage.clear()`: cancella anche `gym-data-v2:*`, `paroliere_data`, `gameof15_save`, `df_legends_save`. → Sostituire con rimozione mirata delle chiavi di sessione.
2. `GIOCHI_CONFIG.gameof15.modalita` espone **EMOJI 😀**, ma `games/gameof15/index.html:772` dichiara «niente immagini predefinite, niente modalità emoji» → opzione inesistente. Allineare.
3. Autenticazione custom: `hashPassword(SHA-256)` + confronto lato client su `utenti/{NOME}`. **Correzione**: Firebase Authentication *è attiva nel progetto* (`authDomain` in `games/shared/firebase-config.js`), ma nessuna pagina del sito chiama l'SDK Auth (verificato con grep su tutto il repo: zero occorrenze) → `request.auth` è `null`, e nel repo non c'è alcuna regola Firestore per `utenti`/`partite` (esiste solo `games/Pong/database.rules.json` per RTDB). Ora `FAWNet.ensureSignedIn()` (opt-in, default spento) + campo `authUid` nei documenti rendono possibile legare le regole all'uid senza rompere i giochi esistenti. Rischi documentati; non dichiarata risolta.
4. Nessuna `firestore.rules` versionata nel repo → presumere quella di produzione è impossibile. Vengo forniti rules di partenza + nota esplicita.
5. Persistenza: chiavi sparse e non namespaces, `cacheKey` condivisi tra giochi → nuovi dati dietro prefisso `faw:<gioco>:<utente>:...`.

## 3. Architettura condivisa (nuova, senza framework)

```
games/shared/
  faw-design.css   design system (token + componenti, prefisso .faw-, scope su body.faw-scope)
  faw-core.js      storage namespaces, toast/dialog, clock offset, id, audio/motion prefs
  faw-net.js       trasporto dati: backend Firestore + backend "fake" test, transazioni, throttling
  faw-words.js     dizionario (stesso di Ruzzle), normalizzazione, trie, adiacenza, ricerca sequenze
  faw-room.js      macchina a stati partita condivisa: invito → lobby → countdown → gioco → risultati → rivincita
  faw-categorie.js dataset categorie/risposte controllato (per Categoria Rush)
```

Regole d'oro:

- Logica di gioco in **moduli UMD**: caricati come `<script>` nel browser e `require()` nei test Node → unit test veri, senza build.
- **Mai** scrivere su Firebase per ogni frame/tasto: scritture aggregate e throttled; `runTransaction` per punteggi/passaggi bomba/chiusura round.
- Scadenze **assolute** (`startAt`, `endsAt`, `resolveAt`) in tempo stimato del server, mai timer locali indipendenti.
- Operazioni idempotenti per parola/risposta (determinazione ID, set di parole già usate) → doppi tocchi e retry non duplicano punti.
- Limite dichiarato: validazione restando client-side; **non** è anti-cheat né autorità server. `firestore.rules` riduce i danni, non elimina il problema.

## 4. Fasi

1. **Fondamenta**: design system, core, net, words, room + fix critici (logout, gameof15).
2. **Parole in Arena** — griglia trascinata, 2–6 giocatori, 180 s, energia + eventi (~25 s) + 3 potenziamenti.
3. **Categoria Rush** — 2–8 giocatori, round simultanei, validazione su dataset controllato, bonus originalità/rapidità.
4. **La Bomba delle Parole** — bomba a turni, miccia assoluta condivisa, sequenze garantite dal dizionario.
5. **Redesign portale**: hub (accesso, amici/presenza, sfide, storico, statistiche, impostazioni) + rifinitura giochi esistenti (palestra esclusa).
6. **Test e rifinitura**: unit (Node), integrazione multiplayer con contesti browser separati su backend fake, axe, viewport, regressione palestra.

## 5. Rischi principali

| Rischio | Mitigazione |
|---|---|
| Nessuna autenticazione reale → chiunque può scrivere punteggi | transazioni + regole Firestore documentate; limite dichiarato apertamente, non promesso "bulletproof" |
| Limiti documento Firestore (1 MB) con parole/round | array capati, scritture aggregate, payload minimi, test su partite complete |
| `onSnapshot` a raffica | throttling in `faw-net.js` (batch 700–1500 ms per gioco), zero scritture in drag |
| Break delle modifiche ai giochi esistenti | redesign chirurgico + test regressione + palestra mai linkata al nuovo CSS globale |
| Clock skew tra client | offset stimato verso `serverTimestamp`, animazioni locali separate dalle decisioni |
| Sandbox senza browser/CDN | Chromium ottenuto da pacchetto npm + libs estratte a mano: test reali multi-contesto su backend fake locale; Firestore reale e dispositivi fisici restano da verificare |

## 6. Stato di avanzamento (2026-09-08)

Dettaglio completo in [GAMES.md](GAMES.md). Qui cosa è fatto, cosa no, e cosa resta fuori dal verificabile.

| Fase | Stato | Note |
|---|---|---|
| 1. Fondamenta (`faw-design.css`, `faw-core.js`, `faw-net.js`, `faw-words.js`, `faw-room.js`) + fix critici | **fatta** | `logout()` non cancella più i salvataggi; «Emoji» rimossa dal Gioco del 15 in `GIOCHI_CONFIG`; `showStatsTab` non dipende da `event`. Debito (c)/(d) **non** risolto (Auth: `ensureSignedIn()` pronto ma spento di default; regole: bozza in `docs/`), documentato in GAMES.md §5 e §7 |
| 2. Parole in Arena | **fatta** | 2–6 giocatori, 120/180/240 s, griglia 4/5/6, energia, 3 potenziamenti, eventi da seed, ranking discreto, risultati + rivincita. 6 test multiplayer/solo |
| 3. Categoria Rush | **fatta** | 2–8 giocatori, round simultanei, dataset controllato (12 categorie oggettive + 5 creative), bonus originalità/rapidità, reveal, classifica, rivincita. 5 test |
| 4. La Bomba delle Parole | **fatta** | 2–6 giocatori, miccia assoluta non azzerabile, sequenze garantite dal dizionario, parola invalida = nessun passaggio, esplosioni con penalità, offline non blocca. 8 test |
| 5. Redesign portale/hub | **parziale** | Fatta l'integrazione reale dei tre giochi (card, `GIOCHI_CONFIG`, `GAME_PATHS`, `NOMI_GIOCHI`, `creaPartitaDaBanner → FAWRoom.buildMatch`, lista partite con stato reale, `partiteCache` per gioco) e i fix di igiene. **Non** rifatti: amicizie/presenza, impostazioni, schermate di storia/statistica dei giochi nuovi (i dati ci sono in `risultati` e `statistiche`, manca il rendering), né le rifiniture visive dei giochi esistenti oltre al necessario |
| 6. Test e rifinitura | **in corso** | Eseguiti: 80 unit + 24 Playwright su Chromium (una passata è risultata 23/24 per il test Arena «potenziamenti», mai più riprodotto; da allora due passate complete verdi + 13/13 su chromium-desktop per Bomba e hub). Da fare: axe-core integrato come spec, Safari/WebKit (binario non installabile qui), prova su dispositivi reali |

Fuori scope deciso: territorialità in Arena (v1 = solo parole), negozi/valute/progressioni, nessun servizio a pagamento o AI. Palestra: nessun intervento (verificata l'assenza di regressioni sui suoi 42 test).

Consegna: `git commit` fatti su `arena/01a081ce-faw`; **`git push` non possibile da qui** (token di autenticazione non valido: va riconnesso GitHub lato Arena) e nessuna PR aperta.

