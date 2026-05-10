#!/usr/bin/env node
/*
 * Build vendor/sam3.c as a shared library.
 *
 * Invokes CMake with SAM3_SHARED=ON and produces
 * vendor/sam3.c/build/libsam3.{dylib,so} or a Windows sam3.dll. Idempotent: CMake's own
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

import {
  findFirstExisting,
  sam3LibraryCandidates,
  stageRuntimeDlls,
} from './sam3-artifacts.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const sam3Dir = resolve(projectRoot, 'vendor', 'sam3.c');
const buildDir = resolve(sam3Dir, 'build');
const runtimeStageDir = resolve(
  projectRoot,
  'apps',
  'app',
  'src-tauri',
  'binaries',
  'sam3-runtime',
);

if (!existsSync(resolve(sam3Dir, 'CMakeLists.txt'))) {
  console.error('[build-sam3] vendor/sam3.c is not checked out.');
  console.error('[build-sam3] run: git submodule update --init --recursive');
  process.exit(1);
}

mkdirSync(buildDir, { recursive: true });

const hostPlatform = platform();
const isMac = hostPlatform === 'darwin';
const isWin = hostPlatform === 'win32';

const vcpkgToolchain = process.env.CMAKE_TOOLCHAIN_FILE
  || (process.env.VCPKG_ROOT
    ? resolve(process.env.VCPKG_ROOT, 'scripts', 'buildsystems', 'vcpkg.cmake')
    : undefined);

const configureArgs = [
  '-S', sam3Dir,
  '-B', buildDir,
  ...(isWin ? ['-G', 'Visual Studio 17 2022', '-A', 'x64'] : []),
  ...(isWin && vcpkgToolchain ? [`-DCMAKE_TOOLCHAIN_FILE=${vcpkgToolchain}`] : []),
  '-DSAM3_SHARED=ON',
  '-DCMAKE_BUILD_TYPE=Release',
  '-DSAM3_TESTS=OFF',
  ...(isWin ? ['-DSAM3_VIDEO=ON', '-DSAM3_BLAS=ON'] : []),
  // Metal backend (MLX-C) for GPU acceleration. The CMake option() at the
  // top of vendor/sam3.c/CMakeLists.txt defaults to OFF and defeats the
  // "auto-enable on APPLE" fallback below it, so we set it explicitly.
  // First configure pulls mlx-c over git; subsequent builds are cached.
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

const producedLib = findFirstExisting(
  sam3LibraryCandidates({ platform: hostPlatform, buildDir }),
);
if (!producedLib) {
  console.error('[build-sam3] expected artifact not found in any of:');
  for (const candidate of sam3LibraryCandidates({ platform: hostPlatform, buildDir })) {
    console.error(`  ${candidate}`);
  }
  process.exit(1);
}

console.log(`[build-sam3] ok: ${producedLib}`);

if (isWin) {
  const staged = await stageRuntimeDlls({
    platform: hostPlatform,
    buildDir,
    stageDir: runtimeStageDir,
  });
  if (staged.length === 0) {
    console.error('[build-sam3] no runtime DLLs were staged');
    process.exit(1);
  }
  console.log(`[build-sam3] staged runtime DLLs: ${runtimeStageDir}`);
}
