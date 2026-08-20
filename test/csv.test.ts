// Import CSV: normalizzazione URL profilo e mappatura delle intestazioni.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProfileUrl, parseCsvBuffer } from '../src/importer/csv.js';

test('accetta un URL completo e ne estrae il public id', () => {
  const r = normalizeProfileUrl('https://www.linkedin.com/in/mario-rossi/');
  assert.deepEqual(r, { url: 'https://www.linkedin.com/in/mario-rossi/', publicId: 'mario-rossi', inferred: false });
});

test('rimuove query string e fragment (parametri di tracciamento)', () => {
  const r = normalizeProfileUrl('https://www.linkedin.com/in/mario-rossi/?utm_source=x&trk=y#top');
  assert.equal(r?.url, 'https://www.linkedin.com/in/mario-rossi/');
});

test('accetta un URL senza schema', () => {
  const r = normalizeProfileUrl('linkedin.com/in/giulia-bianchi');
  assert.equal(r?.url, 'https://www.linkedin.com/in/giulia-bianchi/');
  assert.equal(r?.inferred, false);
});

test('accetta la forma "in/slug" senza marcarla come inferita', () => {
  const r = normalizeProfileUrl('in/luca-verdi');
  assert.equal(r?.url, 'https://www.linkedin.com/in/luca-verdi/');
  assert.equal(r?.inferred, false);
});

test('uno slug nudo viene ricostruito ma marcato come inferito', () => {
  const r = normalizeProfileUrl('mario-rossi');
  assert.equal(r?.url, 'https://www.linkedin.com/in/mario-rossi/');
  assert.equal(r?.inferred, true, 'chi importa deve poter distinguere un URL vero da uno ricostruito');
});

test('rifiuta domini non LinkedIn e stringhe vuote', () => {
  assert.equal(normalizeProfileUrl('https://twitter.com/mario'), null);
  assert.equal(normalizeProfileUrl(''), null);
  assert.equal(normalizeProfileUrl('   '), null);
});

test('riconosce le intestazioni italiane e mette le colonne extra in custom', () => {
  const csv = [
    'Profilo,Nome,Cognome,Azienda,Qualifica,Città,Settore',
    'https://www.linkedin.com/in/mario-rossi/,Mario,Rossi,Acme,CEO,Milano,Manifattura',
  ].join('\n');
  const r = parseCsvBuffer(csv, 'test.csv');
  assert.equal(r.total, 1);
  assert.equal(r.valid.length, 1);
  const c = r.valid[0]!;
  assert.equal(c.first_name, 'Mario');
  assert.equal(c.company, 'Acme');
  assert.equal(c.headline, 'CEO');
  assert.equal(c.location, 'Milano');
  assert.deepEqual(c.custom, { Settore: 'Manifattura' });
});

test('riconosce le intestazioni inglesi', () => {
  const csv = 'profile_url,first_name,last_name,company\nhttps://www.linkedin.com/in/j-doe/,John,Doe,Globex';
  const c = parseCsvBuffer(csv, 't.csv').valid[0]!;
  assert.equal(c.first_name, 'John');
  assert.equal(c.company, 'Globex');
});

test('le righe senza URL valido finiscono in invalid con il numero di riga del file', () => {
  const csv = 'profile_url,nome\nhttps://www.linkedin.com/in/ok/,Ok\n,Vuoto\nhttps://example.com/x,Fuori';
  const r = parseCsvBuffer(csv, 't.csv');
  assert.equal(r.valid.length, 1);
  assert.deepEqual(
    r.invalid.map((i) => i.row),
    [3, 4],
  );
});

test('conta le righe con URL ricostruito da slug', () => {
  const csv = 'profile_url,nome\nmario-rossi,Mario\nhttps://www.linkedin.com/in/vero/,Vero';
  const r = parseCsvBuffer(csv, 't.csv');
  assert.equal(r.inferred.length, 1);
  assert.equal(r.inferred[0]!.row, 2);
  assert.equal(r.inferred[0]!.input, 'mario-rossi');
});
