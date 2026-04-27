/// <reference path="../pb_data/types.d.ts" />

// PocketBase's NumberField with `required: true` treats `0` as blank,
// so creating a node at the world origin (0, 0) fails validation.
// Coordinates always default to 0 in the app, so make them optional
// at the schema level.
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('canvas_nodes');
    for (const fieldName of ['x', 'y']) {
      const field = collection.fields.getByName(fieldName);
      if (field) field.required = false;
    }
    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('canvas_nodes');
    for (const fieldName of ['x', 'y']) {
      const field = collection.fields.getByName(fieldName);
      if (field) field.required = true;
    }
    app.save(collection);
  },
);
