# SAM3 Tauri Smoke Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bundle the SAM3 Rust binding into the NetraRT Tauri desktop app so that a version badge reading `SAM3 v{x}` renders in the top-left wordmark HUD, proving the `vendor/sam3.c/` → Rust binding → Tauri FFI → frontend toolchain works end-to-end.

**Architecture:** Add a `pnpm sam3:build` Node script that invokes CMake on the vendored `sam3.c` submodule (`-DSAM3_SHARED=ON`), chain it into the Tauri `beforeDevCommand`/`beforeBuildCommand` so it runs transparently before `cargo build`. Extend `apps/app/src-tauri/build.rs` to copy `libsam3.dylib` next to the compiled binary so the `@loader_path` rpath baked by `sam3-sys` resolves at runtime. Expose one `#[tauri::command] sam3_version()` that calls `sam3::version()` and render it in a new `<Sam3VersionBadge />` React component mounted inside the existing wordmark.

**Tech Stack:** Tauri v2 (Rust), `sam3` safe wrapper crate (path dep into vendored submodule), CMake + Ninja/Make for libsam3, Node.js 20+ for the build script, React 18 + TypeScript for the badge, `@tauri-apps/api/core` for `invoke()`.

**Spec:** [`docs/superpowers/specs/2026-04-22-sam3-tauri-smoke-test-design.md`](../specs/2026-04-22-sam3-tauri-smoke-test-design.md)

**Platform scope:** macOS only for this milestone. Linux/Windows are explicit non-goals.

**Prerequisites** (must exist before starting):
- The `vendor/sam3.c` submodule is initialized at commit `4d58bc7` or later (`git submodule status vendor/sam3.c`).
- `cmake --version` returns ≥ 3.20.
- Working Rust toolchain matching `rust-toolchain.toml` in the sam3.c submodule.
- Xcode command-line tools installed (for Metal headers).

---

## File Structure

**New files:**
- `scripts/build-sam3.mjs` — Node script that invokes CMake to build `libsam3.dylib` into `vendor/sam3.c/build/`. Pattern mirrors `scripts/stage-pocketbase.mjs`.
- `apps/app/src/components/Sam3VersionBadge.tsx` — React component that invokes the Tauri command and renders a tag inside the wordmark.

**Modified files:**
- `apps/app/package.json` — add `"sam3:build"` script entry.
- `apps/app/src-tauri/Cargo.toml` — add `sam3` path dependency.
- `apps/app/src-tauri/build.rs` — add dylib copy + extra rpath logic.
- `apps/app/src-tauri/src/lib.rs` — add `sam3_version()` command, register in handler.
- `apps/app/src-tauri/tauri.conf.json` — chain `sam3:build` in before-commands; add `bundle.macOS.frameworks`.
- `apps/app/src/Canvas.tsx` — mount `<Sam3VersionBadge />` inside the wordmark HUD (after the existing `conn` tag around line 1498).

**Intentionally not touched:** `Canvas.tsx` logic beyond the one-line JSX insertion, `SettingsModal.tsx`, any canvas state, any styles beyond what the badge's own className needs.

---

## Task 1: Add the Node script that builds libsam3

**Files:**
- Create: `scripts/build-sam3.mjs`
- Modify: `apps/app/package.json`

- [ ] **Step 1.1: Create the build script**

Create `scripts/build-sam3.mjs` with the following contents:

