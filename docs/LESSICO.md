# Lessico FaW

Aggiornamento: **9 settembre 2026**. Pagina utente: [`lessico/index.html`](../lessico/index.html),
raggiungibile dal portale con **Lessico e proposte** e dai tre giochi di parole.
Non richiede build né un servizio esterno di dizionari.

## Consultazione

- 12 liste Sprint, 6 liste NCC e il dizionario generale comune a Ruzzle/Bomba.
- Ricerca, filtro per iniziale, voce canonica/variante e provenienza base/pubblicata.
- Paginazione: massimo 60 righe del catalogo e 12 proposte nel DOM; elenco scorrevole
  anche da tastiera, layout da 320 px, tema chiaro/scuro.
- CSV dell'intera ricerca (non solo della pagina visibile), UTF-8 con separatore `;`.
- Il corpus generale, circa 3 MB, si scarica **solo su richiesta** nella biblioteca.
  Rush non lo scarica: usa le proprie categorie. Ruzzle/Bomba devono caricarlo per giocare.
- La sezione copertura elenca anche i 5 spunti Creativo: non hanno una lista chiusa di risposte.

### Dimensioni reali del catalogo base

| Lista | Voci ammesse | Canoniche |
|---|---:|---:|
| Dizionario generale, da 4 lettere | 286.303 | — |
| Parte del corpus utilizzabile in Bomba, 4–24 lettere | 286.301 | — |
| Sprint, somma delle 12 liste | 1.467 | 1.365 |
| NCC, somma delle 6 liste | 1.358 | 1.258 |

Le somme delle categorie **non sono parole globalmente distinte**: ci sono sovrapposizioni,
varianti e nomi propri. La grandezza del dizionario non garantisce che ogni parola sia
corrente o appartenga a una categoria. Gli elenchi sono giocabili, ma **non esaustivi**;
non abbiamo importato un corpus esterno non verificato né classificato automaticamente
centinaia di migliaia di parole.

Le aggiunte base selezionate sono in `games/shared/faw-categorie-aggiunte.js`. Per le parole
comuni è stata controllata la presenza nel corpus; nomi e città sono selezioni di nomi propri.
Alias espliciti evitano di contare, per esempio, melanzana/melanzane e sassofono/saxofono
come risposte diverse. Le canoniche esistono davvero nella rispettiva lista.

`lessico/copertura.json` riporta ogni categoria e le iniziali con almeno 4 canoniche. È una
metrica comparabile, non la promessa di giocare ogni iniziale: NCC applica anche la propria
soglia e l'intersezione tra le categorie scelte.

```bash
node scripts/copertura-lessico.js           # rigenera il rapporto base
node scripts/copertura-lessico.js --check   # verifica che sia aggiornato
npm run test:unit
```

## Come proporre e approvare

1. Accedi normalmente dal portale. Nella biblioteca scegli lista e una tua partita di parole
   con **2–8 partecipanti**. Può essere anche conclusa, ma non annullata.
2. Proponi **aggiunta**, **variante** (solo categorie) oppure **esclusione**. Motivazione
   obbligatoria; fonte HTTP(S) facoltativa. La variante deve indicare una canonica già ammessa.
3. Il gruppo dichiarato è unico e ordinato, fotografato al momento della proposta. Il proponente
   esprime già il suo sì. Gli altri vedono il contatore nei giochi e la scheda nelle revisioni.
4. Serve **unanimità entro 7 giorni**. Un assente non è un sì; basta un no motivato per rifiutare.
   Il voto è definitivo. Gli estranei al gruppo non votano attraverso le API dell'applicazione.
5. L'ultimo sì pubblica in **una transazione**. Il documento proposta conserva motivo, fonte,
   elettori, voti, date, esito e versione pubblicata. I listener non applicano modifiche.

Una sola proposta per **partita + lista + parola normalizzata**, indipendentemente dal tipo.
Doppio tap o ritrasmissione non azzerano voti né riscrivono la motivazione. Per ripresentare
una proposta chiusa occorre un'altra partita e un nuovo consenso.

Se cambia il gruppo o una modifica concorrente cambia la voce/canonica interessata, la
proposta diventa **superata**, anziché sovrascrivere una decisione più recente. Un aggiornamento
non correlato non blocca il consenso. Le scadenze sono valutate dall'orologio stimato:
lo storico mostra le scadute anche senza un processo in background; un tentativo di voto
le chiude anche nel documento. Nessun job/server periodico è necessario.

Un errore di scrittura non viene mostrato come approvazione: i controlli tornano riprovabili.
Il limite preventivo di 700 KB lascia margine rispetto a 1 MiB di Firestore; raggiungerlo
richiede partizionare il catalogo, non continuare ad accumulare dati senza limite.
Un aggiornamento NCC non può lasciare meno di 3 iniziali utilizzabili nei formati da 3/6 categorie.

## Dati e compatibilità

### `config/dizionario`

Resta il documento già usato da Ruzzle. Conserva `extra` e `excluded`; aggiunge:

- `base`: versione del catalogo distribuito;
- `versione`: revisione incrementata a ogni pubblicazione;
- `categorie`: overlay separati `sprint-<id>` e `ncc-<id>`, ognuno con `extra`, `excluded`, `varianti`;
- `aggiornato`: data della pubblicazione.

I campi legacy estranei alle patch vengono conservati. Non esiste un secondo dizionario
generale concorrente. Pubblicare in una categoria **non pubblica nelle altre liste**.
L'esclusione di una canonica nasconde anche gli alias dipendenti; escludere solo una variante
non elimina la sua canonica.

