import {
  imageFileUrl,
  videoFileUrl,
  type ImageRecord,
  type VideoRecord,
} from '../../../lib/pb';
import type { CanvasMedia } from './types';

type LoadedDimensions = { src: string; width: number; height: number };

export const loadImage = (file: File): Promise<LoadedDimensions> =>
  new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () =>
      resolve({ src, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => {
      URL.revokeObjectURL(src);
      reject(new Error(`Failed to load ${file.name}`));
    };
    img.src = src;
  });

export const loadVideo = (file: File): Promise<LoadedDimensions> =>
  new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const vid = document.createElement('video');
    vid.preload = 'metadata';
    vid.muted = true;
    vid.playsInline = true;
    vid.onloadedmetadata = () => {
      const w = vid.videoWidth || 640;
      const h = vid.videoHeight || 360;
      resolve({ src, width: w, height: h });
    };
    vid.onerror = () => {
      URL.revokeObjectURL(src);
      reject(new Error(`Failed to load ${file.name}`));
    };
    vid.src = src;
  });

export const fromImageRecord = (r: ImageRecord): CanvasMedia => ({
  id: r.id,
  kind: 'image',
  src: imageFileUrl(r),
  name: r.name,
  x: r.x,
  y: r.y,
  width: r.width,
  height: r.height,
  collectionId: r.collectionId,
  file: r.file,
});

export const fromVideoRecord = (r: VideoRecord): CanvasMedia => ({
  id: r.id,
  kind: 'video',
  src: videoFileUrl(r),
  name: r.name,
  x: r.x,
  y: r.y,
  width: r.width,
  height: r.height,
  collectionId: r.collectionId,
  file: r.file,
});
