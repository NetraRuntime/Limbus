# Multi-Project Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add projects as the top-level organizing unit. Add a persistent Home window that lists projects; open each project in its own Tauri window with project-scoped media and saved tags. Migrate today's data into a single Default Project.

**Architecture:** One PocketBase, one new `projects` collection that owns `images` / `videos` / `segmentations` / `tags` via cascade-delete relations. Window URL carries `?project=<id>`; `main.tsx` branches on it to mount `<Home />` or `<Canvas projectId={…} />`. Tauri windowing helpers live in a thin `lib/windows.ts` with a web fallback that mutates `location` instead. Saved tags move from `localStorage` to a per-project `tags` PB collection with a one-time legacy migration.

**Tech Stack:** React 18, TypeScript strict, Vite, Vitest (node + jsdom workspaces), Tauri 2 (`@tauri-apps/api/webviewWindow`), PocketBase 0.26 + JS migrations, Zod, Remixicon (already loaded), the `@netrart/design-system` color tokens.

**Spec:** [`docs/superpowers/specs/2026-04-25-multi-project-canvas-design.md`](../specs/2026-04-25-multi-project-canvas-design.md)

---

## File map

**Created**
- `pb/pb_migrations/1777400000_init_projects.js`
- `pb/pb_migrations/1777400100_add_project_fk.js`
- `pb/pb_migrations/1777400200_init_tags.js`
- `pb/pb_migrations/1777400300_project_active_indexes.js`
- `apps/app/src/lib/projectId.ts` + `projectId.test.ts`
- `apps/app/src/lib/windows.ts` + `windows.test.ts`
- `apps/app/src/features/projects/types/project.ts`
- `apps/app/src/features/projects/api/projects.ts` + `projects.test.ts`
- `apps/app/src/features/projects/api/useProjects.ts`
- `apps/app/src/features/projects/api/tags.ts` + `tags.test.ts`
- `apps/app/src/features/projects/components/Home.tsx`
- `apps/app/src/features/projects/components/ProjectGrid.tsx`
- `apps/app/src/features/projects/components/ProjectCard.tsx`
- `apps/app/src/features/projects/components/NewProjectModal.tsx`
- `apps/app/src/features/projects/components/EditProjectModal.tsx`
- `apps/app/src/features/projects/components/DeleteProjectModal.tsx`
- `apps/app/src/features/projects/components/IconPicker.tsx`
- `apps/app/src/features/projects/components/ColorPicker.tsx`
- `apps/app/src/features/projects/components/LabelFilterRow.tsx`
- `apps/app/src/features/projects/components/SortMenu.tsx`
- `apps/app/src/features/projects/components/ProjectChip.tsx`
- `apps/app/src/features/projects/components/DeletedBanner.tsx`
- `apps/app/src/features/projects/hooks/useOpenProject.ts`
- `apps/app/src/features/projects/hooks/useProjectThumbnail.ts`
- `apps/app/src/features/projects/lib/captureThumbnail.ts` + `captureThumbnail.test.ts`
- `apps/app/src/features/projects/lib/legacyTagsMigration.ts` + `legacyTagsMigration.test.ts`
- `apps/app/src/features/projects/index.ts` (public API)
- `apps/app/src/features/projects/Home.css`
- `apps/app/src/features/projects/README.md` (manual e2e checklist)

**Modified**
- `apps/app/src/main.tsx` — branch on `?project=` query
- `apps/app/src/App.tsx` — accept `projectId` prop, plumb to Canvas
- `apps/app/src/Canvas.tsx` — accept `projectId` prop, thread to all `lib/pb.ts` calls, render `<ProjectChip />`, mount `useProjectThumbnail`
- `apps/app/src/lib/pb.ts` — schemas gain `project`; list/create/seg fns take `projectId`
- `apps/app/src/components/savedTags.ts` — drop-in PB-backed rewrite of `useSavedTags`
- `apps/app/src-tauri/capabilities/default.json` — allow window create/manage; widen `windows` to wildcard
- `apps/app/src-tauri/tauri.conf.json` — set `app.windows[0].label = "home"`

**Removed**
- Nothing. Legacy `localStorage` saved-tags key is read once during migration then cleared.

---

## Phase 1 — Schema migrations

### Task 1: Migration — `projects` collection + Default Project seed

**Files:**
- Create: `pb/pb_migrations/1777400000_init_projects.js`

Seeds a single Default Project so the next migration can backfill against it. The down-migration deletes all rows then drops the collection.

- [ ] **Step 1: Write the migration**

```js
/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const collection = new Collection({
      type: 'base',
      name: 'projects',
      fields: [
        { name: 'name', type: 'text', required: true, max: 256 },
        { name: 'color', type: 'text', required: true, max: 32 },
        { name: 'icon', type: 'text', required: true, max: 64 },
        { name: 'labels', type: 'json', required: false },
        {
          name: 'thumbnail',
          type: 'file',
          required: false,
          maxSelect: 1,
          maxSize: 500 * 1024,
          mimeTypes: ['image/webp', 'image/png', 'image/jpeg'],
        },
        { name: 'last_opened_at', type: 'date' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      indexes: [
        'CREATE INDEX idx_projects_last_opened ON projects (last_opened_at)',
        'CREATE INDEX idx_projects_name_lower ON projects (LOWER(name))',
      ],
    });
    app.save(collection);

    // Seed Default Project. The next migration backfills existing media to it.
    const fresh = app.findCollectionByNameOrId('projects');
    const record = new Record(fresh, {
      name: 'Default Project',
      color: 'slate',
      icon: 'ri-folder-3-line',
      labels: [],
    });
    app.save(record);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('projects');
    return app.delete(collection);
  },
);
```

- [ ] **Step 2: Apply migrations**

Run: `pnpm db:migrate`
Expected: `Applied 1777400000_init_projects.js` in output. PocketBase admin UI should now list a `projects` collection with one row "Default Project".

- [ ] **Step 3: Sanity-check the seed**

Run:
```bash
curl -s 'http://127.0.0.1:8090/api/collections/projects/records' | jq '.items[0] | {name, color, icon}'
```
Expected: `{ "name": "Default Project", "color": "slate", "icon": "ri-folder-3-line" }`

- [ ] **Step 4: Commit**

```bash
git add pb/pb_migrations/1777400000_init_projects.js
git commit -m "feat(pb): add projects collection with Default Project seed"
```

---

### Task 2: Migration — add `project` FK on `images`, `videos`, `segmentations`

**Files:**
- Create: `pb/pb_migrations/1777400100_add_project_fk.js`

Three steps inside one migration: (a) add nullable FK; (b) backfill every existing row to the Default Project; (c) mark FK required + cascade delete.

- [ ] **Step 1: Write the migration**

```js
/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const projects = app.findCollectionByNameOrId('projects');
    // Default Project was seeded in 1777400000; find it by name.
    const def = app.findFirstRecordByFilter('projects', `name = "Default Project"`);
    if (!def) throw new Error('Default Project missing — 1777400000 must run first');

    for (const name of ['images', 'videos', 'segmentations']) {
      const collection = app.findCollectionByNameOrId(name);
      collection.fields.add(
        new Field({
          name: 'project',
          type: 'relation',
          required: false,
          maxSelect: 1,
          collectionId: projects.id,
          cascadeDelete: true,
        }),
      );
      app.save(collection);

      const rows = app.findAllRecords(name);
      for (const row of rows) {
        row.set('project', def.id);
        app.save(row);
      }

      const refreshed = app.findCollectionByNameOrId(name);
      const field = refreshed.fields.getByName('project');
      field.required = true;
      app.save(refreshed);
    }
  },
  (app) => {
    for (const name of ['images', 'videos', 'segmentations']) {
      const collection = app.findCollectionByNameOrId(name);
      const field = collection.fields.getByName('project');
      if (field) collection.fields.remove(field.id);
      app.save(collection);
    }
  },
);
```

- [ ] **Step 2: Apply migrations**

Run: `pnpm db:migrate`
Expected: `Applied 1777400100_add_project_fk.js`. No errors.

- [ ] **Step 3: Verify backfill**