```javascript
#!/usr/bin/env node
/*
 * Build vendor/sam3.c as a shared library.
 *
 * Invokes CMake with SAM3_SHARED=ON and produces
 * vendor/sam3.c/build/libsam3.{dylib,so}. Idempotent: CMake's own
 * incremental logic makes re-runs cheap when nothing changed.
 *
 * Called from apps/app/src-tauri/tauri.conf.json via
 * `beforeDevCommand` / `beforeBuildCommand`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const sam3Dir = resolve(projectRoot, 'vendor', 'sam3.c');
const buildDir = resolve(sam3Dir, 'build');

if (!existsSync(resolve(sam3Dir, 'CMakeLists.txt'))) {
  console.error('[build-sam3] vendor/sam3.c is not checked out.');
  console.error('[build-sam3] run: git submodule update --init --recursive');
  process.exit(1);
}

mkdirSync(buildDir, { recursive: true });

const isMac = platform() === 'darwin';
const libName = isMac ? 'libsam3.dylib' : 'libsam3.so';

const configureArgs = [
  '-S', sam3Dir,
  '-B', buildDir,
  '-DSAM3_SHARED=ON',
  '-DCMAKE_BUILD_TYPE=Release',
  '-DSAM3_TESTS=OFF',
];

const buildArgs = [
  '--build', buildDir,
  '--config', 'Release',
  '--target', 'sam3',
  '--parallel',
];

function run(bin, args) {
  console.log(`[build-sam3] ${bin} ${args.join(' ')}`);
  execFileSync(bin, args, { stdio: 'inherit' });
}

run('cmake', configureArgs);
run('cmake', buildArgs);

const producedLib = resolve(buildDir, libName);
if (!existsSync(producedLib)) {
  console.error(`[build-sam3] expected artifact not found: ${producedLib}`);
  process.exit(1);
}

console.log(`[build-sam3] ok: ${producedLib}`);
```

- [ ] **Step 1.2: Add pnpm script**

Edit `apps/app/package.json`. Insert the new `sam3:build` entry after `stage:pb`:

```json
"scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "typecheck": "tsc -b --noEmit",
    "preview": "vite preview",
    "stage:pb": "node ../../scripts/stage-pocketbase.mjs",
    "sam3:build": "node ../../scripts/build-sam3.mjs",
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  },
```

- [ ] **Step 1.3: Run the script to verify it builds libsam3**

Run from the repo root:

```bash
pnpm --filter @netrart/app sam3:build
```

Expected: CMake configures, compiles (first run 10–15 min because FFmpeg compiles from source; subsequent runs seconds). Final line: `[build-sam3] ok: /Users/.../vendor/sam3.c/build/libsam3.dylib`.

Verify:
```bash
test -f vendor/sam3.c/build/libsam3.dylib && echo "dylib present"
```

- [ ] **Step 1.4: Commit**

```bash
git add scripts/build-sam3.mjs apps/app/package.json
git commit -m "build: add pnpm sam3:build script wrapping CMake"
```

---

## Task 2: Add the sam3 crate dependency and the Tauri command

**Files:**
- Modify: `apps/app/src-tauri/Cargo.toml`
- Modify: `apps/app/src-tauri/src/lib.rs`

- [ ] **Step 2.1: Add sam3 path dependency**

Edit `apps/app/src-tauri/Cargo.toml`. Append to `[dependencies]`:

```toml
sam3 = { path = "../../../vendor/sam3.c/bindings/rust/sam3" }
```

After this change, `[dependencies]` should read:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
sam3 = { path = "../../../vendor/sam3.c/bindings/rust/sam3" }
```

- [ ] **Step 2.2: Add the sam3_version command**

Edit `apps/app/src-tauri/src/lib.rs`. Add this command next to the existing `pb_url()` function (around line 77):

```rust
#[tauri::command]
fn sam3_version() -> String {
    sam3::version().to_string()
}
```

- [ ] **Step 2.3: Register the command in the handler**

Edit `apps/app/src-tauri/src/lib.rs`. Change line 87 from:

```rust
        .invoke_handler(tauri::generate_handler![pb_url])
```

to:

```rust
        .invoke_handler(tauri::generate_handler![pb_url, sam3_version])
