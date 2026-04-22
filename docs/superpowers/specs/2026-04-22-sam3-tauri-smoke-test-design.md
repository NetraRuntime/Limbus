# SAM3 Tauri Smoke Test — Design

**Date:** 2026-04-22
**Scope:** Prove the `vendor/sam3.c/` → Rust binding → Tauri app → frontend toolchain works end-to-end, with zero feature value.
**Non-goals:** Model loading, inference, canvas integration, Linux/Windows bundling.

## Goal

Bundle the SAM3 Rust binding into the Tauri desktop app (`apps/app/`) such that a fresh clone, followed by `pnpm install` and `pnpm --filter app tauri dev`, produces a running app that renders the SAM3 library version string in the UI. The value of this milestone is de-risking the build, link, and bundle toolchain before any real vision feature is wired up.

## Success criteria

1. Fresh clone + `pnpm install && pnpm --filter app tauri dev` succeeds with no manual CMake step.
2. The app window opens and a small "SAM3 v{x}" badge renders inside the top-left wordmark HUD (alongside the existing `canvas` and `conn` tags).
3. `cargo clippy` in `apps/app/src-tauri/` produces no new warnings.
4. (Stretch, optional for this milestone) `pnpm tauri build` produces a `.app` bundle on macOS that opens and shows the badge.

## Architecture

Four surfaces touched:

- **`apps/app/src-tauri/Cargo.toml`** — add `sam3` as a path dependency pointing at `../../../vendor/sam3.c/bindings/rust/sam3`. The vendored binding's workspace handles the `sam3-sys` transitive dependency.
- **`apps/app/src-tauri/src/lib.rs`** — add one `#[tauri::command] fn sam3_version() -> String` that calls the safe wrapper. Register it in `invoke_handler`.
- **`apps/app/src-tauri/build.rs`** — extend beyond the current `tauri_build::build()` to copy `libsam3.dylib` from the CMake build directory into `target/<profile>/` so the `@loader_path` rpath baked by `sam3-sys` resolves at runtime.
- **`apps/app/package.json` + `apps/app/src-tauri/tauri.conf.json`** — add a `pnpm sam3:build` script that invokes CMake, and chain it into `beforeDevCommand` and `beforeBuildCommand`.
- **`apps/app/src/components/Sam3VersionBadge.tsx`** (new) — a ~30-line React component that calls `invoke<string>("sam3_version")` on mount and renders the result as a `wordmark-tag` span. Mounted in the existing top-left wordmark HUD (after the `conn` tag).

No changes to `Canvas.tsx`, routing, or other feature code.

## Build flow

```
pnpm tauri dev
  └─ beforeDevCommand: pnpm stage:pb && pnpm sam3:build && pnpm dev
                                            │
                                            ▼
       cmake -S vendor/sam3.c -B vendor/sam3.c/build \
             -DSAM3_SHARED=ON -DCMAKE_BUILD_TYPE=Release
       cmake --build vendor/sam3.c/build -j
       → produces vendor/sam3.c/build/libsam3.dylib
  └─ cargo build (triggered by tauri run)
       ├─ sam3-sys/build.rs auto-detects vendor/sam3.c/build/ via its walk-up logic
       ├─ netrart compiles, links -lsam3 dynamically, rpath=@loader_path
       └─ netrart/build.rs copies libsam3.dylib → target/<profile>/libsam3.dylib
```

