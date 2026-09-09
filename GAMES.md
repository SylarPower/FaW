# Rush e La Bomba delle Parole

Aggiornamento e verifiche: **9 settembre 2026**. Sito statico, nessun build necessario.

**Parole in Arena è stato rimosso**: sorgenti, card, registrazione nell’hub e test dedicati.
I suoi eventuali documenti storici su Firestore non sono stati cancellati; l’hub non li mostra più
come inviti, né li scambia per partite Ruzzle.

## Categoria Rush

`games/categoria-rush/` — 2–8 giocatori in contemporanea, oppure allenamento locale.

### Regole e ritmo

La durata scelta è un **massimo**, non un'attesa obbligatoria: il numero di round resta
lo stesso anche quando si consegna in anticipo. La modalità precedentemente chiamata
«Classico» ora si chiama **Sprint** in interfaccia; il suo ID `classiche` resta compatibile.

| Modalità | Scrittura massima | Voto massimo | Confronto massimo | Opzione 2 min / 3 min |
|---|---:|---:|---:|---|
| Sprint | 26 s | — | 4 s | 4 / 6 round |
| Creativo | 26 s | 7 s | 5 s | 3 / 4 round (massimi effettivi 1:54 / 2:32) |
| Nomi, Cose, Città | 50 s | — | 10 s | 2 / 3 lettere diverse |

- **Tutti hanno consegnato?** L'ultimo invio chiude la scrittura nella stessa transazione:
  non si aspetta il countdown e non si altera `startAt`. Sprint passa al confronto,
  Creativo al voto, NCC al confronto delle schede.
- **Passo** in Sprint/Creativo è definitivo e vale zero. Le risposte rifiutate restano invece
  correggibili fino alla chiusura. Il quorum comprende i partecipanti, **non solo chi è online**:
  un assente non viene espulso per accelerare il round; alla scadenza si prosegue comunque.
- **Creativo:** un solo voto irrevocabile verso un'altra risposta ammessa, oppure **Mi astengo**.
  Quando tutti gli elettori che hanno almeno un candidato hanno finito, si assegnano subito
  i punti. Senza candidati il voto viene saltato. 40 punti per partecipare, 100 per voto ricevuto.
  In due, se entrambi rispondono, l'unico voto possibile è reciproco; resta possibile astenersi.
- **Pronto, avanti:** durante il confronto, quando tutti sono pronti si passa subito al round
  successivo o ai risultati. Il timer rimane una via automatica di avanzamento, non un blocco.
- **Punti Sprint:** 100 base, 0–40 velocità, 60 se unica / 15 in due / 0 in tre o più.
  Il bonus velocità usa **sempre i 26 secondi nominali**, anche con chiusura anticipata.
  Le varianti previste dal dataset contano come la stessa risposta.
- In Sprint/Creativo gli spareggi restano punti → uniche → tempo medio delle risposte valide;
  se coincidono è pareggio. Un tempo mancante è `null`, non zero o `Infinity` salvato su Firestore.
- Allenamento disponibile per **Sprint e NCC**, con gli stessi reducer del multiplayer e senza
  scritture di partita in rete. In Sprint le alternative si sbloccano solo dopo consegna/stop.

### Nomi, Cose, Città: una vera scheda

ID `nomi-cose-citta`, selezionabile sia dal setup del gioco sia dal banner delle sfide nell'hub.

- **3 categorie:** Nomi, Cose, Città.
- **6 categorie:** le precedenti più Animali, Mestieri, Frutta.
- Una sola lettera per tutta la scheda e per tutti i giocatori. Estrazione deterministica
  dal seed, **senza ripetizioni nella partita**, fra lettere con almeno due risposte canoniche
  distinte in **ciascuna** categoria selezionata. Nessun cambio delle categorie Sprint.
- Il pulsante diventa **Stop! Ho finito** quando tutte le caselle sono valide. La prima scheda
  completa e consegnata lascia **al massimo 10 s** agli altri, senza mai allungare il limite
  iniziale di 50 s. Una seconda chiamata non sposta lo Stop. Se tutti consegnano, anche questa
  finestra termina subito.
