import { MediaItem } from '../MediaItem';
import { BakeForImage } from '../BakeForImage';
import { useVisionMedia } from '../../context/slices/useVisionMedia';
import { useVisionSelection } from '../../context/slices/useVisionSelection';
import { useVisionSegmentation } from '../../context/slices/useVisionSegmentation';
import { useVisionTools } from '../../context/slices/useVisionTools';

export function MediaRenderLayer() {
  const { paintMedia, lodSources, labelPlacements } = useVisionMedia();
  const { activeSet, activeMedia } = useVisionSelection();
  const { segments, soloTag, handleMaskSelect, handleMaskHover } =
    useVisionSegmentation();
  const {
    handleMediaEnter,
    handleMediaLeave,
    handleMediaClick,
    handleMediaDoubleClick,
    handleMediaContextMenu,
    handleMediaPointerDown,
    handleMediaPointerMove,
    handleMediaPointerUp,
  } = useVisionTools();

  return (
    <>
      {paintMedia.map((m) => {
        const lod = lodSources.get(m.id);
        return (
          <MediaItem
            key={m.id}
            m={m}
            isActive={activeSet.has(m.id)}
            placement={labelPlacements.get(m.id) ?? 'tl'}
            lodSrc={lod?.lodSrc}
            playVideo={lod ? lod.playVideo : true}
            onEnter={handleMediaEnter}
            onLeave={handleMediaLeave}
            onClick={handleMediaClick}
            onDoubleClick={handleMediaDoubleClick}
            onContextMenu={handleMediaContextMenu}
            onPointerDown={handleMediaPointerDown}
            onPointerMove={handleMediaPointerMove}
            onPointerUp={handleMediaPointerUp}
          />
        );
      })}
      {paintMedia
        .filter((m) => m.kind === 'image' && segments[m.id])
        .map((m) => (
          <BakeForImage
            key={`bake-${m.id}`}
            m={m}
            state={segments[m.id]!}
            soloTag={activeMedia?.id === m.id ? soloTag : null}
            onMaskSelect={handleMaskSelect}
            onMaskHover={handleMaskHover}
            onEmptyPointerDown={handleMediaPointerDown}
            onEnter={handleMediaEnter}
            onLeave={handleMediaLeave}
            onPointerMove={handleMediaPointerMove}
            onPointerUp={handleMediaPointerUp}
          />
        ))}
    </>
  );
}
