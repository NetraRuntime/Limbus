# Filename Badge Auto-Placement — Design

**Date:** 2026-04-22
**Scope:** When a canvas item's filename label would sit on top of another media item that is painted above it, the label relocates to the first of four corner positions that is clear (`tl → tr → bl → br`).
**Non-goals:** Collision between labels themselves; rotated/vertical labels; inside-the-image placement; animation of the flip; placement for non-media HUD elements.

## Goal

Make filename labels stay visually attached to their own media even when items are densely arranged. Today every `.media-label` renders at the top-left corner of its image, offset 6px upward. When another image or video sits directly above that corner and is painted on top in `stackOrder`, the label text lands over the neighboring item's pixels and looks like it belongs to the wrong item. This design picks a clearer corner automatically.

## Success criteria

1. For each visible media item, the filename label renders in the first corner (tl → tr → bl → br) whose world-space rectangle does not intersect any media with a strictly higher `stackOrder` rank.
2. If all four corners are blocked, the label falls back to `tl` (the current default) so the label is never hidden.
3. Label placement updates live during drag, without flicker, and without a second layout pass.
4. A pure helper `computeLabelPlacements(…)` is unit-tested with coverage for: clear default, default-blocked, default-and-right-blocked, all-blocked, lower-ranked neighbors ignored.
5. No regression in the constant-pixel-size behavior of labels under zoom (the inv-scale trick still holds in all four variants).

## Non-goals

- Labels do not try to avoid other labels, only image/video rects.
- Labels never go inside an image's interior.
- No animated flip; placement may snap from one corner to another on pointer move.

## Architecture

Four surfaces touched:

- **`apps/app/package.json`** — add `@chenglou/pretext` as a dependency.
- **`apps/app/src/lib/labelMetrics.ts`** (new) — module-level text measurement using pretext. Exports:
  - `LABEL_FONT`, `LABEL_HEIGHT_PX`, `LABEL_GAP_PX`, `LABEL_MAX_OUTER_PX`.
  - `labelOuterWidth(name: string): number` — memoized; returns the label's outer CSS width in pixels (text + 14px horizontal padding + 2px border, clamped to `LABEL_MAX_OUTER_PX = 320`).
- **`apps/app/src/lib/labelPlacement.ts`** (new) — pure function:
  ```ts
  export type LabelPlacement = 'tl' | 'tr' | 'bl' | 'br'
  export type PlacementInput = {
    items: Array<Pick<CanvasMedia, 'id' | 'x' | 'y' | 'width' | 'height' | 'name'>>
    rank: (id: string) => number            // higher = painted on top
    scale: number                            // view.scale
    labelWidth: (name: string) => number     // returns label outer px width; injected for testability
  }
  export function computeLabelPlacements(input: PlacementInput): Map<string, LabelPlacement>
  ```
  Runs once per call, O(n²) worst case over `items`. Returns a placement per item id. `labelWidth` is injected rather than imported directly so tests can run without pretext's canvas measurement path; `Canvas.tsx` passes in `labelOuterWidth` from `labelMetrics.ts`.
- **`apps/app/src/Canvas.tsx`** — introduce a `labelPlacements` `useMemo` over `paintMedia`, `stackOrder`, and `view.scale`. Threads a `placement` prop through `<MediaItem>` → the label element as `data-placement`.
- **`apps/app/src/App.css`** — add three placement variants for `.media-label` (default stays `tl`). Each variant sets the matching `transform-origin`, `left`/`top` anchor interpretation, and translate direction.

No changes to `InfiniteCanvas`, upload logic, context menu, sidebar, or HighlightInput.

## Data flow

```
visibleMedia + stackOrder + view.scale
        │
        ▼
computeLabelPlacements()  ─── uses labelOuterWidth(name) (memoized via pretext)
        │
        ▼
Map<id, 'tl'|'tr'|'bl'|'br'>
        │
        ▼
<MediaItem placement={…} />
        │
        ▼
.media-label[data-placement="…"]  ─── CSS picks variant
```

