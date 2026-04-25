/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const collection = new Collection({
      type: 'base',
      name: 'projects',
      fields: [
        { name: 'name', type: 'text', required: true, max: 256 },
        { name: 'color', type: 'text', required: true, max: 32 },
        { name: 'icon', type: 'text', required: true, max: 64 },
        { name: 'labels', type: 'json', required: false },
        {
          name: 'thumbnail',
          type: 'file',
          required: false,
          maxSelect: 1,
          maxSize: 500 * 1024,
          mimeTypes: ['image/webp', 'image/png', 'image/jpeg'],
        },
        { name: 'last_opened_at', type: 'date' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      indexes: [
        'CREATE INDEX idx_projects_last_opened ON projects (last_opened_at)',
        'CREATE INDEX idx_projects_name_lower ON projects (LOWER(name))',
      ],
    });
    app.save(collection);

    // Seed Default Project. The next migration backfills existing media to it.
    const fresh = app.findCollectionByNameOrId('projects');
    const record = new Record(fresh, {
      name: 'Default Project',
      color: 'slate',
      icon: 'ri-folder-3-line',
      labels: [],
    });
    app.save(record);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('projects');
    return app.delete(collection);
  },
);
