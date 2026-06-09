/**
 * Dependency-free relationship canvas. Renders the whole member network as
 * nodes + undirected edges in an SVG that pans (drag) and zooms (wheel /
 * buttons). Layout is component-based: each connected "family" is laid out on
 * its own little ring (or a star when one person is the clear hub), then the
 * clusters are circle-packed from the center outward so the biggest families
 * sit in the middle and the whole thing reads as one organic cloud instead of a
 * rigid grid. Each family gets a soft tinted bubble behind it so groups read as
 * units at a glance. It is fast and deterministic (no physics simulation, no
 * resize observer).
 *
 * Interaction: clicking a person selects them (it does not navigate) and opens
 * a details panel listing their connections. Clicking a connection hops to that
 * person, so the graph is explorable by tap alone -- which also makes it work
 * on touch, where the hover highlight never fires. Opening the member page is
 * an explicit button in the panel, so a stray click never yanks you off the
 * canvas.
 */
import { Link } from "@tanstack/react-router";
import { Crosshair, ExternalLink, Maximize2, Minus, Plus, X } from "lucide-react";
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
type Cluster = { x: number; y: number; r: number; color: string };

const SPACING = 96;
const GUTTER = 64;
/** Soft tint cycled across families so neighbouring bubbles stay distinct. */
const FAMILY_COLORS = [
  PALETTE.indigo,
  PALETTE.sky,
  PALETTE.violet,
  PALETTE.emerald,
  PALETTE.amber,
  PALETTE.rose,
];

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

/**
 * Find a center for a circle of radius `r` that does not overlap any already
 * placed circle, walking a phyllotaxis (sunflower) spiral outward from the
 * origin. The spiral keeps packing density even, so families settle into a
 * round cloud instead of long rows.
 */
function findSpot(placed: Cluster[], r: number, gap: number): Point {
  if (placed.length === 0) return { x: 0, y: 0 };
  const golden = Math.PI * (3 - Math.sqrt(5));
  const step = SPACING * 0.32;
  for (let i = 1; i < 8000; i++) {
    const dist = step * Math.sqrt(i);
    const ang = i * golden;
    const x = Math.cos(ang) * dist;
    const y = Math.sin(ang) * dist;
    let ok = true;
    for (const p of placed) {
      if (Math.hypot(p.x - x, p.y - y) < p.r + r + gap) {
        ok = false;
        break;
      }
    }
    if (ok) return { x, y };
  }
  return { x: 0, y: 0 };
}

/** Full layout: positions per node id, family bubbles, and the bounding box. */
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

  type Block = { indices: number[]; local: Map<number, Point>; radius: number };
  const blocks: Block[] = [];
  for (const idxs of comps.values()) {
    const local = layoutComponent(idxs, degree, adjacency);
    // Radius of the family = farthest node from its centre, plus room for the
    // node dot and the label that hangs below it.
    let reach = 0;
    for (const p of local.values()) reach = Math.max(reach, Math.hypot(p.x, p.y));
    blocks.push({ indices: idxs, local, radius: reach + SPACING * 0.6 });
  }

  // Largest families first so they claim the centre of the cloud.
  blocks.sort((a, b) => b.indices.length - a.indices.length || b.radius - a.radius);

  const positions = new Array<Point>(nodes.length);
  const clusters: Cluster[] = [];
  const placed: Cluster[] = [];
  const gap = GUTTER * 0.5;
  blocks.forEach((block, bi) => {
    const center = findSpot(placed, block.radius, gap);
    const cluster: Cluster = {
      x: center.x,
      y: center.y,
      r: block.radius,
      color: FAMILY_COLORS[bi % FAMILY_COLORS.length]!,
    };
    placed.push(cluster);
    clusters.push(cluster);
    for (const [i, p] of block.local) {
      positions[i] = { x: center.x + p.x, y: center.y + p.y };
    }
  });

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of clusters) {
    minX = Math.min(minX, c.x - c.r);
    minY = Math.min(minY, c.y - c.r);
    maxX = Math.max(maxX, c.x + c.r);
    maxY = Math.max(maxY, c.y + c.r);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = SPACING;
    maxY = SPACING;
  }

  return {
    positions,
    clusters,
    bbox: { w: Math.max(maxX - minX, SPACING), h: Math.max(maxY - minY, SPACING) },
    families: clusters.length,
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

/** Quadratic bezier with a gentle, consistent bow so links look organic. */
function edgePath(a: Point, b: Point): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const off = Math.min(len * 0.12, 20);
  const cx = (a.x + b.x) / 2 + (-dy / len) * off;
  const cy = (a.y + b.y) / 2 + (dx / len) * off;
  return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
}

