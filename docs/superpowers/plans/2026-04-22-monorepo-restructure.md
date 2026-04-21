# Monorepo Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the single-`src/` NetraRT repo into a pnpm-workspaces monorepo with `apps/website`, `apps/app` (canvas + Tauri), `packages/design-system`, and `packages/tsconfig` — without changing any user-visible behavior.

**Architecture:** Two apps (website, app) consume shared packages (design-system, tsconfig). PocketBase infra (`pb/`, `scripts/`) stays at the repo root. Docker config moves to `docker/` and is scoped to the website deploy only. Tauri's `src-tauri/` moves under the app package; path references (migrations, binaries, before-commands) are updated accordingly.

**Tech Stack:** pnpm 9 workspaces, React 18, TypeScript, Vite 5, Tauri 2 (Rust), PocketBase. No new tools.

**Testing approach:** No automated tests exist. Each stage ends with manual verification steps from the spec's §14. Intermediate states may leave individual scripts broken until their stage completes — that's expected; only stage-boundary commits are guaranteed to pass their verification.

---

## File structure (target end-state)

```
netrart/
├── apps/
│   ├── website/
│   │   ├── src/
│   │   │   ├── landing/{Header,Hero,Why,Waitlist,Footer,Landing}.tsx
│   │   │   ├── components/CountUp.tsx
│   │   │   ├── hooks/useRevealOnScroll.ts
│   │   │   ├── lib/pb.ts         # online-PB client (reserved for future use; landing form is a UI stub today)
│   │   │   ├── payment/README.md
│   │   │   ├── license/README.md
│   │   │   ├── releases/README.md
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── public/assets/favicon/*
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   └── app/
│       ├── src/
│       │   ├── components/{ContextMenu,FloatingSidebar,HighlightInput,SettingsModal}.tsx
│       │   ├── hooks/useSettings.ts
│       │   ├── lib/pb.ts         # embedded-PB client (images, videos)
│       │   ├── auth/README.md
│       │   ├── App.css
│       │   ├── App.tsx
│       │   ├── Canvas.tsx
│       │   ├── InfiniteCanvas.tsx
│       │   ├── InfiniteCanvas.css
│       │   └── main.tsx
│       ├── src-tauri/            # whole Rust crate moves here
│       ├── public/               # app-local static assets (may be empty)
│       ├── index.html
│       ├── vite.config.ts
│       ├── tsconfig.json
│       └── package.json
├── packages/
│   ├── design-system/
│   │   ├── fonts/*.ttf
│   │   ├── assets/{logos,ornaments}/*
│   │   ├── tokens.css
│   │   ├── kit.css
│   │   ├── global.css
│   │   ├── reveal.css
│   │   ├── responsive.css
│   │   ├── colors_and_type.canonical.css
│   │   ├── README.md
│   │   ├── SKILL.md
│   │   └── package.json
│   └── tsconfig/
│       ├── base.json
│       └── package.json
├── pb/                           # unchanged
├── scripts/                      # stage-pocketbase.mjs destination path updated
├── docker/
│   ├── website.Dockerfile
│   ├── pb.Dockerfile
│   └── nginx.conf
├── docker-compose.yml            # updated paths
├── pnpm-workspace.yaml
├── package.json                  # slim root
├── pnpm-lock.yaml
├── .nvmrc
├── .gitignore
├── .env.example
└── README.md                     # monorepo overview
```

## Execution order

The plan proceeds in 6 stages. Each stage ends with a verification gate that must pass before the next stage begins.

- **Stage 1** — Workspace scaffolding (pnpm, packages/tsconfig, packages/design-system).
- **Stage 2** — Create `apps/website/` and move landing code; verify `pnpm dev:website`.
- **Stage 3** — Create `apps/app/` and move canvas code (web-only); verify `pnpm dev:app`.
- **Stage 4** — Move `src-tauri/` and fix Tauri paths; verify `pnpm tauri:dev` and `pnpm tauri:build`.
- **Stage 5** — Move Docker files and update paths; verify `docker compose up`.
- **Stage 6** — Final cleanup (remove root `src/`, old configs, update README, stub future-feature directories).

Use a feature branch for the whole restructure; do not merge until Stage 6 completes and all verification gates have passed.

---

## Stage 1 — Workspace scaffolding

### Task 1.1: Create a feature branch

**Files:** none

- [ ] **Step 1: Create and switch to a branch**

```bash
git checkout -b restructure/monorepo
```

- [ ] **Step 2: Confirm clean working tree except for the spec**

```bash
git status --short
```

Expected: only any in-progress work you had before; if dirty, stash it with `git stash push -m "pre-restructure"`.

### Task 1.2: Remove npm artifacts before switching package managers

**Files:**
- Delete: `package-lock.json`
- Delete: `node_modules/` (directory)

- [ ] **Step 1: Delete npm lockfile and installed modules**

```bash
rm -f package-lock.json
rm -rf node_modules
```

- [ ] **Step 2: Verify pnpm is installed, install if missing**

```bash
pnpm --version
```

Expected: `9.x.x`. If missing, install via `npm install -g pnpm@9` or `corepack enable && corepack prepare pnpm@9.15.0 --activate`.

- [ ] **Step 3: Commit the lockfile removal**

```bash
git add -A
git commit -m "chore: remove npm lockfile ahead of pnpm migration"
```

### Task 1.3: Add `pnpm-workspace.yaml`

**Files:**
- Create: `pnpm-workspace.yaml`

- [ ] **Step 1: Create the workspace manifest**

Write `pnpm-workspace.yaml`:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 2: Commit**

```bash
git add pnpm-workspace.yaml
git commit -m "chore: add pnpm-workspace manifest"
```

### Task 1.4: Replace root `package.json` with a slim workspace root

**Files:**
- Modify: `package.json` (full rewrite)

- [ ] **Step 1: Rewrite `package.json` to contain only root-level concerns**

Replace the entire file with:

```json
{
  "name": "netrart",
  "private": true,
  "version": "0.1.0",
  "packageManager": "pnpm@9.15.0",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "dev:website": "pnpm --filter @netrart/website dev",
    "dev:app": "pnpm --filter @netrart/app dev",
    "build": "pnpm -r build",
    "tauri:dev": "pnpm --filter @netrart/app tauri:dev",
    "tauri:build": "pnpm --filter @netrart/app tauri:build",
    "stage:pb": "node scripts/stage-pocketbase.mjs",
    "db:start": "node scripts/dev-pocketbase.mjs",
    "db:migrate": "node scripts/dev-pocketbase.mjs migrate up",
    "db:superuser": "node scripts/dev-pocketbase.mjs superuser create"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: slim root package.json for pnpm workspace"
```

### Task 1.5: Add `.nvmrc`

**Files:**
- Create: `.nvmrc`

- [ ] **Step 1: Pin Node major version**

Write `.nvmrc`:

```
20
```

- [ ] **Step 2: Commit**

```bash
git add .nvmrc
git commit -m "chore: pin Node 20 via .nvmrc"
```

### Task 1.6: Create `packages/tsconfig` package

**Files:**
- Create: `packages/tsconfig/package.json`
- Create: `packages/tsconfig/base.json`

- [ ] **Step 1: Create the package directory**

```bash
mkdir -p packages/tsconfig
```

- [ ] **Step 2: Write `packages/tsconfig/package.json`**

```json
{
  "name": "@netrart/tsconfig",
  "version": "0.0.0",
  "private": true,
  "files": [
    "base.json"
  ]
}
```

