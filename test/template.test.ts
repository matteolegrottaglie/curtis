// Message templates: placeholders, spintax, cleanup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTemplate, unknownPlaceholders } from '../src/sequencer/template.js';
import type { Contact } from '../src/types.js';

function contact(over: Partial<Contact> = {}): Contact {
  return {
    id: 'c1',
    profile_url: 'https://www.linkedin.com/in/mario-rossi/',
    public_id: 'mario-rossi',
    first_name: 'Mario',
    last_name: 'Rossi',
    full_name: 'Mario Rossi',
    headline: 'CEO @ Acme',
    company: 'Acme',
    location: 'Milano',
    email: null,
    custom: null,
    source: 'test.csv',
    created_at: 0,
    ...over,
  };
}

test('substitutes the known placeholders', () => {
  const out = renderTemplate('Ciao {firstName} di {company}, {headline} a {location}?', contact());
  assert.equal(out, 'Ciao Mario di Acme, CEO @ Acme a Milano?');
});

test('derives firstName from full_name when first_name is missing', () => {
  const out = renderTemplate('Hi {firstName}', contact({ first_name: null, full_name: 'Giulia Bianchi' }));
  assert.equal(out, 'Hi Giulia');
});

test('reads the extra columns from custom.*', () => {
  const c = contact({ custom: JSON.stringify({ Industry: 'Software', Source: 'Trade show' }) });
  assert.equal(renderTemplate('I see you work in {custom.Industry}', c), 'I see you work in Software');
  assert.equal(renderTemplate('x{custom.DoesNotExist}y', c), 'xy');
});

test('malformed custom does not blow up the rendering', () => {
  const c = contact({ custom: '{not json' });
  assert.equal(renderTemplate('a {custom.X} b', c), 'a b');
});

test('spintax picks one of the variants', () => {
  const c = contact();
  const seen = new Set<string>();
  for (let i = 0; i < 60; i++) seen.add(renderTemplate('{Hi|Hello|Hey} Mario', c));
  assert.ok(seen.size > 1, 'spintax must vary between runs');
  for (const s of seen) assert.match(s, /^(Hi|Hello|Hey) Mario$/);
});

test('empty placeholders leave no double spaces or spaces before punctuation', () => {
  const c = contact({ company: null });
  assert.equal(renderTemplate('Hi {firstName} from {company} , how are you?', c), 'Hi Mario from, how are you?');
});

test('unknownPlaceholders reports only the unrecognized placeholders', () => {
  const found = unknownPlaceholders('Ciao {firstName} da {azienda}, {custom.X} {Ciao|Salve}');
  assert.deepEqual(found, ['azienda']);
});
