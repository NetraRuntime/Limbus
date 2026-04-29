import {
  ContextMenu,
  type ContextMenuItem,
} from '../../../../components/ContextMenu';
import { exportMedia, type CanvasMedia } from '../../lib';

type ContextMenuPos = { id: string; x: number; y: number };

type Props = {
  contextMenu: ContextMenuPos | null;
  media: CanvasMedia[];
  selectedIds: Set<string>;
  onDeleteSelection: () => void;
  onDeleteMedia: (id: string) => void;
  onClose: () => void;
};

export function ContextMenuLayer({
  contextMenu,
  media,
  selectedIds,
  onDeleteSelection,
  onDeleteMedia,
  onClose,
}: Props) {
  if (!contextMenu) return null;
  const target = media.find((m) => m.id === contextMenu.id);
  if (!target) return null;

  const items: ContextMenuItem[] = [
    {
      id: 'export',
      label: 'Export',
      icon: 'ri-download-2-line',
      onSelect: () => {
        void exportMedia(target);
      },
    },
    {
      id: 'delete',
      label:
        selectedIds.size > 1 && selectedIds.has(target.id)
          ? `Delete ${selectedIds.size} items`
          : 'Delete',
      icon: 'ri-delete-bin-line',
      danger: true,
      onSelect: () => {
        if (selectedIds.has(target.id) && selectedIds.size > 1) {
          onDeleteSelection();
        } else {
          onDeleteMedia(target.id);
        }
      },
    },
  ];

  return (
    <ContextMenu
      x={contextMenu.x}
      y={contextMenu.y}
      items={items}
      onClose={onClose}
    />
  );
}
