#!/usr/bin/env node
'use strict';
// Rigenerare dopo ogni modifica ai dataset base. Nessuna scrittura su Firebase.
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
global.FAWCore = require('../games/shared/faw-core');
global.FAWCategorie = require('../games/shared/faw-categorie');
global.FAWNcc = require('../games/categoria-rush/js/nomi-cose-citta');
const L = require('../games/shared/faw-lessico'), W = require('../games/shared/faw-words');
const words = new Set(fs.readFileSync(path.join(ROOT, 'dizionario.txt'), 'utf8').split(/\r?\n/).map(W.norm).filter(w => w.length >= 4));
const data = { base: L.BASE, dizionario: words.size, bomba: [...words].filter(w => w.length <= 24).length, categorie: [] };
for (const scope of L.SCOPES.slice(1)) {
  const c = L.category(scope.id), index = {};
  for (const word of new Set([...c.risposte, ...Object.keys(c.varianti || {})].map(FAWCore.normText))) {
    const v = FAWCategorie.valida(word, c);
    if (v.ok) index[word] = v.canonical;
  }
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter(l => new Set(Object.keys(index).filter(w => w[0] === l.toLowerCase()).map(w => index[w])).size >= 4);
  data.categorie.push({ ambito: scope.id, gruppo: scope.gruppo, nome: scope.nome, voci: Object.keys(index).length, canoniche: new Set(Object.values(index)).size, lettereConQuattro: letters.join('') });
}
const target = path.join(ROOT, 'lessico/copertura.json');
const json = JSON.stringify(data, null, 2) + '\n';
if (process.argv.includes('--check')) { if (fs.readFileSync(target, 'utf8') !== json) throw new Error('Copertura non aggiornata: node scripts/copertura-lessico.js'); }
else fs.writeFileSync(target, json);
console.log(JSON.stringify({ dizionario: data.dizionario, sprint: data.categorie.filter(c => c.ambito.startsWith('sprint-')).reduce((n,c) => n+c.voci, 0), ncc: data.categorie.filter(c => c.ambito.startsWith('ncc-')).reduce((n,c) => n+c.voci, 0) }));
