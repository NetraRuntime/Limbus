#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { platform } from 'node:os';

const windowsTarget = 'x86_64-pc-windows-msvc';
const windowsToolchain = 'stable-x86_64-pc-windows-msvc';
const isWindowsHost = platform() === 'win32';
const userArgs = process.argv.slice(2);
const hasTargetArg = userArgs.some(
  (arg, index) => arg === '--target' || arg === '-t' || arg.startsWith('--target=') || userArgs[index - 1] === '--target' || userArgs[index - 1] === '-t',
);

const args = ['build', ...userArgs];
const env = { ...process.env };

const resolveWindowsToolchain = () => {
  try {
    const output = execFileSync('rustup', ['toolchain', 'list'], { encoding: 'utf8' });
    const installed = output
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/)[0])
      .filter(Boolean);

    return (
      installed.find((toolchain) => toolchain === windowsToolchain) ??
      installed.find((toolchain) => toolchain.endsWith('-x86_64-pc-windows-msvc')) ??
      windowsToolchain
    );
  } catch (err) {
    return windowsToolchain;
  }
};

if (isWindowsHost && !hasTargetArg) {
  args.push('--target', windowsTarget);
  env.TAURI_ENV_TARGET_TRIPLE = windowsTarget;
}

if (isWindowsHost && !env.RUSTUP_TOOLCHAIN) {
  env.RUSTUP_TOOLCHAIN = resolveWindowsToolchain();
}

const command = 'tauri';
const result = spawnSync(command, args, { stdio: 'inherit', env, shell: isWindowsHost });

if (result.error) {
  console.error(`[tauri-build] failed to start ${command}: ${result.error.message}`);
  process.exit(1);
}

if (result.signal) {
  console.error(`[tauri-build] ${command} terminated by signal ${result.signal}`);
  process.exit(1);
}

process.exit(result.status ?? 0);
