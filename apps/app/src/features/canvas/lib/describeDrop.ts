import type { ScanInput } from '../../../lib/mediaIngest';

export function describeDrop(captured: ScanInput): string {
  const firstDir = captured.entries.find((e) => e && e.isDirectory)?.name;
  if (firstDir) return firstDir;
  const firstZip = captured.fallbackFiles.find((f) => /\.zip$/i.test(f.name))
    ?.name;
  if (firstZip) return firstZip;
  const first = captured.entries[0]?.name ?? captured.fallbackFiles[0]?.name;
  const count = captured.entries.length + captured.fallbackFiles.length;
  if (count <= 1 && first) return first;
  return `${count} sources`;
}
