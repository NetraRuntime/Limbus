#!/usr/bin/env node
// Copies pb/pocketbase → src-tauri/binaries/pocketbase-<target-triple>[.exe]
// so Tauri's sidecar bundling (`externalBin: ["binaries/pocketbase"]`) can
// find a per-platform executable to ship. Runs before every `tauri dev` and
// `tauri build` via the `beforeDevCommand` / `beforeBuildCommand` hooks.
//
// Target triple resolution order:
//   1. TAURI_ENV_TARGET_TRIPLE (injected by `tauri build --target ...`)
//   2. `rustc -vV` host triple (the current machine)
//
// The pb/pocketbase source is gitignored — developers install it once
// (see README / `scripts/fetch-pocketbase.*`). CI/release pipelines should
// download the matching binary for the target before invoking `tauri build`.

import { execSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const isWindowsHost = platform() === 'win32';
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');

const resolveTriple = () => {
  if (process.env.TAURI_ENV_TARGET_TRIPLE) return process.env.TAURI_ENV_TARGET_TRIPLE;
  try {
    const out = execSync('rustc -vV', { encoding: 'utf8' });
    const match = out.match(/host:\s*(\S+)/);
    if (match) return match[1];
  } catch (err) {
    // fall through to the explicit error below
  }
  throw new Error(
    'Unable to determine target triple. Install rustc or set TAURI_ENV_TARGET_TRIPLE.',
  );
};

const triple = resolveTriple();
// Tauri appends `.exe` on Windows targets regardless of host. Detect from
// the triple itself so cross-builds name the binary correctly.
const targetExt = triple.includes('windows') ? '.exe' : '';
const sourceName = isWindowsHost ? 'pocketbase.exe' : 'pocketbase';

const sourcePath = resolve(projectRoot, 'pb', sourceName);
const destDir = resolve(projectRoot, 'src-tauri', 'binaries');
const destPath = resolve(destDir, `pocketbase-${triple}${targetExt}`);

if (!existsSync(sourcePath)) {
  console.error(`[stage-pocketbase] missing source binary: ${sourcePath}`);
  console.error(
    '[stage-pocketbase] download the matching PocketBase release and place it at pb/pocketbase',
  );
  console.error('[stage-pocketbase] https://github.com/pocketbase/pocketbase/releases');
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(sourcePath, destPath);
if (!targetExt) {
  // Preserve the +x bit lost by some copyFileSync implementations on macOS/Linux.
  chmodSync(destPath, 0o755);
}

console.log(`[stage-pocketbase] ${sourcePath} -> ${destPath}`);
