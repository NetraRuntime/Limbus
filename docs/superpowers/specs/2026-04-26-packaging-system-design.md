# Packaging system for NetraRT — design

**Status:** Design approved. Implementation plan to follow.
**Date:** 2026-04-26
**Scope:** First-release packaging + distribution pipeline. Direct-download
installers for macOS, Windows, and Linux, with a signed in-app auto-updater.
App-store channels are explicitly deferred.

---

## 1. Goals and non-goals

### Goals

- Anyone with a download link can install NetraRT on macOS, Windows, or Linux
  without seeing a "damaged" / "untrusted" / Gatekeeper / SmartScreen-blocking
  dialog (SmartScreen reputation friction excepted — see §11).
- Pushing a SemVer tag is the only manual step required to ship a release.
- Installed copies update themselves with a non-blocking prompt, verified by a
  cryptographic signature so a compromised CDN cannot push malicious updates.
- The release pipeline is reproducible: the same tag against the same code
  produces the same artifacts, regardless of who runs it.
- The `netrart` source repo can stay private while installers remain
  unauthenticated-downloadable.

### Non-goals (deferred to future specs)

- App-store distribution (Mac App Store, Microsoft Store, flatpak, snap,
  Homebrew Cask, winget).
- Beta or nightly release channels.
- Delta / patch updates (full-bundle replacement only).
- Crash reporting / telemetry.
- Public APT repo / `apt install netrart`.
- ARM64 Windows, ARM64 Linux.
- macOS universal binary (we ship two separate DMGs).
- Automated cross-platform updater roundtrip tests.

---

## 2. Decisions log

The seven choices that shape this system, recorded so the rationale survives:

| # | Decision | Rationale |
|---|---|---|
| 1 | First release ships **direct downloads only**, stores deferred | Mac App Store sandbox forbids `externalBin` (PocketBase) + restricts dylib loading paths (sam3). Stores require non-trivial re-architecture; deferring buys runway. |
| 2 | Build on **GitHub Actions**, host on **GitHub Releases** | Free for the volume we'll see, zero infra ops, integrates with the existing private repo. R2/CDN can replace this later by changing one URL. |
| 3 | **Public release-mirror repo** (`netrart-releases`) hosts assets | The source repo is proprietary/private. GitHub Releases on a private repo require auth to download. A separate public repo containing only release tags + binaries solves this without making source public. |
| 4 | **Single stable channel**, SemVer, manual tag-triggered | Smallest viable shipping mechanism. Adding `beta`/`nightly` later is mechanical: split `latest.json` into per-channel files. |
| 5 | macOS Developer ID + notarization, Windows OV cert, both available today | OV not EV — accepts SmartScreen reputation cost as a known issue. EV would require a cloud HSM signer (KeyLocker / eSigner / Azure Trusted Signing) — ~2x setup, deferred. |
| 6 | Updater: **silent check + non-blocking prompt** | Industry-standard desktop UX (VS Code, Linear, Obsidian). Forced updates are heavy-handed; manual-only leaves users behind. |
| 7 | Linux: **AppImage + `.deb`** | Covers Ubuntu/Debian + universal Linux at minimum CI cost. `.rpm` and apt repo deferred. |

---

## 3. Architecture

Two repos. Source flows in one direction: private → public.

```
netrart (private, this repo)                     netrart-releases (public, NEW)
─────────────────────────────                     ───────────────────────────────
.github/workflows/release.yml ──tag v*  triggers──▶ Releases:
.github/workflows/release-pr.yml                     v0.2.0
                                                       ├─ NetraRT_0.2.0_aarch64.dmg
  build matrix (4 jobs)                                ├─ NetraRT_0.2.0_x64.dmg
  ├─ macos-14   (arm64)                                ├─ NetraRT_0.2.0_x64-setup.exe
  ├─ macos-13   (x86_64)                               ├─ NetraRT_0.2.0_amd64.deb
  ├─ windows-2022 (x64)                                ├─ NetraRT_0.2.0_amd64.AppImage
  └─ ubuntu-22.04 (x64)                                ├─ <each>.sig    (Tauri Ed25519)
                                                       ├─ latest.json
  publish job ──gh release create via PAT──────────▶   └─ latest.json.sig
```

