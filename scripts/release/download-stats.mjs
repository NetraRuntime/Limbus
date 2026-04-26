#!/usr/bin/env node
/*
 * Prints per-asset download counts for releases on the netrart-releases repo.
 * Requires `gh` CLI authenticated.
 *
 * Usage: node scripts/release/download-stats.mjs [--repo <ORG>/netrart-releases]
 */

import { execFileSync } from 'node:child_process';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const repo = arg('repo', process.env.NETRART_RELEASES_REPO);
if (!repo) {
  console.error('usage: download-stats.mjs --repo <ORG>/netrart-releases');
  process.exit(1);
}

const releasesJson = execFileSync(
  'gh',
  ['api', `/repos/${repo}/releases`, '--paginate'],
  { encoding: 'utf8' },
);
const releases = JSON.parse(releasesJson);

for (const r of releases) {
  console.log(`\n${r.tag_name}  (${r.published_at?.slice(0, 10) ?? 'draft'})`);
  for (const a of r.assets) {
    console.log(`  ${String(a.download_count).padStart(7)} ${a.name}`);
  }
}
