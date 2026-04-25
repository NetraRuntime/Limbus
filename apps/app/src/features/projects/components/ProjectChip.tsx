import type { ProjectRecord } from '../types/project';

type Props = {
  project: ProjectRecord;
};

// Renders just the project name as a breadcrumb segment inside the
// canvas wordmark pill. No icon, no background — the wordmark dividers
// already separate it from neighbouring tags.
export function ProjectChip({ project }: Props) {
  return (
    <span className="project-chip-name" title={project.name}>
      {project.name}
    </span>
  );
}
