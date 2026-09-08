# GymTracker · esperienza mobile

La palestra rimane una pagina statica, senza build applicativa. Dal portale FaW si apre `games/palestra/index.html`, mantenendo l'identità `mioNome` e i documenti esistenti `gym_users/{mioNome}`.

## Flussi

- **Allenamento**: scheda suggerita (prima una giornata con serie in corso; altrimenti la prima non allenata nella settimana), accesso a tutte le giornate, conteggio settimanale. Non è un calendario né una raccomandazione fisiologica.
- **Schede**: creazione, duplicazione, riordino accessibile con pulsanti, eliminazione confermata, import/export e fase del programma.
- **Giornata**: riepilogo leggibile e pulsante di avvio. L'editor è separato dietro “Modifica scheda”.
- **Sessione focus**: una serie alla volta, ripetizioni e carico, pulsanti +/- da almeno 44px anche a 320px, selezione delle serie, correzione, elenco esercizi, timer recupero e cronometro.
- **Progressi**: sessioni registrate e conteggi; volume pianificato in un pannello secondario, esplicitamente indicativo.

Niente gestione di immagini, GIF, video, anteprime remote o confetti. Il logo applicativo esistente rimane come favicon. Le illustrazioni SVG del volume sono opzionali e renderizzate all'apertura del pannello; le icone UI sono SVG locali. Chart.js viene scaricato solo aprendo un grafico con dati sufficienti, con fallback in caso di errore.

## File

- `index.html`: struttura, dialoghi, template SVG ereditato.
- `base.css`: stili delle funzioni preesistenti mantenute.
- `premium.css`: sistema visuale mobile-first, layout, safe area, focus e temi.
- `app.js`: logica schede/sessioni, import/export, archivio esercizi.
- `cargo-art.js`: 21 illustrazioni SVG originali + scena iniziale, locali e statiche.
- `workout-metrics.js`: incrementi per attrezzo, percentuale sulle serie, calcolo del volume e report “Il trasloco impossibile”.
- `premium.js`: navigazione mobile, presentazione riepiloghi, accessibilità, persistenza e adattamento delle funzioni legacy. Ordine di caricamento: **`app.js` → `cargo-art.js` → `workout-metrics.js` → `premium.js` → `initGym()`**.

Font di sistema, niente framework o processo di build per pubblicare. Pubblicare tutti i file della cartella, non soltanto l'HTML.

## Salvataggio e compatibilità

- Copia locale per utente in `localStorage['gym-data-v2:' + mioNome]`, con dati, indicatore modifiche pendenti e baseline cloud.
- Ogni modifica viene copiata localmente prima della sincronizzazione. Scritture cloud serializzate con snapshot immutabili: un input durante una richiesta non viene perso.
- “Sincronizzato” compare soltanto dopo conferma del cloud. In assenza di rete vengono mostrati lo stato locale e il comando Riprova.
- Senza cache e senza lettura cloud riuscita **non viene generata una scheda vuota da salvare sopra quella esistente**.
- Una divergenza rilevata durante lettura/riconnessione richiede una scelta esplicita tra copia locale e cloud. L'uso in più finestre è segnalato.
- `activeSession` conserva giornata e inizio sessione; i valori e le spunte rimangono sulle serie. La durata comprende anche il tempo trascorso durante una pausa fuori dall'app.
- I nuovi log aggiungono `sessionId`, `duration` e `volumeKg` per esercizio; i vecchi log rimangono leggibili (raggruppamento per giornata/minuto quando manca un ID sessione).
- Una sessione parziale archivia **solo** le serie completate. La finalizzazione è idempotente nella sessione aperta e il doppio tocco su conferma è filtrato.
- Export testo del programma: TAB; liste per-serie separate da `/` per conservare carichi e ripetizioni differenti. È un export **delle schede**, non un backup completo dello storico. Compatibili anche import con `;`, carichi con virgola decimale e formati precedenti. Limiti: 1 MB, 1000 righe, 1–100 serie per esercizio; errori prima di applicare i dati.

### Limiti da non confondere con garanzie

