import type { ClassMap } from './types';

export function parseClassList(text: string, sourcePath: string): ClassMap {
  const ext = sourcePath.toLowerCase().split('.').pop() ?? '';
  const names =
    ext === 'yaml' || ext === 'yml' ? parseYamlNames(text) : parsePlainList(text);
  return { names, sourcePath };
}

function parsePlainList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseYamlNames(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const out: Array<{ index: number | null; name: string }> = [];
  let inNamesBlock = false;

  for (const rawLine of lines) {
    const flowMatch = rawLine.match(/^\s*names\s*:\s*\[(.+)\]\s*$/);
    if (flowMatch) {
      return flowMatch[1]!
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter((s) => s.length > 0);
    }
    if (/^\s*names\s*:\s*$/.test(rawLine)) {
      inNamesBlock = true;
      continue;
    }
    if (!inNamesBlock) continue;
    // End of block: unindented non-empty line.
    if (/^\S/.test(rawLine)) break;

    const dashMatch = rawLine.match(/^\s*-\s*(.+?)\s*$/);
    if (dashMatch) {
      out.push({ index: null, name: stripQuotes(dashMatch[1]!) });
      continue;
    }
    const indexedMatch = rawLine.match(/^\s*(\d+)\s*:\s*(.+?)\s*$/);
    if (indexedMatch) {
      out.push({ index: Number(indexedMatch[1]), name: stripQuotes(indexedMatch[2]!) });
      continue;
    }
  }

  if (out.length === 0) return [];
  const hasIndices = out.some((e) => e.index !== null);
  if (!hasIndices) return out.map((e) => e.name);
  const maxIndex = Math.max(...out.map((e) => e.index ?? -1));
  const arr: string[] = new Array(maxIndex + 1).fill('');
  for (const e of out) {
    if (e.index !== null) arr[e.index] = e.name;
  }
  return arr;
}

function stripQuotes(s: string): string {
  return s.replace(/^['"]|['"]$/g, '');
}