Only pure arithmetic — no DOM reads, no `getBoundingClientRect`, no effects.

## Placement algorithm

For each item `i` in `visibleMedia`:

1. Let `ri = rank(i.id)` (from `stackOrder`; higher = painted on top).
2. Let `Ww = labelOuterWidth(i.name) / scale`, `Hw = 19 / scale`, `gapW = 6 / scale` (world-space sizes of the label and gap).
3. Compute the four candidate AABBs in world space:
   - `tl`: `(i.x,                 i.y - Hw - gapW,   Ww, Hw)`
   - `tr`: `(i.x + i.width - Ww,  i.y - Hw - gapW,   Ww, Hw)`
   - `bl`: `(i.x,                 i.y + i.height + gapW, Ww, Hw)`
   - `br`: `(i.x + i.width - Ww,  i.y + i.height + gapW, Ww, Hw)`
4. For each candidate in that order, test AABB intersection against the image rect `(j.x, j.y, j.width, j.height)` of every other visible item `j` where `rank(j.id) > ri`. The first candidate with no intersection wins.
5. If all four intersect something, return `tl` (default).

"Higher-stacked" is evaluated against the same `visibleMedia` set used for rendering — off-screen items don't count, matching user perception.

## CSS variants

The current rule is `tl`:

```css
.media-label {
  position: absolute;
  transform-origin: bottom left;
  transform: translateY(calc(-100% - var(--inv-view-scale, 1) * 6px))
             scale(var(--inv-view-scale, 1));
  /* left/top set inline to image's top-left corner */
}
```

Three new rules:

```css
.media-label[data-placement="tr"] {
  transform-origin: bottom right;
  transform: translate(-100%, calc(-100% - var(--inv-view-scale, 1) * 6px))
             scale(var(--inv-view-scale, 1));
  /* left/top set inline to image's top-right corner */
}
.media-label[data-placement="bl"] {
  transform-origin: top left;
  transform: translateY(calc(var(--inv-view-scale, 1) * 6px))
             scale(var(--inv-view-scale, 1));
  /* left/top set inline to image's bottom-left corner */
}
.media-label[data-placement="br"] {
  transform-origin: top right;
  transform: translate(-100%, calc(var(--inv-view-scale, 1) * 6px))
             scale(var(--inv-view-scale, 1));
  /* left/top set inline to image's bottom-right corner */
}
```

The `translate(-100%, …)` in `tr`/`br` uses the label's own layout width, so no JS-measured width needs to leak into CSS. `transform-origin` is updated so that `scale(var(--inv-view-scale))` shrinks toward the anchor corner, keeping the label at constant screen pixel size across zoom in every variant.

In `MediaItem`, the label's inline `left`/`top` change per placement:

| Placement | `left` | `top` |
|---|---|---|
| `tl` (default) | `m.x` | `m.y` |
| `tr` | `m.x + m.width` | `m.y` |
| `bl` | `m.x` | `m.y + m.height` |
| `br` | `m.x + m.width` | `m.y + m.height` |

## Text measurement with pretext

```ts
// apps/app/src/lib/labelMetrics.ts
import { prepareWithSegments, measureNaturalWidth } from '@chenglou/pretext'

export const LABEL_FONT = '500 9px ui-monospace, SFMono-Regular, Menlo, monospace'
export const LABEL_HEIGHT_PX = 19       // 13 line-height + 4 padding + 2 border
export const LABEL_GAP_PX = 6
export const LABEL_MAX_OUTER_PX = 320   // matches CSS max-width (border-box)
const PADDING_BORDER_PX = 16            // 14 padding + 2 border

const widthCache = new Map<string, number>()

export function labelOuterWidth(name: string): number {
  const hit = widthCache.get(name)
  if (hit !== undefined) return hit
  const text = measureNaturalWidth(prepareWithSegments(name, LABEL_FONT))
  const outer = Math.min(LABEL_MAX_OUTER_PX, Math.ceil(text) + PADDING_BORDER_PX)
  widthCache.set(name, outer)
  return outer
}
```