Questa modifica non introduce una PWA o un service worker: il recupero locale protegge i dati, ma **non garantisce l'avvio a freddo dell'intero sito senza rete**. Il timer recupero sopravvive al rallentamento dei callback grazie a una scadenza assoluta, non a una ricarica completa della pagina; l'inizio e le serie della sessione invece vengono recuperati. Il browser può sospendere timer/vibrazioni a schermo bloccato.

La sincronizzazione conserva l'architettura preesistente a documento singolo. La verifica della baseline non è una transazione distribuita: editing simultaneo da più dispositivi non è garantito, e lo storico resta soggetto al limite di dimensione del documento Firestore. Per garanzie multi-device servono revisioni transazionali e sessioni in una subcollection. Anche `localStorage` può essere cancellato dal browser o dall'utente; non è un backup remoto.

L'identificazione tramite `mioNome` è quella del portale, non un nuovo sistema di autenticazione. Non sono state modificate o validate le regole di sicurezza Firestore di produzione.

## Verifiche ripetibili

Dalla root:

```sh
npm ci
npx playwright install --with-deps chromium webkit
npm run test:gym
# Solo Chromium
npm run test:gym:chromium
```

Il runner può avviare il server statico di test su 8080 o riutilizzarne uno esistente. Per un eseguibile Chromium locale impostare `CHROMIUM_PATH`. Dipendenze npm utilizzate solo per i test, non dal sito.

### Eseguite in questa modifica (2026-09-08)

**42 test superati in Chromium headless 143**, con viewport smartphone e API Firestore simulate: nessuna scrittura sui dati di produzione.

Copertura:
- 320/360/390/430px, viewport ridotto, orientamento orizzontale, assenza di overflow;
- onboarding, creazione, aggiunta esercizi, ricerca vuota e navigazione;
- sessione completa/parziale, conteggi, correzione serie selezionata, navigazione, doppio tocco;
- validazione numerica, corpo libero, recupero, superserie, cronometro;
- reload con cloud assente, SDK assenti, ritorno online, conflitti, memoria locale piena, scritture pendenti;
- import ostile reso come testo, limiti di import, round-trip per-serie, export, grafico non disponibile;
- axe-core WCAG A/AA per le viste principali, editor e importazione, in entrambi i temi: nessuna violazione automatica rilevata nelle viste testate;
- focus dei dialoghi, Escape, dimensioni dei comandi focus, movimento ridotto;
- geometrie dell’intestazione, centri delle etichette, allineamento e ingombri degli input, testo al 200%, report in entrambi i temi e numeri molto grandi;
- incrementi manubri nei pulsanti, nelle progressioni e nel riferimento ai valori precedenti; percentuali basate sulle serie e completamento fuori ordine;
- volume di sessioni complete/parziali, corpo libero, soglie delle equivalenze, conservazione dei kg nello storico;
- sintassi JS, ID HTML univoci, `git diff --check`, audit npm senza vulnerabilità rilevate.

### Ancora da verificare prima di definirla “bulletproof”

- WebKit/Safari: progetto test predisposto, **non eseguito nel sandbox** perché il download dei browser Playwright non era disponibile. Chromium è stato ottenuto separatamente per eseguire realmente la suite.
- Dispositivi fisici iPhone/Android: tastiera decimale italiana, notch, zoom testo, VoiceOver/TalkBack, interruzioni telefoniche, ritorno da schermo bloccato, consumo batteria.
- Integrazione con Firestore reale in un ambiente di staging e relative regole; sincronizzazione concorrente multi-device, limiti di storage e documenti molto grandi.
- Accessibilità manuale e tutte le combinazioni delle funzioni avanzate ereditate (grafici reali, fasi, superserie con gruppi numerosi, import di fogli esterni).

## Prossime evoluzioni da valutare

1. PWA installabile con cache versionata per avvio realmente offline e icona dedicata.
2. Autenticazione Firebase, regole per utente, sessioni indipendenti e sincronizzazione transazionale.
3. Calendario intenzionale della scheda del giorno, distinto dal semplice suggerimento attuale.
4. Sostituzione rapida di un esercizio quando un attrezzo è occupato, mantenendo la scheda originale.
5. Annullamento esplicito dell'ultima serie e backup completo dei dati con ripristino.

## Incrementi, avanzamento e report finale

