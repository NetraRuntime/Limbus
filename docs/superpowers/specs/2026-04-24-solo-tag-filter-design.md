# Solo-Tag Filter for the Active Image

## Problem

An image with many segmentation tags becomes visually noisy: every ready tag's
masks and at-rest bounding boxes render on top of the image at once. The user
asked for a quick way to focus on a single tag — clicking one label should
leave that tag's overlays on and hide the rest.

## Interaction Contract

- Click a row in `MediaTagList` → that tag becomes **solo**: only its masks and
  bboxes render for the active image. All other tags' overlays hide.
- Click the same row again → clear solo (all tags visible).
- Click a different row → swap solo to that tag.
- Click empty canvas or press Esc (via the existing `clearSelection` path) →
  clear solo.
- Switching the active image → clear solo.
- Non-active images are unaffected (solo only applies to the currently active
  image; the tag list is only visible for that image anyway).

## Scope

- Single-select soloing only. Multi-select / hide-specific-tags is out of
  scope.
- No persistence across sessions. No URL state. The filter is a transient
  viewing aid.
- Non-active images keep rendering every ready tag's bboxes, as today.

## State

One new piece of state in `Canvas.tsx`:

```ts
const [soloTag, setSoloTag] = useState<string | null>(null);
```

Tag comparison is case-insensitive (matches the existing `tag.toLowerCase()`
pattern used throughout Canvas).

Lifecycle:

- `useEffect` on `activeMedia?.id` → clears `soloTag` when the active image
  changes.
- Existing `clearSelection` helper → also calls `setSoloTag(null)` so Esc and
  empty-canvas clicks restore visibility.
- If the currently selected/hovered mask belongs to a tag that's being
  filtered out, treat selection/hover as null during render. Also clear
  `selectedMask`/`hoveredMask` when `soloTag` changes to avoid stale chrome
  pointing at a hidden mask.

## Rendering Filters

All filters are **gated by `m.id === activeMedia?.id`** — only the active
image is affected.

1. **Masks passed to `SegmentBakeLayer`** (Canvas.tsx ~line 589): filter to
   the solo tag when set. The bake cache already rekeys on the mask
   signature, so it recomposites automatically.
2. **At-rest bboxes** (lines ~2614–2670): skip entries whose
   `tag.toLowerCase() !== soloTag.toLowerCase()` for the active image.
3. **Selected / hover chrome** (lines ~2673+): if the selected or hovered
   mask's tag doesn't match solo, render nothing for that chrome (but keep
   the underlying state — it just becomes invisible until solo is cleared).

## MediaTagList Changes

`components/MediaTagList.tsx` gains two optional props:

```ts
onSelect?: (tag: string) => void;
soloTag?: string | null;
```

- The row `<button>` wires `onClick={() => onSelect?.(entry.tag)}`. Keyboard:
  Enter/Space already trigger click on a button, so no extra handling needed.
  Delete/Backspace still calls `onRemove`.
- Visual state (CSS in `App.css`):
  - `soloTag == null` → rows render as today.
  - `soloTag === entry.tag` → row gets an "active" outline (stronger border
    using the tag accent color).
  - `soloTag && soloTag !== entry.tag` → row is dimmed (reduced opacity) to
    signal it's hidden on the canvas.

## Testing

- Existing `SegmentBakeLayer` tests remain green: the bake layer's contract is
  unchanged, filtering happens upstream in Canvas.
- No new unit tests. Verification is by running the app and exercising:
  1. Image with two+ tags: click tag A → only A visible; click A again → both
     visible.
  2. Click A, then click B → only B visible.
  3. Click A, press Esc → all visible.
  4. Click A, click empty canvas → all visible (deselects + clears solo).
  5. Click A, switch to a different image → new image shows all its tags;
     returning to the first image also shows all (solo cleared).

## Files Touched

- `apps/app/src/Canvas.tsx` — state, clear hooks, rendering filters.
- `apps/app/src/components/MediaTagList.tsx` — click prop + active styling
  hook.
- `apps/app/src/App.css` — `.media-tag-row.is-solo` and
  `.media-tag-row.is-dimmed` styles.
