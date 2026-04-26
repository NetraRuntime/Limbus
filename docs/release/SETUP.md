# NetraRT release setup — one-time bootstrap

This is the human bootstrap that brings the packaging pipeline from "code
landed" to "first signed release on GitHub". Do these in order. Most steps
can be done in parallel by different people; the end-state is what matters.

The pipeline expects values from three external systems:

1. **Apple Developer Program** — Developer ID Application cert + App Store Connect API key for notarization.
2. **Windows code-signing vendor** — OV (Organization Validation) certificate for Authenticode.
3. **GitHub** — a second public repo to host releases, plus secrets/variables on this private repo.

Plus one in-repo step:

4. **Tauri updater keypair** — Ed25519 key minted locally; public key in the repo, private key in CI secrets.

Each numbered section below produces 1+ values that end up as GitHub Actions
secrets. The full inventory is in [`SECRETS.md`](./SECRETS.md). Per-release
operational steps are in [`RELEASE_CHECKLIST.md`](./RELEASE_CHECKLIST.md).

---

## 0 — Prerequisites

You'll need:

- An **Apple ID** that you (or your org) intend to use for the Apple Developer Program. Use a shared/role-based ID if multiple people will manage signing — `releases@kolosal.ai` beats a personal email.
- A **macOS machine** with Xcode 14+ and `xcrun` available (for cert export, notarytool calls, and local rehearsals).
- A **Windows machine** OR a Windows-capable cloud HSM signer for Authenticode signing. The OV path described here assumes a Windows machine; if you go EV later, use a cloud HSM provider like DigiCert KeyLocker or SSL.com eSigner.
- **Admin access** to the GitHub org/account that owns this private `netrart` repo (so you can add secrets and create a sibling public repo).
- A **shared password manager** the team can access (1Password is what `SECRETS.md` references; LastPass / Bitwarden / Vault all work).
- A **physical safe** at the office, plus a printer. (Yes, really — the Tauri updater private key needs an offline backup.)

Time budget: ~3-5 calendar days end to end. Apple cert issuance is usually
same-day; OV Windows cert issuance with vetting can take 1-3 business days.

---

## 1 — Tauri updater keypair (local, ~5 min)

This is the only secret that's generated locally rather than issued by an
external authority.

```bash
cd /Users/rbisri/Documents/netrart/.claude/worktrees/packaging-system/apps/app
pnpm exec tauri signer generate -w ~/.tauri/netrart-updater.key
```

When prompted, **set a strong passphrase**. Don't leave it blank — it's
defense in depth if the GitHub Actions secret ever leaks.

The command writes two files:

- `~/.tauri/netrart-updater.key` — the **private key** (encrypted with your passphrase)
- `~/.tauri/netrart-updater.key.pub` — the **public key**

It also prints both to stdout for convenience.

### 1.1 Embed the public key in the repo

```bash
# Get the public key (single long base64 string)
cat ~/.tauri/netrart-updater.key.pub
```

Open `apps/app/src-tauri/tauri.conf.json`, find the line:

```json
"pubkey": "<PASTE-TAURI-UPDATER-PUBLIC-KEY-FROM-TASK-3.1>",
```

Replace the placeholder with your public-key string. Commit:

```bash
cd /Users/rbisri/Documents/netrart/.claude/worktrees/packaging-system
git add apps/app/src-tauri/tauri.conf.json
git commit -m "feat(updater): embed Tauri updater public key"
```

### 1.2 Back up the private key (do this BEFORE step 1.3)

The Tauri updater public key is **embedded in every shipped binary**. If you
lose the private key, every install on every user's machine becomes
permanently un-updatable — your only path forward is shipping a new app
with a new public key and asking users to manually reinstall.

Treat this like a master credential:

1. **Encrypted backup #1 — password manager.** Open a new Secure Note in your
   shared 1Password vault titled "NetraRT updater private key (Tauri Ed25519)".
   Paste the contents of `~/.tauri/netrart-updater.key`. Add the passphrase
   on a separate line, clearly labeled. Set the vault permissions so only
   the infra owner + a backup designee can read it.

