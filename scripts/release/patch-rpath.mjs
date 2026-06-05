#!/usr/bin/env node
/*
 * Patches RPATH on the staged Linux Netra Limbus binary so it resolves
 * libsam3.so from the bundled location rather than a developer's
 * absolute build path.
 *
 * Called by tauri.conf.json's beforeBundleCommand on Linux.
 * No-op on macOS and Windows.
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

if (platform() !== 'linux') {
  console.log('[patch-rpath] skip — not Linux');
  process.exit(0);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..', '..');

const triple =
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  (() => {
    const out = execSync('rustc -vV', { encoding: 'utf8' });
    const m = out.match(/host:\s*(\S+)/);
    if (!m) throw new Error('Cannot determine target triple');
    return m[1];
  })();

const binPath = resolve(
  projectRoot,
  'apps/app/src-tauri/target',
  triple,
  'release/netra-limbus',
);

if (!existsSync(binPath)) {
  console.error(`[patch-rpath] binary not found: ${binPath}`);
  process.exit(1);
}

try {
  execFileSync('patchelf', ['--version'], { stdio: 'ignore' });
} catch {
  console.error('[patch-rpath] patchelf not installed (apt-get install patchelf)');
  process.exit(1);
}

const rpath = '$ORIGIN/../lib/netra-limbus';
console.log(`[patch-rpath] setting RPATH=${rpath} on ${binPath}`);
execFileSync('patchelf', ['--set-rpath', rpath, binPath], { stdio: 'inherit' });

const out = execFileSync('patchelf', ['--print-rpath', binPath], { encoding: 'utf8' });
console.log(`[patch-rpath] verified: ${out.trim()}`);