- [ ] **Step 3: Write `packages/tsconfig/base.json`**

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
    "forceConsistentCasingInFileNames": true,
    "allowImportingTsExtensions": false,
    "noEmit": true
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/tsconfig
git commit -m "feat(tsconfig): add shared tsconfig base package"
```

### Task 1.7: Create `packages/design-system` package — move files

**Files:**
- Create: `packages/design-system/package.json`
- Move: `design-system/*` → `packages/design-system/`
- Move: `src/styles/tokens.css` → `packages/design-system/tokens.css`
- Move: `src/styles/kit.css` → `packages/design-system/kit.css`
- Move: `src/styles/global.css` → `packages/design-system/global.css`
- Move: `src/styles/reveal.css` → `packages/design-system/reveal.css`
- Move: `src/styles/responsive.css` → `packages/design-system/responsive.css`
- Move: `public/fonts/*.ttf` → `packages/design-system/fonts/`

- [ ] **Step 1: Move existing `design-system/` directory contents**

```bash
mkdir -p packages/design-system
git mv design-system/README.md packages/design-system/README.md
git mv design-system/SKILL.md packages/design-system/SKILL.md
git mv design-system/colors_and_type.canonical.css packages/design-system/colors_and_type.canonical.css
git mv design-system/fonts packages/design-system/fonts
git mv design-system/assets packages/design-system/assets
rmdir design-system
```

- [ ] **Step 2: Move the CSS files from `src/styles/` into the package**

```bash
git mv src/styles/tokens.css packages/design-system/tokens.css
git mv src/styles/kit.css packages/design-system/kit.css
git mv src/styles/global.css packages/design-system/global.css
git mv src/styles/reveal.css packages/design-system/reveal.css
git mv src/styles/responsive.css packages/design-system/responsive.css
```

(Leave `src/styles/` directory — it'll be empty, deleted in Stage 6.)

- [ ] **Step 3: Move font files from `public/fonts/` into the design-system package**

The design-system already has an older copy of the fonts in `packages/design-system/fonts/`. Verify they match before deleting the `public/fonts/` copies.

```bash
diff -q public/fonts packages/design-system/fonts
```

Expected: no diff output (files identical). If there IS a diff, the public/fonts copy is the authoritative one in-use today — replace:

```bash
rm -rf packages/design-system/fonts
git mv public/fonts packages/design-system/fonts
```

If there's no diff, just delete the redundant public copy:

```bash
git rm -r public/fonts
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(design-system): consolidate tokens, CSS, and fonts into packages/design-system"
```

### Task 1.8: Update `tokens.css` font URLs to package-relative paths

**Files:**
- Modify: `packages/design-system/tokens.css` (all `url("/fonts/…")` references)

**Why this change:** The file currently uses absolute paths like `url("/fonts/SpaceMono-Regular.ttf")`, which assumes the font lives at the app's URL root. Once the CSS is imported from the design-system package, those absolute paths would miss the fonts (which now live in `packages/design-system/fonts/`). Relative paths (`./fonts/...`) let Vite resolve them to the package's font files and hash them into the app bundle.

- [ ] **Step 1: Replace all absolute font URLs with relative paths**

In `packages/design-system/tokens.css`, change every `url("/fonts/...")` to `url("./fonts/...")`. There are 8 occurrences (4 Space Mono weights + 4 Caveat weights).

Run this to do it mechanically:

```bash
sed -i.bak 's|url("/fonts/|url("./fonts/|g' packages/design-system/tokens.css
rm packages/design-system/tokens.css.bak
```

- [ ] **Step 2: Verify with a grep**

```bash
grep -n 'url(' packages/design-system/tokens.css | head -20
```

Expected: all `url(...)` entries now start with `"./fonts/...`; none start with `"/fonts/...`.

- [ ] **Step 3: Commit**

```bash
git add packages/design-system/tokens.css
git commit -m "fix(design-system): use package-relative paths for @font-face URLs"
```

### Task 1.9: Write `packages/design-system/package.json`

**Files:**
- Create: `packages/design-system/package.json`

- [ ] **Step 1: Write the package manifest**

```json
{
  "name": "@netrart/design-system",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "files": [
    "tokens.css",
    "kit.css",
    "global.css",
    "reveal.css",
    "responsive.css",
    "colors_and_type.canonical.css",
    "fonts",
    "assets"
  ],
  "exports": {
    "./tokens.css": "./tokens.css",
    "./kit.css": "./kit.css",
    "./global.css": "./global.css",
    "./reveal.css": "./reveal.css",
    "./responsive.css": "./responsive.css",
    "./colors_and_type.canonical.css": "./colors_and_type.canonical.css",
    "./fonts/*": "./fonts/*",
    "./assets/*": "./assets/*"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/design-system/package.json
git commit -m "feat(design-system): add package manifest with CSS + fonts exports"
```

### Task 1.10: Stage 1 verification — `pnpm install` resolves the workspace

**Files:** none

- [ ] **Step 1: Install workspace dependencies**

```bash
pnpm install
```

Expected: pnpm prints "Scope: all X workspace projects" and creates `pnpm-lock.yaml` at the repo root. No "missing workspace" errors. The `apps/*` glob matching nothing is OK at this stage (pnpm allows empty globs with a warning).

- [ ] **Step 2: Verify `@netrart/design-system` and `@netrart/tsconfig` appear in the workspace**

```bash
pnpm -r list --depth -1 2>/dev/null | grep -E '@netrart/(design-system|tsconfig)'
```

Expected: both package names listed.

- [ ] **Step 3: Commit the lockfile**

```bash
git add pnpm-lock.yaml
git commit -m "chore: generate pnpm-lock.yaml"
```

---

## Stage 2 — Create `apps/website/`

### Task 2.1: Scaffold the website package directory

**Files:**
- Create: `apps/website/package.json`
- Create: `apps/website/tsconfig.json`
- Create: `apps/website/vite.config.ts`
- Create: `apps/website/index.html`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p apps/website/src apps/website/public/assets
```

- [ ] **Step 2: Write `apps/website/package.json`**

```json
{
  "name": "@netrart/website",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@netrart/design-system": "workspace:*",
    "pocketbase": "^0.26.8",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "remixicon": "^4.9.1"
  },
  "devDependencies": {
    "@netrart/tsconfig": "workspace:*",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.6.3",
    "vite": "^5.4.11"
  }
}
```

- [ ] **Step 3: Write `apps/website/tsconfig.json`**

```json
{
  "extends": "@netrart/tsconfig/base.json",
  "compilerOptions": {
    "types": ["vite/client"],
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Write `apps/website/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxy: route /api and /_/ to the local PocketBase so the waitlist
// (and any future authenticated routes) can use relative URLs — matches
// the nginx setup used in production.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8090',
        changeOrigin: true,
        ws: true,
      },
      '/_': {
        target: 'http://127.0.0.1:8090',
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] **Step 5: Write `apps/website/index.html`**

Note: font preload links are dropped — Vite will fingerprint and serve fonts via the design-system package's CSS. Preload tuning is a separate follow-up.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#FFFFFF" />
    <title>NetraRT — Vision AI for anyone</title>

    <link rel="icon" href="/assets/favicon/favicon.ico" sizes="any" />
    <link rel="icon" href="/assets/favicon/favicon-16.png" type="image/png" sizes="16x16" />
    <link rel="apple-touch-icon" href="/assets/favicon/apple-touch-icon.png" />
    <link rel="icon" type="image/png" sizes="192x192" href="/assets/favicon/android-192.png" />
    <link rel="icon" type="image/png" sizes="512x512" href="/assets/favicon/android-512.png" />

    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Install to hook the new package into the workspace**

```bash
pnpm install
```

Expected: pnpm resolves `@netrart/design-system` and `@netrart/tsconfig` via `workspace:*`; `apps/website/node_modules` populated.

- [ ] **Step 7: Commit**

```bash
git add apps/website pnpm-lock.yaml
git commit -m "feat(website): scaffold @netrart/website package"
```

### Task 2.2: Move website source files into `apps/website/src/`

**Files:**
- Move: `src/landing/*.tsx` → `apps/website/src/landing/`
- Move: `src/hooks/useRevealOnScroll.ts` → `apps/website/src/hooks/useRevealOnScroll.ts`
- Move: `src/components/CountUp.tsx` → `apps/website/src/components/CountUp.tsx` (landing-only, used by `Waitlist.tsx`)

- [ ] **Step 1: Move landing components**

```bash
mkdir -p apps/website/src/landing apps/website/src/hooks apps/website/src/components
git mv src/landing/Footer.tsx apps/website/src/landing/Footer.tsx
git mv src/landing/Header.tsx apps/website/src/landing/Header.tsx
git mv src/landing/Hero.tsx apps/website/src/landing/Hero.tsx
git mv src/landing/Landing.tsx apps/website/src/landing/Landing.tsx
git mv src/landing/Waitlist.tsx apps/website/src/landing/Waitlist.tsx
git mv src/landing/Why.tsx apps/website/src/landing/Why.tsx
rmdir src/landing
```

- [ ] **Step 2: Move `useRevealOnScroll` and `CountUp`**

```bash
git mv src/hooks/useRevealOnScroll.ts apps/website/src/hooks/useRevealOnScroll.ts
git mv src/components/CountUp.tsx apps/website/src/components/CountUp.tsx
```

- [ ] **Step 3: Verify relative imports still resolve**

Both imports use relative paths (`'../hooks/...'` and `'../components/...'`) that resolve identically in the new layout. Confirm:

```bash
grep -n 'useRevealOnScroll' apps/website/src/landing/Landing.tsx
grep -n 'CountUp' apps/website/src/landing/Waitlist.tsx
```

Expected:
- `import { useRevealOnScroll } from '../hooks/useRevealOnScroll';`
- `import { CountUp } from '../components/CountUp';`

No code edits needed.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(website): relocate landing, hooks, and CountUp"
```

### Task 2.3: Create the website's `pb.ts`, `App.tsx`, and `main.tsx`

**Files:**
- Create: `apps/website/src/lib/pb.ts`
- Create: `apps/website/src/App.tsx`
- Create: `apps/website/src/main.tsx`

- [ ] **Step 1: Write `apps/website/src/lib/pb.ts`**

This is the online-PB client. The website talks to whichever PB serves same-origin (dev proxy → local PB; prod → nginx → PB container). No Tauri branch — the website never runs in Tauri.

```ts
import PocketBase from 'pocketbase';

// Default to same-origin relative calls. The Vite dev proxy (and nginx in
// prod) route /api and /_/ to the PocketBase service. Override with
// VITE_PB_URL to point at a remote PB (e.g. staging, or production web
// pointing at a separate online DB for license/auth in the future).
const rawUrl = (import.meta.env.VITE_PB_URL as string | undefined) ?? '';
export const PB_URL = rawUrl.replace(/\/+$/, '');

// new PocketBase('') rejects empty — pass '/' so it issues relative paths.
export const pb = new PocketBase(PB_URL || '/');

// Disable automatic request cancellation — StrictMode's double-effect in
// dev would otherwise cancel the very first fetch before it resolves.
pb.autoCancellation(false);
```

- [ ] **Step 2: Confirm `Waitlist.tsx` has no stale `pb` import today**

The current `Waitlist.tsx` does not import `pb` at all — the form is a UI stub that just toggles local state. Verify:

```bash
grep -n "from.*pb\|import pb" apps/website/src/landing/Waitlist.tsx
```

Expected: no matches. (If a match is found — e.g. the stub has been wired up since this plan was written — change the import to `from '../lib/pb'`; the relative path from `src/landing/` to `src/lib/` is one directory up either way.)

- [ ] **Step 3: Write `apps/website/src/App.tsx`**

Simpler than the original — no router, no canvas branch. Just renders the landing.

```tsx
import { Landing } from './landing/Landing';

export function App() {
  return <Landing />;
}
```

- [ ] **Step 4: Write `apps/website/src/main.tsx`**

Imports the design-system CSS via the workspace package. Landing needs tokens, kit, reveal (for scroll-triggered animations), responsive, global.

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'remixicon/fonts/remixicon.css';
import '@netrart/design-system/tokens.css';
import '@netrart/design-system/kit.css';
import '@netrart/design-system/reveal.css';
import '@netrart/design-system/responsive.css';
import '@netrart/design-system/global.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 5: Commit**

```bash
git add apps/website/src
git commit -m "feat(website): add entry point, App, and PB client"
```

### Task 2.4: Move website public assets (favicons)

**Files:**
- Move: `public/assets/favicon/*` → `apps/website/public/assets/favicon/`
- Move: `public/assets/logos/*`, `public/assets/ornaments/*` — stay in `packages/design-system/assets/` (already there; if not, move them)

- [ ] **Step 1: Move favicons to the website's public directory**

```bash
mkdir -p apps/website/public/assets
git mv public/assets/favicon apps/website/public/assets/favicon
```

- [ ] **Step 2: Verify design-system already has logos + ornaments**

```bash
ls packages/design-system/assets/
```

Expected: `logos/` and `ornaments/` directories with the SVG files. If either is missing, move from `public/assets/`:

```bash
[ -d public/assets/logos ] && git mv public/assets/logos packages/design-system/assets/logos
[ -d public/assets/ornaments ] && git mv public/assets/ornaments packages/design-system/assets/ornaments
```

- [ ] **Step 3: Clean up the now-empty root `public/assets/`**

```bash
rmdir public/assets 2>/dev/null || true
```

(If the directory is non-empty, investigate before deleting — may indicate missed assets.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(website): relocate favicons to apps/website/public"
```

### Task 2.5: Stage 2 verification — website dev server renders the landing

**Files:** none

- [ ] **Step 1: Start a local PocketBase**

In one terminal:

```bash
pnpm db:start
```

Expected: `[dev-pocketbase]` log lines, then `Server started at http://127.0.0.1:8090`.

- [ ] **Step 2: Start the website dev server**

In another terminal:

```bash
pnpm dev:website
```

Expected: Vite prints `Local: http://localhost:5173/`. No TypeScript or module-resolution errors.

- [ ] **Step 3: Visit the page in a browser**

Open `http://localhost:5173/`. Expected:
- Landing page renders (Header, Hero, Why, Waitlist, Footer).
- Fonts (Space Mono, Caveat) load — text looks correct, not system-default.
- Favicon appears in the tab.
- Browser devtools Network tab shows no 404s for `/fonts/...` or `/assets/favicon/...`.

- [ ] **Step 4: Submit the waitlist form (UI-only check)**

The current `Waitlist.tsx` is a UI stub — it sets local state on submit and does not actually POST to PocketBase. Enter an email and submit; expected: the form transitions to the "You're on the list" confirmation UI. No PB record is created (that's fine — the form's network wiring is a future task, not part of this restructure).

- [ ] **Step 5: If any verification fails, fix before proceeding**

Common issues:
- 404 on fonts: `tokens.css` still has absolute `/fonts/` paths. Re-check Task 1.8.
- 404 on favicon: favicons didn't move, or path in `index.html` is wrong.
- Import errors: a moved file has a stale relative path. Grep `apps/website/src` for `../../src/` or similar.
- `@netrart/design-system` not resolving: make sure `pnpm install` ran after Task 2.1 so the workspace symlinks exist.

- [ ] **Step 6: Stop the dev server and PB (Ctrl+C each), commit any fixes**

```bash
git status --short
# If there are fixes:
git add -A && git commit -m "fix: Stage 2 verification fixes"
```

---

## Stage 3 — Create `apps/app/` (web-only, no Tauri yet)

### Task 3.1: Scaffold the app package

**Files:**
- Create: `apps/app/package.json`
- Create: `apps/app/tsconfig.json`
- Create: `apps/app/vite.config.ts`
- Create: `apps/app/index.html`

- [ ] **Step 1: Create directories**

```bash
mkdir -p apps/app/src apps/app/public
```

- [ ] **Step 2: Write `apps/app/package.json`**

Tauri CLI and `@tauri-apps/plugin-shell` are only needed by the app. Tauri scripts are declared here (stage:pb runs from repo root via `node ../../scripts/...`).

```json
{
  "name": "@netrart/app",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "stage:pb": "node ../../scripts/stage-pocketbase.mjs",
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  },
  "dependencies": {
    "@netrart/design-system": "workspace:*",
    "@tauri-apps/api": "^2.10.1",
    "@tauri-apps/plugin-shell": "^2.3.5",
    "pocketbase": "^0.26.8",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "remixicon": "^4.9.1"
  },
  "devDependencies": {
    "@netrart/tsconfig": "workspace:*",
    "@tauri-apps/cli": "^2.10.1",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.6.3",
    "vite": "^5.4.11"
  }
}
```

- [ ] **Step 3: Write `apps/app/tsconfig.json`**

```json
{
  "extends": "@netrart/tsconfig/base.json",
  "compilerOptions": {
    "types": ["vite/client"],
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Write `apps/app/vite.config.ts`**

Same dev-proxy pattern — the app's web debug build needs `/api` and `/_/` routed to local PocketBase. Tauri uses the `devUrl` setting in `tauri.conf.json` to point at this same Vite server.

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    host: true,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8090',
        changeOrigin: true,
        ws: true,
      },
      '/_': {
        target: 'http://127.0.0.1:8090',
        changeOrigin: true,
      },
    },
  },
});
```

Note: port 5174 avoids a clash with the website's 5173 when both run at once.

- [ ] **Step 5: Write `apps/app/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <meta name="theme-color" content="#FFFFFF" />
    <title>NetraRT — Canvas</title>

    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Install**

```bash
pnpm install
```

- [ ] **Step 7: Commit**

```bash
git add apps/app pnpm-lock.yaml
git commit -m "feat(app): scaffold @netrart/app package"
```

### Task 3.2: Move canvas source files into `apps/app/src/`

**Files:**
- Move: `src/Canvas.tsx`, `src/InfiniteCanvas.tsx`, `src/InfiniteCanvas.css`, `src/App.css` → `apps/app/src/`
- Move: `src/components/*` → `apps/app/src/components/`
- Move: `src/hooks/useSettings.ts` → `apps/app/src/hooks/useSettings.ts`

- [ ] **Step 1: Move canvas top-level files**

```bash
git mv src/Canvas.tsx apps/app/src/Canvas.tsx
git mv src/InfiniteCanvas.tsx apps/app/src/InfiniteCanvas.tsx
git mv src/InfiniteCanvas.css apps/app/src/InfiniteCanvas.css
git mv src/App.css apps/app/src/App.css
```

- [ ] **Step 2: Move canvas components**

Note: `CountUp.tsx` was already moved to `apps/website/` in Task 2.2 (landing-only). The remaining `src/components/` entries are all canvas-only.

```bash
mkdir -p apps/app/src/components
git mv src/components/ContextMenu.tsx apps/app/src/components/ContextMenu.tsx
git mv src/components/FloatingSidebar.tsx apps/app/src/components/FloatingSidebar.tsx
git mv src/components/HighlightInput.tsx apps/app/src/components/HighlightInput.tsx
git mv src/components/SettingsModal.tsx apps/app/src/components/SettingsModal.tsx
rmdir src/components
```

- [ ] **Step 3: Move `useSettings`**

```bash
mkdir -p apps/app/src/hooks
git mv src/hooks/useSettings.ts apps/app/src/hooks/useSettings.ts
rmdir src/hooks 2>/dev/null || true
```

- [ ] **Step 4: Move the Vite env shim into the app; copy it into the website**

Both apps need the Vite client types reference for `import.meta.env` typing. Move the original into the app, then copy a duplicate into the website (the file is one line; no package extraction needed for so little content).

```bash
git mv src/vite-env.d.ts apps/app/src/vite-env.d.ts
cp apps/app/src/vite-env.d.ts apps/website/src/vite-env.d.ts
git add apps/website/src/vite-env.d.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(app): relocate canvas source files"
```

### Task 3.3: Create the app's `pb.ts`, `App.tsx`, and `main.tsx`

**Files:**
- Move: `src/lib/pb.ts` → `apps/app/src/lib/pb.ts` (then trim landing-specific code)
- Create: `apps/app/src/App.tsx`
- Create: `apps/app/src/main.tsx`

- [ ] **Step 1: Move `src/lib/pb.ts`**

```bash
mkdir -p apps/app/src/lib
git mv src/lib/pb.ts apps/app/src/lib/pb.ts
rmdir src/lib 2>/dev/null || true
```

- [ ] **Step 2: Verify no landing-only code remains in `apps/app/src/lib/pb.ts`**

Open the file. Everything there is canvas-only (images/videos CRUD, `uploadWithProgress`, `UploadAbortError`). The website's pb.ts (Task 2.3) already has its own stripped-down copy. No changes needed to the app's pb.ts — it stays as-is, just at a new path.

```bash
grep -n 'waitlist' apps/app/src/lib/pb.ts || echo "no waitlist references — good"
```

Expected: `no waitlist references — good`.

- [ ] **Step 3: Write `apps/app/src/App.tsx`**

No router, no landing branch. Always renders the canvas. The `is-canvas` class is applied unconditionally at mount so App.css's body-scroll-lock rules kick in.

```tsx
import { useEffect } from 'react';
import { Canvas } from './Canvas';

export function App() {
  useEffect(() => {
    document.body.classList.add('is-canvas');
    return () => document.body.classList.remove('is-canvas');
  }, []);

  return <Canvas />;
}
```

- [ ] **Step 4: Write `apps/app/src/main.tsx`**

The canvas uses the same design-system CSS; `App.css` is canvas-specific (kept local to `apps/app/src/`).

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'remixicon/fonts/remixicon.css';
import '@netrart/design-system/tokens.css';
import '@netrart/design-system/kit.css';
import '@netrart/design-system/responsive.css';
import '@netrart/design-system/global.css';
import './App.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

Note: no `reveal.css` — that's landing-only.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src
git commit -m "feat(app): add entry point, App, and relocate pb client"
```

### Task 3.4: Delete obsolete top-level source files

**Files:**
- Delete: `src/App.tsx`
- Delete: `src/router.tsx`
- Delete: `src/main.tsx`
- Delete: `src/vite-env.d.ts` (already moved above if it existed at root)
- Delete: `src/styles/` (empty after Stage 1 CSS moves)

- [ ] **Step 1: Delete obsolete root-level source files**

```bash
git rm -f src/App.tsx src/router.tsx src/main.tsx
rm -rf src/styles 2>/dev/null || true
# Remove `src/` only if truly empty:
rmdir src 2>/dev/null || true
```

- [ ] **Step 2: Verify `src/` is gone (or near-empty)**

```bash
ls src/ 2>&1
```

Expected: `ls: src/: No such file or directory` — or if some stragglers remain, investigate and move/delete them.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove obsolete root-level src/ entries (moved to apps/)"
```

### Task 3.5: Stage 3 verification — canvas runs in web dev mode

**Files:** none

- [ ] **Step 1: Ensure PocketBase is running**

```bash
pnpm db:start
```

- [ ] **Step 2: Start the app dev server**

```bash
pnpm dev:app
```

Expected: Vite prints `Local: http://localhost:5174/`. No module-resolution or TS errors.

- [ ] **Step 3: Visit the canvas**

Open `http://localhost:5174/`. Expected:
- Canvas loads (infinite-canvas background, floating sidebar).
- No console errors.
- Fonts render correctly.

- [ ] **Step 4: Upload an image to verify PB wiring**

Drag an image onto the canvas. Expected: upload progress fill, image appears on the canvas and persists after reload.

- [ ] **Step 5: Run typecheck on both apps**

```bash
pnpm -r build
```

Expected: both `@netrart/website` and `@netrart/app` build. `apps/website/dist/` and `apps/app/dist/` exist. No TS errors.

```bash
ls apps/website/dist apps/app/dist
```

- [ ] **Step 6: Stop dev server, commit any fixes**

```bash
git status --short
# If there are fixes:
git add -A && git commit -m "fix: Stage 3 verification fixes"
```

---

## Stage 4 — Move `src-tauri/` under the app; fix paths

### Task 4.1: Move the Rust crate to `apps/app/src-tauri/`

**Files:**
- Move: `src-tauri/` → `apps/app/src-tauri/` (the whole directory)

- [ ] **Step 1: Move the directory**

```bash
git mv src-tauri apps/app/src-tauri
```

- [ ] **Step 2: Verify the move**

```bash
ls apps/app/src-tauri/
```

Expected: `Cargo.toml`, `Cargo.lock`, `build.rs`, `src/`, `capabilities/`, `icons/`, `tauri.conf.json`, and any `gen/` or `binaries/` subdirectories if they existed.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(app): move src-tauri under apps/app"
```

### Task 4.2: Update `tauri.conf.json` paths

**Files:**
- Modify: `apps/app/src-tauri/tauri.conf.json`

**Why:** `frontendDist` needs to point at the app's dist; `resources` path needs an extra `../../` to reach the repo root from the new location; `beforeDevCommand` / `beforeBuildCommand` run with `apps/app/` as CWD, so they call into the app's own scripts.

- [ ] **Step 1: Replace the config file contents**

Write `apps/app/src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "NetraRT",
  "version": "0.1.0",
  "identifier": "ai.kolosal.netrart",
  "build": {
    "beforeDevCommand": "pnpm stage:pb && pnpm dev",
    "devUrl": "http://localhost:5174",
    "beforeBuildCommand": "pnpm stage:pb && pnpm build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "NetraRT",
        "width": 1280,
        "height": 820,
        "minWidth": 900,
        "minHeight": 600,
        "resizable": true,
        "fullscreen": false,
        "dragDropEnabled": false
      }
    ],
    "security": {
      "csp": "default-src 'self'; connect-src 'self' http://127.0.0.1:8090 ws://127.0.0.1:8090 https://fonts.googleapis.com https://fonts.gstatic.com; img-src 'self' data: blob: http://127.0.0.1:8090; media-src 'self' blob: http://127.0.0.1:8090; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; script-src 'self'"
    }
  },
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
    "category": "Productivity",
    "shortDescription": "NetraRT infinite canvas",
    "longDescription": "NetraRT — infinite canvas desktop app"
  }
}
```

Key changes from the original:
- `devUrl`: `5173` → `5174` (the app's new dev port).
- `beforeDevCommand`: `npm run stage:pb && npm run dev` → `pnpm stage:pb && pnpm dev` (uses the app package's scripts).
- `beforeBuildCommand`: same pattern.
- `resources`: `"../pb/pb_migrations": "pb_migrations"` → `"../../../pb/pb_migrations": "pb_migrations"` (three levels up from `apps/app/src-tauri/` to the repo root).

- [ ] **Step 2: Commit**

```bash
git add apps/app/src-tauri/tauri.conf.json
git commit -m "fix(app): update tauri.conf paths for monorepo layout"
```

### Task 4.3: Update `stage-pocketbase.mjs` destination path

**Files:**
- Modify: `scripts/stage-pocketbase.mjs`

**Why:** The script currently writes to `resolve(projectRoot, 'src-tauri', 'binaries')` but `src-tauri/` moved to `apps/app/src-tauri/`.

- [ ] **Step 1: Edit the destination path**

Change line 46 of `scripts/stage-pocketbase.mjs` from:

```js
const destDir = resolve(projectRoot, 'src-tauri', 'binaries');
```

to:

```js
const destDir = resolve(projectRoot, 'apps', 'app', 'src-tauri', 'binaries');
```

- [ ] **Step 2: Verify with a grep**

```bash
grep -n "src-tauri" scripts/stage-pocketbase.mjs
```

Expected: shows `apps/app/src-tauri/binaries` as the destination (or a similar path with the new layout).

- [ ] **Step 3: Smoke-test**

```bash
pnpm stage:pb
ls apps/app/src-tauri/binaries/
```

Expected: a `pocketbase-<triple>` file exists. (If `pb/pocketbase` is missing, the script exits with an error — install the binary per the README first, then retry.)

- [ ] **Step 4: Commit**

```bash
git add scripts/stage-pocketbase.mjs
git commit -m "fix(scripts): update stage-pocketbase dest for apps/app/src-tauri"
```

### Task 4.4: Stage 4 verification — `tauri:dev` and `tauri:build` still work

**Files:** none

- [ ] **Step 1: Ensure no other PB is running**

```bash
# On macOS/Linux:
pkill -f pocketbase || true
```

Expected: kills any stray `pnpm db:start` from earlier stages. (If the Rust code in `src-tauri/src/lib.rs` detects an existing PB on :8090, it reuses it — that's fine, but for the cleanest test, start from a blank slate.)

- [ ] **Step 2: Run `pnpm tauri:dev` from the repo root**

```bash
pnpm tauri:dev
```

Expected:
- `stage:pb` runs, copies the binary.
- Vite dev server starts on :5174.
- Rust compiles (may take minutes on first run).
- A desktop window titled "NetraRT" opens showing the canvas.
- PB sidecar logs appear in the terminal (`[pocketbase] ...`).

- [ ] **Step 3: Upload an image in the desktop window**

Drag an image onto the canvas. Expected: upload completes, image appears, persists after closing and reopening the app.

- [ ] **Step 4: Close the app, then run `pnpm tauri:build`**

```bash
pnpm tauri:build
```

Expected: Rust compiles in release mode; native installer produced at `apps/app/src-tauri/target/release/bundle/...` (exact path depends on OS: `.dmg` on macOS, `.msi` on Windows, `.deb`/`.AppImage` on Linux).

- [ ] **Step 5: Install the built app and launch it**

Open the `.dmg` / `.msi` / `.AppImage` from the bundle dir. Launch the installed app. Expected:
- Window opens, canvas renders.
- Uploads work (PB sidecar launches from the bundle, migrations auto-apply from `Resources/pb_migrations/`).

- [ ] **Step 6: Commit any fixes**

```bash
git status --short
# If there are fixes:
git add -A && git commit -m "fix: Stage 4 verification fixes"
```

---

## Stage 5 — Docker and web deployment

### Task 5.1: Move and rename Docker files

**Files:**
- Move: `Dockerfile` → `docker/website.Dockerfile`
- Move: `Dockerfile.pb` → `docker/pb.Dockerfile`
- Move: `nginx.conf` → `docker/nginx.conf`

- [ ] **Step 1: Create `docker/` and move files**

```bash
mkdir -p docker
git mv Dockerfile docker/website.Dockerfile
git mv Dockerfile.pb docker/pb.Dockerfile
git mv nginx.conf docker/nginx.conf
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "chore(docker): move Dockerfiles and nginx.conf into docker/"
```

### Task 5.2: Rewrite `docker/website.Dockerfile` for pnpm + website-only build

**Files:**
- Modify: `docker/website.Dockerfile` (full rewrite)

**Why:** The original copies `src/`, `tsconfig.json`, `vite.config.ts` from the root and runs `npm ci`. In the new layout, we need pnpm, the whole workspace (for `@netrart/design-system`), and a filtered build of just the website.

- [ ] **Step 1: Rewrite the file**

```dockerfile
# syntax=docker/dockerfile:1.7
# Stage 1 — build the website Vite bundle using pnpm workspace.
FROM node:20-alpine AS build

# pnpm via corepack — pinned in root package.json's "packageManager" field.
RUN corepack enable

WORKDIR /repo

# Copy the root workspace manifest and lockfile first so install-step
# caching invalidates only on dependency changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Copy each workspace package's manifest — pnpm needs them to resolve
# the dependency graph before it has the source.
COPY packages/design-system/package.json ./packages/design-system/
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY apps/website/package.json ./apps/website/
COPY apps/app/package.json ./apps/app/

RUN pnpm install --frozen-lockfile --filter @netrart/website...

# Copy source for the website build (website + its workspace deps).
COPY packages/design-system ./packages/design-system
COPY packages/tsconfig ./packages/tsconfig
COPY apps/website ./apps/website

# Build with a relative API base so the bundle talks to whatever origin
# serves it — nginx will reverse-proxy /api and /_/ to the PB container.
ENV VITE_PB_URL=""
RUN pnpm --filter @netrart/website build

# Stage 2 — serve static assets + proxy to PocketBase via nginx.
FROM nginx:1.27-alpine

COPY --from=build /repo/apps/website/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
```

- [ ] **Step 2: Commit**

```bash
git add docker/website.Dockerfile
git commit -m "feat(docker): rewrite website.Dockerfile for pnpm workspace"
```

### Task 5.3: Update `docker/pb.Dockerfile` path reference

**Files:**
- Modify: `docker/pb.Dockerfile` (single-line path fix)

**Why:** When the Dockerfile moves into `docker/`, the `docker build` context is still the repo root (specified in `docker-compose.yml`), so `COPY pb/pb_migrations /pb/pb_migrations` continues to resolve. No change needed to the COPY path — but double-check by reading the file.

- [ ] **Step 1: Verify no path change is needed**

```bash
grep -n "COPY " docker/pb.Dockerfile
```

Expected: `COPY pb/pb_migrations /pb/pb_migrations` — this remains correct because the build context (set in docker-compose) is still the repo root.

- [ ] **Step 2: No commit** — no changes needed.

### Task 5.4: Update `docker-compose.yml` to reference new Dockerfile paths

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Replace the `dockerfile:` lines in both services**

In `docker-compose.yml`, change:

```yaml
  pb:
    build:
      context: .
      dockerfile: Dockerfile.pb
```

to:

```yaml
  pb:
    build:
      context: .
      dockerfile: docker/pb.Dockerfile
```

And change:

```yaml
  web:
    build:
      context: .
      dockerfile: Dockerfile
```

to:

```yaml
  web:
    build:
      context: .
      dockerfile: docker/website.Dockerfile
```

The `context: .` stays the same — the root — which keeps `COPY pb/pb_migrations ...` and similar paths in the Dockerfiles valid.

- [ ] **Step 2: Verify the file**

```bash
grep -n 'dockerfile:' docker-compose.yml
```

Expected:
```
    dockerfile: docker/pb.Dockerfile
    dockerfile: docker/website.Dockerfile
```

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "chore(docker): point compose at docker/ subdirectory"
```

### Task 5.5: Stage 5 verification — docker compose builds and serves

**Files:** none

- [ ] **Step 1: Ensure Docker is running and no stale containers are up**

```bash
docker compose down -v 2>/dev/null || true
```

- [ ] **Step 2: Build and start**

```bash
docker compose up -d --build
```

Expected: both images build without errors; two containers (`netrart-pb`, `netrart-web`) running. `docker compose ps` shows both healthy.

- [ ] **Step 3: Visit the website at `http://localhost:8080`**

Expected:
- Landing page renders identically to the dev build.
- Fonts, favicons, and CSS load (no 404s in devtools Network).
- Waitlist form submits successfully — enters a record into the containerized PB.

- [ ] **Step 4: Check PB admin at `http://localhost:8080/_/`**

Expected: PocketBase admin UI loads, can log in with a pre-existing superuser.

- [ ] **Step 5: Tear down**

```bash
docker compose down
```

(Use `-v` only if you're OK wiping PB state — the named volume survives without it.)

- [ ] **Step 6: Commit any fixes**

```bash
git status --short
# If there are fixes:
git add -A && git commit -m "fix: Stage 5 verification fixes"
```

---

## Stage 6 — Cleanup, stubs, and docs

### Task 6.1: Delete remaining root-level files that are now obsolete

**Files:**
- Delete: `tsconfig.json` (root)
- Delete: `tsconfig.tsbuildinfo` (root)
- Delete: `vite.config.ts` (root)
- Delete: `index.html` (root)
- Delete: `dist/` (root) — stale artifact from the old single-bundle build
- Delete: `public/` (root) — empty if all assets moved correctly

- [ ] **Step 1: Remove obsolete root files**

```bash
git rm -f tsconfig.json vite.config.ts index.html
rm -f tsconfig.tsbuildinfo
rm -rf dist
# Only remove public if empty:
[ -z "$(ls -A public)" ] && rmdir public || echo "public/ not empty — inspect before deleting"
```

If `public/` has leftovers, move them to the appropriate app's `public/` dir, then delete.

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "chore: remove obsolete root-level configs and build artifacts"
```

### Task 6.2: Update `.gitignore` for the new layout

**Files:**
- Modify: `.gitignore`

The original `.gitignore` is small (24 lines). The rewrite below preserves every rule from it, adjusts the three Tauri paths for the new `apps/app/src-tauri/` location, and adds entries for per-app `dist/` and `.vite/`.

- [ ] **Step 1: Replace the entire `.gitignore`**

```gitignore
# Dependencies
node_modules/

# Per-app build output
apps/*/dist/
apps/*/.vite/
packages/*/dist/
dist/
.vite/