2. **Encrypted backup #2 — paper, offline.** Print `~/.tauri/netrart-updater.key`.
   Use a normal printer; the key is base64 ASCII, ~140 characters. Fold the
   page, put it in a sealed envelope, write on the front:

   ```
   NetraRT updater private key — DO NOT DESTROY
   Generated: <YYYY-MM-DD>
   Recovery instructions: docs/release/SECRETS.md
   ```

   Store in a locked office safe. The passphrase goes in the password manager,
   not on the paper — splitting the two means a stolen envelope alone is
   insufficient.

### 1.3 Add to GitHub Actions secrets (do later, in step 5.4)

The two values you'll need when you reach §5.4:

- `TAURI_SIGNING_PRIVATE_KEY` = full contents of `~/.tauri/netrart-updater.key` (the entire base64 string)
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = the passphrase you set in step 1

### 1.4 Clean up the local file (after §5.4 completes successfully)

Once the secrets are in GitHub and you've confirmed `release-pr.yml` is happy
with them (§6 below), consider removing `~/.tauri/netrart-updater.key` from
your laptop. The 1Password copy + paper copy are the canonical backups; a
local file is just exposure.

```bash
# Only after §5.4 + §6 prove the GitHub secret works:
shred -u ~/.tauri/netrart-updater.key 2>/dev/null || rm -P ~/.tauri/netrart-updater.key
rm ~/.tauri/netrart-updater.key.pub
```

---

## 2 — Apple Developer Program (1 calendar day, ~$99/yr)

NetraRT ships outside the App Store, so you need the **standard Apple
Developer Program** ($99/yr individual or organization), not the Mac App
Store-specific tier. This gets you:

- A **Developer ID Application** certificate (signs `.app`, `.dmg`, embedded dylibs/binaries).
- **Notarization** access via App Store Connect API (Apple scans + signs your build).

### 2.1 Enroll in the Apple Developer Program