```

- [ ] **Step 2.4: Verify it compiles**

Run from the repo root:

```bash
cd apps/app/src-tauri && cargo check
```

Expected: compiles cleanly. If `sam3-sys` fails with "unable to locate libsam3", double-check that Task 1 produced `vendor/sam3.c/build/libsam3.dylib`.

- [ ] **Step 2.5: Commit**

```bash
git add apps/app/src-tauri/Cargo.toml apps/app/src-tauri/Cargo.lock apps/app/src-tauri/src/lib.rs
git commit -m "feat(tauri): expose sam3_version command"
```

---

## Task 3: Extend build.rs to place libsam3.dylib next to the binary

**Files:**
- Modify: `apps/app/src-tauri/build.rs`

- [ ] **Step 3.1: Replace build.rs with dylib-copy logic**

Replace the entire contents of `apps/app/src-tauri/build.rs` with:

```rust
//! NetraRT Tauri build script.
//!
//! Runs the standard `tauri_build::build()` and then copies
//! `libsam3.dylib` from the vendored sam3.c CMake build into the
//! cargo profile output directory, so the `@loader_path` rpath baked
//! by `sam3-sys` resolves when running from `target/<profile>/`.
//!
//! Also emits an additional rpath of `@executable_path/../Frameworks`
//! so bundled `.app` builds (where the main binary sits in
//! `Contents/MacOS/` and the dylib in `Contents/Frameworks/`) can
//! resolve the library too.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    tauri_build::build();

    // Only macOS is in scope for this milestone. On other platforms,
    // skip dylib copy + extra rpath; `cargo check` should still pass
    // so CI doesn't need macOS to succeed at static analysis.
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os != "macos" {
        return;
    }

    // Extra rpath so bundled .app finds libsam3 in Contents/Frameworks.
    println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");

    stage_sam3_dylib();
}

/// Copy libsam3.dylib from vendor/sam3.c/build/ into the cargo profile
/// output dir (e.g. target/debug/) so `@loader_path` resolves at dev-time.
fn stage_sam3_dylib() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());

    // Repo root is three levels above the manifest dir
    // (apps/app/src-tauri -> apps/app -> apps -> repo_root).
    let repo_root = manifest_dir
        .ancestors()
        .nth(3)
        .expect("manifest dir should have a repo root three levels up")
        .to_path_buf();

    let src = repo_root
        .join("vendor")
        .join("sam3.c")
        .join("build")
        .join("libsam3.dylib");

    println!("cargo:rerun-if-changed={}", src.display());

    if !src.is_file() {
        println!(
            "cargo:warning=libsam3.dylib not found at {}; run `pnpm sam3:build` first",
            src.display()
        );
        return;
    }

    let profile_dir = resolve_profile_dir().expect("resolve cargo profile dir");
    let dst = profile_dir.join("libsam3.dylib");

    if should_copy(&src, &dst) {
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent).expect("create profile dir");
        }
        fs::copy(&src, &dst).unwrap_or_else(|e| {
            panic!("copy {} -> {} failed: {e}", src.display(), dst.display())
        });
        println!("cargo:warning=copied libsam3.dylib to {}", dst.display());
    }
}

/// OUT_DIR looks like `<target>/<profile>/build/<crate>-<hash>/out`.
/// Walk three parents up to reach `<target>/<profile>/`.
fn resolve_profile_dir() -> Option<PathBuf> {
    let out_dir = PathBuf::from(env::var("OUT_DIR").ok()?);
    out_dir.ancestors().nth(3).map(Path::to_path_buf)
}

fn should_copy(src: &Path, dst: &Path) -> bool {
    if !dst.exists() {
        return true;
    }
    let src_mtime = fs::metadata(src).and_then(|m| m.modified()).ok();
    let dst_mtime = fs::metadata(dst).and_then(|m| m.modified()).ok();
    match (src_mtime, dst_mtime) {
        (Some(s), Some(d)) => s > d,
        _ => true,
    }
}
```

- [ ] **Step 3.2: Rebuild to verify copy happens**

Run from the repo root:

```bash
cd apps/app/src-tauri && cargo build 2>&1 | grep "copied libsam3"
```

Expected: a `warning: copied libsam3.dylib to .../target/debug/libsam3.dylib` line. (The `cargo:warning` directive surfaces as a warning — intentional; it's the easiest way to make the copy visible during build.)

Verify:

```bash
test -f apps/app/src-tauri/target/debug/libsam3.dylib && echo "dylib staged"
```

- [ ] **Step 3.3: Commit**

```bash
git add apps/app/src-tauri/build.rs
git commit -m "build(tauri): stage libsam3.dylib into target dir + extra bundle rpath"
```

---

## Task 4: Chain pnpm sam3:build into Tauri before-commands

**Files:**
- Modify: `apps/app/src-tauri/tauri.conf.json`

- [ ] **Step 4.1: Update before-commands**

Edit `apps/app/src-tauri/tauri.conf.json`. Change the `build` block from:

```json
  "build": {
    "beforeDevCommand": "pnpm stage:pb && pnpm dev",
    "devUrl": "http://localhost:5174",
    "beforeBuildCommand": "pnpm stage:pb && pnpm build",
    "frontendDist": "../dist"
  },
