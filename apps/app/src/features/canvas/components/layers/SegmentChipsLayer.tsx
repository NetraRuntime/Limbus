import type { View } from '../../../../InfiniteCanvas';
import { colorForTag } from '../../../../components/savedTags';
import type { CanvasMedia, SegmentState, TagSegment } from '../../lib';

type Props = {
  visibleMedia: CanvasMedia[];
  view: View;
  segments: Record<string, SegmentState>;
};

// Box entries can collide by tag (two boxes labeled "cat"), so dedup by
// lowercase tag — one chip per label is plenty for the chip stack and
// avoids React's duplicate-key warning.
const dedupByTag = <T extends TagSegment>(arr: T[]): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const e of arr) {
    const k = e.tag.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
};

export function SegmentChipsLayer({ visibleMedia, view, segments }: Props) {
  return (
    <>
      {visibleMedia
        .filter((m) => m.kind === 'image' && segments[m.id])
        .flatMap((m) => {
          const rx = m.x * view.scale + view.x;
          const ry = m.y * view.scale + view.y;
          const rw = m.width * view.scale;
          const rh = m.height * view.scale;
          const state = segments[m.id]!;
          const base = `segment-${m.id}`;

          const loadingTags = dedupByTag(
            state.entries.filter((e) => e.status === 'loading'),
          );
          const errorTags = dedupByTag(
            state.entries.filter(
              (e): e is Extract<TagSegment, { status: 'error' }> =>
                e.status === 'error',
            ),
          );

          if (loadingTags.length === 0 && errorTags.length === 0) return [];

          return [
            <div
              key={`${base}-chips`}
              className="segment-overlay segment-overlay--chips"
              style={{ left: rx, top: ry, width: rw, height: rh }}
              aria-hidden
            >
              <div className="segment-chip-stack">
                {loadingTags.map((entry) => {
                  const { bg, fg, border } = colorForTag(entry.tag);
                  return (
                    <div
                      key={`loading-${entry.tag}`}
                      className="segment-chip"
                      style={{ background: bg, color: fg, borderColor: border }}
                      role="status"
                      aria-live="polite"
                      aria-label={`Segmenting "${entry.tag}"`}
                    >
                      <span className="encoding-spinner" aria-hidden />
                      <span className="encoding-label">{entry.tag}</span>
                    </div>
                  );
                })}
                {errorTags.map((entry) => {
                  const { bg, fg, border } = colorForTag(entry.tag);
                  return (
                    <div
                      key={`error-${entry.tag}`}
                      className="segment-chip segment-chip--error"
                      style={{ background: bg, color: fg, borderColor: border }}
                      role="alert"
                      title={entry.message}
                    >
                      <i className="ri-error-warning-line" aria-hidden />
                      <span className="encoding-label">
                        No match — {entry.tag}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>,
          ];
        })}
    </>
  );
}
