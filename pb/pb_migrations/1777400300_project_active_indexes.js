/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const update = (name, indexes) => {
      const collection = app.findCollectionByNameOrId(name);
      collection.indexes = indexes;
      app.save(collection);
    };
    update('images', [
      "CREATE INDEX idx_images_project_active ON images (project, created) WHERE deleted_at IS NULL OR deleted_at = ''",
    ]);
    update('videos', [
      "CREATE INDEX idx_videos_project_active ON videos (project, created) WHERE deleted_at IS NULL OR deleted_at = ''",
    ]);
    update('segmentations', [
      'CREATE UNIQUE INDEX idx_seg_image_tag_lower ON segmentations (image, LOWER(tag))',
      'CREATE INDEX idx_seg_image ON segmentations (image)',
      'CREATE INDEX idx_seg_project ON segmentations (project)',
    ]);
  },
  (app) => {
    const update = (name, indexes) => {
      const collection = app.findCollectionByNameOrId(name);
      collection.indexes = indexes;
      app.save(collection);
    };
    update('images', ['CREATE INDEX idx_images_created ON images (created)']);
    update('videos', ['CREATE INDEX idx_videos_created ON videos (created)']);
    update('segmentations', [
      'CREATE UNIQUE INDEX idx_seg_image_tag_lower ON segmentations (image, LOWER(tag))',
      'CREATE INDEX idx_seg_image ON segmentations (image)',
    ]);
  },
);
