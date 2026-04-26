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

## Repository variables (not secrets)

| Variable | Purpose |
|---|---|
| `NETRART_RELEASES_REPO` | Full slug of the public mirror repo, e.g. `kolosal-ai/netrart-releases`. Read by `release.yml` to compute the upload destination. |

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
