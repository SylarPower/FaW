# GymTracker Pro · mobile-first

GymTracker resta una pagina statica: dal portale FaW apre `games/palestra/index.html`, riusando l’identità `mioNome` e il documento Firestore esistente `gym_users/{mioNome}`. Le correzioni precedenti per layout mobile, catalogo testuale, report numerico e salvataggio local-first restano attive.

## Programma personale (installazione esplicita)

Nella scheda **Schede** è disponibile **Aggiungi il programma personale**. L’azione aggiunge, senza sostituire schede, note o storico già esistenti, quattro giornate: **Push Final → Pull Final → Gambe Final → Upper Final**. Il cursore segue quest’ordine senza azzerarsi a fine settimana: dopo Pull è richiesto un giorno di riposo completo prima di Gambe; la sequenza si può riprendere dal giorno successivo. Se ci si allena tre volte, Upper slitta al successivo allenamento della settimana seguente. Le altre giornate di recupero si pianificano tra le sessioni; l’import è opzionale e nessun programma viene scritto automaticamente sul documento dell’utente.

Il preset contiene i carichi/range iniziali, le note tecniche, le superserie, gli esercizi di riscaldamento e le varianti sicure disponibili nel catalogo. Il profilo personale e le informazioni nutrizionali non vengono copiati nel codice, nella scheda o nei log.

### Regole implementate

- **Doppia progressione per esercizio**: il carico programmato sale dell’incremento specifico solo quando tutte le serie raggiungono il limite alto del range; nella sessione successiva si riparte dal limite basso. Gli esercizi marcati gomito/ginocchio richiedono inoltre due sessioni consecutive registrate senza fastidio per quell’articolazione. Per i dips: corpo libero fino a 3×12 senza fastidio, poi +2,5 kg e 8 ripetizioni; il gate del gomito resta obbligatorio.
- **Feedback di fine sessione obbligatorio**: fastidio gomito e ginocchio (No/Lieve/Sì), RPE finale 1–10 e note facoltative. L’RPE è a livello di sessione, non per serie; i campi RPE legacy per-set restano rimossi. Se si segnala dolore durante un esercizio protetto, l’esercizio può essere interrotto e le serie rimanenti saltate senza conteggiarle come volume.
- **Trigger di sicurezza**: dopo tre sessioni consecutive con fastidio al gomito/ginocchio l’esercizio interessato viene sospeso nel flusso e l’app mostra un suggerimento di variante. Per il Bulgarian è indicato lo step-up; se tira, la nota prescrive −2 kg prima di sostituirlo. La registrazione dell’app non sostituisce una valutazione clinica.
- **Ramp-up specifici**: panca inclinata DB, lat neutra, leg press, panca piana DB, Pendlay, RDL Smith e hip thrust. I carichi del ramp-up si ricalcolano in proporzione al carico effettivo, inclusi deload e rientro.
- **Ciclo a sessioni rotanti**: le quattro giornate si eseguono in sequenza continua (Push → Pull → Gambe → Upper) e la scheda è determinata solo dal numero di sessione, `resto = (numero_sessione − 1) % 4`. Tre sessioni in una settimana e due in quella successiva non cambiano nulla: si prosegue sempre dalla sessione dopo, e `launchSession()` blocca chi tenta una giornata fuori sequenza.
- **Deload automatico (dopo 12 sessioni, non a fine mese)**: il contatore progressivo delle sessioni completate decide quando scatta lo scarico, con `sessionsPerCycle = 16`: le sessioni 13-16, 29-32, 45-48 … sono in deload, una per scheda, poi il ciclo riparte normale. Se in una settimana si fanno solo due sedute, le restanti due di scarico si completano la settimana dopo. Il deload **non è opzionale**: il carico effettivo viene ridotto del 40% rispetto all’ultima sessione normale, viene tolta una serie per esercizio (minimo una), ripetizioni e recuperi restano invariati e i drop set non vengono aggiunti. I valori normali sono ripristinati dopo la sessione, quindi il deload non riscrive il carico-base.
- **Rientro dopo pausa**: oltre cinque giorni dall’ultima sessione completata in assoluto (non solo della giornata), −10% per quella sola sessione; poi torna il carico-base. Il riduttore si applica anche durante il deload, dove si somma al −40%.
- **Superserie**: le coppie indicate sono alternate. In Upper panca piana DB (A) e lat larga (B) non hanno recupero fra A e B; il timer parte dopo B per 90 secondi.
- **Drop set**: si aggiunge solo dopo l’ultima serie allenante; alzate laterali al cavo −40%. Sono esclusi durante il deload, dopo fastidio articolare nella sessione precedente e dopo un fastidio segnalato nella sessione corrente.
- **Volume**: il programma mostra il volume pianificato contro i tetti dichiarati e avvisa di sostituire invece di aggiungere vicino/al tetto. Le aggiunte programmate vengono proposte/applicate ai milestone configurati rispettando i limiti per gruppo. Sull’intero split a quattro giornate il preset ha **10 serie Core contro il tetto di 8**: compare un avviso conservativo e non vengono aggiunte altre serie Core finché non si riduce/sostituisce volume. In una settimana effettiva da tre sessioni il totale è inferiore perché Upper slitta al ciclo successivo.
- **Stallo/rotazione**: il riepilogo della giornata segnala stallo di quattro settimane (deload esclusi) e permanenza di dodici settimane sullo stesso esercizio.

