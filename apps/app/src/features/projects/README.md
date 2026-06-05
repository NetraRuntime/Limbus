# features/projects

Owns Netra Limbus's multi-project surface: the Home window, project CRUD, the in-canvas `<ProjectChip />`, per-project saved tags, and (eventually) the project thumbnail pipeline.

## Public API (via `index.ts`)

- `<Home />` — top-level project picker. Mounted by `main.tsx` when no `?project=` is in the URL.
- `<ProjectChip />` — inline breadcrumb segment composed inside the canvas wordmark pill. Renders the project name; the canvas owns the wordmark home-button and routes Edit/Delete through `<SettingsModal />`.
- `<EditProjectModal />` / `<DeleteProjectModal />` — project mutation modals; canvas mounts these in response to settings actions.
- `ProjectRecord` — the type for a project row.

## Known limitation in v1

`useProjectThumbnail` (in `hooks/useProjectThumbnail.ts`) queries `canvas.lod-layer` to grab the source canvas before downsampling. The current LoD architecture renders `<img>` elements with CSS transforms instead of a backing `<canvas>`, so the selector never matches and capture is a no-op. Project cards therefore use the color + icon block as their visual. A real capture path is a follow-up — likely a screenshot of the world container via `html-to-image` or similar.

## Manual e2e checklist

Run `pnpm tauri:dev`, then walk through:

- [ ] App launches into the Home window. Default Project card is visible.
- [ ] **Create**: Click "New project", type a name, hit Enter. A new canvas window opens with that project's name in the title bar and the chip top-left.
- [ ] **Open existing**: From Home, click the Default Project card. A canvas window opens (or focuses if already open).
- [ ] **No duplicates**: Click the same card twice — only one window exists for that project; the second click focuses the first.
- [ ] **Edit details from Home**: Open card menu → "Edit details…", change color/icon/labels, save. Card reflects the change.
- [ ] **Edit details from canvas**: Open canvas settings → Project section → "Edit details…", change name. Title bar + breadcrumb update without reload.
- [ ] **Delete from Home**: Create a throwaway project, add an image, then delete from Home (type the name to confirm). Cascade drops the image; Default Project's media is unaffected.
- [ ] **Delete from canvas**: Open the throwaway project's canvas, then settings → Project section → "Delete project…". Banner appears in the canvas; window closes; Home reflects the removal.
- [ ] **Saved tags are per-project**: In project A, label an image "cells". In project B, the saved-tag autocomplete should not surface "cells".
- [ ] **Theme stays global**: Toggle theme in one canvas; another canvas reflects it on next paint.
- [ ] **Quit confirm**: With at least one canvas open, attempt to close Home. Confirm prompt appears.
- [ ] **Legacy tags migration** (clean DB with localStorage seeded by an older build):
      Drop `pb_data`, restart, run migrations, then open the Default Project's canvas.
      Legacy `localStorage` saved tags migrate into the project's `tags` collection on
      first canvas open; the legacy key is then cleared. The migration runs once per
      project that has zero existing tags — opening a different empty project later
      will not duplicate them because the localStorage key is gone after first success.
- [ ] **Web fallback**: `pnpm dev:app` opens Home at `/`; clicking a card navigates to `/?project=<id>`; the wordmark home button (`⌂ Netra Limbus`) navigates back to `/`.
