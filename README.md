# NetraRT

**Vision AI for anyone.** An infinite-canvas desktop app for running state-of-the-art vision models locally — no cloud, no API bills, no frames leaving your hardware.

NetraRT ships as a cross-platform Tauri desktop app with a web landing page. The canvas is a spatial workspace where you drop in images and media, then run local vision models against them. The same frontend bundle serves both targets: the Tauri webview pins to the canvas, while the web deploy keeps the landing page.

---

## Stack

- **Frontend** — React 18 + TypeScript, built with Vite
- **Desktop shell** — Tauri 2 (Rust)
- **Backend** — PocketBase (SQLite + file storage), bundled as a sidecar binary in the desktop build and self-hostable via Docker for the web deploy
- **Design system** — Local `design-system/` tokens, Space Mono + Caveat self-hosted, Inter via Google Fonts, Remix Icon bundled by Vite for offline use

## Repo layout

```
src/             React app — landing page, infinite canvas, router
src-tauri/       Rust crate, Tauri config, bundled PocketBase sidecar
pb/              PocketBase migrations and canonical binary
design-system/   Shared design tokens and primitives
scripts/         Dev helpers (stage PocketBase, run migrations, manage superusers)
public/          Static assets (fonts, favicons)
Dockerfile*      Web + PocketBase images
docker-compose.yml
nginx.conf       Routes `/api` and `/_/` to PocketBase for the web deploy
```

## Getting started

### Prerequisites

- Node.js 20+
- Rust toolchain (for the desktop build) — see [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)
- Docker (optional, for the self-hosted web stack)

### Install

```bash
npm install
cp .env.example .env
```

Leave `VITE_PB_URL` empty to use same-origin calls. The Vite dev server proxies `/api` and `/_/` to the local PocketBase, and the Docker deploy does the same through nginx.

### Run the web frontend

```bash
npm run db:start   # boots PocketBase on :8090
npm run dev        # boots Vite on :5173
```

Visit `http://localhost:5173`. `/` is the landing page; `/app` is the canvas.

### Run the desktop app

```bash
npm run tauri:dev
```

This stages the PocketBase binary into `src-tauri/binaries/` for your target triple, then launches the Tauri webview pinned to the canvas route.

### Build

```bash
npm run build         # web bundle → dist/
npm run tauri:build   # native installers per platform
```

### Self-hosted web stack

```bash
docker compose up -d
```

Serves the web bundle on `:8080` and keeps PocketBase data in the `pb_data` named volume. Use `docker compose down -v` to wipe state.

## Database

PocketBase migrations live in `pb/pb_migrations/`. Apply them locally with:

```bash
npm run db:migrate
npm run db:superuser   # create an admin account
```

The SQLite database, uploaded files, and generated types all sit under `pb/pb_data/` and are gitignored.

## Routes

- `/` — landing page (web only)
- `/app` — infinite canvas (web + desktop)

The Tauri build detects its webview at runtime and pins to `/app` so the same bundle works across both targets.

## License

Proprietary — all rights reserved. Contact the maintainers for usage inquiries.
