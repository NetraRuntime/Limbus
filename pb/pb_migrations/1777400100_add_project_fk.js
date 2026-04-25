/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const projects = app.findCollectionByNameOrId('projects');
    // Default Project was seeded in 1777400000; find it by name.
    const def = app.findFirstRecordByFilter('projects', `name = "Default Project"`);
    if (!def) throw new Error('Default Project missing — 1777400000 must run first');

    for (const name of ['images', 'videos', 'segmentations']) {
      const collection = app.findCollectionByNameOrId(name);
      collection.fields.add(
        new Field({
          name: 'project',
          type: 'relation',
          required: false,
          maxSelect: 1,
          collectionId: projects.id,
          cascadeDelete: true,
        }),
      );
      app.save(collection);

      const rows = app.findAllRecords(name);
      for (const row of rows) {
        row.set('project', def.id);
        app.save(row);
      }

      const refreshed = app.findCollectionByNameOrId(name);
      const field = refreshed.fields.getByName('project');
      field.required = true;
      app.save(refreshed);
    }
  },
  (app) => {
    for (const name of ['images', 'videos', 'segmentations']) {
      const collection = app.findCollectionByNameOrId(name);
      const field = collection.fields.getByName('project');
      if (field) collection.fields.remove(field.id);
      app.save(collection);
    }
  },
);
