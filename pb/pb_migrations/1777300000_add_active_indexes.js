/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    for (const name of ['images', 'videos']) {
      const collection = app.findCollectionByNameOrId(name);
      collection.indexes = collection.indexes.concat([
        `CREATE INDEX idx_${name}_active ON ${name} (deleted_at)`,
      ]);
      app.save(collection);
    }
  },
  (app) => {
    for (const name of ['images', 'videos']) {
      const collection = app.findCollectionByNameOrId(name);
      collection.indexes = collection.indexes.filter(
        (def) => !def.includes(`idx_${name}_active`),
      );
      app.save(collection);
    }
  },
);