- **Consegna parziale:** si possono lasciare caselle vuote; le caselle compilate ma non ammesse
  vengono segnalate per correzione o cancellazione. Una consegna definitiva non si modifica.
- **Scadenza:** viene sigillata l'ultima bozza confermata dal backend. Caselle vuote, errate o
  non salvate valgono zero; una risposta non confermata non viene spacciata per consegnata.
- **Punti per categoria:** 20 se sei l'unico con una risposta valida, 10 se la tua è diversa,
  5 se condivisa, 0 se vuota/non valida. **Niente bonus velocità. A pari punti è pareggio**,
  anche se il numero di uniche o i tempi differiscono. In solo ogni casella valida vale 20.
- Dopo lo stop, confronto per categoria tramite pulsanti e tabella compatta (non sei colonne
  schiacciate su mobile). A fine partita, schede personali consultabili round per round,
  conteggio delle parole valide e dei secondi d'attesa risparmiati.

Ogni casella ammette 3–40 caratteri. I nomi possono essere maschili o femminili; le città italiane o estere **elencate**. Cose indica
oggetti materiali, non animali, alimenti o concetti. Gli alias sono espliciti, non derivati da
un taglio automatico delle parole: per esempio frigo/frigorifero contano insieme; Sandro e
Alessandro non vengono unificati. Il controllo è sugli **elenchi locali non esaustivi**,
non una valutazione universale della correttezza della parola.

### Fonti consultate e adattamenti

Consultate il 9 settembre 2026. Non esiste qui la pretesa di un unico regolamento ufficiale:
le varianti pubblicate differiscono e FaW dichiara le proprie scelte.

