// ============================================================
//  The `prepare` hook: compile before the package is used.
//
//  In a dev checkout this is just `tsc` — `npm install` has already put the
//  compiler in node_modules/.bin and there is nothing to arrange.
//
//  The exception is the command in the README:
//
//      npm install -g "git+https://github.com/matteolegrottaglie/curtis.git"
//
//  npm clones the repo into its cache and runs `prepare` there, but the inner
//  install inherits npm_config_global=true from the outer one. So it installs
//  nothing into the clone, and the hook fires with an empty node_modules: no
//  compiler, `sh: tsc: command not found`, and the whole install rolls back.
//  Measured: it fails every time, never halfway, and only with -g — the same
//  URL installed locally builds fine.
//
//  So when the compiler is missing, install the dependencies here with the
//  global flag forced off. --ignore-scripts earns its place twice over: it
//  skips better-sqlite3's prebuild download, which the outer install does
//  again in the real location anyway, and it stops this very hook from firing
//  a second time inside its own install.
//
//  Not just typescript: `tsc` type-checks src/, which imports playwright, zod,
//  better-sqlite3 and the rest, so those packages have to be on disk for
//  module resolution to work at all.
//
//  And then the node_modules has to go. npm packs this clone straight into the
//  tarball it installs, `files` and all, so a node_modules left lying around
//  gets extracted over the tree npm is concurrently filling with the real
//  dependencies — the install dies mid-unpack on
//  `ENOENT: Cannot cd into …/curtis/node_modules/fast-safe-stringify`.
//  Only ever removes what this script itself installed.
// ============================================================
import { existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const nodeModules = fileURLToPath(new URL('../node_modules', import.meta.url));
const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(cmd, args, env) {
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
}

const bootstrapped = !existsSync(tsc);

if (bootstrapped) {
  console.log('curtis: the TypeScript compiler is missing, installing the build dependencies…');
  run(
    npm,
    ['install', '--include=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--no-progress'],
    // The reason this script exists. Without it the inner install goes global
    // too and the clone stays as empty as it was.
    { npm_config_global: 'false' },
  );
}

try {
  run(process.execPath, [tsc, '-p', 'tsconfig.json']);
} finally {
  if (bootstrapped) rmSync(nodeModules, { recursive: true, force: true });
}
