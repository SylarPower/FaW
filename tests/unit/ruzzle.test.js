'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const S=require('../../games/ruzzle/js/solver');
test('Ruzzle: QU occupa una tessera, adiacenza e celle senza riuso',()=>{
  const t=S.build(['QUOTA','CANE','CCCC','QOTA']);
  const r=S.solve(t,{size:2,letters:['Q','O','T','A'],timeMs:500});
  assert.deepEqual(r.words.map(w=>w.w),['QUOTA']); assert.equal(new Set(r.words[0].path).size,4); assert.equal(r.complete,true);
  assert.deepEqual(S.solve(t,{size:2,letters:['C','X','X','X']}).words,[]);
});
test('Ruzzle: parola deduplicata, mantiene il percorso coi migliori bonus',()=>{
  const t=S.build(['CANE']),letters=['C','A','N','X','C','E','X','X','X'];
  const result=S.solve(t,{size:3,letters,bonuses:['','','','','3P'],timeMs:500});
  assert.equal(result.words.length,1); assert.equal(result.words[0].w,'CANE'); assert.equal(result.words[0].p,3); assert.ok(result.words[0].path.includes(4));
});
test('Ruzzle: nessun falso risultato completo al limite di tempo/lavoro',()=>{
  const t=S.build(['AAAA','AAAAA','AAAAAA']);
  const r=S.solve(t,{size:3,letters:Array(9).fill('A'),maxSteps:10});
  assert.equal(r.complete,false); assert.ok(r.count<=3);
  const limited=S.solve(t,{size:3,letters:Array(9).fill('A'),limit:1}); assert.equal(limited.complete,false); assert.equal(limited.count,1);
});
test('Ruzzle: non tronca arbitrariamente a 12 lettere e stessa scala bonus del gioco',()=>{
  const t=S.build(['AAAAAAAAAAAAA']); const r=S.solve(t,{size:4,letters:Array(16).fill('A'),limit:1,timeMs:100});
  assert.equal(r.words[0].w.length,13); assert.equal(r.words[0].p,11);
  assert.equal(S.score('CANE',[0,1,2,3],['2L','3L','2P','3P']),36);
});
test('Ruzzle: input malformato rifiutato dal worker, senza DFS',()=>{
  const t=S.build(['CANE']);for(const i of [{size:3,letters:['C']},{size:1,letters:['Q']},{size:2,letters:['C','A','N','<']}]) assert.throws(()=>S.solve(t,i),/Griglia/);
});
test('giochi: nessun motore, controllo o asset audio residuo',()=>{
  const files=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else files.push(p);}}walk('games');
  for(const file of files){assert.ok(!/\.(mp3|wav|ogg|opus|flac|aac|m4a|aiff|mid|midi)$/i.test(file),file);if(/\.(js|html|css)$/i.test(file))assert.doesNotMatch(fs.readFileSync(file,'utf8'),/\b(?:AudioContext|webkitAudioContext|new\s+Audio|speechSynthesis|SpeechSynthesisUtterance|createOscillator|createGain)\b|<audio\b|data-action=["']audio|id=["']btn-audio|\b(?:CORE|FAWCore)\.(?:beep|sound|setAudio|audioEnabled)/i,file);}
});