# Logs, OS, editor, env
*.log
*.tsbuildinfo
.DS_Store
.env
.env.local
.env.*.local

# PocketBase runtime state (DB, uploads, generated types)
pb/pb_data/

# Tauri build artifacts
apps/app/src-tauri/target/
apps/app/src-tauri/gen/
# Platform-specific sidecar binaries are copied in at build time; keep the
# canonical copy under pb/ and ignore the per-target duplicates under
# apps/app/src-tauri/binaries/ (each developer rebuilds for their own triple).
apps/app/src-tauri/binaries/

# Local Claude harness state (not meant to be committed).
.claude/
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: update .gitignore for monorepo layout"
```

### Task 6.3: Add stub READMEs for future subsystems

**Files:**
- Create: `apps/website/src/payment/README.md`
- Create: `apps/website/src/license/README.md`
- Create: `apps/website/src/releases/README.md`
- Create: `apps/app/src/auth/README.md`

- [ ] **Step 1: Create the payment stub**

```bash
mkdir -p apps/website/src/payment
```

Write `apps/website/src/payment/README.md`:

```markdown
# Payment (placeholder)

Not implemented. This directory reserves the location for the public
website's payment integration (checkout, subscription management,
Stripe webhooks, receipts).

Out of scope for the current monorepo restructure (scope A). Implement
in a follow-up spec.
```

- [ ] **Step 2: Create the license stub**

```bash
mkdir -p apps/website/src/license
```

Write `apps/website/src/license/README.md`:

```markdown
# License accounts (placeholder)