### `lessico_proposte/{id-deterministico}`

Contiene richiesta, fotografia degli elettori e della voce iniziale, voti, scadenza e audit.
Stati: `pending`, `published`, `rejected`, `expired`, `superseded`.
La transazione legge partita, proposta e catalogo; le versioni dei documenti di sola lettura
partecipano al controllo di conflitto. Scrive voto/esito/audit e catalogo insieme, **non i risultati**.
Le transazioni hanno un massimo di 12 tentativi di contesa, anche per le readiness simultanee.

### `partite/{id}.lessico`

Fotografia degli overlay approvati. Rush/Bomba la concordano nella transazione di avvio;
Ruzzle alla prima preparazione della sala. Tutti i partecipanti usano la stessa fotografia,
compresi quelli che rientrano. L'allenamento rilegge la pubblicazione prima di ogni nuova partita:
se non disponibile, indica esplicitamente l'uso della copia locale o della sola base.
Nessun documento partita viene scritto in allenamento.

Le pubblicazioni della comunità valgono quindi **solo per nuove partite**, mai a metà round.
Una partita già avviata prima di questa versione, senza snapshot, conserva la base e le
personalizzazioni già registrate nel suo `dizionarioCustom`; non è possibile ricostruire
retroattivamente tutte le versioni globali che aveva visto. I risultati conclusi non vengono
ricalcolati. Lo snapshot congela gli overlay, non una copia dell'intero file base: un futuro
aggiornamento dei file base va versionato e distribuito coordinando i client già aperti.

Le vecchie sottocollection Ruzzle `proposte` e `eliminazioni` **non vengono cancellate**.
La biblioteca le mostra in sola lettura per la partita selezionata (prime 100 voci);
“Ripresenta” prepara un nuovo modulo, senza importare automaticamente i vecchi voti.
I vecchi client già aperti prima del rilascio vanno ricaricati: contengono ancora i precedenti
writer. Per impedirli contro client non cooperanti servono regole/backend appropriati.

## Miglioramenti Ruzzle

- Un solo flusso per aggiunte/esclusioni; eliminati i due publisher automatici e il rifiuto
  che nascondeva soltanto un banner.
- Parser condiviso: controlla HTTP, rifiuta HTML/risposte vuote, coalescenza e recupero.
  Nessuna cache basata solo sulle lunghezze delle liste; un cambio di contenuto sostituisce
  gli overlay e invalida indici e Worker, comprese revoche di esclusioni.
- Trie e due ricerche pesanti in **Worker lazy**: conteggio (budget 700 ms), parole mancate
  (2.200 ms), annullamento/terminazione dei lavori obsoleti e cleanup in uscita.
  Niente ripiego a una DFS di 10–12 secondi sul thread dell'interfaccia.
- Q trattata come QU, nessun riuso di caselle, un risultato per parola e miglior percorso
  coi bonus tra quelli esaminati. Nessun troncamento arbitrario a 12 lettere.
- Conteggi incompleti preceduti da `≥`; analisi parziale dichiarata. “Hai trovato tutto”
  compare soltanto dopo una ricerca completa. Se Worker non disponibile, l'analisi lo dice
  e il gioco resta utilizzabile.
- Consegna e verifica protette da transazioni, nessun ricalcolo globale dei risultati conclusi;
  doppia fine non duplica la statistica locale. Il salvataggio finale fallito è riprovabile
  dalla pagina; non è un nuovo sistema di autosave Ruzzle attraverso chiusure del browser.

## Audio

Nessun motore, sintesi, beep/ticchettio, preferenza o pulsante audio nei giochi.
Conservati timer e feedback visivi; la vibrazione resta indipendente e rispetta riduzione
movimento/supporto/attivazione dell'utente. Non sono state rimosse funzionalità della palestra
che usano la parola “volume” per gli allenamenti.

## Sicurezza e rilascio

Questo flusso è **cooperativo, non moderazione autenticata**. L'identità del portale è ancora
il nickname; una transazione garantisce coerenza ma non prova chi ha votato né che una parola
sia corretta. Non sono stati introdotti ruoli di moderatore fittizi.

Prima di pubblicare, verificare in staging i permessi indicati in
[`firestore-suggerite.rules.txt`](firestore-suggerite.rules.txt): lettura del catalogo,
query sui propri gruppi/elettori, transazioni partita/catalogo/proposta e lettura archivio legacy.
Non aggiungere un generico `allow write: if true` per sbloccare l'interfaccia.
Per moderazione affidabile occorrono identità legate a UID, regole con invarianti di voto e/o
pubblicazione su backend. Le regole attive non sono state lette o modificate da questa sessione.

I test usano relay e shim locali: **nessuna migrazione o scrittura sul Firebase reale**.
Nessun deploy eseguito. Safari/WebKit e dispositivi fisici restano da verificare.

## Verifiche eseguite

122/122 unitari e 122/122 scenari browser (61 mobile + 61 desktop), con relay e shim.
Tra i casi: tre approvazioni concorrenti, doppio invio, rifiuto motivato, estranei,
conflitto su documento letto/non scritto e rollback, esportazione, dataset per snapshot,
Worker reattivo/annullabile, QU, rifiuto di HTML, conservazione dei vecchi documenti,
risultati conclusi, consegna/verifica, recupero del voto fallito e rimozione dei listener.
Axe del catalogo chiaro/scuro a 320 px superato. WebKit e Firebase live non testati.
Il dettaglio della regressione palestra e dei cicli intermedi è in [GAMES.md](../GAMES.md).
