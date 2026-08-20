// CSV import: profile URL normalization and header mapping.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProfileUrl, parseCsvBuffer } from '../src/importer/csv.js';

test('accepts a full URL and extracts the public id from it', () => {
  const r = normalizeProfileUrl('https://www.linkedin.com/in/mario-rossi/');
  assert.deepEqual(r, { url: 'https://www.linkedin.com/in/mario-rossi/', publicId: 'mario-rossi', inferred: false });
});

test('strips query string and fragment (tracking parameters)', () => {
  const r = normalizeProfileUrl('https://www.linkedin.com/in/mario-rossi/?utm_source=x&trk=y#top');
  assert.equal(r?.url, 'https://www.linkedin.com/in/mario-rossi/');
});

test('accepts a URL without a scheme', () => {
  const r = normalizeProfileUrl('linkedin.com/in/giulia-bianchi');
  assert.equal(r?.url, 'https://www.linkedin.com/in/giulia-bianchi/');
  assert.equal(r?.inferred, false);
});

test('accepts the "in/slug" form without flagging it as inferred', () => {
  const r = normalizeProfileUrl('in/luca-verdi');
  assert.equal(r?.url, 'https://www.linkedin.com/in/luca-verdi/');
  assert.equal(r?.inferred, false);
});

test('a bare slug is rebuilt into a URL but flagged as inferred', () => {
  const r = normalizeProfileUrl('mario-rossi');
  assert.equal(r?.url, 'https://www.linkedin.com/in/mario-rossi/');
  assert.equal(r?.inferred, true, 'whoever imports must be able to tell a real URL from a rebuilt one');
});

test('rejects non-LinkedIn domains and empty strings', () => {
  assert.equal(normalizeProfileUrl('https://twitter.com/mario'), null);
  assert.equal(normalizeProfileUrl(''), null);
  assert.equal(normalizeProfileUrl('   '), null);
});

test('a look-alike host is not LinkedIn', () => {
  // An unanchored /linkedin\.com$/ used to accept all of these, and the row
  // was then silently rewritten to www.linkedin.com — a typo, or a deliberate
  // look-alike, became a real profile URL pointing at someone else.
  assert.equal(normalizeProfileUrl('https://evil-linkedin.com/in/mario-rossi/'), null);
  assert.equal(normalizeProfileUrl('https://notlinkedin.com/in/mario-rossi/'), null);
  assert.equal(normalizeProfileUrl('https://linkedin.com.attacker.test/in/mario-rossi/'), null);
});

test('real LinkedIn subdomains are still accepted', () => {
  assert.equal(normalizeProfileUrl('https://www.linkedin.com/in/mario-rossi/')?.url,
    'https://www.linkedin.com/in/mario-rossi/');
  assert.equal(normalizeProfileUrl('https://it.linkedin.com/in/mario-rossi/')?.url,
    'https://www.linkedin.com/in/mario-rossi/');
  assert.equal(normalizeProfileUrl('https://linkedin.com/in/mario-rossi/')?.url,
    'https://www.linkedin.com/in/mario-rossi/');
});

test('recognizes Italian headers and puts the extra columns into custom', () => {
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

test('recognizes English headers', () => {
  const csv = 'profile_url,first_name,last_name,company\nhttps://www.linkedin.com/in/j-doe/,John,Doe,Globex';
  const c = parseCsvBuffer(csv, 't.csv').valid[0]!;
  assert.equal(c.first_name, 'John');
  assert.equal(c.company, 'Globex');
});

test('rows without a valid URL land in invalid with their line number in the file', () => {
  const csv = 'profile_url,nome\nhttps://www.linkedin.com/in/ok/,Ok\n,Vuoto\nhttps://example.com/x,Fuori';
  const r = parseCsvBuffer(csv, 't.csv');
  assert.equal(r.valid.length, 1);
  assert.deepEqual(
    r.invalid.map((i) => i.row),
    [3, 4],
  );
});

test('counts the rows whose URL was rebuilt from a slug', () => {
  const csv = 'profile_url,nome\nmario-rossi,Mario\nhttps://www.linkedin.com/in/vero/,Vero';
  const r = parseCsvBuffer(csv, 't.csv');
  assert.equal(r.inferred.length, 1);
  assert.equal(r.inferred[0]!.row, 2);
  assert.equal(r.inferred[0]!.input, 'mario-rossi');
});
