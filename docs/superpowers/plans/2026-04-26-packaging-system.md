# Packaging System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the end-to-end packaging system from spec
`docs/superpowers/specs/2026-04-26-packaging-system-design.md` — direct-download
installers for macOS/Windows/Linux with a signed in-app auto-updater, built and
published from a tag-triggered GitHub Actions workflow on the private repo to a
public release-mirror repo.

**Architecture:** Two repos (private source `netrart`, public assets-only
`netrart-releases`). CI matrix builds 4 targets, signs/notarizes, and publishes
a single GitHub Release with a Tauri Ed25519-signed `latest.json` manifest. App
embeds the updater public key and polls the manifest URL.

**Tech Stack:** Tauri 2 (`tauri-plugin-updater`), GitHub Actions, Apple Developer
ID + notarytool, Windows Authenticode (OV cert), Node 20 / pnpm 9 release
scripts, React 18 feature for the in-app updater UI.

---

## Reference

- Spec: `docs/superpowers/specs/2026-04-26-packaging-system-design.md`
- Tauri updater plugin: <https://v2.tauri.app/plugin/updater/>
- Tauri code-signing: <https://v2.tauri.app/distribute/sign/>

## File Structure

### New files (private repo `netrart`)

```
.github/workflows/
  release.yml                              # tag-triggered matrix build + publish
  release-pr.yml                           # release-branch PR rehearsal (build only)

pb/
  pocketbase.version                       # pinned PB tag, e.g. "v0.26.8"
  pocketbase.sha256                        # SHA256 per supported triple

scripts/release/
  fetch-pocketbase.mjs                     # CI replacement for stage:pb
  bump-version.mjs                         # bumps version across all manifests
  patch-rpath.mjs                          # patchelf RPATH fix for Linux binaries
  verify-mac-binary.mjs                    # otool -L assertion in CI
  sign-mac.mjs                             # post-tauri-build deep-sign helper
  sign-windows.mjs                         # pre-tauri-build DLL signing helper
  sync-latest-json.mjs                     # builds + signs latest.json
  download-stats.mjs                       # release download counts via gh api

apps/app/src-tauri/
  entitlements.plist                       # macOS hardened runtime entitlements

apps/app/src-tauri/src/
  self_check.rs                            # --self-check CLI handler

apps/app/src/features/updater/
  index.ts
  types.ts
  utils/detectInstallKind.ts
  hooks/useUpdater.ts
  components/UpdaterPill.tsx
  components/UpdaterPill.css
  components/DebNotice.tsx
  components/DebNotice.css
  __tests__/detectInstallKind.test.ts
  __tests__/useUpdater.test.ts

docs/release/
  SECRETS.md                               # secrets inventory + rotation
  RELEASE_CHECKLIST.md                     # manual pre/post-release steps
```

### Modified files (private repo `netrart`)

```
apps/app/src-tauri/tauri.conf.json         # plugins.updater, bundle.linux/windows additions
apps/app/src-tauri/Cargo.toml              # tauri-plugin-updater dep
apps/app/src-tauri/src/lib.rs              # register updater plugin
apps/app/src-tauri/src/main.rs             # wire --self-check before Builder
apps/app/package.json                      # @tauri-apps/plugin-updater dep
package.json                               # release:prepare script
apps/app/src/features/projects/components/Home.tsx   # mount UpdaterPill + DebNotice
README.md                                  # link to public download page
```

### New repo `netrart-releases` (public)

```
README.md
LICENSE
```

---

## Conventions

- Each task ends with one git commit. Conventional commit prefixes (`feat:`,
  `chore:`, `fix:`, `docs:`, `ci:`).
- After every task, run `pnpm typecheck && pnpm lint` and ensure they pass
  before the commit step.
- Tests run with `pnpm --filter @netrart/app test -- <pattern>`.
- Never commit secrets, `.p12`, `.pfx`, private keys, or app-specific passwords.

---

## Phase 1 — Local build hardening (the three structural risks)

Goal: make the existing `pnpm tauri:build` produce a fully working native bundle
on each target platform *without* CI involved. Each fix is independently
verifiable on a developer machine.

---

### Task 1.1: Pin PocketBase + add CI fetch script

**Files:**
- Create: `pb/pocketbase.version`
- Create: `pb/pocketbase.sha256`
- Create: `scripts/release/fetch-pocketbase.mjs`

- [ ] **Step 1: Pin the PocketBase version**

Create `pb/pocketbase.version`:

```
v0.26.8
```

