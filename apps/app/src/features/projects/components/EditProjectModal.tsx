import type { ProjectRecord } from '../types/project';

type Props = {
  project: ProjectRecord;
  onClose: () => void;
};

export function EditProjectModal({ project: _project, onClose }: Props) {
  return (
    <div role="dialog">
      Edit stub <button type="button" onClick={onClose}>close</button>
    </div>
  );
}
