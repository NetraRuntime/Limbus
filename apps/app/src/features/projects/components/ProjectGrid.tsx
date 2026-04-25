import { useState } from 'react';
import type { ProjectRecord } from '../types/project';
import { ProjectCard } from './ProjectCard';
import { EditProjectModal } from './EditProjectModal';
import { DeleteProjectModal } from './DeleteProjectModal';

type Props = {
  projects: ProjectRecord[];
  itemCounts: Record<string, number>;
};

export function ProjectGrid({ projects, itemCounts }: Props) {
  const [editing, setEditing] = useState<ProjectRecord | null>(null);
  const [deleting, setDeleting] = useState<ProjectRecord | null>(null);

  return (
    <>
      <div className="home-grid">
        {projects.map((p) => (
          <ProjectCard
            key={p.id}
            project={p}
            itemCount={itemCounts[p.id] ?? 0}
            onEdit={() => setEditing(p)}
            onDelete={() => setDeleting(p)}
          />
        ))}
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