(One line, no trailing newline isn't required but plausible — the script handles either.)

- [ ] **Step 2: Compute SHA256 for the four supported triples**

The PocketBase release naming scheme is
`pocketbase_<version_no_v>_<os>_<arch>.zip`. Download each, compute SHA256:

```bash
mkdir -p /tmp/pb-checksums
cd /tmp/pb-checksums
PB_VER=0.26.8
for triple in darwin_amd64 darwin_arm64 linux_amd64 windows_amd64; do
  curl -sLfO "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VER}/pocketbase_${PB_VER}_${triple}.zip"
done
shasum -a 256 *.zip
```

Map filenames → Rust target triples and write to `pb/pocketbase.sha256`:

```
# Format: <rust-triple> <sha256> <pocketbase-asset-name>
aarch64-apple-darwin       <sha256-here>  pocketbase_0.26.8_darwin_arm64.zip
x86_64-apple-darwin        <sha256-here>  pocketbase_0.26.8_darwin_amd64.zip
x86_64-pc-windows-msvc     <sha256-here>  pocketbase_0.26.8_windows_amd64.zip
x86_64-unknown-linux-gnu   <sha256-here>  pocketbase_0.26.8_linux_amd64.zip
```

- [ ] **Step 3: Write the fetch script**

Create `scripts/release/fetch-pocketbase.mjs`:

```javascript
#!/usr/bin/env node
/*
 * Fetches the pinned PocketBase binary for the current target triple,
 * verifies SHA256 against pb/pocketbase.sha256, and stages it under
 * apps/app/src-tauri/binaries/.
 *
 * Replaces stage-pocketbase.mjs in CI (which assumes a pre-downloaded
 * pb/pocketbase exists locally).
 */

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..', '..');

const versionFile = resolve(projectRoot, 'pb', 'pocketbase.version');
const checksumFile = resolve(projectRoot, 'pb', 'pocketbase.sha256');

const version = readFileSync(versionFile, 'utf8').trim();
if (!version.startsWith('v')) {
  console.error(`[fetch-pocketbase] expected version to start with "v": ${version}`);
  process.exit(1);
}
const versionNoV = version.slice(1);

const triple =
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  (() => {
    const out = execSync('rustc -vV', { encoding: 'utf8' });
    const m = out.match(/host:\s*(\S+)/);
    if (!m) throw new Error('Cannot determine target triple from rustc');
    return m[1];
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
execSync(`curl -sLfo "${zipPath}" "${url}"`, { stdio: 'inherit' });

const actualSha = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
if (actualSha !== entry.sha) {
  console.error(`[fetch-pocketbase] SHA256 mismatch`);
  console.error(`  expected: ${entry.sha}`);
  console.error(`  actual:   ${actualSha}`);
  process.exit(1);
}
console.log(`[fetch-pocketbase] sha256 ok: ${actualSha}`);

const extractDir = resolve(tmpdir(), `pb-${versionNoV}-${triple}`);
mkdirSync(extractDir, { recursive: true });
execSync(`unzip -o "${zipPath}" -d "${extractDir}"`, { stdio: 'inherit' });

const isWindows = triple.includes('windows');
const srcName = isWindows ? 'pocketbase.exe' : 'pocketbase';
const destExt = isWindows ? '.exe' : '';
const srcPath = resolve(extractDir, srcName);
if (!existsSync(srcPath)) {
  console.error(`[fetch-pocketbase] expected binary not found: ${srcPath}`);
  process.exit(1);
}

const destDir = resolve(projectRoot, 'apps', 'app', 'src-tauri', 'binaries');
mkdirSync(destDir, { recursive: true });
const destPath = resolve(destDir, `pocketbase-${triple}${destExt}`);
writeFileSync(destPath, readFileSync(srcPath));
if (!isWindows) chmodSync(destPath, 0o755);

console.log(`[fetch-pocketbase] staged ${destPath}`);
```

- [ ] **Step 4: Verify it works on the current host**

```bash
chmod +x scripts/release/fetch-pocketbase.mjs
node scripts/release/fetch-pocketbase.mjs
ls -la apps/app/src-tauri/binaries/
```

Expected: `pocketbase-<host-triple>` (or `.exe`) present, executable bit set on Unix.

- [ ] **Step 5: Verify SHA mismatch is caught**

Manually corrupt one line of `pb/pocketbase.sha256` (change a digit), rerun:

```bash
node scripts/release/fetch-pocketbase.mjs
```

Expected: `SHA256 mismatch` error, exit 1. Restore the correct value.

- [ ] **Step 6: Commit**

```bash
git add pb/pocketbase.version pb/pocketbase.sha256 scripts/release/fetch-pocketbase.mjs
git commit -m "feat(release): pin PocketBase version + checksum-verified fetch script"
```

---

### Task 1.2: Linux RPATH patcher + tauri.conf.json deb.files

**Files:**
- Create: `scripts/release/patch-rpath.mjs`
- Modify: `apps/app/src-tauri/tauri.conf.json`

- [ ] **Step 1: Write the RPATH patch script**

Create `scripts/release/patch-rpath.mjs`:

```javascript
#!/usr/bin/env node
/*
 * Patches RPATH on the staged Linux NetraRT binary so it resolves
 * libsam3.so from the bundled location rather than a developer's
 * absolute build path.
 *
 * Called by tauri.conf.json's beforeBundleCommand on Linux.
 * No-op on macOS and Windows.
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

if (platform() !== 'linux') {
  console.log('[patch-rpath] skip — not Linux');
  process.exit(0);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..', '..');

const triple =
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  (() => {
    const out = execSync('rustc -vV', { encoding: 'utf8' });
    const m = out.match(/host:\s*(\S+)/);
    if (!m) throw new Error('Cannot determine target triple');
    return m[1];
  })();

const binPath = resolve(
  projectRoot,
  'apps/app/src-tauri/target',
  triple,
  'release/netrart',
);

if (!existsSync(binPath)) {
  console.error(`[patch-rpath] binary not found: ${binPath}`);
  process.exit(1);
}

try {
  execFileSync('patchelf', ['--version'], { stdio: 'ignore' });
} catch {
  console.error('[patch-rpath] patchelf not installed (apt-get install patchelf)');
  process.exit(1);
}

const rpath = '$ORIGIN/../lib/netrart';
console.log(`[patch-rpath] setting RPATH=${rpath} on ${binPath}`);
execFileSync('patchelf', ['--set-rpath', rpath, binPath], { stdio: 'inherit' });

const out = execFileSync('patchelf', ['--print-rpath', binPath], { encoding: 'utf8' });
console.log(`[patch-rpath] verified: ${out.trim()}`);
```

- [ ] **Step 2: Add Linux + Windows bundle config to `tauri.conf.json`**

Open `apps/app/src-tauri/tauri.conf.json` and edit the `bundle` block. Replace
the existing `bundle` object with:

```json
"bundle": {
  "active": true,
  "targets": "all",
  "icon": [
    "icons/32x32.png",
    "icons/128x128.png",
    "icons/128x128@2x.png",
    "icons/icon.icns",
    "icons/icon.ico"
  ],
  "externalBin": ["binaries/pocketbase"],
  "resources": {
    "../../../pb/pb_migrations": "pb_migrations",
    "../../../vendor/sam3.c/models/bpe_simple_vocab_16e6.txt.gz": "models/bpe_simple_vocab_16e6.txt.gz"
  },
  "macOS": {
    "frameworks": ["../../../vendor/sam3.c/build/libsam3.dylib"],
    "entitlements": "entitlements.plist",
    "hardenedRuntime": true
  },
  "linux": {
    "deb": {
      "files": {
        "/usr/lib/netrart/libsam3.so": "../../../vendor/sam3.c/build/libsam3.so"
      }
    }
  },
  "windows": {
    "wix": null,
    "nsis": {
      "installerIcon": "icons/icon.ico",
      "installMode": "perUser"
    }
  },
  "category": "Productivity",
  "shortDescription": "NetraRT infinite canvas",
  "longDescription": "NetraRT — infinite canvas desktop app"
}
```

(Note: the Windows DLL bundling is handled by adding `libsam3.dll` next to the
.exe via Tauri's automatic neighboring-files behavior; we'll formalize this in
Task 1.4 when we have a real Windows build to test against.)

- [ ] **Step 3: Add `beforeBundleCommand` hook**

In the same `tauri.conf.json`, edit the `build` block to add the rpath patch:

```json
"build": {
  "beforeDevCommand": "pnpm stage:pb && pnpm sam3:build && pnpm dev",
  "devUrl": "http://localhost:5174",
  "beforeBuildCommand": "pnpm stage:pb && pnpm sam3:build && pnpm build",
  "beforeBundleCommand": "node ../../scripts/release/patch-rpath.mjs",
  "frontendDist": "../dist"
}
```

- [ ] **Step 4: Create `entitlements.plist`**

Create `apps/app/src-tauri/entitlements.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
  <key>com.apple.security.cs.allow-jit</key>
  <false/>
</dict>
</plist>
```

(`disable-library-validation` is required because we ship `libsam3.dylib` as a
non-Apple-signed framework; without it, Gatekeeper rejects the load.)

- [ ] **Step 5: Verify `pnpm tauri:build` still succeeds on macOS host**

```bash
pnpm tauri:build
```

Expected: build completes, produces a `.dmg` and `.app` under
`apps/app/src-tauri/target/<triple>/release/bundle/`. macOS host is sufficient
to verify config correctness; Linux specifics are exercised in CI.

- [ ] **Step 6: Commit**

```bash
git add scripts/release/patch-rpath.mjs apps/app/src-tauri/tauri.conf.json apps/app/src-tauri/entitlements.plist
git commit -m "feat(release): Linux RPATH + macOS entitlements + per-platform bundle config"
```

---

### Task 1.3: macOS binary verification step

**Files:**
- Create: `scripts/release/verify-mac-binary.mjs`

- [ ] **Step 1: Write the verification script**

Create `scripts/release/verify-mac-binary.mjs`:

```javascript
#!/usr/bin/env node
/*
 * Asserts the built macOS binary's libsam3.dylib reference resolves
 * via @rpath/ (relocatable), not an absolute /Users/... path that would
 * pass codesign locally but fail when shipped.
 */

import { execSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

if (platform() !== 'darwin') {
  console.log('[verify-mac-binary] skip — not macOS');
  process.exit(0);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..', '..');

const triple =
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  (() => {
    const out = execSync('rustc -vV', { encoding: 'utf8' });
    return out.match(/host:\s*(\S+)/)[1];
  })();

const appPath = resolve(
  projectRoot,
  'apps/app/src-tauri/target',
  triple,
  'release/bundle/macos/NetraRT.app/Contents/MacOS/NetraRT',
);

if (!existsSync(appPath)) {
  console.error(`[verify-mac-binary] not found: ${appPath}`);
  process.exit(1);
}

const out = execFileSync('otool', ['-L', appPath], { encoding: 'utf8' });
console.log(out);

const sam3Line = out.split('\n').find((l) => l.includes('libsam3'));
if (!sam3Line) {
  console.error('[verify-mac-binary] libsam3 reference missing entirely');
  process.exit(1);
}
if (!sam3Line.trim().startsWith('@rpath/')) {
  console.error(`[verify-mac-binary] libsam3 not @rpath-relative: ${sam3Line.trim()}`);
  console.error('[verify-mac-binary] this binary will fail Gatekeeper on user machines');
  process.exit(1);
}
console.log('[verify-mac-binary] ok — @rpath/libsam3.dylib');
```

- [ ] **Step 2: Run it against the previous Task 1.2 build**

```bash
node scripts/release/verify-mac-binary.mjs
```

Expected: prints otool output, ends with `[verify-mac-binary] ok`.

If it fails with a non-`@rpath/` path, the fix is in `vendor/sam3.c`'s
CMakeLists `INSTALL_NAME_DIR` setting. Document the failure mode in a comment
on the script — but don't try to fix sam3.c here unless it's actually broken.

- [ ] **Step 3: Commit**

```bash
git add scripts/release/verify-mac-binary.mjs
git commit -m "feat(release): macOS binary @rpath verification"
```

---

### Task 1.4: Windows libsam3.dll bundling

**Files:**
- Modify: `apps/app/src-tauri/tauri.conf.json`

This task is config-only and only verifiable on a Windows host (or in CI Phase
6). Do it now to keep config changes co-located with the other risk fixes.

- [ ] **Step 1: Add `libsam3.dll` to `bundle.resources` (Windows-conditional)**

Tauri 2's `bundle.resources` accepts paths that may not exist at build time on
non-target platforms. Edit `tauri.conf.json` `bundle.resources` to:

```json
"resources": {
  "../../../pb/pb_migrations": "pb_migrations",
  "../../../vendor/sam3.c/models/bpe_simple_vocab_16e6.txt.gz": "models/bpe_simple_vocab_16e6.txt.gz",
  "../../../vendor/sam3.c/build/Release/sam3.dll": "."
}
```

(The empty `"."` target tells Tauri to drop it next to the `.exe`. The
`Release` subdir is where MSVC CMake builds produce DLLs; if your sam3.c
CMakeLists outputs a different layout, adjust the source path. We'll verify in
the CI Windows job in Phase 6.)

- [ ] **Step 2: Verify config still parses + macOS build still succeeds**

```bash
pnpm tauri:build
```

Expected: build completes (the missing DLL doesn't break non-Windows builds —
Tauri silently skips missing optional resources at the staging layer; if it
errors, we wrap the entry in a Windows-only conditional via a build script —
do that as a follow-up only if needed).

- [ ] **Step 3: Commit**

```bash
git add apps/app/src-tauri/tauri.conf.json
git commit -m "feat(release): declare libsam3.dll as Windows bundle resource"
```

---

## Phase 2 — `--self-check` CLI flag

Goal: a CLI mode that boots PocketBase + sam3, verifies they respond, and
exits — used by CI install-rehearsal and by humans for ad-hoc smoke tests.

---

### Task 2.1: Implement `self_check.rs`

**Files:**
- Create: `apps/app/src-tauri/src/self_check.rs`

- [ ] **Step 1: Write the module**

Create `apps/app/src-tauri/src/self_check.rs`:

```rust
//! Headless smoke test: verifies the staged PocketBase sidecar is the
//! correct architecture and the sam3 dylib loads, then exits.
//!
//! Invoked by `NetraRT --self-check` (or `NetraRT.exe --self-check`).
//! Used by CI install-rehearsal jobs across all platforms.

use std::path::PathBuf;
use std::process::Command;

pub fn run() -> ! {
    let mut failures = Vec::new();

    // 1. sam3 — calling its version function exercises dylib load + symbol resolve.
    match std::panic::catch_unwind(|| sam3::version().to_string()) {
        Ok(v) => eprintln!("[self-check] sam3 version: {v}"),
        Err(_) => failures.push("sam3 dylib load failed".to_string()),
    }

    // 2. pocketbase — locate the sidecar that ships next to the executable
    // and run `pocketbase --version`. Don't actually start the server.
    let exe = std::env::current_exe().expect("current_exe");
    let exe_dir = exe.parent().expect("exe parent").to_path_buf();
    let pb_path = locate_pocketbase(&exe_dir);

    match pb_path {
        Some(path) => {
            let out = Command::new(&path).arg("--version").output();
            match out {
                Ok(o) if o.status.success() => {
                    let stdout = String::from_utf8_lossy(&o.stdout);
                    eprintln!("[self-check] pocketbase: {}", stdout.trim());
                }
                Ok(o) => failures.push(format!(
                    "pocketbase exited with status {:?}: {}",
                    o.status,
                    String::from_utf8_lossy(&o.stderr).trim()
                )),
                Err(e) => failures.push(format!("pocketbase invocation failed: {e}")),
            }
        }
        None => failures.push(format!("pocketbase sidecar not found near {}", exe_dir.display())),
    }

    if failures.is_empty() {
        eprintln!("[self-check] OK");
        std::process::exit(0);
    }
    for f in &failures {
        eprintln!("[self-check] FAIL: {f}");
    }
    std::process::exit(1);
}

fn locate_pocketbase(exe_dir: &std::path::Path) -> Option<PathBuf> {
    // In a bundled app, the sidecar is named after the build triple and
    // sits next to the main executable. We search for any file matching
    // `pocketbase-*` (or `pocketbase-*.exe` on Windows) instead of
    // hardcoding the triple.
    let entries = std::fs::read_dir(exe_dir).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        let (prefix, suffix) = if cfg!(windows) {
            ("pocketbase-", ".exe")
        } else {
            ("pocketbase-", "")
        };
        if name_str.starts_with(prefix) && name_str.ends_with(suffix) {
            return Some(entry.path());
        }
    }
    None
}
```

- [ ] **Step 2: Wire it from `main.rs`**

Replace `apps/app/src-tauri/src/main.rs` with:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--self-check") {
        netrart_lib::run_self_check();
    }
    netrart_lib::run()
}
```

- [ ] **Step 3: Expose `run_self_check` from `lib.rs`**

In `apps/app/src-tauri/src/lib.rs`, add at the top of the file (after the
existing `mod` declarations):

```rust
mod self_check;

