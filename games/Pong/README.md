# PONG: NEXT LEVEL — Edizione interna

Replica migliorativa 3D di *Pong: The Next Level* (1999). Un giocatore per computer. Tastiera only.

## Modi

- **1 vs Computer** — campagna, sblocco arene (vittoria con 2 di scarto)
- **1 vs Giocatore** — due PC, stanza con codice (Firebase)
- **Triangolo 1v1v1** — campo a triangolo, vs 2 CPU oppure 3 PC online
- **Arena su misura** — partita libera configurabile: tavolo di base, punti,
  velocità, racchette, **tema grafica**, **difficoltà CPU** (vs CPU) e quali
  power-up entrano in campo. Il tema scelto vale per la partita e le rivincite;
  uscendo si torna al tema salvato nelle Opzioni.

## Comandi (ogni PC)

| Azione | Tasti |
|---|---|
| Racchetta | `W` `S` oppure `↑` `↓` |
| Seconda racchetta | `A` `D` oppure `←` `→` |
| Curva (piega un estremo all'indietro) | `Q` (estremo sinistro) `E` (estremo destro) |
| Presa / lancio (quando disponibile) | `Spazio` |
| Pausa | `Esc` |

Con `Q`/`E` un estremo della racchetta si piega all'indietro con una curva
morbida (il corpo resta dritto, stile Pong: Next Level). Se la palla arriva
sull'estremo piegato col giusto timing (piega quasi completa) il colpo parte
molto più forte: flash, scossa e messaggio «CURVA!». La curva ha **2 cariche**
che si ricaricano da sole (~6s l'una); dopo un colpo in curva bisogna
rilasciare e ripiegare. L'HUD mostra cariche e ricarica.

I power-up si attivano automaticamente appena la palla colpisce il gettone. Gli effetti sono cumulabili; non esiste più una borsa con selezione e uso manuale. I power-up a tempo mostrano i secondi rimanenti nell'HUD. **A ogni punto fatto tutti i power-up si azzerano** (cariche, timer ed effetti sul campo).

Tra i poteri ci sono anche **Calamita** (la palla viene attratta verso la tua
racchetta per 6s), **Nebbia** (una coltre leggera copre per 7s la metà campo
avversaria, senza nasconderla del tutto) ed **Effetto** (il prossimo colpo parte
con una fiondata laterale fortissima).

Le racchette hanno tutte la **stessa lunghezza** (riferimento: Giungla); cambiano
larghezza e altezza a seconda del tema, ma il bordo più avanzato verso il centro
del campo è identico per tutte. Il colpo si basa sempre sulla hitbox: nel tema
**Calcio** la racchetta è un **piedistallo d'oro con le dimensioni esatte della
hitbox** (una sorta di base per la coppa dei campioni) con sopra appoggiata una
**scarpa da calcio** ben disegnata; nel tema **Air Hockey** è un **pezzo nero
setolato con le dimensioni esatte della hitbox** con sopra appoggiato il
**piattino da air hockey**, e la palla è il classico disco piatto nero o bianco.
Nel tema **Colori** ogni tocco sulla racchetta fa uno splash di un colore
casuale con una forma casuale: la racchetta **si macchia di quel colore e la
macchia persiste** per tutta la partita (più una chiazza sul tavolo che si
asciuga).

Alcuni tavoli **impongono il loro tema grafico** (Pinguini → Ghiaccio, Calcio
Stelle → Calcio, Festa in Spiaggia → Spiaggia, Hockey Puck → Air Hockey):
nell'arena su misura la selezione del tema risulta disattivata e viene
selezionato il tema corrispettivo.

Nel **Tavolo Folle** la livella al centro spiega cosa sta succedendo: la
freccia indica la direzione in cui scivolerà la palla e l'inclinazione dura
qualche secondo prima che il tavolo torni piano (l'HUD mostra il tempo). In
**Giungla** le buche sono trappole: caderci dentro regala il punto
all'avversario (la buca centrale fa solo ripartire il servizio). In **Tronchi
Rotanti** i tronchi restano fermi per design: si muovono solo col potere
Rotazione, che ora ha una durata più leggibile e una corteccia striata che
rende visibile il movimento. In **Hockey Puck** il disco parte nella direzione
opposta a quella da cui arriva la palla, con una spinta proporzionale
all'impatto.

La palla non ha un tetto di velocità: ogni rimbalzo la accelera un po' meno del
precedente, ma per sempre. La velocità si vede: scia più accesa e rossa, luce
più forte e indicatore numerico nell'HUD. Le statistiche locali (partite, colpi,
rally, curve, schianti…) si salvano sul computer e stanno nel menu «Statistiche».

## Online (Firebase)

1. Crea un progetto su [Firebase Console](https://console.firebase.google.com)
2. Aggiungi un’app **Web**, copia la config
3. Crea un **Realtime Database** (regione Europa)
4. Incolla le chiavi in `games/shared/firebase-config.js` (config condivisa con il portale e gli altri giochi; `js/firebase-config.js` è solo l'adapter ES module che la rilegge)
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
