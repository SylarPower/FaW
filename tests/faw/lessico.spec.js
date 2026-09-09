'use strict';
const {test,expect}=require('@playwright/test'), AxeBuilder=require('@axe-core/playwright').default;
const A=require('./aiuti'), {shimFirebase}=require('../support/firebase-compat');
const LIB='lessico/index.html', RUSH='games/categoria-rush/index.html', BOMBA='games/bomba-parole/index.html', RUZ='games/ruzzle/index.html';
test.beforeEach(async()=>A.resetRelay());
async function write(request,path,set){return request.post('http://127.0.0.1:8090/api/write',{data:{ops:[{path,set}]}});}
async function read(request,path){return (await (await request.post('http://127.0.0.1:8090/api/get',{data:{paths:[path]}})).json()).docs[path]?.data;}
function game(names=['ALICE','BOB']){return {gioco:'ruzzle',stato:'conclusa',partecipanti:names,pronti:names,finito:names,confermaVerifica:names,creator:'ALICE',host:'ALICE',creata:Date.now(),opzioni:{griglia:'3',tempo:'60',seed:'LESSICO-S3-T60',mode:'classic'},punteggi:{ALICE:1,BOB:0},parole:{ALICE:[{w:'CANE',p:1,path:[0,1,2,3]}],BOB:[]},lessico:{base:'2026-09-09',versione:0,extra:[],excluded:[],categorie:{}}};}
async function open(browser,name,url=LIB,compat=false){const s=await A.contesto(browser,name); if(compat)await s.ctx.addInitScript(shimFirebase); await s.page.goto(url+(url.includes('?')?'&':'?')+'net='+(compat?'firebase':'fake')); return s;}
async function fillProposal(page,word='quokka'){
  await page.selectOption('#partita','GRUPPO');await page.selectOption('#ambito','sprint-animali');
  await page.fill('#parola',word);await page.fill('#motivo','È un marsupiale australiano, assente nella lista.');
  await expect(page.locator('#invia-proposta')).toBeEnabled();await page.locator('#invia-proposta').dblclick();
  await expect(page.locator('#esito-proposta')).toContainText(/Proposta inviata|Esiste già/);
}
for(const compat of [false,true]) {
 test('Lessico: tre elettori, doppio invio e ultimi sì simultanei, '+(compat?'Firebase compat':'relay'),async({browser,request})=>{
  await write(request,'partite/GRUPPO',game(['ALICE','BOB','CARLA']));
  const [a,b,c]=await Promise.all([open(browser,'ALICE',LIB,compat),open(browser,'BOB',LIB,compat),open(browser,'CARLA',LIB,compat)]);
  try{
    await fillProposal(a.page);
    await expect(b.page.locator('[data-vote="yes"]')).toBeVisible();await expect(c.page.locator('[data-vote="yes"]')).toBeVisible();
    await Promise.all([b.page.click('[data-vote="yes"]'),c.page.click('[data-vote="yes"]')]);
    await expect.poll(async()=>(await read(request,'config/dizionario'))?.versione).toBe(1);
    const id=await a.page.evaluate(()=>FAWLessico.proposalId('GRUPPO','sprint-animali','quokka'));
    const p=await read(request,'lessico_proposte/'+id);expect(p.stato).toBe('published');expect(Object.keys(p.voti)).toHaveLength(3);expect(p.storico).toHaveLength(4);
    await a.page.selectOption('#filtro-stato','all');await expect(a.page.locator('.proposal')).toContainText('Pubblicata');
    await a.page.fill('#cerca','quokka');await expect(a.page.locator('#voci')).toContainText('quokka');
    expect((await read(request,'partite/GRUPPO')).punteggi).toEqual({ALICE:1,BOB:0});
    await a.page.evaluate(id=>FAWLessico.vote(id,'BOB',true,'',FAWNet),id);expect((await read(request,'config/dizionario')).versione).toBe(1);
    for(const s of [a,b,c])expect(s.page.__errors||[]).toEqual([]);
  } finally {await Promise.all([a.ctx.close(),b.ctx.close(),c.ctx.close()]);}
 });
 test('Trasporto atomico: rollback e conflitto su lettura senza scrittura, '+(compat?'Firebase compat':'relay'),async({browser,request})=>{
  await write(request,'atomic/uno',{value:0});await write(request,'atomic/due',{value:1});
  const bad=await request.post('http://127.0.0.1:8090/api/write',{data:{atomic:true,ops:[{path:'atomic/uno',set:{value:99}},{path:'atomic/due',set:{value:100},ifVersion:999}]}});
  expect((await bad.json()).conflict).toBe(true);expect(await read(request,'atomic/uno')).toEqual({value:0});
  const s=await open(browser,'ALICE',LIB,compat);
  try{
    let conflict=false;
    await s.page.route('**/api/write',async route=>{
      const b=route.request().postDataJSON();
      if(!conflict&&b.atomic&&(b.checks||[]).some(x=>x.path==='atomic/due')){conflict=true;await write(request,'atomic/due',{value:7});}
      await route.continue();
    });
    const result=await s.page.evaluate(()=>FAWNet.transactMany(['atomic/uno','atomic/due'],d=>({'atomic/uno':{value:d['atomic/due'].value}})));
    expect(result.applied).toBe(true);expect(conflict).toBe(true);expect((await read(request,'atomic/uno')).value).toBe(7);
    expect((await read(request,'atomic/due')).value).toBe(7);
  } finally {await s.ctx.close();}
 });
}
test('Lessico: rifiuto motivato conservato, estraneo senza voto e niente pubblicazione',async({browser,request})=>{
 await write(request,'partite/GRUPPO',game());const [a,b,x]=await Promise.all([open(browser,'ALICE'),open(browser,'BOB'),open(browser,'ESTRANEO')]);
 try{
  await fillProposal(a.page);await expect(b.page.locator('[data-vote="no"]')).toBeVisible();
  await b.page.click('[data-vote="no"]');await expect(b.page.locator('#rifiuto')).toBeVisible();await b.page.fill('#rifiuto-motivo','La fonte non è sufficientemente chiara.');await b.page.click('#conferma-rifiuto');
  await expect(b.page.locator('#rifiuto')).not.toBeVisible();await b.page.selectOption('#filtro-stato','all');await expect(b.page.locator('.proposal')).toContainText('Rifiutata');await expect(b.page.locator('.proposal')).toContainText('La fonte non è sufficientemente chiara.');
  const id=await a.page.evaluate(()=>FAWLessico.proposalId('GRUPPO','sprint-animali','quokka'));
  const denial=await x.page.evaluate(id=>FAWLessico.vote(id,'ESTRANEO',true,'').then(()=>false,e=>e.message),id);expect(denial).toMatch(/appartenere/);
  expect(await read(request,'config/dizionario')).toBeUndefined();expect((await read(request,'lessico_proposte/'+id)).voti.BOB.si).toBe(false);await expect(x.page.locator('.proposal')).toHaveCount(0);
 }finally{await Promise.all([a.ctx.close(),b.ctx.close(),x.ctx.close()]);}
});
test('Lessico: dizionario pigro, ricerca paginata, CSV e categorie senza download del corpus',async({browser})=>{
 const a=await A.contesto(browser,'ALICE');let downloads=0;await a.page.route('**/dizionario.txt',async r=>{downloads++;await r.continue();});
 try{
  await a.page.goto(LIB);await expect(a.page.locator('#voci tr')).not.toHaveCount(0);expect(downloads).toBe(0);
  await a.page.selectOption('#ambito','dizionario');expect(downloads).toBe(0);await a.page.click('#carica-dizionario');
  await expect(a.page.locator('#dictionary-load')).not.toBeVisible({timeout:60000});expect(downloads).toBe(1);expect(await a.page.locator('#voci tr').count()).toBeLessThanOrEqual(60);
  await a.page.fill('#cerca','STRADA');await expect(a.page.locator('#voci')).toContainText('STRADA');
  const promise=a.page.waitForEvent('download');await a.page.click('#esporta');const file=await promise;expect(file.suggestedFilename()).toMatch(/^faw-dizionario.*\.csv$/);
  const stream=await file.createReadStream(),chunks=[];for await(const c of stream)chunks.push(c);expect(Buffer.concat(chunks).toString('utf8')).toContain('"STRADA"');
  await a.page.selectOption('#ambito','sprint-citta');await a.page.fill('#cerca','venezia');await expect(a.page.locator('#voci')).toContainText('venezia');expect(downloads).toBe(1);
  expect(a.page.__errors||[]).toEqual([]);
 }finally{await a.ctx.close();}
});
test('Lessico: 320px, tastiera e accessibilità nelle due palette',async({browser})=>{
 const a=await A.contesto(browser,'ALICE',{viewport:{width:320,height:740},reducedMotion:true});
 try{
  await a.page.goto(LIB);await expect(a.page.locator('#voci tr')).not.toHaveCount(0);
  for(const theme of ['dark','light']){
    await a.page.evaluate(t=>{document.documentElement.setAttribute('data-theme',t);document.body.setAttribute('data-theme',t);},theme);
    const overflow=await a.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);expect(overflow).toBe(false);
    const axe=await new AxeBuilder({page:a.page}).analyze();expect(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
    await a.page.screenshot({path:'.arena/screenshots/lessico-'+theme+'.png',fullPage:true});
  }
 }finally{await a.ctx.close();}
});
test('Rush/NCC: pubblicazioni concordate e mai modificate da aggiornamenti globali in partita',async({browser,request})=>{
 const pub={versione:1,extra:[],excluded:[],categorie:{'ncc-animali':{extra:['quokka']}}};await write(request,'config/dizionario',pub);
 const a=await open(browser,'ALICE',RUSH),b=await open(browser,'BOB',RUSH);
 try{
  const id=await A.creaPartita(a.page,{gioco:'categoria-rush',creator:'ALICE',giocatori:['ALICE','BOB'],durata:120000,opzioni:{mode:'nomi-cose-citta',colonne:6,countdown:0}});
  await Promise.all([a.page.goto(RUSH+'?matchId='+id),b.page.goto(RUSH+'?matchId='+id)]);
  await a.page.click('#btn-pronto');await b.page.click('#btn-pronto');await A.attendiRound(a.page);
  await write(request,'config/dizionario',{...pub,versione:2,categorie:{'ncc-animali':{extra:['quetzal']}}});
  const valid=await a.page.evaluate(()=>{const d=FAWRush.stato.data;return{version:d.lessico.versione,q:FAWCategorie.valida('quokka',FAWNcc.byId('animali',d.lessico)).ok,z:FAWCategorie.valida('quetzal',FAWNcc.byId('animali',d.lessico)).ok};});
  expect(valid).toEqual({version:1,q:true,z:false});
  const next=await A.creaPartita(a.page,{gioco:'categoria-rush',creator:'ALICE',giocatori:['ALICE','BOB']});
  const frozen=await a.page.evaluate(id=>FAWLessico.prepareMatch(id,'ALICE'),next);expect(frozen.versione).toBe(2);expect(frozen.categorie['ncc-animali'].extra).toEqual(['quetzal']);
 }finally{await a.ctx.close();await b.ctx.close();}
});
test('Bomba: usa lo snapshot del match e conserva l’allenamento solo senza scritture',async({browser,request})=>{
 await write(request,'config/dizionario',{versione:1,excluded:['STRADA'],extra:[]});const a=await open(browser,'ALICE',BOMBA);
 try{
  await expect(a.page.locator('#btn-solo')).toBeVisible();await a.page.click('#btn-solo');await expect(a.page.locator('#schermo-gioco')).toBeVisible();
  expect(await a.page.evaluate(()=>FAWWords.isWord('STRADA'))).toBe(false);
  await write(request,'config/dizionario',{versione:2,excluded:[],extra:[]});
  expect(await a.page.evaluate(()=>FAWWords.isWord('STRADA'))).toBe(false);
  const docs=await a.page.evaluate(()=>FAWNet.list('partite',[]));expect(docs).toHaveLength(0);expect(a.page.__errors||[]).toEqual([]);
 }finally{await a.ctx.close();}
});
test('Ruzzle: dizionario verificato, worker reattivo, analisi annullabile e QU',async({browser})=>{
 const a=await open(browser,'ALICE',RUZ,true);
 try{
  await a.page.waitForFunction(()=>typeof dictionaryReady!=='undefined'&&dictionaryReady,{timeout:60000});
  await a.page.evaluate(async()=>{await initGame('ANALISI-S3-T60');gridLetters=['Q','O','T','X','X','A','X','X','X'];gridBonuses=Array(9).fill(null);renderGrid();isGameActive=false;isAnalysisPhase=true;foundWords.clear();window.analysisBeats=0;window.beat=setInterval(()=>window.analysisBeats++,10);showMissedWords();});
  await expect(a.page.locator('#analysis-status')).toContainText(/Ricerca completa|Ricerca parziale/,{timeout:30000});
  expect(await a.page.evaluate(()=>window.analysisBeats)).toBeGreaterThan(4);await expect(a.page.locator('#analysis-words')).toContainText('QUOTA');
  await a.page.getByRole('button',{name:'Chiudi / annulla calcolo'}).click();await expect(a.page.locator('#ruzzle-analysis')).not.toBeVisible();
  await a.page.evaluate(()=>{gridLetters=Array(49).fill('A');gridSize=7;gridBonuses=Array(49).fill(null);renderGrid();showMissedWords();});await a.page.keyboard.press('Escape');await expect(a.page.locator('#ruzzle-analysis')).not.toBeVisible();
  await a.page.evaluate(()=>clearInterval(window.beat));expect(a.page.__errors||[]).toEqual([]);
 }finally{await a.ctx.close();}
});
test('Ruzzle: rifiuta HTML al posto del dizionario e recupera al reload',async({browser})=>{
 const a=await A.contesto(browser,'ALICE');await a.ctx.addInitScript(shimFirebase);
 try{
  await a.page.route('**/dizionario.txt',r=>r.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html>Not found</html>'}));await a.page.goto(RUZ+'?net=firebase');
  await expect(a.page.locator('#loading-msg')).toContainText('Dizionario non caricato');expect(await a.page.evaluate(()=>dictionaryReady)).toBe(false);
  await a.page.unroute('**/dizionario.txt');await a.page.getByRole('button',{name:'Riprova',exact:true}).click();await a.page.waitForFunction(()=>dictionaryReady,null,{timeout:60000});await expect(a.page.locator('#loading-msg')).not.toBeVisible();expect(a.page.__errors||[]).toEqual([]);
 }finally{await a.ctx.close();}
});
test('Ruzzle: nuova esclusione non riscrive risultati e vecchie proposte restano in archivio',async({browser,request})=>{
 const original=game();await write(request,'partite/GRUPPO',original);await write(request,'partite/GRUPPO/proposte/CANE',{parola:'CANE',tipo:'exclude',proponente:'ALICE',voti:['ALICE','BOB']});
 const a=await open(browser,'ALICE',RUZ+'?matchId=GRUPPO',true), b=await open(browser,'BOB',LIB+'?matchId=GRUPPO',true);
 try{
  await a.page.waitForFunction(()=>dictionaryReady,null,{timeout:60000});
  const p=await a.page.evaluate(()=>FAWLessico.create({partita:'GRUPPO',ambito:'dizionario',parola:'CANE',tipo:'exclude',motivo:'Proposta di test da approvare senza ricalcolare il passato.'},'ALICE'));
  await expect(b.page.locator('[data-vote="yes"]')).toBeVisible();await b.page.click('[data-vote="yes"]');await expect.poll(async()=>(await read(request,'config/dizionario'))?.versione).toBe(1);
  expect((await read(request,'lessico_proposte/'+p.id)).stato).toBe('published');expect((await read(request,'partite/GRUPPO')).punteggi).toEqual(original.punteggi);
  expect((await read(request,'partite/GRUPPO')).parole).toEqual(original.parole);expect(await read(request,'partite/GRUPPO/proposte/CANE')).toBeTruthy();
  expect(await a.page.evaluate(()=>dictionary.has('CANE'))).toBe(true);
  await b.page.locator('#legacy summary').click();await expect(b.page.locator('#legacy-list')).toContainText('CANE');
  await a.page.evaluate(()=>updateTotalScore());expect((await read(request,'partite/GRUPPO')).punteggi).toEqual(original.punteggi);
  expect(a.page.__errors||[]).toEqual([]);expect(b.page.__errors||[]).toEqual([]);
 }finally{await a.ctx.close();await b.ctx.close();}
});
test('Ruzzle: consegna e verifica concorrenti si applicano una volta, nessuna scrittura dopo la chiusura',async({browser,request})=>{
 await write(request,'partite/GRUPPO',{...game(),stato:'in_corso',finito:['BOB'],confermaVerifica:['BOB']});
 const a=await open(browser,'ALICE',RUZ+'?matchId=GRUPPO',true);
 try{
  await a.page.waitForFunction(()=>dictionaryReady,null,{timeout:60000});
  await a.page.evaluate(()=>{isGameActive=true;isAnalysisPhase=false;isSandboxMode=false;foundWords.set('CANE',{points:1,path:[0,1,2,3],active:true});endGame();endGame();});
  await expect.poll(async()=>(await read(request,'partite/GRUPPO')).finito.includes('ALICE')).toBe(true);
  await a.page.evaluate(()=>Promise.all([avviaVerificaUnificata(),avviaVerificaUnificata()]));
  await expect.poll(async()=>(await read(request,'partite/GRUPPO')).stato).toBe('conclusa');
  const before=await read(request,'partite/GRUPPO');expect(before.punteggi).toEqual({ALICE:1,BOB:0});
  await a.page.evaluate(async()=>{endGame();await avviaVerificaUnificata();updateTotalScore();await salvaFinePartita();});
  const after=await read(request,'partite/GRUPPO');expect(after.parole).toEqual(before.parole);expect(after.punteggi).toEqual(before.punteggi);expect(after.stato).toBe('conclusa');
  expect(await a.page.evaluate(()=>JSON.parse(localStorage.getItem('funatwork_daily_stats')).totals.ruzzle)).toBe(1);expect(a.page.__errors||[]).toEqual([]);
 }finally{await a.ctx.close();}
});
test('Lessico: voto non confermato torna riprovabile e listener rimossi in uscita',async({browser,request})=>{
 await write(request,'partite/GRUPPO',game());const a=await open(browser,'ALICE',LIB,true),b=await open(browser,'BOB',LIB,true);
 try{
  await fillProposal(a.page);await expect(b.page.locator('[data-vote="yes"]')).toBeVisible();
  let fail=true;await b.page.route('**/api/write',r=>fail?r.abort():r.continue());await b.page.click('[data-vote="yes"]');
  await expect(b.page.locator('#review-info')).toContainText('Voto non confermato');await expect(b.page.locator('[data-vote="yes"]')).toBeEnabled();
  expect(await read(request,'config/dizionario')).toBeUndefined();fail=false;await b.page.click('[data-vote="yes"]');
  await expect.poll(async()=>(await read(request,'config/dizionario'))?.versione).toBe(1);
  expect(await b.page.evaluate(()=>__firebaseListenerCount())).toBeGreaterThan(0);
  await b.page.evaluate(()=>dispatchEvent(new Event('pagehide')));expect(await b.page.evaluate(()=>__firebaseListenerCount())).toBe(0);
 }finally{await a.ctx.close();await b.ctx.close();}
});
