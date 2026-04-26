#!/usr/bin/env node
/*
 * Signs libsam3.dll BEFORE `tauri build` so the installer's signature
 * covers a signed DLL. Tauri's NSIS bundler signs the .exe and the
 * installer itself; this fills the gap for our shipped DLL.
 *
 * Required env:
 *   WINDOWS_CERTIFICATE          base64-encoded .pfx
 *   WINDOWS_CERTIFICATE_PASSWORD password
 */

import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

if (platform() !== 'win32') {
  console.log('[sign-windows] skip — not Windows');
  process.exit(0);
}

const certB64 = process.env.WINDOWS_CERTIFICATE;
const certPw = process.env.WINDOWS_CERTIFICATE_PASSWORD;
if (!certB64 || !certPw) {
  console.error('[sign-windows] WINDOWS_CERTIFICATE or WINDOWS_CERTIFICATE_PASSWORD not set');
  process.exit(1);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..', '..');

const dllSources = [
  resolve(projectRoot, 'vendor/sam3.c/build/Release/sam3.dll'),
  resolve(projectRoot, 'vendor/sam3.c/build/sam3.dll'),
];

const dllPath = dllSources.find((p) => existsSync(p));
if (!dllPath) {
  console.error('[sign-windows] sam3.dll not found in any of:');
  for (const p of dllSources) console.error(`  ${p}`);
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), 'win-sign-'));
const pfxPath = join(tmp, 'cert.pfx');
writeFileSync(pfxPath, Buffer.from(certB64, 'base64'));

const signtool = process.env.SIGNTOOL_PATH || 'signtool.exe';

execFileSync(
  signtool,
  [
    'sign',
    '/f', pfxPath,
    '/p', certPw,
    '/tr', 'http://timestamp.digicert.com',
    '/td', 'sha256',
    '/fd', 'sha256',
    dllPath,
  ],
  { stdio: 'inherit' },
);
console.log(`[sign-windows] signed: ${dllPath}`);

execFileSync(signtool, ['verify', '/pa', dllPath], { stdio: 'inherit' });
console.log(`[sign-windows] verified ok`);
