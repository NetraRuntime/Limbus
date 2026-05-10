#!/usr/bin/env node
/*
 * Signs staged SAM3 runtime DLLs BEFORE `tauri build` so the installer's
 * signature covers signed native dependencies. Tauri's NSIS bundler signs
 * the .exe and installer itself; this fills the gap for our shipped DLLs.
 *
 * Required env:
 *   WINDOWS_CERTIFICATE          base64-encoded .pfx
 *   WINDOWS_CERTIFICATE_PASSWORD password
 */

import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdtempSync, readdirSync } from 'node:fs';
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

const runtimeDir = resolve(
  projectRoot,
  'apps/app/src-tauri/binaries/sam3-runtime',
);

if (!existsSync(runtimeDir)) {
  console.error(`[sign-windows] SAM3 runtime directory not found: ${runtimeDir}`);
  process.exit(1);
}

const dllPaths = readdirSync(runtimeDir)
  .filter((name) => name.toLowerCase().endsWith('.dll'))
  .sort((a, b) => a.localeCompare(b))
  .map((name) => resolve(runtimeDir, name));

if (dllPaths.length === 0) {
  console.error(`[sign-windows] no DLLs found in: ${runtimeDir}`);
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), 'win-sign-'));
const pfxPath = join(tmp, 'cert.pfx');
writeFileSync(pfxPath, Buffer.from(certB64, 'base64'));

const signtool = process.env.SIGNTOOL_PATH || 'signtool.exe';

for (const dllPath of dllPaths) {
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
}

for (const dllPath of dllPaths) {
  execFileSync(signtool, ['verify', '/pa', dllPath], { stdio: 'inherit' });
  console.log(`[sign-windows] verified: ${dllPath}`);
}
