// ============================================================
//  Impostazioni di sicurezza: lettura e aggiornamento parziale.
//
//  L'aggiornamento accetta una patch parziale (molto più usabile da
//  chat: "abbassa gli inviti a 10/giorno" tocca un solo campo) e la
//  valida come config completa prima di salvarla.
// ============================================================
import * as repo from '../db/repo.js';
import * as controller from '../safety/controller.js';
import { safetyConfigSchema, type SafetyConfigPatch } from '../mcp/schemas.js';
import type { SafetyConfig } from '../types.js';

export function getSafetySettings(): SafetyConfig {
  return repo.getSafetyConfig();
}

/** Fonde la patch sopra la config corrente, valida il risultato, salva. */
export function updateSafetySettings(patch: SafetyConfigPatch): SafetyConfig {
  const current = repo.getSafetyConfig();
  const merged: SafetyConfig = {
    ...current,
    ...patch,
    caps: { ...current.caps, ...(patch.caps ?? {}) },
    delays: { ...current.delays, ...(patch.delays ?? {}) },
    ramp: patch.ramp ?? current.ramp,
  };

  const parsed = safetyConfigSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new Error(`impostazioni non valide — ${issues}`);
  }

  repo.saveSafetyConfig(parsed.data);
  // Il tetto adattivo non deve restare sopra quello appena configurato.
  controller.recomputeDaily();
  return repo.getSafetyConfig();
}
