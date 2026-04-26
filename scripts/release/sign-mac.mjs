#!/usr/bin/env node
/*
 * Walks a built NetraRT.app and re-signs every nested executable / dylib
 * with hardened runtime + entitlements. Tauri's default signing covers
 * the main binary; this catches the externalBin sidecar and the framework
 * dylib that need explicit treatment for notarization to succeed.
 *
 * Run AFTER `tauri build` and BEFORE `xcrun notarytool submit`.
 *
 * Required env:
 *   APPLE_SIGNING_IDENTITY  e.g. "Developer ID Application: <Name> (TEAMID)"
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { platform } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

if (platform() !== 'darwin') {
  console.log('[sign-mac] skip — not macOS');
  process.exit(0);
}

const identity = process.env.APPLE_SIGNING_IDENTITY;
if (!identity) {
  console.error('[sign-mac] APPLE_SIGNING_IDENTITY not set');
  process.exit(1);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..', '..');

const triple =
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  (() => {
    const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
    return out.match(/host:\s*(\S+)/)[1];
  })();

const appPath = resolve(
  projectRoot,
  'apps/app/src-tauri/target',
  triple,
  'release/bundle/macos/NetraRT.app',
);
if (!existsSync(appPath)) {
  console.error(`[sign-mac] .app not found for triple ${triple}: ${appPath}`);
  process.exit(1);
}

const entitlements = resolve(projectRoot, 'apps/app/src-tauri/entitlements.plist');

function signOne(path, opts = []) {
  execFileSync(
    'codesign',
    [
      '--force',
      '--sign', identity,
      '--options', 'runtime',
      '--timestamp',
      '--entitlements', entitlements,
      ...opts,
      path,
    ],
    { stdio: 'inherit' },
  );
}

function walk(dir, callback) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, callback);
    } else {
      callback(full);
    }
  }
}

const macho = [];
walk(appPath, (file) => {
  if (file.endsWith('.dylib')) {
    macho.push(file);
  } else if (file.includes('/Contents/MacOS/') && !file.endsWith('.plist')) {
    macho.push(file);
  } else if (file.includes('/Contents/Resources/_up_/binaries/') && !file.endsWith('.zip')) {
    macho.push(file);
  }
});

for (const file of macho) {
  console.log(`[sign-mac] signing: ${file}`);
  signOne(file);
}

console.log(`[sign-mac] signing app bundle: ${appPath}`);
signOne(appPath, ['--deep']);

execFileSync(
  'codesign',
  ['--verify', '--deep', '--strict', '--verbose=2', appPath],
  { stdio: 'inherit' },
);
console.log(`[sign-mac] verified ok`);
