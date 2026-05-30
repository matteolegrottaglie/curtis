// ============================================================
//  Template dei messaggi/note.
//  Supporta:
//   - placeholder: {firstName} {lastName} {fullName} {company}
//                  {headline} {location} {custom.NOME_COLONNA}
//   - spintax:     {ciao|salve|buongiorno}  (scelta casuale)
//  La variazione (spintax) è importante: messaggi identici inviati
//  in massa sono uno dei segnali di bot più forti.
// ============================================================
import type { Contact } from '../types.js';
import { pick } from '../util/rand.js';

function firstNameOf(c: Contact): string {
  if (c.first_name) return c.first_name;
  if (c.full_name) return c.full_name.trim().split(/\s+/)[0] ?? '';
  return '';
}

function resolveField(c: Contact, key: string): string {
  if (key.startsWith('custom.')) {
    const col = key.slice('custom.'.length);
    if (!c.custom) return '';
    try {
      const obj = JSON.parse(c.custom) as Record<string, string>;
      return obj[col] ?? '';
    } catch {
      return '';
    }
  }
  switch (key) {
    case 'firstName':
      return firstNameOf(c);
    case 'lastName':
      return c.last_name ?? '';
    case 'fullName':
      return c.full_name ?? `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
    case 'company':
      return c.company ?? '';
    case 'headline':
      return c.headline ?? '';
    case 'location':
      return c.location ?? '';
    default:
      return '';
  }
}

export function renderTemplate(tpl: string, c: Contact): string {
  // Risolvi i {...}: se contiene '|' è spintax, altrimenti placeholder.
  const out = tpl.replace(/\{([^{}]*)\}/g, (_m, inner: string) => {
    if (inner.includes('|')) return (pick(inner.split('|')) ?? '').trim();
    return resolveField(c, inner.trim());
  });
  // Pulizia spazi doppi lasciati da placeholder vuoti.
  return out.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
}

/** Validazione veloce: ci sono placeholder non riconosciuti? (solo per UX) */
export function unknownPlaceholders(tpl: string): string[] {
  const known = new Set(['firstName', 'lastName', 'fullName', 'company', 'headline', 'location']);
  const found: string[] = [];
  for (const m of tpl.matchAll(/\{([^{}|]*)\}/g)) {
    const k = (m[1] ?? '').trim();
    if (!k || k.startsWith('custom.') || known.has(k)) continue;
    found.push(k);
  }
  return found;
}
