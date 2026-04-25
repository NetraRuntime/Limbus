import type { ProjectRecord } from '../types/project';

export function ProjectGrid({ projects }: { projects: ProjectRecord[] }) {
  return <div className="home-grid">{projects.length} projects</div>;
}
