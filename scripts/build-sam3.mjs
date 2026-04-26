#!/usr/bin/env node
/*
 * Build vendor/sam3.c as a shared library.
 *
 * Invokes CMake with SAM3_SHARED=ON and produces
 * vendor/sam3.c/build/libsam3.{dylib,so}. Idempotent: CMake's own
 * incremental logic makes re-runs cheap when nothing changed.
 *
 * Called from apps/app/src-tauri/tauri.conf.json via
 * `beforeDevCommand` / `beforeBuildCommand`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const sam3Dir = resolve(projectRoot, 'vendor', 'sam3.c');
const buildDir = resolve(sam3Dir, 'build');

if (!existsSync(resolve(sam3Dir, 'CMakeLists.txt'))) {
  console.error('[build-sam3] vendor/sam3.c is not checked out.');
  console.error('[build-sam3] run: git submodule update --init --recursive');
  process.exit(1);
}

mkdirSync(buildDir, { recursive: true });

const isMac = platform() === 'darwin';
const libName = isMac ? 'libsam3.dylib' : 'libsam3.so';

// Metal backend (MLX-C) on macOS: enabled by default for dev builds.
// Disabled when SAM3_METAL=0 is set — used by CI for the v0.2.0 smoke
// release to keep cold-cache builds under ~10 min while we validate the
// signing/notarization pipeline. Re-enable once caches warm.
const metalEnabled = isMac && process.env.SAM3_METAL !== '0';

const configureArgs = [
  '-S', sam3Dir,
  '-B', buildDir,
  '-DSAM3_SHARED=ON',
  '-DCMAKE_BUILD_TYPE=Release',
  '-DSAM3_TESTS=OFF',
  // The CMake option() at the top of vendor/sam3.c/CMakeLists.txt defaults
  // to OFF and defeats the "auto-enable on APPLE" fallback below it, so we
  // set it explicitly when enabled.
  ...(metalEnabled ? ['-DSAM3_METAL=ON'] : []),
];

console.log(`[build-sam3] metal=${metalEnabled ? 'on' : 'off'}`);

const buildArgs = [
  '--build', buildDir,
  '--config', 'Release',
  '--target', 'sam3',
  '--parallel',
];

function run(bin, args) {
  console.log(`[build-sam3] ${bin} ${args.join(' ')}`);
  execFileSync(bin, args, { stdio: 'inherit' });
}

run('cmake', configureArgs);
run('cmake', buildArgs);

const producedLib = resolve(buildDir, libName);
if (!existsSync(producedLib)) {
  console.error(`[build-sam3] expected artifact not found: ${producedLib}`);
  process.exit(1);
}

console.log(`[build-sam3] ok: ${producedLib}`);
