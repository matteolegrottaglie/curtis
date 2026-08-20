// ============================================================
//  Safety settings: read and partial update.
//
//  The update accepts a partial patch (far more usable from chat:
//  "drop invites to 10/day" touches a single field) and validates it
//  as a complete config before saving it.
// ============================================================
import * as repo from '../db/repo.js';
import * as controller from '../safety/controller.js';
import { safetyConfigSchema, type SafetyConfigPatch } from '../mcp/schemas.js';
import type { SafetyConfig } from '../types.js';

export function getSafetySettings(): SafetyConfig {
  return repo.getSafetyConfig();
}

/** Merges the patch over the current config, validates the result, saves. */
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
    throw new Error(`invalid settings — ${issues}`);
  }

  repo.saveSafetyConfig(parsed.data);
  // The adaptive cap must not stay above the one just configured.
  controller.recomputeDaily();
  return repo.getSafetyConfig();
}
