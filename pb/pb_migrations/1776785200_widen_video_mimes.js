/// <reference path="../pb_data/types.d.ts" />

// Empty mimeTypes = accept anything the user drops. The original migration
// only whitelisted five specific MIMEs, which caused real-world drops to
// fail: browsers emit `video/x-m4v`, `video/mpeg`, `video/avi`, or fall back
// to `application/octet-stream` when they can't sniff the container. Rather
// than maintain a growing allowlist, let the frontend's `video/*` prefix
// check gate which files PB ever sees.
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
