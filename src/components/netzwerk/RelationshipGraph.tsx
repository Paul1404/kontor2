/**
 * Dependency-free relationship canvas. Renders the whole member network as
 * nodes + undirected edges in an SVG that pans (drag) and zooms (wheel /
 * buttons). Layout is component-based: each connected "family" is laid out on
 * its own little ring (or a star when one person is the clear hub), then the
 * clusters are packed into a rough grid. That keeps families readable as
 * separate islands instead of one hairball, and it is fast and deterministic
 * (no physics simulation, no resize observer).
 */
import { Link } from "@tanstack/react-router";
import { Crosshair, Maximize2, Minus, Plus } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { PALETTE } from "~/components/charts";
import { cn } from "~/lib/cn";

export type GraphNode = {
  id: string;
  reference: string;
  name: string;
  ort: string | null;
  isMember: boolean;
  inactive: boolean;
};

export type GraphEdge = {
  source: string;
  target: string;
  label: string | null;
  istVertreter: boolean;
};

type Point = { x: number; y: number };
type View = { x: number; y: number; w: number; h: number };

const SPACING = 96;
const GUTTER = 64;

/** Lay out one connected component centered on the origin. */
function layoutComponent(
  indices: number[],
  degree: number[],
  adjacency: Map<number, number[]>,
): Map<number, Point> {
  const out = new Map<number, Point>();
  const n = indices.length;
  if (n === 1) {
    out.set(indices[0]!, { x: 0, y: 0 });
    return out;
  }
  if (n === 2) {
    out.set(indices[0]!, { x: -SPACING * 0.6, y: 0 });
    out.set(indices[1]!, { x: SPACING * 0.6, y: 0 });
    return out;
  }
  // Hub = most-connected node. If it links to (almost) everyone, draw a star
  // with the hub in the middle; otherwise spread the whole component on a ring.
  let hub = indices[0]!;
  for (const i of indices) if (degree[i]! > degree[hub]!) hub = i;
  const isStar = (adjacency.get(hub)?.length ?? 0) >= n - 1;
  const ringNodes = isStar ? indices.filter((i) => i !== hub) : indices;
  const radius = SPACING * Math.max(1, ringNodes.length / (2 * Math.PI)) * 1.5;
  ringNodes.forEach((i, k) => {
    const a = (k / ringNodes.length) * 2 * Math.PI - Math.PI / 2;
    out.set(i, { x: Math.cos(a) * radius, y: Math.sin(a) * radius });
  });
  if (isStar) out.set(hub, { x: 0, y: 0 });
  return out;
}

/** Full layout: positions per node id + the overall bounding box. */
function computeLayout(nodes: GraphNode[], edges: GraphEdge[]) {
  const idToIdx = new Map(nodes.map((node, i) => [node.id, i]));
  const parent = nodes.map((_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r]!;
    while (parent[x] !== r) {
      const next = parent[x]!;
      parent[x] = r;
      x = next;
    }
    return r;
  };
  const degree = new Array(nodes.length).fill(0);
  const adjacency = new Map<number, number[]>();
  const addAdj = (a: number, b: number) => {
    const list = adjacency.get(a);
    if (list) list.push(b);
    else adjacency.set(a, [b]);
  };
  for (const e of edges) {
    const a = idToIdx.get(e.source);
    const b = idToIdx.get(e.target);
    if (a == null || b == null) continue;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
    degree[a] += 1;
    degree[b] += 1;
    addAdj(a, b);
    addAdj(b, a);
  }

  const comps = new Map<number, number[]>();
  nodes.forEach((_, i) => {
    const r = find(i);
    const list = comps.get(r);
    if (list) list.push(i);
    else comps.set(r, [i]);
  });

  type Block = { indices: number[]; local: Map<number, Point>; w: number; h: number };
  const blocks: Block[] = [];
  for (const idxs of comps.values()) {
    const local = layoutComponent(idxs, degree, adjacency);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of local.values()) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    // Normalize so the block starts at (0,0) with a little internal margin.
    const m = SPACING * 0.5;
    for (const [i, p] of local) local.set(i, { x: p.x - minX + m, y: p.y - minY + m });
    blocks.push({
      indices: idxs,
      local,
      w: maxX - minX + m * 2,
      h: maxY - minY + m * 2,
    });
  }

  // Largest families first, packed left-to-right into a roughly square area.
  blocks.sort((a, b) => b.indices.length - a.indices.length);
  const totalArea = blocks.reduce((s, b) => s + (b.w + GUTTER) * (b.h + GUTTER), 0);
  const rowWidth = Math.max(SPACING * 4, Math.sqrt(totalArea) * 1.3);

  const positions = new Array<Point>(nodes.length);
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  let boundW = 0;
  for (const block of blocks) {
    if (cursorX > 0 && cursorX + block.w > rowWidth) {
      cursorX = 0;
      cursorY += rowHeight + GUTTER;
      rowHeight = 0;
    }
    for (const [i, p] of block.local) {
      positions[i] = { x: cursorX + p.x, y: cursorY + p.y };
    }
    cursorX += block.w + GUTTER;
    rowHeight = Math.max(rowHeight, block.h);
    boundW = Math.max(boundW, cursorX - GUTTER);
  }
  const boundH = cursorY + rowHeight;

  return {
    positions,
    bbox: { w: Math.max(boundW, SPACING), h: Math.max(boundH, SPACING) },
    families: blocks.length,
  };
}

