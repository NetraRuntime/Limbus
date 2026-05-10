#!/usr/bin/env node
/*
 * Fetches the pinned PocketBase binary for the current target triple,
 * verifies SHA256 against pb/pocketbase.sha256, and stages it under
 * apps/app/src-tauri/binaries/.
 *
 * Replaces stage-pocketbase.mjs in CI (which assumes a pre-downloaded
 * pb/pocketbase exists locally).
 */

import { execSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, existsSync, createWriteStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform, tmpdir } from 'node:os';
import { open as yauzlOpen } from 'yauzl';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..', '..');

const versionFile = resolve(projectRoot, 'pb', 'pocketbase.version');
const checksumFile = resolve(projectRoot, 'pb', 'pocketbase.sha256');

const version = readFileSync(versionFile, 'utf8').trim();
if (!version.startsWith('v')) {
  console.error(`[fetch-pocketbase] expected version to start with "v": ${version}`);
  process.exit(1);
}

const normalizeTriple = (triple) => {
  if (platform() === 'win32' && triple === 'x86_64-pc-windows-gnu') return 'x86_64-pc-windows-msvc';
  return triple;
};

const triple =
  (process.env.TAURI_ENV_TARGET_TRIPLE && normalizeTriple(process.env.TAURI_ENV_TARGET_TRIPLE)) ||
  (() => {
    if (platform() === 'win32') return 'x86_64-pc-windows-msvc';
    const out = execSync('rustc -vV', { encoding: 'utf8' });
    const m = out.match(/host:\s*(\S+)/);
    if (!m) throw new Error('Cannot determine target triple from rustc');
    return normalizeTriple(m[1]);
  })();

const checksums = readFileSync(checksumFile, 'utf8')
  .split('\n')
  .filter((line) => line.trim() && !line.startsWith('#'))
  .map((line) => {
    const [rustTriple, sha, asset] = line.trim().split(/\s+/);
    return { rustTriple, sha, asset };
  });

const entry = checksums.find((c) => c.rustTriple === triple);
if (!entry) {
  console.error(`[fetch-pocketbase] no checksum entry for triple: ${triple}`);
  process.exit(1);
}

const url = `https://github.com/pocketbase/pocketbase/releases/download/${version}/${entry.asset}`;
const zipPath = resolve(tmpdir(), entry.asset);

console.log(`[fetch-pocketbase] downloading ${url}`);
execFileSync(
  'curl',
  [
    '-sLf',
    '--retry', '3',
    '--retry-delay', '2',
    '--retry-all-errors',
    '-o', zipPath,
    url,
  ],
  { stdio: 'inherit' },
);

const actualSha = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
if (actualSha !== entry.sha) {
  console.error(`[fetch-pocketbase] SHA256 mismatch`);
  console.error(`  expected: ${entry.sha}`);
  console.error(`  actual:   ${actualSha}`);
  process.exit(1);
}
console.log(`[fetch-pocketbase] sha256 ok: ${actualSha}`);

const isWindows = triple.includes('windows');
const srcName = isWindows ? 'pocketbase.exe' : 'pocketbase';
const destExt = isWindows ? '.exe' : '';

const destDir = resolve(projectRoot, 'apps', 'app', 'src-tauri', 'binaries');
mkdirSync(destDir, { recursive: true });
const destPath = resolve(destDir, `pocketbase-${triple}${destExt}`);

await extractBinary(zipPath, srcName, destPath);

if (!existsSync(destPath)) {
  console.error(`[fetch-pocketbase] expected binary not found in zip: ${srcName}`);
  process.exit(1);
}
if (!isWindows) chmodSync(destPath, 0o755);

console.log(`[fetch-pocketbase] staged ${destPath}`);

function extractBinary(zip, entryName, outPath) {
  return new Promise((resolvePromise, rejectPromise) => {
    yauzlOpen(zip, { lazyEntries: true }, (err, zipfile) => {
      if (err) return rejectPromise(err);
      let found = false;
      zipfile.on('error', rejectPromise);
      zipfile.on('end', () => {
        if (!found) rejectPromise(new Error(`entry not found: ${entryName}`));
        else resolvePromise();
      });
      zipfile.on('entry', (entry) => {
        if (entry.fileName !== entryName) {
          zipfile.readEntry();
          return;
        }
        found = true;
        zipfile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr) return rejectPromise(streamErr);
          const writeStream = createWriteStream(outPath);
          writeStream.on('error', rejectPromise);
          writeStream.on('finish', () => {
            zipfile.close();
            resolvePromise();
          });
          readStream.on('error', rejectPromise);
          readStream.pipe(writeStream);
        });
      });
      zipfile.readEntry();
    });
  });
}
