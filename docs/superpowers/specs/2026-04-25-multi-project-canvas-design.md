# Multi-Project Canvas — Design

**Status:** Draft · **Date:** 2026-04-25 · **Owner:** Rifky

## Summary

NetraRT today launches into a single canvas backed by one shared PocketBase
store. This design adds **projects** as the top-level organizing unit. Users
land on a **Home window** that lists projects, and each project opens in its
**own Tauri window**. Existing canvas state is preserved by migrating into a
single "Default" project on first launch.

The system is local-only (no cloud, no sharing) and additive: existing canvas
behavior is unchanged once a project is open. Only the surfaces above the
canvas — windowing, project picker, per-project scoping of media and saved
tags — are new.

## Goals

- Multiple independent canvases, each with its own media and labeling
  vocabulary, addressable from a Home picker.
- Multi-window: each open project is its own Tauri window; Home is a
  persistent main window.
- Per-project saved tags (the labeling vocabulary). Theme and SAM3 settings
  stay global.
- Home page surfaces project identity (name, icon, color, labels, thumbnail,
  recency, item count) with search, sort, and label filter.
- Migration backfills today's data into a single "Default Project" with no
  user-facing decisions on first launch.

## Non-goals

- Cloud sync, multi-user, or sharing. Pure local organization.
- Single-file project export/import. The data model leaves the door open but
  this is not v1.
- Templates, project duplication, or annotation-format import on creation.
  New project = empty canvas, name only.
- Tabs or inline project switching. One canvas window per project.
- Workspace nesting / folders for projects.

## Decisions

These were resolved during brainstorming:

| # | Decision | Rationale |
|---|---|---|
| 1 | Pure local organization | Matches NetraRT's "no frames leaving your hardware" pitch |
| 2 | Single PB; `projects` collection; every record carries a `project` FK with cascade delete | One DB, one PB instance, easy to query; mirrors how `segmentations` cascade from `images` today |
| 3 | Multi-window (one Tauri window per open project) | Matches creative-tool desktop apps (Figma, Sketch); web build falls back to router |
| 4 | Home is the persistent main window | App always has a "somewhere" to return to; Cmd+Q quits |
| 5 | Theme + SAM3 settings global; saved tags per-project | Tags are project content (the labeling vocabulary); theme/SAM3 are user preferences |
| 6 | Rich project metadata (name, color, icon, labels, thumbnail) + search/sort/filter on Home | User chose richest option; `description` was later removed |
| 7 | New project = name only; empty canvas opens | Smallest creation surface; bulk import is already a canvas feature |
| 8 | Project name + icon + management menu surfaced inside the canvas via a `ProjectChip` | User asked for project identity to be visible on the canvas page itself, not only in the OS window title |

## Architecture

### Window model

Two window kinds, one Tauri process:

- **Home window** (Tauri label `home`). Long-lived, opens at app launch.
  Renders the project picker. Owns project CRUD.
- **Canvas windows** (Tauri label `canvas:<projectId>`). Spawned on demand.
  URL carries `?project=<id>`. Opening an already-open project focuses the
  existing window via Tauri label lookup; no duplicates.

### Process model

- Single Tauri process; single embedded PocketBase; single SAM3 Rust backend.
  `sam3_warmup` runs once per app session, shared across all windows.
- Each window is its own WebView with its own React tree, PB JS client, LOD
  decode caches, and undo history. No cross-window state sync beyond PB
  realtime on the `projects` collection.

### Routing

- **Tauri build:** `index.html` (no query) → Home; `index.html?project=<id>`
  → Canvas. `main.tsx` reads `window.location.search` and mounts either
  `<Home />` or `<App projectId={id} />`. No router library — one branch.
- **Web debug build (`pnpm dev:app`):** same query param convention. No
  multi-window — "open project" mutates `window.location` (full reload, fine
  for debug). Single-window fallback documented in the README.

### Lifecycle

1. App launch → spawn Home window.
2. User picks/creates project on Home → `openCanvasWindow(projectId)`.
3. Canvas window's `tauri://close-requested` handler runs the thumbnail
   snapshot capture, then lets the window close. `last_opened_at` is not
   updated here — it is set when the project is opened (step 2).
4. Closing Home does not auto-quit canvas windows. The user is shown a
   confirm if any canvases are still open. Cmd+Q quits everything.

## Data model

### New collection: `projects`

```
projects
  id              (PB auto)
  name            text, required, max 256
  color           text, required          // accent color token, e.g. "blue", "amber"
  icon            text, required          // remixicon name, e.g. "ri-folder-3-line"
  labels          json, default []        // string[] — project-level categorization
  thumbnail       file, optional, maxSize ~500KB, image/webp
  last_opened_at  date, optional
  created         autodate
  updated         autodate (onCreate + onUpdate)

  indexes:
    CREATE INDEX idx_projects_last_opened ON projects (last_opened_at DESC)
    CREATE INDEX idx_projects_name_lower  ON projects (LOWER(name))
```