Not implemented. This directory reserves the location for the website's
license-account system — registration, login, license issuance, license
validation API used by the desktop app.

The online PocketBase (accessed via `src/lib/pb.ts`) will host the
`users` and `licenses` collections. Out of scope for the current
monorepo restructure (scope A).
```

- [ ] **Step 3: Create the releases stub**

```bash
mkdir -p apps/website/src/releases
```

Write `apps/website/src/releases/README.md`:

```markdown
# Release / auto-update server (placeholder)

Not implemented. This directory reserves the location for the release
and delta-update system that serves signed update manifests to the
Tauri desktop app.

Goals for the future design:
- Manifest endpoint the Tauri updater polls.
- Delta packaging — ship only changed files, not full installers.
- Signing + rollback story.

Out of scope for the current monorepo restructure (scope A).
```

- [ ] **Step 4: Create the app-side auth stub**

```bash
mkdir -p apps/app/src/auth
```

Write `apps/app/src/auth/README.md`:

```markdown
# Desktop auth client (placeholder)

Not implemented. This directory reserves the location for the desktop
app's login flow — authenticates against the website's online
PocketBase (see `apps/website/src/license/`) to validate a license.

Canvas data (images, videos, layout) continues to live in the embedded
PocketBase (`apps/app/src/lib/pb.ts`); nothing local moves online.

