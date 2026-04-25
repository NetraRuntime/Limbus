/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const projects = app.findCollectionByNameOrId('projects');
    const collection = new Collection({
      type: 'base',
      name: 'tags',
      fields: [
        {
          name: 'project',
          type: 'relation',
          required: true,
          maxSelect: 1,
          collectionId: projects.id,
          cascadeDelete: true,
        },
        { name: 'name', type: 'text', required: true, max: 256 },
        { name: 'color', type: 'text', required: true, max: 32 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      indexes: [
        'CREATE UNIQUE INDEX idx_tags_project_name_lower ON tags (project, LOWER(name))',
        'CREATE INDEX idx_tags_project ON tags (project)',
      ],
    });
    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('tags');
    return app.delete(collection);
  },
);
