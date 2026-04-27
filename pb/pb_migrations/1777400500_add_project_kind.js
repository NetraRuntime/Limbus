/// <reference path="../pb_data/types.d.ts" />

// Adds a `kind` discriminator to projects: 'vision' (default, computer
// vision / SAM3 workflow) or 'llm' (LLM workflow). Existing rows —
// including the seeded Default Project — predate the LLM workflow, so
// we backfill them as 'vision'. The field is added in two phases so
// the backfill happens before the NOT NULL flip.
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('projects');
    collection.fields.add(
      new TextField({
        name: 'kind',
        required: false,
        max: 32,
      }),
    );
    app.save(collection);

    const rows = app.findAllRecords('projects');
    for (const row of rows) {
      if (!row.get('kind')) {
        row.set('kind', 'vision');
        app.save(row);
      }
    }

    const refreshed = app.findCollectionByNameOrId('projects');
    const field = refreshed.fields.getByName('kind');
    field.required = true;
    app.save(refreshed);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('projects');
    const field = collection.fields.getByName('kind');
    if (field) collection.fields.remove(field.id);
    app.save(collection);
  },
);
