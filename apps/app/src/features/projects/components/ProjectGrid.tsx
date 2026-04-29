import { useState } from 'react';
import type { ProjectRecord } from '../types/project';
import type { TagRecord } from '../api/tags';
import { ProjectCard } from './ProjectCard';
import { EditProjectModal } from './EditProjectModal';
import { DeleteProjectModal } from './DeleteProjectModal';

type Props = {
  projects: ProjectRecord[];
  itemCounts: Record<string, number>;
  tagsByProject: Record<string, TagRecord[]>;
  /** When set, tiles are visually disabled and clicks are no-ops; tooltip shows the reason. */
  disabledReason?: string;
};

export function ProjectGrid({ projects, itemCounts, tagsByProject, disabledReason }: Props) {
  const [editing, setEditing] = useState<ProjectRecord | null>(null);
  const [deleting, setDeleting] = useState<ProjectRecord | null>(null);

  return (
    <>
      <div className={`home-list${disabledReason ? ' is-disabled' : ''}`}>
        <div className="home-list-header" role="row">
          <span aria-hidden />
          <span>Name</span>
          <span>Items</span>
          <span>Last opened</span>
          <span aria-hidden />
        </div>
        <div
          className="home-grid"
          role="list"
          title={disabledReason}
        >
          {projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              itemCount={itemCounts[p.id] ?? 0}
              tags={tagsByProject[p.id] ?? []}
              onEdit={() => setEditing(p)}
              onDelete={() => setDeleting(p)}
            />
          ))}
        </div>
      </div>
      {editing && (
        <EditProjectModal project={editing} onClose={() => setEditing(null)} />
      )}
      {deleting && (
        <DeleteProjectModal
          project={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => setDeleting(null)}
        />
      )}
    </>
  );
}