### 3.1 Trigger model

- **Production trigger**: pushing a tag matching `v[0-9]+.[0-9]+.[0-9]+` to the
  private repo. Triggers `release.yml`.
- **Rehearsal trigger**: opening a PR from a `release/*` branch. Triggers
  `release-pr.yml`, which runs the entire build matrix without publishing. A
  green PR proves signing/notarization will work before the tag is pushed.
- **Manual re-run**: `workflow_dispatch` against an existing tag. Idempotent —
  re-running overwrites Release assets via `gh release upload --clobber`.
- **No release on regular pushes** to `main`.

### 3.2 Source of truth for version

`apps/app/src-tauri/tauri.conf.json` `version` field. A preflight CI job fails
the workflow if the pushed tag string doesn't match this version. The `bump
version` script keeps `Cargo.toml`, root `package.json`, and
`apps/app/package.json` in sync at PR time.

### 3.3 Updater endpoint

```
https://github.com/<org>/netrart-releases/releases/latest/download/latest.json
```

Configured in `tauri.conf.json` under `plugins.updater.endpoints`. The URL is
permanently stable: `latest.json` itself contains per-platform installer URLs
that point at the same release's tagged assets.

---

## 4. Build pipeline (per matrix job)

### 4.1 Common steps

```
1. checkout (with submodules: vendor/sam3.c)
2. setup node 20 + pnpm 9 (corepack)
3. setup rust stable + add target triple
4. verify CMake >= 3.24 (preinstalled on hosted runners)
5. cache:
   - ~/.cargo/registry, ~/.cargo/git, target/
   - vendor/sam3.c/build/                        (incremental CMake)
   - vendor/sam3.c/build/_deps/mlx-c-src/        (mlx-c clone)
   - pnpm store
   keys: OS + sam3 submodule SHA + rust version
