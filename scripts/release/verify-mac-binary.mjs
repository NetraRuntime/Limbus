#!/usr/bin/env node
/*
 * Asserts the built macOS binary's libsam3.dylib reference resolves
 * via @rpath/ (relocatable), not an absolute /Users/... path that would
 * pass codesign locally but fail when shipped.
 */

import { execSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

if (platform() !== 'darwin') {
  console.log('[verify-mac-binary] skip — not macOS');
  process.exit(0);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..', '..');

const triple =
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  (() => {
    const out = execSync('rustc -vV', { encoding: 'utf8' });
    return out.match(/host:\s*(\S+)/)[1];
  })();

const appPath = resolve(
  projectRoot,
  'apps/app/src-tauri/target',
  triple,
  'release/bundle/macos/NetraLimbus.app/Contents/MacOS/NetraLimbus',
);

if (!existsSync(appPath)) {
  console.error(`[verify-mac-binary] not found: ${appPath}`);
  process.exit(1);
}

const out = execFileSync('otool', ['-L', appPath], { encoding: 'utf8' });
console.log(out);

const sam3Line = out.split('\n').find((l) => l.includes('libsam3'));
if (!sam3Line) {
  console.error('[verify-mac-binary] libsam3 reference missing entirely');
  process.exit(1);
}
if (!sam3Line.trim().startsWith('@rpath/')) {
  console.error(`[verify-mac-binary] libsam3 not @rpath-relative: ${sam3Line.trim()}`);
  console.error('[verify-mac-binary] this binary will fail Gatekeeper on user machines');
  process.exit(1);
}
console.log('[verify-mac-binary] ok — @rpath/libsam3.dylib');
