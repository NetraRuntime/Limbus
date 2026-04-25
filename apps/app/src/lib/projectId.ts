export class ProjectIdMissingError extends Error {
  override name = 'ProjectIdMissingError';
}

export function parseProjectId(search: string): string | null {
  if (!search) return null;
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const raw = params.get('project');
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!trimmed) throw new ProjectIdMissingError('?project= present but empty');
  return trimmed;
}

export function readProjectIdFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  return parseProjectId(window.location.search);
}
