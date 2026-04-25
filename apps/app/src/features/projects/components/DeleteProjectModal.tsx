import type { ProjectRecord } from '../types/project';

type Props = {
  project: ProjectRecord;
  onClose: () => void;
  onDeleted?: () => void;
};

export function DeleteProjectModal({ project: _project, onClose, onDeleted: _onDeleted }: Props) {
  return (
    <div role="dialog">
      Delete stub <button type="button" onClick={onClose}>close</button>
    </div>
  );
}
