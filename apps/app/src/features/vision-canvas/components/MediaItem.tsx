import { memo, useEffect, useRef, useState } from 'react';
import type { LabelPlacement } from '../../../lib/labelPlacement';
import type { CanvasMedia, MediaPointerEvent } from '../lib';

// Survives unmount/remount on viewport cull so the pop-in animation doesn't replay.
const loadedMediaIds = new Set<string>();

export type MediaItemProps = {
  m: CanvasMedia;
  isActive: boolean;
  placement: LabelPlacement;
  lodSrc?: string;
  playVideo?: boolean;
  onEnter: (id: string) => void;
  onLeave: () => void;
  onClick: (e: React.MouseEvent, id: string) => void;
  onDoubleClick: (e: React.MouseEvent, m: CanvasMedia) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  onPointerDown: (e: MediaPointerEvent, m: CanvasMedia) => void;
  onPointerMove: (e: MediaPointerEvent) => void;
  onPointerUp: (e: MediaPointerEvent) => void;
};

export const MediaItem = memo(function MediaItem({
  m,
  isActive,
  placement,
  lodSrc,
  playVideo = true,
  onEnter,
  onLeave,
  onClick,
  onDoubleClick,
  onContextMenu,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: MediaItemProps) {
  const [loaded, setLoaded] = useState(() => loadedMediaIds.has(m.id));
  const imgRef = useRef<HTMLImageElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    // Cached media can finish before onLoad attaches; reconcile from DOM once.
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      loadedMediaIds.add(m.id);
      setLoaded(true);
      return;
    }
    const vid = videoRef.current;
    if (vid && vid.readyState >= 2) {
      loadedMediaIds.add(m.id);
      setLoaded(true);
    }
  }, [m.id]);

  const flipLoaded = () => {
    loadedMediaIds.add(m.id);
    setLoaded(true);
  };

  const className = `world-image ${m.pending ? 'is-pending' : ''} ${isActive ? 'is-active' : ''} ${loaded ? 'is-loaded' : ''}`;
  const style = { left: m.x, top: m.y, width: m.width, height: m.height };
  const handleEnter = () => onEnter(m.id);
  const surfaceProps = {
    className,
    style,
    onError: flipLoaded,
    onMouseEnter: handleEnter,
    onMouseLeave: onLeave,
    onClick: (e: React.MouseEvent) => onClick(e, m.id),
    onDoubleClick: (e: React.MouseEvent) => onDoubleClick(e, m),
    onContextMenu: (e: React.MouseEvent) => onContextMenu(e, m.id),
    onPointerDown: (e: MediaPointerEvent) => onPointerDown(e, m),
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
  };

  const labelLeft =
    placement === 'tr' || placement === 'br' ? m.x + m.width : m.x;
  const labelTop =
    placement === 'bl' || placement === 'br' ? m.y + m.height : m.y;

  return (
    <>
      {m.kind === 'video' && playVideo ? (
        <video
          ref={videoRef}
          src={m.src}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          onLoadedData={flipLoaded}
          {...surfaceProps}
        />
      ) : (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events
        <img
          ref={imgRef}
          src={lodSrc ?? m.src}
          alt={m.name}
          draggable={false}
          decoding="async"
          onLoad={flipLoaded}
          {...surfaceProps}
        />
      )}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <span
        className={`media-label ${isActive ? 'is-active' : ''}`}
        data-placement={placement}
        style={{ left: labelLeft, top: labelTop }}
        onMouseEnter={handleEnter}
        onMouseLeave={onLeave}
        onClick={surfaceProps.onClick}
        onDoubleClick={surfaceProps.onDoubleClick}
        onContextMenu={surfaceProps.onContextMenu}
        onPointerDown={surfaceProps.onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {m.name}
      </span>
    </>
  );
});
