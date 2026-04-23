/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const images = app.findCollectionByNameOrId('images');
    const collection = new Collection({
      type: 'base',
      name: 'segmentations',
      fields: [
        {
          name: 'image',
          type: 'relation',
          required: true,
          maxSelect: 1,
          collectionId: images.id,
          cascadeDelete: true,
        },
        { name: 'tag', type: 'text', required: true, max: 256 },
        { name: 'masks', type: 'json', required: true },
        { name: 'source_width', type: 'number', required: true },
        { name: 'source_height', type: 'number', required: true },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      indexes: [
        'CREATE UNIQUE INDEX idx_seg_image_tag_lower ON segmentations (image, LOWER(tag))',
        'CREATE INDEX idx_seg_image ON segmentations (image)',
      ],
    });
    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('segmentations');
    return app.delete(collection);
  },
);
