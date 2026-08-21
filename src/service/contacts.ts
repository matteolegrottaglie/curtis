// ============================================================
//  Contacts: CSV import, listing, deletion.
//
//  The contact IDs from an import stay in memory under a short
//  `import_id`: that way from chat you can say "enroll the contacts
//  I just imported" without the tool having to hand back thousands
//  of UUIDs in the result.
// ============================================================
import { openSync, closeSync, fstatSync, readSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import * as repo from '../db/repo.js';
import { getDb } from '../db/index.js';
import { parseCsvBuffer } from '../importer/csv.js';
import { sanitizeUntrusted } from '../util/text.js';
import type { Contact } from '../types.js';

/** Upper bound for a CSV, from disk or pasted. A contact list is never this big. */
const MAX_CSV_BYTES = 25 * 1024 * 1024;
const MAX_CSV_MB = MAX_CSV_BYTES / 1024 / 1024;

function tooLarge(): Error {
  return new Error(`CSV too large: the limit is ${MAX_CSV_MB} MB`);
}

/**
 * Reads a CSV from disk with a hard ceiling on the bytes actually read.
 *
 * The path comes from an MCP tool call, i.e. from a model, i.e. from untrusted
 * input. Two separate checks:
 *
 *  - `statSync` before opening, so a FIFO or a device node is refused *without*
 *    being opened (opening a FIFO for reading blocks until a writer shows up,
 *    which would hang the daemon).
 *  - the read loop counts bytes instead of trusting `st.size`. A stat size is a
 *    hint, not a promise: /proc and /sys entries on Linux are regular files that
 *    report 0 and still yield unbounded data, and Node's own readFileSync
 *    comments that "the kernel lies about many files". `fstatSync` on the open
 *    descriptor re-checks the file type, so the answer describes the bytes being
 *    read rather than whatever the path pointed at a moment earlier.
 */
function readCsvFile(filePath: string): string {
  let pre;
  try {
    pre = statSync(filePath);
  } catch {
    throw new Error(`\`file_path\` not readable: ${filePath}`);
  }
  if (!pre.isFile()) throw new Error('`file_path` must point to a regular file');
  if (pre.size > MAX_CSV_BYTES) throw tooLarge();

  let fd: number;
  try {
    fd = openSync(filePath, 'r');
  } catch {
    throw new Error(`\`file_path\` not readable: ${filePath}`);
  }
  try {
    if (!fstatSync(fd).isFile()) throw new Error('`file_path` must point to a regular file');
    const chunks: Buffer[] = [];
    const buf = Buffer.allocUnsafe(1 << 20);
    let total = 0;
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      total += n;
      if (total > MAX_CSV_BYTES) throw tooLarge();
      chunks.push(Buffer.from(buf.subarray(0, n)));
    }
    return Buffer.concat(chunks, total).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

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

/** Most recent imports of the daemon session: import_id -> contact IDs. */
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
  // Sanitised here as well as at import: a database filled before the import
  // path started cleaning still holds whatever the CSV had in it, and this is
  // the last point before the values reach a model.
  const name = c.full_name ?? ([c.first_name, c.last_name].filter(Boolean).join(' ') || null);
  return {
    id: c.id,
    full_name: name ? sanitizeUntrusted(name, 120) : null,
    company: c.company ? sanitizeUntrusted(c.company, 120) : null,
    profile_url: c.profile_url,
  };
}

/**
 * Imports contacts from a CSV file on disk or from CSV pasted into chat.
 * Deduplicates by `profile_url`: duplicates are not re-inserted, but their IDs
 * are still part of the import (so they can be enrolled in a campaign).
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
    // Same budget as the on-disk branch. `csv_content` reaches the daemon over
    // the same tool call, so capping only `file_path` would just move the
    // memory blow-up one argument to the left.
    if (Buffer.byteLength(opts.csvContent, 'utf8') > MAX_CSV_BYTES) throw tooLarge();
    content = opts.csvContent;
    source = 'pasted-in-chat';
  } else if (opts.filePath) {
    content = readCsvFile(opts.filePath);
    source = basename(opts.filePath);
  } else {
    throw new Error('`file_path` or `csv_content` is required');
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

/** Every contact ID in the DB (used by `enroll_contacts` with `all: true`). */
export function allContactIds(): string[] {
  return (getDb().prepare('SELECT id FROM contacts').all() as { id: string }[]).map((r) => r.id);
}

/**
 * Resolves the contact selection used by the tools: a recent import, an
 * explicit list of IDs, or every contact in the DB.
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
        `import_id "${sel.import_id}" not found (was the daemon restarted?). Re-import the file, or use contact_ids/all.`,
      );
    }
    return ids;
  }
  if (sel.contact_ids?.length) return sel.contact_ids;
  if (sel.all) return allContactIds();
  throw new Error('`import_id`, `contact_ids` or `all: true` is required');
}
