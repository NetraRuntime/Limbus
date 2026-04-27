/// <reference path="../pb_data/types.d.ts" />

// Persistent canvas nodes for the LLM workflow. One row per node;
// `kind` discriminates the singleton "start" node from regular "step"
// nodes. The unique partial index on `(project)` filtered to
// `kind = 'start'` enforces at most one start node per project — a
// race during init cannot create two.
migrate(
  (app) => {
    const projects = app.findCollectionByNameOrId('projects');
    const collection = new Collection({
      type: 'base',
      name: 'canvas_nodes',
      fields: [
        {
          name: 'project',
          type: 'relation',
          required: true,
          maxSelect: 1,
          collectionId: projects.id,
          cascadeDelete: true,
        },
        { name: 'kind', type: 'text', required: true, max: 32 },
        { name: 'name', type: 'text', required: true, max: 256 },
        { name: 'x', type: 'number', required: true },
        { name: 'y', type: 'number', required: true },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      indexes: [
        'CREATE INDEX idx_canvas_nodes_project ON canvas_nodes (project)',
        "CREATE UNIQUE INDEX idx_canvas_nodes_start_per_project ON canvas_nodes (project) WHERE kind = 'start'",
      ],
    });
    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('canvas_nodes');
    return app.delete(collection);
  },
);