- `LABEL_FONT` must match the CSS exactly. If the design system's mono stack ever changes, update here in lockstep; a TODO comment in the file notes this.
- Cache is keyed by `name` only because the font is static. Names repeat across the canvas (duplicates use the original name) so the cache amortizes well.

## Integration in `Canvas.tsx`

- New `useMemo`:
  ```ts
  const labelPlacements = useMemo(() => {
    const rankMap = new Map<string, number>()
    stackOrder.forEach((id, i) => rankMap.set(id, i))
    return computeLabelPlacements({
      items: paintMedia,
      rank: (id) => rankMap.get(id) ?? -1,
      scale: view.scale,
    })
  }, [paintMedia, stackOrder, view.scale])
  ```
- `<MediaItem>` accepts a new prop `placement: LabelPlacement`. Label JSX emits `data-placement={placement}` and computes `left`/`top` from the table above.
- Unranked items (those not yet in `stackOrder`) get rank `-1`, so they're never considered "higher" than anyone else; conversely, items ranked lower than them (none) means their default `tl` always wins.

## Edge cases

- **Pending uploads.** Same rules. `m.x/m.y/m.width/m.height` are set on draft creation, so placement is valid from the first frame.
- **Active (selected) labels.** `.media-label.is-active` has `z-index: 3` and is always on top — placement still flips for readability, independent of z-order.
- **Single item on canvas.** No higher-stacked neighbors → always `tl`.
- **Identical names across items.** Cache works; ties in `stackOrder` never exist (ids are unique).
- **Very long names.** Clamped to `LABEL_MAX_OUTER_PX`; CSS `text-overflow: ellipsis` truncates visually. The placement uses the clamped width, matching reality.
- **Extreme zoom-out.** `Ww = outerPx / scale` grows; labels overlap more neighbors and fall back to `tl`. Acceptable — the labels are already unreadable at that zoom.
- **Drag.** `paintMedia` updates every move; `labelPlacements` recomputes in the same render. Cost is a few tens of items × 4 candidates × handful of higher neighbors — sub-millisecond.
- **Name changes.** Currently impossible (name comes from the uploaded file and is never edited). If editing arrives later, cache invalidation must accompany it.

## Testing

One unit test file: `apps/app/src/lib/labelPlacement.test.ts` (Vitest).

- `empty input returns empty map`
- `single item → tl`
- `neighbor above but lower-ranked → tl` (proves rank check, not just intersection)
- `neighbor above and higher-ranked → tr`
- `neighbors blocking top-left and top-right → bl`
- `all four corners blocked → tl fallback`
- `identical rank treated as "not higher"` (strict inequality)
- `scale affects label world size` (zoom-out blocks more candidates)

Measurement is stubbed via a fake `labelOuterWidth` passed in, or `labelPlacement.ts` accepts a `labelWidth(name)` callback in `PlacementInput` so the test never depends on pretext.

## Risks / tradeoffs

- **Pretext adds a dependency.** Mitigation: it's tiny, tree-shakeable, does not need DOM, and avoids reflow. The alternative (approx text width) would flip too eagerly for short names.
- **Font string drift.** If the CSS mono font stack diverges from `LABEL_FONT`, measurements skew. Mitigation: colocated constant + comment; consider reading from a shared design token in a follow-up.
- **Placement pops on drag.** As items slide past each other, labels may jump corners mid-drag. This is the intended feedback ("your label is clear") but reads as motion. If this feels jarring in practice, a future iteration can add a short CSS transition on `left`/`top`, or freeze placements during the current drag. Not scoped here.

## Rollout

Single PR, no flag. Feature is invisible when there are no overlaps and degrades gracefully to `tl` when everything is blocked — no user opt-in required.
