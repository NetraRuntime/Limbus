/// <reference path="../pb_data/types.d.ts" />

// PocketBase's record-validator parses unique indexes from a
// collection's `indexes` array but ignores the `WHERE` clause of
// partial indexes — so `CREATE UNIQUE INDEX … ON canvas_nodes (project)
// WHERE kind = 'start'` is treated as a global "project must be
// unique" rule, which blocks creating any second node for a project.
// Drop the partial unique index; `ensureStartNode` enforces the
// at-most-one-start invariant at the app level (single-user app,
// single canvas window per project — race-free in practice).
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('canvas_nodes');
    collection.indexes = [
      'CREATE INDEX idx_canvas_nodes_project ON canvas_nodes (project)',
    ];
    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('canvas_nodes');
    collection.indexes = [
      'CREATE INDEX idx_canvas_nodes_project ON canvas_nodes (project)',
      "CREATE UNIQUE INDEX idx_canvas_nodes_start_per_project ON canvas_nodes (project) WHERE kind = 'start'",
    ];
    app.save(collection);
  },
);