function fitView(points: Point[], pad: number): View {
  if (points.length === 0) return { x: 0, y: 0, w: 1000, h: 700 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return {
    x: minX - pad,
    y: minY - pad,
    w: Math.max(maxX - minX + pad * 2, SPACING),
    h: Math.max(maxY - minY + pad * 2, SPACING),
  };
}

export function RelationshipGraph({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const { positions, bbox, families } = useMemo(() => computeLayout(nodes, edges), [nodes, edges]);
  const posById = useMemo(() => {
    const m = new Map<string, Point>();
    nodes.forEach((node, i) => {
      const p = positions[i];
      if (p) m.set(node.id, p);
    });
    return m;
  }, [nodes, positions]);

  const initial = useMemo(() => fitView([...posById.values()], SPACING), [posById]);
  const [view, setView] = useState<View>(initial);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const q = query.trim().toLowerCase();
  const matchedIds = useMemo(() => {
    if (q.length < 2) return null;
    const set = new Set<string>();
    for (const node of nodes) {
      if (
        node.name.toLowerCase().includes(q) ||
        node.reference.toLowerCase().includes(q) ||
        (node.ort ?? "").toLowerCase().includes(q)
      ) {
        set.add(node.id);
      }
    }
    return set;
  }, [q, nodes]);

  const recenterTo = useCallback(
    (ids: Set<string>) => {
      const pts = [...ids].map((id) => posById.get(id)).filter((p): p is Point => p != null);
      if (pts.length > 0) setView(fitView(pts, SPACING * 1.5));
    },
    [posById],
  );

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scale = view.w / rect.width;
    setView((v) => ({
      ...v,
      x: drag.current!.vx - (e.clientX - drag.current!.x) * scale,
      y: drag.current!.vy - (e.clientY - drag.current!.y) * scale,
    }));
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const zoomBy = useCallback(
    (factor: number, cx?: number, cy?: number) => {
      setView((v) => {
        const w = Math.min(Math.max(v.w * factor, 200), bbox.w * 4 + 2000);
        const h = (w / v.w) * v.h;
        const ax = cx ?? v.x + v.w / 2;
        const ay = cy ?? v.y + v.h / 2;
        // Keep the anchor point fixed on screen while scaling.
        return {
          w,
          h,
          x: ax - ((ax - v.x) * w) / v.w,
          y: ay - ((ay - v.y) * h) / v.h,
        };
      });
    },
    [bbox.w],
  );

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const cx = view.x + ((e.clientX - rect.left) / rect.width) * view.w;
    const cy = view.y + ((e.clientY - rect.top) / rect.height) * view.h;
    zoomBy(e.deltaY > 0 ? 1.12 : 0.89, cx, cy);
  };

  const adjacentToHover = useMemo(() => {
    if (!hoverId) return null;
    const set = new Set<string>([hoverId]);
    for (const e of edges) {
      if (e.source === hoverId) set.add(e.target);
      if (e.target === hoverId) set.add(e.source);
    }
    return set;
  }, [hoverId, edges]);

  const isDimmed = (id: string) => {
    if (matchedIds && !matchedIds.has(id)) return true;
    if (adjacentToHover && !adjacentToHover.has(id)) return true;
    return false;
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matchedIds) recenterTo(matchedIds);
            }}
            placeholder="Person suchen…"
            className="h-9 w-52 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-brand/40"
          />
          {matchedIds ? (
            <button
              type="button"
              onClick={() => recenterTo(matchedIds)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <Crosshair className="size-4" />
              {matchedIds.size} Treffer
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <GraphButton label="Verkleinern" onClick={() => zoomBy(1.2)}>
            <Minus className="size-4" />
          </GraphButton>
          <GraphButton label="Vergrößern" onClick={() => zoomBy(0.83)}>
            <Plus className="size-4" />
          </GraphButton>
          <GraphButton label="Alles anzeigen" onClick={() => setView(initial)}>
            <Maximize2 className="size-4" />
          </GraphButton>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-[radial-gradient(circle_at_1px_1px,theme(colors.border)_1px,transparent_0)] [background-size:24px_24px]">
        <svg
          ref={svgRef}
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          preserveAspectRatio="xMidYMid meet"
          className="h-[68vh] w-full cursor-grab touch-none active:cursor-grabbing"
          role="img"
          aria-label="Beziehungsnetzwerk"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onWheel={onWheel}
        >
          <g>
            {edges.map((e) => {
              const a = posById.get(e.source);
              const b = posById.get(e.target);
              if (!a || !b) return null;
              const dim = isDimmed(e.source) && isDimmed(e.target);
              const active = hoverId != null && (e.source === hoverId || e.target === hoverId);
              return (
                <line
                  key={`${e.source}|${e.target}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={e.istVertreter ? PALETTE.amber : "currentColor"}
                  className={e.istVertreter ? "" : "text-border"}
                  strokeWidth={active ? 3 : e.istVertreter ? 2.5 : 1.5}
                  strokeDasharray={e.istVertreter ? "6 4" : undefined}
                  opacity={dim ? 0.12 : active ? 1 : 0.55}
                >
                  {e.label ? <title>{e.label}</title> : null}
                </line>
              );
            })}
          </g>
          <g>
            {nodes.map((node) => {
              const p = posById.get(node.id);
              if (!p) return null;
              const dim = isDimmed(node.id);
              const fill = node.isMember ? PALETTE.indigo : PALETTE.slate;
              return (
                <Link
                  key={node.id}
                  to="/app/mitglieder/$mitgliedsnummer"
                  params={{ mitgliedsnummer: node.reference }}
                  onMouseEnter={() => setHoverId(node.id)}
                  onMouseLeave={() => setHoverId((cur) => (cur === node.id ? null : cur))}
                  style={{ opacity: dim ? 0.25 : 1 }}
                  className="cursor-pointer"
                >
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={node.isMember ? 9 : 7}
                    fill={fill}
                    stroke="white"
                    strokeWidth={2}
                    opacity={node.inactive ? 0.45 : 1}
                  />
                  <text
                    x={p.x}
                    y={p.y + 22}
                    textAnchor="middle"
                    className="fill-foreground"
                    fill="currentColor"
                    fontSize="12"
                    fontWeight={500}
                    style={{ paintOrder: "stroke" }}
                    stroke="var(--color-background, white)"
                    strokeWidth={3}
                  >
                    {node.name}
                  </text>
                </Link>
              );
            })}
          </g>
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: PALETTE.indigo }} />
          Mitglied
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: PALETTE.slate }} />
          Kontakt
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-5 rounded-full" style={{ backgroundColor: PALETTE.amber }} />
          Vertretung
        </span>
        <span className="ml-auto tabular-nums">
          {nodes.length} Personen · {edges.length} Verbindungen · {families} Verbünde
        </span>
      </div>
    </div>
  );
}

function GraphButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
