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
  // The host check reads u.hostname, so userinfo before the "@" is not the
  // host — but only because new URL() parses it away. Pin that: a hand-rolled
  // string check on the raw URL would read "linkedin.com" here and be wrong.
  assert.equal(normalizeProfileUrl('https://linkedin.com@evil.test/in/mario-rossi/'), null);
  assert.equal(normalizeProfileUrl('http://linkedin.com:8080@evil.test/in/mario-rossi/'), null);
  // Tab/newline are stripped by the URL parser rather than splitting the host,
  // which is exactly how the old unanchored regex could be walked past.
  assert.equal(normalizeProfileUrl('https://evil.com\nlinkedin.com/in/mario-rossi/'), null);
  // IDN: "。" (U+3002) is mapped to "." by IDNA, so the label boundaries the
  // regex sees are the ones DNS will see, not the ones in the source text.
  assert.equal(normalizeProfileUrl('https://linkedin.com。evil.test/in/mario-rossi/'), null);
  // Homoglyph: "ı" (dotless i) punycodes to a different domain entirely.
  assert.equal(normalizeProfileUrl('https://liınkedin.com/in/mario-rossi/'), null);
});

test('a malformed percent-escape invalidates one row, it does not kill the import', () => {
  // new URL() does not validate percent-escapes, so "%ZZ" reaches
  // decodeURIComponent and used to throw a URIError right out of
  // parseCsvBuffer — discarding every valid row in the file with it.
  assert.equal(normalizeProfileUrl('https://www.linkedin.com/in/mario%ZZrossi/'), null);
  assert.equal(normalizeProfileUrl('https://www.linkedin.com/in/%E0%A4%A/'), null);

  const csv = [
    'profile_url,nome',
    'https://www.linkedin.com/in/mario-rossi/,Mario',
    'https://www.linkedin.com/in/giulia%ZZbianchi/,Giulia',
    'https://www.linkedin.com/in/luca-verdi/,Luca',
  ].join('\n');
  const r = parseCsvBuffer(csv, 't.csv');
  assert.equal(r.total, 3);
  assert.equal(r.valid.length, 2);
  assert.deepEqual(r.valid.map((c) => c.public_id), ['mario-rossi', 'luca-verdi']);
  assert.deepEqual(r.invalid, [{ row: 3, reason: 'Missing or invalid LinkedIn profile URL' }]);
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