1. **NomiCoseCitta.net, regole carta e penna:** scheda simultanea, stessa lettera su tutte le
   categorie, lettere già usate escluse, primo finisher e punti 20/10/5/0. Questa versione
   prevede una chiusura di **20–30 s**, non 10 s. [1](https://www.nomicosecitta.net/regole/)
2. **MI GAMES, Sport Edition 2020, finale carta e penna in videochiamata:** sei categorie,
   **10 s** dopo il primo foglio completato. È il riferimento per lo Stop breve di FaW.
   La finale originale usa 10/5/0 e non ha un limite iniziale per lettera; le fasi online
   precedenti usano invece sei lettere in 360 s e punteggi per percentuali di risposte.
   Non abbiamo importato quei punteggi o confuso le due fasi.
   [2](https://tour.migames.it/mi-games-livethehome/nomi-cose-e-citta-regolamento/)
3. **Regole della versione online NomiCoseCitta.net:** confini espliciti delle categorie,
   utili per un controllo comprensibile invece di un giudizio opaco. FaW differisce:
   ammette città estere elencate e varianti di genere esplicite nei mestieri, anziché
   limitarsi ai comuni italiani e alla formulazione maschile singolare.
   [3](https://www.nomicosecitta.net/regole-gioco-online/)

**Scelte specifiche FaW:** 50 s massimi di scrittura, 10 s massimi di confronto, formati 3/6
categorie, 2/3 lettere per pausa, chiusura quando tutti hanno consegnato, Passo, astensione,
autosave e consenso di tutti per saltare il confronto. Sono adattamenti per il portale,
non regole attribuite indistintamente alle fonti.

### Architettura e affidabilità

`js/regole.js` espone funzioni pure, condivise da transazioni multiplayer e allenamento:

- `impostazioni` / `tempiPartita` / `fasePartita`: seed, modalità, round e timeline adattiva.
  `rush.tempi[i]` memorizza durate **relative** di scrittura/voto/confronto, eventuale Stop e
  partecipanti del round alla chiusura dell'input. Non cambia la durata dei round già chiusi;
  i campi assenti mantengono i limiti nominali dei documenti precedenti. `endsAt` segue il
  nuovo limite, `durata` resta nominale per preservare il numero di round.
- `rispostaPatch`, `votoPatch`, `avantiPatch`: guard su partecipazione, fase e indice catturato,
  invio/voto/consenso unico, con eventuale avanzamento nello **stesso commit**. Patch `rush`
  consolidate, senza combinare una chiave antenata con discendenti in conflitto su Firestore.
- `bozzaPatch`: revisione intera crescente, round e finestra corretti, niente aggiornamenti
  dopo consegna o chiusura. `nomi-cose-citta.js` contiene dataset, validazione delle caselle,
  lettere fattibili e calcolo puro dei punti per categoria.
- `avanza`: risolve una sola volta tutti i round dovuti, anche dopo una scheda sospesa;
  salva punti, dettagli, statistiche e classifica finale atomicamente. Le adesioni successive
  alla chiusura non allungano retroattivamente il quorum di voto/confronto.

Il controller conserva i payload d'invio, blocca doppi tap e limita a tre i tentativi
**applicativi** (il trasporto/SDK può effettuare propri retry). Un retry non sposta una parola
nel round seguente. Le risposte di transazione non riportano indietro snapshot più recenti.

L'editor `js/scheda.js` mantiene i campi DOM stabili. Autosave dopo **550 ms** di inattività,
all'uscita da un campo, quando la pagina si nasconde e negli ultimi istanti utili; una scrittura
in volo, revisioni monotone e accorpamento delle modifiche successive. Una conferma vecchia
non sostituisce una digitazione più recente. Copia di recupero in `sessionStorage`, chiave per
partita/seed/round/giocatore, al massimo 8 copie: ripristinabile al reload della stessa scheda,
non una promessa di salvataggio permanente dopo la chiusura del browser. La UI distingue
salvataggio in corso, confermato o fallito, con retry manuale. La copia locale **non assegna punti**
finché non arriva in tempo nel documento condiviso.

Il ticker da 150 ms anima timer/barra; il resto del DOM cambia per fase/round, input o snapshot,
con HTML memoizzato. Nessuna scrittura per fotogramma; le bozze sono debounced, gli avanzamenti
hanno guard in-flight e backoff. Su mobile timer NCC visibile durante lo scorrimento, campi
con invio da tastiera al successivo, controlli grandi, modulo nascosto durante il confronto.

Rush non usa il dizionario generale: `shared/faw-categorie.js` mantiene le 12 categorie Sprint
(con almeno 4 canoniche distinte per combinazione) e le 5 domande creative. Il modulo NCC ha
elenchi e copertura separati. Ora si consultano e si propongono aggiunte da
[Lessico](lessico/index.html); per modifiche alla base rieseguire integrità, fattibilità e scoring; le liste restano non esaustive. Tema chiaro/scuro, reduced
motion e annunci delle fasi sono disponibili in tutte le modalità.

## La Bomba delle Parole

`games/bomba-parole/` — 2–6 giocatori, difficoltà facile/media/dura e durata 2/3/4 minuti.

- Scrivi una parola italiana di **4–24 lettere** contenente la sequenza mostrata: con `TRA`,
  per esempio, `STRADA` è valida. Le parole già dette nella partita non si ripetono.
- Un passaggio valido vale 10 punti, più 5 da 8 lettere. **Non riavvia la miccia.**
  Un errore non sottrae punti e consente un nuovo tentativo.
- La miccia dura 45/35/25 secondi a seconda della difficoltà. Barra, etichetta, icona e vibrazione
  comunicano la tensione, senza audio, senza mostrare un countdown numerico della miccia.
- Esplosione: −100 al possessore, nuova sequenza e pausa di 2 secondi. Durante la pausa
  nessuno può passare. La partita termina al limite temporale, alle tre esplosioni totali
  o al limite di round previsto dal documento. Non c’è eliminazione anticipata.
- Chi risulta offline viene saltato senza penalità, senza spostare la scadenza della miccia.

### Correzioni principali

La pagina ora carica **Firebase app compat, Firestore compat e config condivisa**, prima del
trasporto e del controller. L’ingresso legge correttamente `{exists, data}` da `FAWNet.get`
e conserva il codice intero, comprese maiuscole/minuscole degli ID Firestore. Accetta anche
il link completo e distingue sala mancante, piena, scaduta, conclusa o relativa a un altro gioco.

Il dizionario deve essere pronto prima di creare round: niente sequenze di ripiego senza parole.
Caricamento HTML/HTTP fallito ed elenco vuoto producono una schermata di errore recuperabile.
Gli indici sono lazy; il pool delle sequenze è in cache, ma **ogni seed ottiene il proprio campione**.
I conteggi considerano parole distinte di lunghezza giocabile, non occorrenze ripetute nella stessa parola.

Passaggi e scadenze sono ricontrollati dentro le transazioni. Il controller conserva parola e round,
riconosce un passaggio già confermato dopo un acknowledgement perso e limita i retry. Le esplosioni
non vengono marcate come elaborate prima della scrittura riuscita, quindi un errore di rete non
congela il gioco. Round incompleti o timestamp non validi non accettano passaggi né penalità.

L’ordine tra fine partita ed esplosione è esplicito: se la partita scade prima della miccia non
si assegna una penalità tardiva; altrimenti si risolve prima l’esplosione. La chiusura salva
**anche l’ultima penalità** nella classifica. Il conteggio delle parole usa i passaggi cumulativi,
non lo storico limitato alle ultime voci. L’allenamento è avviabile dal setup e ripetibile dai risultati.

Riparati i token CSS inesistenti e il layout desktop che confinava l’intero gioco in mezza pagina.
Resta una disposizione mobile in flusso, con input utilizzabile a 320 px e viewport ridotta.

## Hub: inviti e notifiche

La causa della moltiplicazione era l’accodamento di ogni **snapshot completo** agli array esistenti.
Ora ogni snapshot sostituisce i contenitori dei giochi e usa l’ID reale del documento per deduplicare.
La query separata di Pictionary non viene cancellata dall’aggiornamento degli altri giochi.

Listener, polling Pictionary, storico e heartbeat hanno cleanup su logout, riavvio della sessione e
`pagehide`. Le risposte asincrone di una sessione vecchia vengono ignorate. Il polling non parte
in parallelo con se stesso. La creazione di una sfida ha un guard contro il doppio tap.
Gli inviti conclusi cambiano stato nella stessa riga; quelli eliminati spariscono. Gli allenamenti
Rush/Bomba nell’hub portano direttamente a `?solo=1`.

## Lessico, audio e Ruzzle

Il collegamento **Lessico e proposte** dal portale e dai giochi apre
[`lessico/index.html`](lessico/index.html): ricerca, iniziali, varianti/canoniche,
provenienza, CSV, copertura, proposte e storico. Il dizionario generale è pigro nella
biblioteca; le categorie non richiedono di scaricarlo.

La base comprende **286.303 parole** generali (da 4 lettere), **1.467 voci Sprint** e
**1.358 voci NCC**, incluse le varianti e senza deduplicare tra categorie. Le liste
sono state ampliate con voci selezionate, ma non sono esaustive. Rapporto riproducibile:
`node scripts/copertura-lessico.js --check` → `lessico/copertura.json`.

Gli utenti possono proporre aggiunte, varianti ed esclusioni: **unanimità del gruppo
(2–8), 7 giorni, un no motivato chiude la proposta**, nessun reset dei voti al doppio tap.
Ultimo voto, pubblicazione e audit sono atomici; le partite conservano uno snapshot
degli overlay. Le pubblicazioni valgono per **nuove partite**, non per correggere
retroattivamente classifiche. Le proposte precedenti di Ruzzle restano in sola lettura.

Ruzzle usa il parser condiviso, non più una cache basata sulle lunghezze. Conteggio e
parole mancate sono in Worker annullabile: QU, miglior percorso bonus, risultati parziali
espliciti. Consegna e verifica sono protette da transazioni. È stato rimosso **tutto
l'audio dei giochi**, comprese sintesi, preferenze, controlli e ticchettio; restano
feedback visivi e vibrazione indipendente.

Architettura, limiti, dati, istruzioni e rilascio: **[docs/LESSICO.md](docs/LESSICO.md)**.
L'approvazione resta cooperativa: senza UID verificati e regole/backend appropriati
non è una moderazione autenticata. Nessun permesso live è stato dato per verificato.

## Componenti condivisi

| File | Responsabilità |
|---|---|
| `faw-core.js` | Identità del portale, storage, RNG, normalizzazione, vibrazione, dialog e utility. |
| `faw-design.css` | Token e componenti limitati alle pagine dei giochi; corretta la specificità delle varianti dei pulsanti. Non caricato dalla palestra. |
| `faw-net.js` | Trasporti Firestore compat e relay locale, operazioni e transazioni, listener, offset stimato dell’orologio. `FieldValue` è sul namespace compat, non sull’istanza DB. Le transazioni sui documenti esistenti aggiornano solo la patch, preservando i campi nativi non toccati. |
| `faw-room.js` | Documento di sala v2, partecipazione, pronto, countdown, heartbeat, recupero host e rivincita. Avvio minimo in due; entrare non equivale a dichiararsi pronti. `resolveOnce` applica effetto e claim atomicamente. Le rivincite simultanee convergono sullo stesso ID e usano un nuovo seed. |
| `faw-words.js` | Dizionario condiviso con Ruzzle, caricamento coalescente e indici lazy per prefissi, lunghezze e sequenze. |
| `faw-categorie.js` | Elenchi e alias espliciti, overlay per snapshot, combinazioni fattibili in cache. |
| `faw-categorie-aggiunte.js` | Ampliamento curato della base; nomi propri separati dalle parole comuni. |
| `faw-lessico.js` | Pubblicazione unica, proposte/consenso/audit, snapshot e compatibilità legacy. |
| `faw-lessico-link.js` | Un collegamento/contatore alle revisioni per pagina, cleanup in uscita. |

`firebase-config.js` rimane la fonte unica della configurazione. Non sono state modificate o
distribuite regole Firestore, né cancellati dati live. `docs/firestore-suggerite.rules.txt` è una checklist per staging e identità/permessi,
non un file di regole da distribuire né una configurazione di sicurezza già applicata.

### Limiti da non confondere con garanzie server

Le transazioni proteggono la coerenza tra **client cooperanti**, non costituiscono un sistema
anti-cheat. I payload e l’identità nominale del portale restano client-side. Le risposte Rush sono
nascoste nell’interfaccia durante l’input, ma un client che legge il documento può ispezionarle.

I timestamp sono assoluti e l’offset è stimato da RTT/relay e dalle proprie scritture Firestore
con `serverTimestamp` confermato. Questo **non è tempo autorevole del server** e non elimina lo
skew prima di un campione o una latenza elevata. Un backend autorevole servirebbe per convalidare
identità, tempi, contenuti e punteggi contro client alterati.

## Verifica riproducibile

```bash
npm ci
npm run test:unit
npx playwright install --with-deps chromium
npm run test:faw -- --project=chromium --project=chromium-desktop
npm run test:gym:chromium -- --workers=1
```

`playwright.faw.config.js` avvia il relay locale su porta **8090**. Ogni giocatore ha un contesto
browser separato. `tests/support/firebase-compat.js` è uno shim rigoroso dello SDK compat
servito al posto del CDN in alcuni test: esercita davvero il ramo Firebase di `FAWNet`, con CAS
sul relay, senza contattare il progetto reale. Non sostituisce una verifica di SDK/regole in staging.

Il relay mantiene dati solo in memoria. Su un’anteprima con hostname remoto usare `?net=fake`;
la scelta è ricordata per quell’origine. `?net=firebase` torna al backend di produzione.
Per una demo locale senza accesso al portale:

```bash
npm run relay
# http://127.0.0.1:8090/lessico/index.html?net=fake
# http://127.0.0.1:8090/games/categoria-rush/index.html?solo=1&net=fake
# http://127.0.0.1:8090/games/categoria-rush/index.html?solo=1&mode=nomi-cose-citta&colonne=6&net=fake
# http://127.0.0.1:8090/games/bomba-parole/index.html?solo=1&net=fake
```

Per mostrare il catalogo: `FAW_PREVIEW_PATH="/lessico/index.html?net=fake" npm run relay`.
Per mostrare Rush come pagina iniziale del relay: `FAW_PREVIEW_GAME=categoria-rush npm run relay`.
`CHROMIUM_PATH` permette di usare un eseguibile Chromium già installato, senza modificare WebKit.

### Risultati di questa revisione

| Verifica | Esito |
|---|---|
| Unitari: regole, dizionario, lessico, solver, room e contratto trasporto | 122/122 |
| Browser FaW, Chromium 390×844 + scenari 320 px / tastiera ridotta | 61/61 |
| Browser FaW, Chromium desktop 1280×800 | 61/61 |
| Regressione palestra, Chromium | 42/42 |
| Axe: Rush, NCC e Lessico, chiaro/scuro, reduced motion | Nessuna violazione nei controlli WCAG A/AA eseguiti |
| Screenshot ispezionati | Setup, scrittura, ricevuta, confronto e risultati Rush; scheda e confronto NCC a 320 px; Bomba mobile/desktop; Lessico mobile/desktop |

Le suite includono inviti ripetuti/cancellati, doppio tap, 2–8 dispositivi, ricarica e risposta
in volo al cambio round, retry esauriti, catch-up dopo tutti i round, voti, pause, esplosioni,
classifiche, rivincite, codici misti, SDK bloccato, errori dizionario e modifica dei percorsi ascoltati dal relay.
I nuovi scenari verificano ultima risposta/voto/Avanti atomici, Passo/astensione, Stop NCC,
bozze fuori ordine, reload con modifiche ancora locali, retry esauriti, timeout, parità sui
punti, 8 consegne concorrenti e allenamento senza scritture. Dopo gli ultimi ritocchi al
layout NCC sono stati rieseguiti anche i 6 controlli di concorrenza/viewport/axe interessati.

Il ciclo Lessico aggiunge 14 scenari per progetto: pubblicazione simultanea in tre, rifiuto
motivato, estranei, rollback multi-documento e conflitti su sole letture (relay e shim),
CSV/caricamento pigro, snapshot, Worker/QU/annullamento, errori di dizionario, archivio
legacy e risultati Ruzzle immutati, consegna/verifica idempotenti, retry del voto e cleanup.
Scansione automatica di sorgenti e asset conferma l'assenza delle funzioni audio.
I 12 tentativi di contesa coprono otto readiness simultanee più heartbeat; 12 riesecuzioni
aggiuntive dei casi Sprint/8 giocatori sono passate dopo la correzione. Il collegamento
Lessico resta fuori dall'area di gioco, senza spostare il confronto in basso.

Palestra: nell'ultimo ciclo il primo passaggio è stato 41/42 per un rilievo intermittente
di contrasto nell'editor (file palestra non modificati). Il caso è passato in 3 ripetizioni
isolate e la successiva suite completa è passata 42/42. Il rilievo resta documentato,
non è stato nascosto disabilitando controlli axe.

Controllati anche 37 file JavaScript, 2 script inline, rapporto di copertura e `git diff --check`.
Log locali dell'ultima verifica: `/tmp/faw-lessico-unit-final.log`,
`/tmp/faw-lessico-e2e-final.log`, `/tmp/faw-lessico-gym-recheck.log`.

**Non verificati:** Safari/WebKit (download del browser non riuscito nell’ambiente), dispositivi
fisici, regole/permessi del Firebase di produzione. Nessun deploy o test con scritture live eseguito.
