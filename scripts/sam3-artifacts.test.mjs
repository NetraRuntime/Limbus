import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  findFirstExisting,
  runtimeDllCandidates,
  sam3LibraryCandidates,
  stageRuntimeDlls,
} from './sam3-artifacts.mjs';

test('Windows prefers Release sam3.dll', () => {
  const buildDir = resolve('vendor/sam3.c/build');
  assert.deepEqual(sam3LibraryCandidates({ platform: 'win32', buildDir }), [
    resolve(buildDir, 'Release', 'sam3.dll'),
    resolve(buildDir, 'Debug', 'sam3.dll'),
    resolve(buildDir, 'sam3.dll'),
  ]);
});

test('Windows accepts flat build sam3.dll', () => {
  const buildDir = resolve('vendor/sam3.c/build');
  const candidates = sam3LibraryCandidates({ platform: 'win32', buildDir });
  const found = findFirstExisting(candidates, (path) => path === resolve(buildDir, 'sam3.dll'));
  assert.equal(found, resolve(buildDir, 'sam3.dll'));
});

test('macOS expects libsam3.dylib', () => {
  const buildDir = resolve('vendor/sam3.c/build');
  assert.deepEqual(sam3LibraryCandidates({ platform: 'darwin', buildDir }), [
    resolve(buildDir, 'libsam3.dylib'),
  ]);
});

test('Linux expects libsam3.so', () => {
  const buildDir = resolve('vendor/sam3.c/build');
  assert.deepEqual(sam3LibraryCandidates({ platform: 'linux', buildDir }), [
    resolve(buildDir, 'libsam3.so'),
  ]);
});

test('runtime staging includes sibling DLLs on Windows', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'sam3-artifacts-'));
  try {
    const buildDir = join(tempRoot, 'build');
    const releaseDir = join(buildDir, 'Release');
    const stageDir = join(tempRoot, 'stage');
    await mkdir(releaseDir, { recursive: true });
    await writeFile(join(releaseDir, 'sam3.dll'), 'sam3');
    await writeFile(join(releaseDir, 'avcodec.dll'), 'avcodec');
    await writeFile(join(releaseDir, 'openblas.dll'), 'openblas');
    await writeFile(join(releaseDir, 'sam3.lib'), 'import');

    assert.deepEqual(runtimeDllCandidates({ platform: 'win32', buildDir }).sort(), [
      join(releaseDir, 'avcodec.dll'),
      join(releaseDir, 'openblas.dll'),
      join(releaseDir, 'sam3.dll'),
    ].sort());

    const staged = await stageRuntimeDlls({ platform: 'win32', buildDir, stageDir });
    assert.deepEqual(staged.map((path) => path.endsWith('.dll')), [true, true, true]);
    assert.equal(await readFile(join(stageDir, 'sam3.dll'), 'utf8'), 'sam3');
    assert.equal(await readFile(join(stageDir, 'avcodec.dll'), 'utf8'), 'avcodec');
    assert.equal(await readFile(join(stageDir, 'openblas.dll'), 'utf8'), 'openblas');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
