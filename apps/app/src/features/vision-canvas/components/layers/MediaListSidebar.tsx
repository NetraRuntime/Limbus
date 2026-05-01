import { FloatingSidebar } from '../../../../components/FloatingSidebar';
import { useVisionMedia } from '../../context/slices/useVisionMedia';
import { useVisionSelection } from '../../context/slices/useVisionSelection';
import { useVisionTools } from '../../context/slices/useVisionTools';

export function MediaListSidebar() {
  const { media } = useVisionMedia();
  const { activeId } = useVisionSelection();
  const { handleSidebarSelect } = useVisionTools();
  return (
    <FloatingSidebar
      items={media}
      activeId={activeId}
      onSelect={handleSidebarSelect}
    />
  );
}
