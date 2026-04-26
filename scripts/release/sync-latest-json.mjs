#!/usr/bin/env node
/*
 * Assembles latest.json from a directory of staged matrix-build artifacts
 * and signs it with TAURI_SIGNING_PRIVATE_KEY (passed via env).
 *
 * Usage: node scripts/release/sync-latest-json.mjs \
 *          --version 0.2.0 \
 *          --artifacts ./artifacts \
 *          --base-url https://github.com/<ORG>/netrart-releases/releases/download/v0.2.0 \
 *          --out ./latest.json
 *
 * Expected artifact layout:
 *   artifacts/macos-aarch64/NetraRT.app.tar.gz(.sig)
 *   artifacts/macos-x86_64/NetraRT.app.tar.gz(.sig)
 *   artifacts/windows-x64/NetraRT_<v>_x64-setup.nsis.zip(.sig)
 *   artifacts/linux-x64/NetraRT_<v>_amd64.AppImage.tar.gz(.sig)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= process.argv.length) {
    throw new Error(`missing --${name}`);
  }
  return process.argv[i + 1];
}

const version = arg('version');
const artifactsDir = resolve(arg('artifacts'));
const baseUrl = arg('base-url').replace(/\/$/, '');
const outPath = resolve(arg('out'));

const PLATFORMS = [
  { id: 'darwin-aarch64', dir: 'macos-aarch64', match: /\.app\.tar\.gz$/ },
  { id: 'darwin-x86_64', dir: 'macos-x86_64', match: /\.app\.tar\.gz$/ },
  { id: 'windows-x86_64', dir: 'windows-x64', match: /-setup\.nsis\.zip$/ },
  { id: 'linux-x86_64', dir: 'linux-x64', match: /\.AppImage\.tar\.gz$/ },
];

const platforms = {};
for (const p of PLATFORMS) {
  const dir = resolve(artifactsDir, p.dir);
  if (!existsSync(dir)) {
    throw new Error(`missing artifact dir: ${dir}`);
  }
  const files = readdirSync(dir);
  const bundle = files.find((f) => p.match.test(f));
  if (!bundle) {
    throw new Error(`no matching updater bundle in ${dir} (regex ${p.match})`);
  }
  const sigPath = resolve(dir, `${bundle}.sig`);
  if (!existsSync(sigPath)) {
    throw new Error(`missing signature file: ${sigPath}`);
  }
  const signature = readFileSync(sigPath, 'utf8').trim();
  platforms[p.id] = {
    signature,
    url: `${baseUrl}/${bundle}`,
  };
}

const manifest = {
  version,
  notes: `See ${baseUrl.replace('/releases/download/', '/releases/tag/')}`,
  pub_date: new Date().toISOString(),
  platforms,
};

writeFileSync(outPath, JSON.stringify(manifest, null, 2));
console.log(`[sync-latest-json] wrote ${outPath}`);

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..', '..');

if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
  console.error('[sync-latest-json] TAURI_SIGNING_PRIVATE_KEY not set — skipping signature');
  process.exit(0);
}

const signOut = execFileSync(
  'pnpm',
  [
    'exec',
    'tauri',
    'signer',
    'sign',
    '--private-key', process.env.TAURI_SIGNING_PRIVATE_KEY,
    outPath,
  ],
  { encoding: 'utf8', cwd: resolve(projectRoot, 'apps', 'app') },
);
console.log(signOut);
console.log(`[sync-latest-json] signed: ${outPath}.sig`);
