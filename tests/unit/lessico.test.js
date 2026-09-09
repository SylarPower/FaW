'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
global.FAWCore = require('../../games/shared/faw-core');
global.FAWCategorie = require('../../games/shared/faw-categorie');
global.FAWNcc = require('../../games/categoria-rush/js/nomi-cose-citta');
global.FAWWords = require('../../games/shared/faw-words');
const L = require('../../games/shared/faw-lessico'), C = FAWCategorie, N = FAWNcc, W = FAWWords;
const R = require('../../games/categoria-rush/js/regole');
const NET = require('../../games/shared/faw-net');
const B = require('../../games/bomba-parole/js/regole');
const T = 200000, match = (names = ['ALICE','BOB']) => ({ gioco: 'ruzzle', stato: 'conclusa', partecipanti: names, punteggi: { ALICE: 100, BOB: 25 }, parole: { ALICE: [{ w:'CANE',p:1 }], BOB: [] } });
W.setWords(['cane','gatto','cavo','strada','vetro','mela','sale']);
const form = (o = {}) => ({ partita: 'GRUPPO', ambito: 'sprint-animali', tipo: 'extra', parola: 'quokka', motivo: 'È un marsupiale australiano.', fonte: 'https://it.wikipedia.org/wiki/Setonix_brachyurus', ...o });
function memNet() {
  const docs = new Map([['partite/GRUPPO', match()]]);
  return { docs, clock: () => T, get: async p => ({ exists: docs.has(p), data: structuredClone(docs.get(p)) }),
    transactMany: async (paths, fn) => { const data = Object.fromEntries(paths.map(p => [p, structuredClone(docs.get(p) || null)])), patch = fn(data); if (patch === false) return { applied:false, data }; for (const p of Object.keys(patch)) { data[p] = NET.applyPatch(data[p], patch[p]); docs.set(p, structuredClone(data[p])); } return { applied:true, data }; }
  };
}
test('lessico: corpus unico, normalizzazione e conservazione overlay legacy', () => {
  const p = L.snapshot({ extra: ['cAnè','CANE','zoè','AB'], excluded:['gatto','GATTO'], versione: 4 });
  assert.deepEqual(p.extra,['CANE']); assert.deepEqual(p.excluded,['GATTO']); assert.equal(p.versione,4);
  assert.equal(L.norm("Sant'Agata",'ncc-citta'),FAWCore.normText("Sant'Agata"));
});
test('lessico: proposta con gruppo unico, fonte, motivazione e scadenza esplicita', () => {
  const p = L.makeProposal(match(['BOB','ALICE','ALICE']),null,'ALICE',form(),T);
  assert.deepEqual(p.elettori,['ALICE','BOB']); assert.equal(p.voti.ALICE.si,true); assert.equal(p.scade,T+7*86400000);
  assert.equal(p.storico.length,1); assert.equal(p.parola,'quokka');
});
test('lessico: niente auto-approvazioni, estranei o partite annullate', () => {
  assert.throws(() => L.makeProposal(match(['ALICE']),{},'ALICE',form(),T),/2 a 8/);
  assert.throws(() => L.makeProposal(match(),{},'ESTRANEO',form(),T),/appartenere/);
  assert.throws(() => L.makeProposal({...match(),stato:'annullata'},{},'ALICE',form(),T),/annullata/);
});
test('lessico: rifiuta input sporchi, fonti eseguibili, categorie ignote, voci già presenti', () => {
  for (const change of [{ parola:'cane2' }, { parola:'<script>' }, { motivo:'si' }, { fonte:'javascript:alert(1)' }, { fonte:'https://user:password@example.org' }, { ambito:'non-esiste' }, { parola:'cane' }]) assert.throws(() => L.makeProposal(match(),{},'ALICE',form(change),T));
  assert.throws(() => L.makeProposal(match(),{},'ALICE',form({ ambito:'dizionario', parola:'cane gatto' }),T),/sola parola/);
});
test('lessico: tutta la proposta è immutabile al doppio tap e al retry', async () => {
  const net = memNet(); const a = await L.create(form(),'ALICE',net), b = await L.create(form({ motivo:'Cambio la proposta, ma non i voti' }),'ALICE',net);
  assert.equal(a.id,b.id); assert.equal(a.created,true); assert.equal(b.created,false); assert.equal(b.proposta.motivo,a.proposta.motivo);
  assert.equal(net.docs.size,2);
});
test('lessico: ultimo sì pubblica una volta sola e conserva voti/storico/risultati', async () => {
  const net = memNet(), before = structuredClone(net.docs.get('partite/GRUPPO'));
  net.docs.set(L.PUB,{ legacyField:'da preservare',extra:['CANTISSIMO'],excluded:['GATTO'] });
  const p = await L.create(form(),'ALICE',net);
  await Promise.all([L.vote(p.id,'BOB',true,'',net), L.vote(p.id,'BOB',true,'',net),L.vote(p.id,'ALICE',true,'',net)]);
  const pub = net.docs.get(L.PUB), item = net.docs.get(L.COL+'/'+p.id);
  assert.equal(pub.versione,1); assert.equal(pub.legacyField,'da preservare'); assert.deepEqual(pub.extra,['CANTISSIMO']); assert.deepEqual(pub.excluded,['GATTO']);
  assert.deepEqual(pub.categorie['sprint-animali'].extra,['quokka']); assert.equal(item.stato,'published'); assert.equal(item.storico.length,3);
  assert.deepEqual(net.docs.get('partite/GRUPPO'),before);
});
test('lessico: tre giocatori richiedono tre sì, non una maggioranza', () => {
  const m = match(['ALICE','BOB','CARLA']), p = L.makeProposal(m,{},'ALICE',form(),T);
  const v = L.voteProposal(m,{},p,'BOB',true,'',T+1); assert.equal(v.proposta.stato,'pending'); assert.equal(v.pubblicazione,undefined);
  assert.equal(L.voteProposal(m,{},v.proposta,'CARLA',true,'',T+2).proposta.stato,'published');
});
test('lessico: un no motivato è definitivo, registrato, senza pubblicazioni', () => {
  const m=match(['ALICE','BOB','CARLA']), p=L.makeProposal(m,{},'ALICE',form(),T);
  assert.throws(()=>L.voteProposal(m,{},p,'BOB',false,'no',T+1),/5–280/);
  const no=L.voteProposal(m,{},p,'BOB',false,'La definizione non è corretta.',T+1);
  assert.equal(no.proposta.stato,'rejected'); assert.equal(no.proposta.voti.BOB.si,false); assert.equal(no.pubblicazione,undefined);
  assert.equal(L.voteProposal(m,{},no.proposta,'CARLA',true,'',T+2).applied,false);
});
test('lessico: scadenza e cambio del gruppo non diventano consenso implicito', () => {
  const p=L.makeProposal(match(),{},'ALICE',form(),T);
  assert.equal(L.status(p,p.scade),'expired');
  assert.equal(L.voteProposal(match(),{},p,'BOB',true,'',p.scade).proposta.stato,'expired');
  const v=L.voteProposal(match(['ALICE','BOB','CARLA']),{},p,'BOB',true,'',T+1);
  assert.equal(v.proposta.stato,'superseded'); assert.equal(v.pubblicazione,undefined);
});
test('lessico: modifiche concorrenti alla stessa voce superano la proposta vecchia', () => {
  const m=match(),p=L.makeProposal(m,{},'ALICE',form(),T);
  const pub={categorie:{'sprint-animali':{extra:['quokka']}}};
  const v=L.voteProposal(m,pub,p,'BOB',true,'',T+1);
  assert.equal(v.proposta.stato,'superseded'); assert.equal(v.pubblicazione,undefined);
});
test('lessico: un aggiornamento non correlato non blocca il consenso', () => {
  const p=L.makeProposal(match(),{},'ALICE',form(),T);
  const v=L.voteProposal(match(),{versione:2,extra:['CANTISSIMO']},p,'BOB',true,'',T+1);
  assert.equal(v.proposta.stato,'published'); assert.equal(v.pubblicazione.versione,3); assert.deepEqual(v.pubblicazione.extra,['CANTISSIMO']);
});
test('lessico: alias solo verso voci presenti e mai nel dizionario generale', () => {
  assert.throws(()=>L.makeProposal(match(),{},'ALICE',form({tipo:'alias',canonica:'quokkasconosciuto'}),T),/riferimento/);
  assert.throws(()=>L.makeProposal(match(),{},'ALICE',form({tipo:'alias',ambito:'dizionario',canonica:'CANE'}),T),/solo per le categorie/);
  const p=L.makeProposal(match(),{},'ALICE',form({tipo:'alias',ambito:'ncc-frutta',parola:'angurie',canonica:'anguria'}),T);
  const next=L.voteProposal(match(),{},p,'BOB',true,'',T+1).pubblicazione;
  assert.equal(C.valida('angurie',N.byId('frutta',next)).canonical,'anguria');
  assert.equal(C.valida('angurie',N.byId('frutta')).ok,false);
  const scores=N.punteggi({ALICE:{valori:{frutta:'angurie'}},BOB:{valori:{frutta:'anguria'}}},{categorie:['frutta'],lettera:'A'},['ALICE','BOB'],next);
  assert.equal(scores.punti.ALICE,5); assert.equal(scores.punti.BOB,5);
});
test('lessico: gli overlay non contaminano base, altre liste o precedenti snapshot', () => {
  const a=L.snapshot({categorie:{'sprint-animali':{extra:['quokka']}}});
  const b=L.snapshot({categorie:{'sprint-animali':{extra:['quetzal']}}});
  assert.equal(C.valida('quokka',C.byId('animali',a)).ok,true);
  assert.equal(C.valida('quokka',C.byId('animali',b)).ok,false);
  assert.equal(C.valida('quokka',C.byId('animali')).ok,false);
  assert.equal(C.valida('quokka',N.byId('animali',a)).ok,false);
});
test('lessico: escludere la canonica elimina tutti gli alias dipendenti', () => {
  const s=L.snapshot({categorie:{'sprint-trasporti':{excluded:['bicicletta']}}});
  for(const word of ['bicicletta','bici']) assert.equal(C.valida(word,C.byId('trasporti',s)).ok,false);
  assert.equal(C.valida('bici',C.byId('trasporti')).ok,true);
});
test('lessico: cache di combinazioni e lettere invalidata dal contenuto, non dalla lunghezza', () => {
  const patch=word=>L.snapshot({categorie:{'sprint-animali':{extra:[word]}}});
  const a=C.comboDisponibili({min:1,lessico:patch('quokka')}), b=C.comboDisponibili({min:1,lessico:patch('zibettoaggiunto')});
  assert.equal(a.find(x=>x.id==='animali'&&x.lettera==='Q').n, b.find(x=>x.id==='animali'&&x.lettera==='Q').n + 1);
  const none=L.snapshot({categorie:{'ncc-frutta':{excluded:N.byId('frutta').risposte}}});
  assert.equal(N.lettere(6,none).length,0); assert.ok(N.lettere(6).length>0);
});
test('lessico: Rush valuta la lista concordata nel match', () => {
  const combo={categoria:'animali',lettera:'Q'},lessico=L.snapshot({categorie:{'sprint-animali':{extra:['quokka']}}});
  assert.equal(R.valutaRisposta('quokka',combo,{lessico}).ok,true); assert.equal(R.valutaRisposta('quokka',combo).ok,false);
});
test('lessico: rientro e partite concluse non importano pubblicazioni future', async () => {
  const net=memNet(), future={extra:['CANTISSIMO'],versione:2}; net.docs.set(L.PUB,future);
  const before=structuredClone(net.docs.get('partite/GRUPPO'));
  assert.deepEqual((await L.prepareMatch('GRUPPO','ALICE',net)).extra,[]); assert.deepEqual(net.docs.get('partite/GRUPPO'),before);
  net.docs.set('partite/GRUPPO',{...match(),stato:'attesa'});
  const first=await L.prepareMatch('GRUPPO','ALICE',net); assert.deepEqual(first.extra,['CANTISSIMO']);
  net.docs.set(L.PUB,{extra:['CANTISSIMI'],versione:3});
  assert.deepEqual(await L.prepareMatch('GRUPPO','BOB',net),first);
  assert.deepEqual(L.forMatch({stato:'in_corso',dizionarioCustom:{extra:['VECCHISSIMA']}},future).extra,['VECCHISSIMA']);
});
test('lessico: general dictionary same-size replacements, revoked exclusions and Bomba snapshots', () => {
  W.setPublication({extra:['CANTISSIMO'],excluded:['CANE']}); assert.equal(W.isWord('CANTISSIMO'),true); assert.equal(W.isWord('cane'),false);
  W.setPublication({extra:['CANTISSIMI'],excluded:['GATTO']}); assert.equal(W.isWord('CANTISSIMO'),false); assert.equal(W.isWord('CANE'),true); assert.equal(W.isWord('GATTO'),false);
  assert.equal(W.isBaseWord('CANE'),true); assert.equal(W.isBaseWord('CANTISSIMI'),false);
  assert.equal(B.valutaParola('CANE','CA',[],{lessico:{extra:[],excluded:['CANE']}}).ok,false);
  assert.equal(B.valutaParola('GATTO','GA',[],{lessico:{extra:[],excluded:[]}}).ok,true);
  W.setPublication({}); assert.equal(W.isWord('GATTO'),true); assert.equal(W.isWord('CANTISSIMI'),false);
});
test('lessico: il limite dimensionale rifiuta il voto prima di qualsiasi pubblicazione', () => {
  const raw={legacyPayload:'x'.repeat(710000)}, p=L.makeProposal(match(),raw,'ALICE',form(),T);
  assert.throws(()=>L.voteProposal(match(),raw,p,'BOB',true,'',T+1),/limite/);
  assert.equal(p.stato,'pending'); assert.equal(p.voti.BOB,undefined);
});
test('lessico: rapporto di copertura rigenerato e alias ampliati risolvibili', () => {
  require('node:child_process').execFileSync(process.execPath,['scripts/copertura-lessico.js','--check']);
  for(const scope of L.SCOPES.slice(1)) {const c=L.category(scope.id); for(const alias of Object.keys(c.varianti||{})) assert.equal(C.valida(alias,c).ok,true,scope.id+' '+alias);}
});
test('lessico: letture coalescenti e fallback solo dichiarato, errori non memorizzati per sempre', async () => {
  let calls=0;const net={get:async()=>{calls++;return {data:{versione:5,extra:['CANTISSIMO']}};}};
  const copies=await Promise.all([L.load(net),L.load(net),L.load(net)]);
  assert.equal(calls,1);assert.equal(copies[2].versione,5);
  const failed={get:()=>{throw new Error('offline');}};
  await assert.rejects(L.load(failed),/offline/);
  assert.equal((await L.loadSolo(failed)).origine,'base (pubblicazioni non disponibili)');
  assert.equal((await L.load(net)).versione,5);assert.equal(calls,2);
});
test('dizionario: corpus caricato ma tutto escluso è distinto da download assente', async () => {
  W.setPublication({excluded:['CANE','GATTO','CAVO','STRADA','VETRO','MELA','SALE']});
  assert.equal(W.dictionarySize(),0);assert.equal(W.isDictionaryReady(),true);
  assert.equal((await W.load()).size,0);assert.equal(W.isBaseWord('CANE'),true);
  W.setPublication({});assert.equal(W.isWord('CANE'),true);
});
