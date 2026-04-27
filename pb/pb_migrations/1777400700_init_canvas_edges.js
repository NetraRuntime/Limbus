/// <reference path="../pb_data/types.d.ts" />

// Persistent canvas edges for the LLM workflow. Each edge connects
// two `canvas_nodes` rows. `cascadeDelete: true` on both endpoints
// means deleting a node automatically tears down its incident edges,
// matching the in-memory behavior the canvas already implemented.
migrate(
  (app) => {
    const projects = app.findCollectionByNameOrId('projects');
    const nodes = app.findCollectionByNameOrId('canvas_nodes');
    const collection = new Collection({
      type: 'base',
      name: 'canvas_edges',
      fields: [
        {
          name: 'project',
          type: 'relation',
          required: true,
          maxSelect: 1,
          collectionId: projects.id,
          cascadeDelete: true,
        },
        {
          name: 'from_node',
          type: 'relation',
          required: true,
          maxSelect: 1,
          collectionId: nodes.id,
          cascadeDelete: true,
        },
        {
          name: 'to_node',
          type: 'relation',
          required: true,
          maxSelect: 1,
          collectionId: nodes.id,
          cascadeDelete: true,
        },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      indexes: [
        'CREATE INDEX idx_canvas_edges_project ON canvas_edges (project)',
        'CREATE INDEX idx_canvas_edges_from ON canvas_edges (from_node)',
        'CREATE INDEX idx_canvas_edges_to ON canvas_edges (to_node)',
      ],
    });
    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('canvas_edges');
    return app.delete(collection);
  },
);
