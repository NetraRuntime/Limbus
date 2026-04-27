#!/usr/bin/env node
/*
 * Build vendor/sam3.c as a shared library.
 *
 * Invokes CMake with SAM3_SHARED=ON and produces
 * vendor/sam3.c/build/libsam3.{dylib,so,dll}. Idempotent: CMake's own
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
const isWin = platform() === 'win32';
const libName = isMac
  ? 'libsam3.dylib'
  : isWin
    ? 'libsam3.dll'
    : 'libsam3.so';

const configureArgs = [
  '-S', sam3Dir,
  '-B', buildDir,
  '-DSAM3_SHARED=ON',
  '-DSAM3_BLAS=ON',
  '-DCMAKE_BUILD_TYPE=Release',
  '-DSAM3_TESTS=OFF',
  // Video subsystem pulls libvpx + openh264 from source which doesnt
  // configure cleanly under MinGW. Disable on Windows for now.
  ...(isWin ? ['-DSAM3_VIDEO=OFF', '-G', 'MinGW Makefiles'] : []),
  // Metal backend (MLX-C) for GPU acceleration on macOS.
  ...(isMac ? ['-DSAM3_METAL=ON'] : []),
];

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