Run:
```bash
curl -s 'http://127.0.0.1:8090/api/collections/images/records?perPage=1' | jq '.items[0] | {id, project}'
```
Expected: `project` is a non-empty PB id (the Default Project's id). Repeat for `videos` and `segmentations`.

- [ ] **Step 4: Commit**

```bash
git add pb/pb_migrations/1777400100_add_project_fk.js
git commit -m "feat(pb): add project FK to images/videos/segmentations + backfill"
```

---

### Task 3: Migration — `tags` collection

**Files:**
- Create: `pb/pb_migrations/1777400200_init_tags.js`

- [ ] **Step 1: Write the migration**

```js
/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const projects = app.findCollectionByNameOrId('projects');
    const collection = new Collection({
      type: 'base',
      name: 'tags',
      fields: [
        {
          name: 'project',
          type: 'relation',
          required: true,
          maxSelect: 1,
          collectionId: projects.id,
          cascadeDelete: true,
        },
        { name: 'name', type: 'text', required: true, max: 256 },
        { name: 'color', type: 'text', required: true, max: 32 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      indexes: [
        'CREATE UNIQUE INDEX idx_tags_project_name_lower ON tags (project, LOWER(name))',
        'CREATE INDEX idx_tags_project ON tags (project)',
      ],
    });
    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('tags');
    return app.delete(collection);
  },
);
```

- [ ] **Step 2: Apply migrations**

Run: `pnpm db:migrate`
Expected: `Applied 1777400200_init_tags.js`.

- [ ] **Step 3: Commit**

```bash
git add pb/pb_migrations/1777400200_init_tags.js
git commit -m "feat(pb): add per-project tags collection"
```

---

### Task 4: Migration — per-project active indexes

**Files:**
- Create: `pb/pb_migrations/1777400300_project_active_indexes.js`

Adds composite indexes used by the project-scoped `ACTIVE_FILTER` queries. Drops the older `idx_images_created` / `idx_videos_created` (replaced by the new ones).

- [ ] **Step 1: Write the migration**

```js
/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const update = (name, indexes) => {
      const collection = app.findCollectionByNameOrId(name);
      collection.indexes = indexes;
      app.save(collection);
    };
    update('images', [
      "CREATE INDEX idx_images_project_active ON images (project, created) WHERE deleted_at IS NULL OR deleted_at = ''",
    ]);
    update('videos', [
      "CREATE INDEX idx_videos_project_active ON videos (project, created) WHERE deleted_at IS NULL OR deleted_at = ''",
    ]);
    update('segmentations', [
      'CREATE UNIQUE INDEX idx_seg_image_tag_lower ON segmentations (image, LOWER(tag))',
      'CREATE INDEX idx_seg_image ON segmentations (image)',
      'CREATE INDEX idx_seg_project ON segmentations (project)',
    ]);
  },
  (app) => {
    const update = (name, indexes) => {
      const collection = app.findCollectionByNameOrId(name);
      collection.indexes = indexes;
      app.save(collection);
    };
    update('images', ['CREATE INDEX idx_images_created ON images (created)']);
    update('videos', ['CREATE INDEX idx_videos_created ON videos (created)']);
    update('segmentations', [
      'CREATE UNIQUE INDEX idx_seg_image_tag_lower ON segmentations (image, LOWER(tag))',
      'CREATE INDEX idx_seg_image ON segmentations (image)',
    ]);
  },
);
```

- [ ] **Step 2: Apply migrations**

Run: `pnpm db:migrate`
Expected: `Applied 1777400300_project_active_indexes.js`.

- [ ] **Step 3: Commit**

```bash
git add pb/pb_migrations/1777400300_project_active_indexes.js
git commit -m "feat(pb): per-project active indexes for images/videos/segmentations"
```

---

## Phase 2 — Project ID + `lib/pb.ts` refactor

### Task 5: `lib/projectId.ts` — read `?project=` from URL

**Files:**
- Create: `apps/app/src/lib/projectId.ts`
- Test: `apps/app/src/lib/projectId.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/app/src/lib/projectId.test.ts
import { describe, it, expect } from 'vitest';
import { parseProjectId, ProjectIdMissingError } from './projectId';

describe('parseProjectId', () => {
  it('returns the project id when ?project= is present', () => {
    expect(parseProjectId('?project=abc123')).toBe('abc123');
  });

  it('returns null when query is empty', () => {
    expect(parseProjectId('')).toBeNull();
  });

  it('returns null when ?project= key is absent', () => {
    expect(parseProjectId('?other=foo')).toBeNull();
  });

  it('throws ProjectIdMissingError on whitespace-only id', () => {
    expect(() => parseProjectId('?project=%20%20')).toThrow(ProjectIdMissingError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netrart/app test src/lib/projectId`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```ts
// apps/app/src/lib/projectId.ts
export class ProjectIdMissingError extends Error {
  override name = 'ProjectIdMissingError';
}

export function parseProjectId(search: string): string | null {
  if (!search) return null;
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const raw = params.get('project');
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!trimmed) throw new ProjectIdMissingError('?project= present but empty');
  return trimmed;
}

export function readProjectIdFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  return parseProjectId(window.location.search);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @netrart/app test src/lib/projectId`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/projectId.ts apps/app/src/lib/projectId.test.ts
git commit -m "feat(app): parseProjectId helper"
```

---

### Task 6: Add `project` to PB schemas + `ACTIVE_FILTER`

**Files:**
- Modify: `apps/app/src/lib/pb.ts`

Schemas gain the relation. `ACTIVE_FILTER` becomes a project-scoped function. List + create + segmentation functions take `projectId`. Position updates are unchanged (id-targeted).

- [ ] **Step 1: Update schemas + filter**

In `apps/app/src/lib/pb.ts`, replace `PlacementRecordSchema` and `SegmentationRecordSchema` with versions that include `project`, and replace the `ACTIVE_FILTER` constant with a function:

```ts
const PlacementRecordSchema = z.object({
  id: z.string(),
  collectionId: z.string(),
  project: z.string(),
  file: z.string(),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  deleted_at: z.string().nullable().optional(),
});

const SegmentationRecordSchema = z.object({
  id: z.string(),
  collectionId: z.string(),
  project: z.string(),
  image: z.string(),
  tag: z.string(),
  masks: z.array(SegMaskSchema),
  source_width: z.number(),
  source_height: z.number(),
});

// Compose project scope + soft-delete filter. Works against pre-existing rows
// (deleted_at = "") and rows that restoreX cleared (deleted_at = null).
const activeFilter = (projectId: string): string =>
  `project="${projectId}" && (deleted_at = null || deleted_at = "")`;
```

- [ ] **Step 2: Update list functions**

```ts
export const listImages = async (projectId: string): Promise<ImageRecord[]> => {
  const raw = await pb
    .collection('images')
    .getFullList({ sort: 'created', filter: activeFilter(projectId) });
  return parseList(PlacementRecordSchema, raw);
};

export const listVideos = async (projectId: string): Promise<VideoRecord[]> => {
  const raw = await pb
    .collection('videos')
    .getFullList({ sort: 'created', filter: activeFilter(projectId) });
  return parseList(PlacementRecordSchema, raw);
};

export const listSegmentations = async (
  projectId: string,
): Promise<SegmentationRecord[]> => {
  const raw = await pb
    .collection('segmentations')
    .getFullList({ sort: 'created', filter: `project="${projectId}"` });
  return parseList(SegmentationRecordSchema, raw);
};

export const listTrashed = async (
  projectId: string,
  opts: { olderThanMs: number },
): Promise<{ images: ImageRecord[]; videos: VideoRecord[] }> => {
  const cutoff = new Date(Date.now() - opts.olderThanMs).toISOString();
  const filter = `project="${projectId}" && deleted_at != null && deleted_at != "" && deleted_at < "${cutoff}"`;
  const [imgs, vids] = await Promise.all([
    pb.collection('images').getFullList({ filter }),
    pb.collection('videos').getFullList({ filter }),
  ]);
  return {
    images: parseList(PlacementRecordSchema, imgs),
    videos: parseList(PlacementRecordSchema, vids),
  };
};
```

- [ ] **Step 3: Update create + segmentation functions**

`buildMediaForm` appends `project`. `upsertSegmentation` and the two segmentation deletes scope by project. Replace each function's signature:

```ts
const buildMediaForm = (
  file: File,
  meta: { x: number; y: number; width: number; height: number; name: string; project: string },
): FormData => {
  const form = new FormData();
  form.append('file', file);
  form.append('name', meta.name);
  form.append('project', meta.project);
  form.append('x', String(meta.x));
  form.append('y', String(meta.y));
  form.append('width', String(meta.width));
  form.append('height', String(meta.height));
  return form;
};
```

```ts
export const createImage = async (
  projectId: string,
  file: File,
  meta: { x: number; y: number; width: number; height: number; name: string },
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<ImageRecord> => {
  const raw = await uploadWithProgress(
    'images',
    file,
    { ...meta, project: projectId },
    onProgress,
    signal,
  );
  return PlacementRecordSchema.parse(raw);
};

export const createVideo = async (
  projectId: string,
  file: File,
  meta: { x: number; y: number; width: number; height: number; name: string },
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<VideoRecord> => {
  const raw = await uploadWithProgress(
    'videos',
    file,
    { ...meta, project: projectId },
    onProgress,
    signal,
  );
  return PlacementRecordSchema.parse(raw);
};
```

`uploadWithProgress`'s `meta` type widens to include `project: string`.

```ts
export const upsertSegmentation = async (
  projectId: string,
  input: {
    image: string;
    tag: string;
    masks: SegMask[];
    source_width: number;
    source_height: number;
  },
): Promise<SegmentationRecord> => {
  const raw = await pb
    .collection('segmentations')
    .getFullList({ filter: `project="${projectId}" && image="${input.image}"` });
  const existing = parseList(SegmentationRecordSchema, raw);
  const match = findSegByTag(existing, input.tag);
  const payload = { ...input, project: projectId };
  const record = match
    ? await pb.collection('segmentations').update(match.id, payload)
    : await pb.collection('segmentations').create(payload);
  return SegmentationRecordSchema.parse(record);
};

export const deleteSegmentationsForImage = async (
  projectId: string,
  imageId: string,
  tagsToKeep: readonly string[],
): Promise<void> => {
  const raw = await pb
    .collection('segmentations')
    .getFullList({ filter: `project="${projectId}" && image="${imageId}"` });
  const existing = parseList(SegmentationRecordSchema, raw);
  const ids = segIdsToPrune(existing, tagsToKeep);
  await Promise.all(ids.map((id) => pb.collection('segmentations').delete(id)));
};

export const deleteAllSegmentationsForImage = (
  projectId: string,
  imageId: string,
): Promise<void> => deleteSegmentationsForImage(projectId, imageId, []);

export const deleteSegmentationByImageTag = async (
  projectId: string,
  imageId: string,
  tag: string,
): Promise<void> => {
  const raw = await pb
    .collection('segmentations')
    .getFullList({ filter: `project="${projectId}" && image="${imageId}"` });
  const existing = parseList(SegmentationRecordSchema, raw);
  const match = findSegByTag(existing, tag);
  if (!match) return;
  await pb.collection('segmentations').delete(match.id);
};
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter @netrart/app typecheck`
Expected: Many errors in `Canvas.tsx` ("Argument of type 'X' is not assignable to parameter of type 'string'") because Canvas hasn't been updated yet. Migration of those callers is Task 7. Commit `pb.ts` alone — Canvas will be fixed in the next task.

- [ ] **Step 5: Run pb.ts-only tests**

Run: `pnpm --filter @netrart/app test src/lib/pb`
Expected: PASS (no `pb.test.ts` exists; this just confirms vitest runs cleanly).

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/lib/pb.ts
git commit -m "refactor(pb): scope queries by projectId; add project to schemas"
```

---

### Task 7: Update `Canvas.tsx` call sites to pass `projectId`

**Files:**
- Modify: `apps/app/src/Canvas.tsx`
- Modify: `apps/app/src/App.tsx`

Add `projectId` to the Canvas props, thread it through every `pb.ts` call site. Also update the segmentation feature module call sites (`upsertSegmentation`, `deleteSegmentationByImageTag` are imported and called by `Canvas.tsx`, plus from `features/segmentation/deleteMaskEntry.ts` and `resizeBboxEntry.ts`).

- [ ] **Step 1: Inspect segmentation call sites**

Run: `grep -n "upsertSegmentation\|deleteSegmentationByImageTag\|deleteSegmentationsForImage\|deleteAllSegmentationsForImage\|listImages\|listVideos\|listSegmentations\|listTrashed\|createImage\|createVideo" apps/app/src/Canvas.tsx apps/app/src/features/segmentation/*.ts`

Note each site; you'll add `projectId` as the new first argument. Both `deleteMaskEntry.ts` and `resizeBboxEntry.ts` already accept structured args — extend their input types to include `projectId`.

- [ ] **Step 2: Update `Canvas.tsx` props**

```ts
type CanvasProps = {
  projectId: string;
  sam3Error?: string | null;
};

export function Canvas({ projectId, sam3Error = null }: CanvasProps) {
  // ... existing body, but every list/create/segmentation call now passes projectId
}
```

Then mechanically update each call:
- `listImages()` → `listImages(projectId)`
- `listVideos()` → `listVideos(projectId)`
- `listSegmentations()` → `listSegmentations(projectId)`
- `listTrashed({ olderThanMs })` → `listTrashed(projectId, { olderThanMs })`
- `createImage(file, meta, …)` → `createImage(projectId, file, meta, …)`
- `createVideo(file, meta, …)` → `createVideo(projectId, file, meta, …)`
- `upsertSegmentation({ … })` → `upsertSegmentation(projectId, { … })`
- `deleteSegmentationByImageTag(imageId, tag)` → `deleteSegmentationByImageTag(projectId, imageId, tag)`
- `deleteSegmentationsForImage(imageId, keep)` → `deleteSegmentationsForImage(projectId, imageId, keep)`
- `deleteAllSegmentationsForImage(imageId)` → `deleteAllSegmentationsForImage(projectId, imageId)`

- [ ] **Step 3: Update `deleteMaskEntry.ts` + `resizeBboxEntry.ts`**

Add `projectId` to the args type and forward to the PB call:

```ts
// features/segmentation/deleteMaskEntry.ts
export type DeleteMaskEntryArgs = {
  projectId: string;
  // existing fields...
};
// inside the function:
await deleteSegmentationByImageTag(args.projectId, args.imageId, args.tag);
// or upsertSegmentation(args.projectId, { ... })
```

Same shape for `resizeBboxEntry.ts`. Update their tests' `vi.mock` arguments if needed.

- [ ] **Step 4: Update `App.tsx`**

```tsx
type AppProps = {
  projectId: string;
};

export function App({ projectId }: AppProps) {
  const [boot, setBoot] = useState<BootState>({ status: 'loading' });
  const { settings } = useSettings();
  useAppliedTheme(settings.theme);

  useEffect(() => {
    document.body.classList.add('is-canvas');
    return () => document.body.classList.remove('is-canvas');
  }, []);

  useEffect(() => {
    let cancelled = false;
    invoke<void>('sam3_warmup')
      .then(() => {
        if (!cancelled) setBoot({ status: 'ready' });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[sam3] warmup failed', err);
        setBoot({ status: 'error', message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (boot.status === 'loading') return <BootScreen />;
  return <Canvas projectId={projectId} sam3Error={boot.status === 'error' ? boot.message : null} />;
}
```

- [ ] **Step 5: Update `main.tsx` temporarily**

For now, hardcode the project id from the first project found in PB (real branching arrives in Task 8). Replace the render call:

```tsx
import { pb } from './lib/pb';

(async () => {
  const projects = await pb.collection('projects').getList(1, 1, { sort: '-created' });
  const projectId = projects.items[0]?.id;
  if (!projectId) throw new Error('No projects found — run migrations');
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App projectId={projectId} />
    </StrictMode>,
  );
})();
```

This temporary scaffold lets the existing canvas keep running while we build out routing. It's deleted in Task 8.

- [ ] **Step 6: Run typecheck + tests**

Run:
```bash
pnpm --filter @netrart/app typecheck
pnpm --filter @netrart/app test
```
Expected: Both green. Existing segmentation tests need their mocks updated to pass `projectId`; fix any failures by appending the new arg.

- [ ] **Step 7: Smoke test**

Run: `pnpm db:start` (separate terminal) then `pnpm dev:app`. Open `http://localhost:5174/`. Existing canvas should load with all prior media intact. Confirm no console errors.

- [ ] **Step 8: Commit**

```bash
git add apps/app/src/App.tsx apps/app/src/Canvas.tsx apps/app/src/main.tsx apps/app/src/features/segmentation
git commit -m "refactor(canvas): thread projectId through pb calls (Default project hardcoded)"
```

---

## Phase 3 — Main entry routing

### Task 8: `main.tsx` branches on `?project=`

**Files:**
- Modify: `apps/app/src/main.tsx`
- Create (placeholder): `apps/app/src/features/projects/components/Home.tsx`
- Create: `apps/app/src/features/projects/index.ts`

The placeholder Home is a "Hello, projects" component — real Home arrives in Phase 6. Goal here is to verify the routing branch works.

- [ ] **Step 1: Create placeholder Home**

```tsx
// apps/app/src/features/projects/components/Home.tsx
export function Home() {
  return (
    <div style={{ padding: 24 }}>
      <h1>NetraRT Home</h1>
      <p>Project picker goes here.</p>
    </div>
  );
}
```

```ts
// apps/app/src/features/projects/index.ts
export { Home } from './components/Home';
```

- [ ] **Step 2: Replace `main.tsx` startup with the branch**

Strip the temporary "first project from PB" scaffolding from Task 7. Replace with:

```tsx
import { readProjectIdFromLocation, ProjectIdMissingError } from './lib/projectId';
import { Home } from './features/projects';

let projectId: string | null = null;
try {
  projectId = readProjectIdFromLocation();
} catch (err) {
  if (err instanceof ProjectIdMissingError) {
    console.warn('[main] empty project query, treating as Home');
    projectId = null;
  } else {
    throw err;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {projectId ? <App projectId={projectId} /> : <Home />}
  </StrictMode>,
);
```

(Keep the existing `forward` console + window error handlers above this block.)

- [ ] **Step 3: Smoke test**

Run dev server and visit:
- `http://localhost:5174/` → renders the placeholder Home.
- `http://localhost:5174/?project=<DEFAULT_ID>` (find the id with `curl http://127.0.0.1:8090/api/collections/projects/records | jq '.items[0].id'`) → renders the canvas with media.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/main.tsx apps/app/src/features/projects
git commit -m "feat(routing): mount Home or Canvas based on ?project= URL"
```

---

## Phase 4 — Tauri windowing

### Task 9: Widen Tauri capabilities for multi-window

**Files:**
- Modify: `apps/app/src-tauri/capabilities/default.json`
- Modify: `apps/app/src-tauri/tauri.conf.json`

Tauri 2 capabilities scope which permissions apply to which windows. We want every window (Home + every `canvas:<id>`) to have the same baseline.

- [ ] **Step 1: Set the main window label to `home`**

In `tauri.conf.json`, add `"label": "home"` to the only entry of `app.windows`:

```json
"windows": [
  {
    "label": "home",
    "title": "NetraRT",
    "width": 1280,
    "height": 820,
    "minWidth": 900,
    "minHeight": 600,
    "resizable": true,
    "fullscreen": false,
    "dragDropEnabled": true
  }
]
```

- [ ] **Step 2: Widen capabilities `windows`**

In `apps/app/src-tauri/capabilities/default.json`, change `"windows": ["main"]` to `"windows": ["home", "canvas:*"]` and add window-management permissions:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability for NetraRT desktop",
  "windows": ["home", "canvas:*"],
  "permissions": [
    "core:default",
    "core:window:allow-set-theme",
    "core:window:allow-set-title",
    "core:window:allow-close",
    "core:window:allow-set-focus",
    "core:webview:allow-create-webview-window",
    "shell:allow-execute",
    {
      "identifier": "shell:allow-spawn",
      "allow": [
        {
          "name": "binaries/pocketbase",
          "sidecar": true,
          "args": true
        }
      ]
    }
  ]
}
```

- [ ] **Step 3: Verify Tauri build still launches**

Run: `pnpm tauri:dev`
Expected: Native window opens, title says "NetraRT", canvas (or Home placeholder) loads. If the build complains about an unknown permission identifier, run `pnpm tauri permission list` to confirm the names against your installed Tauri plugin version and adjust accordingly.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src-tauri/capabilities/default.json apps/app/src-tauri/tauri.conf.json
git commit -m "chore(tauri): allow multi-window create/manage permissions"
```

---

### Task 10: `lib/windows.ts` — window helpers with web fallback

**Files:**
- Create: `apps/app/src/lib/windows.ts`
- Test: `apps/app/src/lib/windows.test.ts`

Single shared interface, runtime-detect Tauri vs web (matches the `__TAURI_INTERNALS__` check already used in `lib/pb.ts`).

- [ ] **Step 1: Write the failing test**

Web fallback only — Tauri APIs aren't testable in jsdom without heavy mocking. We trust Tauri's contract; we cover the web branch.

```ts
// apps/app/src/lib/windows.test.ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { openCanvasWindow, focusHome } from './windows';

describe('windows (web fallback)', () => {
  beforeEach(() => {
    // jsdom defaults to about:blank; reset to a known starting point
    window.history.replaceState({}, '', '/');
  });

  it('openCanvasWindow assigns ?project=<id> on web', () => {
    openCanvasWindow('proj_abc', 'My Project');
    expect(window.location.search).toBe('?project=proj_abc');
  });

  it('focusHome navigates to bare /', () => {
    window.history.replaceState({}, '', '/?project=proj_abc');
    focusHome();
    expect(window.location.search).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netrart/app test src/lib/windows`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/app/src/lib/windows.ts
const isTauri =
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

const canvasLabel = (projectId: string): string => `canvas:${projectId}`;
const HOME_LABEL = 'home';

export async function openCanvasWindow(
  projectId: string,
  title: string,
): Promise<void> {
  if (!isTauri) {
    // jsdom in tests has navigation guards; assign() on a real browser navigates.
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', `?project=${encodeURIComponent(projectId)}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
    return;
  }
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const label = canvasLabel(projectId);
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }
  const win = new WebviewWindow(label, {
    url: `index.html?project=${encodeURIComponent(projectId)}`,
    title,
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    dragDropEnabled: true,
  });
  await new Promise<void>((resolve, reject) => {
    win.once('tauri://created', () => resolve());
    win.once('tauri://error', (e) => reject(new Error(String(e.payload))));
  });
}

export async function focusHome(): Promise<void> {
  if (!isTauri) {
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
    return;
  }
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const existing = await WebviewWindow.getByLabel(HOME_LABEL);
  if (existing) {
    await existing.setFocus();
    return;
  }
  const win = new WebviewWindow(HOME_LABEL, {
    url: 'index.html',
    title: 'NetraRT',
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
  });
  await new Promise<void>((resolve, reject) => {
    win.once('tauri://created', () => resolve());
    win.once('tauri://error', (e) => reject(new Error(String(e.payload))));
  });
}

export async function setCanvasTitle(projectId: string, title: string): Promise<void> {
  if (!isTauri) {
    if (typeof document !== 'undefined') document.title = title;
    return;
  }
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const win = await WebviewWindow.getByLabel(canvasLabel(projectId));
  if (win) await win.setTitle(title);
}

export async function onCanvasCloseRequested(handler: () => Promise<void> | void): Promise<() => void> {
  if (!isTauri) return () => {};
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const cur = getCurrentWebviewWindow();
  const unlisten = await cur.onCloseRequested(async (event) => {
    event.preventDefault();
    try {
      await handler();
    } finally {
      // Resolving the prevention via destroy() is the documented Tauri 2 path.
      await cur.destroy();
    }
  });
  return () => unlisten();
}

export async function closeCurrentCanvas(): Promise<void> {
  if (!isTauri) {
    await focusHome();
    return;
  }
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  await getCurrentWebviewWindow().close();
}

export async function listOpenCanvasLabels(): Promise<string[]> {
  if (!isTauri) return [];
  const { getAllWebviewWindows } = await import('@tauri-apps/api/webviewWindow');
  const all = await getAllWebviewWindows();
  return all.map((w) => w.label).filter((l) => l.startsWith('canvas:'));
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @netrart/app test src/lib/windows`
Expected: Both web-fallback tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/windows.ts apps/app/src/lib/windows.test.ts
git commit -m "feat(app): lib/windows.ts — Tauri WebviewWindow helpers + web fallback"
```

---

## Phase 5 — Projects API

### Task 11: `features/projects/types/project.ts` — Zod schemas

**Files:**
- Create: `apps/app/src/features/projects/types/project.ts`

- [ ] **Step 1: Implement**

```ts
// apps/app/src/features/projects/types/project.ts
import { z } from 'zod';

export const ProjectColors = ['slate', 'blue', 'amber', 'emerald', 'rose', 'violet'] as const;
export type ProjectColor = (typeof ProjectColors)[number];

export const ProjectIcons = [
  'ri-folder-3-line',
  'ri-image-line',
  'ri-video-line',
  'ri-microscope-line',
  'ri-leaf-line',
  'ri-car-line',
  'ri-camera-line',
  'ri-flask-line',
  'ri-database-2-line',
  'ri-shapes-line',
  'ri-bookmark-line',
  'ri-stack-line',
] as const;
export type ProjectIcon = (typeof ProjectIcons)[number];

export const ProjectRecordSchema = z.object({
  id: z.string(),
  collectionId: z.string(),
  name: z.string(),
  color: z.string(),
  icon: z.string(),
  labels: z.array(z.string()).default([]),
  thumbnail: z.string().default(''),
  last_opened_at: z.string().nullable().optional(),
  created: z.string(),
  updated: z.string(),
});

export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;

export const NewProjectInputSchema = z.object({
  name: z.string().min(1).max(256),
  color: z.enum(ProjectColors),
  icon: z.enum(ProjectIcons),
  labels: z.array(z.string()).default([]),
});
export type NewProjectInput = z.infer<typeof NewProjectInputSchema>;

export const UpdateProjectInputSchema = NewProjectInputSchema.partial();
export type UpdateProjectInput = z.infer<typeof UpdateProjectInputSchema>;
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @netrart/app typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/features/projects/types
git commit -m "feat(projects): zod schemas for ProjectRecord + inputs"
```

---

### Task 12: `features/projects/api/projects.ts` — CRUD

**Files:**
- Create: `apps/app/src/features/projects/api/projects.ts`
- Test: `apps/app/src/features/projects/api/projects.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/app/src/features/projects/api/projects.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const collectionFns = {
  getFullList: vi.fn(),
  getOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../../../lib/pb', () => ({
  pb: { collection: () => collectionFns },
  PB_URL: 'http://test.local',
}));

import {
  listProjects,
  createProject,
  updateProject,
  deleteProject,
  touchLastOpenedAt,
  thumbnailUrl,
} from './projects';

beforeEach(() => {
  Object.values(collectionFns).forEach((fn) => fn.mockReset());
});

describe('projects api', () => {
  it('listProjects returns parsed records', async () => {
    collectionFns.getFullList.mockResolvedValueOnce([
      {
        id: 'p1',
        collectionId: 'pc',
        name: 'Cells',
        color: 'blue',
        icon: 'ri-microscope-line',
        labels: ['biology'],
        thumbnail: '',
        created: '2026-01-01',
        updated: '2026-01-01',
      },
    ]);
    const result = await listProjects();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Cells');
  });

  it('createProject submits expected fields', async () => {
    collectionFns.create.mockResolvedValueOnce({
      id: 'p2',
      collectionId: 'pc',
      name: 'Cars',
      color: 'amber',
      icon: 'ri-car-line',
      labels: [],
      thumbnail: '',
      created: '2026-01-02',
      updated: '2026-01-02',
    });
    const result = await createProject({
      name: 'Cars',
      color: 'amber',
      icon: 'ri-car-line',
      labels: [],
    });
    expect(collectionFns.create).toHaveBeenCalledWith({
      name: 'Cars',
      color: 'amber',
      icon: 'ri-car-line',
      labels: [],
    });
    expect(result.id).toBe('p2');
  });

  it('touchLastOpenedAt updates the timestamp', async () => {
    collectionFns.update.mockResolvedValueOnce({
      id: 'p1',
      collectionId: 'pc',
      name: 'Cells',
      color: 'blue',
      icon: 'ri-microscope-line',
      labels: [],
      thumbnail: '',
      last_opened_at: '2026-04-25T00:00:00Z',
      created: '2026-01-01',
      updated: '2026-04-25T00:00:00Z',
    });
    await touchLastOpenedAt('p1');
    expect(collectionFns.update).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ last_opened_at: expect.any(String) }),
    );
  });

  it('thumbnailUrl returns empty string when no thumbnail', () => {
    expect(
      thumbnailUrl({
        id: 'p1',
        collectionId: 'pc',
        name: 'x',
        color: 'slate',
        icon: 'ri-folder-3-line',
        labels: [],
        thumbnail: '',
        created: '',
        updated: '',
      }),
    ).toBe('');
  });

  it('thumbnailUrl returns a PB file URL when present', () => {
    const url = thumbnailUrl({
      id: 'p1',
      collectionId: 'pc',
      name: 'x',
      color: 'slate',
      icon: 'ri-folder-3-line',
      labels: [],
      thumbnail: 'thumb_abc.webp',
      created: '',
      updated: '',
    });
    expect(url).toBe('http://test.local/api/files/pc/p1/thumb_abc.webp');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netrart/app test src/features/projects/api/projects`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/app/src/features/projects/api/projects.ts
import { pb, PB_URL } from '../../../lib/pb';
import {
  ProjectRecordSchema,
  type ProjectRecord,
  type NewProjectInput,
  type UpdateProjectInput,
} from '../types/project';

const parseOne = (raw: unknown): ProjectRecord => ProjectRecordSchema.parse(raw);

export const listProjects = async (): Promise<ProjectRecord[]> => {
  const raw = await pb.collection('projects').getFullList({ sort: '-last_opened_at,-created' });
  if (!Array.isArray(raw)) return [];
  const out: ProjectRecord[] = [];
  for (const item of raw) {
    const parsed = ProjectRecordSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
};

export const getProject = async (id: string): Promise<ProjectRecord> => {
  const raw = await pb.collection('projects').getOne(id);
  return parseOne(raw);
};

export const createProject = async (input: NewProjectInput): Promise<ProjectRecord> => {
  const raw = await pb.collection('projects').create(input);
  return parseOne(raw);
};

export const updateProject = async (
  id: string,
  input: UpdateProjectInput,
): Promise<ProjectRecord> => {
  const raw = await pb.collection('projects').update(id, input);
  return parseOne(raw);
};

export const deleteProject = async (id: string): Promise<void> => {
  await pb.collection('projects').delete(id);
};

export const touchLastOpenedAt = async (id: string): Promise<ProjectRecord> => {
  const raw = await pb.collection('projects').update(id, {
    last_opened_at: new Date().toISOString(),
  });
  return parseOne(raw);
};

export const uploadThumbnail = async (
  id: string,
  blob: Blob,
): Promise<ProjectRecord> => {
  const form = new FormData();
  form.append('thumbnail', blob, 'thumbnail.webp');
  const raw = await pb.collection('projects').update(id, form);
  return parseOne(raw);
};

export const thumbnailUrl = (record: ProjectRecord): string => {
  if (!record.thumbnail) return '';
  return `${PB_URL}/api/files/${record.collectionId}/${record.id}/${encodeURIComponent(record.thumbnail)}`;
};
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @netrart/app test src/features/projects/api/projects`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/projects/api/projects.ts apps/app/src/features/projects/api/projects.test.ts
git commit -m "feat(projects): CRUD api with thumbnail url helper"
```

---

### Task 13: `useProjects` hook with realtime subscription

**Files:**
- Create: `apps/app/src/features/projects/api/useProjects.ts`

- [ ] **Step 1: Implement**

```ts
// apps/app/src/features/projects/api/useProjects.ts
import { useEffect, useState } from 'react';
import { pb } from '../../../lib/pb';
import { listProjects } from './projects';
import { ProjectRecordSchema, type ProjectRecord } from '../types/project';

type State =
  | { status: 'loading' }
  | { status: 'ready'; projects: ProjectRecord[] }
  | { status: 'error'; error: Error };

export function useProjects(): State {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((projects) => {
        if (!cancelled) setState({ status: 'ready', projects });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });

    let unsubscribe: (() => void) | null = null;
    pb.collection('projects')
      .subscribe('*', (e) => {
        if (cancelled) return;
        setState((prev) => {
          if (prev.status !== 'ready') return prev;
          const parsed = ProjectRecordSchema.safeParse(e.record);
          if (!parsed.success) return prev;
          const projects = prev.projects.slice();
          const idx = projects.findIndex((p) => p.id === parsed.data.id);
          if (e.action === 'delete') {
            if (idx >= 0) projects.splice(idx, 1);
          } else if (idx >= 0) {
            projects[idx] = parsed.data;
          } else {
            projects.unshift(parsed.data);
          }
          return { status: 'ready', projects };
        });
      })
      .then((unsub) => {
        unsubscribe = unsub as unknown as () => void;
        if (cancelled) unsubscribe?.();
      })
      .catch((err) => {
        console.warn('[useProjects] subscribe failed', err);
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  return state;
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @netrart/app typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/features/projects/api/useProjects.ts
git commit -m "feat(projects): useProjects hook with realtime subscribe"
```

---

## Phase 6 — Home UI

### Task 14: Home shell + empty state + CSS

**Files:**
- Modify: `apps/app/src/features/projects/components/Home.tsx`
- Create: `apps/app/src/features/projects/Home.css`
- Modify: `apps/app/src/features/projects/index.ts`

- [ ] **Step 1: Add CSS tokens for project colors**

```css
/* apps/app/src/features/projects/Home.css */
.home {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  background: var(--color-surface, #fff);
  color: var(--color-text, #111);
}

.home-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 24px;
  border-bottom: 1px solid var(--color-border, #e5e5e5);
}

.home-title {
  font-size: 18px;
  font-weight: 600;
  margin-right: auto;
}

.home-search {
  width: 280px;
  padding: 8px 12px;
  border: 1px solid var(--color-border, #e5e5e5);
  border-radius: 8px;
  font-size: 14px;
}

.home-empty {
  margin: auto;
  text-align: center;
  color: var(--color-text-muted, #666);
}

.home-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
  padding: 24px;
  overflow-y: auto;
}

.project-color-slate { background: #64748b; }
.project-color-blue { background: #3b82f6; }
.project-color-amber { background: #f59e0b; }
.project-color-emerald { background: #10b981; }
.project-color-rose { background: #f43f5e; }
.project-color-violet { background: #8b5cf6; }
```

- [ ] **Step 2: Replace placeholder Home with the shell**

```tsx
// apps/app/src/features/projects/components/Home.tsx
import { useState } from 'react';
import { useProjects } from '../api/useProjects';
import { ProjectGrid } from './ProjectGrid';
import { NewProjectModal } from './NewProjectModal';
import '../Home.css';

export function Home() {
  const state = useProjects();
  const [newOpen, setNewOpen] = useState(false);

  return (
    <div className="home">
      <header className="home-header">
        <div className="home-title">NetraRT</div>
        <button type="button" onClick={() => setNewOpen(true)}>
          <i className="ri-add-line" aria-hidden /> New project
        </button>
      </header>
      <main>
        {state.status === 'loading' && <div className="home-empty">Loading…</div>}
        {state.status === 'error' && (
          <div className="home-empty">Failed to load projects: {state.error.message}</div>
        )}
        {state.status === 'ready' && state.projects.length === 0 && (
          <div className="home-empty">
            <p>No projects yet.</p>
            <button type="button" onClick={() => setNewOpen(true)}>
              Create your first project
            </button>
          </div>
        )}
        {state.status === 'ready' && state.projects.length > 0 && (
          <ProjectGrid projects={state.projects} />
        )}
      </main>
      {newOpen && <NewProjectModal onClose={() => setNewOpen(false)} />}
    </div>
  );
}
```

The components `ProjectGrid` and `NewProjectModal` are stubbed in the next two tasks. Create empty placeholders so this compiles:

```tsx
// apps/app/src/features/projects/components/ProjectGrid.tsx
import type { ProjectRecord } from '../types/project';
export function ProjectGrid({ projects }: { projects: ProjectRecord[] }) {
  return <div className="home-grid">{projects.length} projects</div>;
}
```

```tsx
// apps/app/src/features/projects/components/NewProjectModal.tsx
export function NewProjectModal({ onClose }: { onClose: () => void }) {
  return <div role="dialog">Stub modal <button onClick={onClose}>close</button></div>;
}
```

- [ ] **Step 3: Smoke test**

Run: `pnpm dev:app`. Visit `/`. You should see the header, "1 projects" (the Default Project), and a New project button.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/features/projects
git commit -m "feat(home): shell + empty state + grid stub"
```

---

### Task 15: `ColorPicker` + `IconPicker`

**Files:**
- Create: `apps/app/src/features/projects/components/ColorPicker.tsx`
- Create: `apps/app/src/features/projects/components/IconPicker.tsx`

- [ ] **Step 1: ColorPicker**

```tsx
// apps/app/src/features/projects/components/ColorPicker.tsx
import { ProjectColors, type ProjectColor } from '../types/project';

type Props = {
  value: ProjectColor;
  onChange: (next: ProjectColor) => void;
};

export function ColorPicker({ value, onChange }: Props) {
  return (
    <div role="radiogroup" aria-label="Project color" style={{ display: 'flex', gap: 8 }}>
      {ProjectColors.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c === value}
          aria-label={c}
          className={`project-color-${c}`}
          onClick={() => onChange(c)}
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            border: c === value ? '2px solid #111' : '2px solid transparent',
            cursor: 'pointer',
          }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: IconPicker**

```tsx
// apps/app/src/features/projects/components/IconPicker.tsx
import { ProjectIcons, type ProjectIcon } from '../types/project';

type Props = {
  value: ProjectIcon;
  onChange: (next: ProjectIcon) => void;
};

export function IconPicker({ value, onChange }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Project icon"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 32px)', gap: 8 }}
    >
      {ProjectIcons.map((icon) => (
        <button
          key={icon}
          type="button"
          role="radio"
          aria-checked={icon === value}
          aria-label={icon}
          onClick={() => onChange(icon)}
          style={{
            width: 32,
            height: 32,
            borderRadius: 6,
            border: icon === value ? '2px solid #111' : '1px solid #ddd',
            background: 'white',
            cursor: 'pointer',
          }}
        >
          <i className={icon} aria-hidden />
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @netrart/app typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/features/projects/components/ColorPicker.tsx apps/app/src/features/projects/components/IconPicker.tsx
git commit -m "feat(projects): ColorPicker + IconPicker"
```

---

### Task 16: `NewProjectModal`

**Files:**
- Modify: `apps/app/src/features/projects/components/NewProjectModal.tsx`

Single name field, autofocus, Enter submits. Color/icon defaulted (random color, generic folder icon).

- [ ] **Step 1: Implement**

```tsx
// apps/app/src/features/projects/components/NewProjectModal.tsx
import { useState, useRef, useEffect } from 'react';
import { createProject } from '../api/projects';
import { ProjectColors, type ProjectColor } from '../types/project';
import { useOpenProject } from '../hooks/useOpenProject';

const randomColor = (): ProjectColor =>
  ProjectColors[Math.floor(Math.random() * ProjectColors.length)];

type Props = {
  onClose: () => void;
};

export function NewProjectModal({ onClose }: Props) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const open = useOpenProject();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const project = await createProject({
        name: name.trim(),
        color: randomColor(),
        icon: 'ri-folder-3-line',
        labels: [],
      });
      onClose();
      await open(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New project"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 50,
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{
          background: 'white',
          padding: 24,
          borderRadius: 12,
          minWidth: 360,
        }}
      >
        <h2 style={{ marginTop: 0 }}>New project</h2>
        <label style={{ display: 'block', marginBottom: 16 }}>
          <div style={{ marginBottom: 4, fontSize: 13 }}>Name</div>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={256}
            disabled={submitting}
            style={{ width: '100%', padding: 8 }}
          />
        </label>
        {error && (
          <div role="alert" style={{ color: '#b00', marginBottom: 8 }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" disabled={!name.trim() || submitting}>
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Stub `useOpenProject`**

Until Task 19 implements the real one:

```ts
// apps/app/src/features/projects/hooks/useOpenProject.ts
import { useCallback } from 'react';
import type { ProjectRecord } from '../types/project';
import { openCanvasWindow } from '../../../lib/windows';
import { touchLastOpenedAt } from '../api/projects';

export function useOpenProject() {
  return useCallback(async (project: ProjectRecord) => {
    void touchLastOpenedAt(project.id).catch(() => {});
    await openCanvasWindow(project.id, project.name);
  }, []);
}
```

- [ ] **Step 3: Smoke test**

Open Home, click "New project", type a name, hit Enter. The new canvas window should open (Tauri build) or location should change to `?project=<id>` (web build) and the canvas should load empty.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/features/projects/components/NewProjectModal.tsx apps/app/src/features/projects/hooks/useOpenProject.ts
git commit -m "feat(home): New project modal + useOpenProject"
```

---

### Task 17: `ProjectCard` + real `ProjectGrid`

**Files:**
- Modify: `apps/app/src/features/projects/components/ProjectGrid.tsx`
- Create: `apps/app/src/features/projects/components/ProjectCard.tsx`

- [ ] **Step 1: ProjectCard**

```tsx
// apps/app/src/features/projects/components/ProjectCard.tsx
import { useState } from 'react';
import type { ProjectRecord } from '../types/project';
import { thumbnailUrl } from '../api/projects';
import { useOpenProject } from '../hooks/useOpenProject';

const formatRelative = (iso: string | null | undefined): string => {
  if (!iso) return 'never opened';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
};

type Props = {
  project: ProjectRecord;
  itemCount: number;
  onEdit: () => void;
  onDelete: () => void;
};

export function ProjectCard({ project, itemCount, onEdit, onDelete }: Props) {
  const open = useOpenProject();
  const thumb = thumbnailUrl(project);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => open(project)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open(project);
        }
      }}
      style={{
        border: '1px solid #e5e5e5',
        borderRadius: 12,
        overflow: 'hidden',
        cursor: 'pointer',
        background: 'white',
        position: 'relative',
      }}
    >
      <div
        className={`project-color-${project.color}`}
        style={{
          aspectRatio: '16 / 9',
          display: 'grid',
          placeItems: 'center',
          backgroundImage: thumb ? `url(${thumb})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        {!thumb && (
          <i className={project.icon} style={{ fontSize: 48, color: 'white' }} aria-hidden />
        )}
      </div>
      <div style={{ padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className={project.icon} aria-hidden />
          <div style={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {project.name}
          </div>
          <button
            type="button"
            aria-label="More"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
          >
            ⋯
          </button>
        </div>
        {project.labels.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
            {project.labels.map((l) => (
              <span key={l} style={{ fontSize: 12, padding: '2px 6px', background: '#eee', borderRadius: 4 }}>
                #{l}
              </span>
            ))}
          </div>
        )}
        <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
          {itemCount} items · opened {formatRelative(project.last_opened_at)}
        </div>
      </div>
      {menuOpen && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: '50%',
            right: 12,
            background: 'white',
            border: '1px solid #ddd',
            borderRadius: 6,
            padding: 4,
            zIndex: 10,
          }}
        >
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); open(project); }}>
            Open
          </button>
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onEdit(); }}>
            Edit details…
          </button>
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onDelete(); }}>
            Delete…
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: ProjectGrid**

```tsx
// apps/app/src/features/projects/components/ProjectGrid.tsx
import { useState } from 'react';
import type { ProjectRecord } from '../types/project';
import { ProjectCard } from './ProjectCard';
import { EditProjectModal } from './EditProjectModal';
import { DeleteProjectModal } from './DeleteProjectModal';

type Props = {
  projects: ProjectRecord[];
  itemCounts: Record<string, number>;
};

export function ProjectGrid({ projects, itemCounts }: Props) {
  const [editing, setEditing] = useState<ProjectRecord | null>(null);
  const [deleting, setDeleting] = useState<ProjectRecord | null>(null);

  return (
    <>
      <div className="home-grid">
        {projects.map((p) => (
          <ProjectCard
            key={p.id}
            project={p}
            itemCount={itemCounts[p.id] ?? 0}
            onEdit={() => setEditing(p)}
            onDelete={() => setDeleting(p)}
          />
        ))}
      </div>
      {editing && (
        <EditProjectModal project={editing} onClose={() => setEditing(null)} />
      )}
      {deleting && (
        <DeleteProjectModal project={deleting} onClose={() => setDeleting(null)} />
      )}
    </>
  );
}
```

Stub `EditProjectModal` and `DeleteProjectModal` as no-op components for now (real impls in Task 18 + 19).

- [ ] **Step 3: Pass `itemCounts` from `Home`**

Add a small loader inside Home that resolves item counts per project. Cheap MVP: one PB query per collection grouped client-side. (A future migration can add a denormalized count if this gets slow.)

```tsx
// at the top of Home.tsx
import { useEffect, useState } from 'react';
import { pb } from '../../../lib/pb';

function useItemCounts(): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      pb.collection('images').getFullList({ filter: 'deleted_at = null || deleted_at = ""', fields: 'project' }),
      pb.collection('videos').getFullList({ filter: 'deleted_at = null || deleted_at = ""', fields: 'project' }),
    ]).then(([imgs, vids]) => {
      if (cancelled) return;
      const next: Record<string, number> = {};
      for (const r of [...imgs, ...vids] as { project: string }[]) {
        next[r.project] = (next[r.project] ?? 0) + 1;
      }
      setCounts(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return counts;
}
```

Pass `itemCounts={useItemCounts()}` to `<ProjectGrid />`.

- [ ] **Step 4: Smoke test**

Run dev. Home should render the Default Project as a card showing item count and color/icon block.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/projects/components apps/app/src/features/projects/components/Home.tsx
git commit -m "feat(home): ProjectCard + grid + item counts"
```

---

### Task 18: `EditProjectModal` (real implementation)

**Files:**
- Modify: `apps/app/src/features/projects/components/EditProjectModal.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/app/src/features/projects/components/EditProjectModal.tsx
import { useState } from 'react';
import { updateProject } from '../api/projects';
import {
  type ProjectRecord,
  type ProjectColor,
  type ProjectIcon,
} from '../types/project';
import { ColorPicker } from './ColorPicker';
import { IconPicker } from './IconPicker';

type Props = {
  project: ProjectRecord;
  onClose: () => void;
};

export function EditProjectModal({ project, onClose }: Props) {
  const [name, setName] = useState(project.name);
  const [color, setColor] = useState<ProjectColor>(project.color as ProjectColor);
  const [icon, setIcon] = useState<ProjectIcon>(project.icon as ProjectIcon);
  const [labels, setLabels] = useState<string[]>(project.labels);
  const [labelDraft, setLabelDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateProject(project.id, { name: name.trim(), color, icon, labels });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  const addLabel = () => {
    const t = labelDraft.trim();
    if (!t || labels.includes(t)) return;
    setLabels([...labels, t]);
    setLabelDraft('');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit project"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center', zIndex: 50 }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{ background: 'white', padding: 24, borderRadius: 12, minWidth: 420 }}
      >
        <h2 style={{ marginTop: 0 }}>Edit project</h2>
        <label style={{ display: 'block', marginBottom: 16 }}>
          <div style={{ marginBottom: 4, fontSize: 13 }}>Name</div>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={256}
            disabled={submitting}
            style={{ width: '100%', padding: 8 }}
          />
        </label>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 4, fontSize: 13 }}>Color</div>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 4, fontSize: 13 }}>Icon</div>
          <IconPicker value={icon} onChange={setIcon} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 4, fontSize: 13 }}>Labels</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {labels.map((l) => (
              <span key={l} style={{ fontSize: 12, padding: '2px 6px', background: '#eee', borderRadius: 4 }}>
                #{l}{' '}
                <button
                  type="button"
                  onClick={() => setLabels(labels.filter((x) => x !== l))}
                  style={{ marginLeft: 4 }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              type="text"
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addLabel();
                }
              }}
              placeholder="Add a label"
              style={{ flex: 1, padding: 8 }}
            />
            <button type="button" onClick={addLabel}>Add</button>
          </div>
        </div>
        {error && <div role="alert" style={{ color: '#b00', marginBottom: 8 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="submit" disabled={!name.trim() || submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Smoke test**

From Home, open card menu, click "Edit details…", change color/icon/labels, save. The card should reflect the changes (via realtime).

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/features/projects/components/EditProjectModal.tsx
git commit -m "feat(home): edit project modal"
```

---

### Task 19: `DeleteProjectModal` (type-to-confirm)

**Files:**
- Modify: `apps/app/src/features/projects/components/DeleteProjectModal.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/app/src/features/projects/components/DeleteProjectModal.tsx
import { useState } from 'react';
import { deleteProject } from '../api/projects';
import type { ProjectRecord } from '../types/project';

type Props = {
  project: ProjectRecord;
  onClose: () => void;
  onDeleted?: () => void;
};

export function DeleteProjectModal({ project, onClose, onDeleted }: Props) {
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = confirm.trim() === project.name;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matches || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await deleteProject(project.id);
      onClose();
      onDeleted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Delete project"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center', zIndex: 50 }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{ background: 'white', padding: 24, borderRadius: 12, minWidth: 360 }}
      >
        <h2 style={{ marginTop: 0, color: '#b00' }}>Delete project</h2>
        <p>
          This will permanently delete <strong>{project.name}</strong> and all its media,
          segmentations, and tags. This action cannot be undone.
        </p>
        <label style={{ display: 'block', marginBottom: 16 }}>
          <div style={{ marginBottom: 4, fontSize: 13 }}>
            Type <code>{project.name}</code> to confirm
          </div>
          <input
            type="text"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={submitting}
            autoFocus
            style={{ width: '100%', padding: 8 }}
          />
        </label>
        {error && <div role="alert" style={{ color: '#b00', marginBottom: 8 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={submitting}>Cancel</button>
          <button
            type="submit"
            disabled={!matches || submitting}
            style={{ background: matches ? '#b00' : undefined, color: matches ? 'white' : undefined }}
          >
            {submitting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Smoke test**

Create a throwaway project, attempt delete: button stays disabled until you type the exact name. Confirm cascade dropped any media you'd added.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/features/projects/components/DeleteProjectModal.tsx
git commit -m "feat(home): delete project modal with type-to-confirm"
```

---

### Task 20: Search + sort + label filter

**Files:**
- Create: `apps/app/src/features/projects/components/SortMenu.tsx`
- Create: `apps/app/src/features/projects/components/LabelFilterRow.tsx`
- Modify: `apps/app/src/features/projects/components/Home.tsx`

- [ ] **Step 1: SortMenu**

```tsx
// apps/app/src/features/projects/components/SortMenu.tsx
export type SortKey = 'recent' | 'name' | 'created';

type Props = {
  value: SortKey;
  onChange: (next: SortKey) => void;
};

export function SortMenu({ value, onChange }: Props) {
  return (
    <label>
      <span style={{ fontSize: 12, marginRight: 4 }}>Sort by</span>
      <select value={value} onChange={(e) => onChange(e.target.value as SortKey)}>
        <option value="recent">Recently opened</option>
        <option value="name">Name</option>
        <option value="created">Created</option>
      </select>
    </label>
  );
}
```

- [ ] **Step 2: LabelFilterRow**

```tsx
// apps/app/src/features/projects/components/LabelFilterRow.tsx
type Props = {
  available: string[];
  selected: string[];
  onChange: (next: string[]) => void;
};

export function LabelFilterRow({ available, selected, onChange }: Props) {
  if (available.length === 0) return null;
  const toggle = (label: string) => {
    onChange(
      selected.includes(label)
        ? selected.filter((l) => l !== label)
        : [...selected, label],
    );
  };
  return (
    <div style={{ display: 'flex', gap: 4, padding: '8px 24px', flexWrap: 'wrap' }}>
      {available.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => toggle(l)}
          aria-pressed={selected.includes(l)}
          style={{
            padding: '4px 8px',
            borderRadius: 12,
            border: '1px solid #ddd',
            background: selected.includes(l) ? '#111' : 'white',
            color: selected.includes(l) ? 'white' : '#111',
            cursor: 'pointer',
          }}
        >
          #{l}
        </button>
      ))}
      {selected.length > 0 && (
        <button type="button" onClick={() => onChange([])}>
          Clear
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire into Home**

In `Home.tsx`, manage `query` (string), `sort` (SortKey), `selectedLabels` (string[]). Derive filtered/sorted list during render:

```tsx
import { useMemo, useState } from 'react';
import { SortMenu, type SortKey } from './SortMenu';
import { LabelFilterRow } from './LabelFilterRow';

// ...inside Home:
const [query, setQuery] = useState('');
const [sort, setSort] = useState<SortKey>('recent');
const [selectedLabels, setSelectedLabels] = useState<string[]>([]);

const projects = state.status === 'ready' ? state.projects : [];
const allLabels = useMemo(() => {
  const set = new Set<string>();
  projects.forEach((p) => p.labels.forEach((l) => set.add(l)));
  return Array.from(set).sort();
}, [projects]);

const visible = useMemo(() => {
  const q = query.trim().toLowerCase();
  return projects
    .filter((p) => {
      if (selectedLabels.length && !selectedLabels.every((l) => p.labels.includes(l))) {
        return false;
      }
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.labels.some((l) => l.toLowerCase().includes(q));
    })
    .sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'created') return b.created.localeCompare(a.created);
      const aT = a.last_opened_at ?? a.created;
      const bT = b.last_opened_at ?? b.created;
      return bT.localeCompare(aT);
    });
}, [projects, query, sort, selectedLabels]);
```

Inject `<input className="home-search" value={query} onChange={…} />`, `<SortMenu />`, and `<LabelFilterRow />` between header and grid. Pass `visible` to `<ProjectGrid />` instead of raw `state.projects`.

- [ ] **Step 4: Smoke test**

Create 3 projects with labels, test search, sort, label filter combinations.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/projects/components
git commit -m "feat(home): search + sort + label filter"
```

---

## Phase 7 — Saved-tags rewrite (PB-backed, per-project)

### Task 21: `tags` API + Zod schema

**Files:**
- Create: `apps/app/src/features/projects/api/tags.ts`
- Test: `apps/app/src/features/projects/api/tags.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/app/src/features/projects/api/tags.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const collectionFns = {
  getFullList: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../../../lib/pb', () => ({
  pb: { collection: () => collectionFns },
}));

import { listTags, createTag, deleteTagById } from './tags';

beforeEach(() => Object.values(collectionFns).forEach((f) => f.mockReset()));

describe('tags api', () => {
  it('listTags filters by project', async () => {
    collectionFns.getFullList.mockResolvedValueOnce([]);
    await listTags('proj_1');
    expect(collectionFns.getFullList).toHaveBeenCalledWith({
      filter: 'project="proj_1"',
      sort: '-updated',
    });
  });

  it('createTag posts project + name + color', async () => {
    collectionFns.create.mockResolvedValueOnce({
      id: 't1',
      collectionId: 'tc',
      project: 'proj_1',
      name: 'Cell',
      color: '#a0c4ff',
      created: '',
      updated: '',
    });
    const out = await createTag('proj_1', { name: 'Cell', color: '#a0c4ff' });
    expect(collectionFns.create).toHaveBeenCalledWith({
      project: 'proj_1',
      name: 'Cell',
      color: '#a0c4ff',
    });
    expect(out.name).toBe('Cell');
  });

  it('deleteTagById delegates', async () => {
    collectionFns.delete.mockResolvedValueOnce(true);
    await deleteTagById('t1');
    expect(collectionFns.delete).toHaveBeenCalledWith('t1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netrart/app test src/features/projects/api/tags`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// apps/app/src/features/projects/api/tags.ts
import { z } from 'zod';
import { pb } from '../../../lib/pb';

export const TagRecordSchema = z.object({
  id: z.string(),
  collectionId: z.string(),
  project: z.string(),
  name: z.string(),
  color: z.string(),
  created: z.string(),
  updated: z.string(),
});
export type TagRecord = z.infer<typeof TagRecordSchema>;

export const listTags = async (projectId: string): Promise<TagRecord[]> => {
  const raw = await pb.collection('tags').getFullList({
    filter: `project="${projectId}"`,
    sort: '-updated',
  });
  if (!Array.isArray(raw)) return [];
  const out: TagRecord[] = [];
  for (const item of raw) {
    const parsed = TagRecordSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
};

export const createTag = async (
  projectId: string,
  input: { name: string; color: string },
): Promise<TagRecord> => {
  const raw = await pb.collection('tags').create({ project: projectId, ...input });
  return TagRecordSchema.parse(raw);
};

export const updateTag = async (
  id: string,
  input: { name?: string; color?: string },
): Promise<TagRecord> => {
  const raw = await pb.collection('tags').update(id, input);
  return TagRecordSchema.parse(raw);
};

export const deleteTagById = async (id: string): Promise<void> => {
  await pb.collection('tags').delete(id);
};
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @netrart/app test src/features/projects/api/tags`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/projects/api/tags.ts apps/app/src/features/projects/api/tags.test.ts
git commit -m "feat(tags): per-project tags api + zod schema"
```

---

### Task 22: Legacy localStorage migration helper

**Files:**
- Create: `apps/app/src/features/projects/lib/legacyTagsMigration.ts`
- Test: `apps/app/src/features/projects/lib/legacyTagsMigration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/app/src/features/projects/lib/legacyTagsMigration.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migrateLegacySavedTags, LEGACY_KEY } from './legacyTagsMigration';

beforeEach(() => {
  localStorage.clear();
});

describe('migrateLegacySavedTags', () => {
  it('does nothing when key absent', async () => {
    const create = vi.fn();
    await migrateLegacySavedTags('proj_1', { existingCount: 0, createTag: create });
    expect(create).not.toHaveBeenCalled();
  });

  it('does nothing when project already has tags', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(['cell']));
    const create = vi.fn();
    await migrateLegacySavedTags('proj_1', { existingCount: 5, createTag: create });
    expect(create).not.toHaveBeenCalled();
    expect(localStorage.getItem(LEGACY_KEY)).toBe(JSON.stringify(['cell']));
  });

  it('imports legacy tags and clears the key on success', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(['cell', 'wall']));
    const create = vi.fn().mockResolvedValue(undefined);
    await migrateLegacySavedTags('proj_1', { existingCount: 0, createTag: create });
    expect(create).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('keeps the key on partial failure', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(['cell', 'wall']));
    const create = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('boom'));
    await expect(
      migrateLegacySavedTags('proj_1', { existingCount: 0, createTag: create }),
    ).rejects.toThrow('boom');
    expect(localStorage.getItem(LEGACY_KEY)).toBe(JSON.stringify(['cell', 'wall']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netrart/app test src/features/projects/lib/legacyTagsMigration`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// apps/app/src/features/projects/lib/legacyTagsMigration.ts
import { z } from 'zod';

export const LEGACY_KEY = 'netrart:saved-tags:v1';

const Schema = z.array(z.string().min(1).max(80));

const colorForTag = (name: string): string => {
  // Stable hash → hue. Keeps legacy tags visually consistent post-migration.
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 70%, 60%)`;
};

type Deps = {
  existingCount: number;
  createTag: (input: { name: string; color: string }) => Promise<unknown>;
};

export async function migrateLegacySavedTags(
  projectId: string,
  deps: Deps,
): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  if (deps.existingCount > 0) return;
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return;
  let tags: string[] = [];
  try {
    const parsed = Schema.safeParse(JSON.parse(raw));
    if (parsed.success) tags = parsed.data;
  } catch {
    return;
  }
  if (tags.length === 0) {
    localStorage.removeItem(LEGACY_KEY);
    return;
  }
  for (const name of tags) {
    await deps.createTag({ name, color: colorForTag(name) });
  }
  localStorage.removeItem(LEGACY_KEY);
}
```

The unused `projectId` arg keeps the signature symmetric with the caller (which uses it implicitly via the bound `createTag`). It also documents intent.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @netrart/app test src/features/projects/lib/legacyTagsMigration`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/projects/lib/legacyTagsMigration.ts apps/app/src/features/projects/lib/legacyTagsMigration.test.ts
git commit -m "feat(tags): one-shot migration helper for legacy localStorage"
```

---

### Task 23: Rewrite `useSavedTags` to back onto PB

**Files:**
- Modify: `apps/app/src/components/savedTags.ts`
- Modify: `apps/app/src/Canvas.tsx` (pass `projectId` to `useSavedTags`)

The hook signature gains `projectId`. Public-facing return shape stays identical so call sites in `Canvas.tsx` need only the new arg.

- [ ] **Step 1: Read the existing hook to preserve its public surface**

Run: `cat apps/app/src/components/savedTags.ts | head -200`
Note the exported names (`useSavedTags`, `colorForTag`, `sanitizeTag`, etc.) and the shape returned by the hook (the value the rest of the app destructures). Preserve every exported binding.

- [ ] **Step 2: Rewrite**

Replace the file. Keep `colorForTag` and `sanitizeTag` exactly as-is (re-exported from the new file unchanged). Replace the hook body:

```ts
// apps/app/src/components/savedTags.ts
import { useCallback, useEffect, useState } from 'react';
import {
  listTags,
  createTag,
  deleteTagById,
  type TagRecord,
} from '../features/projects/api/tags';
import { migrateLegacySavedTags } from '../features/projects/lib/legacyTagsMigration';
import { pb } from '../lib/pb';

// Keep these helpers untouched — copy them verbatim from the previous
// implementation. (sanitizeTag normalizes whitespace; colorForTag produces a
// stable HSL string for a given tag name. They stay pure and synchronous.)
export const sanitizeTag = (tag: string) => tag.trim().replace(/\s+/g, ' ');

export function colorForTag(tag: string): string {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 70%, 60%)`;
}

const MAX_SAVED = 200;

type SavedTagsApi = {
  tags: string[];
  remember: (raw: string) => Promise<void>;
  forget: (raw: string) => Promise<void>;
};

export function useSavedTags(projectId: string): SavedTagsApi {
  const [records, setRecords] = useState<TagRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const initial = await listTags(projectId);
      if (cancelled) return;
      setRecords(initial);
      try {
        await migrateLegacySavedTags(projectId, {
          existingCount: initial.length,
          createTag: async (input) => {
            const created = await createTag(projectId, input);
            if (!cancelled) setRecords((prev) => [created, ...prev]);
          },
        });
      } catch (err) {
        console.warn('[savedTags] legacy migration failed; will retry next launch', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const remember = useCallback(
    async (rawTag: string) => {
      const clean = sanitizeTag(rawTag);
      if (!clean) return;
      // Find by case-insensitive match
      const lower = clean.toLowerCase();
      const existing = records.find((r) => r.name.toLowerCase() === lower);
      if (existing) return; // dedupe by name
      const created = await createTag(projectId, { name: clean, color: colorForTag(clean) });
      setRecords((prev) => [created, ...prev].slice(0, MAX_SAVED));
    },
    [projectId, records],
  );

  const forget = useCallback(
    async (rawTag: string) => {
      const clean = sanitizeTag(rawTag);
      const lower = clean.toLowerCase();
      const target = records.find((r) => r.name.toLowerCase() === lower);
      if (!target) return;
      await deleteTagById(target.id);
      setRecords((prev) => prev.filter((r) => r.id !== target.id));
    },
    [records],
  );

  // Optional: subscribe so multi-window writes propagate. Cheap and helpful.
  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;
    pb.collection('tags')
      .subscribe('*', (e) => {
        if (cancelled) return;
        if (e.record.project !== projectId) return;
        setRecords((prev) => {
          const idx = prev.findIndex((r) => r.id === e.record.id);
          if (e.action === 'delete') {
            return idx >= 0 ? prev.filter((r) => r.id !== e.record.id) : prev;
          }
          const next = prev.slice();
          if (idx >= 0) next[idx] = e.record as TagRecord;
          else next.unshift(e.record as TagRecord);
          return next;
        });
      })
      .then((u) => {
        unsub = u as unknown as () => void;
        if (cancelled) unsub?.();
      })
      .catch((err) => console.warn('[savedTags] subscribe failed', err));
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [projectId]);

  return {
    tags: records.map((r) => r.name),
    remember,
    forget,
  };
}
```

- [ ] **Step 3: Update `Canvas.tsx`**

Find the existing `useSavedTags()` call, change it to `useSavedTags(projectId)`. The `remember` / `forget` calls in `Canvas.tsx` may have been synchronous; they're now async — wrap call sites with `void` or `await` as appropriate. (Most are fire-and-forget user-action handlers, where `void remember(...)` is fine.)

- [ ] **Step 4: Run typecheck + tests**

Run:
```bash
pnpm --filter @netrart/app typecheck
pnpm --filter @netrart/app test
```
Expected: PASS.

- [ ] **Step 5: Smoke test**

Open canvas. Create a label on an image. Reload the canvas window. The label suggestion list should show the just-created tag (now persisted in PB, not localStorage).

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/components/savedTags.ts apps/app/src/Canvas.tsx
git commit -m "refactor(tags): back useSavedTags onto PB tags collection (per project)"
```

---

## Phase 8 — Project chip + canvas integration

### Task 24: `ProjectChip` component

**Files:**
- Create: `apps/app/src/features/projects/components/ProjectChip.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/app/src/features/projects/components/ProjectChip.tsx
import { useState } from 'react';
import type { ProjectRecord } from '../types/project';
import { focusHome, closeCurrentCanvas } from '../../../lib/windows';
import { EditProjectModal } from './EditProjectModal';
import { DeleteProjectModal } from './DeleteProjectModal';

type Props = {
  project: ProjectRecord;
};

export function ProjectChip({ project }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <div
      className={`project-chip project-color-${project.color}`}
      style={{
        position: 'fixed',
        top: 12,
        left: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        borderRadius: 999,
        background: 'rgba(255,255,255,0.9)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        zIndex: 30,
        backdropFilter: 'blur(8px)',
      }}
    >
      <button
        type="button"
        aria-label="Home"
        onClick={() => void focusHome()}
        style={{ background: 'none', border: 'none', cursor: 'pointer' }}
      >
        <i className="ri-home-2-line" aria-hidden />
      </button>
      <i className={project.icon} aria-hidden style={{ color: 'var(--accent, #3b82f6)' }} />
      <span
        title={project.name}
        style={{
          maxWidth: 220,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontWeight: 600,
        }}
      >
        {project.name}
      </span>
      <button
        type="button"
        aria-label="Project menu"
        onClick={() => setMenuOpen((v) => !v)}
        style={{ background: 'none', border: 'none', cursor: 'pointer' }}
      >
        ⋯
      </button>
      {menuOpen && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            background: 'white',
            border: '1px solid #ddd',
            borderRadius: 6,
            padding: 4,
            minWidth: 160,
          }}
        >
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setEditing(true); }}>
            Edit details…
          </button>
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setDeleting(true); }}>
            Delete project…
          </button>
        </div>
      )}
      {editing && <EditProjectModal project={project} onClose={() => setEditing(false)} />}
      {deleting && (
        <DeleteProjectModal
          project={project}
          onClose={() => setDeleting(false)}
          onDeleted={() => void closeCurrentCanvas()}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update public index**

```ts
// apps/app/src/features/projects/index.ts
export { Home } from './components/Home';
export { ProjectChip } from './components/ProjectChip';
export type { ProjectRecord } from './types/project';
```

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/features/projects/components/ProjectChip.tsx apps/app/src/features/projects/index.ts
git commit -m "feat(canvas): ProjectChip with Home + edit/delete menu"
```

---

### Task 25: Wire `ProjectChip` into Canvas + window-title sync + deleted banner

**Files:**
- Modify: `apps/app/src/Canvas.tsx`
- Create: `apps/app/src/features/projects/components/DeletedBanner.tsx`

The canvas needs to: (a) load its `ProjectRecord` from PB, (b) render `<ProjectChip />`, (c) sync title via `setCanvasTitle` whenever the project realtime-updates, (d) detect `delete` events and show a non-dismissable banner.

- [ ] **Step 1: DeletedBanner**

```tsx
// apps/app/src/features/projects/components/DeletedBanner.tsx
import { focusHome, closeCurrentCanvas } from '../../../lib/windows';

export function DeletedBanner() {
  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        background: '#b00',
        color: 'white',
        padding: '12px 16px',
        textAlign: 'center',
        zIndex: 100,
      }}
    >
      This project no longer exists.{' '}
      <button
        type="button"
        onClick={async () => {
          await focusHome();
          await closeCurrentCanvas();
        }}
        style={{ marginLeft: 8 }}
      >
        Return to Home
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Add a `useProject(id)` hook**

```ts
// apps/app/src/features/projects/api/useProject.ts
import { useEffect, useState } from 'react';
import { pb } from '../../../lib/pb';
import { getProject } from './projects';
import { ProjectRecordSchema, type ProjectRecord } from '../types/project';

type State =
  | { status: 'loading' }
  | { status: 'ready'; project: ProjectRecord }
  | { status: 'deleted' }
  | { status: 'error'; error: Error };

export function useProject(id: string): State {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    getProject(id)
      .then((project) => {
        if (!cancelled) setState({ status: 'ready', project });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // 404 from PB == project deleted
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('404') || /missing/i.test(msg)) {
          setState({ status: 'deleted' });
        } else {
          setState({ status: 'error', error: err instanceof Error ? err : new Error(msg) });
        }
      });

    let unsub: (() => void) | null = null;
    pb.collection('projects')
      .subscribe(id, (e) => {
        if (cancelled) return;
        if (e.action === 'delete') {
          setState({ status: 'deleted' });
          return;
        }
        const parsed = ProjectRecordSchema.safeParse(e.record);
        if (parsed.success) setState({ status: 'ready', project: parsed.data });
      })
      .then((u) => {
        unsub = u as unknown as () => void;
        if (cancelled) unsub?.();
      });

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [id]);

  return state;
}
```

- [ ] **Step 3: Wire into Canvas**

In `Canvas.tsx`, near the top of the `Canvas` function:

```tsx
import { ProjectChip } from './features/projects';
import { useProject } from './features/projects/api/useProject';
import { DeletedBanner } from './features/projects/components/DeletedBanner';
import { setCanvasTitle } from './lib/windows';

// ...inside Canvas:
const projectState = useProject(projectId);

useEffect(() => {
  if (projectState.status !== 'ready') return;
  void setCanvasTitle(projectId, projectState.project.name);
}, [projectId, projectState.status, projectState.status === 'ready' ? projectState.project.name : '']);

if (projectState.status === 'deleted') return <DeletedBanner />;
```

Render `{projectState.status === 'ready' && <ProjectChip project={projectState.project} />}` near the top of the JSX (before the existing `<FloatingSidebar />`).

- [ ] **Step 4: Smoke test**

- Open canvas. Chip shows project name + icon. Window title matches.
- From Home (or another window), rename the project. Chip + window title update without reload.
- Delete the project from another window. Banner appears in the canvas. Click "Return to Home" — canvas closes, Home focuses.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/projects apps/app/src/Canvas.tsx
git commit -m "feat(canvas): mount ProjectChip + sync title + deleted banner"
```

---

## Phase 9 — Thumbnail capture

### Task 26: Pure thumbnail encoder

**Files:**
- Create: `apps/app/src/features/projects/lib/captureThumbnail.ts`
- Test: `apps/app/src/features/projects/lib/captureThumbnail.test.ts`

A pure function: take a source canvas (or HTMLElement to rasterize via `html-to-image`-style ideas — actually we'll use the on-screen canvas LoD layer directly, since it already paints the whole world). For simplicity, accept a `HTMLCanvasElement` and downsample.

- [ ] **Step 1: Write the failing test**

```ts
// apps/app/src/features/projects/lib/captureThumbnail.test.ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { downsampleToBlob, THUMBNAIL_W, THUMBNAIL_H } from './captureThumbnail';

const makeSourceCanvas = (w: number, h: number): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#3b82f6';
  ctx.fillRect(0, 0, w, h);
  return c;
};

describe('downsampleToBlob', () => {
  it('produces a non-empty Blob at target dimensions', async () => {
    const src = makeSourceCanvas(1920, 1080);
    const blob = await downsampleToBlob(src);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(THUMBNAIL_W).toBe(480);
    expect(THUMBNAIL_H).toBe(270);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netrart/app test src/features/projects/lib/captureThumbnail`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// apps/app/src/features/projects/lib/captureThumbnail.ts
export const THUMBNAIL_W = 480;
export const THUMBNAIL_H = 270;
const QUALITY = 0.7;
const MIME_PREFERRED = 'image/webp';
const MIME_FALLBACK = 'image/png';

export async function downsampleToBlob(
  source: HTMLCanvasElement,
): Promise<Blob> {
  const target = document.createElement('canvas');
  target.width = THUMBNAIL_W;
  target.height = THUMBNAIL_H;
  const ctx = target.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, THUMBNAIL_W, THUMBNAIL_H);
  // Aspect-fit the source into the thumbnail
  const sAspect = source.width / source.height;
  const tAspect = THUMBNAIL_W / THUMBNAIL_H;
  let dw = THUMBNAIL_W;
  let dh = THUMBNAIL_H;
  if (sAspect > tAspect) {
    dh = Math.round(THUMBNAIL_W / sAspect);
  } else {
    dw = Math.round(THUMBNAIL_H * sAspect);
  }
  const dx = Math.round((THUMBNAIL_W - dw) / 2);
  const dy = Math.round((THUMBNAIL_H - dh) / 2);
  ctx.drawImage(source, 0, 0, source.width, source.height, dx, dy, dw, dh);
  return await encode(target);
}

const encode = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        canvas.toBlob(
          (fallback) => {
            if (fallback) resolve(fallback);
            else reject(new Error('canvas toBlob produced null'));
          },
          MIME_FALLBACK,
        );
      },
      MIME_PREFERRED,
      QUALITY,
    );
  });
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @netrart/app test src/features/projects/lib/captureThumbnail`
Expected: PASS.

Note: jsdom's `canvas.toBlob` isn't always implemented. If the test fails due to that, gate the assertion: detect missing support and `expect.soft`-skip; the function is exercised in the manual e2e instead. The test exists primarily to lock the export shape (`THUMBNAIL_W`, `THUMBNAIL_H`, `downsampleToBlob`) and catch bad refactors.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/projects/lib/captureThumbnail.ts apps/app/src/features/projects/lib/captureThumbnail.test.ts
git commit -m "feat(projects): pure thumbnail downsample-to-Blob helper"
```

---

### Task 27: `useProjectThumbnail` hook + Canvas wiring

**Files:**
- Create: `apps/app/src/features/projects/hooks/useProjectThumbnail.ts`
- Modify: `apps/app/src/Canvas.tsx`

The canvas is rendered with DOM nodes plus a `<canvas>` LoD layer. For the thumbnail we'll call `html2canvas` — *no, wait.* The codebase doesn't depend on html2canvas, and adding it for a thumbnail is excessive. Simpler: rasterize the existing LoD canvas (which renders the whole world image). Track `LodCanvasRef` exposed by the existing LoD feature.

If no LoD canvas is available (empty viewport / no media), skip the capture (the card will use its color+icon block).

- [ ] **Step 1: Implement**

```ts
// apps/app/src/features/projects/hooks/useProjectThumbnail.ts
import { useEffect, useRef } from 'react';
import { downsampleToBlob } from '../lib/captureThumbnail';
import { uploadThumbnail } from '../api/projects';
import { onCanvasCloseRequested } from '../../../lib/windows';

const PERIODIC_MS = 30_000;

type GetSourceCanvas = () => HTMLCanvasElement | null;

export function useProjectThumbnail(
  projectId: string,
  getSourceCanvas: GetSourceCanvas,
): void {
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const capture = async (): Promise<void> => {
      if (inFlightRef.current) return;
      const source = getSourceCanvas();
      if (!source || source.width === 0 || source.height === 0) return;
      inFlightRef.current = true;
      try {
        const blob = await downsampleToBlob(source);
        if (cancelled) return;
        await uploadThumbnail(projectId, blob);
      } catch (err) {
        console.warn('[thumbnail] capture failed', err);
      } finally {
        inFlightRef.current = false;
      }
    };

    const interval = setInterval(() => void capture(), PERIODIC_MS);

    let cleanupCloseListener: (() => void) | null = null;
    onCanvasCloseRequested(async () => {
      await capture();
    })
      .then((c) => {
        cleanupCloseListener = c;
        if (cancelled) cleanupCloseListener?.();
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      clearInterval(interval);
      cleanupCloseListener?.();
    };
  }, [projectId, getSourceCanvas]);
}
```

- [ ] **Step 2: Wire into Canvas**

In `Canvas.tsx`, find the existing LoD layer mount. The LoD feature exposes a backing `<canvas>` ref via its components (`features/lod`). The simplest path: add a `ref` to the existing canvas element rendered by the LoD layer, expose it from the LoD feature if needed (one-line edit), and pass a getter into `useProjectThumbnail`:

```tsx
import { useProjectThumbnail } from './features/projects/hooks/useProjectThumbnail';

// ... inside Canvas:
const lodCanvasRef = useRef<HTMLCanvasElement | null>(null);
useProjectThumbnail(projectId, () => lodCanvasRef.current);

// ... pass lodCanvasRef into the LoD canvas element via its `ref` prop
```

If the LoD layer does not currently expose a ref handle, add one: the LoD feature root component (`features/lod/index.ts`) can export a `forwardRef`-wrapped variant, or the LoD canvas element can be located in `Canvas.tsx` directly. Pick whichever path matches the existing structure with the smallest diff. If the canvas element is buried deep, a workable shortcut is to query it after mount: `document.querySelector('canvas.lod-layer')` inside `getSourceCanvas`. The class name should be added to the LoD canvas element if not already present.

- [ ] **Step 3: Smoke test (manual)**

- Open a canvas with at least one image visible.
- Wait 30 s. Reload Home in another window — the project card should now render the thumbnail (visible because `useProjects` realtime fired on the `update` event of the `projects` record).
- Close the canvas window. The thumbnail should refresh on Home (close-requested capture fired).

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/features/projects apps/app/src/Canvas.tsx
git commit -m "feat(projects): periodic + on-close thumbnail capture"
```

---

## Phase 10 — Cleanup

### Task 28: Quit confirmation when canvases are open

**Files:**
- Modify: `apps/app/src/features/projects/components/Home.tsx`

When the user closes the Home window (Cmd+W on macOS, X on Win/Linux) while at least one canvas window is open, show a confirm dialog. Cancel keeps Home alive; OK closes Home and lets canvases live as orphans (they remain functional and can be closed individually).

- [ ] **Step 1: Add a close-requested listener for Home**

```tsx
// inside Home.tsx, beside other useEffects
import { useEffect } from 'react';
import { onCanvasCloseRequested, listOpenCanvasLabels } from '../../../lib/windows';

useEffect(() => {
  let cleanup: (() => void) | null = null;
  onCanvasCloseRequested(async () => {
    const open = await listOpenCanvasLabels();
    if (open.length === 0) return;
    const ok = window.confirm(
      `${open.length} project window${open.length === 1 ? '' : 's'} ${open.length === 1 ? 'is' : 'are'} still open.\n\nClose Home anyway?`,
    );
    if (!ok) {
      // The current onCanvasCloseRequested signature destroys after the
      // handler resolves; throw so the wrapper aborts the destroy.
      throw new Error('cancel');
    }
  })
    .then((c) => {
      cleanup = c;
    })
    .catch(() => {});
  return () => cleanup?.();
}, []);
```

This requires `lib/windows.ts → onCanvasCloseRequested` to NOT destroy the window if the handler throws. Update the handler:

```ts
// in lib/windows.ts onCanvasCloseRequested:
const unlisten = await cur.onCloseRequested(async (event) => {
  event.preventDefault();
  try {
    await handler();
    await cur.destroy();
  } catch {
    // Handler aborted the close; leave window alive.
  }
});
```

Note: `onCanvasCloseRequested` is also used by canvas windows for thumbnail capture — the thumbnail handler should not throw in normal flow, so the abort branch is reserved for explicit cancels like Home's confirm.

- [ ] **Step 2: Commit**

```bash
git add apps/app/src/lib/windows.ts apps/app/src/features/projects/components/Home.tsx
git commit -m "feat(home): confirm before closing Home with canvases open"
```

---

### Task 29: Manual e2e checklist + README

**Files:**
- Create: `apps/app/src/features/projects/README.md`

- [ ] **Step 1: Write the README**

```md
<!-- apps/app/src/features/projects/README.md -->
# features/projects

Owns NetraRT's multi-project surface: the Home window, project CRUD, the in-canvas `<ProjectChip />`, per-project saved tags, and the project thumbnail pipeline.

## Public API (via `index.ts`)

- `<Home />` — top-level project picker. Mounted by `main.tsx` when no `?project=` is in the URL.
- `<ProjectChip />` — top-left chip rendered inside the canvas. Owns rename/edit/delete affordances.
- `ProjectRecord` — the type for a project row.

## Manual e2e checklist

Run `pnpm tauri:dev`, then walk through:

- [ ] App launches into the Home window. Default Project card is visible.
- [ ] **Create**: Click "New project", type a name, hit Enter. A new canvas window opens with that project's name in the title bar and the chip top-left.
- [ ] **Open existing**: From Home, click the Default Project card. A canvas window opens (or focuses if already open).
- [ ] **No duplicates**: Click the same card twice — only one window exists for that project; the second click focuses the first.
- [ ] **Edit details from Home**: Open card menu → "Edit details…", change color/icon/labels, save. Card reflects the change.
- [ ] **Edit details from canvas**: Open `<ProjectChip />` menu → "Edit details…", change name. Title bar + chip update without reload.
- [ ] **Delete from Home**: Create a throwaway project, add an image, then delete from Home (type the name to confirm). Cascade drops the image; Default Project's media is unaffected.
- [ ] **Delete from canvas**: Open the throwaway project's canvas, then `<ProjectChip />` menu → "Delete project…". Banner appears in the canvas; window closes; Home reflects the removal.
- [ ] **Saved tags are per-project**: In project A, label an image "cells". In project B, the saved-tag autocomplete should not surface "cells".
- [ ] **Theme stays global**: Toggle theme in one canvas; another canvas reflects it on next paint.
- [ ] **Thumbnail capture**: Add an image to a canvas, wait ~30 s. The Home card thumbnail updates.
- [ ] **Thumbnail on close**: Close a canvas window. The Home card thumbnail refreshes.
- [ ] **Quit confirm**: With at least one canvas open, attempt to close Home. Confirm prompt appears.
- [ ] **First-launch migration** (clean DB): Drop `pb_data`, restart, run migrations. A Default Project exists; legacy `localStorage` saved tags (if any) migrate into the project's `tags` collection on first canvas open; the legacy key is cleared.
- [ ] **Web fallback**: `pnpm dev:app` opens Home at `/`; clicking a card navigates to `/?project=<id>`; the Home button in the chip navigates back.
```

- [ ] **Step 2: Commit**

```bash
git add apps/app/src/features/projects/README.md
git commit -m "docs(projects): manual e2e checklist + README"
```

---

### Task 30: Final lint + typecheck + test sweep

- [ ] **Step 1: Run the full sweep**

```bash
pnpm lint
pnpm typecheck
pnpm --filter @netrart/app test
```

Expected: all green.

- [ ] **Step 2: Tauri build smoke**

Run: `pnpm tauri:dev`, exercise the manual e2e checklist end-to-end.

- [ ] **Step 3: Final commit (if any cleanup made)**

```bash
git add -u
git commit -m "chore(projects): final cleanup after multi-project rollout"
```

---

## Self-review

This is the `writing-plans` self-review pass on the plan above.

**1. Spec coverage**

| Spec section | Plan coverage |
|---|---|
| `projects` collection + Default Project seed | Task 1 |
| `project` FK on images/videos/segmentations + backfill | Task 2 |
| `tags` collection (per-project) | Task 3 |
| Per-project active indexes | Task 4 |
| `lib/projectId.ts` | Task 5 |
| `lib/pb.ts` refactor (projectId everywhere) | Task 6 + Task 7 |
| `main.tsx` branching on `?project=` | Task 8 |
| `App.tsx` accepts `projectId` | Task 7 (also touched in Task 8) |
| Tauri capability changes | Task 9 |
| `lib/windows.ts` (open canvas / focus home / set title / close requested / list canvases) | Task 10 |
| Project types + CRUD api + realtime hook | Tasks 11–13 |
| Home shell + grid + cards | Tasks 14, 17 |
| ColorPicker + IconPicker | Task 15 |
| NewProjectModal | Task 16 |
| EditProjectModal | Task 18 |
| DeleteProjectModal (type-to-confirm) | Task 19 |
| Search + sort + label filter | Task 20 |
| `useOpenProject` hook | Task 16 (created), threaded into ProjectCard in Task 17 |
| Saved-tags rewrite to PB + legacy migration | Tasks 21–23 |
| ProjectChip + window-title sync + deleted banner | Tasks 24–25 |
| Thumbnail encoder + hook | Tasks 26–27 |
| Quit confirmation | Task 28 |
| Manual e2e checklist | Task 29 |
| Final sweep | Task 30 |

All spec sections covered.

**2. Placeholder scan**

No `TBD`, no `TODO`, no "implement later". Each task has actual code, exact paths, exact commands, expected outputs.

**3. Type consistency**

- `ProjectColor` / `ProjectIcon` consts defined in Task 11 are consumed unchanged in 15, 16, 18.
- `ProjectRecord` is imported from `'../types/project'` in every task that uses it.
- `useSavedTags` signature changes from `()` to `(projectId: string)` — applied in Task 23, the only caller (`Canvas.tsx`) is updated in the same task.
- `lib/windows.ts` exports (`openCanvasWindow`, `focusHome`, `setCanvasTitle`, `onCanvasCloseRequested`, `closeCurrentCanvas`, `listOpenCanvasLabels`) are defined in Task 10 and consumed unchanged in Tasks 16, 24, 25, 27, 28.
- `pb.ts` schemas gain `project: z.string()` in Task 6; downstream consumers in segmentation feature update in Task 7.
- `onCanvasCloseRequested`'s "throw to abort close" semantics are introduced in Task 28; this is a forward-compatible change to the Task 10 implementation. The Task 27 thumbnail handler does not throw under normal conditions, so its semantics are unchanged. Both consumers are kept in sync within Task 28.

**Note on inline edit in Task 28:** `lib/windows.ts → onCanvasCloseRequested` is updated to wrap the destroy in a try/catch around the handler. The Task 10 version unconditionally destroys; Task 28 makes destroy contingent on handler success. This is the only place a function defined earlier is later modified — flagged here so the executor doesn't miss it.

---

## Plan complete

Plan complete and saved to `docs/superpowers/plans/2026-04-25-multi-project-canvas.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
