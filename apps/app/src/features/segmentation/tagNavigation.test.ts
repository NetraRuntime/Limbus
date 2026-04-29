import { describe, it, expect } from 'vitest';
import { nextSoloTag } from './tagNavigation';
import type { TagListEntry } from '../vision-canvas/components/MediaTagList';

const ready = (tag: string): TagListEntry => ({ tag, status: 'ready' });
const loading = (tag: string): TagListEntry => ({ tag, status: 'loading' });
const error = (tag: string): TagListEntry => ({ tag, status: 'error' });

describe('nextSoloTag', () => {
  it('moves to the next ready tag', () => {
    const entries = [ready('cat'), ready('dog'), ready('bird')];
    expect(nextSoloTag('cat', entries, 'next')).toBe('dog');
    expect(nextSoloTag('dog', entries, 'next')).toBe('bird');
  });

  it('moves to the previous ready tag', () => {
    const entries = [ready('cat'), ready('dog'), ready('bird')];
    expect(nextSoloTag('bird', entries, 'prev')).toBe('dog');
    expect(nextSoloTag('dog', entries, 'prev')).toBe('cat');
  });

  it('returns null when clamped at the last tag', () => {
    const entries = [ready('cat'), ready('dog')];
    expect(nextSoloTag('dog', entries, 'next')).toBeNull();
  });

  it('returns null when clamped at the first tag', () => {
    const entries = [ready('cat'), ready('dog')];
    expect(nextSoloTag('cat', entries, 'prev')).toBeNull();
  });

  it('skips non-ready entries when moving forward', () => {
    const entries = [ready('cat'), loading('dog'), error('bird'), ready('fish')];
    expect(nextSoloTag('cat', entries, 'next')).toBe('fish');
  });

  it('skips non-ready entries when moving backward', () => {
    const entries = [ready('cat'), loading('dog'), error('bird'), ready('fish')];
    expect(nextSoloTag('fish', entries, 'prev')).toBe('cat');
  });

  it('returns null when the current tag is not in the list', () => {
    const entries = [ready('cat'), ready('dog')];
    expect(nextSoloTag('bird', entries, 'next')).toBeNull();
    expect(nextSoloTag('bird', entries, 'prev')).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(nextSoloTag('cat', [], 'next')).toBeNull();
    expect(nextSoloTag('cat', [], 'prev')).toBeNull();
  });

  it('matches current case-insensitively and returns the list entry casing', () => {
    const entries = [ready('Cat'), ready('Dog')];
    expect(nextSoloTag('cat', entries, 'next')).toBe('Dog');
    expect(nextSoloTag('DOG', entries, 'prev')).toBe('Cat');
  });

  it('returns null when the only ready tag is the current one', () => {
    const entries = [loading('cat'), ready('dog'), error('bird')];
    expect(nextSoloTag('dog', entries, 'next')).toBeNull();
    expect(nextSoloTag('dog', entries, 'prev')).toBeNull();
  });
});