```

to:

```json
  "build": {
    "beforeDevCommand": "pnpm stage:pb && pnpm sam3:build && pnpm dev",
    "devUrl": "http://localhost:5174",
    "beforeBuildCommand": "pnpm stage:pb && pnpm sam3:build && pnpm build",
    "frontendDist": "../dist"
  },
```

- [ ] **Step 4.2: Commit**

```bash
git add apps/app/src-tauri/tauri.conf.json
git commit -m "build(tauri): run sam3:build before dev and release builds"
```

---

## Task 5: Declare libsam3.dylib in the macOS bundle

**Files:**
- Modify: `apps/app/src-tauri/tauri.conf.json`

- [ ] **Step 5.1: Add bundle.macOS.frameworks**

Edit `apps/app/src-tauri/tauri.conf.json`. Inside the `bundle` object, after `resources`, add a `macOS` subsection. The `bundle` block should end up looking like:

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
      "../../../pb/pb_migrations": "pb_migrations"
    },
    "macOS": {
      "frameworks": ["../../../vendor/sam3.c/build/libsam3.dylib"]
    },
    "category": "Productivity",
    "shortDescription": "NetraRT infinite canvas",
    "longDescription": "NetraRT — infinite canvas desktop app"
  }
```

This instructs Tauri's macOS bundler to place `libsam3.dylib` in `NetraRT.app/Contents/Frameworks/`. The extra rpath added in Task 3 (`@executable_path/../Frameworks`) resolves it at runtime.

- [ ] **Step 5.2: Commit**

```bash
git add apps/app/src-tauri/tauri.conf.json
git commit -m "build(tauri): bundle libsam3.dylib into .app Frameworks dir"
```

---

## Task 6: Add the Sam3VersionBadge component

**Files:**
- Create: `apps/app/src/components/Sam3VersionBadge.tsx`

- [ ] **Step 6.1: Create the component**

Create `apps/app/src/components/Sam3VersionBadge.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export function Sam3VersionBadge() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<string>('sam3_version')
      .then((v) => {
        if (!cancelled) setVersion(v);
      })
      .catch(() => {
        if (!cancelled) setVersion(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!version) return null;

  return <span className="wordmark-tag">SAM3 {version}</span>;
}
```

Design notes:
- Reuses the existing `wordmark-tag` className from `App.css` rather than introducing new styles. The smoke test just needs the badge to render visibly; CSS polish is out of scope.
- Returns `null` on error or while loading — the wordmark keeps its current layout until the version lands.
- Cancel flag guards against unmount during the in-flight `invoke()` (React 18 StrictMode mounts effects twice in dev).

- [ ] **Step 6.2: Commit**

```bash
git add apps/app/src/components/Sam3VersionBadge.tsx
git commit -m "feat(ui): add Sam3VersionBadge component"
```

---

## Task 7: Mount the badge in the wordmark HUD

**Files:**
- Modify: `apps/app/src/Canvas.tsx`

- [ ] **Step 7.1: Import the component**

Edit `apps/app/src/Canvas.tsx`. Around line 33 (where `SettingsModal` is imported), add:

```tsx
import { Sam3VersionBadge } from './components/Sam3VersionBadge';
```

Place it alphabetically next to the other `./components/*` imports.

- [ ] **Step 7.2: Mount the badge in the wordmark**

Edit `apps/app/src/Canvas.tsx`. Find the wordmark block (around line 1483–1500). The current block ends with:

```tsx
          <span className="wordmark-divider" aria-hidden />
          <span className={`conn-dot conn-${conn}`} aria-label={`connection ${conn}`} />
          <span className="wordmark-tag">{conn}</span>
        </div>
```

