// ============================================================
//  Package version, read from package.json by walking up from the
//  module's own location (works both from `src/` via tsx and `dist/`).
// ============================================================
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_NAME = 'linkedin-sequencer-mcp';

function readVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === PACKAGE_NAME && pkg.version) return pkg.version;
    } catch {
      // no package.json at this level: go up one
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.0.0';
}

export const VERSION = readVersion();