Note: `description` was deliberately omitted.

### Existing collections gain `project`

`images`, `videos`, and `segmentations` each gain:

```
project  relation -> projects, required, maxSelect 1, cascadeDelete: true
```

Plus per-project active-record indexes:

```
CREATE INDEX idx_images_project_active ON images (project, created)
   WHERE deleted_at IS NULL OR deleted_at = '';
CREATE INDEX idx_videos_project_active  ON videos  (project, created)
   WHERE deleted_at IS NULL OR deleted_at = '';
CREATE INDEX idx_seg_project ON segmentations (project);
```

The existing `ACTIVE_FILTER` constant in `lib/pb.ts` becomes a project-scoped
variant: `project="<id>" && (deleted_at = null || deleted_at = "")`.

### New collection: `tags` (per-project saved tags)

Replaces the `localStorage` store in `apps/app/src/components/savedTags.ts`.

```
tags
  id        (PB auto)
  project   relation -> projects, required, cascadeDelete: true
  name      text, required, max 256
  color     text, required
  created   autodate
  updated   autodate

  indexes:
    CREATE UNIQUE INDEX idx_tags_project_name_lower ON tags (project, LOWER(name))
    CREATE INDEX idx_tags_project ON tags (project)
```

### Migration of existing data

A single migration:

1. Creates the `projects`, `tags` collections.
2. Adds the `project` relation on `images`, `videos`, `segmentations`
   (initially nullable to allow backfill).
3. Inserts a single **"Default Project"** row (random color, generic folder
   icon, empty labels).
4. Backfills `project` on every existing row to the Default Project's id.
5. Alters `project` to `required: true` on the three collections.
6. Adds the per-project indexes.

Saved tags from `localStorage` are migrated lazily client-side: on first
launch, if a non-empty legacy `localStorage` tag store is detected and the
active project has zero `tags` rows, import them, then clear the legacy key.
If any insert fails, leave the legacy key in place and retry next launch.

### What is NOT project-scoped

- Theme and SAM3 settings (`localStorage`-keyed app-wide). Untouched.
- Undo/redo history (in-memory per canvas window). Untouched.

## UI surfaces

### Home window

Mounted by `main.tsx` when there is no `?project=` in the URL.

**Layout (top to bottom):**

1. **Header bar.** App name/logo on the left. Right: search input (filters
   by name and label substring), sort dropdown
   (Recently opened / Name / Created), primary "New project" button.
2. **Label filter row.** Visible only if any project has labels. Multi-select
   chip row; "Clear all" chip when filters are active.
3. **Project grid.** Responsive grid of cards. Empty state shows a friendly
   illustration + "Create your first project" CTA.

**Project card:**

```
┌───────────────────────────────┐
│ [thumbnail or color+icon bg]  │   ← 16:9, falls back to color block w/ icon when no thumb yet
│                               │
├───────────────────────────────┤
│ [icon]  Project name          │
│ #label1 #label2               │
│ 128 images · opened 2h ago    │
└───────────────────────────────┘
```

- Hover: subtle lift. Right-click (or `⋯` button on hover) menu: **Open**,
  **Rename**, **Edit details…**, **Delete…**. (Duplicate is deferred.)
- Click anywhere on card → `openCanvasWindow(id)` and update `last_opened_at`.

**New project modal:** single name field, autofocus, Enter submits.
Color/icon defaulted (random color from a 6-color palette, generic folder
icon). Everything else is editable later via "Edit details…".

**Edit details modal:** name, color picker (palette of 6–8 design-system
tokens), icon picker (curated subset of remixicon, ~24 icons), labels (chip
input with autocomplete from labels existing across all projects).

**Delete confirm modal:** names the project, shows item count
("128 images, 14 videos, 312 segmentations"). Requires typing the project
name to confirm — cheap protection against accidental cascade delete.

### Canvas window

The existing `<Canvas />` is unchanged in behavior, with two additions:

1. **OS window title** = project name. Set via Tauri `set_title`. Updates
   live if the user renames the project from Home.
2. **`<ProjectChip />`** anchored top-left (above/beside the existing
   `FloatingSidebar`):

```
┌──────────────────────────────────────────┐
│ [⌂]  [icon]  Project name        [⋯]    │
└──────────────────────────────────────────┘
```

- `[⌂]` Home button — focuses or opens the Home window. Does not close the
  canvas.
