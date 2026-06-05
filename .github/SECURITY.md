# Security Policy

We take the security of Netra Limbus seriously — it is a desktop application that
handles local data and ships code-signed, auto-updating binaries.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately through either channel:

- **GitHub Security Advisories** — use the **"Report a vulnerability"** button
  under this repository's **Security** tab (preferred).
- **Email** — rifkybujanabisri@gmail.com

Please include:

- a description of the issue and its impact,
- steps to reproduce (proof-of-concept if possible),
- affected version / commit, OS, and architecture,
- any suggested remediation.

## What to expect

- We aim to acknowledge your report within **72 hours**.
- We will keep you updated on our assessment and remediation timeline.
- We will credit you in the release notes once a fix ships, unless you prefer
  to remain anonymous.

## Scope

In scope:

- the desktop app (`apps/app`) and its Tauri/Rust backend,
- the build, signing, and auto-update pipeline,
- shared packages in this repository.

Out of scope:

- vulnerabilities in third-party dependencies (please report those upstream;
  let us know if we are shipping an affected version),
- issues requiring a already-compromised machine or physical access,
- social-engineering and findings against infrastructure not in this repo.

## Supported versions

Netra Limbus is pre-1.0 and ships from `main`. Security fixes target the latest
released version and `main`.
