/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    for (const name of ['images', 'videos']) {
      const collection = app.findCollectionByNameOrId(name);
      collection.fields.add(new Field({
        name: 'deleted_at',
        type: 'date',
      }));
      app.save(collection);
    }
  },
  (app) => {
    for (const name of ['images', 'videos']) {
      const collection = app.findCollectionByNameOrId(name);
      const field = collection.fields.getByName('deleted_at');
      if (field) collection.fields.remove(field.id);
      app.save(collection);
    }
  },
);
