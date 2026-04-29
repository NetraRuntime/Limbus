import { invoke } from '@tauri-apps/api/core';
import type { ImageRecord } from '../../../lib/pb';

export async function precacheImageEncoding(record: ImageRecord): Promise<void> {
  try {
    await invoke('sam3_encode_image', {
      id: record.id,
      collectionId: record.collectionId,
      file: record.file,
    });
  } catch (err) {
    console.warn('[sam3] precache failed for', record.id, err);
  }
}

export async function deleteImageEncoding(id: string): Promise<void> {
  try {
    await invoke('sam3_delete_image_cache', { id });
  } catch (err) {
    console.warn('[sam3] cache delete failed for', id, err);
  }
}
