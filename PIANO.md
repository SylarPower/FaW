# Piano e audit della revisione

Aggiornato al **9 settembre 2026**. Questo documento sostituisce lo stato del precedente piano;
le vecchie dichiarazioni di completamento non sono usate come prova delle verifiche attuali.
Dettagli tecnici e comandi: [GAMES.md](GAMES.md).

## Richiesta

1. Correggere gli inviti/le notifiche che sembrano moltiplicarsi.
2. Eliminare **Parole in Arena**.
3. Migliorare drasticamente **Rush**, nella logica, struttura e UI/UX.
4. Riparare **La Bomba delle Parole**.
5. Eliminare le attese a risposte complete; ottimizzare il ritmo con riferimenti a regole pubblicate.
6. Aggiungere **Nomi, Cose, Città**, stessa lettera su una vera scheda multicategoria.
7. Rimuovere tutte le funzioni audio dei giochi.
8. Valutare/ampliare le liste, renderle consultabili e consentire proposte con approvazione.
9. Migliorare Ruzzle, soprattutto correttezza delle approvazioni e prestazioni.

## Interventi

| Area | Causa / intervento | Stato |
|---|---|---|
| Inviti | Gli snapshot completi venivano aggiunti agli array precedenti. Sostituzione per snapshot, deduplica per ID, query Pictionary separata e cleanup dei listener/timer. Guard su sfide simultanee e risposte di sessioni vecchie. | Implementato e testato |
| Rimozione gioco | Eliminati sorgenti, card, registrazione, tema e test di Parole in Arena. I documenti storici live non vengono cancellati e non riappaiono sotto altri giochi. | Completato |
| Rush, motore | Reducer puri condivisi tra allenamento e multiplayer. Risposta vincolata al round, invio unico, retry limitato, canoniche, voto definitivo, catch-up e risultati atomici. | Implementato e testato |
| Rush, interfaccia | Riscritti HTML, CSS e controller: setup leggibile, sala, fasi distinte, ricevuta, confronto in primo piano, classifica e dettaglio round; mobile, chiaro/scuro e reduced motion. | Implementato, testato e ispezionato |
| Rush, ritmo | Timeline relativa persistita; ultima risposta/voto/Avanti chiude nella stessa transazione. Passo e astensione; nessuna modifica a startAt o alla base del bonus velocità. | Implementato e testato |
| NCC | Schede da 3/6 categorie, 50 s massimi, Stop +10 s, 20/10/5/0, pareggi sui punti. Bozze revisionate, reload, timeout e confronto per categoria; setup, hub, solo e rivincite. Fonti e adattamenti dichiarati in GAMES.md. | Implementato e testato |
| Bomba, avvio | Mancavano SDK/config Firebase; ingresso interpretava male il risultato di `get` e troncava/alterava i codici. Riparati bootstrap, ingresso e recupero errore. | Implementato e testato anche sul ramo compat |
| Bomba, partita | Dizionario obbligatorio, sequenze indicizzate e campionate per seed; guard temporali, pausa, retry, esplosioni non congelate da errori; ultima penalità inclusa nei risultati. Allenamento e rivincita locale. | Implementato e testato |
| Trasporto/sala | Corrette API compat `FieldValue`, patch transazionali, avvio minimo in due, readiness, heartbeat, claim atomici e rivincite concorrenti; long-poll locale riavviato quando cambiano i percorsi. | Test unitari e browser |
| Test | Rimossi helper che riabilitavano i normali controlli di invio. Aggiunti regressioni specifiche, contratto Firebase compat e axe su Rush. | Eseguiti su Chromium |
| Audio | Rimosse implementazioni, chiamate, preferenze, UI e ticchettio. Feedback visivi/vibrazione mantenuti. Scansione regressiva su tutti i giochi. | Implementato e testato |
| Lessico | Biblioteca responsive, ricerca, pagine/CSV, 18 categorie + corpus pigro + spunti Creativo; copertura riproducibile e ampliamento curato. | Implementato e testato |
| Approvazioni | Gruppo 2–8, unanimità, 7 giorni, no motivato, richiesta/voti immutabili, audit conservato e pubblicazione atomica; risultati non riscritti. | Implementato e testato su relay e shim |
| Snapshot | Overlay congelati in partita, cache per contenuto, solo con fallback dichiarato; legacy preservato. | Implementato e testato |
| Ruzzle | Un solo flusso di proposte, parser condiviso, Worker annullabile con QU e migliori bonus, conteggi parziali dichiarati, consegna/verifica atomiche. | Implementato e testato |

## Evidenza corrente

- **122/122 test unitari** superati.
- **122/122 test browser FaW** superati: **61 scenari su Chromium mobile e 61 su desktop**,
  inclusi lessico/Ruzzle, pubblicazioni atomiche, snapshot, Worker, accessibilità, recupero,
  NCC, otto giocatori e inviti. Ulteriori 12 riesecuzioni dei casi di contesa/viewport passate.
- **42/42 test palestra** nella riesecuzione completa; nessuna modifica ai suoi sorgenti,
  test o dati. Primo passaggio 41/42 per un contrasto intermittente nell'editor, poi il
  caso isolato superato tre volte: anomalia documentata, non mascherata.
- Controlli axe su Rush/NCC e Lessico a 320 px, chiaro/scuro: nessuna violazione nei controlli eseguiti.
- Ispezione visiva di Rush/NCC/Bomba e della biblioteca; verifica di limiti DOM e CSV.
- 37 file JavaScript e 2 script inline controllati, copertura rigenerata e diff senza errori di whitespace.
- Nuovo test ricorsivo sui giochi: nessun motore/asset/controllo audio residuo.

Tutti i test usano relay/mocks locali. Il test di doppio tap Bomba usa un vero `dblclick`,
non due click Playwright concorrenti che possono attendere il turno successivo dopo il
corretto blocco del primo invio. Nessun browser è stato dato per testato solo perché presente
nella configurazione.

## Limiti e passaggi esterni a questa revisione

- Safari/WebKit e dispositivi fisici: da verificare; download browser non riuscito nel sandbox.
- Firebase di produzione: non sono state fatte scritture di test, migrazioni, eliminazioni
  di documenti o modifiche delle regole. Verificare permessi e configurazione in staging prima
  di una pubblicazione con regole diverse da quelle esistenti.
- La logica è client-side con transazioni e orologio stimato, **non anti-cheat/server-authoritative**.
  Per un’autorità reale servono autenticazione e validazione su backend, fuori da questo intervento.
- Gli elenchi di categorie Rush sono curati, ma non esaustivi: eventuali ampliamenti devono
  mantenere coerenti alias e conteggi delle combinazioni. Flusso e dati: [docs/LESSICO.md](docs/LESSICO.md).
- Le approvazioni del lessico non sono moderazione autenticata. Verificare nuovi permessi
  in staging e ricaricare i client Ruzzle precedenti, che contenevano i vecchi writer.

Non sono richiesti commit o push per conservare il lavoro della sessione. Nessun deploy è stato eseguito.
