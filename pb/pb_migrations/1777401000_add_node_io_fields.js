/// <reference path="../pb_data/types.d.ts" />

// Adds free-form `input` and `output` text fields to canvas_nodes —
// the per-step prompt and expected output rendered in the inspector
// sidebar's I/O table. Both default to empty so existing rows
// (including the project's start node) need no backfill. `max: 0`
// removes PocketBase's per-field length cap; node prompts can be long.
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('canvas_nodes');
    collection.fields.add(
      new TextField({ name: 'input', required: false, max: 0 }),
    );
    collection.fields.add(
      new TextField({ name: 'output', required: false, max: 0 }),
    );
    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('canvas_nodes');
    for (const fieldName of ['input', 'output']) {
      const field = collection.fields.getByName(fieldName);
      if (field) collection.fields.removeById(field.id);
    }
    app.save(collection);
  },
);