6. pnpm install --frozen-lockfile
7. node scripts/release/fetch-pocketbase.mjs     (CI replacement for stage:pb)
8. node scripts/build-sam3.mjs                   (existing — produces libsam3.{dylib,so,dll})
9. pnpm --filter @netrart/app build              (vite bundle)
10. pnpm tauri build --target ${TRIPLE} ${BUNDLES}
11. sign + (mac) notarize + staple               (§5)
12. upload-artifact: dist/ (installers + .sig + updater bundles)
```

### 4.2 Per-target

| Runner | Triple | Bundles | Notes |
|---|---|---|---|
| `macos-14` | `aarch64-apple-darwin` | `dmg`, `app` | Native arm64. Apple Silicon. |
| `macos-13` | `x86_64-apple-darwin` | `dmg`, `app` | Intel. Two separate DMGs (no universal binary). |
| `windows-2022` | `x86_64-pc-windows-msvc` | `nsis` | NSIS over MSI: smaller, supports per-user install, fits updater model. |
| `ubuntu-22.04` | `x86_64-unknown-linux-gnu` | `deb`, `appimage` | 22.04 = glibc 2.35 — old enough that `.deb` runs on supported Debian/Ubuntu. |

### 4.3 The three structural risks (must fix before first release)

#### Risk 1 — `libsam3` linkage on Linux

Today `tauri.conf.json` only declares `bundle.macOS.frameworks`. Linux has no
equivalent and the `.so` will not ship in the AppImage / `.deb` automatically.

**Fix:**

- Add `bundle.linux.deb.files` mapping `vendor/sam3.c/build/libsam3.so` →
  `/usr/lib/netrart/libsam3.so`.
- Add `scripts/release/patch-rpath.mjs` that runs
  `patchelf --set-rpath '$ORIGIN/../lib/netrart' <bin>` on the staged Linux
  binary before bundling so the loader finds the bundled `.so` next to (or
  one dir above) the executable.
- AppImage: `linuxdeploy` captures the dependency cleanly once RPATH is
  patched.
- macOS: existing `frameworks` wiring stays. Add a CI verification step that
  runs `otool -L` on the binary inside the built `.app` and asserts
  `libsam3.dylib` resolves via `@rpath/...`, not an absolute build-time path.
- Windows: `libsam3.dll` ships next to `NetraRT.exe`, declared under
  `bundle.resources` with a flat target. CI smoke-checks via
  `dumpbin /dependents`.

#### Risk 2 — `sam3.c` build cost on CI

First `cmake -DSAM3_METAL=ON` configure pulls `mlx-c` over `FetchContent`
(~hundreds of MB). Without caching, every release adds ~5–10 min.

**Fix:** three-layer cache (registry/git/target, CMake build dir, mlx-c source
dir). Cold release: ~15 min total. Warm release: ~5 min. Acceptable.

#### Risk 3 — PocketBase sidecar per triple

Today only `pocketbase-aarch64-apple-darwin` exists. CI must fetch the right
PB asset for each runner.

**Fix:**

- `pb/pocketbase.version` — pinned PB tag (e.g., `v0.26.6`). One source of truth.
- `pb/pocketbase.sha256` — committed SHA256 per supported triple.
- `scripts/release/fetch-pocketbase.mjs` — reads both, downloads the matching
  asset from `github.com/pocketbase/pocketbase/releases/download/...`,
  verifies SHA256 against the pinned hash (so a compromised PB release can't
  silently inject a binary), unzips, stages to
  `apps/app/src-tauri/binaries/pocketbase-${triple}${ext}`.
- Bumping PocketBase = updating both files in the same PR.

### 4.4 Output naming and staging layout

All assets follow Tauri's default scheme. CI stages them into a uniform
directory tree so the publish job knows where to look:

```
artifacts/
  macos-aarch64/  NetraRT_0.2.0_aarch64.dmg            + .sig
                  NetraRT.app.tar.gz                    + .sig    ← updater bundle
  macos-x86_64/   NetraRT_0.2.0_x64.dmg                + .sig
                  NetraRT.app.tar.gz                    + .sig
  windows-x64/    NetraRT_0.2.0_x64-setup.exe          + .sig
                  NetraRT_0.2.0_x64-setup.nsis.zip      + .sig    ← updater bundle
  linux-x64/      NetraRT_0.2.0_amd64.deb              + .sig
                  NetraRT_0.2.0_amd64.AppImage          + .sig
                  NetraRT_0.2.0_amd64.AppImage.tar.gz   + .sig    ← updater bundle
```

`.sig` files are Tauri Ed25519 update signatures, **not** OS-level code
signatures (those are baked into the installers themselves).

---

## 5. Signing, notarization, secrets

Three independent signing systems are in play. Mixing them up is the most
common cause of "the build works, but users see a warning."

| System | Signs | Why | Cred |
|---|---|---|---|
| **Apple code signing + notarization** | `.app`, `.dmg`, embedded `libsam3.dylib`, embedded `pocketbase` sidecar | Gatekeeper requires it on macOS 10.15+ | Developer ID Application cert + App Store Connect API key |
| **Windows Authenticode** | `NetraRT.exe`, NSIS installer, `libsam3.dll` | SmartScreen + UAC trust + suppress "unknown publisher" | OV code-signing cert |
| **Tauri updater (Ed25519)** | `.app.tar.gz`, `.nsis.zip`, `.AppImage.tar.gz`, `latest.json` | A compromised CDN cannot inject malicious updates | Tauri-generated keypair |

Linux has no OS-level signature in this distribution model (we don't run an
apt repo). Tauri updater signing still applies to AppImage updater bundles.

### 5.1 macOS — code signing + notarization + stapling

Required GitHub Actions secrets (App Store Connect API key path — preferred
over app-specific passwords because keys are revocable and don't require human
MFA):

```
APPLE_CERTIFICATE              # base64-encoded .p12 of Developer ID Application cert
APPLE_CERTIFICATE_PASSWORD     # password for the .p12
APPLE_SIGNING_IDENTITY         # "Developer ID Application: Kolosal AI Inc. (TEAMID)"
APPLE_API_ISSUER
APPLE_API_KEY
APPLE_API_KEY_ID
APPLE_TEAM_ID
```

Per-job mac flow:

```
build .app
  → codesign --deep --options runtime everything inside .app
  → codesign nested binaries individually:
       Frameworks/libsam3.dylib                              (hardened runtime)
       Resources/_up_/binaries/pocketbase-${triple}          (no JIT — PB is Go)
  → produce .dmg
  → notarytool submit --wait                                  (~2–10 min)
  → xcrun stapler staple
  → also notarize + staple the .app.tar.gz updater bundle
