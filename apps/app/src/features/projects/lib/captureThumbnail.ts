export const THUMBNAIL_W = 480;
export const THUMBNAIL_H = 270;
const QUALITY = 0.7;
const MIME_PREFERRED = 'image/webp';
const MIME_FALLBACK = 'image/png';

export async function downsampleToBlob(
  source: HTMLCanvasElement,
): Promise<Blob> {
  const target = document.createElement('canvas');
  target.width = THUMBNAIL_W;
  target.height = THUMBNAIL_H;
  const ctx = target.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, THUMBNAIL_W, THUMBNAIL_H);
  // Aspect-fit the source into the thumbnail
  const sAspect = source.width / source.height;
  const tAspect = THUMBNAIL_W / THUMBNAIL_H;
  let dw = THUMBNAIL_W;
  let dh = THUMBNAIL_H;
  if (sAspect > tAspect) {
    dh = Math.round(THUMBNAIL_W / sAspect);
  } else {
    dw = Math.round(THUMBNAIL_H * sAspect);
  }
  const dx = Math.round((THUMBNAIL_W - dw) / 2);
  const dy = Math.round((THUMBNAIL_H - dh) / 2);
  ctx.drawImage(source, 0, 0, source.width, source.height, dx, dy, dw, dh);
  return await encode(target);
}

const encode = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        canvas.toBlob(
          (fallback) => {
            if (fallback) resolve(fallback);
            else reject(new Error('canvas toBlob produced null'));
          },
          MIME_FALLBACK,
        );
      },
      MIME_PREFERRED,
      QUALITY,
    );
  });