Change it to:

```tsx
          <span className="wordmark-divider" aria-hidden />
          <span className={`conn-dot conn-${conn}`} aria-label={`connection ${conn}`} />
          <span className="wordmark-tag">{conn}</span>
          <span className="wordmark-divider" aria-hidden />
          <Sam3VersionBadge />
        </div>
```

When the `Sam3VersionBadge` returns `null`, the trailing divider will still render. That is acceptable visual noise for a smoke test; a follow-up can conditionally render the divider once the badge is known to be reliable.

- [ ] **Step 7.3: Run the frontend typecheck**

Run from the repo root:

```bash
pnpm --filter @netrart/app typecheck
```

Expected: no new errors.

- [ ] **Step 7.4: Commit**

```bash
git add apps/app/src/Canvas.tsx
git commit -m "feat(ui): mount Sam3VersionBadge in wordmark HUD"
```

---

## Task 8: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 8.1: Clean rebuild to simulate a fresh clone**

Run from the repo root:

```bash
cd apps/app/src-tauri && cargo clean && cd -
rm -rf vendor/sam3.c/build
```

- [ ] **Step 8.2: Start the app**

Run from the repo root:

```bash
pnpm --filter @netrart/app tauri:dev
```

Expected sequence:
1. `pnpm stage:pb` stages PocketBase binary (as before).
2. `pnpm sam3:build` runs CMake — first run takes 10–15 min.
3. `pnpm dev` starts Vite.
4. `cargo build` compiles netrart, `build.rs` prints `copied libsam3.dylib to ...`.
5. App window opens.

- [ ] **Step 8.3: Visually confirm the badge**

In the running app window:
- Look at the top-left HUD. The wordmark should read approximately:
  `NetraRT | canvas | ● <conn> | SAM3 <version>`
- If the badge does not appear, open DevTools (if enabled) and check the console for `invoke("sam3_version")` errors.

Capture a screenshot (save to `/tmp/sam3-smoke-test.png` or attach to the task result).

- [ ] **Step 8.4: Run cargo clippy**

Run from the repo root:

```bash
cd apps/app/src-tauri && cargo clippy -- -D warnings
```

Expected: no new warnings. If clippy flags existing code, ignore; this check is only for the diff.

- [ ] **Step 8.5: Run frontend typecheck one more time**

Run from the repo root:

```bash
pnpm --filter @netrart/app typecheck
```

Expected: clean.

- [ ] **Step 8.6: (Stretch) Verify release bundle**

Optional but recommended. Run from the repo root:

```bash
pnpm --filter @netrart/app tauri:build
```

After completion, open the bundled `.app` from `apps/app/src-tauri/target/release/bundle/macos/NetraRT.app` and confirm:
- The app launches.
- The SAM3 badge still renders.
- `ls apps/app/src-tauri/target/release/bundle/macos/NetraRT.app/Contents/Frameworks/` shows `libsam3.dylib`.

If the bundle verification fails or is skipped, note that in the PR description — it is a stretch goal.

- [ ] **Step 8.7: Final commit (if any cleanup)**

If Steps 8.4 or 8.5 surfaced issues that required fixes, commit them:

```bash
git add -A
git commit -m "chore: address clippy/typecheck findings from smoke-test verification"
```

Otherwise skip.

---

## Done criteria (mirrors spec)

- Fresh clone + `pnpm install && pnpm --filter @netrart/app tauri:dev` succeeds with no manual CMake step.
- App window opens, top-left HUD wordmark contains a `SAM3 <version>` tag.
- `cargo clippy` in `apps/app/src-tauri/` produces no new warnings.
- (Stretch) `pnpm tauri:build` produces a `.app` that also shows the badge.

## Out of scope (explicit reminders)

- Loading a real `.sam3` model or running any inference.
- Allocating a `sam3_ctx`.
- Touching `Canvas.tsx` logic beyond the one-line JSX insertion.
- Linux or Windows bundling.
- CPU/Metal backend selection — we take CMake defaults.
- Unit tests for `sam3_version()` — the end-to-end UI check is the test.