```

`scripts/release/sign-mac.mjs` runs after `tauri build` but before
`notarytool` to walk the `.app` bundle and re-sign anything Tauri's default
signing missed (the `externalBin` + `framework` dylib combination needs this).
Verified with `codesign --verify --deep --strict --verbose=2`.

**Notarization is a hard gate.** If Apple rejects, the job fails. Apple's
response is logged for triage. No "skip notarization" escape hatch.

### 5.2 Windows — Authenticode

Secrets:

```
WINDOWS_CERTIFICATE            # base64-encoded .pfx
WINDOWS_CERTIFICATE_PASSWORD
```

Sign in this order (so the installer's signature covers signed inner files):

1. `libsam3.dll` (via `scripts/release/sign-windows.mjs` running before `tauri build`).
2. `NetraRT.exe` (signed by Tauri's NSIS bundler).
3. `NetraRT_0.2.0_x64-setup.exe` (the installer itself, signed by Tauri).

Timestamp server: `http://timestamp.digicert.com` (RFC 3161). Without
timestamping, signatures die when the cert expires; with it, signed binaries
remain trusted post-expiry.

**Known acceptable cost:** OV cert SmartScreen reputation accumulates with
downloads. The first hundreds–thousands of installs will see "Windows
protected your PC" — users click "More info" → "Run anyway." We document this
on the release page. Suppression requires an EV cert (deferred).

### 5.3 Tauri updater signing

Generated **once**, locally, with `pnpm tauri signer generate`:

- **Public key** — committed to `tauri.conf.json` under
  `plugins.updater.pubkey`. Embedded in every shipped binary.
- **Private key** — stored as `TAURI_SIGNING_PRIVATE_KEY` (base64 GitHub
  Actions secret).
- **Optional passphrase** — yes. Stored as `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

The public key **cannot be rotated without a forced full reinstall** of every
shipped client. We treat the private key as a master credential:

- Encrypted backup in shared 1Password vault.
- Printed paper copy in a sealed envelope in the office safe.
- Documented in `docs/release/SECRETS.md`.

### 5.4 Secrets inventory + rotation

All stored as GitHub Actions repository secrets on the private repo, scoped to
the release workflows.

| Secret | Owner | Rotation |
|---|---|---|
| `APPLE_CERTIFICATE` + password | Apple Developer admin | ~yearly (cert expiry); rotate 30d before |
| `APPLE_API_KEY` + `_ID` + `_ISSUER` | Apple Developer admin | Annually or on team-member departure |
| `APPLE_TEAM_ID`, `APPLE_SIGNING_IDENTITY` | static | n/a |
| `WINDOWS_CERTIFICATE` + password | code-signing cert vendor | Per cert expiry (1–3 years) |
| `TAURI_SIGNING_PRIVATE_KEY` + password | infra owner | **Never** rotate without coordinated full reinstall |
| `RELEASE_MIRROR_PAT` | org admin | 90 days; fine-grained PAT scoped to `contents:write` on `netrart-releases` only |

`docs/release/SECRETS.md` lists each secret, its owner, and rotation
procedure. **Values never written to docs.**

---

## 6. Release flow

### 6.1 Developer flow (the human steps)

```
1. on main:    pnpm release:prepare 0.2.0
   → bumps tauri.conf.json + Cargo.toml + apps/app/package.json + root package.json
   → regenerates Cargo.lock
   → updates pb/pocketbase.version + pb/pocketbase.sha256 if specified
   → opens branch release/0.2.0, commits "chore(release): 0.2.0"
   → pushes branch + opens PR
2. PR runs release-pr.yml: full build matrix, no publish.
   → green PR = release rehearsal passed
