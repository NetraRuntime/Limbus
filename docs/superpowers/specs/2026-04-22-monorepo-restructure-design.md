# Monorepo restructure — design spec

**Date:** 2026-04-22
**Status:** Approved for planning
**Scope:** Restructure only (no new features). See §11 for non-goals.

## 1. Goal and context

Today NetraRT lives in a single repo that mixes the web landing page, the
infinite-canvas Tauri app, and PocketBase infra under one `package.json` and one
`src/` tree. The same bundle serves both targets — a route check pins the Tauri
webview to `/app`, while `/` renders the landing.

The product is about to grow into three clearly separate concerns:

- A **public website** with the landing page and, over time, payment, license
  accounts, and a release/auto-update server.
- A **canvas app** that ships as a Tauri desktop build (primary) and can also
  run on the web for debugging. It will eventually authenticate against the
  website's online DB to validate a license, but its user-facing data (images,
  videos, canvas state) keeps living in the embedded PocketBase so users never
  feel their work is going to the cloud.
- Shared **design tokens** already in `design-system/` plus the CSS kit in
  `src/styles/`, used by both surfaces.

This spec restructures the repo to make those concerns independent — their own
packages, their own dev/build, their own deploy story — without building any of
the future subsystems yet. That work follows in separate specs.

## 2. Non-goals (scope guardrails)

This pass explicitly does NOT:

- Implement payment, license auth, the release server, or app↔website auth.
- Add CI, tests, or Turborepo (none exist today; adding them is out of scope).
- Change any user-visible behavior: landing looks identical, canvas behaves
  identically, Tauri builds install the same way.
- Touch PocketBase migrations or collections.

Directories reserved for future subsystems get a `README.md` noting "not
implemented yet" — no stub code.

## 3. Tooling decisions

- **Package manager:** pnpm 9.x, pinned via `packageManager` in root
  `package.json`. `package-lock.json` is deleted; `pnpm-lock.yaml` replaces it.
- **Workspaces:** pnpm workspaces (no Turborepo yet — revisit if the package
  graph grows past 5+ packages).
- **Node:** pin to 20 via `.nvmrc` and `"engines": { "node": ">=20" }`.
- **TypeScript:** shared `tsconfig` base published as a workspace package; each
  app extends it.

## 4. Target layout

```
netrart/
├── apps/
│   ├── website/                  # landing + future payment/license/release
│   │   ├── src/
│   │   │   ├── landing/          # Header, Hero, Footer, Why, Waitlist
│   │   │   ├── hooks/            # useRevealOnScroll (scroll-triggered reveals)
│   │   │   ├── lib/pb.ts         # online-PB client (waitlist today; auth later)
│   │   │   ├── payment/README.md # stub
│   │   │   ├── license/README.md # stub
│   │   │   ├── releases/README.md# stub
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── public/               # favicons, OG images
│   │   ├── index.html
│   │   ├── vite.config.ts        # dev proxy /api + /_/ → local PB
│   │   ├── tsconfig.json         # extends @netrart/tsconfig/base.json
│   │   └── package.json          # "@netrart/website"
│   │
│   └── app/                      # canvas — Tauri desktop + web debug build
│       ├── src/
│       │   ├── Canvas.tsx
│       │   ├── InfiniteCanvas.tsx
│       │   ├── App.tsx
│       │   ├── App.css
│       │   ├── main.tsx
│       │   ├── components/       # ContextMenu, FloatingSidebar, SettingsModal…
│       │   ├── hooks/            # useSettings (canvas settings modal)
│       │   ├── lib/pb.ts         # embedded-PB client (images, videos)
│       │   └── auth/README.md    # stub — client for website's license API
│       ├── src-tauri/            # Rust crate, icons, capabilities, gen/
│       ├── public/               # canvas-only static assets
│       ├── index.html
│       ├── vite.config.ts        # dev proxy /api + /_/ → local PB
│       ├── tsconfig.json
│       └── package.json          # "@netrart/app"
│
├── packages/
│   ├── design-system/            # tokens, CSS kit, fonts
│   │   ├── fonts/                # self-hosted Space Mono + Caveat
│   │   ├── tokens.css
│   │   ├── kit.css
│   │   ├── global.css
│   │   ├── reveal.css
│   │   ├── responsive.css
│   │   ├── colors_and_type.canonical.css
│   │   ├── README.md
│   │   ├── SKILL.md
│   │   └── package.json          # "@netrart/design-system"
│   │
│   └── tsconfig/
│       ├── base.json             # strict, ES2022, ESNext, react-jsx
│       └── package.json          # "@netrart/tsconfig"
│
├── pb/                           # root-level infra (not a workspace package)
│   ├── pb_migrations/
│   ├── pb_data/                  # gitignored
│   └── pocketbase                # canonical binary (gitignored already)
│
├── scripts/                      # dev-pocketbase.mjs, stage-pocketbase.mjs
├── docker/
│   ├── website.Dockerfile
│   ├── pb.Dockerfile
│   └── nginx.conf
├── docker-compose.yml
├── pnpm-workspace.yaml
├── package.json                  # root: scripts only, no app deps
├── pnpm-lock.yaml
├── .nvmrc
├── .gitignore
├── .env.example
└── README.md                     # monorepo overview
```

