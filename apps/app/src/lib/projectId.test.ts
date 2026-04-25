import { describe, it, expect } from 'vitest';
import { parseProjectId, ProjectIdMissingError } from './projectId';

describe('parseProjectId', () => {
  it('returns the project id when ?project= is present', () => {
    expect(parseProjectId('?project=abc123')).toBe('abc123');
  });

  it('returns null when query is empty', () => {
    expect(parseProjectId('')).toBeNull();
  });

  it('returns null when ?project= key is absent', () => {
    expect(parseProjectId('?other=foo')).toBeNull();
  });

  it('throws ProjectIdMissingError on whitespace-only id', () => {
    expect(() => parseProjectId('?project=%20%20')).toThrow(ProjectIdMissingError);
  });
});
