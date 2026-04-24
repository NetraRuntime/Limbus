import { describe, it, expect } from 'vitest';
import { parseClassList } from './classMap';

describe('parseClassList', () => {
  it('parses classes.txt / obj.names newline-separated', () => {
    const text = 'cat\ndog\n\n tree \n';
    expect(parseClassList(text, 'classes.txt').names).toEqual(['cat', 'dog', 'tree']);
  });

  it('parses data.yaml with a flow-style names list', () => {
    const text = 'train: ./train\nnames: [cat, dog, tree]\n';
    expect(parseClassList(text, 'data.yaml').names).toEqual(['cat', 'dog', 'tree']);
  });

  it('parses data.yaml with a block-style indexed map', () => {
    const text = 'names:\n  0: cat\n  1: dog\n  2: tree\n';
    expect(parseClassList(text, 'data.yaml').names).toEqual(['cat', 'dog', 'tree']);
  });

  it('parses data.yaml with a block-style list (dash items)', () => {
    const text = 'names:\n  - cat\n  - dog\n';
    expect(parseClassList(text, 'data.yaml').names).toEqual(['cat', 'dog']);
  });

  it('returns empty names when no recognizable list is present', () => {
    expect(parseClassList('train: ./t\n', 'data.yaml').names).toEqual([]);
  });
});