## 5. Workspace configuration

**`pnpm-workspace.yaml`:**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

**Root `package.json`:**

```json
{
  "name": "netrart",
  "private": true,
  "version": "0.1.0",
  "packageManager": "pnpm@9.15.0",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev:website": "pnpm --filter @netrart/website dev",
    "dev:app":     "pnpm --filter @netrart/app dev",
    "tauri:dev":   "pnpm --filter @netrart/app tauri:dev",
    "tauri:build": "pnpm --filter @netrart/app tauri:build",
    "build":       "pnpm -r build",
    "stage:pb":    "node scripts/stage-pocketbase.mjs",
    "db:start":    "node scripts/dev-pocketbase.mjs",
    "db:migrate":  "node scripts/dev-pocketbase.mjs migrate up",
    "db:superuser":"node scripts/dev-pocketbase.mjs superuser create"
  }
}
```

No dependencies listed at the root — each app declares its own.

## 6. File-level migration map

| From | To |
|---|---|
| `src/landing/` (all files) | `apps/website/src/landing/` |
| `src/App.tsx` (landing side) | `apps/website/src/App.tsx` (landing-only render) |
| `src/main.tsx` | duplicated: `apps/website/src/main.tsx` and `apps/app/src/main.tsx` |
| `src/router.tsx` | deleted (replaced by per-app routing; see §9) |
| `src/Canvas.tsx`, `InfiniteCanvas.tsx`, `InfiniteCanvas.css`, `App.css` | `apps/app/src/` |
| `src/components/` | `apps/app/src/components/` (all are canvas-only) |
| `src/hooks/useSettings.ts` | `apps/app/src/hooks/useSettings.ts` (canvas-only) |
| `src/hooks/useRevealOnScroll.ts` | `apps/website/src/hooks/useRevealOnScroll.ts` (landing-only) |
| `src/lib/pb.ts` | split — canvas surface → `apps/app/src/lib/pb.ts`; waitlist surface → `apps/website/src/lib/pb.ts` |
| `src/styles/{tokens,kit,global,reveal,responsive}.css` | `packages/design-system/` |
| `design-system/*` | `packages/design-system/` (merge with above) |
| `public/fonts/` | `packages/design-system/fonts/` |
| `public/` (non-font assets) | split per-app by which surface uses them |
| `index.html` | duplicated: `apps/website/index.html` and `apps/app/index.html` (title, script entry differ) |
| `vite.config.ts` | duplicated per-app with matching proxy config |
| `src-tauri/` | `apps/app/src-tauri/` |
| `Dockerfile` | `docker/website.Dockerfile` (scoped to website build) |
| `Dockerfile.pb` | `docker/pb.Dockerfile` |
| `nginx.conf` | `docker/nginx.conf` |
| `tsconfig.json` | `packages/tsconfig/base.json` (shared base) + per-app `tsconfig.json` that extends it |

Use `git mv` wherever a file moves without content change to preserve history.

## 7. Splitting `src/lib/pb.ts`

The current file does two unrelated things:

1. **Canvas data**: images and videos, talks to embedded PB (Tauri sidecar)
   or loopback in the web debug build. Includes `uploadWithProgress`,
   `UploadAbortError`, `createImage`, `createVideo`, list/update/delete helpers,
   file URL construction.
2. **Waitlist**: a single POST to a `waitlist` collection from the landing.
   Used by `src/landing/Waitlist.tsx`.

After the split:

- `apps/app/src/lib/pb.ts` owns (1). The Tauri detection branch stays (it needs
  to point at `http://127.0.0.1:8090` when running in the webview).
- `apps/website/src/lib/pb.ts` owns (2). No Tauri branch. `PB_URL` comes from
  `VITE_PB_URL` or defaults to same-origin.

There is no shared base package — the two clients would share ~10 lines
(`new PocketBase(url)` + `autoCancellation(false)`), which is not worth a
package boundary.

## 8. Tauri path updates

Tauri config lives at `apps/app/src-tauri/tauri.conf.json`. Three paths change:

- `frontendDist`: stays `"../dist"` (still a sibling of `src-tauri/`).
- `resources`: `"../pb/pb_migrations"` → `"../../../pb/pb_migrations"` —
  three levels up (`src-tauri/` → `apps/app/` → `apps/` → repo root) then
  into `pb/pb_migrations/`.
- `beforeDevCommand` / `beforeBuildCommand`: the Tauri CLI runs these with the
  crate's parent (i.e. `apps/app/`) as CWD. Update to
  `"pnpm --dir ../.. stage:pb && pnpm dev"` (or equivalent) so stage-pb runs
  from the repo root and the app's own `dev` script runs locally.

`scripts/stage-pocketbase.mjs` references `src-tauri/binaries/`. Update the
destination path to `apps/app/src-tauri/binaries/`. Similarly audit
`scripts/dev-pocketbase.mjs` for any path assumptions.