1. Visit <https://developer.apple.com/programs/enroll/>.
2. Sign in with the role-based Apple ID from §0 ("Prerequisites").
3. Choose **Organization** if NetraRT is shipped under a company name (recommended for branding — you'll appear as "Kolosal AI Inc." in Gatekeeper dialogs). Choose **Individual** if it's a solo project. Organizations require a D-U-N-S Number; if you don't have one, request one for free at <https://developer.apple.com/enroll/duns-lookup/> (1-2 business days). Individuals can skip this.
4. Pay the $99 fee. Apple's email confirmation usually arrives within hours; full account activation can take 24-48 hours.
5. Once activated, sign in to <https://developer.apple.com/account/> and confirm you can see "Certificates, Identifiers & Profiles" in the sidebar.

**Capture two values** while you're here:

- **`APPLE_TEAM_ID`** — visible in the top-right of the developer portal, a 10-character alphanumeric code (e.g. `AB12CD34EF`). This is the GitHub Actions secret of the same name.
- The Apple ID email you used to enroll. You may need this for password recovery; it's not a secret.

### 2.2 Create a Developer ID Application certificate

1. In the developer portal: Certificates, Identifiers & Profiles → **Certificates** → **+** (top right).
2. Choose **Developer ID Application** under "Software". Click **Continue**.
3. The portal asks for a **Certificate Signing Request (CSR)**. Generate one on your Mac:
   - Open **Keychain Access**.
   - Menu: Keychain Access → Certificate Assistant → **Request a Certificate from a Certificate Authority…**
   - User Email Address: your Apple ID email.
   - Common Name: `NetraRT Developer ID` (or similar — this is just a label).
   - CA Email Address: leave blank.
   - Choose **"Saved to disk"** + **"Let me specify key pair information"**.
   - Click **Continue**, save the `.certSigningRequest` file somewhere safe.
   - Next screen: Key Size **2048**, Algorithm **RSA**. Click **Continue**, then **Done**.
4. Back in the developer portal, upload the `.certSigningRequest` file. Click **Continue**.
5. Download the resulting `developerID_application.cer` file. **Import it into your login keychain.** On macOS 14+ double-clicking a `.cer` may silently do nothing (Apple changed the default handler), so use the command line:

   ```bash
   security import ~/Downloads/developerID_application.cer \
     -k ~/Library/Keychains/login.keychain-db
   ```

   Expected output: `1 identity imported.` (or `1 certificate imported.` if it was already present). The matching private key — which Keychain generated locally during step 3 — pairs with it automatically.

   GUI alternative: `open -a "Keychain Access"` then drag the `.cer` file onto the window. Pick **login** as the destination keychain.

6. **Verify the cert is paired with its private key:**

   ```bash
   security find-identity -v -p codesigning
   ```

   You should see a numbered entry like `1) ABCDEF1234… "Developer ID Application: Kolosal AI Inc. (AB12CD34EF)"`. If the cert shows up in Keychain Access but **not** in this list, the private key is missing — usually because the CSR was generated on a different Mac. Redo the CSR on this Mac, or transfer the private key over.

**Capture one value:**

- **`APPLE_SIGNING_IDENTITY`** — the full string from Keychain Access, e.g. `Developer ID Application: Kolosal AI Inc. (AB12CD34EF)`. Copy it exactly, including the team ID in parentheses. This is the GitHub Actions secret of the same name.

### 2.3 Export the certificate to a `.p12` file (for CI)

GitHub Actions runners can't access your local Keychain, so you export the
cert + private key as a portable `.p12` archive:

1. Keychain Access → "login" → "My Certificates" → right-click the "Developer ID Application…" entry → **Export "Developer ID Application…"**.
2. File format: **Personal Information Exchange (.p12)**.
3. Save as `developer-id.p12`.
4. **Set a strong export password.** Save it in 1Password — this is `APPLE_CERTIFICATE_PASSWORD`.

Convert to base64 for the GitHub secret:

```bash
base64 -i developer-id.p12 | pbcopy
# → the base64 string is now on your clipboard
```

**Two more values:**

- **`APPLE_CERTIFICATE`** = the base64 string from the command above.
- **`APPLE_CERTIFICATE_PASSWORD`** = the export password you just set.

Once the GitHub secret is in place (§5.4), **shred the local `developer-id.p12`** — Keychain still has the cert, and the `.p12` was a one-time portable copy:

```bash
shred -u developer-id.p12 2>/dev/null || rm -P developer-id.p12
```

### 2.4 Generate an App Store Connect API key (for notarization)

The notarization step in `release.yml` uses `xcrun notarytool` with an API
key. This is preferred over app-specific passwords — keys are revocable per
machine, don't require human MFA, and don't expire when the Apple ID's
password changes.

1. Visit <https://appstoreconnect.apple.com/access/api>. Sign in with the same Apple ID.
2. Navigate to **Users and Access** → **Integrations** → **App Store Connect API** → **Team Keys**.
3. Click **Generate API Key** (top right). If this is the first key on the account, click **Request Access** first and accept the API agreement.
4. Name: `NetraRT CI Notarization`.
5. Access: **Developer** is enough. Don't grant Admin.
6. Click **Generate**. The page now shows the new key with a **Download API Key** button. **You can only download the key file once.** Click it; you get an `AuthKey_<KEYID>.p8` file.
7. Capture three values from the page itself (not from the file):
   - **Key ID** — alphanumeric, ~10 characters. → `APPLE_API_KEY_ID`.
   - **Issuer ID** — UUID-like format. → `APPLE_API_ISSUER`.

**Encode the key file to base64** for the GitHub secret:

```bash
base64 -i AuthKey_<KEYID>.p8 | pbcopy
```

- **`APPLE_API_KEY`** = the base64 string above.

After the secret lands in GitHub, shred the local `.p8`:

```bash
shred -u AuthKey_<KEYID>.p8 2>/dev/null || rm -P AuthKey_<KEYID>.p8
```

You **cannot** re-download the same key later. If you lose the file before
backing it up, you have to generate a new key and rotate the secret.

### 2.5 Apple checklist

Before moving on, you should have these seven values noted (in 1Password,
not in this file):

- `APPLE_TEAM_ID` (10 chars, public-ish — appears in Gatekeeper dialogs)
- `APPLE_SIGNING_IDENTITY` (full string from Keychain)
- `APPLE_CERTIFICATE` (base64 of `.p12`)
- `APPLE_CERTIFICATE_PASSWORD` (export password from §2.3)
- `APPLE_API_KEY` (base64 of `.p8`)
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

---

## 3 — Windows code signing (1-3 business days, ~$200-600/yr)

For NetraRT's first release we use an **OV (Organization Validation) cert**.
Pros: no hardware token, CI-friendly. Cons: SmartScreen reputation has to
build up over downloads — the first hundreds of installs will see "Windows
protected your PC", and users have to click "More info" → "Run anyway".

If you want to suppress SmartScreen immediately, you need an **EV cert**
which requires a hardware token or cloud HSM (DigiCert KeyLocker, SSL.com
eSigner, Azure Trusted Signing). EV is a separate setup; this section
covers OV only.

### 3.1 Pick a certificate vendor

Common options for OV:

- **SSL.com** — ~$200/yr first year, ships as a `.pfx` you can use anywhere. Usually the cheapest legitimate path.
- **Sectigo (was Comodo)** — similar price band. Resold by many smaller vendors (e.g. SSLs.com, KSoftware).
- **DigiCert** — ~$500-700/yr. More expensive, more name recognition, faster support.

All three are CA/B-Forum-compliant and produce identical Authenticode
signatures. Pick on price + support preference, not on certificate quality.

### 3.2 Order the certificate

Most vendors require an **organization, not an individual** for OV. You'll
provide:

- Legal entity name (must match incorporation documents exactly).
- Registered business address.
- Business phone number on a public registry (DUNS, state corp registry).
- A contact person in the organization.

The vendor will run a vetting process — usually 1-3 business days. Expect:

- A phone call to the registered business number to verify the contact exists.
- An email confirmation with a CSR upload step.
- Once vetted, the vendor issues the certificate.

### 3.3 Generate a CSR + retrieve the certificate

The exact flow varies by vendor. Two common shapes:

**Shape A — vendor generates the keypair** (SSL.com's default). The vendor
hands you a `.pfx` directly with the private key inside, plus a password.
Skip to §3.4.

**Shape B — you generate the CSR** (DigiCert's default). On a Windows machine:

1. Open **Microsoft Management Console** (`mmc.exe`) as Administrator.
2. File → Add/Remove Snap-in → Certificates → Computer Account → Local Computer → OK.
3. Right-click "Personal" → All Tasks → **Advanced Operations** → **Create Custom Request**.
4. Template: "Legacy key" or "(No template) CNG key". RSA, 3072 or 4096 bit.
5. Save the resulting `.req` file. Upload it to the vendor portal.
6. Vendor issues a `.cer` — download it.
7. Back in MMC: right-click "Personal" → All Tasks → **Import** → select the `.cer`.
8. Find the cert under Personal → Certificates, right-click → All Tasks → **Export**.
9. Choose **Yes, export the private key** + **Personal Information Exchange (.pfx)** + Include all certificates in the path + Include extended properties.
10. Set a strong password.
11. Save as `windows-codesign.pfx`.

### 3.4 Encode the `.pfx` to base64

From a machine with `base64` (any Unix or WSL):

```bash
base64 -i windows-codesign.pfx | pbcopy   # macOS
base64 -i windows-codesign.pfx -w 0       # Linux/WSL — single line
```

**Two values:**

- **`WINDOWS_CERTIFICATE`** = the base64 string.
- **`WINDOWS_CERTIFICATE_PASSWORD`** = the password from §3.3.

After the GitHub secret is in place (§5.4), shred the local `.pfx`:

```bash
shred -u windows-codesign.pfx 2>/dev/null || rm -P windows-codesign.pfx
```

### 3.5 Note: NSIS uses signtool

`scripts/release/sign-windows.mjs` shells out to `signtool.exe`, which is
part of the Windows SDK. The GitHub Actions `windows-2022` runner image has
it preinstalled — no special setup. The script signs `libsam3.dll` directly;
Tauri's NSIS bundler signs `NetraRT.exe` and the installer using the same
secrets via env vars.

### 3.6 Windows checklist

Two values noted:

- `WINDOWS_CERTIFICATE` (base64 of `.pfx`)
- `WINDOWS_CERTIFICATE_PASSWORD`

---

## 4 — Public release-mirror repo (15 min)

GitHub Releases on a private repo require auth to download. To let
unauthenticated users download installers without making the source public,
we publish to a **separate public repo** that contains only release tags.
Source never leaves this private repo.

### 4.1 Create the repo

1. Go to <https://github.com/organizations/<ORG>/repositories/new> (replace `<ORG>` with your GitHub org slug, e.g. `kolosal-ai`). For a personal account, use <https://github.com/new>.
2. Name: `netrart-releases`.
3. Description: `Public installer downloads for NetraRT.`
4. Visibility: **Public**.
5. Initialize with **nothing** (no README, no .gitignore, no license — we'll push our own).
6. Click **Create repository**.

### 4.2 Disable extras you don't need

Settings → General → Features. Untick:

- **Wikis**
- **Issues**
- **Sponsorships** (if shown)
- **Projects**
- **Discussions**

Settings → General → Pull Requests. Untick:

- **Allow merge commits** / **Allow squash merging** / **Allow rebase merging** (the repo never receives PRs).

This repo exists only to host releases. No issues, no PRs, no discussion.

### 4.3 Push README + LICENSE

```bash
mkdir /tmp/netrart-releases-init
cd /tmp/netrart-releases-init
git init -b main
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

(Adjust the copyright holder to match your legal entity.)

Push:

```bash
git add README.md LICENSE
git commit -m "chore: initial scaffold"
git remote add origin git@github.com:<ORG>/netrart-releases.git
git push -u origin main
```

### 4.4 Create a fine-grained PAT for the publish workflow

The CI workflow on the **private** `netrart` repo needs to push releases to
the **public** `netrart-releases` repo. We use a fine-grained PAT scoped to
exactly that one repo, with exactly one permission.

1. <https://github.com/settings/personal-access-tokens/new>
2. Token name: `NetraRT release publisher`.
3. Resource owner: `<ORG>` (the org owning `netrart-releases`).
4. Expiration: **90 days** maximum (per `SECRETS.md` rotation policy).
5. Repository access: **Only select repositories** → pick `<ORG>/netrart-releases`. **Do not** grant access to anything else, including the private `netrart` repo (the workflow runs in `netrart`'s context with built-in `GITHUB_TOKEN` for that repo's own actions; the PAT is purely for cross-repo upload).
6. Repository permissions: scroll to **Contents** → **Read and write**. Leave all other permissions at "No access".
7. Click **Generate token**. Copy the value immediately — GitHub only shows it once.

**One value:**

- **`RELEASE_MIRROR_PAT`** = the PAT string starting with `github_pat_…`.

Add a calendar reminder for 7 days before the PAT expires (~83 days from now)
to rotate it. Per `SECRETS.md` §"Procedure: rotating a secret", you can stage
a new PAT alongside the old one for a zero-downtime swap.

### 4.5 Replace `<ORG>` placeholders in this repo

The implementation phase left literal `<ORG>` placeholders in places that
need the real org slug. From the worktree:

```bash
cd /Users/rbisri/Documents/netrart/.claude/worktrees/packaging-system

# Find the placeholders
grep -rn '<ORG>' \
  apps/app/src-tauri/tauri.conf.json \
  scripts/release/sync-latest-json.mjs \
  docs/release/

# Replace (substitute kolosal-ai with your real org)
ORG=kolosal-ai
grep -rl '<ORG>' \
  apps/app/src-tauri/tauri.conf.json \
  scripts/release/sync-latest-json.mjs \
  docs/release/ \
  | xargs sed -i '' "s|<ORG>|${ORG}|g"   # macOS sed
# Linux: drop the empty quotes after -i

# Verify (should produce no output)
grep -rn '<ORG>' \
  apps/app/src-tauri/tauri.conf.json \
  scripts/release/sync-latest-json.mjs \
  docs/release/

git add apps/app/src-tauri/tauri.conf.json scripts/release/sync-latest-json.mjs docs/release/
git commit -m "chore(release): replace <ORG> placeholder with ${ORG}"
```

### 4.6 Mirror-repo checklist

- Public repo `<ORG>/netrart-releases` exists with README + LICENSE.
- Issues, PRs, Wiki disabled.
- Fine-grained PAT generated with `Contents: read+write` scoped to that repo only.
- `<ORG>` placeholders replaced in this private repo's config.
- One value noted: `RELEASE_MIRROR_PAT`.

---

## 5 — Configure GitHub Actions secrets (15 min)

You should now have 13 secret values + 1 repo-variable value in your password
manager. Plug them into the **private `netrart` repo** (not the public mirror):

1. Go to <https://github.com/<ORG>/netrart/settings/secrets/actions>.
2. Click **New repository secret** for each of the following.
3. Name them exactly as shown — `release.yml` references them by literal name.

### 5.1 Apple secrets (7)

From §2:

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_TEAM_ID`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

### 5.2 Windows secrets (2)

From §3:

- `WINDOWS_CERTIFICATE`
- `WINDOWS_CERTIFICATE_PASSWORD`

### 5.3 Tauri updater secrets (2)

From §1:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

### 5.4 Release mirror secret (1)

From §4.4:

- `RELEASE_MIRROR_PAT`

### 5.5 Repository variable (not a secret)

Same settings page → **Variables** tab → **New repository variable**:

- Name: `NETRART_RELEASES_REPO`
- Value: `<ORG>/netrart-releases` (e.g. `kolosal-ai/netrart-releases`)

Variables are visible to read in workflow runs (which is fine for a repo
slug); secrets are masked. Don't put `RELEASE_MIRROR_PAT` here by accident.

### 5.6 Verify all 13 secrets show up

The settings page lists secret names but never values. Cross-check the names
against `SECRETS.md`. If anything is missing, the preflight job in
`release-pr.yml` will fail with `missing secret: <NAME>`.

---

## 6 — First rehearsal: open `release/0.2.0` PR (~30 min)

This is the moment of truth — the rehearsal workflow runs every signing,
notarization, and bundling step against your real credentials, but doesn't
publish. If it goes green, the next tag will produce a real release.

```bash
cd /Users/rbisri/Documents/netrart/.claude/worktrees/packaging-system
git checkout main
git pull   # or `git fetch && git rebase` against the remote main

# Bump version to 0.2.0 across all manifests
node scripts/release/bump-version.mjs 0.2.0

# Refresh Cargo.lock
cd apps/app/src-tauri && cargo check && cd -

# Open release branch + PR
git checkout -b release/0.2.0
git add -A
git commit -m "chore(release): 0.2.0"
git push -u origin release/0.2.0
gh pr create --title "release: 0.2.0" --body "Release rehearsal for 0.2.0."
```

The workflow `release-pr.yml` will trigger automatically because the PR branch starts with `release/`. Watch:

```bash
gh pr checks --watch
```

Expected: 4 matrix jobs (`macos-14`, `macos-13`, `windows-2022`, `ubuntu-22.04`) plus the preflight job, all green, total runtime ~15-25 minutes (cold) or ~5-10 minutes (warm with cached sam3.c build).

### 6.1 If a job fails

Common failures and fixes:

**Apple notarization rejected.** Click into the failing job → look at the
`notarytool log` output. Common causes:

- A nested binary that wasn't deep-signed → `scripts/release/sign-mac.mjs` should already cover this; if a new binary type appears in the bundle, add it to the `walk` callback's match list.
- Hardened runtime entitlement issues → check `apps/app/src-tauri/entitlements.plist` against the rejected entitlement Apple lists.
- Stuck cert chain → re-export the `.p12` from Keychain ensuring "Include all certificates in the path" is checked.

**`patchelf: command not found`** on Linux job. Should be installed by the
`Linux deps` step. If a new runner image dropped it, pin to `ubuntu-22.04`
explicitly (already done) or add an explicit `apt-get install patchelf`.

**`signtool: certificate hashes do not match`** on Windows job. The cert in
`WINDOWS_CERTIFICATE` doesn't match the password. Re-export the `.pfx` and
re-encode to base64.

**`libsam3.dll not found`** on Windows job. The path
`vendor/sam3.c/build/Release/sam3.dll` doesn't match what `cmake --build`
emitted on Windows. Adjust `apps/app/src-tauri/tauri.windows.conf.json` and
`scripts/release/sign-windows.mjs` to match the actual output path
(`build/sam3.dll` is a common alternative).

**Tauri update bundle `.sig` missing** in artifacts. The matrix's `bundles`
field for that target is missing `,updater`. Check `release.yml` line ~88+.

Iterate: push commits to the `release/0.2.0` branch, the workflow re-runs
automatically, watch with `gh pr checks --watch`. Each round costs ~5-15
minutes of runner time.

### 6.2 When all 4 jobs are green

```bash
gh pr merge --squash
```

The merge commit lands on `main` with the version bump.

---

## 7 — First real release: tag `v0.2.0` (~30 min)

```bash
git checkout main
git pull
git tag v0.2.0
git push origin v0.2.0
```

The tag push triggers `release.yml`. Watch:

```bash
gh run watch
```

Expected steps: preflight (~30s) → 4 build jobs in parallel (~10-20 min each)
→ publish job (~1-2 min).

### 7.1 Verify the GitHub Release on the mirror repo

```bash
gh release view v0.2.0 --repo <ORG>/netrart-releases
```

Should list these assets (`<v>` = `0.2.0`):

- `NetraRT_<v>_aarch64.dmg` + `.sig`
- `NetraRT_<v>_x64.dmg` + `.sig`
- `NetraRT_<v>_x64-setup.exe` + `.sig`
- `NetraRT_<v>_amd64.deb` + `.sig`
- `NetraRT_<v>_amd64.AppImage` + `.sig`
- The three updater bundles (`.app.tar.gz`, `.nsis.zip`, `.AppImage.tar.gz`) + `.sig`
- `latest.json` + `latest.json.sig`

### 7.2 Smoke install

Download `NetraRT_0.2.0_aarch64.dmg` (or whichever DMG matches your machine)
from the Release page. Mount, drag the `.app` to `/Applications`, launch it.
Should open without Gatekeeper prompts. Quit.

If you see "NetraRT can't be opened because Apple cannot check it for
malicious software": the binary is signed but **not notarized**. Check the
job logs; the notarytool step likely failed silently because of a missing
secret. Fix and re-tag a patch (`v0.2.1`).

### 7.3 Manual updater roundtrip (Layer 3 — once)

This proves the auto-updater actually works end-to-end. Do it once with
`v0.2.0` → `v0.2.1` to validate the pipeline; subsequent releases don't
need it unless you've changed the updater code path.

1. Keep `v0.2.0` installed on your machine.
2. Wait until §7.1 succeeds, then make a trivial change (e.g. version-bump
   patch) and tag `v0.2.1`. Wait for the publish job to finish.
3. Within 5 minutes of `v0.2.1` going live, the running `v0.2.0` install
   should show the **"Update 0.2.1 available"** pill in the Home screen
   footer.
4. Click it. The pill changes to "Downloading update… N%".
5. When done, it changes to "Restart to update to 0.2.1". Click that.
6. App relaunches. Open the dev console (or check the version surface) to
   confirm it now reports `0.2.1`.

If the pill never appears: check the running app's logs (look for
`[updater]` lines), confirm the public key in `tauri.conf.json` matches
what was used to sign the manifest, and confirm `latest.json.sig` is
attached to the Release.

### 7.4 Repeat the smoke on Windows + Linux (optional, once)

Same flow on Windows and Linux. On Windows you'll see SmartScreen — click
"More info" → "Run anyway" — that's the OV-cert reputation cost from §3.

---

## 8 — Going forward

Per release after the first one:

1. `pnpm release:prepare <version>` → push branch → open PR → wait for green rehearsal.
2. Merge.
3. Tag `v<version>` → push → wait for `release.yml`.
4. Verify the GitHub Release exists on the mirror repo with all assets.

The detailed per-release checklist is in [`RELEASE_CHECKLIST.md`](./RELEASE_CHECKLIST.md).

### Calendar reminders to set now

- **Apple cert renewal**: ~12 months from §2.2. Apple emails 30 days before expiry; you regenerate per §2.2-§2.3 and rotate `APPLE_CERTIFICATE` + `APPLE_CERTIFICATE_PASSWORD` per the procedure in `SECRETS.md`.
- **Windows cert renewal**: 1-3 years from §3.3, depending on what you bought. Vendor emails near expiry.
- **`RELEASE_MIRROR_PAT` rotation**: every 90 days. GitHub UI shows the expiry date on the token.
- **Apple Developer Program annual fee**: ~12 months from §2.1. Apple bills automatically if you have card-on-file; if it lapses, your cert continues to work but you can't renew when it expires.

### Where the secrets live (recap)

| Where | What's in it | Who can read |
|---|---|---|
| Local Mac Keychain | Developer ID Application cert + private key | Whoever's logged into that Mac |
| 1Password "Infra / NetraRT release" vault | All 13 secrets + Tauri private key + passphrases | Infra team |
| Office safe (sealed envelope) | Tauri private key (paper) | Whoever has the safe combo |
| GitHub Actions secrets on `netrart` repo | All 13 secrets, masked | GitHub repo admins (write); workflow runs (read) |
| `apps/app/src-tauri/tauri.conf.json` (committed) | Tauri public key + mirror-repo URL | Anyone with repo access (it's in source) |
| Local `~/.tauri/netrart-updater.key` | Tauri private key (encrypted with passphrase) | Delete after §5.4 confirmed working |

If 1Password access is lost, the paper safe is the backup of last resort —
but the cert files in 1Password (Apple `.p12`, Windows `.pfx`) are not
backed up offline, only the Tauri updater key is. If that's a concern,
print those too. The trade-off is the more places a secret exists, the
more attack surface it has.

---

## Appendix — Common mistakes

- **Generating the Tauri keypair on a CI runner.** Runners are ephemeral; the
  key would vanish along with the runner. Always generate locally.
- **Pasting the Tauri private key into `tauri.conf.json` instead of the public
  one.** The config field is `pubkey`. If you accidentally commit the private
  key, treat it as compromised: generate a new keypair, embed the new public
  key, and accept that all existing installs (if any shipped) become
  un-updatable. Do not roll back the leak.
- **Using an EV cert with a hardware token in CI.** The token has to be
  physically connected during signing. Standard GitHub Actions runners can't
  reach a USB device on your laptop. EV signing in CI requires a cloud HSM
  signer (DigiCert KeyLocker, etc.), not a plain `.pfx`.
- **Forgetting to disable Issues on the mirror repo.** People will file issues
  there expecting support. Disabling makes the experience explicit: the repo
  is a download endpoint, not a support channel.
- **Putting the mirror repo PAT into a "classic" PAT instead of fine-grained.**
  Classic PATs grant access to all of your repos. If the secret leaks, the
  blast radius is everything you can read. Fine-grained PATs scope to one
  repo + one permission.
- **Exporting the Apple cert without the private key.** Keychain's "Export
  certificate" omits the key by default — you have to export from "My
  Certificates" (which is the cert+key bundle), not from "Certificates"
  alone. Verify the resulting `.p12` is ~3-4 KB, not ~1 KB.