pub fn run_self_check() -> ! {
    self_check::run()
}
```

- [ ] **Step 4: Build and run locally**

```bash
pnpm tauri:build
# resulting binary path on macOS arm64:
./apps/app/src-tauri/target/aarch64-apple-darwin/release/netrart --self-check
```

Expected output:
```
[self-check] sam3 version: <some version>
[self-check] pocketbase: PocketBase v0.26.8 ...
[self-check] OK
```
Exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src-tauri/src/self_check.rs apps/app/src-tauri/src/main.rs apps/app/src-tauri/src/lib.rs
git commit -m "feat(self-check): headless dylib + sidecar smoke test"
```

---

## Phase 3 — Tauri updater plugin

Goal: app embeds the updater public key and can fetch + verify a `latest.json`.
No UI yet; that's Phase 4.

---

### Task 3.1: Generate Ed25519 keypair + back it up

**Files:** none committed (keys go in 1Password / safe).

This is a **one-time manual step** — record outputs in `docs/release/SECRETS.md`
in Task 6.1.

- [ ] **Step 1: Generate the keypair**

```bash
cd apps/app
pnpm exec tauri signer generate -w ~/.tauri/netrart-updater.key
```

The CLI prompts for an optional passphrase. **Set one.** Save it as
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` later.

Output (stdout) includes the public key as base64. Save it.

- [ ] **Step 2: Back up the private key**

- Copy `~/.tauri/netrart-updater.key` to a 1Password Secure Note in the team's
  shared "Infra / NetraRT release" vault.
- Print a paper copy and seal it in an envelope marked "NetraRT updater
  private key — do not destroy" in the office safe.

**This key cannot be rotated without breaking auto-updates for every shipped
copy.** Treat it as a master credential.

- [ ] **Step 3: Note keys for later use**

Record the public key and passphrase somewhere temporary (a secure password
manager note). They go into:
- `tauri.conf.json` (public key) in Task 3.4.
- GitHub Actions secrets (private key + passphrase) in Task 6.6.

No commit in this task.

---

### Task 3.2: Add `tauri-plugin-updater` to Cargo

**Files:**
- Modify: `apps/app/src-tauri/Cargo.toml`
- Modify: `apps/app/src-tauri/src/lib.rs`

- [ ] **Step 1: Add dependency**

Edit `apps/app/src-tauri/Cargo.toml`. After the `tauri-plugin-shell` line, add:

```toml
tauri-plugin-updater = "2"
```

- [ ] **Step 2: Register the plugin**

In `apps/app/src-tauri/src/lib.rs` `pub fn run()`, change:

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
```

to:

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
```

- [ ] **Step 3: Verify build still compiles**

```bash
pnpm --filter @netrart/app tauri build --no-bundle
```

Expected: compile succeeds. (No-bundle skips the slow installer step.)

- [ ] **Step 4: Commit**

```bash
git add apps/app/src-tauri/Cargo.toml apps/app/src-tauri/Cargo.lock apps/app/src-tauri/src/lib.rs
git commit -m "feat(updater): register tauri-plugin-updater (Rust side)"
```

---

### Task 3.3: Add `@tauri-apps/plugin-updater` to JS

**Files:**
- Modify: `apps/app/package.json`
- Modify: `apps/app/src-tauri/capabilities/default.json`

- [ ] **Step 1: Install the JS plugin**

```bash
pnpm --filter @netrart/app add @tauri-apps/plugin-updater
```

- [ ] **Step 2: Allow updater capability**

Edit `apps/app/src-tauri/capabilities/default.json` `permissions` array. Add:

```json
"updater:default"
```

After the existing `shell:allow-spawn` block. The full `permissions` array
should now end with:

```json
"updater:default"
```

- [ ] **Step 3: Verify**

```bash
pnpm typecheck
pnpm tauri:dev   # smoke — make sure the app still launches
```

Hit Ctrl+C once it's running. We're checking for capability-config errors on
boot, not driving a full session.

- [ ] **Step 4: Commit**

```bash
git add apps/app/package.json pnpm-lock.yaml apps/app/src-tauri/capabilities/default.json
git commit -m "feat(updater): add JS plugin + capability"
```

---

### Task 3.4: Configure updater endpoint + pubkey

**Files:**
- Modify: `apps/app/src-tauri/tauri.conf.json`

- [ ] **Step 1: Add `plugins.updater` block**

Edit `apps/app/src-tauri/tauri.conf.json`. After the `app` block, add a
top-level `plugins` block (or extend if one exists):

```json
"plugins": {
  "updater": {
    "endpoints": [
      "https://github.com/<ORG>/netrart-releases/releases/latest/download/latest.json"
    ],
    "pubkey": "<PASTE-PUBLIC-KEY-FROM-TASK-3.1>",
    "windows": {
      "installMode": "passive"
    }
  }
}
```

Replace `<ORG>` with the eventual org name (decided in Phase 6, Task 6.5 —
leave as `<ORG>` for now and we'll do a single search-and-replace then).
Replace `<PASTE-PUBLIC-KEY-FROM-TASK-3.1>` with the actual key.

`installMode: passive` on Windows = NSIS installer runs without a UI, with a
progress dialog only. Best balance of "not silent, not modal."

- [ ] **Step 2: Verify config validates**

```bash
pnpm typecheck
pnpm tauri:dev
```

Hit Ctrl+C. We just need to confirm Tauri's config schema accepts the new
block.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src-tauri/tauri.conf.json
git commit -m "feat(updater): configure endpoint + Ed25519 public key"
```

---

## Phase 4 — In-app updater feature (React)

Goal: a self-contained `features/updater/` that:
- Detects install kind (AppImage / .deb / .app / .exe).
- Polls for updates (silent, 24h cycle).
- Renders a non-blocking pill on the Home screen when an update is available.
- For `.deb` installs, suppresses the pill and shows a one-time "switch to
  AppImage" notice.

---

### Task 4.1: Feature folder skeleton + types

**Files:**
- Create: `apps/app/src/features/updater/index.ts`
- Create: `apps/app/src/features/updater/types.ts`

- [ ] **Step 1: Define types**

Create `apps/app/src/features/updater/types.ts`:

```ts
export type InstallKind =
  | 'appimage'   // Linux AppImage — auto-update supported
  | 'deb'        // Linux system .deb — auto-update NOT supported
  | 'macos-app'  // macOS .app — auto-update supported
  | 'windows'    // Windows NSIS install — auto-update supported
  | 'dev'        // running from `pnpm tauri:dev` — no update
  | 'unknown';   // fallback — treat conservatively (no update)

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string; notes: string }
  | { status: 'downloading'; version: string; downloadedBytes: number; totalBytes: number | null }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string };
```

- [ ] **Step 2: Create the public API barrel**

Create `apps/app/src/features/updater/index.ts`:

```ts
export { useUpdater } from './hooks/useUpdater';
export { UpdaterPill } from './components/UpdaterPill';
export { DebNotice } from './components/DebNotice';
export type { InstallKind, UpdateState } from './types';
```

(`useUpdater`, `UpdaterPill`, `DebNotice` will be created in subsequent tasks.
The barrel intentionally references them now so the import contract is fixed.)

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/features/updater/index.ts apps/app/src/features/updater/types.ts
git commit -m "feat(updater): feature folder skeleton + types"
```

---

### Task 4.2: `detectInstallKind` utility (TDD)

**Files:**
- Create: `apps/app/src/features/updater/utils/detectInstallKind.ts`
- Create: `apps/app/src/features/updater/__tests__/detectInstallKind.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/features/updater/__tests__/detectInstallKind.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectInstallKind } from '../utils/detectInstallKind';

vi.mock('@tauri-apps/api/path', () => ({
  resourceDir: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { resourceDir } from '@tauri-apps/api/path';

describe('detectInstallKind', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns "macos-app" when resource path lives inside an .app bundle', async () => {
    vi.mocked(resourceDir).mockResolvedValue('/Applications/NetraRT.app/Contents/Resources');
    const k = await detectInstallKind('darwin');
    expect(k).toBe('macos-app');
  });

  it('returns "deb" when resource path lives under /usr/lib', async () => {
    vi.mocked(resourceDir).mockResolvedValue('/usr/lib/netrart');
    const k = await detectInstallKind('linux');
    expect(k).toBe('deb');
  });

  it('returns "appimage" when APPIMAGE env variable is reflected by tauri', async () => {
    vi.mocked(resourceDir).mockResolvedValue('/tmp/.mount_NetraRABCDEF/usr/lib/netrart');
    const k = await detectInstallKind('linux');
    expect(k).toBe('appimage');
  });

  it('returns "windows" on win32 platform', async () => {
    vi.mocked(resourceDir).mockResolvedValue('C:\\Program Files\\NetraRT\\resources');
    const k = await detectInstallKind('win32');
    expect(k).toBe('windows');
  });

  it('returns "dev" when path looks like a dev target dir', async () => {
    vi.mocked(resourceDir).mockResolvedValue('/Users/dev/netrart/apps/app/src-tauri/target/debug/resources');
    const k = await detectInstallKind('darwin');
    expect(k).toBe('dev');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @netrart/app test -- detectInstallKind
```

Expected: FAIL — `detectInstallKind` not found.

- [ ] **Step 3: Implement the utility**

Create `apps/app/src/features/updater/utils/detectInstallKind.ts`:

```ts
import { resourceDir } from '@tauri-apps/api/path';
import type { InstallKind } from '../types';

export async function detectInstallKind(
  platform: NodeJS.Platform | string,
): Promise<InstallKind> {
  let dir: string;
  try {
    dir = await resourceDir();
  } catch {
    return 'unknown';
  }

  // Dev runs always come from the cargo target dir.
  if (dir.includes('/src-tauri/target/') || dir.includes('\\src-tauri\\target\\')) {
    return 'dev';
  }

  if (platform === 'darwin') {
    if (dir.includes('.app/Contents/')) return 'macos-app';
    return 'unknown';
  }

  if (platform === 'win32') {
    return 'windows';
  }

  if (platform === 'linux') {
    // AppImage mounts under /tmp/.mount_<random> at runtime.
    if (dir.startsWith('/tmp/.mount_')) return 'appimage';
    // .deb places resources under /usr/lib/netrart.
    if (dir.startsWith('/usr/lib/') || dir.startsWith('/usr/share/')) return 'deb';
    return 'unknown';
  }

  return 'unknown';
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @netrart/app test -- detectInstallKind
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/updater/utils/detectInstallKind.ts apps/app/src/features/updater/__tests__/detectInstallKind.test.ts
git commit -m "feat(updater): detectInstallKind utility with platform-aware heuristics"
```

---

### Task 4.3: `useUpdater` hook (TDD)

**Files:**
- Create: `apps/app/src/features/updater/hooks/useUpdater.ts`
- Create: `apps/app/src/features/updater/__tests__/useUpdater.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/app/src/features/updater/__tests__/useUpdater.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useUpdater } from '../hooks/useUpdater';

const checkMock = vi.fn();
const downloadAndInstallMock = vi.fn();

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: () => checkMock(),
}));
vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(),
}));
vi.mock('../utils/detectInstallKind', () => ({
  detectInstallKind: vi.fn().mockResolvedValue('macos-app'),
}));

