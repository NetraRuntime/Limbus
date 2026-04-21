/// <reference path="../pb_data/types.d.ts" />

// Initial schema — the `images` collection backs every image dropped onto
// the canvas. x/y/width/height store the world-space placement so the
// scene can be restored verbatim on reload.
migrate(
  (app) => {
    const collection = new Collection({
      type: 'base',
      name: 'images',
      fields: [
        {
          name: 'file',
          type: 'file',
          required: true,
          maxSelect: 1,
          maxSize: 20 * 1024 * 1024,
          mimeTypes: [
            'image/jpeg',
            'image/png',
            'image/gif',
            'image/webp',
            'image/svg+xml',
            'image/avif',
          ],
        },
        { name: 'name', type: 'text', max: 256 },
        { name: 'x', type: 'number' },
        { name: 'y', type: 'number' },
        { name: 'width', type: 'number', required: true },
        { name: 'height', type: 'number', required: true },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      // Local-dev rules: fully open so the frontend can read/write without
      // auth. Tighten these to `@request.auth.id != ""` before deploying.
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      indexes: ['CREATE INDEX idx_images_created ON images (created)'],
    });
    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('images');
    return app.delete(collection);
  },
);