Out of scope for the current monorepo restructure (scope A).
```

- [ ] **Step 5: Commit**

```bash
git add apps/website/src/payment apps/website/src/license apps/website/src/releases apps/app/src/auth
git commit -m "docs: add stub READMEs for future subsystems"
```

### Task 6.4: Rewrite root `README.md` for the monorepo

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the README with a monorepo-oriented overview**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for monorepo layout"
```

### Task 6.5: Final full verification

**Files:** none

- [ ] **Step 1: Full clean reinstall**

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules
pnpm install
```

Expected: clean install, `pnpm-lock.yaml` unchanged (no diff after install).

- [ ] **Step 2: Run all verification gates in sequence**

Run each of the following and confirm each works:

1. `pnpm dev:website` → landing renders at `http://localhost:5173/`, waitlist submits. Ctrl+C.
2. `pnpm dev:app` (with `pnpm db:start` in another terminal) → canvas renders at `http://localhost:5174/`, image upload persists. Ctrl+C.
3. `pnpm tauri:dev` → desktop window with working canvas. Ctrl+C.
4. `pnpm build` → both apps' `dist/` directories populate, no errors.
5. `pnpm tauri:build` → native installer produced.
6. `docker compose up -d --build` → website at `http://localhost:8080/`, waitlist submits. `docker compose down`.
7. `pnpm db:migrate` → no errors (schema already up-to-date).

- [ ] **Step 3: If all pass, push the branch**

```bash
git push -u origin restructure/monorepo
```

- [ ] **Step 4: Open a PR**

Use a gh PR with title `Restructure: move to pnpm monorepo (apps/* + packages/*)` and a body summarizing the stage-by-stage changes and the verification matrix.

---

## Out-of-scope follow-ups (captured for later specs)

- Payment integration (Stripe) in `apps/website/src/payment/`.
- License-account system in `apps/website/src/license/` + desktop auth in `apps/app/src/auth/`.
- Release/auto-update server in `apps/website/src/releases/`.
- CI workflow (build both apps, build Tauri, run Docker build).
- Adding Turborepo if the package graph grows.
- Replacing the canvas `/` URL with `/app` if muscle-memory from the old debug URL becomes a pain point.
- Adding an `apps/app` Docker image if a web-deployable canvas is needed for demos.
