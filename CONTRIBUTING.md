# Contributing to Netra Limbus

Thanks for your interest. Netra Limbus is a small project moving fast, so this guide is short on purpose: get you to your first useful PR without ceremony.

## Before you start

- Read `README.md` for what Netra Limbus is and how to run it.
- Read `CLAUDE.md` for the React and TypeScript conventions used everywhere in this repo. PRs are reviewed against those rules.
- Open or comment on a Discord thread for anything non-trivial. We'd rather align on direction before you write code than ask you to rework it after.

## Set up your environment

```bash
nvm use              # Node 20+, pinned via .nvmrc
corepack enable      # gives you pnpm 9
pnpm install
cp .env.example .env
```

For the desktop app, install the Rust toolchain following [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/).

## Run the app

```bash
pnpm db:start        # start PocketBase locally
pnpm db:migrate      # apply migrations
pnpm db:superuser    # create an admin login (one-time)
pnpm dev:app         # web canvas on :5174
pnpm tauri:dev       # desktop app (preferred for anything touching the canvas)
```

Web debug and desktop don't always behave identically. If your change touches rendering, the design system, or anything Tauri-specific, verify in `tauri:dev` before opening a PR.

## Repo layout

```
apps/app/             # the canvas (Tauri desktop + web debug build)
packages/             # design system, shared tsconfig
pb/pb_migrations/     # PocketBase migrations
scripts/              # dev helpers (PB, staging, releases)
docker/               # self-hosted web stack
```

A feature folder is a black box. Other features import only from its `index.ts`. If two features need the same thing, it graduates to `packages/` or a top-level `lib/`. See `CLAUDE.md` for the full project-structure rules.

## Picking something to work on

- The roadmap (image annotation, text annotation, fine-tuning, deployment, observation) lives in `README.md`. Anything tagged "in progress" is a good place to look for adjacent work.
- Bug reports and small improvements are always welcome — no thread required.
- For larger changes, post in Discord first so we can flag conflicts with in-flight work.

## Coding standards

We follow the rules in `CLAUDE.md`. The short version:

- **TypeScript strict mode**, no `any`, no `React.FC`. Type props directly.
- **Function declarations** for top-level components. Arrow functions for inline subcomponents only.
- **Colocate** code with the feature that owns it. Shared folders are for things used in three or more places.
- **State hierarchy:** URL → local → lifted → context → server-cache library → global store, in that order.
- **Server data** never lives in `useState`. Use TanStack Query.
- **Semantic HTML and keyboard access** are not optional. A `<button>` is a button.
- **No commented-out code**, no `console.log` in committed code, no barrel files at deep levels.
- **Components fit on one screen** (~150 lines). If longer, extract.

When in doubt, ask: "Would Cal.com or Excalidraw merge this?" If you're unsure, simplify.

## Database changes

Migrations live in `pb/pb_migrations/` and run forward-only in production. Conventions:

- File name is `<unix-timestamp>_<short_description>.js`.
- Both `up` and `down` are required, even if `down` is destructive. The down path keeps local development reversible.
- Use `collection.fields.removeById(id)` / `removeByName(name)` to drop fields. There is no `remove`.
- Backfill data **before** flipping a column to `required: true`.
- After writing a migration, run `pnpm db:migrate` against a clean DB to verify the up path applies cleanly.

## Before opening a PR

Run these locally — CI runs them too, but it's faster to fix things at home:

```bash
pnpm install         # in case lockfile or workspace deps changed
pnpm typecheck
pnpm lint
pnpm format:check
```

If you touched the canvas, exercise the affected interaction in `pnpm tauri:dev`. Type checking and tests verify code correctness, not feature correctness.

## PR hygiene

- **One concern per PR.** Refactors and features ship separately.
- **Keep diffs under ~400 lines** when you can. Big PRs slow review for everyone.
- **Conventional commits:** `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`. Scope is optional but helpful (`fix(canvas): ...`).
- **PR description explains the why.** The diff shows the what.
- **Link the Discord thread** if the change is non-obvious or came out of a discussion.
- **No force-push to shared branches.** Add commits; we squash on merge.

## License

Netra Limbus is proprietary. By contributing, you agree that your contributions are licensed under the same terms. Contact the maintainers if you have questions about usage.
