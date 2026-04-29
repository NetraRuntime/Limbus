export async function posterFrame(src: string): Promise<ImageBitmap> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.src = src;
  await new Promise<void>((resolve, reject) => {
    const onReady = () => {
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('error', onError);
      resolve();
    };
    const onError = () => {
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('error', onError);
      reject(new Error(`posterFrame: failed to load ${src}`));
    };
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('error', onError);
  });
  try {
    video.currentTime = 0;
    await new Promise<void>((resolve, reject) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError2);
        resolve();
      };
      const onError2 = () => {
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError2);
        reject(new Error(`posterFrame: seek failed for ${src}`));
      };
      video.addEventListener('seeked', onSeeked);
      video.addEventListener('error', onError2);
    });
    const width = video.videoWidth || 0;
    const height = video.videoHeight || 0;
    if (!width || !height) throw new Error(`posterFrame: zero dimensions for ${src}`);
    const bitmap = await createImageBitmap(video);
    return bitmap;
  } finally {
    video.src = '';
    video.load();
  }
}
