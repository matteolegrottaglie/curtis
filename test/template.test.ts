// Template dei messaggi: placeholder, spintax, pulizia.
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

test('sostituisce i placeholder noti', () => {
  const out = renderTemplate('Ciao {firstName} di {company}, {headline} a {location}?', contact());
  assert.equal(out, 'Ciao Mario di Acme, CEO @ Acme a Milano?');
});

test('deriva firstName da full_name quando first_name manca', () => {
  const out = renderTemplate('Ciao {firstName}', contact({ first_name: null, full_name: 'Giulia Bianchi' }));
  assert.equal(out, 'Ciao Giulia');
});

test('legge le colonne extra da custom.*', () => {
  const c = contact({ custom: JSON.stringify({ Settore: 'Software', Fonte: 'Fiera' }) });
  assert.equal(renderTemplate('Vedo che lavori nel {custom.Settore}', c), 'Vedo che lavori nel Software');
  assert.equal(renderTemplate('x{custom.NonEsiste}y', c), 'xy');
});

test('custom malformato non fa esplodere il rendering', () => {
  const c = contact({ custom: '{non json' });
  assert.equal(renderTemplate('a {custom.X} b', c), 'a b');
});

test('lo spintax sceglie una delle varianti', () => {
  const c = contact();
  const seen = new Set<string>();
  for (let i = 0; i < 60; i++) seen.add(renderTemplate('{Ciao|Salve|Buongiorno} Mario', c));
  assert.ok(seen.size > 1, 'lo spintax deve variare fra le esecuzioni');
  for (const s of seen) assert.match(s, /^(Ciao|Salve|Buongiorno) Mario$/);
});

test('i placeholder vuoti non lasciano spazi doppi o prima della punteggiatura', () => {
  const c = contact({ company: null });
  assert.equal(renderTemplate('Ciao {firstName} di {company} , come va?', c), 'Ciao Mario di, come va?');
});

test('unknownPlaceholders segnala solo i placeholder non riconosciuti', () => {
  const found = unknownPlaceholders('Ciao {firstName} da {azienda}, {custom.X} {Ciao|Salve}');
  assert.deepEqual(found, ['azienda']);
});