3. merge PR.
4. git tag v0.2.0 && git push origin v0.2.0
5. release.yml fires.
6. ~15-25 min later, GitHub Release exists on netrart-releases with all assets.
7. existing users' apps detect update on next launch (or within 24h).
```

Two safety properties drop out:

- **PR build is identical to tag build** — same workflow, just no publish step.
  Signing/notarization breakages surface at PR time, not after the tag is
  pushed and discoverable.
- **Tag and `tauri.conf.json` version match by construction.** Bump script
  writes the version, tag is the same string, CI asserts equality.

### 6.2 System flow (`release.yml`)

```
release.yml
  on: push tags v*.*.*

jobs:
  preflight:                            # ~30s
    - assert tag matches tauri.conf.json version
    - assert all required secrets present (fail fast if rotation expired)
    - assert pb/pocketbase.sha256 covers all matrix triples
    - resolve git submodule SHAs (used for cache keys)

  build:                                # ~5-15 min per job, parallel
    needs: preflight
    strategy.matrix: 4 targets (§4.2)
    steps: full per-job pipeline (§4.1) → artifacts uploaded

  publish:                              # ~1-2 min
    needs: build
    runs-on: ubuntu-latest
    steps:
      - download all artifacts
      - assemble latest.json (§7)
      - sign latest.json with TAURI_SIGNING_PRIVATE_KEY
      - gh release create v0.2.0 --repo <org>/netrart-releases \
          --notes-file CHANGELOG.md \
          ./artifacts/**/*.{dmg,exe,deb,AppImage,tar.gz,sig} latest.json latest.json.sig
      - gh release edit v0.2.0 --latest --repo <org>/netrart-releases