- First build: ~10–15 min (FFmpeg compiles from source via SAM3's CMake).
- Subsequent builds: CMake incremental, sub-second if nothing changed.
- `beforeDevCommand` runs on every `tauri dev` start; CMake's own incremental logic makes this cheap after the first build.

## Runtime library placement

`sam3-sys`'s `build.rs` bakes `@loader_path` (macOS) / `$ORIGIN` (Linux) rpath into the netrart binary. The OS resolves `libsam3.dylib` relative to the binary's own directory at load time.

- **Dev (`tauri dev`)** — `apps/app/src-tauri/build.rs` copies the dylib into `target/debug/` (or `target/release/`). The copy logic walks up from `OUT_DIR` (`target/<profile>/build/<crate>-<hash>/out`) three levels to find `target/<profile>/`, then copies `vendor/sam3.c/build/libsam3.dylib` there if the source is newer than the destination.
- **Bundle (`tauri build`, macOS)** — declare the dylib in `tauri.conf.json` under `bundle.macOS.frameworks` so Tauri places it in the `.app`'s `Contents/Frameworks/` directory. Since the main binary lives in `Contents/MacOS/`, the `@loader_path` rpath alone is not sufficient for the bundle. We add a second rpath `@executable_path/../Frameworks` via a `cargo:rustc-link-arg` directive in `apps/app/src-tauri/build.rs`.
- **Linux / Windows bundling** — explicitly out of scope for this milestone.

## Tauri command surface

```rust
// apps/app/src-tauri/src/lib.rs (additions shown)
#[tauri::command]
fn sam3_version() -> String {
    sam3::version().to_string()
}

// in the builder:
.invoke_handler(tauri::generate_handler![sam3_version])
```

One synchronous command. No state, no context, no async. The `sam3::version()` call is a thin wrapper around the C `sam3_version()` function, which returns a static string; it cannot fail in practice.

## Frontend surface

```tsx
// apps/app/src/components/Sam3VersionBadge.tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function Sam3VersionBadge() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    invoke<string>("sam3_version")
      .then((v) => { if (!cancelled) setVersion(v); })
      .catch(() => { if (!cancelled) setVersion(null); });
    return () => { cancelled = true; };
  }, []);
  if (!version) return null;
  return <span className="wordmark-tag">SAM3 {version}</span>;
}
```

Mounted once inside the top-left wordmark HUD, reusing the existing `wordmark-tag` className so no new styles are needed. The wordmark already hosts the `canvas` label and `conn` connection indicator, making it the natural place for a third "dev info" tag. If the invoke fails (e.g. dylib failed to load), the component renders nothing — a failed smoke test should not wedge the UI.

## Error handling

- **CMake failure** → `pnpm tauri dev` exits loudly with CMake's stderr. Desired.
- **Missing `libsam3.dylib` at runtime** → Tauri process fails to start; app window never opens. Desired for a smoke test — silent failure defeats the point.
- **Frontend invoke failure** → badge silently renders nothing. The rest of the app is unaffected.
- **No retry / no fallback** at any layer. This is a smoke test; partial success is worse than hard failure.

## What this design explicitly does not do

- Load a `.sam3` model file.
- Allocate a `sam3_ctx`.
- Do any image, text, or video processing.
- Touch `Canvas.tsx` or any feature code.
- Ship a Linux or Windows build.
- Fall back to CPU-only if Metal is unavailable (we take CMake's defaults).
- Cache CMake artifacts across clean checkouts.
- Add unit tests for `sam3_version()` — the end-to-end UI rendering is the test.

## Open risks

1. **`beforeDevCommand` runs on every `tauri dev`** — even a no-op CMake pass has overhead (~1 s). If this becomes annoying, a follow-up can add a timestamp check to skip CMake when `vendor/sam3.c/` hasn't changed.
2. **`apps/app/src-tauri/build.rs` copying dylib is a cross-cutting concern** — the copy logic assumes a specific cargo target layout. If Cargo ever changes its `OUT_DIR` convention (unlikely) the copy breaks. Acceptable risk; fix forward if it happens.
3. **macOS code-signing / Gatekeeper** — not addressed. Stretch goal of `pnpm tauri build` may surface Gatekeeper issues with the dylib. Deferred to a separate spec if/when it bites.
4. **Vendor submodule drift** — `vendor/sam3.c` is pinned to `main`. If upstream renames the shared-lib CMake option or changes the binding crate layout, our build breaks. Mitigated by the submodule pin; addressed by updating this spec when we bump the pin.

## Out of scope for follow-up milestones (explicit pointers)

- **Milestone B (minimal real inference):** model loading, image I/O, single-prompt segmentation, standalone "try SAM3" pane.
- **Milestone C (canvas-integrated MVP):** click-on-image prompt UX, mask rendering as canvas layer, canvas data model for mask overlays.
- Cross-platform bundling (Linux, Windows).
