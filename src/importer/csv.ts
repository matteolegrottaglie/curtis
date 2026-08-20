// ============================================================
//  CSV import -> contacts.
//  - auto-detects the common columns (IT/EN)
//  - normalizes LinkedIn profile URLs
//  - extra columns end up in `custom` (usable in templates)
// ============================================================
import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import type { ContactInput } from '../db/repo.js';

// Header alias -> canonical field
const FIELD_ALIASES: Record<string, string[]> = {
  profile_url: ['profile_url', 'profileurl', 'url', 'linkedin', 'linkedin url', 'linkedinurl', 'profilo', 'profile', 'link'],
  first_name: ['first_name', 'firstname', 'first name', 'nome'],
  last_name: ['last_name', 'lastname', 'last name', 'cognome'],
  full_name: ['full_name', 'fullname', 'full name', 'name', 'nome completo', 'nominativo'],
  company: ['company', 'company name', 'azienda', 'organizzazione', 'organization'],
  email: ['email', 'e-mail', 'mail', 'indirizzo email'],
  headline: ['headline', 'titolo', 'qualifica', 'ruolo', 'role', 'title'],
  location: ['location', 'località', 'localita', 'city', 'città', 'citta'],
};

function normKey(s: string): string {
  return s.trim().toLowerCase();
}

function buildHeaderMap(headers: string[]): Record<string, string> {
  // original header -> canonical field (or '' if extra)
  const map: Record<string, string> = {};
  for (const h of headers) {
    const nk = normKey(h);
    let canonical = '';
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.includes(nk)) {
        canonical = field;
        break;
      }
    }
    map[h] = canonical;
  }
  return map;
}

/**
 * Normalizes a LinkedIn profile URL. Returns null if invalid or not recognizable.
 *
 * `inferred` flags that the input was a *bare slug* ("mario-rossi") rather than a URL:
 * any word made only of slug-legal characters turns into a syntactically valid URL,
 * so a typo sitting in the wrong column would sail through silently as a profile.
 * Whoever runs the import deserves to know about it.
 */
export function normalizeProfileUrl(
  raw: string,
): { url: string; publicId: string | null; inferred: boolean } | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;

  let inferred = false;
  // bare slug such as "in/mario-rossi" or "mario-rossi"
  if (!/^https?:\/\//i.test(s)) {
    s = s.replace(/^\/+/, '');
    if (s.startsWith('in/')) s = `https://www.linkedin.com/${s}`;
    else if (/^[a-z0-9\-_%]+$/i.test(s)) {
      s = `https://www.linkedin.com/in/${s}`;
      inferred = true;
    } else s = `https://${s}`;
  }

  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  // Anchored on purpose: an unanchored /linkedin\.com$/ also accepts
  // "evil-linkedin.com". The host must be linkedin.com itself or a subdomain.
  if (!/^(?:[a-z0-9-]+\.)*linkedin\.com$/i.test(u.hostname)) return null;

  const m = u.pathname.match(/\/in\/([^/]+)/i);
  const publicId = m && m[1] ? decodeURIComponent(m[1]) : null;
  // canonical URL, without query/fragment
  const path = publicId ? `/in/${encodeURIComponent(publicId)}/` : u.pathname;
  const url = `https://www.linkedin.com${path}`;
  return { url, publicId, inferred };
}

export interface ImportResult {
  total: number;
  valid: ContactInput[];
  invalid: { row: number; reason: string }[];
  /** Rows whose URL was rebuilt from a bare slug: worth double-checking. */
  inferred: { row: number; input: string; url: string }[];
}

export function parseCsvBuffer(content: string, source: string): ImportResult {
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  const headers = records.length > 0 ? Object.keys(records[0]!) : [];
  const headerMap = buildHeaderMap(headers);

  const valid: ContactInput[] = [];
  const invalid: { row: number; reason: string }[] = [];
  const inferred: { row: number; input: string; url: string }[] = [];

  records.forEach((rec, i) => {
    const canon: Record<string, string> = {};
    const custom: Record<string, string> = {};
    for (const [orig, val] of Object.entries(rec)) {
      const field = headerMap[orig];
      if (field) canon[field] = val;
      else if (val && val.trim()) custom[orig.trim()] = val.trim();
    }

    const rawUrl = canon.profile_url ?? '';
    const norm = normalizeProfileUrl(rawUrl);
    if (!norm) {
      invalid.push({ row: i + 2, reason: 'Missing or invalid LinkedIn profile URL' });
      return;
    }
    if (norm.inferred) inferred.push({ row: i + 2, input: rawUrl.trim(), url: norm.url });

    valid.push({
      profile_url: norm.url,
      public_id: norm.publicId,
      first_name: canon.first_name ?? null,
      last_name: canon.last_name ?? null,
      full_name: canon.full_name ?? null,
      headline: canon.headline ?? null,
      company: canon.company ?? null,
      location: canon.location ?? null,
      email: canon.email ?? null,
      custom: Object.keys(custom).length ? custom : null,
      source,
    });
  });

  return { total: records.length, valid, invalid, inferred };
}

export function parseCsvFile(path: string, source: string): ImportResult {
  return parseCsvBuffer(readFileSync(path, 'utf8'), source);
}
