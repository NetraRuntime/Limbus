# NetraRT

**Specialized AI for your agent. Starts with a canvas.**

Netra is a platform for replacing the expensive parts of an agent pipeline with smaller, specialized models that are tuned to the customer's specific workflow. Frontier models are over-qualified, over-priced, and over-slow for the narrow, repetitive steps that make up most production agents. We make it practical to build something better.

NetraRT is the user-facing surface of that platform. It's an infinite-canvas desktop app where you label data, fine-tune models, and watch them get faster and cheaper than the API calls they're replacing. Annotation, training, and evaluation all live on the same canvas, so the path from raw data to a deployed specialized model is one continuous workflow instead of five disconnected tools.

The platform is informed by our work on [**SAM3.c**](https://github.com/rifkybujana/sam3.c) (a pure C port of Segment Anything 3) and [**Kolosal AI**](https://kolosal.ai) (an open-source C++ LLM platform that runs on any GPU). The same obsession with performance and accessibility shows up here: the canvas is local-first, your data stays on your machine, and we care about latency budgets that real teams actually have.

This monorepo hosts the canvas app (Tauri desktop and a web debug build) along with shared design-system and tooling packages. The marketing site lives in its own repo: [netrart.com](https://github.com/rifkybujana/netrart.com).

## What's in the canvas

| Feature | Status |
|---|---|
| Image Annotation | ✅ Live |
| Text Annotation | 🟡 In progress |
| Model Fine-tuning | 🟡 In progress |
| Model Deployment | ⚪ Planned |
| Model Observation | ⚪ Planned |

Image annotation is the production path today. Text annotation and fine-tuning are landing next, in that order, and both are usable in development builds. Deployment and observation come after.

## Who it's for

- **Teams building agents** who are watching their per-query token costs and know that most of their pipeline doesn't need a frontier model.
- **ML engineers** who want a single tool for labeling, training, and evaluating instead of stitching together five.
- **Researchers and students** building task-specific datasets and models without fighting infrastructure.
- **Anyone** who wants annotation and fine-tuning that runs on their own machine, not in someone else's cloud.

## Layout

```
apps/
  app/             # infinite canvas, Tauri desktop + web debug build
packages/
  design-system/   # tokens, CSS kit, self-hosted fonts, brand assets
  tsconfig/        # shared TypeScript base config
pb/                # PocketBase migrations + canonical binary
scripts/           # dev helpers (start PB, stage PB for Tauri, migrations)
docker/            # Dockerfiles + nginx.conf for the web deploy
```

## Prerequisites

- **Node.js 20+** (pinned via `.nvmrc`)
- **pnpm 9** (enable with `corepack enable`)
- **Rust toolchain** (desktop build only). See [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/).
- **Docker** (optional, for the self-hosted web stack)

## Install

```bash
pnpm install
cp .env.example .env
```

## Run the app in the browser (debug)

```bash
pnpm db:start
pnpm dev:app      # Vite on :5174
```

Visit `http://localhost:5174/`. This is a dev-only web build of the canvas. Production is the Tauri desktop app.

## Run the desktop app

```bash
pnpm tauri:dev
```

This stages the PocketBase binary into `apps/app/src-tauri/binaries/`, then launches the Tauri webview pinned to the canvas.

## Build

```bash
pnpm build        # canvas web bundle → apps/app/dist/
pnpm tauri:build  # native installer for the current platform
```

## Self-hosted web stack

```bash
docker compose up -d
```

Serves the canvas web debug build on `:8081` with PocketBase behind nginx. Data persists in the `pb_data` named volume. `docker compose down -v` wipes state.

## Database

Migrations live in `pb/pb_migrations/`. Apply them locally with:

```bash
pnpm db:migrate
pnpm db:superuser  # create an admin account
```

The SQLite DB, uploaded files, and generated types sit under `pb/pb_data/` (gitignored).

## Contributing

Small team, fast cadence. Before opening a PR:

- Run `pnpm install` after pulling, in case lockfile or workspace deps changed.
- Keep changes scoped. One concern per PR makes review faster for everyone.
- If you're touching the design system, double-check that the Tauri build still renders correctly. Web debug and desktop don't always behave identically.
- Todos and discussion live on Discord. If a change is non-obvious, link the thread in your PR description.

## License

Licensed under the [Apache License, Version 2.0](LICENSE). Third-party
attributions are listed in [NOTICE](NOTICE).