- `[icon] Project name` — project's chosen icon + name in the project's
  accent color. Reflects PB realtime updates. Truncates with ellipsis; full
  name in tooltip.
- `[⋯]` overflow menu — **Rename**, **Edit details…**, **Delete project…**.
  Delete confirms (same modal as Home), then closes the canvas window.

No tab bar, no inline project switcher. Switching projects = go to Home,
click another card.

### Web debug fallback

In `pnpm dev:app`, `openCanvasWindow(id)` does
`location.assign('?project=<id>')` and the Home button does
`location.assign('/')`. No multi-window in web; this matches the existing
debug-only divergence (Tauri commands are unavailable in the web build).

## Per-project scoping

### `lib/pb.ts`

Every read/write that touches `images`, `videos`, or `segmentations` takes
`projectId`:

- `listImages`, `listVideos`, `listSegmentations`, `listTrashed` →
  `project="<id>"` filter alongside `ACTIVE_FILTER`.
- `createImage`, `createVideo` → append `project` to the FormData body.
- `upsertSegmentation`, `deleteSegmentationsForImage`,
  `deleteSegmentationByImageTag` → `projectId` scopes the lookup filter.
- Position updates and (hard|soft) delete/restore stay as-is — they target a
  record by `id`, which is already unique.

### Saved tags

`apps/app/src/components/savedTags.ts` is rewritten to back onto the `tags`
PB collection. Public surface (`useSavedTags`, `colorForTag`) is unchanged so
the canvas does not need broad refactors. Internally:

- On canvas mount, fetch all `tags` rows for the active project.
- Mutations are PB writes plus optimistic local update.
- Legacy `localStorage` migration runs once on first launch (see Data model
  section).

### History

In-memory per canvas window. No change. Each canvas window has its own undo
stack.

## File layout

```
apps/app/src/
  main.tsx                     # branches on ?project= → <Home /> or <App projectId={...} />
  App.tsx                      # accepts { projectId } prop, plumbs to <Canvas />
  Canvas.tsx                   # accepts { projectId } prop, plumbs all pb.ts calls

  features/
    projects/                  # NEW — owns Home and ProjectChip
      api/
        projects.ts            # PB CRUD for `projects`
        useProjects.ts         # list + realtime subscription
      components/
        Home.tsx               # top-level home shell
        ProjectGrid.tsx
        ProjectCard.tsx
        ProjectChip.tsx        # rendered inside canvas
        NewProjectModal.tsx
        EditProjectModal.tsx
        DeleteProjectModal.tsx
        LabelFilterRow.tsx
        SortMenu.tsx
        IconPicker.tsx         # curated remixicon subset
        ColorPicker.tsx        # palette of design-system color tokens
      hooks/
        useOpenProject.ts      # spawn/focus Tauri window, web fallback
        useProjectThumbnail.ts # debounced background save + close-time capture
      types/
        project.ts             # Project type, Zod schema
      index.ts                 # public API: <Home />, <ProjectChip />, types
    annotations/               # unchanged
    segmentation/              # unchanged
    lod/                       # unchanged

  lib/
    pb.ts                      # all functions take projectId
    projectId.ts               # NEW — reads ?project= from window.location, throws if missing
    windows.ts                 # NEW — Tauri WebviewWindow helpers (spawn canvas, focus home)

  components/
    savedTags.ts               # rewritten to back onto `tags` PB collection
```

The canvas imports `<ProjectChip />` from `features/projects` via the
feature's `index.ts`. This is a deliberate cross-feature usage allowed
because the chip is a project surface embedded in the canvas; the modals it
opens live with the rest of project management for a single source of truth.

## Tauri window plumbing — `lib/windows.ts`

Thin wrapper over `@tauri-apps/api/webviewWindow`. Public functions:

- `openCanvasWindow(projectId, name)`: look up window with label
  `canvas:<id>`. If exists → focus it. Else create with that label, URL
  `?project=<id>`, initial title set to `name`.
- `focusHome()`: look up label `home`. If exists → focus it. Else create.
- `setCanvasTitle(projectId, name)`: set title on `canvas:<id>` if open.
- `onCanvasCloseRequested(handler)`: registers a `tauri://close-requested`
  listener so the canvas runs its thumbnail snapshot before the window
  closes.

Web build exports the same function names but `openCanvasWindow` does
`location.assign('?project=<id>')` and `focusHome` does
`location.assign('/')`. One shared interface, one runtime conditional
inside (`__TAURI_INTERNALS__` detection, same as `lib/pb.ts` already does).

## Thumbnail capture pipeline

- **Trigger:** canvas window's `tauri://close-requested` handler. Also a
  debounced background save every ~30 s while the canvas is open (cheap
  during normal rendering).