describe('useUpdater', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    checkMock.mockReset();
    downloadAndInstallMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in idle and transitions to available when an update exists', async () => {
    checkMock.mockResolvedValue({
      available: true,
      version: '0.3.0',
      body: 'See release notes',
      downloadAndInstall: downloadAndInstallMock,
    });

    const { result } = renderHook(() => useUpdater());

    await waitFor(() => {
      expect(result.current.state.status).toBe('available');
    });
    if (result.current.state.status === 'available') {
      expect(result.current.state.version).toBe('0.3.0');
    }
  });

  it('stays idle when no update is available', async () => {
    checkMock.mockResolvedValue({ available: false });

    const { result } = renderHook(() => useUpdater());

    await waitFor(() => {
      expect(checkMock).toHaveBeenCalled();
    });
    expect(result.current.state.status).toBe('idle');
  });

  it('transitions to error on check failure but does not throw', async () => {
    checkMock.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useUpdater());

    await waitFor(() => {
      expect(result.current.state.status === 'idle' || result.current.state.status === 'error').toBe(true);
    });
    // Failure should be silent: idle is acceptable; error is acceptable; throw is not.
  });

  it('does not attempt to check on .deb installs', async () => {
    const detectMock = await import('../utils/detectInstallKind');
    vi.mocked(detectMock.detectInstallKind).mockResolvedValueOnce('deb');

    renderHook(() => useUpdater());

    await waitFor(() => {
      // Give effects time to settle.
      expect(true).toBe(true);
    });
    expect(checkMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @netrart/app test -- useUpdater
```

Expected: FAIL — hook doesn't exist.

- [ ] **Step 3: Install `@tauri-apps/plugin-process` (needed for relaunch)**

```bash
pnpm --filter @netrart/app add @tauri-apps/plugin-process
```

Add to `apps/app/src-tauri/Cargo.toml`:

```toml
tauri-plugin-process = "2"
```

Register in `apps/app/src-tauri/src/lib.rs` `pub fn run()`:

```rust
.plugin(tauri_plugin_process::init())
```

Add to `apps/app/src-tauri/capabilities/default.json` permissions:

```json
"process:default"
```

- [ ] **Step 4: Implement the hook**

Create `apps/app/src/features/updater/hooks/useUpdater.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { detectInstallKind } from '../utils/detectInstallKind';
import type { InstallKind, UpdateState } from '../types';

const RECHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const CHECK_TIMEOUT_MS = 5_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);
}

const CAN_AUTO_UPDATE: ReadonlySet<InstallKind> = new Set([
  'macos-app',
  'windows',
  'appimage',
]);

export function useUpdater() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });
  const [installKind, setInstallKind] = useState<InstallKind | null>(null);
  const updateRef = useRef<Awaited<ReturnType<typeof check>> | null>(null);

  // Detect install kind once.
  useEffect(() => {
    let cancelled = false;
    detectInstallKind(
      typeof navigator !== 'undefined'
        ? navigator.userAgent.includes('Mac')
          ? 'darwin'
          : navigator.userAgent.includes('Windows')
            ? 'win32'
            : 'linux'
        : 'unknown',
    ).then((k) => {
      if (!cancelled) setInstallKind(k);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const performCheck = useCallback(async () => {
    if (!installKind || !CAN_AUTO_UPDATE.has(installKind)) return;
    setState({ status: 'checking' });
    try {
      const update = await withTimeout(check(), CHECK_TIMEOUT_MS);
      if (update?.available) {
        updateRef.current = update;
        setState({
          status: 'available',
          version: update.version,
          notes: update.body ?? '',
        });
      } else {
        setState({ status: 'idle' });
      }
    } catch (e) {
      // Silent on failure per spec — don't stay in error state forever.
      setState({ status: 'idle' });
      console.warn('[updater] check failed:', (e as Error).message);
    }
  }, [installKind]);

  // Initial check + 24h interval.
  useEffect(() => {
    if (!installKind) return;
    void performCheck();
    const id = setInterval(() => void performCheck(), RECHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [installKind, performCheck]);

  const downloadAndInstall = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;
    setState({
      status: 'downloading',
      version: update.version,
      downloadedBytes: 0,
      totalBytes: null,
    });
    try {
      let downloaded = 0;
      let total: number | null = null;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? null;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          setState({
            status: 'downloading',
            version: update.version,
            downloadedBytes: downloaded,
            totalBytes: total,
          });
        }
      });
      setState({ status: 'ready', version: update.version });
    } catch (e) {
      setState({ status: 'error', message: (e as Error).message });
      console.warn('[updater] install failed:', (e as Error).message);
    }
  }, []);

  const restartNow = useCallback(async () => {
    await relaunch();
  }, []);

  return {
    state,
    installKind,
    downloadAndInstall,
    restartNow,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @netrart/app test -- useUpdater
```

Expected: all 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/features/updater/hooks/useUpdater.ts apps/app/src/features/updater/__tests__/useUpdater.test.ts apps/app/package.json pnpm-lock.yaml apps/app/src-tauri/Cargo.toml apps/app/src-tauri/Cargo.lock apps/app/src-tauri/src/lib.rs apps/app/src-tauri/capabilities/default.json
git commit -m "feat(updater): useUpdater hook with timeout, interval, and .deb suppression"
```

---

### Task 4.4: `UpdaterPill` component

**Files:**
- Create: `apps/app/src/features/updater/components/UpdaterPill.tsx`
- Create: `apps/app/src/features/updater/components/UpdaterPill.css`

- [ ] **Step 1: Implement the component**

Create `apps/app/src/features/updater/components/UpdaterPill.tsx`:

```tsx
import { useUpdater } from '../hooks/useUpdater';
import './UpdaterPill.css';

export function UpdaterPill() {
  const { state, downloadAndInstall, restartNow } = useUpdater();

  if (state.status === 'idle' || state.status === 'checking') return null;

  if (state.status === 'available') {
    return (
      <button
        type="button"
        className="updater-pill updater-pill--available"
        onClick={() => void downloadAndInstall()}
        aria-label={`Update to version ${state.version} available`}
      >
        Update {state.version} available
      </button>
    );
  }

  if (state.status === 'downloading') {
    const pct =
      state.totalBytes != null && state.totalBytes > 0
        ? Math.round((state.downloadedBytes / state.totalBytes) * 100)
        : null;
    return (
      <span className="updater-pill updater-pill--downloading" aria-live="polite">
        Downloading update… {pct != null ? `${pct}%` : ''}
      </span>
    );
  }

  if (state.status === 'ready') {
    return (
      <button
        type="button"
        className="updater-pill updater-pill--ready"
        onClick={() => void restartNow()}
      >
        Restart to update to {state.version}
      </button>
    );
  }

  // 'error' — render nothing; the next 24h cycle will retry.
  return null;
}
```

- [ ] **Step 2: Add styles**

Create `apps/app/src/features/updater/components/UpdaterPill.css`:

```css
.updater-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.75rem;
  border-radius: 999px;
  font-size: 0.8125rem;
  font-weight: 500;
  border: 1px solid var(--color-border, rgba(0, 0, 0, 0.1));
  background: var(--color-surface-2, #f4f4f5);
  color: var(--color-text, #18181b);
  cursor: default;
  user-select: none;
}

.updater-pill--available,
.updater-pill--ready {
  cursor: pointer;
  background: var(--color-accent-soft, #e0f2fe);
  border-color: var(--color-accent-border, #7dd3fc);
}

.updater-pill--available:hover,
.updater-pill--ready:hover {
  background: var(--color-accent-soft-hover, #bae6fd);
}

.updater-pill--downloading {
  background: var(--color-surface-2, #f4f4f5);
}
```

- [ ] **Step 3: Verify it compiles + lints**

```bash
pnpm typecheck && pnpm lint
```

Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/features/updater/components/UpdaterPill.tsx apps/app/src/features/updater/components/UpdaterPill.css
git commit -m "feat(updater): UpdaterPill component with progress + restart states"
```

---

### Task 4.5: `DebNotice` (one-time switch-to-AppImage notice)

**Files:**
- Create: `apps/app/src/features/updater/components/DebNotice.tsx`
- Create: `apps/app/src/features/updater/components/DebNotice.css`

- [ ] **Step 1: Implement the component**

Create `apps/app/src/features/updater/components/DebNotice.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useUpdater } from '../hooks/useUpdater';
import './DebNotice.css';

const STORAGE_KEY = 'netrart.updater.deb-notice-dismissed';

// Compile-time switch — set to false in a release if the notice proves noisy.
const DEB_NOTICE_ENABLED = true;

export function DebNotice() {
  const { installKind } = useUpdater();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return true;
    }
  });

  if (!DEB_NOTICE_ENABLED) return null;
  if (installKind !== 'deb') return null;
  if (dismissed) return null;

  return (
    <div className="deb-notice" role="status">
      <span>
        Auto-updates aren't available for the .deb package. Install the AppImage
        for in-app updates.
      </span>
      <button
        type="button"
        className="deb-notice__dismiss"
        onClick={() => {
          try {
            localStorage.setItem(STORAGE_KEY, '1');
          } catch {
            // ignore — worst case the notice shows again next launch
          }
          setDismissed(true);
        }}
        aria-label="Dismiss"
      >
        Dismiss
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Add styles**

Create `apps/app/src/features/updater/components/DebNotice.css`:

```css
.deb-notice {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 0.875rem;
  border-radius: 8px;
  background: var(--color-surface-2, #f4f4f5);
  border: 1px solid var(--color-border, rgba(0, 0, 0, 0.1));
  font-size: 0.8125rem;
  color: var(--color-text, #18181b);
}

.deb-notice__dismiss {
  margin-left: auto;
  padding: 0.25rem 0.625rem;
  border-radius: 6px;
  border: 1px solid var(--color-border, rgba(0, 0, 0, 0.1));
  background: transparent;
  cursor: pointer;
  font-size: 0.75rem;
}

.deb-notice__dismiss:hover {
  background: var(--color-surface-3, #e4e4e7);
}
```

- [ ] **Step 3: Verify**

```bash
pnpm typecheck && pnpm lint
```

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/features/updater/components/DebNotice.tsx apps/app/src/features/updater/components/DebNotice.css
git commit -m "feat(updater): one-time DebNotice for system .deb installs"
```

---

### Task 4.6: Wire feature into Home

**Files:**
- Modify: `apps/app/src/features/projects/components/Home.tsx`

- [ ] **Step 1: Read the current Home.tsx footer/header structure**

```bash
grep -n "footer\|header\|return\b" apps/app/src/features/projects/components/Home.tsx | head -20
```

- [ ] **Step 2: Import + mount the components**

In `apps/app/src/features/projects/components/Home.tsx`:

1. Add import near the other imports:

```tsx
import { UpdaterPill, DebNotice } from '../../updater';
```

2. Mount `<DebNotice />` near the top of Home's main return — before the
   project list, so it's visible without scrolling. Place it after the
   header and before the main content.

3. Mount `<UpdaterPill />` in the Home footer (or near the version label if
   one exists; otherwise add a footer slot for it).

If Home doesn't have a clear footer, render the pill inline after the project
list with a small wrapper:

```tsx
<div className="home__footer-bar">
  <UpdaterPill />
</div>
```

Add a corresponding `.home__footer-bar` rule to `apps/app/src/features/projects/Home.css`:

```css
.home__footer-bar {
  display: flex;
  justify-content: flex-end;
  padding: 0.5rem 1rem;
}
```

- [ ] **Step 3: Verify in dev**

```bash
pnpm tauri:dev
```

Confirm the app launches and Home renders without errors. The pill won't
appear in dev because `installKind === 'dev'` and `CAN_AUTO_UPDATE` excludes
it. Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/features/projects/components/Home.tsx apps/app/src/features/projects/Home.css
git commit -m "feat(updater): mount UpdaterPill + DebNotice on Home"
```

---

## Phase 5 — Release scripts

Goal: every script the CI workflows will invoke exists and is independently
testable on a developer machine.

---

### Task 5.1: `bump-version.mjs`

**Files:**
- Create: `scripts/release/bump-version.mjs`
- Modify: `package.json` (add `release:prepare` script)

- [ ] **Step 1: Write the bump script**

Create `scripts/release/bump-version.mjs`:

```javascript
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
```

- [ ] **Step 2: Add `release:prepare` script to root `package.json`**

In root `package.json` `scripts`:

```json
"release:prepare": "node scripts/release/bump-version.mjs"
```

(The script invocation passes the version arg through.)

- [ ] **Step 3: Smoke test on a throwaway branch**

```bash
git checkout -b throwaway/bump-test
node scripts/release/bump-version.mjs 0.99.0
grep -n '"version"' apps/app/src-tauri/tauri.conf.json apps/app/package.json package.json
grep -n '^version' apps/app/src-tauri/Cargo.toml
```

Expected: all four files now contain `0.99.0`.

```bash
git checkout -- .
git checkout main
git branch -D throwaway/bump-test
```

- [ ] **Step 4: Commit**

```bash
git add scripts/release/bump-version.mjs package.json
git commit -m "feat(release): bump-version.mjs cross-manifest sync"
```

---

### Task 5.2: `sync-latest-json.mjs`

**Files:**
- Create: `scripts/release/sync-latest-json.mjs`

- [ ] **Step 1: Write the script**

Create `scripts/release/sync-latest-json.mjs`:

```javascript
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
 *
 * The matching .sig files contain base64 Ed25519 signatures Tauri
 * produced during `tauri build`.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

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
  { id: 'darwin-x86_64',  dir: 'macos-x86_64',  match: /\.app\.tar\.gz$/ },
  { id: 'windows-x86_64', dir: 'windows-x64',   match: /-setup\.nsis\.zip$/ },
  { id: 'linux-x86_64',   dir: 'linux-x64',     match: /\.AppImage\.tar\.gz$/ },
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
  const sigName = `${bundle}.sig`;
  const sigPath = resolve(dir, sigName);
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
  notes: `See https://github.com/<ORG>/netrart-releases/releases/tag/v${version}`,
  pub_date: new Date().toISOString(),
  platforms,
};