The app package's `package.json` exposes its own `tauri:dev` / `tauri:build`
scripts that invoke `tauri` from within `apps/app/`.

## 9. Routing after the split

- **Website** currently only needs `/`. Delete `router.tsx` from the website
  side; `App.tsx` renders `<Landing />` directly. Leaves a clean slate for
  future `/pricing`, `/login`, `/dashboard`.
- **App** no longer has `/app` as a route concept:
  - In the Tauri webview the bundle is served from `tauri://localhost/` — no
    path routing is needed.
  - In the web debug build, the app's dev server serves the canvas from `/`.
    The previous `/app` URL is gone.
  - The `isTauri()` helper is retained in `apps/app/src/lib/pb.ts` for PB URL
    resolution (sidecar loopback in Tauri, same-origin otherwise), but is no
    longer used to choose a route.

## 10. `@netrart/design-system` packaging

Consumption is CSS-only — no JS entry needed. The package exports each CSS
file and a `fonts/` directory:

```json
{
  "name": "@netrart/design-system",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./tokens.css": "./tokens.css",
    "./kit.css": "./kit.css",
    "./global.css": "./global.css",
    "./reveal.css": "./reveal.css",
    "./responsive.css": "./responsive.css",
    "./colors_and_type.canonical.css": "./colors_and_type.canonical.css",
    "./fonts/*": "./fonts/*"
  }
}
```

Apps import with:

```ts
import '@netrart/design-system/tokens.css';
import '@netrart/design-system/kit.css';
```

Vite resolves `@font-face` URLs in those stylesheets through the package's
`fonts/*` export and fingerprints them into the app's build output. No build
step on the design-system package itself.

The existing `design-system/SKILL.md` and `design-system/README.md` migrate
into the package directory unchanged.

## 11. `@netrart/tsconfig` base

`packages/tsconfig/base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

Per-app `tsconfig.json` extends this and declares `include`, `outDir`, and any
app-specific overrides.

## 12. Docker and deployment

- `docker-compose.yml` has two services:
  - `web`: builds from `docker/website.Dockerfile`, serves the website bundle
    via nginx on `:8080`.
  - `pb`: builds from `docker/pb.Dockerfile`, runs PocketBase on `:8090`.
- `docker/website.Dockerfile` runs `pnpm install --frozen-lockfile` at repo
  root, `pnpm --filter @netrart/website build`, then copies
  `apps/website/dist/` into an nginx alpine image.
- `docker/nginx.conf` routes `/api` and `/_/` to the `pb` service; all other
  paths serve the website bundle. `/app` is no longer a production path.
- **The app has no Dockerfile** in this pass. Its web build is a local-only
  debug aid (`pnpm dev:app`). If a deployable web build of the canvas is
  wanted later (demos, previews), add `docker/app.Dockerfile` in a follow-up.

## 13. Environment variables

- Root `.env.example` stays for things both apps share (currently just
  `VITE_PB_URL` for same-origin override).
- Per-app `.env.example` files as their needs diverge (e.g. website adds Stripe
  keys later).

## 14. Verification plan

After the restructure, each of these must work from a clean `pnpm install`:

1. `pnpm dev:website` — `localhost:5173` renders the landing; waitlist submit
   hits PB (via the Vite dev proxy).
2. `pnpm dev:app` — the app's dev server renders the canvas; image/video
   upload works against a running PB (`pnpm db:start`).
3. `pnpm tauri:dev` — a desktop window opens, canvas loads, PB sidecar runs,
   uploads persist.
4. `pnpm build` — both apps build successfully. `apps/website/dist/` and
   `apps/app/dist/` exist.
5. `pnpm tauri:build` — produces a native installer for the current platform.
6. `docker compose up -d` — website served on `:8080`, waitlist submission
   works end-to-end against the `pb` service.
7. `pnpm db:migrate` and `pnpm db:superuser` — still work unchanged.

No automated tests exist; verification is manual against the steps above.

## 15. Rollout and risk

- Execute as a single restructure commit (or a small series: `git mv` commit,
  config commit, tauri-path commit, docker commit) on a branch.
- Primary risks:
  - Tauri path resolution for `pb_migrations` and `binaries/` — mitigated by
    explicit path audit in `stage-pocketbase.mjs` and
    `tauri.conf.json`.
  - Vite's resolution of fonts exported from the design-system package — verify
    `@font-face` URLs resolve and fonts load in both apps.
  - pnpm's strict hoisting can surface phantom deps that npm was silently
    satisfying — surface and fix during verification.
- Rollback: the restructure lives on a branch until all verification steps
  pass on the merge candidate.

## 16. Open items

- Web deployable for the canvas (Docker image, production URL). Decision
  deferred until the canvas needs a shareable URL; spec assumes web canvas is
  dev-only.
- Preserving `/app` as a URL in the web debug build of the app. Spec assumes
  `base: '/'` for simplicity. Flip to `base: '/app/'` if muscle-memory from
  the current URL matters.
