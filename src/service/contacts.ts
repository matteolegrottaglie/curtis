// ============================================================
//  Contatti: import CSV, elenco, cancellazione.
//
//  Gli ID dei contatti di un import restano in memoria sotto un
//  `import_id` breve: così da chat si può dire "iscrivi i contatti
//  che ho appena importato" senza che il tool debba restituire
//  migliaia di UUID nel risultato.
// ============================================================
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import * as repo from '../db/repo.js';
import { getDb } from '../db/index.js';
import { parseCsvBuffer } from '../importer/csv.js';
import type { Contact } from '../types.js';

export interface ContactPreview {
  id: string;
  full_name: string | null;
  company: string | null;
  profile_url: string;
}

export interface ImportOutcome {
  import_id: string;
  source: string;
  rows_total: number;
  rows_valid: number;
  inserted: number;
  duplicates: number;
  rows_invalid: number;
  invalid_sample: { row: number; reason: string }[];
  rows_url_inferred: number;
  url_inferred_sample: { row: number; input: string; url: string }[];
  contact_count: number;
  preview: ContactPreview[];
}

/** Ultimi import della sessione del daemon: import_id -> ID dei contatti. */
const recentImports = new Map<string, string[]>();
const MAX_REMEMBERED_IMPORTS = 20;

export function contactIdsForImport(importId: string): string[] | undefined {
  return recentImports.get(importId);
}

function rememberImport(ids: string[]): string {
  const id = randomUUID().slice(0, 8);
  recentImports.set(id, ids);
  while (recentImports.size > MAX_REMEMBERED_IMPORTS) {
    const oldest = recentImports.keys().next().value;
    if (oldest === undefined) break;
    recentImports.delete(oldest);
  }
  return id;
}

function toPreview(c: Contact): ContactPreview {
  return {
    id: c.id,
    full_name: c.full_name ?? ([c.first_name, c.last_name].filter(Boolean).join(' ') || null),
    company: c.company,
    profile_url: c.profile_url,
  };
}

/**
 * Importa contatti da un file CSV su disco oppure da CSV incollato in chat.
 * Deduplica per `profile_url`: i duplicati non vengono reinseriti ma i loro ID
 * fanno comunque parte dell'import (così si possono iscrivere a una campagna).
 */
export function importContacts(opts: {
  filePath?: string;
  csvContent?: string;
  previewLimit?: number;
}): ImportOutcome {
  const previewLimit = Math.min(Math.max(opts.previewLimit ?? 5, 0), 50);

  let content: string;
  let source: string;
  if (opts.csvContent && opts.csvContent.trim()) {
    content = opts.csvContent;
    source = 'incollato-in-chat';
  } else if (opts.filePath) {
    content = readFileSync(opts.filePath, 'utf8');
    source = basename(opts.filePath);
  } else {
    throw new Error('serve `file_path` oppure `csv_content`');
  }

  const parsed = parseCsvBuffer(content, source);
  const { inserted, skipped, ids } = repo.upsertContacts(parsed.valid);
  const importId = rememberImport(ids);

  return {
    import_id: importId,
    source,
    rows_total: parsed.total,
    rows_valid: parsed.valid.length,
    inserted,
    duplicates: skipped,
    rows_invalid: parsed.invalid.length,
    invalid_sample: parsed.invalid.slice(0, 10),
    rows_url_inferred: parsed.inferred.length,
    url_inferred_sample: parsed.inferred.slice(0, 10),
    contact_count: ids.length,
    preview: repo.getContactsByIds(ids.slice(0, previewLimit)).map(toPreview),
  };
}

export function listContacts(opts: { search?: string; limit?: number; offset?: number }): {
  total: number;
  returned: number;
  contacts: ContactPreview[];
} {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const rows = repo.listContacts({ ...(opts.search ? { search: opts.search } : {}), limit, offset });
  return { total: repo.countContacts(), returned: rows.length, contacts: rows.map(toPreview) };
}

export function deleteContacts(ids: string[], onlyUnenrolled: boolean): number {
  return repo.deleteContactsByIds(ids, onlyUnenrolled);
}

/** Tutti gli ID contatto in DB (usato da `enroll_contacts` con `all: true`). */
export function allContactIds(): string[] {
  return (getDb().prepare('SELECT id FROM contacts').all() as { id: string }[]).map((r) => r.id);
}

/**
 * Risolve la selezione di contatti usata dai tool: import recente, lista
 * esplicita di ID, oppure tutti i contatti in DB.
 */
export function resolveContactIds(sel: {
  import_id?: string;
  contact_ids?: string[];
  all?: boolean;
}): string[] {
  if (sel.import_id) {
    const ids = contactIdsForImport(sel.import_id);
    if (!ids) {
      throw new Error(
        `import_id "${sel.import_id}" non trovato (il daemon è stato riavviato?). Reimporta il file, oppure usa contact_ids/all.`,
      );
    }
    return ids;
  }
  if (sel.contact_ids?.length) return sel.contact_ids;
  if (sel.all) return allContactIds();
  throw new Error('serve `import_id`, `contact_ids` oppure `all: true`');
}