```

If any matrix job fails, `publish` doesn't run. **No partial releases.**
Re-runs are idempotent: `gh release create` falls back to
`gh release upload --clobber` when the release already exists.

---

## 7. `latest.json` schema

```json
{
  "version": "0.2.0",
  "notes": "See https://github.com/<org>/netrart-releases/releases/tag/v0.2.0",
  "pub_date": "2026-04-26T14:30:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "<base64 ed25519 sig of the .app.tar.gz>",
      "url": "https://github.com/<org>/netrart-releases/releases/download/v0.2.0/NetraRT_0.2.0_aarch64.app.tar.gz"
    },
    "darwin-x86_64": { "signature": "...", "url": "..." },
    "windows-x86_64": {
      "signature": "<sig of the .nsis.zip>",
      "url": ".../NetraRT_0.2.0_x64-setup.nsis.zip"
    },
    "linux-x86_64": {
      "signature": "<sig of the .AppImage.tar.gz>",
      "url": ".../NetraRT_0.2.0_amd64.AppImage.tar.gz"
    }
  }
}
```

Non-obvious points:

- **`url` points at the updater bundle**, not the installer. The updater plugin
  applies a delta-style replacement, not a fresh install.
- **`.deb` users do not auto-update through Tauri.** They get updates by
  re-downloading the next `.deb`. Documented limitation. AppImage users get
  in-app auto-updates. We show a one-time, dismissible "your `.deb` install
  won't auto-update; switch to AppImage?" notice on first launch (feature-flagged).
- **`notes` does not inline release notes.** The in-app prompt links out to the
  Release page. Keeps `latest.json` small and lets us edit notes after the
  release without re-signing the manifest.

`scripts/release/sync-latest-json.mjs`:

- Reads each `*.sig` produced during the matrix build.
- Builds the JSON.
- Signs **the file itself** with the Tauri private key. Tauri 2 verifies the
  manifest signature in addition to per-asset signatures — defense in depth
  against a CDN that returns a manipulated `latest.json`.
- File's own signature is published as `latest.json.sig` adjacent to it.

---

## 8. In-app updater UX

Implemented as a self-contained feature folder per the project's React
conventions: `apps/app/src/features/updater/` exposing `useUpdater()` and
`<UpdaterPill />` through its `index.ts`.

- **On launch**: check `latest.json`. If `version > current`, set state.
- **Re-check**: every 24h while app is open.
- **UX**: small "Update available — restart to install" pill in the Home
  screen footer. Clicking it: download (with progress), then prompt
  "Restart now / later". "Later" defers to next launch; pill stays. No modal
  that interrupts work.
- **Failure**: download or signature verification fails → log it, hide the
  pill, retry next 24h cycle. Never silently install something that fails
  verification.
- **Offline**: 5s timeout, silent on failure. No "we couldn't check for
  updates" noise.

### 8.1 `.deb` install detection

The Tauri updater plugin cannot apply updates to a system-installed `.deb`.
On Linux, the updater feature inspects the running install at startup
(presence of `/usr/lib/netrart/` or running from a system path like `/usr/bin`)
and:

- **Suppresses the update pill entirely.** No "Update available" UI for `.deb`
  users — the updater can't deliver, so the pill would only frustrate.
- **Shows a one-time, dismissible notice** on first launch: *"Auto-updates
  aren't available for the `.deb` package. Install the AppImage to get
  in-app updates, or check `<release page URL>` periodically."* Dismissal is
  persisted in app state (PocketBase or local config) — never shown twice.

Notice is gated by a compile-time constant (`UPDATER_DEB_NOTICE_ENABLED`) so
it can be disabled per-release without a code change if it proves noisy.

---

## 9. Rollback

Rollback = publish a new release with the older code. We do **not** delete or
unpublish a bad release — that breaks already-running clients that may be
mid-download.

Procedure for a bad `v0.2.0`:

```
1. git checkout main
2. git revert <bad commits>           # or fix-forward
3. pnpm release:prepare 0.2.1
4. tag v0.2.1 → ship
```

`v0.2.0` stays in the Release list with a `[Withdrawn]` prefix and notes
pointing to `0.2.1`. The mirror's "latest" pointer (set via
`gh release edit --latest`) moves to `0.2.1`, so the updater immediately
serves users the fixed version.

**Roll-forward only.** A bad version number is permanently burned; the next
release has a higher number, never the same. **No automatic rollback** —
auto-reinstalling old code over good code is hard and rarely correct.

---

## 10. Error handling, observability, testing

### 10.1 Install/launch-time failures

| Failure | Detection | Behavior |
|---|---|---|
| macOS Gatekeeper rejects ("damaged" / "can't be opened") | `spctl --assess --type install` on the `.dmg` post-build | CI fail before publish |
| Windows SmartScreen warning | Expected for new OV cert | Document on release page; no CI handling |
| Linux: `libsam3.so` not found at runtime | CI smoke test runs the AppImage headless and asserts clean exit | CI fail |
| PocketBase sidecar missing/wrong arch | App launch tries to spawn it and errors | CI smoke test catches |
| Updater: signature verification fail | Tauri plugin returns error | Log, hide pill, retry. Never install |
| Updater: `latest.json` 404 | Tauri returns network error | Silent. Retry next cycle |
| Updater: download interrupted | Tauri returns partial-download error | Discard, retry next launch |
| Updater: post-install app fails to launch | Cannot detect from broken app | Mitigated by install rehearsal in CI (§10.3) |

Principle: anything verifiable in CI gets verified before `publish`. Anything
not verifiable in CI gets surfaced to the user with a clear next action —
never silently.

### 10.2 Observability

Minimal, off-by-default-able. We don't have user telemetry today and won't
bolt it on through the packaging system.

- **Release-side metrics** — per-asset download counts via `gh api
  /repos/<org>/netrart-releases/releases/<id>/assets`, polled into
  `scripts/release/download-stats.mjs`. No user-side code.
- **Updater-side logs (local only)** — the existing app log gains
  `target: "updater"` lines for success/failure. User-readable, not phoned
  home.
- **Build-side: workflow run history** is the audit trail. `gh run view <id>`
  gives full provenance.

Explicitly out of scope: crash reporting, telemetry pings, "anonymous usage
stats." Each is its own consent + privacy conversation.

### 10.3 Testing the packaging system itself

Three layers.

**Layer 1 — schema/static checks (preflight, every CI run).**

- `tauri.conf.json` validates against Tauri's published schema (already does
  via `$schema`).
- Cross-version consistency: tag → `tauri.conf.json` → `Cargo.toml` →
  `package.json` all match.
- Required secrets present (existence, not values).
- `pb/pocketbase.sha256` covers every triple in the matrix.

**Layer 2 — install rehearsal (per-job, after build, before publish).**

- macOS: `hdiutil attach` the `.dmg`, run `codesign --verify --deep --strict`
  and `spctl --assess --type install`. Mount, copy `.app` to a temp dir,
  launch with `--self-check` flag, detach.
- Windows: extract NSIS installer's contents (without running interactively),
  `signtool verify` every signed binary, run `NetraRT.exe --self-check`.
- Linux: chmod +x the `.AppImage`, run `--self-check` headless. For `.deb`:
  `dpkg -x` (no install), exec the binary, self-check.

The `--self-check` flag is implemented once in
`apps/app/src-tauri/src/lib.rs`: boots the Tauri app, runs `pocketbase
--version` against the staged sidecar, calls one cheap `sam3` function (e.g.,
`sam3_version()`), exits with status reflecting all three. Catches "ships,
but the dylib doesn't load" / "wrong PB arch" / "missing resource" before
users do.

**Layer 3 — updater roundtrip (manual, once per major release).**

Documented checklist in `docs/release/RELEASE_CHECKLIST.md`:

1. Install version `N-1` from the public mirror.
2. Tag `N`, let CI publish.
3. Confirm pill appears on the `N-1` install within 5 min.
4. Apply update. Confirm relaunch. Confirm version reports as `N`.

Automating Layer 3 was considered. ~3 hours human time per release vs. ~30
hours of CI engineering with high flake risk. Defer until release cadence
exceeds ~2 / month.

---

## 11. Accepted risks

- **OV cert SmartScreen friction.** Real, documented. No fix without an EV cert.
- **`.deb` users don't auto-update.** Documented; switch-to-AppImage notice in app.
- **Tauri updater key is irrotatable.** Backup procedure (1Password + paper) is the mitigation.
- **CI cold builds ~15 min**, warm ~5 min. Acceptable; not a hot path.
- **No automated platform-roundtrip update test.** Manual checklist mitigates.

---

## 12. Files added/modified

### New (private repo)

- `.github/workflows/release.yml`
- `.github/workflows/release-pr.yml`
- `pb/pocketbase.version`
- `pb/pocketbase.sha256`
- `scripts/release/fetch-pocketbase.mjs`
- `scripts/release/bump-version.mjs`
- `scripts/release/sync-latest-json.mjs`
- `scripts/release/sign-mac.mjs`
- `scripts/release/sign-windows.mjs`
- `scripts/release/patch-rpath.mjs`
- `scripts/release/download-stats.mjs`
- `apps/app/src/features/updater/` (feature folder: hook, component, index)
- `docs/release/SECRETS.md`
- `docs/release/RELEASE_CHECKLIST.md`

### Modified (private repo)

- `apps/app/src-tauri/tauri.conf.json` — adds `plugins.updater` block,
  `bundle.linux.deb.files`, Windows resource for `libsam3.dll`, Cargo
  dependency on `tauri-plugin-updater`.
- `apps/app/src-tauri/Cargo.toml` — adds `tauri-plugin-updater`.
- `apps/app/src-tauri/src/lib.rs` — registers updater plugin, adds
  `--self-check` CLI flag.
- `apps/app/package.json` — adds `@tauri-apps/plugin-updater`.
- `package.json` (root) — adds `release:prepare` script.

### New (public repo `netrart-releases`)

- `README.md` — install instructions, link back to product site.
- `LICENSE` — copy of proprietary terms (binaries are still proprietary).

---

## 13. Parameters to resolve at implementation time

- **`<org>`** — the GitHub org/user that will own `netrart-releases`. Appears
  throughout this spec as a placeholder. Decided when the public repo is
  created (likely `kolosal-ai`, but not committed).
- **Apple Team ID + signing identity string** — values come from the Apple
  Developer account.
- **PocketBase pin** — current version (`v0.26.6`) is the starting pin; bumps
  are routine.

## 14. Open questions for the implementation plan

None blocking. Remaining detail (exact NSIS template tweaks, exact macOS
entitlements file contents, precise `--self-check` IPC shape) is
implementation-level and will be resolved in the plan.

The next step is `superpowers:writing-plans` to turn this design into a
sequenced implementation plan with checkpoints.