- **Implementation:** rasterize the current canvas viewport to an offscreen
  canvas at ~480×270, encode as WebP at quality 0.7 (target ≤ 200 KB),
  upload to the `projects.thumbnail` file field via PB update.
- **Empty viewport fallback:** if the project has no media in view, skip the
  capture and let the card render its color + icon block.
- **Web build:** no `close-requested` hook available; only the periodic
  background save runs.
- **Failure handling:** swallow + `console.warn` (already routed via the
  `forward` log shim). Do not block window close on thumbnail failure.

## Error handling

| Scenario | Behavior |
|---|---|
| `?project=` missing on canvas URL | `lib/projectId.ts` throws; `App.tsx` catches and renders an error screen with a "Return to Home" button. Should never happen in normal flow. |
| Project deleted while its canvas is open | PB realtime fires; canvas shows a non-dismissable banner ("This project no longer exists"). User clicks "Return to Home"; window closes. |
| Tauri `WebviewWindow.new` fails | `openCanvasWindow` wraps in try/catch; surfaces an inline error in Home with retry. |
| Thumbnail capture fails | Swallow + warn. Best-effort. |
| Saved-tags `localStorage` migration partial-write | All-or-nothing: if any insert fails, log and leave the legacy key in place to retry next launch. |

## Testing

### Unit / pure logic (Vitest)

- `lib/projectId.ts` — parses `?project=` correctly; throws on missing/empty.
- `features/projects/api/projects.ts` — Zod schema accepts/rejects expected
  shapes; CRUD calls hit the right PB endpoints (PB mocked at the network
  boundary).
- Saved-tags rewrite — round-trip create/list/update/delete against a mocked
  PB; legacy-localStorage migration imports once then clears the key; partial
  failure leaves the legacy key intact.
- Thumbnail encoder — pure function `(canvas, w, h, quality) → Blob`; asserts
  WebP magic bytes and size cap.
- Project filter helpers — `ACTIVE_FILTER` composition for project-scoped
  queries.

### Integration

- Render `<Home />` with a mocked PB returning a fixture of three projects
  → grid renders, sort changes order, search narrows results, label filter
  narrows further, "New project" → modal → submit → optimistic card appears.
- Render `<Canvas projectId="…" />` against an empty fixture → no media;
  against a fixture with media → media renders. Asserts `lib/pb.ts` calls
  carry the correct `project="<id>"` filter (no cross-project bleed).
- Web fallback — `openCanvasWindow` mutates `location.search` instead of
  calling Tauri APIs when `__TAURI_INTERNALS__` is absent.

### Manual e2e checklist

Documented in `apps/app/src/features/projects/README.md`:

- Launch → Home opens.
- Create project → canvas window opens with that project's name in title and
  chip.
- Close canvas → Home survives. The project's thumbnail updates to reflect
  the canvas state at close time.
- Reopen same project from Home → existing canvas window focuses; no
  duplicate window.
- Rename project from Home → canvas window title and chip update live.
- Delete project from Home → cascade drops media, segmentations, tags. Any
  open canvas window for that project shows the "no longer exists" banner.
- Quit Home with canvases open → confirm prompt before quit.
- First launch on a pre-existing database → "Default Project" appears with
  all prior media; legacy localStorage tags migrate to the `tags` collection.

## Rollout

The app is desktop-only with no production users on a multi-project schema
yet, so this lands as one cohesive change. Implementation order:

1. **Migrations** — `projects`, `tags` collections; `project` FK on
   `images`/`videos`/`segmentations`; indexes; Default-project backfill.
2. **`lib/pb.ts` refactor** — every function takes `projectId`. Canvas wired
   to a hardcoded "first project" temporarily so it stays runnable during
   the refactor.
3. **`lib/projectId.ts` + `main.tsx` branch** — Canvas now reads project
   from URL.
4. **`lib/windows.ts`** — Tauri spawn/focus helpers + web fallback.
5. **Saved-tags rewrite** — PB-backed, drop-in replacement for
   `useSavedTags`, legacy-localStorage migration.
6. **`features/projects/`** — Home shell, grid, modals, search/sort/filter.
7. **`<ProjectChip />` in canvas + window-title sync.**
8. **Thumbnail capture pipeline.**
9. **Manual e2e walkthrough + cleanup.**

Steps 1–3 are the riskiest (migration touches every existing record).
Steps 4–8 are additive.

## Out of scope (deferred, flagged for future)

- Project duplicate / template / annotation-format import on creation.
- Single-file project export/import.
- Cross-window state sync beyond `projects` realtime.
- Workspaces / nested project folders.
- Cloud sync, multi-user, sharing.
