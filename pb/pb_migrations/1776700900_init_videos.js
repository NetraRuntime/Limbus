/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const collection = new Collection({
      type: 'base',
      name: 'videos',
      fields: [
        {
          name: 'file',
          type: 'file',
          required: true,
          maxSelect: 1,
          maxSize: 500 * 1024 * 1024,
          mimeTypes: [
            'video/mp4',
            'video/webm',
            'video/ogg',
            'video/quicktime',
            'video/x-matroska',
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
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      indexes: ['CREATE INDEX idx_videos_created ON videos (created)'],
    });
    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('videos');
    return app.delete(collection);
  },
);