export function RelationshipGraph({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const { positions, clusters, bbox, families } = useMemo(
    () => computeLayout(nodes, edges),
    [nodes, edges],
  );
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  // Distinguishes a pan from a tap so a click that ends a drag does not also
  // select a node or clear the selection.
  const dragged = useRef(false);

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

  const neighborsOf = useCallback(
    (id: string) => {
      const set = new Set<string>([id]);
      for (const e of edges) {
        if (e.source === id) set.add(e.target);
        if (e.target === id) set.add(e.source);
      }
      return set;
    },
    [edges],
  );

  const selectNode = useCallback(
    (id: string, recenter = false) => {
      setSelectedId(id);
      if (recenter) recenterTo(neighborsOf(id));
    },
    [recenterTo, neighborsOf],
  );

  const selected = selectedId ? (nodeById.get(selectedId) ?? null) : null;

  // Connections of the selected node, for the side panel. Sorted so Vertretungen
  // surface first, then alphabetically by name.
  const connections = useMemo(() => {
    if (!selectedId) return [];
    const out: { node: GraphNode; label: string | null; istVertreter: boolean }[] = [];
    for (const e of edges) {
      const otherId =
        e.source === selectedId ? e.target : e.target === selectedId ? e.source : null;
      if (!otherId) continue;
      const node = nodeById.get(otherId);
      if (node) out.push({ node, label: e.label, istVertreter: e.istVertreter });
    }
    out.sort(
      (a, b) =>
        Number(b.istVertreter) - Number(a.istVertreter) || a.node.name.localeCompare(b.node.name),
    );
    return out;
  }, [selectedId, edges, nodeById]);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragged.current = false;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag.current || !svgRef.current) return;
    if (Math.abs(e.clientX - drag.current.x) + Math.abs(e.clientY - drag.current.y) > 4) {
      dragged.current = true;
    }
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

  // The selection wins over hover so the highlight is sticky and touch-friendly.
  const focusId = selectedId ?? hoverId;
  const focusNeighbors = useMemo(
    () => (focusId ? neighborsOf(focusId) : null),
    [focusId, neighborsOf],
  );

  const isDimmed = (id: string) => {
    if (matchedIds && !matchedIds.has(id)) return true;
    if (focusNeighbors && !focusNeighbors.has(id)) return true;
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
              if (e.key === "Enter" && matchedIds) {
                recenterTo(matchedIds);
                if (matchedIds.size === 1) setSelectedId([...matchedIds][0] ?? null);
              }
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

      <div className="relative overflow-hidden rounded-xl border border-border bg-[radial-gradient(circle_at_1px_1px,theme(colors.border)_1px,transparent_0)] [background-size:24px_24px]">
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: pan/zoom data canvas; the click only clears the selection, which is also reachable via the panel's close button. Keyboard users reach people through the search box and the panel's real buttons and links. */}
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
          onClick={() => {
            // A click that did not pan and did not hit a node clears the selection.
            if (!dragged.current) setSelectedId(null);
          }}
        >
          <g>
            {clusters.map((c) => (
              <circle
                key={`cluster-${Math.round(c.x)}-${Math.round(c.y)}`}
                cx={c.x}
                cy={c.y}
                r={c.r - SPACING * 0.25}
                fill={c.color}
                stroke={c.color}
                strokeWidth={1.5}
                fillOpacity={focusId ? 0.03 : 0.06}
                strokeOpacity={focusId ? 0.08 : 0.16}
              />
            ))}
          </g>
          <g>
            {edges.map((e) => {
              const a = posById.get(e.source);
              const b = posById.get(e.target);
              if (!a || !b) return null;
              const dim = isDimmed(e.source) && isDimmed(e.target);
              const active = focusId != null && (e.source === focusId || e.target === focusId);
              return (
                <path
                  key={`${e.source}|${e.target}`}
                  d={edgePath(a, b)}
                  fill="none"
                  stroke={e.istVertreter ? PALETTE.amber : "currentColor"}
                  className={e.istVertreter ? "" : "text-border"}
                  strokeWidth={active ? 3 : e.istVertreter ? 2.5 : 1.5}
                  strokeLinecap="round"
                  strokeDasharray={e.istVertreter ? "6 4" : undefined}
                  opacity={dim ? 0.1 : active ? 1 : 0.5}
                >
                  {e.label ? <title>{e.label}</title> : null}
                </path>
              );
            })}
          </g>
          <g>
            {nodes.map((node) => {
              const p = posById.get(node.id);
              if (!p) return null;
              const dim = isDimmed(node.id);
              const isSelected = node.id === selectedId;
              const fill = node.isMember ? PALETTE.indigo : PALETTE.slate;
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: SVG node in a pan/zoom canvas; an SVG group is the only sensible hit target. The same person is reachable by keyboard via the search box, and the opened panel exposes real buttons and links.
                <g
                  key={node.id}
                  onMouseEnter={() => setHoverId(node.id)}
                  onMouseLeave={() => setHoverId((cur) => (cur === node.id ? null : cur))}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!dragged.current) selectNode(node.id);
                  }}
                  style={{ opacity: dim ? 0.22 : 1, cursor: "pointer" }}
                >
                  {isSelected ? (
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={(node.isMember ? 9 : 7) + 5}
                      fill="none"
                      className="stroke-brand"
                      strokeWidth={2.5}
                    />
                  ) : null}
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
                    fontWeight={isSelected ? 700 : 500}
                    style={{ paintOrder: "stroke" }}
                    stroke="var(--color-background, white)"
                    strokeWidth={3}
                  >
                    {node.name}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {selected ? (
          <div className="absolute right-3 top-3 z-10 flex max-h-[calc(68vh-1.5rem)] w-64 max-w-[78%] flex-col rounded-xl border border-border bg-card/95 shadow-elevated backdrop-blur">
            <div className="flex items-start justify-between gap-2 border-b border-border p-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold tracking-tight">{selected.name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5"
                    style={{
                      backgroundColor: `${selected.isMember ? PALETTE.indigo : PALETTE.slate}22`,
                    }}
                  >
                    <span
                      className="size-2 rounded-full"
                      style={{
                        backgroundColor: selected.isMember ? PALETTE.indigo : PALETTE.slate,
                      }}
                    />
                    {selected.isMember ? "Mitglied" : "Kontakt"}
                  </span>
                  <span className="tabular-nums">#{selected.reference}</span>
                  {selected.inactive ? <span>· inaktiv</span> : null}
                </div>
                {selected.ort ? (
                  <div className="mt-1 truncate text-xs text-muted-foreground">{selected.ort}</div>
                ) : null}
              </div>
              <button
                type="button"
                aria-label="Schließen"
                onClick={() => setSelectedId(null)}
                className="-mr-1 -mt-1 shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <Link
              to="/app/mitglieder/$mitgliedsnummer"
              params={{ mitgliedsnummer: selected.reference }}
              className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-sm font-medium text-brand hover:underline"
            >
              <ExternalLink className="size-3.5" /> Mitglied öffnen
            </Link>

            <div className="flex min-h-0 flex-col">
              <div className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {connections.length === 0
                  ? "Keine Verbindungen"
                  : `${connections.length} Verbindung${connections.length === 1 ? "" : "en"}`}
              </div>
              <ul className="flex flex-col gap-0.5 overflow-y-auto p-2 pt-1 scrollbar-thin">
                {connections.map((c) => (
                  <li key={c.node.id}>
                    <button
                      type="button"
                      onClick={() => selectNode(c.node.id, true)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent"
                    >
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor: c.node.isMember ? PALETTE.indigo : PALETTE.slate,
                        }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{c.node.name}</span>
                        {c.label || c.istVertreter ? (
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {c.istVertreter ? "Vertretung" : c.label}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
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
