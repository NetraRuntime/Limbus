import { existsSync, readdirSync } from 'node:fs';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

export function sam3LibraryCandidates({ platform, buildDir }) {
  const dir = resolve(buildDir);
  if (platform === 'win32') {
    return [
      resolve(dir, 'Release', 'sam3.dll'),
      resolve(dir, 'Debug', 'sam3.dll'),
      resolve(dir, 'sam3.dll'),
    ];
  }
  if (platform === 'darwin') return [resolve(dir, 'libsam3.dylib')];
  return [resolve(dir, 'libsam3.so')];
}

export function findFirstExisting(paths, exists = existsSync) {
  return paths.find((path) => exists(path));
}

export function runtimeDllCandidates({ platform, buildDir }) {
  if (platform !== 'win32') return [];

  const dirs = [
    resolve(buildDir, 'Release'),
    resolve(buildDir, 'Debug'),
    resolve(buildDir),
  ];
  const seen = new Set();
  const dlls = [];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.toLowerCase().endsWith('.dll')) continue;
      const path = resolve(dir, name);
      const key = path.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      dlls.push(path);
    }
  }

  return dlls;
}

export async function stageRuntimeDlls({ platform, buildDir, stageDir }) {
  if (platform !== 'win32') return [];

  const dlls = runtimeDllCandidates({ platform, buildDir });
  await rm(stageDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });

  const staged = [];
  for (const dll of dlls) {
    const dest = join(stageDir, basename(dll));
    await copyFile(dll, dest);
    staged.push(dest);
  }
  return staged;
}