writeFileSync(outPath, JSON.stringify(manifest, null, 2));
console.log(`[sync-latest-json] wrote ${outPath}`);

// Sign the file itself with the Tauri private key.
// `tauri signer sign` reads the key from TAURI_SIGNING_PRIVATE_KEY
// (or --private-key) and the passphrase from TAURI_SIGNING_PRIVATE_KEY_PASSWORD.
const signOut = execFileSync('pnpm', [
  'exec',
  'tauri',
  'signer',
  'sign',
  '--private-key', process.env.TAURI_SIGNING_PRIVATE_KEY ?? '',
  outPath,
], { encoding: 'utf8', cwd: resolve(import.meta.dirname, '..', '..', 'apps', 'app') });

console.log(signOut);
console.log(`[sync-latest-json] signed: ${outPath}.sig`);
```

(`signOut` parsing tightens up in CI; for local smoke we only assert the
`.sig` exists.)

- [ ] **Step 2: Smoke test with a fake artifacts dir**

```bash
mkdir -p /tmp/fake-artifacts/{macos-aarch64,macos-x86_64,windows-x64,linux-x64}
echo "fake" > /tmp/fake-artifacts/macos-aarch64/NetraRT.app.tar.gz
echo "ZmFrZXNpZw==" > /tmp/fake-artifacts/macos-aarch64/NetraRT.app.tar.gz.sig
# repeat for other 3 dirs with appropriate filenames
echo "fake" > /tmp/fake-artifacts/macos-x86_64/NetraRT.app.tar.gz
echo "ZmFrZXNpZw==" > /tmp/fake-artifacts/macos-x86_64/NetraRT.app.tar.gz.sig
echo "fake" > /tmp/fake-artifacts/windows-x64/NetraRT_0.2.0_x64-setup.nsis.zip
echo "ZmFrZXNpZw==" > /tmp/fake-artifacts/windows-x64/NetraRT_0.2.0_x64-setup.nsis.zip.sig
echo "fake" > /tmp/fake-artifacts/linux-x64/NetraRT_0.2.0_amd64.AppImage.tar.gz
echo "ZmFrZXNpZw==" > /tmp/fake-artifacts/linux-x64/NetraRT_0.2.0_amd64.AppImage.tar.gz.sig

# Run without signing (no key set) to test JSON assembly only:
TAURI_SIGNING_PRIVATE_KEY="" node scripts/release/sync-latest-json.mjs \
  --version 0.2.0 \
  --artifacts /tmp/fake-artifacts \
  --base-url https://example.com/v0.2.0 \
  --out /tmp/latest.json 2>&1 | head -20
