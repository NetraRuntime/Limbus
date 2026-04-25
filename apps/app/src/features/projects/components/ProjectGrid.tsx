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
  /**
   * When set, every project tile is visually disabled and clicking is a
   * no-op. Used while no model is installed/active so the user can't
   * stumble into a canvas window that has no model to load.
   */
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
        <DeleteProjectModal project={deleting} onClose={() => setDeleting(null)} />
      )}
    </>
  );
}
