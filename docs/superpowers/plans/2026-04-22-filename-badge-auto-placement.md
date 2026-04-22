# Filename Badge Auto-Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-relocate each canvas item's filename label to the first of four corner positions (`tl → tr → bl → br`) that is clear of any higher-stacked media in `stackOrder`, so labels never land on top of media painted above them.

**Architecture:** A pure `computeLabelPlacements()` helper, driven by `visibleMedia + stackOrder + view.scale`, returns a `Map<id, 'tl'|'tr'|'bl'|'br'>`. Label outer widths come from `@chenglou/pretext` (DOM-free, reflow-free), memoized by `name`. `MediaItem` receives `placement` and renders the label with a `data-placement` attribute; CSS has four variants that preserve the existing inv-scale constant-pixel-size behavior.

**Tech Stack:** React 18, TypeScript, Vite, Vitest (new), `@chenglou/pretext` (new).

**Spec:** `docs/superpowers/specs/2026-04-22-filename-badge-auto-placement-design.md`

---

## File Structure

- **Create `apps/app/src/lib/labelMetrics.ts`** — font constants, `labelOuterWidth(name)` memoized via pretext.
- **Create `apps/app/src/lib/labelPlacement.ts`** — pure `computeLabelPlacements()` helper.
- **Create `apps/app/src/lib/labelPlacement.test.ts`** — vitest unit tests.
- **Create `apps/app/vitest.config.ts`** — minimal vitest config (first test file in the repo).
- **Modify `apps/app/package.json`** — add `@chenglou/pretext`, `vitest`; add `test` script.
- **Modify `apps/app/src/Canvas.tsx`** — new `labelPlacements` memo; thread `placement` through `<MediaItem>`; label `left`/`top` depend on placement.
- **Modify `apps/app/src/App.css`** — add three placement variants on `.media-label`.

---

## Task 1: Install dependencies and set up Vitest

**Files:**
- Modify: `apps/app/package.json`
- Create: `apps/app/vitest.config.ts`

- [ ] **Step 1: Add dependencies**

Run from repo root:

```bash
pnpm --filter @netrart/app add @chenglou/pretext
pnpm --filter @netrart/app add -D vitest@^2
```

- [ ] **Step 2: Add a `test` script**

Edit `apps/app/package.json` — in `"scripts"` add `"test": "vitest run"` and `"test:watch": "vitest"` immediately after `"typecheck"`.

- [ ] **Step 3: Create the vitest config**

Create `apps/app/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

(No jsdom — the placement logic is pure; the only test file added in this plan does not touch the DOM.)

- [ ] **Step 4: Verify the runner boots on an empty suite**

Run:

```bash
pnpm --filter @netrart/app test
```

Expected: vitest exits with "No test files found" (no failure). If it errors on a missing config, re-check `vitest.config.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/app/package.json apps/app/vitest.config.ts pnpm-lock.yaml
git commit -m "chore(app): add @chenglou/pretext and vitest"
```

---

## Task 2: Write failing test for `computeLabelPlacements`

**Files:**
- Create: `apps/app/src/lib/labelPlacement.test.ts`

- [ ] **Step 1: Write the test file**

Create `apps/app/src/lib/labelPlacement.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  computeLabelPlacements,
  type PlacementInput,
} from './labelPlacement';

// Test helpers ---------------------------------------------------------------

type Item = PlacementInput['items'][number];
const item = (
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  name = id,
): Item => ({ id, x, y, width: w, height: h, name });

// Fixed label width so tests don't depend on pretext.
const fixedLabel = () => 100; // 100px outer label width
const base = {
  scale: 1 as const,
  labelWidth: fixedLabel,
};

const withRank = (order: string[]) => (id: string) =>
  order.indexOf(id); // -1 if missing → behaves as "not ranked"

// Cases ----------------------------------------------------------------------

