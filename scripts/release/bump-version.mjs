#!/usr/bin/env node
/*
 * Bumps the NetraRT version across all manifests in lockstep.
 *
 * Usage: node scripts/release/bump-version.mjs <new-version>
 *   e.g. node scripts/release/bump-version.mjs 0.2.0
 *
 * Mutates:
 *   apps/app/src-tauri/tauri.conf.json
 *   apps/app/src-tauri/Cargo.toml
 *   apps/app/package.json
 *   package.json (root)
 *
 * Does NOT regenerate Cargo.lock, open a branch, or push. The caller
 * (release:prepare) runs `cargo check` to refresh the lockfile and
 * commits/pushes/PRs separately.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..', '..');

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error(`usage: bump-version.mjs <semver>  (got: ${version})`);
  process.exit(1);
}

function bumpJson(relPath, key = 'version') {
  const path = resolve(projectRoot, relPath);
  const content = JSON.parse(readFileSync(path, 'utf8'));
  const old = content[key];
  content[key] = version;
  writeFileSync(path, JSON.stringify(content, null, 2) + '\n');
  console.log(`[bump] ${relPath}: ${old} -> ${version}`);
}

function bumpToml(relPath) {
  const path = resolve(projectRoot, relPath);
  let content = readFileSync(path, 'utf8');
  const re = /^(version\s*=\s*")[^"]+(")/m;
  const m = content.match(re);
  if (!m) throw new Error(`no version line in ${relPath}`);
  const old = m[0].match(/"([^"]+)"/)[1];
  content = content.replace(re, `$1${version}$2`);
  writeFileSync(path, content);
  console.log(`[bump] ${relPath}: ${old} -> ${version}`);
}

bumpJson('apps/app/src-tauri/tauri.conf.json');
bumpToml('apps/app/src-tauri/Cargo.toml');
bumpJson('apps/app/package.json');
bumpJson('package.json');

console.log(`[bump] done — remember to refresh Cargo.lock with \`cargo check\``);
