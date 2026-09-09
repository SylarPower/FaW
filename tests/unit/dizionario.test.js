'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
global.FAWCore = require('../../games/shared/faw-core');
const W = require('../../games/shared/faw-words');

test('dizionario: indici invalidati da setWords, sequenze contate per parola distinta', () => {
  W.setWords(['ananas', 'banana', 'banane', 'banaaaaana', 'cane']);
  assert.equal(W.sequenceCount('ANA', { minLen: 4, maxLen: 8 }), 3, 'ANANAS contiene ANA due volte ma vale uno');
  assert.ok(W.hasPrefix('BAN'));
  assert.deepEqual(W.wordsOfLength(4), ['CANE']);
  W.setWords(['strada', 'strade', 'trama']);
  assert.equal(W.sequenceCount('ANA'), 0);
  assert.equal(W.hasPrefix('BAN'), false);
  assert.deepEqual(W.wordsOfLength(4), []);
  assert.equal(W.sequenceCount('TRA'), 3);
});

test('dizionario: la cache salva il pool, non un precedente campionamento casuale', () => {
  W.setWords(['strada', 'strade', 'trama', 'trame', 'tramare', 'treno', 'treni', 'amore', 'amori', 'mare', 'mari', 'banda', 'bande', 'banca', 'banche']);
  const options = { len: 3, minWords: 2, minLen: 4, maxLen: 24, size: 2 };
  const sample = seed => W.sampleSequences({ ...options, rng: FAWCore.rngFrom(seed) });
  const a = sample('A'); for (let i = 0; i < 8; i++) sample('ALTRO-' + i);
  assert.deepEqual(sample('A'), a);
  assert.ok(new Set(Array.from({ length: 12 }, (_, i) => JSON.stringify(sample('SEED-' + i)))).size > 3);
  const excluded = W.sampleSequences({ ...options, size: 20, exclude: a.map(s => s.seq) });
  assert.ok(excluded.every(s => !a.some(v => v.seq === s.seq)));
});

test('dizionario: fetch coalescente e recuperabile, rifiuta HTML ed elenco vuoto', async () => {
  const oldFetch = global.fetch;
  let calls = 0;
  try {
    W.setWords([]);
    global.fetch = async () => { calls++; return { ok: true, text: async () => '<!doctype html><html>not found</html>' }; };
    await assert.rejects(W.load({ urls: ['bad.html'] }), /Dizionario non raggiungibile/);
    assert.equal(W.isDictionaryReady(), false);
    global.fetch = async () => { calls++; return { ok: true, text: async () => '' }; };
    await assert.rejects(W.load({ urls: ['empty.txt'] }));
    global.fetch = async () => { calls++; return { ok: true, text: async () => 'strada\ntrama\ncane\n' }; };
    const before = calls;
    await Promise.all([W.load(), W.load(), W.load()]);
    assert.equal(calls - before, 1); assert.equal(W.isDictionaryReady(), true);
    assert.equal(W.isWord('strada'), true); assert.equal(W.dictionarySize(), 3);
    await W.load(); assert.equal(calls - before, 1, 'la sessione riutilizza i dati caricati');
  } finally { global.fetch = oldFetch; }
});
