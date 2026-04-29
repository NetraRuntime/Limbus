/// <reference path="../pb_data/types.d.ts" />

// Replace the single-row `input` / `output` text columns with an
// `examples` JSON array so a step can hold multiple input/output
// pairs (few-shot examples). On up:
//   - Add `examples` (JSON, optional, max 4MB)
//   - Backfill from existing input/output (one-row array if either was
//     non-empty; empty array otherwise)
//   - Remove `input` and `output` columns
// On down: invert the schema change. The backfill preserves the most
// recent text in examples[0] but discards any later rows.
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('canvas_nodes');
    collection.fields.add(
      new JSONField({ name: 'examples', required: false, maxSize: 4 * 1024 * 1024 }),
    );
    app.save(collection);

    const rows = app.findAllRecords('canvas_nodes');
    for (const row of rows) {
      const inText = row.get('input') ?? '';
      const outText = row.get('output') ?? '';
      const examples =
        inText !== '' || outText !== '' ? [{ input: inText, output: outText }] : [];
      row.set('examples', examples);
      app.save(row);
    }

    const refreshed = app.findCollectionByNameOrId('canvas_nodes');
    for (const fieldName of ['input', 'output']) {
      const field = refreshed.fields.getByName(fieldName);
      if (field) refreshed.fields.removeById(field.id);
    }
    app.save(refreshed);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('canvas_nodes');
    collection.fields.add(
      new TextField({ name: 'input', required: false, max: 0 }),
    );
    collection.fields.add(
      new TextField({ name: 'output', required: false, max: 0 }),
    );
    app.save(collection);

    const rows = app.findAllRecords('canvas_nodes');
    for (const row of rows) {
      const examples = row.get('examples');
      const first = Array.isArray(examples) && examples.length > 0 ? examples[0] : null;
      row.set('input', first?.input ?? '');
      row.set('output', first?.output ?? '');
      app.save(row);
    }

    const refreshed = app.findCollectionByNameOrId('canvas_nodes');
    const ex = refreshed.fields.getByName('examples');
    if (ex) refreshed.fields.removeById(ex.id);
    app.save(refreshed);
  },
);
