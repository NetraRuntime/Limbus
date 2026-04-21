# NetraRT

**Vision AI for anyone.** An infinite-canvas desktop app for running
state-of-the-art vision models locally — no cloud, no API bills, no
frames leaving your hardware.

This monorepo hosts the public website, the canvas app (Tauri desktop
+ web debug build), and shared design-system and tooling packages.

## Layout

```
apps/
  website/      # landing page, future payment/license/release server
  app/          # infinite canvas — Tauri desktop + web debug build
packages/
  design-system/ # tokens, CSS kit, self-hosted fonts, brand assets
  tsconfig/      # shared TypeScript base config
pb/             # PocketBase migrations + canonical binary
scripts/        # dev helpers (start PB, stage PB for Tauri, migrations)
docker/         # Dockerfiles + nginx.conf for the web deploy
```

## Prerequisites

- Node.js 20+ (`.nvmrc` pins `20`)
- pnpm 9 (enabled via `corepack enable`)
- Rust toolchain (desktop build only) — see [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)
- Docker (optional, for the self-hosted web stack)

## Install

```bash
pnpm install
cp .env.example .env
```

## Run the website

```bash
pnpm db:start     # PocketBase on :8090
pnpm dev:website  # Vite on :5173
```

Visit `http://localhost:5173/`.

## Run the app in the browser (debug)

```bash
pnpm db:start
pnpm dev:app      # Vite on :5174
```

Visit `http://localhost:5174/`. This is a dev-only web build of the
canvas; production is the Tauri desktop app.

## Run the desktop app

```bash
pnpm tauri:dev
```

Stages the PocketBase binary into `apps/app/src-tauri/binaries/`, then
launches the Tauri webview pinned to the canvas.

## Build

```bash
pnpm build        # both apps' web bundles → apps/*/dist/
pnpm tauri:build  # native installer for the current platform
```

## Self-hosted web stack

```bash
docker compose up -d
```

Serves the website on `:8080`. PocketBase data persists in the
`pb_data` named volume. `docker compose down -v` wipes state.

## Database

Migrations live in `pb/pb_migrations/`. Apply locally with:

```bash
pnpm db:migrate
pnpm db:superuser  # create an admin account
```

SQLite DB, uploaded files, and generated types sit under `pb/pb_data/`
(gitignored).

## License

Proprietary — all rights reserved. Contact the maintainers for usage
inquiries.
