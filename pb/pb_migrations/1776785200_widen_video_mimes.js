/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('videos');
    const field = collection.fields.getByName('file');
    field.mimeTypes = [];
    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('videos');
    const field = collection.fields.getByName('file');
    field.mimeTypes = [
      'video/mp4',
      'video/webm',
      'video/ogg',
      'video/quicktime',
      'video/x-matroska',
    ];
    return app.save(collection);
  },
);
