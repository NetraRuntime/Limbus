#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const IDENTIFIER = 'com.netrart.limbus';

const resolveAppDataDir = () => {
  const home = homedir();
  switch (platform()) {
    case 'darwin':
      return resolve(home, 'Library', 'Application Support', IDENTIFIER);
    case 'win32':
      return resolve(process.env.APPDATA ?? resolve(home, 'AppData', 'Roaming'), IDENTIFIER);
    default:
      return resolve(
        process.env.XDG_DATA_HOME ?? resolve(home, '.local', 'share'),
        IDENTIFIER,
      );
  }
};

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(resolveAppDataDir(), 'pb_data');
const migrationsDir = resolve(projectRoot, 'pb', 'pb_migrations');
const pbBinary = resolve(
  projectRoot,
  'pb',
  platform() === 'win32' ? 'pocketbase.exe' : 'pocketbase',
);

const userArgs = process.argv.slice(2);
const base = userArgs.length > 0 ? userArgs : ['serve', '--http=127.0.0.1:8090'];
const args = [...base];
if (!args.includes('--dir')) args.push('--dir', dataDir);
if (!args.includes('--migrationsDir')) args.push('--migrationsDir', migrationsDir);

console.log(`[dev-pocketbase] data-dir: ${dataDir}`);
console.log(`[dev-pocketbase] migrations: ${migrationsDir}`);
spawn(pbBinary, args, { stdio: 'inherit' }).on('exit', (code) =>
  process.exit(code ?? 0),
);
