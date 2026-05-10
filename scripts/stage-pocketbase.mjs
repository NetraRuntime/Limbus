#!/usr/bin/env node

import { execFileSync, execSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const isWindowsHost = platform() === 'win32';
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');

const normalizeTriple = (triple) => {
  if (isWindowsHost && triple === 'x86_64-pc-windows-gnu') return 'x86_64-pc-windows-msvc';
  return triple;
};

const resolveTriple = () => {
  if (process.env.TAURI_ENV_TARGET_TRIPLE) {
    return normalizeTriple(process.env.TAURI_ENV_TARGET_TRIPLE);
  }
  if (isWindowsHost) return 'x86_64-pc-windows-msvc';
  try {
    const out = execSync('rustc -vV', { encoding: 'utf8' });
    const match = out.match(/host:\s*(\S+)/);
    if (match) return normalizeTriple(match[1]);
  } catch (err) {
    // fall through to the explicit error below
  }
  throw new Error(
    'Unable to determine target triple. Install rustc or set TAURI_ENV_TARGET_TRIPLE.',
  );
};

const triple = resolveTriple();
const targetExt = triple.includes('windows') ? '.exe' : '';
const sourceName = isWindowsHost ? 'pocketbase.exe' : 'pocketbase';

const sourcePath = resolve(projectRoot, 'pb', sourceName);
const destDir = resolve(projectRoot, 'apps', 'app', 'src-tauri', 'binaries');
const destPath = resolve(destDir, `pocketbase-${triple}${targetExt}`);

// Idempotent: if the destination is already staged (e.g. CI's
// scripts/release/fetch-pocketbase.mjs ran first, or a previous local
// build already copied it), don't fail just because the dev-only
// pb/pocketbase source is missing.
if (existsSync(destPath)) {
  console.log(`[stage-pocketbase] already staged: ${destPath}`);
  process.exit(0);
}

if (!existsSync(sourcePath)) {
  console.error(`[stage-pocketbase] missing source binary: ${sourcePath}`);
  console.error('[stage-pocketbase] fetching pinned PocketBase release');
  try {
    execFileSync(process.execPath, [resolve(projectRoot, 'scripts', 'release', 'fetch-pocketbase.mjs')], {
      stdio: 'inherit',
      env: { ...process.env, TAURI_ENV_TARGET_TRIPLE: triple },
    });
    process.exit(0);
  } catch (err) {
    console.error('[stage-pocketbase] failed to fetch pinned PocketBase release');
    console.error('[stage-pocketbase] https://github.com/pocketbase/pocketbase/releases');
    process.exit(1);
  }
}

mkdirSync(destDir, { recursive: true });
copyFileSync(sourcePath, destPath);
if (!targetExt) {
  // Preserve the +x bit lost by some copyFileSync implementations on macOS/Linux.
  chmodSync(destPath, 0o755);
}

console.log(`[stage-pocketbase] ${sourcePath} -> ${destPath}`);
