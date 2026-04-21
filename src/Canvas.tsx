import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  InfiniteCanvas,
  type InfiniteCanvasHandle,
  type View,
  type WorldPoint,
} from './InfiniteCanvas';
import {
  createImage,
  createVideo,
  deleteImage,
  deleteVideo,
  imageFileUrl,
  listImages,
  listVideos,
  updateImagePosition,
  updateVideoPosition,
  videoFileUrl,
  type ImageRecord,
  type MediaKind,
  type VideoRecord,
} from './lib/pb';
import {
  HighlightInput,
  HIGHLIGHT_INPUT_GAP,
  HIGHLIGHT_INPUT_HEIGHT,
} from './components/HighlightInput';
import { Link } from './router';
import './App.css';

type CanvasMedia = {
  id: string;
  kind: MediaKind;
  src: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pending?: boolean;
};

const formatZoom = (scale: number) => {
  if (scale >= 1) return `${(scale * 100).toFixed(0)}%`;
  if (scale >= 0.01) return `${(scale * 100).toFixed(1)}%`;
  return scale.toExponential(1);
};

const formatCoord = (n: number | undefined) => {
  if (n === undefined) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e5) return n.toExponential(1);
  return n.toFixed(abs < 10 ? 2 : abs < 1000 ? 1 : 0);
};

const loadImage = (file: File): Promise<{ src: string; width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ src, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => {
      URL.revokeObjectURL(src);
      reject(new Error(`Failed to load ${file.name}`));
    };
    img.src = src;
  });

// Probe a video file for its intrinsic dimensions without decoding a frame.
// Resolves once `loadedmetadata` fires, which is enough to get videoWidth /
// videoHeight reliably across browsers.
const loadVideo = (file: File): Promise<{ src: string; width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const vid = document.createElement('video');
    vid.preload = 'metadata';
    vid.muted = true;
    vid.playsInline = true;
    vid.onloadedmetadata = () => {
      const w = vid.videoWidth || 640;
      const h = vid.videoHeight || 360;
      resolve({ src, width: w, height: h });
    };
    vid.onerror = () => {
      URL.revokeObjectURL(src);
      reject(new Error(`Failed to load ${file.name}`));
    };
    vid.src = src;
  });

const fromImageRecord = (r: ImageRecord): CanvasMedia => ({
  id: r.id,
  kind: 'image',
  src: imageFileUrl(r),
  name: r.name,
  x: r.x,
  y: r.y,
  width: r.width,
  height: r.height,
});

const fromVideoRecord = (r: VideoRecord): CanvasMedia => ({
  id: r.id,
  kind: 'video',
  src: videoFileUrl(r),
  name: r.name,
  x: r.x,
  y: r.y,
  width: r.width,
  height: r.height,
});

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

type ConnState = 'connecting' | 'ready' | 'offline';

// Delay before the hover input hides — gives the mouse a beat to bridge the
// gap from the media to the floating input without it disappearing.
const HOVER_HIDE_MS = 160;
// Pixels of pointer movement (in screen space) before a press-and-drag on a
// media element is treated as a move. Below the threshold the interaction
// falls through to click / double-click as usual.
const DRAG_THRESHOLD_PX = 4;

type DragState = {
  id: string;
  kind: MediaKind;
  pointerId: number;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  moved: boolean;
  lastX: number;
  lastY: number;
};

type UploadPhase = 'sending' | 'finalizing' | 'error';
type UploadStatus = { phase: UploadPhase; pct: number; message?: string };

// localStorage key for the cached viewport. `:v1` is a schema suffix so we
// can invalidate old cache payloads if the View shape ever changes.
const VIEW_STORAGE_KEY = 'netrart:canvas:view:v1';
// Debounce window for persisting view changes — pan/zoom emits many frames,
// so we wait for the motion to settle before writing.
const VIEW_PERSIST_DEBOUNCE_MS = 200;

const readStoredView = (): View | null => {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(VIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.x === 'number' &&
      Number.isFinite(parsed.x) &&
      typeof parsed.y === 'number' &&
      Number.isFinite(parsed.y) &&
      typeof parsed.scale === 'number' &&
      Number.isFinite(parsed.scale) &&
      parsed.scale > 0
    ) {
      return { x: parsed.x, y: parsed.y, scale: parsed.scale };
    }
  } catch {
    /* corrupt payload — fall through to fresh defaults */
  }
  return null;
};