Il contatore di ciclo vive in `D.st.cycleSessions` (default in `dSt()`), cresce di 1 a ogni sessione completata e non si azzera mai: né a fine settimana né a fine mese. Con il passaggio dalla logica settimanale a quella per sessioni il conteggio riparte da 1 per tutte le installazioni esistenti — la rotazione ricomincia da Push Final — mentre sessioni, storico e note restano intatti. La data di inizio (inizializzata al giorno dell’installazione e correggibile in **Schede → Fase del programma**) non guida più il deload: resta solo per la revisione del volume e per il vecchio mesociclo F1-F5.

Lo stato del ciclo è esposto prima di iniziare: hero in Home (`Sessione N · … · deload tra M sessioni`), card “Progressione e recupero” nella giornata, riepilogo di **Fase del programma** con le prossime quattro sedute e tile in **Progressi**. Nessuna scelta manuale della logica è prevista: con un tendine in recupero il deload obbligatorio non può dipendere da un interruttore.

## Flussi e usabilità

- **Allenamento**: riprende una sessione attiva, altrimenti propone la giornata successiva del ciclo personale o la scheda libera successiva.
- **Schede**: creazione, duplicazione, riordino accessibile, eliminazione confermata, import/export e gestione del programma personale.
- **Giornata**: riepilogo di range, carico, incremento, ramp-up, note e indicazioni di volume/sicurezza. L’editor resta separato.
- **Sessione focus**: una serie per volta, inserimento di ripetizioni/durata e carico, selezione/correzione set, lista esercizi, timer recupero e cronometro. La conferma è nella barra fissa, con target mobile e safe-area.
- **Progressi**: cronologia numerica, volume di sessione, durata, RPE e stato gomito/ginocchio. La mappa del volume pianificato è indicativa.
- Il catalogo resta solo testuale: niente video/immagini; nessun font remoto. Chart.js è richiesto solo quando si apre un grafico.

## File

- `index.html`: struttura e dialoghi; carica gli script nell’ordine `app.js` → `workout-metrics.js` → `training-program.js` → `premium.js`.
- `base.css` e `premium.css`: stili esistenti e interfaccia mobile.
- `app.js`: schede, sessioni, import/export e flusso base.
- `workout-metrics.js`: report, volume, step standard per schede libere e conteggi.
- `training-program.js`: preset non distruttivo, parametri per esercizio, progressioni, gate articolari, ciclo a sessioni (`getPersonalCycleState`, `isDeloadSessionNumber`, `recordCompletedCycleSession`), deload, rientro, drop set e revisione volume.
- `premium.js`: persistenza, navigazione mobile, rendering, feedback e accessibilità.
- `exercises.json`: catalogo testuale con gli esercizi custom usati dal preset.

## Salvataggio e compatibilità

- Cache locale per utente: `localStorage['gym-data-v2:' + mioNome]`; sincronizzazione sul documento Firestore già esistente.
- Ogni modifica viene salvata localmente prima del cloud; le scritture sono serializzate. Offline mostra lo stato e permette il nuovo tentativo.
- Senza cache e senza lettura cloud riuscita non viene creata una scheda vuota da salvare sopra quella esistente.
- Divergenze cloud/locali richiedono una scelta esplicita. L’installazione del preset conserva i giorni e i log presenti.
- `activeSession` salva copia-base e modifiche temporanee di deload/rientro; il report registra i carichi realmente usati prima del ripristino del piano.
- I log nuovi includono `sessionId`, `exerciseUid`, serie, carico, durata, flag deload/rientro; `sessionFeedback` conserva RPE e sintomi a livello di sessione. Vecchi log privi di questi campi restano leggibili.
- Export testuale TAB e import legacy restano disponibili; l’export è delle schede e non un backup completo di storico/feedback o dei metadati avanzati.

### Limiti e verifiche da mantenere espliciti

Questa pagina non introduce PWA/service worker; l’archiviazione locale non garantisce avvio a freddo offline. Il timer può essere sospeso dal browser a schermo bloccato. Il documento Firestore singolo non offre garanzie transazionali per editing concorrente multi-dispositivo; le regole Firestore reali non sono state modificate.

Non sono state effettuate scritture sui dati di produzione. La verifica automatica ripetibile dalla root è:

```sh
npm ci
npm run test:static
npm run test:gym:chromium
```

`npm run test:static` comprende la sintassi e i test unitari delle regole del preset. La suite Playwright verifica flussi mobile, report, feedback e installazione non distruttiva. In questo checkout il binario Chromium Playwright non era installato: il tentativo di eseguire la suite è quindi fallito prima del lancio del browser; non equivale a una regressione applicativa. Installare Chromium Playwright nell’ambiente CI prima della verifica end-to-end. WebKit/Safari e dispositivi fisici iPhone/Android restano da provare.
