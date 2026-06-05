export const LLM_VIEW_STORAGE_KEY = 'netra-limbus:llm-canvas:view:v1';

// Visual approximation — step nodes are auto-sized to their text, but
// for edge anchoring we need a stable midpoint. Matches the CSS:
// 10px padding top/bottom + 14px label = ~34, rounded to 36.
export const STEP_NODE_HEIGHT = 36;