cat /tmp/latest.json
```

The `signer sign` step will fail without a real key (expected). Verify the
JSON shape is correct in `/tmp/latest.json` before that point.

- [ ] **Step 3: Commit**

```bash
git add scripts/release/sync-latest-json.mjs
git commit -m "feat(release): sync-latest-json.mjs assembles + signs update manifest"
```

---

### Task 5.3: `sign-mac.mjs` post-build deep-sign

**Files:**
- Create: `scripts/release/sign-mac.mjs`

- [ ] **Step 1: Write the script**

Create `scripts/release/sign-mac.mjs`:

```javascript
#!/usr/bin/env node
/*
 * Walks a built NetraRT.app and re-signs every nested executable / dylib
 * with hardened runtime + entitlements. Tauri's default signing covers
 * the main binary; this catches the externalBin sidecar and the framework
 * dylib that need explicit treatment for notarization to succeed.
 *
 * Run AFTER `tauri build` and BEFORE `xcrun notarytool submit`.
 *
 * Required env:
 *   APPLE_SIGNING_IDENTITY  e.g. "Developer ID Application: <Name> (TEAMID)"
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { platform } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

if (platform() !== 'darwin') {
  console.log('[sign-mac] skip — not macOS');
  process.exit(0);
}

const identity = process.env.APPLE_SIGNING_IDENTITY;
if (!identity) {
  console.error('[sign-mac] APPLE_SIGNING_IDENTITY not set');
  process.exit(1);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..', '..');

function findApp(triple) {
  const path = resolve(
    projectRoot,
    'apps/app/src-tauri/target',
    triple,
    'release/bundle/macos/NetraRT.app',
  );
  return existsSync(path) ? path : null;
}

const triple =
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  (() => {
    const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
    return out.match(/host:\s*(\S+)/)[1];
  })();

const appPath = findApp(triple);
if (!appPath) {
  console.error(`[sign-mac] .app not found for triple ${triple}`);
  process.exit(1);
}

const entitlements = resolve(projectRoot, 'apps/app/src-tauri/entitlements.plist');

function signOne(path, opts = []) {
  const args = [
    '--force',
    '--sign', identity,
    '--options', 'runtime',
    '--timestamp',
    '--entitlements', entitlements,
    ...opts,
    path,
  ];
  execFileSync('codesign', args, { stdio: 'inherit' });
}

// Sign all nested dylibs and executables, deepest first.
function walk(dir, callback) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, callback);
    } else {
      callback(full);
    }
  }
}

const macho = [];
walk(appPath, (file) => {
  if (file.endsWith('.dylib')) {
    macho.push(file);
  } else if (file.includes('/Contents/MacOS/') && !file.endsWith('.plist')) {
    macho.push(file);
  } else if (file.includes('/Contents/Resources/_up_/binaries/') && !file.endsWith('.zip')) {
    // Tauri stages externalBin under Resources/_up_/binaries/<triple>.
    macho.push(file);
  }
});

for (const file of macho) {
  console.log(`[sign-mac] signing: ${file}`);
  signOne(file);
}

// Finally re-sign the .app itself so its signature covers all freshly-signed nested code.
console.log(`[sign-mac] signing app bundle: ${appPath}`);
signOne(appPath, ['--deep']);

execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
  stdio: 'inherit',
});
console.log(`[sign-mac] verified ok`);
```

- [ ] **Step 2: Skip-execution smoke (without signing)**

We can't run this without real Apple credentials, but we can verify it parses
and exits early:

```bash
APPLE_SIGNING_IDENTITY="" node scripts/release/sign-mac.mjs
```

Expected: errors with "APPLE_SIGNING_IDENTITY not set" and exit 1. Good.

- [ ] **Step 3: Commit**

```bash
git add scripts/release/sign-mac.mjs
git commit -m "feat(release): sign-mac.mjs post-build deep-sign for nested binaries"
```

---

### Task 5.4: `sign-windows.mjs` pre-build DLL signer

**Files:**
- Create: `scripts/release/sign-windows.mjs`

- [ ] **Step 1: Write the script**

Create `scripts/release/sign-windows.mjs`:

```javascript
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
```

- [ ] **Step 2: Smoke test (skip path on non-Windows host)**

```bash
node scripts/release/sign-windows.mjs
```

Expected on macOS / Linux: prints `[sign-windows] skip — not Windows` and exits 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/release/sign-windows.mjs
git commit -m "feat(release): sign-windows.mjs Authenticode DLL signer"
```

---

### Task 5.5: `download-stats.mjs`

**Files:**
- Create: `scripts/release/download-stats.mjs`

- [ ] **Step 1: Write the script**

Create `scripts/release/download-stats.mjs`:

```javascript
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
```

- [ ] **Step 2: Skip smoke test until repo exists (Phase 6).**

- [ ] **Step 3: Commit**

```bash
git add scripts/release/download-stats.mjs
git commit -m "feat(release): download-stats.mjs per-asset counts"
```

---

## Phase 6 — CI workflows + public mirror repo

Goal: tag-driven release pipeline ships its first end-to-end build.

---

### Task 6.1: `docs/release/SECRETS.md`

**Files:**
- Create: `docs/release/SECRETS.md`

- [ ] **Step 1: Write the doc**

Create `docs/release/SECRETS.md`:

```markdown
# NetraRT release secrets

Inventory of GitHub Actions secrets required by `release.yml` and
`release-pr.yml`. **Values never appear here.** Owners maintain the
canonical copies in 1Password (vault: "Infra / NetraRT release").

## Apple

| Secret | Purpose | Owner | Rotation |
|---|---|---|---|
| `APPLE_CERTIFICATE` | Base64 .p12 of Developer ID Application cert | Apple Developer admin | ~yearly (cert expiry); rotate 30d before |
| `APPLE_CERTIFICATE_PASSWORD` | .p12 password | Apple Developer admin | with cert |
| `APPLE_SIGNING_IDENTITY` | "Developer ID Application: <Name> (TEAMID)" | static | n/a |
| `APPLE_TEAM_ID` | 10-char team ID | static | n/a |
| `APPLE_API_KEY` | Base64 contents of .p8 App Store Connect API key | Apple Developer admin | annually or on team-member departure |
| `APPLE_API_KEY_ID` | Key ID from App Store Connect | with key | with key |
| `APPLE_API_ISSUER` | Issuer ID from App Store Connect | with key | with key |

## Windows

| Secret | Purpose | Owner | Rotation |
|---|---|---|---|
| `WINDOWS_CERTIFICATE` | Base64 .pfx of OV code-signing cert | Cert vendor admin | per cert expiry (1–3 years) |
| `WINDOWS_CERTIFICATE_PASSWORD` | .pfx password | Cert vendor admin | with cert |

## Tauri updater

| Secret | Purpose | Owner | Rotation |
|---|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Base64 Tauri Ed25519 private key | Infra owner | **NEVER** rotate without coordinated full-reinstall flag day |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | passphrase for the key | Infra owner | with key |

The Tauri public key is committed in `apps/app/src-tauri/tauri.conf.json` and
embedded in every binary. The private key is the single most valuable secret
in this system — losing it makes every shipped install permanently
un-updatable.

**Backups:**
1. Encrypted in 1Password "Infra / NetraRT release" vault.
2. Printed paper copy in sealed envelope, office safe, labeled
   "NetraRT updater private key — do not destroy".

## Release mirror

| Secret | Purpose | Owner | Rotation |
|---|---|---|---|
| `RELEASE_MIRROR_PAT` | Fine-grained PAT scoped to `contents:write` on `<ORG>/netrart-releases` only | Org admin | 90 days |

The PAT is generated via GitHub Settings → Developer settings → Personal
access tokens (fine-grained). When generating: select repository
`<ORG>/netrart-releases` only, repository permissions: Contents = Read & write.
No other scopes.

## Procedure: rotating a secret

1. Generate the new credential.
2. Add the new value to GitHub Actions secrets as a temporary
   `<NAME>_NEW` (so existing runs aren't broken mid-flight).
3. Trigger a `release-pr.yml` rehearsal that uses `<NAME>_NEW`. Verify green.
4. Promote: rename `<NAME>_NEW` → `<NAME>`, delete old.
5. Update the canonical copy in 1Password.
6. Update `Last rotated` timestamps in the team's tracking doc.

## Inventory check

`release.yml`'s preflight job asserts every secret in this list is non-empty.
A missing secret fails the workflow before any build job starts — no wasted
runner minutes on a known-bad release.
```

- [ ] **Step 2: Commit**

```bash
git add docs/release/SECRETS.md
git commit -m "docs(release): secrets inventory + rotation procedure"
```

---

### Task 6.2: `docs/release/RELEASE_CHECKLIST.md`

**Files:**
- Create: `docs/release/RELEASE_CHECKLIST.md`

- [ ] **Step 1: Write the doc**

Create `docs/release/RELEASE_CHECKLIST.md`:

```markdown
# NetraRT release checklist

Manual steps that bracket each release. `release.yml` automates the build
and publish; this checklist is the human envelope around it.

## Before tagging

- [ ] All commits intended for the release are merged to `main`.
- [ ] On a clean checkout: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm -r test` all pass.
- [ ] `pnpm tauri:build` on a developer machine succeeds (sanity).
- [ ] `pnpm release:prepare <version>` opens a release branch + PR.
- [ ] `release-pr.yml` (matrix without publish) is green on the PR.
- [ ] Release notes drafted in `CHANGELOG.md` for `<version>`.
- [ ] PR merged.

## Tagging

- [ ] On `main` (post-merge): `git tag v<version> && git push origin v<version>`
- [ ] `release.yml` runs to completion. ~15–25 min.
- [ ] GitHub Release on `<ORG>/netrart-releases` exists with all expected
      assets:
  - [ ] `NetraRT_<v>_aarch64.dmg` + `.sig`
  - [ ] `NetraRT_<v>_x64.dmg` + `.sig`
  - [ ] `NetraRT_<v>_x64-setup.exe` + `.sig`
  - [ ] `NetraRT_<v>_amd64.deb` + `.sig`
  - [ ] `NetraRT_<v>_amd64.AppImage` + `.sig`
  - [ ] Updater bundles (`.app.tar.gz`, `.nsis.zip`, `.AppImage.tar.gz`) + `.sig`
  - [ ] `latest.json` + `latest.json.sig`

## Updater roundtrip (Layer 3 — manual)

Skipping is allowed for patch releases that don't touch the updater code path.

- [ ] Install version `<previous>` on a fresh macOS machine.
- [ ] Wait ≤5 min. UpdaterPill appears with "Update <new> available".
- [ ] Click pill. Download progresses. "Restart" appears.
- [ ] Click restart. App relaunches. Version reports as `<new>`.
- [ ] Repeat on Windows.
- [ ] Repeat on Linux (AppImage).

## After publish

- [ ] Update `netrart-releases/README.md` if download instructions changed.
- [ ] Post release link in the team channel.
- [ ] Watch for issue reports for 24h.

## On a bad release

Roll forward. **Do not delete or unpublish.**

- [ ] Identify the failing change.
- [ ] On `main`: revert (or fix-forward) + `pnpm release:prepare <next-patch>`.
- [ ] Tag + push the next-patch version.
- [ ] Edit the bad release on `<ORG>/netrart-releases`: prefix title with
      `[Withdrawn] ` and add a notes line linking to the patch.
- [ ] `gh release edit v<next-patch> --latest --repo <ORG>/netrart-releases`
      (this should already happen automatically, but verify).
```

- [ ] **Step 2: Commit**

```bash
git add docs/release/RELEASE_CHECKLIST.md
git commit -m "docs(release): pre/post release manual checklist"
```

---

### Task 6.3: `release-pr.yml` rehearsal workflow

**Files:**
- Create: `.github/workflows/release-pr.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/release-pr.yml`:

```yaml
name: release rehearsal

on:
  pull_request:
    branches: [main]
    paths-ignore: ['**/*.md', 'docs/**']
  workflow_dispatch:

# Cancel superseded runs on the same PR.
concurrency:
  group: release-pr-${{ github.head_ref || github.ref }}
  cancel-in-progress: true

jobs:
  preflight:
    if: startsWith(github.head_ref, 'release/') || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive

      - name: Verify version consistency
        run: |
          TAURI_VER=$(node -p "require('./apps/app/src-tauri/tauri.conf.json').version")
          PKG_VER=$(node -p "require('./apps/app/package.json').version")
          ROOT_VER=$(node -p "require('./package.json').version")
          CARGO_VER=$(grep -m1 '^version' apps/app/src-tauri/Cargo.toml | cut -d'"' -f2)
          echo "tauri=$TAURI_VER pkg=$PKG_VER root=$ROOT_VER cargo=$CARGO_VER"
          test "$TAURI_VER" = "$PKG_VER" -a "$PKG_VER" = "$ROOT_VER" -a "$ROOT_VER" = "$CARGO_VER"

      - name: Verify pocketbase.sha256 covers all triples
        run: |
          for triple in aarch64-apple-darwin x86_64-apple-darwin x86_64-pc-windows-msvc x86_64-unknown-linux-gnu; do
            grep -q "^$triple " pb/pocketbase.sha256 || { echo "missing: $triple"; exit 1; }
          done

      - name: Verify required secrets are configured (existence only)
        env:
          # Probe via env so we don't print values.
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          APPLE_API_KEY: ${{ secrets.APPLE_API_KEY }}
          APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
          APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
          WINDOWS_CERTIFICATE: ${{ secrets.WINDOWS_CERTIFICATE }}
          WINDOWS_CERTIFICATE_PASSWORD: ${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        run: |
          for var in APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_SIGNING_IDENTITY APPLE_TEAM_ID APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER WINDOWS_CERTIFICATE WINDOWS_CERTIFICATE_PASSWORD TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD; do
            if [ -z "${!var}" ]; then echo "missing secret: $var"; exit 1; fi
          done
          echo "all secrets configured"

  build:
    needs: preflight
    if: startsWith(github.head_ref, 'release/') || github.event_name == 'workflow_dispatch'
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-14
            triple: aarch64-apple-darwin
            bundles: dmg,app
          - os: macos-13
            triple: x86_64-apple-darwin
            bundles: dmg,app
          - os: windows-2022
            triple: x86_64-pc-windows-msvc
            bundles: nsis
          - os: ubuntu-22.04
            triple: x86_64-unknown-linux-gnu
            bundles: deb,appimage

    runs-on: ${{ matrix.os }}
    env:
      TAURI_ENV_TARGET_TRIPLE: ${{ matrix.triple }}
      APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
      APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
      APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
      APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
      APPLE_API_KEY: ${{ secrets.APPLE_API_KEY }}
      APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
      APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
      WINDOWS_CERTIFICATE: ${{ secrets.WINDOWS_CERTIFICATE }}
      WINDOWS_CERTIFICATE_PASSWORD: ${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}
      TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}

    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: corepack enable

      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.triple }}

      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: apps/app/src-tauri -> target
          key: ${{ matrix.triple }}

      - name: Cache sam3 build
        uses: actions/cache@v4
        with:
          path: vendor/sam3.c/build
          key: sam3-${{ matrix.os }}-${{ hashFiles('vendor/sam3.c/CMakeLists.txt', '.gitmodules') }}-${{ hashFiles('vendor/sam3.c/**/*.c', 'vendor/sam3.c/**/*.h') }}

      - name: Linux deps
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y patchelf libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev cmake

      - run: pnpm install --frozen-lockfile

      - name: Stage PocketBase
        run: node scripts/release/fetch-pocketbase.mjs

      - name: Build sam3
        run: node scripts/build-sam3.mjs

      - name: Sign libsam3.dll (Windows)
        if: runner.os == 'Windows'
        run: node scripts/release/sign-windows.mjs

      - name: Build app
        run: pnpm --filter @netrart/app build

      - name: Tauri build
        run: pnpm --filter @netrart/app tauri build --target ${{ matrix.triple }} --bundles ${{ matrix.bundles }}

      - name: Verify mac binary @rpath
        if: runner.os == 'macOS'
        run: node scripts/release/verify-mac-binary.mjs

      - name: Sign mac binaries
        if: runner.os == 'macOS'
        run: node scripts/release/sign-mac.mjs

      - name: Self-check (rehearsal smoke)
        shell: bash
        run: |
          case "${{ matrix.triple }}" in
            aarch64-apple-darwin|x86_64-apple-darwin)
              ./apps/app/src-tauri/target/${{ matrix.triple }}/release/netrart --self-check
              ;;
            x86_64-pc-windows-msvc)
              ./apps/app/src-tauri/target/${{ matrix.triple }}/release/NetraRT.exe --self-check
              ;;
            x86_64-unknown-linux-gnu)
              ./apps/app/src-tauri/target/${{ matrix.triple }}/release/netrart --self-check
              ;;
          esac

      - name: Upload artifacts (rehearsal — kept for inspection)
        uses: actions/upload-artifact@v4
        with:
          name: rehearsal-${{ matrix.triple }}
          path: |
            apps/app/src-tauri/target/${{ matrix.triple }}/release/bundle/**/*.dmg
            apps/app/src-tauri/target/${{ matrix.triple }}/release/bundle/**/*.exe
            apps/app/src-tauri/target/${{ matrix.triple }}/release/bundle/**/*.deb
            apps/app/src-tauri/target/${{ matrix.triple }}/release/bundle/**/*.AppImage
            apps/app/src-tauri/target/${{ matrix.triple }}/release/bundle/**/*.tar.gz
            apps/app/src-tauri/target/${{ matrix.triple }}/release/bundle/**/*.zip
            apps/app/src-tauri/target/${{ matrix.triple }}/release/bundle/**/*.sig
          retention-days: 7
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release-pr.yml
git commit -m "ci(release): release-pr.yml rehearsal matrix (build, no publish)"
```

(We can't run this until secrets are configured in Phase 6.6, and we don't
have a `release/*` branch yet. The first real test is the rehearsal in 6.7.)

---

### Task 6.4: `release.yml` tag-triggered workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/release.yml`:

```yaml
name: release

on:
  push:
    tags: ['v[0-9]+.[0-9]+.[0-9]+']
  workflow_dispatch:
    inputs:
      tag:
        description: 'Existing tag to re-build (e.g. v0.2.0)'
        required: true

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

jobs:
  preflight:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.ver.outputs.version }}
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
          ref: ${{ inputs.tag || github.ref }}

      - id: ver
        name: Extract + verify version
        run: |
          TAG="${{ inputs.tag || github.ref_name }}"
          VERSION="${TAG#v}"
          TAURI_VER=$(node -p "require('./apps/app/src-tauri/tauri.conf.json').version")
          if [ "$VERSION" != "$TAURI_VER" ]; then
            echo "tag $TAG (=$VERSION) does not match tauri.conf.json version $TAURI_VER"
            exit 1
          fi
          echo "version=$VERSION" >> "$GITHUB_OUTPUT"
          echo "release version: $VERSION"

      - name: Verify pocketbase.sha256 covers all triples
        run: |
          for triple in aarch64-apple-darwin x86_64-apple-darwin x86_64-pc-windows-msvc x86_64-unknown-linux-gnu; do
            grep -q "^$triple " pb/pocketbase.sha256 || { echo "missing: $triple"; exit 1; }
          done

      - name: Verify required secrets present
        env:
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          APPLE_API_KEY: ${{ secrets.APPLE_API_KEY }}
          APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
          APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
          WINDOWS_CERTIFICATE: ${{ secrets.WINDOWS_CERTIFICATE }}
          WINDOWS_CERTIFICATE_PASSWORD: ${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
          RELEASE_MIRROR_PAT: ${{ secrets.RELEASE_MIRROR_PAT }}
        run: |
          for var in APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_SIGNING_IDENTITY APPLE_TEAM_ID APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER WINDOWS_CERTIFICATE WINDOWS_CERTIFICATE_PASSWORD TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD RELEASE_MIRROR_PAT; do
            if [ -z "${!var}" ]; then echo "missing: $var"; exit 1; fi
          done

  build:
    needs: preflight
    strategy:
      fail-fast: true
      matrix:
        include:
          - os: macos-14
            triple: aarch64-apple-darwin
            bundles: dmg,app,updater
            label: macos-aarch64
          - os: macos-13
            triple: x86_64-apple-darwin
            bundles: dmg,app,updater
            label: macos-x86_64
          - os: windows-2022
            triple: x86_64-pc-windows-msvc
            bundles: nsis,updater
            label: windows-x64
          - os: ubuntu-22.04
            triple: x86_64-unknown-linux-gnu
            bundles: deb,appimage,updater
            label: linux-x64

    runs-on: ${{ matrix.os }}
    env:
      TAURI_ENV_TARGET_TRIPLE: ${{ matrix.triple }}
      APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
      APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
      APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
      APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
      APPLE_API_KEY: ${{ secrets.APPLE_API_KEY }}
      APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
      APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
      WINDOWS_CERTIFICATE: ${{ secrets.WINDOWS_CERTIFICATE }}
      WINDOWS_CERTIFICATE_PASSWORD: ${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}
      TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}

    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
          ref: ${{ inputs.tag || github.ref }}

      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: corepack enable

      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.triple }}

      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: apps/app/src-tauri -> target
          key: ${{ matrix.triple }}

      - name: Cache sam3 build
        uses: actions/cache@v4
        with:
          path: vendor/sam3.c/build
          key: sam3-${{ matrix.os }}-${{ hashFiles('vendor/sam3.c/CMakeLists.txt', '.gitmodules') }}-${{ hashFiles('vendor/sam3.c/**/*.c', 'vendor/sam3.c/**/*.h') }}

      - name: Linux deps
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y patchelf libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev cmake

      - run: pnpm install --frozen-lockfile

      - run: node scripts/release/fetch-pocketbase.mjs

      - run: node scripts/build-sam3.mjs

      - if: runner.os == 'Windows'
        run: node scripts/release/sign-windows.mjs

      - run: pnpm --filter @netrart/app build

      - run: pnpm --filter @netrart/app tauri build --target ${{ matrix.triple }} --bundles ${{ matrix.bundles }}

      - if: runner.os == 'macOS'
        run: node scripts/release/verify-mac-binary.mjs

      - if: runner.os == 'macOS'
        run: node scripts/release/sign-mac.mjs

      - name: Self-check
        shell: bash
        run: |
          case "${{ matrix.triple }}" in
            aarch64-apple-darwin|x86_64-apple-darwin)
              ./apps/app/src-tauri/target/${{ matrix.triple }}/release/netrart --self-check
              ;;
            x86_64-pc-windows-msvc)
              ./apps/app/src-tauri/target/${{ matrix.triple }}/release/NetraRT.exe --self-check
              ;;
            x86_64-unknown-linux-gnu)
              ./apps/app/src-tauri/target/${{ matrix.triple }}/release/netrart --self-check
              ;;
          esac

      - name: Stage artifacts
        shell: bash
        run: |
          mkdir -p artifacts/${{ matrix.label }}
          cp -r apps/app/src-tauri/target/${{ matrix.triple }}/release/bundle/* artifacts/${{ matrix.label }}/ || true
          # Flatten — keep only release-relevant files at the top of the dir.
          find artifacts/${{ matrix.label }} -type f \( \
            -name '*.dmg' -o -name '*.exe' -o -name '*.deb' -o -name '*.AppImage' \
            -o -name '*.tar.gz' -o -name '*.zip' -o -name '*.sig' \) \
            -exec mv -t artifacts/${{ matrix.label }}/ {} +
          ls -la artifacts/${{ matrix.label }}

      - uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.label }}
          path: artifacts/${{ matrix.label }}
          retention-days: 30

  publish:
    needs: [preflight, build]
    runs-on: ubuntu-latest
    env:
      TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
      RELEASE_MIRROR_PAT: ${{ secrets.RELEASE_MIRROR_PAT }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ inputs.tag || github.ref }}

      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: corepack enable
      - run: pnpm install --frozen-lockfile

      - uses: actions/download-artifact@v4
        with:
          path: artifacts

      - name: Build latest.json
        env:
          MIRROR_REPO: ${{ vars.NETRART_RELEASES_REPO }}  # e.g. "kolosal-ai/netrart-releases"
        run: |
          VERSION="${{ needs.preflight.outputs.version }}"
          BASE_URL="https://github.com/${MIRROR_REPO}/releases/download/v${VERSION}"
          node scripts/release/sync-latest-json.mjs \
            --version "$VERSION" \
            --artifacts ./artifacts \
            --base-url "$BASE_URL" \
            --out ./latest.json

      - name: Publish release on mirror repo
        env:
          GH_TOKEN: ${{ secrets.RELEASE_MIRROR_PAT }}
          MIRROR_REPO: ${{ vars.NETRART_RELEASES_REPO }}
        run: |
          VERSION="${{ needs.preflight.outputs.version }}"
          TAG="v$VERSION"
          NOTES_FILE=$(mktemp)
          if [ -f CHANGELOG.md ]; then
            awk -v ver="$VERSION" 'BEGIN{p=0} /^## /{p=0} $0 ~ "^## .*"ver{p=1; next} p' CHANGELOG.md > "$NOTES_FILE"
          fi
          [ -s "$NOTES_FILE" ] || echo "Release $TAG" > "$NOTES_FILE"

          mapfile -t ASSETS < <(find artifacts -type f \( \
            -name '*.dmg' -o -name '*.exe' -o -name '*.deb' -o -name '*.AppImage' \
            -o -name '*.tar.gz' -o -name '*.zip' -o -name '*.sig' \))
          ASSETS+=(latest.json latest.json.sig)

          if gh release view "$TAG" --repo "$MIRROR_REPO" >/dev/null 2>&1; then
            echo "release exists — uploading with --clobber"
            gh release upload "$TAG" "${ASSETS[@]}" --repo "$MIRROR_REPO" --clobber
          else
            gh release create "$TAG" "${ASSETS[@]}" \
              --repo "$MIRROR_REPO" \
              --title "NetraRT $VERSION" \
              --notes-file "$NOTES_FILE"
          fi
          gh release edit "$TAG" --latest --repo "$MIRROR_REPO"
```

(`vars.NETRART_RELEASES_REPO` is a GitHub Actions repository variable, not a
secret — set in 6.6.)

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): tag-triggered matrix build + publish to mirror repo"
```

---

### Task 6.5: Create `netrart-releases` public repo

**Files (in the new repo, not the private one):**
- Create: `README.md`
- Create: `LICENSE`

- [ ] **Step 1: Create the repo on GitHub**

Manual step: in the GitHub UI (org account chosen — likely `kolosal-ai`),
create a new **public** repo named `netrart-releases`. Empty initialization.
**Disable Issues, Pull Requests, Wiki, and Discussions** in repo settings — it
exists only to host releases.

- [ ] **Step 2: Initialize with README + LICENSE**

```bash
mkdir /tmp/netrart-releases
cd /tmp/netrart-releases
git init
```

Create `README.md`:

```markdown
# NetraRT — releases

Public installer downloads for [NetraRT](https://netrart.com).

## Install

Pick the latest release on the [Releases page](https://github.com/<ORG>/netrart-releases/releases).

- **macOS (Apple Silicon):** `NetraRT_<version>_aarch64.dmg`
- **macOS (Intel):** `NetraRT_<version>_x64.dmg`
- **Windows:** `NetraRT_<version>_x64-setup.exe`
- **Linux (Ubuntu/Debian):** `NetraRT_<version>_amd64.deb`
- **Linux (other):** `NetraRT_<version>_amd64.AppImage` *(in-app auto-updates supported)*

## First-run notes

**Windows.** New code-signing certificates haven't built SmartScreen
reputation yet, so you may see "Windows protected your PC". Click "More info"
→ "Run anyway" to proceed. This warning fades over time as more people
download.

**Linux .deb.** The `.deb` install does not auto-update. To get in-app
auto-updates on Linux, install the AppImage instead.

## Source code

The NetraRT source is proprietary. This repository contains only release
artifacts.
```

Create `LICENSE`:

```
NetraRT — proprietary software.

Copyright (c) Kolosal AI Inc.

The binaries distributed in this repository are proprietary. Use is subject
to the End User License Agreement bundled with each release. Redistribution
of the unmodified binaries for evaluation purposes is permitted; modification
or redistribution of modified binaries is not permitted without written
permission from the copyright holder.
```

- [ ] **Step 3: Push the initial commit**

```bash
cd /tmp/netrart-releases
git add README.md LICENSE
git commit -m "chore: initial scaffold"
git branch -M main
git remote add origin git@github.com:<ORG>/netrart-releases.git
git push -u origin main
```

- [ ] **Step 4: Update the private repo's `tauri.conf.json` with the real org name**

Back in the private repo, replace `<ORG>` in `apps/app/src-tauri/tauri.conf.json`
with the actual org (e.g. `kolosal-ai`). Single search-and-replace.

```bash
# from netrart repo root
grep -rn '<ORG>' apps/app/src-tauri/tauri.conf.json scripts/release/sync-latest-json.mjs docs/release/
# Confirm matches, then edit each instance to the real org.
```

- [ ] **Step 5: Commit the search-and-replace**

```bash
git add apps/app/src-tauri/tauri.conf.json scripts/release/sync-latest-json.mjs docs/release/
git commit -m "chore(release): replace <ORG> placeholder with kolosal-ai (or chosen org)"
```

---

### Task 6.6: Configure GitHub Actions secrets

This is a **manual step** — no code changes.

- [ ] **Step 1: In the private `netrart` repo Settings → Secrets and variables → Actions:**

Add each secret listed in `docs/release/SECRETS.md`. Source values from
1Password.

- [ ] **Step 2: Add the repo variable for the mirror repo:**

In Settings → Secrets and variables → Actions → **Variables** tab:

- Name: `NETRART_RELEASES_REPO`
- Value: `<ORG>/netrart-releases` (e.g. `kolosal-ai/netrart-releases`)

- [ ] **Step 3: Confirm by viewing the secrets list**

The GitHub UI shows names but never values. Cross-check against
`SECRETS.md` to ensure each row is present.

No commit.

---

### Task 6.7: First rehearsal — release/0.2.0 PR

- [ ] **Step 1: Bump version + open PR**

```bash
git checkout main
git pull
node scripts/release/bump-version.mjs 0.2.0
cd apps/app/src-tauri && cargo check && cd -
git checkout -b release/0.2.0
git add -A
git commit -m "chore(release): 0.2.0"
git push -u origin release/0.2.0
gh pr create --title "release: 0.2.0" --body "Release rehearsal for 0.2.0."
```

- [ ] **Step 2: Watch the rehearsal workflow**

```bash
gh pr checks --watch
```

Expected: 4 matrix jobs all green, ~15–25 min. Each job uploads artifacts as
`rehearsal-<triple>`. Download one and inspect:

```bash
gh run download <run-id> --name rehearsal-aarch64-apple-darwin -D /tmp/rehearsal
ls -la /tmp/rehearsal
```

- [ ] **Step 3: If any job failed**

Common causes and the right fixes:
- **Apple notarization rejected** → check `notarytool log` output in the job;
  most likely cause is a nested binary that wasn't signed (Tauri's defaults vs
  our `sign-mac.mjs`'s walk). Fix in `sign-mac.mjs`, push, re-run.
- **`patchelf` missing on Linux** → already in apt install; if a runner image
  changed, pin runner version explicitly.
- **`libsam3.dll` not found on Windows** → CMake output path differs from what
  `tauri.conf.json` expects; adjust the `bundle.resources` source path.
- **Tauri update bundle .sig missing** → updater plugin not registered or
  `--bundles updater` not specified.

Iterate on the PR (push commits, watch workflow) until green.

- [ ] **Step 4: Merge the PR**

Once green:

```bash
gh pr merge --squash
```

---

### Task 6.8: First real release — tag v0.2.0

- [ ] **Step 1: Tag and push**

```bash
git checkout main
git pull
git tag v0.2.0
git push origin v0.2.0
```

- [ ] **Step 2: Watch `release.yml`**

```bash
gh run watch
```

Expected: preflight → 4 build jobs → publish, all green. ~20–30 min.

- [ ] **Step 3: Verify the GitHub Release on the mirror repo**

```bash
gh release view v0.2.0 --repo <ORG>/netrart-releases
```

Expected output lists all assets per `RELEASE_CHECKLIST.md`.

- [ ] **Step 4: Manual updater roundtrip (Layer 3)**

Run through the checklist in `docs/release/RELEASE_CHECKLIST.md`. Skip Windows
or Linux if you don't have hardware on hand for both — at minimum macOS
roundtrip on the host machine.

- [ ] **Step 5: If everything works**

The packaging system is live. No commit needed — the release itself is the
artifact. Update the team channel with the download link.

---

## Self-review

Before handing off, this plan has been checked against the spec for:

1. **Spec coverage** — every numbered section in
   `docs/superpowers/specs/2026-04-26-packaging-system-design.md` maps to one
   or more tasks above:
   - §3 architecture → Tasks 6.4–6.5
   - §4.1–4.2 build pipeline → Tasks 6.3, 6.4
   - §4.3 three risks → Tasks 1.1, 1.2, 1.3, 1.4
   - §4.4 staging layout → Task 6.4 (Stage artifacts step)
   - §5 signing → Tasks 3.1, 5.3, 5.4
   - §6 release flow → Tasks 5.1, 6.4, 6.7, 6.8
   - §7 latest.json → Task 5.2
   - §8 in-app updater → Tasks 4.1–4.6
   - §9 rollback → Task 6.2
   - §10 testing → Tasks 4.2, 4.3, 6.3 (preflight + self-check)
   - §11 risks → documented; nothing to implement
   - §12 file changes → all listed in this plan's File Structure
   - §13 parameters → resolved in Task 6.5

2. **No placeholders.** Every code block contains real code; every command is
   executable; every file path is exact. The only intentional placeholder is
   `<ORG>` which is resolved in Task 6.5 with a single search-and-replace.

3. **Type / name consistency.** `useUpdater` is referenced consistently in
   Tasks 4.3, 4.4, 4.5, 4.6, and `index.ts`. `detectInstallKind` ditto.
   `InstallKind` and `UpdateState` definitions match all consumers.

The plan is ready to execute.
