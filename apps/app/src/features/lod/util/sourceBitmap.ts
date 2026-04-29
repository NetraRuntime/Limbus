import type { AssetKind } from '../types';
import { posterFrame } from './posterFrame';

export async function sourceBitmap(
  kind: AssetKind,
  src: string,
): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
  if (kind === 'video') {
    const bitmap = await posterFrame(src);
    return { bitmap, width: bitmap.width, height: bitmap.height };
  }
  const res = await fetch(src, { credentials: 'omit' });
  if (!res.ok) throw new Error(`sourceBitmap: HTTP ${res.status} for ${src}`);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  return { bitmap, width: bitmap.width, height: bitmap.height };
}