const writeStoredView = (v: View) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(v));
  } catch {
    /* storage full / private mode — silently skip */
  }
};

type MediaPointerEvent = React.PointerEvent<HTMLImageElement | HTMLVideoElement>;

// Compute the starting view once at module load. Pulled out of the component
// so the useState initializer and the `initial` prop share a single source
// of truth — prevents a one-frame flicker where the two get out of sync.
const getInitialView = (): View => {
  const stored = readStoredView();
  if (stored) return stored;
  const w = typeof window !== 'undefined' ? window.innerWidth : 0;
  const h = typeof window !== 'undefined' ? window.innerHeight : 0;
  return { x: w / 2, y: h / 2, scale: 1 };
};

export function Canvas() {
  const canvasRef = useRef<InfiniteCanvasHandle>(null);
  const [view, setView] = useState<View>(getInitialView);
  const [cursor, setCursor] = useState<WorldPoint | null>(null);
  const [media, setMedia] = useState<CanvasMedia[]>([]);
  const [conn, setConn] = useState<ConnState>('connecting');
  // Upload status per pending media id. Two-phase state:
  //   phase 'sending'    → body in flight, pct ∈ [0, 1)
  //   phase 'finalizing' → body fully sent, waiting for PB to return record
  // Keeping phase + pct in ONE state entry (instead of deriving phase from
  // pct) avoids a window where progress events race with render such that
  // the chip briefly falls back to the "Uploading" placeholder.
  const [uploadStatus, setUploadStatus] = useState<Record<string, UploadStatus>>({});
  // In-flight upload AbortControllers, keyed by draft id. A delete on a
  // pending media aborts the XHR so the server doesn't end up with a ghost
  // record referencing a file the user never meant to keep.
  const uploadCtrlsRef = useRef<Record<string, AbortController>>({});

  // Highlight interaction state.
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [highlightInputs, setHighlightInputs] = useState<Record<string, string>>({});
  const hideTimer = useRef<number | null>(null);

  // Drag-to-move state. Kept in a ref so pointermove handlers don't force a
  // re-render per frame; position updates go through setMedia.
  const dragRef = useRef<DragState | null>(null);
  // Mirror of the live view so pointermove can read the current scale without
  // forcing handler re-creation on every view change.
  const viewRef = useRef<View>(view);
  viewRef.current = view;

  const activeId = pinnedId ?? hoverId;
  const activeMedia = useMemo(
    () => (activeId ? media.find((m) => m.id === activeId) ?? null : null),
    [activeId, media],
  );

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    hideTimer.current = window.setTimeout(() => {
      setHoverId(null);
      hideTimer.current = null;
    }, HOVER_HIDE_MS);
  }, [clearHideTimer]);

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  // Persist the camera (pan + zoom) after motion settles so the next session
  // starts where the user left off. Debounced so pan/zoom tweens don't spam
  // localStorage writes on every animation frame.
  useEffect(() => {
    const t = window.setTimeout(() => writeStoredView(view), VIEW_PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [view]);

  useEffect(() => {
    let cancelled = false;
    // Load each collection independently so a missing `videos` collection
    // (e.g. migration not yet applied) doesn't block images from rendering.
    // Preserve the success/failure signal per call to drive conn status.
    Promise.all([
      listImages().then(
        (r) => ({ ok: true as const, records: r }),
        (err) => {
          console.warn('[pb] failed to load images:', err);
          return { ok: false as const, records: [] as ImageRecord[] };
        },
      ),
      listVideos().then(
        (r) => ({ ok: true as const, records: r }),
        (err) => {
          console.warn('[pb] failed to load videos:', err);
          return { ok: false as const, records: [] as VideoRecord[] };
        },
      ),
    ]).then(([imgRes, vidRes]) => {
      if (cancelled) return;
      const merged: CanvasMedia[] = [
        ...imgRes.records.map(fromImageRecord),
        ...vidRes.records.map(fromVideoRecord),
      ];
      merged.sort((a, b) => a.id.localeCompare(b.id));
      setMedia(merged);
      // "ready" if at least one list call succeeded — the videos collection
      // may legitimately be absent (migration pending) without PB being down.
      setConn(imgRes.ok || vidRes.ok ? 'ready' : 'offline');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the delete handler's dependencies in a ref so the listener doesn't
  // need to re-attach on every media/pinned change.
  const mediaRef = useRef(media);
  mediaRef.current = media;
  const pinnedRef = useRef(pinnedId);
  pinnedRef.current = pinnedId;

  // Deletes the currently pinned media — shared between the window-level
  // Delete/Backspace shortcut and the empty-input Delete shortcut inside
  // the HighlightInput.
  const deletePinned = useCallback(() => {
    const id = pinnedRef.current;
    if (!id) return;
    const target = mediaRef.current.find((m) => m.id === id);
    if (!target) return;
    setMedia((prev) => prev.filter((m) => m.id !== id));
    setPinnedId(null);
    setHoverId(null);
    if (target.pending) {
      uploadCtrlsRef.current[id]?.abort();
      URL.revokeObjectURL(target.src);
      return;
    }
    const fn = target.kind === 'video' ? deleteVideo : deleteImage;
    fn(id)
      .then(() => setConn('ready'))
      .catch((err) => {
        console.warn('[pb] delete failed for', id, err);
        setConn('offline');
        setMedia((prev) => [...prev, target]);
      });
  }, []);

  // Keyboard shortcuts:
  //   Escape        — release pinned selection
  //   Delete/Backsp — delete the pinned media (skipped while typing)
  useEffect(() => {
    const isEditable = (el: Element | null): boolean => {
      if (!el || !(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        el.isContentEditable === true
      );
    };
    // Three-layer defense: `document.activeElement` (source of truth for
    // where the next keystroke will land), `e.target` (where this event
    // fired), and a closest() climb up from the target looking for the
    // highlight-input wrapper. The last one catches cases where React's
    // root-level delegation plus stopPropagation still lets the event
    // reach window before focus has resolved.
    const isTypingContext = (e: KeyboardEvent): boolean => {
      if (isEditable(document.activeElement)) return true;
      const target = e.target instanceof Element ? e.target : null;
      if (isEditable(target)) return true;
      if (target?.closest('.highlight-input, input, textarea, [contenteditable="true"]'))
        return true;
      return false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPinnedId(null);
        return;
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (isTypingContext(e)) return;
      if (!pinnedRef.current) return;
      e.preventDefault();
      deletePinned();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleChange = useCallback((v: View) => setView(v), []);
  const handlePointerWorld = useCallback((p: WorldPoint | null) => setCursor(p), []);

  const handleFilesDrop = useCallback(async (files: File[], point: WorldPoint) => {
    const accepted = files.filter(
      (f) => f.type.startsWith('image/') || f.type.startsWith('video/'),
    );
    if (!accepted.length) return;

    const loaded = await Promise.all(
      accepted.map(async (f) => {
        const kind: MediaKind = f.type.startsWith('video/') ? 'video' : 'image';
        const dims = await (kind === 'video' ? loadVideo(f) : loadImage(f));
        return { file: f, kind, ...dims };
      }),
    );

    const gap = 32;
    let cursorX = point.worldX - loaded[0].width / 2;
    const baseY = point.worldY - loaded[0].height / 2;

    type Draft = {
      draft: CanvasMedia;
      file: File;
      meta: { x: number; y: number; width: number; height: number; name: string };
    };
    const plan: Draft[] = [];
    for (const l of loaded) {
      const meta = { x: cursorX, y: baseY, width: l.width, height: l.height, name: l.file.name };
      plan.push({
        draft: { id: uid(), kind: l.kind, src: l.src, pending: true, ...meta },
        file: l.file,
        meta,
      });
      cursorX += l.width + gap;
    }

    setMedia((prev) => [...prev, ...plan.map((p) => p.draft)]);

    const minX = Math.min(...plan.map((p) => p.draft.x));
    const minY = Math.min(...plan.map((p) => p.draft.y));
    const maxX = Math.max(...plan.map((p) => p.draft.x + p.draft.width));
    const maxY = Math.max(...plan.map((p) => p.draft.y + p.draft.height));
    canvasRef.current?.focusOn({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });

    // Seed the chip with an explicit "sending @ 0%" entry synchronously,
    // BEFORE any await. This guarantees the chip never renders the default
    // "Uploading" placeholder — even if the browser never fires a progress
    // event (common on loopback for small bodies).
    setUploadStatus((prev) => {
      const next = { ...prev };
      for (const p of plan) next[p.draft.id] = { phase: 'sending', pct: 0 };
      return next;
    });

    await Promise.all(
      plan.map(async (p) => {
        const onProgress = (pct: number) => {
          setUploadStatus((prev) => {
            if (!(p.draft.id in prev)) return prev;
            return {
              ...prev,
              [p.draft.id]: {
                phase: pct >= 1 ? 'finalizing' : 'sending',
                pct: Math.min(1, Math.max(0, pct)),
              },
            };
          });
        };
        const ctrl = new AbortController();
        uploadCtrlsRef.current[p.draft.id] = ctrl;
        try {
          const record =
            p.draft.kind === 'video'
              ? await createVideo(p.file, p.meta, onProgress, ctrl.signal)
              : await createImage(p.file, p.meta, onProgress, ctrl.signal);
          const next =
            p.draft.kind === 'video'
              ? fromVideoRecord(record as VideoRecord)
              : fromImageRecord(record as ImageRecord);
          setMedia((prev) => prev.map((m) => (m.id === p.draft.id ? next : m)));
          URL.revokeObjectURL(p.draft.src);
          setConn('ready');
        } catch (err) {
          if ((err as Error | null)?.name !== 'AbortError') {
            // Surface the failure in-place — keep the pending media visible
            // with an error chip so the user sees what went wrong and can
            // press Delete/Backspace to clean it up. Previously we removed
            // the media silently, which looked like a random "poof".
            const message = (err as Error | null)?.message ?? 'upload failed';
            console.warn('[pb] upload failed for', p.file.name, err);
            setConn('offline');
            setUploadStatus((prev) => ({
              ...prev,
              [p.draft.id]: { phase: 'error', pct: 0, message },
            }));
            // Leave media.pending = true so the overlay keeps rendering.
            return;
          }
        } finally {
          delete uploadCtrlsRef.current[p.draft.id];
        }
        // Clear status on success or abort. Error path returns early above
        // so the error chip stays visible until the user deletes the media.
        setUploadStatus((prev) => {
          if (!(p.draft.id in prev)) return prev;
          const next = { ...prev };
          delete next[p.draft.id];
          return next;
        });
      }),
    );
  }, []);

  const handleBackgroundClick = useCallback(() => {
    setPinnedId(null);
  }, []);

  const handleMediaEnter = useCallback(
    (id: string) => {
      clearHideTimer();
      setHoverId(id);
    },
    [clearHideTimer],
  );

  const handleMediaLeave = useCallback(() => {
    scheduleHide();
  }, [scheduleHide]);

  const handleMediaClick = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      if (dragRef.current?.id === id && dragRef.current.moved) return;
      clearHideTimer();
      setPinnedId(id);
      setHoverId(id);
    },
    [clearHideTimer],
  );

  const handleMediaDoubleClick = useCallback(
    (e: React.MouseEvent, m: CanvasMedia) => {
      e.stopPropagation();
      if (dragRef.current?.moved) return;
      const bottomInset = HIGHLIGHT_INPUT_GAP + HIGHLIGHT_INPUT_HEIGHT + 16;
      canvasRef.current?.focusOn(
        { x: m.x, y: m.y, width: m.width, height: m.height },
        { padding: 0.12, bottomInset },
      );
    },
    [],
  );

  const handleMediaPointerDown = useCallback((e: MediaPointerEvent, m: CanvasMedia) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragRef.current = {
      id: m.id,
      kind: m.kind,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: m.x,
      origY: m.y,
      moved: false,
      lastX: m.x,
      lastY: m.y,
    };
  }, []);

  const handleMediaPointerMove = useCallback((e: MediaPointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dxScreen = e.clientX - d.startX;
    const dyScreen = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dxScreen, dyScreen) < DRAG_THRESHOLD_PX) return;
    d.moved = true;
    const scale = viewRef.current.scale;
    const nextX = d.origX + dxScreen / scale;
    const nextY = d.origY + dyScreen / scale;
    d.lastX = nextX;
    d.lastY = nextY;
    setMedia((prev) =>
      prev.map((m) => (m.id === d.id ? { ...m, x: nextX, y: nextY } : m)),
    );
  }, []);

  const handleMediaPointerUp = useCallback(
    (e: MediaPointerEvent) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      try {
        (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
      } catch {
        /* no-op */
      }
      const { id, kind, moved, lastX, lastY, origX, origY } = d;
      window.setTimeout(() => {
        if (dragRef.current && dragRef.current.pointerId === d.pointerId) {
          dragRef.current = null;
        }
      }, 0);
      if (!moved) return;
      const stillPending = media.find((m) => m.id === id)?.pending;
      if (stillPending) return;
      const persist =
        kind === 'video' ? updateVideoPosition : updateImagePosition;
      persist(id, { x: lastX, y: lastY })
        .then(() => setConn('ready'))
        .catch((err) => {
          console.warn('[pb] move failed for', id, err);
          setConn('offline');
          setMedia((prev) =>
            prev.map((m) => (m.id === id ? { ...m, x: origX, y: origY } : m)),
          );
        });
    },
    [media],
  );

  // InfiniteCanvas reads this once on mount. Memoized so React never gets a
  // fresh object on subsequent renders (which would be ignored anyway, but
  // keeps intent explicit).
  const initial = useMemo<Partial<View>>(() => getInitialView(), []);

  const isEmpty = media.length === 0 && conn !== 'connecting';

  const activeRect = activeMedia
    ? {
        x: activeMedia.x * view.scale + view.x,
        y: activeMedia.y * view.scale + view.y,
        width: activeMedia.width * view.scale,
        height: activeMedia.height * view.scale,
      }
    : null;

  return (
    <>
      <InfiniteCanvas
        ref={canvasRef}
        initial={initial}
        onChange={handleChange}
        onPointerWorld={handlePointerWorld}
        onFilesDrop={handleFilesDrop}
        onBackgroundClick={handleBackgroundClick}
      >
        {media.map((m) => {
          const cls = `world-image ${m.pending ? 'is-pending' : ''} ${m.id === activeId ? 'is-active' : ''}`;
          const style = { left: m.x, top: m.y, width: m.width, height: m.height };
          if (m.kind === 'video') {
            return (
              <video
                key={m.id}
                src={m.src}
                autoPlay
                loop
                muted
                playsInline
                preload="metadata"
                className={cls}
                style={style}
                onMouseEnter={() => handleMediaEnter(m.id)}
                onMouseLeave={handleMediaLeave}
                onClick={(e) => handleMediaClick(e, m.id)}
                onDoubleClick={(e) => handleMediaDoubleClick(e, m)}
                onPointerDown={(e) => handleMediaPointerDown(e, m)}
                onPointerMove={handleMediaPointerMove}
                onPointerUp={handleMediaPointerUp}
                onPointerCancel={handleMediaPointerUp}
              />
            );
          }
          return (
            <img
              key={m.id}
              src={m.src}
              alt={m.name}
              draggable={false}
              className={cls}
              style={style}
              onMouseEnter={() => handleMediaEnter(m.id)}
              onMouseLeave={handleMediaLeave}
              onClick={(e) => handleMediaClick(e, m.id)}
              onDoubleClick={(e) => handleMediaDoubleClick(e, m)}
              onPointerDown={(e) => handleMediaPointerDown(e, m)}
              onPointerMove={handleMediaPointerMove}
              onPointerUp={handleMediaPointerUp}
              onPointerCancel={handleMediaPointerUp}
            />
          );
        })}
      </InfiniteCanvas>

      {media
        .filter((m) => m.pending)
        .map((m) => {
          const rx = m.x * view.scale + view.x;
          const ry = m.y * view.scale + view.y;
          const rw = m.width * view.scale;
          const rh = m.height * view.scale;
          // Hide the label for small rects so the pill doesn't overflow.
          const showLabel = rw > 160 && rh > 72;
          const status = uploadStatus[m.id];
          const isError = status?.phase === 'error';
          // Label priority:
          //   phase 'error'      → "Failed — <message>"
          //   phase 'finalizing' → "Finalizing"
          //   phase 'sending'    → "NN%"
          //   no status yet      → "Uploading" (pre-seed; should be brief)
          let label = 'Uploading';
          if (status) {
            if (status.phase === 'error') {
              label = status.message
                ? `Failed — ${status.message}`
                : 'Failed';
            } else if (status.phase === 'finalizing') {
              label = 'Finalizing';
            } else {
              label = `${Math.floor(status.pct * 100)}%`;
            }
          }
          return (
            <div
              key={`pending-${m.id}`}
              className={`pending-overlay ${isError ? 'is-error' : ''}`}
              style={{ left: rx, top: ry, width: rw, height: rh }}
              role="status"
              aria-live="polite"
              aria-label={`${m.kind} ${isError ? 'upload failed' : 'uploading'}, ${label}`}
              title={isError && !showLabel ? label : undefined}
            >
              <div className={`pending-chip ${isError ? 'is-error' : ''}`}>
                {isError ? (
                  <i className="ri-error-warning-line pending-chip-icon" aria-hidden />
                ) : (
                  <span className="pending-spinner" aria-hidden />
                )}
                {showLabel && <span className="pending-label">{label}</span>}
              </div>
            </div>
          );
        })}

      {activeMedia && activeRect && (
        <HighlightInput
          key={activeMedia.id}
          rect={activeRect}
          value={highlightInputs[activeMedia.id] ?? ''}
          onChange={(v) =>
            setHighlightInputs((prev) => ({ ...prev, [activeMedia.id]: v }))
          }
          onMouseEnter={clearHideTimer}
          onMouseLeave={scheduleHide}
          onFocus={() => {
            clearHideTimer();
            setPinnedId(activeMedia.id);
          }}
          onBlur={() => {
            const v = highlightInputs[activeMedia.id] ?? '';
            if (!v) setPinnedId(null);
            scheduleHide();
          }}
          onEscape={() => {
            setPinnedId(null);
            scheduleHide();
          }}
          onDeleteWhenEmpty={deletePinned}
          autoFocus={pinnedId === activeMedia.id}
        />
      )}

      {isEmpty && (
        <div className="empty-state" aria-hidden>
          <div className="empty-state-inner">
            <div className="empty-eyebrow">Drop to begin</div>
            <div className="empty-title">
              Drop images or videos <span className="accent">anywhere</span>
            </div>
            <div className="empty-sub">They'll land where you drop and zoom into view.</div>
          </div>
        </div>
      )}

      <div className="hud hud-top-left">
        <div className="wordmark" aria-label="NetraRT">
          <Link to="/" className="wordmark-link">
            <span className="wordmark-glyph">NetraRT</span>
          </Link>
          <span className="wordmark-divider" aria-hidden />
          <span className="wordmark-tag">canvas</span>
          <span className="wordmark-divider" aria-hidden />
          <span className={`conn-dot conn-${conn}`} aria-label={`connection ${conn}`} />
          <span className="wordmark-tag">{conn}</span>
        </div>
      </div>

      <div className="hud hud-bottom-center">
        <div className="status-pill">
          <span className="status-label">Zoom</span>
          <span className="status-value">{formatZoom(view.scale)}</span>
          <span className="status-sep" aria-hidden />
          <span className="status-label">X</span>
          <span className="status-value">{formatCoord(cursor?.worldX)}</span>
          <span className="status-label">Y</span>
          <span className="status-value">{formatCoord(cursor?.worldY)}</span>
        </div>

        <div className="btn-cluster" role="group" aria-label="Canvas controls">
          <button
            className="btn-ghost"
            type="button"
            aria-label="Zoom out"
            onClick={() => canvasRef.current?.zoomBy(1 / 1.4)}
          >
            −
          </button>
          <button
            className="btn-ghost"
            type="button"
            onClick={() => canvasRef.current?.reset()}
          >
            Reset
          </button>
          <button
            className="btn-ghost"
            type="button"
            aria-label="Zoom in"
            onClick={() => canvasRef.current?.zoomBy(1.4)}
          >
            +
          </button>
        </div>
      </div>
    </>
  );
}
