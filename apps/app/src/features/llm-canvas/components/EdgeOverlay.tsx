import type { EdgeRecord, NodeRecord } from '../types/canvas';
import type { NodeSizes } from '../hooks/useNodeSizes';
import type { Connecting } from '../hooks/useConnectGesture';
import type { Rerouting } from '../hooks/useEdgeRerouteGesture';

type NodeRect = { x: number; y: number; w: number; h: number };

type Props = {
  nodes: NodeRecord[];
  nodeSizes: NodeSizes;
  edges: EdgeRecord[];
  viewScale: number;
  connecting: Connecting | null;
  rerouting: Rerouting | null;
  onEdgeEndDragStart: (
    edgeId: string,
    end: 'from' | 'to',
    clientX: number,
    clientY: number,
  ) => void;
};

const portRight = (r: NodeRect) => ({ x: r.x + r.w, y: r.y + r.h / 2 });
const portLeft = (r: NodeRect) => ({ x: r.x, y: r.y + r.h / 2 });

const bezierPath = (
  a: { x: number; y: number },
  b: { x: number; y: number },
) => {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
};

export function EdgeOverlay({
  nodes,
  nodeSizes,
  edges,
  viewScale,
  connecting,
  rerouting,
  onEdgeEndDragStart,
}: Props) {
  if (!connecting && edges.length === 0) return null;

  // Endpoint handle radius is constant in screen pixels; divide by viewScale because the
  // svg lives inside the world-transformed `.ic-content`.
  const handleR = 6 / Math.max(viewScale, 1e-6);
  const handleHitR = 12 / Math.max(viewScale, 1e-6);

  const getRect = (nodeId: string): NodeRect | null => {
    const size = nodeSizes[nodeId];
    if (!size) return null;
    const n = nodes.find((m) => m.id === nodeId);
    if (!n) return null;
    return { x: n.x, y: n.y, w: size.w, h: size.h };
  };

  return (
    <svg className="llm-edge-overlay" aria-hidden>
      {edges.map((e) => {
        const fromRect = getRect(e.from_node);
        const toRect = getRect(e.to_node);
        if (!fromRect || !toRect) return null;
        let a = portRight(fromRect);
        let b = portLeft(toRect);
        if (rerouting?.edgeId === e.id) {
          const cursor = { x: rerouting.cursorX, y: rerouting.cursorY };
          if (rerouting.end === 'from') a = cursor;
          else b = cursor;
        }
        return (
          <g key={e.id}>
            <path d={bezierPath(a, b)} className="llm-edge-path" pathLength={1} />
            <circle
              className="llm-edge-handle-hit"
              cx={a.x}
              cy={a.y}
              r={handleHitR}
              onPointerDown={(ev) => {
                ev.stopPropagation();
                ev.preventDefault();
                onEdgeEndDragStart(e.id, 'from', ev.clientX, ev.clientY);
              }}
            />
            <circle className="llm-edge-handle" cx={a.x} cy={a.y} r={handleR} />
            <circle
              className="llm-edge-handle-hit"
              cx={b.x}
              cy={b.y}
              r={handleHitR}
              onPointerDown={(ev) => {
                ev.stopPropagation();
                ev.preventDefault();
                onEdgeEndDragStart(e.id, 'to', ev.clientX, ev.clientY);
              }}
            />
            <circle className="llm-edge-handle" cx={b.x} cy={b.y} r={handleR} />
          </g>
        );
      })}
      {connecting && (() => {
        const fromRect = getRect(connecting.fromNodeId);
        if (!fromRect) return null;
        const a = portRight(fromRect);
        const b = { x: connecting.toX, y: connecting.toY };
        return (
          <path d={bezierPath(a, b)} className="llm-edge-path llm-edge-path-preview" />
        );
      })()}
    </svg>
  );
}