- I manubri usano **±2 kg** sul carico registrato, anche nel gestore delle progressioni (senza suggerimenti basati su punteggi). Gli altri attrezzi mantengono ±2,5 kg. Il testo dei comandi e della guida è coerente; l’inserimento manuale resta possibile. Il limite inferiore è 0 kg. Le riduzioni percentuali di scarico restano percentuali, non incrementi.
- Riconoscimento tramite attrezzatura del catalogo; fallback sul nome/ID degli esercizi personalizzati o importati se il catalogo non identifica un attrezzo noto. Non si deduce un attrezzo da nomi ambigui privi di metadati.
- La percentuale in sessione è **serie completate / serie previste**, con 100% soltanto a scheda interamente completata. Rimane visibile a 320 px; passare a un altro esercizio non la modifica. Alla chiusura parziale conserva la percentuale realmente raggiunta.
- Report **“Il trasloco impossibile”**: volume cumulativo, durata, serie, esercizi allenati e percentuale. Consegne assurde da valigie e pianoforti fino a un T-rex o un tram, senza media remoti o animazioni.
- Formula: somma di **ripetizioni × carico inserito** per le sole serie completate. Non vengono raddoppiati automaticamente i manubri o i lati; non si stima il peso corporeo. Il metodo è esplicitato in un pannello espandibile.
- I riferimenti di peso dei paragoni sono **illustrativi**, non specifiche tecniche o affermazioni su un modello reale. Le quantità di oggetti sono arrotondate per difetto. Sotto 20 kg non si forza alcuna equivalenza; a carico zero si valorizzano le ripetizioni.
- Il report fotografa i dati **prima** di azzerare le spunte. I nuovi log conservano il volume dell’esercizio, sommato anche in Progressi. Per i vecchi log senza `volumeKg` non viene mostrato un totale retroattivo potenzialmente errato.

## Rimozione RPE e atlante illustrato

L’RPE è stato rimosso da input, editor, guida, validazione, nuove serie, esportazione e calcoli del volume pianificato. I suggerimenti automatici che ne dipendevano sono stati eliminati: “Ultima volta” mostra soltanto i dati registrati, con un pulsante per riutilizzarli senza decidere automaticamente aumenti o diminuzioni.

La normalizzazione elimina il campo ritirato dalle serie e dai log caricati, senza cambiare carichi, ripetizioni, note o spunte. Il nuovo export ha 10 colonne e termina con TEMPO / NOTE. Gli import con intestazione individuano NOTE dal suo nome, ignorando le colonne ritirate; le vecchie righe senza intestazione a 11 colonne mantengono le note in ultima posizione.

Il report comprende **21 livelli**, di cui 14 entro 15.000 kg, e una scena dedicata per sessioni a corpo libero o sotto la prima soglia. Ogni livello ha la propria illustrazione: valigia, pinguino, arcade, robot, pianoforte, orso, rover, auto, rinoceronte, camper, elefante, T-rex, autobus, UFO, navetta, tram, balena, castello, razzo, stazione orbitale, base lunare. L’atlante espandibile mostra tutti i riferimenti e contrassegna quello della sessione. È una rappresentazione giocosa del volume, **non un invito ad aggiungere serie per sbloccare livelli**.

Le immagini sono disegni SVG originali incorporati nel bundle statico, non immagini remote o media gestiti per esercizio. Nessun download aggiuntivo all’apertura del report. I 42 test comprendono la migrazione dei dati legacy, import dei due formati, assenza di RPE dalle schermate, soglie/illustrazioni distinte per tutti i 21 livelli e accessibilità dell’atlante nei due temi.

### Configurazione CI disponibile

`tests/gym/github-workflow.example.yml` contiene una configurazione Actions pronta per Chromium e WebKit, **non attiva**. Il push iniziale del workflow è stato rifiutato perché la connessione GitHub App non dispone del permesso `workflows`. Un manutentore con i permessi adeguati può copiarla in `.github/workflows/gym-ui.yml`. Non sono stati disabilitati controlli preesistenti. In questa sessione sono stati eseguiti i 42 test Chromium locali, non WebKit/CI; una simulazione WebKit non sostituisce comunque i controlli su iPhone fisico.
