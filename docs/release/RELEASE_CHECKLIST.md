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
- [ ] GitHub Release on `rifkybujana/netrart-releases` exists with all expected
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
- [ ] Edit the bad release on `rifkybujana/netrart-releases`: prefix title with
      `[Withdrawn] ` and add a notes line linking to the patch.
- [ ] `gh release edit v<next-patch> --latest --repo rifkybujana/netrart-releases`
      (this should already happen automatically, but verify).