describe('computeLabelPlacements', () => {
  it('returns empty map for no items', () => {
    const out = computeLabelPlacements({
      items: [],
      rank: () => -1,
      ...base,
    });
    expect(out.size).toBe(0);
  });

  it('single item gets tl', () => {
    const out = computeLabelPlacements({
      items: [item('a', 0, 0, 200, 200)],
      rank: withRank(['a']),
      ...base,
    });
    expect(out.get('a')).toBe('tl');
  });

  it('ignores a lower-ranked neighbor overlapping the default slot', () => {
    // "b" is above "a" in screen space, but ranked BELOW "a" in stackOrder.
    // b does NOT paint over a's label, so a's default tl stays.
    const items = [
      item('a', 0, 200, 400, 200),
      item('b', 0, 0, 400, 180), // occupies a's tl zone
    ];
    const out = computeLabelPlacements({
      items,
      rank: withRank(['b', 'a']), // a is on top of b
      ...base,
    });
    expect(out.get('a')).toBe('tl');
  });

  it('flips to tr when a higher-ranked neighbor blocks tl', () => {
    const items = [
      item('a', 0, 200, 400, 200),
      // b overlaps a's tl label rect (label sits ~19px above a, left-aligned).
      // b is ranked above a.
      item('b', 0, 150, 120, 60),
    ];
    const out = computeLabelPlacements({
      items,
      rank: withRank(['a', 'b']),
      ...base,
    });
    expect(out.get('a')).toBe('tr');
  });

  it('flips to bl when both tl and tr are blocked above', () => {
    const items = [
      item('a', 0, 200, 400, 200),
      item('b', 0, 150, 120, 60),     // blocks tl
      item('c', 280, 150, 120, 60),   // blocks tr (label right-aligned)
    ];
    const out = computeLabelPlacements({
      items,
      rank: withRank(['a', 'b', 'c']),
      ...base,
    });
    expect(out.get('a')).toBe('bl');
  });

  it('flips to br when tl, tr, and bl are blocked', () => {
    const items = [
      item('a', 0, 200, 400, 200),
      item('b', 0, 150, 120, 60),     // blocks tl
      item('c', 280, 150, 120, 60),   // blocks tr
      item('d', 0, 405, 120, 60),     // blocks bl (below a)
    ];
    const out = computeLabelPlacements({
      items,
      rank: withRank(['a', 'b', 'c', 'd']),
      ...base,
    });
    expect(out.get('a')).toBe('br');
  });

  it('falls back to tl when all four corners are blocked', () => {
    const items = [
      item('a', 0, 200, 400, 200),
      item('b', 0, 150, 120, 60),
      item('c', 280, 150, 120, 60),
      item('d', 0, 405, 120, 60),
      item('e', 280, 405, 120, 60),
    ];
    const out = computeLabelPlacements({
      items,
      rank: withRank(['a', 'b', 'c', 'd', 'e']),
      ...base,
    });
    expect(out.get('a')).toBe('tl');
  });

  it('treats equal rank as "not higher" (strict inequality)', () => {
    // Two items with identical rank; neither obstructs the other.
    const items = [
      item('a', 0, 200, 400, 200),
      item('b', 0, 150, 120, 60),
    ];
    const out = computeLabelPlacements({
      items,
      rank: () => 0,
      ...base,
    });
    expect(out.get('a')).toBe('tl');
  });

  it('scale shrinks the label world-rect, freeing up candidates', () => {
    // At scale=1, b blocks a's tl (label is 100px wide, 19px tall in world).
    // At scale=10, label's world width is 10px — narrow enough that the
    // left-anchored tl rect misses b's right edge.
    const items = [
      item('a', 0, 200, 400, 200),
      item('b', 40, 150, 200, 60), // blocks tl at scale=1, leaves gap at scale=10
    ];
    const rank = withRank(['a', 'b']);
    const zoomedIn = computeLabelPlacements({
      items,
      rank,
      scale: 10,
      labelWidth: fixedLabel,
    });
    // Label world width at scale=10: 100/10 = 10. tl rect: (0, 198.1, 10, 1.9).
    // b rect: (40, 150, 200, 60). No overlap in X → tl free.
    expect(zoomedIn.get('a')).toBe('tl');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails for the right reason**

```bash
pnpm --filter @netrart/app test
```

Expected: fails with module resolution error ("Cannot find module './labelPlacement'") — proves the test file is wired up but the implementation doesn't exist yet.

- [ ] **Step 3: Commit the failing test**

```bash
git add apps/app/src/lib/labelPlacement.test.ts
git commit -m "test(app): add failing tests for computeLabelPlacements"
```

---

## Task 3: Implement `computeLabelPlacements`

**Files:**
- Create: `apps/app/src/lib/labelPlacement.ts`

- [ ] **Step 1: Write the implementation**

Create `apps/app/src/lib/labelPlacement.ts`:

```ts
// Placement algorithm for canvas filename labels. Pure — no DOM, no React.
// See docs/superpowers/specs/2026-04-22-filename-badge-auto-placement-design.md

export type LabelPlacement = 'tl' | 'tr' | 'bl' | 'br';

export type PlacementItem = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
};

export type PlacementInput = {
  items: PlacementItem[];
  rank: (id: string) => number;           // higher = painted on top; -1 = unranked
  scale: number;                           // view.scale (CSS px per world unit)
  labelWidth: (name: string) => number;    // label outer width in CSS px
};

// Constants mirrored from App.css .media-label.
// 13px line-height + 2*2px padding + 2*1px border = 19px outer height.
// 6px vertical gap between label and image edge (in screen pixels).
const LABEL_HEIGHT_PX = 19;
const LABEL_GAP_PX = 6;

type Rect = { x: number; y: number; w: number; h: number };

const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

const CANDIDATES: LabelPlacement[] = ['tl', 'tr', 'bl', 'br'];

const candidateRect = (
  placement: LabelPlacement,
  item: PlacementItem,
  labelW: number,
  labelH: number,
  gap: number,
): Rect => {
  switch (placement) {
    case 'tl':
      return { x: item.x, y: item.y - labelH - gap, w: labelW, h: labelH };
    case 'tr':
      return {
        x: item.x + item.width - labelW,
        y: item.y - labelH - gap,
        w: labelW,
        h: labelH,
      };
    case 'bl':
      return {
        x: item.x,
        y: item.y + item.height + gap,
        w: labelW,
        h: labelH,
      };
    case 'br':
      return {
        x: item.x + item.width - labelW,
        y: item.y + item.height + gap,
        w: labelW,
        h: labelH,
      };
  }
};

export function computeLabelPlacements(
  input: PlacementInput,
): Map<string, LabelPlacement> {
  const { items, rank, scale, labelWidth } = input;
  const out = new Map<string, LabelPlacement>();
  if (items.length === 0) return out;

  const labelHw = LABEL_HEIGHT_PX / scale;
  const gapW = LABEL_GAP_PX / scale;

  for (const item of items) {
    const ri = rank(item.id);
    const labelWw = labelWidth(item.name) / scale;

    // Higher-stacked neighbors' image rects (strict inequality).
    const higher: Rect[] = [];
    for (const other of items) {
      if (other.id === item.id) continue;
      if (rank(other.id) <= ri) continue;
      higher.push({
        x: other.x,
        y: other.y,
        w: other.width,
        h: other.height,
      });
    }

    let picked: LabelPlacement = 'tl';
    if (higher.length > 0) {
      let found: LabelPlacement | null = null;
      for (const cand of CANDIDATES) {
        const r = candidateRect(cand, item, labelWw, labelHw, gapW);
        let hit = false;
        for (const h of higher) {
          if (intersects(r, h)) {
            hit = true;
            break;
          }
        }
        if (!hit) {
          found = cand;
          break;
        }
      }
      picked = found ?? 'tl';
    }

    out.set(item.id, picked);
  }

  return out;
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
pnpm --filter @netrart/app test
```

Expected: all 9 tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/lib/labelPlacement.ts
git commit -m "feat(app): add computeLabelPlacements pure helper"
```

---

## Task 4: Implement `labelMetrics.ts`

**Files:**
- Create: `apps/app/src/lib/labelMetrics.ts`

- [ ] **Step 1: Write the module**

Create `apps/app/src/lib/labelMetrics.ts`:

```ts
// Text measurement for .media-label, using @chenglou/pretext.
//
// IMPORTANT: keep LABEL_FONT and LABEL_LETTER_SPACING in lockstep with the
// .media-label CSS rule in App.css. Pretext can't see CSS; drift will skew
// the placement decision and occasionally flip labels that would've looked
// fine (or vice versa).

import { prepareWithSegments, measureNaturalWidth } from '@chenglou/pretext';

// Matches `font: 500 9px/13px var(--font-mono)` where --font-mono is
// `"Space Mono", ui-monospace, SFMono-Regular, Menlo, monospace`.
// Pretext's `font` is canvas-font shorthand (no line-height).
export const LABEL_FONT =
  '500 9px "Space Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const LABEL_LETTER_SPACING = -0.1;

// .media-label: padding 2px 7px + border 1px ⇒ 14px + 2px = 16px of chrome.
const PADDING_BORDER_PX = 16;

// Matches CSS `max-width: 320px` (box-sizing: border-box, set globally in
// packages/design-system/kit.css).
export const LABEL_MAX_OUTER_PX = 320;

const widthCache = new Map<string, number>();

export function labelOuterWidth(name: string): number {
  const hit = widthCache.get(name);
  if (hit !== undefined) return hit;
  const prepared = prepareWithSegments(name, LABEL_FONT, {
    letterSpacing: LABEL_LETTER_SPACING,
  });
  const text = measureNaturalWidth(prepared);
  const outer = Math.min(LABEL_MAX_OUTER_PX, Math.ceil(text) + PADDING_BORDER_PX);
  widthCache.set(name, outer);
  return outer;
}

// Exposed for tests / dev tools only.
export function _clearLabelWidthCache(): void {
  widthCache.clear();
}
```

- [ ] **Step 2: Verify it type-checks**

Run:

```bash
pnpm --filter @netrart/app typecheck
```

Expected: zero errors. If pretext types are missing, check that the package installed correctly (`pnpm --filter @netrart/app list @chenglou/pretext`).

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/lib/labelMetrics.ts
git commit -m "feat(app): measure label widths via pretext"
```

---

## Task 5: Thread `placement` through `MediaItem`

**Files:**
- Modify: `apps/app/src/Canvas.tsx`

- [ ] **Step 1: Update `MediaItemProps` and the component**

In `apps/app/src/Canvas.tsx`, edit the block starting `type MediaItemProps = {` (around line 240) and the `MediaItem` component (around line 253).

Add the import at the top (near the existing `./components/SearchPalette` import, sorted):

```ts
import type { LabelPlacement } from './lib/labelPlacement';
```

Then:

Replace the `MediaItemProps` type to add `placement`:

```ts
type MediaItemProps = {
  m: CanvasMedia;
  isActive: boolean;
  placement: LabelPlacement;
  onEnter: (id: string) => void;
  onLeave: () => void;
  onClick: (e: React.MouseEvent, id: string) => void;
  onDoubleClick: (e: React.MouseEvent, m: CanvasMedia) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  onPointerDown: (e: MediaPointerEvent, m: CanvasMedia) => void;
  onPointerMove: (e: MediaPointerEvent) => void;
  onPointerUp: (e: MediaPointerEvent) => void;
};
```

Update `MediaItem`'s destructuring (add `placement`) and replace its label block. The full edited component:

```tsx
const MediaItem = memo(function MediaItem({
  m,
  isActive,
  placement,
  onEnter,
  onLeave,
  onClick,
  onDoubleClick,
  onContextMenu,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: MediaItemProps) {
  const cls = `world-image ${m.pending ? 'is-pending' : ''} ${isActive ? 'is-active' : ''}`;
  const style = { left: m.x, top: m.y, width: m.width, height: m.height };
  const handleEnter = () => onEnter(m.id);
  const handleClick = (e: React.MouseEvent) => onClick(e, m.id);
  const handleDouble = (e: React.MouseEvent) => onDoubleClick(e, m);
  const handleContext = (e: React.MouseEvent) => onContextMenu(e, m.id);
  const handleDown = (e: MediaPointerEvent) => onPointerDown(e, m);

  // Label anchor depends on placement — we always snap to a corner of the
  // image; CSS translates/scales it into the gap outside that corner.
  const labelLeft =
    placement === 'tr' || placement === 'br' ? m.x + m.width : m.x;
  const labelTop =
    placement === 'bl' || placement === 'br' ? m.y + m.height : m.y;

  const labelCls = `media-label ${isActive ? 'is-active' : ''}`;
  const label = (
    // Canvas items are pointer-driven; keyboard access to individual items
    // happens through the SearchPalette (Cmd+K) which lists every media by
    // name and focuses the picked one.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <span
      className={labelCls}
      data-placement={placement}
      style={{ left: labelLeft, top: labelTop }}
      onMouseEnter={handleEnter}
      onMouseLeave={onLeave}
      onClick={handleClick}
      onDoubleClick={handleDouble}
      onContextMenu={handleContext}
      onPointerDown={handleDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {m.name}
    </span>
  );

  if (m.kind === 'video') {
    return (
      <>
        <video
          src={m.src}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          className={cls}
          style={style}
          onMouseEnter={handleEnter}
          onMouseLeave={onLeave}
          onClick={handleClick}
          onDoubleClick={handleDouble}
          onContextMenu={handleContext}
          onPointerDown={handleDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        {label}
      </>
    );
  }
  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */}
      <img
        src={m.src}
        alt={m.name}
        draggable={false}
        className={cls}
        style={style}
        onMouseEnter={handleEnter}
        onMouseLeave={onLeave}
        onClick={handleClick}
        onDoubleClick={handleDouble}
        onContextMenu={handleContext}
        onPointerDown={handleDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      {label}
    </>
  );
});
```

- [ ] **Step 2: Compute placements in `Canvas`**

At the top of `Canvas.tsx`, add these imports alongside the `./lib/pb` import group:

```ts
import {
  computeLabelPlacements,
  type LabelPlacement,
} from './lib/labelPlacement';
import { labelOuterWidth } from './lib/labelMetrics';
```

(The `LabelPlacement` import from Step 1 can be removed from the top of the file — it's now re-exported via this import; or keep them separate, either is fine.)

Inside the `Canvas` component, directly after the existing `paintMedia` useMemo (ends around line 522), add:

```tsx
  const labelPlacements = useMemo(() => {
    const rankMap = new Map<string, number>();
    stackOrder.forEach((id, i) => rankMap.set(id, i));
    return computeLabelPlacements({
      items: paintMedia,
      rank: (id) => rankMap.get(id) ?? -1,
      scale: view.scale,
      labelWidth: labelOuterWidth,
    });
  }, [paintMedia, stackOrder, view.scale]);
```

- [ ] **Step 3: Pass `placement` into every `<MediaItem>`**

In the `paintMedia.map(…)` JSX (around line 1282), update the element:

```tsx
{paintMedia.map((m) => (
  <MediaItem
    key={m.id}
    m={m}
    isActive={activeSet.has(m.id)}
    placement={labelPlacements.get(m.id) ?? 'tl'}
    onEnter={handleMediaEnter}
    onLeave={handleMediaLeave}
    onClick={handleMediaClick}
    onDoubleClick={handleMediaDoubleClick}
    onContextMenu={handleMediaContextMenu}
    onPointerDown={handleMediaPointerDown}
    onPointerMove={handleMediaPointerMove}
    onPointerUp={handleMediaPointerUp}
  />
))}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @netrart/app typecheck
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/Canvas.tsx
git commit -m "feat(app): compute and pass per-label placement to MediaItem"
```

---

## Task 6: Add CSS variants for the three non-default placements

**Files:**
- Modify: `apps/app/src/App.css`

- [ ] **Step 1: Add the variant rules**

In `apps/app/src/App.css`, locate the `.media-label` block (starts at line 254) and the `.media-label.is-active` block (line 280).

Insert this after the `.media-label:active { cursor: grabbing; }` block (i.e., after line 286):

```css
/* Auto-placement variants. Each mirrors the default (tl) transform while
   anchoring a different corner of the label to the matching corner of the
   image, so scale(var(--inv-view-scale)) keeps constant screen-pixel size. */

.media-label[data-placement="tr"] {
  transform-origin: bottom right;
  transform: translate(-100%, calc(-100% - var(--inv-view-scale, 1) * 6px))
    scale(var(--inv-view-scale, 1));
}

.media-label[data-placement="bl"] {
  transform-origin: top left;
  transform: translateY(calc(var(--inv-view-scale, 1) * 6px))
    scale(var(--inv-view-scale, 1));
}

.media-label[data-placement="br"] {
  transform-origin: top right;
  transform: translate(-100%, calc(var(--inv-view-scale, 1) * 6px))
    scale(var(--inv-view-scale, 1));
}
```

Do not modify the base `.media-label` rule — its existing `transform-origin: bottom left` and `translateY(…)` stay as the `tl` default.

- [ ] **Step 2: Confirm lint/typecheck are clean**

```bash
pnpm --filter @netrart/app typecheck
pnpm lint
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/App.css
git commit -m "style(app): add tl/tr/bl/br variants for filename label"
```

---

## Task 7: Manual verification

**Files:**
- (No code changes.)

- [ ] **Step 1: Boot the dev stack**

From repo root, in one terminal:

```bash
pnpm db:start
```

In another:

```bash
pnpm dev:app
```

- [ ] **Step 2: Repro the overlap scenario**

Open the app in a browser. Drop 3–4 images in a roughly horizontal row, then:

1. Drag one image so it partially overlaps another, sliding it *above* (covering the top-left area of) the neighbor. The neighbor's filename label should flip off its default (above, left) position to `tr` (above, right-aligned) as soon as the dragged image crosses the label area. Releasing the drag leaves the label in its new corner.
2. Drag a second image to cover the top-right area too. The covered neighbor's label should flip to `bl` (below, left).
3. Keep piling images on top until all four corners are blocked. Label falls back to the default `tl` position.
4. Raise the covered image to the top (click it) — it is now the top of the stack, so there are no strictly-higher neighbors for it. Its own label returns to `tl`.

- [ ] **Step 3: Zoom sanity check**

Zoom out until the labels are tiny. Then zoom back in. At every zoom level, every label should be a single constant-pixel-size pill aligned to its correct corner, never clipped or rotated.

- [ ] **Step 4: Regression check**

- Selection bbox (multi-select) still grows upward to cover the highlighted area.
- HighlightInput still appears below the active item at the expected offset.
- Pending upload overlay still renders its spinner/label in the image's center.
- Sidebar order is unchanged (always canonical `media` order, not `stackOrder`).

- [ ] **Step 5: If anything regresses**

Do NOT patch over it in this plan — open an issue or amend the plan. The spec's non-goals explicitly exclude these surfaces, so they should be untouched.

---

## Self-Review Notes (for the planner)

- **Spec coverage:**
  - Success criterion 1 (first-clear candidate) → Task 3 algorithm + tests in Task 2.
  - Success criterion 2 (tl fallback) → explicit test case in Task 2 + code in Task 3.
  - Success criterion 3 (live drag, no flicker) → `labelPlacements` memo depends on `paintMedia`, which already updates every drag frame; no second layout pass (Task 5).
  - Success criterion 4 (pure helper + tests) → Tasks 2–3.
  - Success criterion 5 (no zoom regression) → Task 6 mirrors the inv-scale transform in every variant; Task 7 step 3 verifies.
- **Placeholders:** none. Every step has concrete code or commands.
- **Type consistency:** `LabelPlacement`, `PlacementInput`, `PlacementItem` named identically in Tasks 2, 3, and 5. `labelOuterWidth` signature matches `labelWidth` callback in `PlacementInput`.
- **No leftover spec requirements.**
