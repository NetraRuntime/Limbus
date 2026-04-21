#!/usr/bin/env node
// Starts PocketBase pointed at the SAME pb_data directory the packaged
// Tauri app uses (per-platform app-data dir), so dropping images/videos in
// the dev webview at :5173 and in the installed NetraRT.app writes to one
// shared database — no more duplicate / unsynced state.
//
// Mirrors Tauri v2's `path().app_data_dir()` resolution for identifier
// `ai.kolosal.netrart`.

import { spawn } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const IDENTIFIER = 'ai.kolosal.netrart';

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

// Default to `serve` when invoked with no args (`npm run db:start`).
// Otherwise forward whatever subcommand the caller asked for
// (`migrate up`, `superuser create`, etc.) — but always append the shared
// `--dir` and `--migrationsDir` so every entrypoint touches the SAME
// database the packaged Tauri app reads from.
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
