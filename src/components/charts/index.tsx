/**
 * Small, dependency-free SVG charts. Each renders into a fixed viewBox and
 * scales to its container with `w-full h-auto`, so there is no resize observer
 * and no chart library. Colors come from the shared PALETTE; axis text and grid
 * lines use `currentColor` so they follow the theme.
 */

export const PALETTE = {
  indigo: "#6366f1",
  emerald: "#10b981",
  amber: "#f59e0b",
  rose: "#f43f5e",
  sky: "#0ea5e9",
  violet: "#8b5cf6",
  slate: "#94a3b8",
} as const;

export function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ backgroundColor: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** A single-series area + line chart, e.g. active members per year. */
export function AreaChart({
  data,
  color = PALETTE.indigo,
  valueFormat = (n: number) => String(n),
}: {
  data: { label: string; value: number }[];
  color?: string;
  valueFormat?: (n: number) => string;
}) {
  const W = 720;
  const H = 260;
  // Wider left/right padding so the first and last x-axis labels (and the
  // value label on the last point) sit inside the viewBox instead of being
  // clipped at the edges.
  const pad = { l: 18, r: 22, t: 22, b: 26 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  if (data.length === 0) return <NoData />;

  const values = data.map((d) => d.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  // Give the line some breathing room below so variation is visible without a
  // misleading zero baseline for large counts; never drop below zero.
  const floor = Math.max(0, Math.floor(min - (max - min) * 0.25));
  const span = Math.max(1, max - floor);
  const x = (i: number) =>
    data.length === 1 ? pad.l + iw / 2 : pad.l + (i / (data.length - 1)) * iw;
  const y = (v: number) => pad.t + ih - ((v - floor) / span) * ih;

  const line = data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ");
  const area = `M ${x(0)},${pad.t + ih} L ${line.split(" ").join(" L ")} L ${x(data.length - 1)},${pad.t + ih} Z`;
  const gridY = [0, 0.5, 1].map((f) => pad.t + ih - f * ih);
  const gradId = `area-grad-${color.replace("#", "")}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Verlauf">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {gridY.map((gy) => (
        <line
          key={gy}
          x1={pad.l}
          x2={pad.l + iw}
          y1={gy}
          y2={gy}
          className="text-border"
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="3 4"
        />
      ))}
      <path d={area} fill={`url(#${gradId})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" />
      {data.map((d, i) => (
        <circle
          key={d.label}
          cx={x(i)}
          cy={y(d.value)}
          r={i === data.length - 1 ? 4 : 2.5}
          fill={color}
        />
      ))}
      {/* Value label on the last point. */}
      <text
        x={x(data.length - 1)}
        y={y(data[data.length - 1]!.value) - 10}
        textAnchor="end"
        className="fill-foreground"
        fill="currentColor"
        fontSize="13"
        fontWeight="600"
      >
        {valueFormat(data[data.length - 1]!.value)}
      </text>
      {data.map((d, i) => (
        <text
          key={d.label}
          x={x(i)}
          y={H - 6}
          // Anchor the outermost labels inward so they never spill past the
          // viewBox edge and get clipped.
          textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
          className="fill-muted-foreground"
          fill="currentColor"
          fontSize="11"
        >
          {d.label}
        </text>
      ))}
    </svg>
  );
}

/** Grouped vertical bars with up to a few series per category. */
export function GroupedBarChart({
  categories,
  series,
  valueFormat = (n: number) => String(n),
}: {
  categories: string[];
  series: { name: string; color: string; values: number[] }[];
  valueFormat?: (n: number) => string;
}) {
  const W = 720;
  const H = 260;
  const pad = { l: 16, r: 16, t: 16, b: 26 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  if (categories.length === 0) return <NoData />;

  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const groupW = iw / categories.length;
  const barGap = 3;
  const barW = Math.max(2, (groupW * 0.62) / series.length - barGap);
  const y = (v: number) => pad.t + ih - (v / max) * ih;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Balkendiagramm">
      {[0, 0.5, 1].map((f) => {
        const gy = pad.t + ih - f * ih;
        return (
          <line
            key={f}
            x1={pad.l}
            x2={pad.l + iw}
            y1={gy}
            y2={gy}
            className="text-border"
            stroke="currentColor"
            strokeWidth={1}
            strokeDasharray="3 4"
          />
        );
      })}
      {categories.map((cat, ci) => {
        const groupX = pad.l + ci * groupW;
        const clusterW = barW * series.length + barGap * (series.length - 1);
        const startX = groupX + (groupW - clusterW) / 2;
        return (
          <g key={cat}>
            {series.map((s, si) => {
              const v = s.values[ci] ?? 0;
              const bx = startX + si * (barW + barGap);
              const by = y(v);
              return (
                <rect
                  key={s.name}
                  x={bx}
                  y={by}
                  width={barW}
                  height={Math.max(0, pad.t + ih - by)}
                  rx={2}
                  fill={s.color}
                >
                  <title>{`${cat} · ${s.name}: ${valueFormat(v)}`}</title>
                </rect>
              );
            })}
            <text
              x={groupX + groupW / 2}
              y={H - 6}
              textAnchor="middle"
              className="fill-muted-foreground"
              fill="currentColor"
              fontSize="11"
            >
              {cat}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Donut chart with a total in the center and an inline legend. */
export function DonutChart({
  segments,
  centerLabel,
}: {
  segments: { label: string; value: number; color: string }[];
  centerLabel?: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const size = 160;
  const r = 64;
  const stroke = 22;
  const c = 2 * Math.PI * r;
  let offset = 0;
  if (total === 0) return <NoData />;

  return (
    <div className="flex items-center gap-5">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="size-40 shrink-0"
        role="img"
        aria-label="Anteile"
      >
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            className="text-muted"
            stroke="currentColor"
            strokeWidth={stroke}
            opacity={0.25}
          />
          {segments.map((s) => {
            const frac = s.value / total;
            const dash = frac * c;
            const el = (
              <circle
                key={s.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={stroke}
                strokeDasharray={`${dash} ${c - dash}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return el;
          })}
        </g>
        <text
          x={size / 2}
          y={size / 2 - 4}
          textAnchor="middle"
          className="fill-foreground"
          fill="currentColor"
          fontSize="26"
          fontWeight="700"
        >
          {total}
        </text>
        {centerLabel ? (
          <text
            x={size / 2}
            y={size / 2 + 16}
            textAnchor="middle"
            className="fill-muted-foreground"
            fill="currentColor"
            fontSize="11"
          >
            {centerLabel}
          </text>
        ) : null}
      </svg>
      <div className="flex flex-col gap-2 text-sm">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <span className="size-3 rounded-[3px]" style={{ backgroundColor: s.color }} />
            <span className="flex-1">{s.label}</span>
            <span className="font-medium tabular-nums">{s.value}</span>
            <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
              {total > 0 ? `${Math.round((s.value / total) * 100)}%` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Diverging horizontal age pyramid: one gender left, one right, per bucket. */
export function AgePyramid({
  rows,
  left,
  right,
}: {
  rows: { bucket: string; left: number; right: number }[];
  left: { label: string; color: string };
  right: { label: string; color: string };
}) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.left, r.right]));
  if (rows.length === 0) return <NoData />;
  return (
    <div className="flex flex-col gap-3">
      <ChartLegend items={[left, right]} />
      <div className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <div key={r.bucket} className="flex items-center gap-2 text-xs">
            <span className="w-8 text-right tabular-nums text-muted-foreground">{r.left}</span>
            <div className="flex flex-1 justify-end">
              <div
                className="h-3.5 rounded-l-sm"
                style={{ width: `${(r.left / max) * 100}%`, backgroundColor: left.color }}
              />
            </div>
            <span className="w-14 shrink-0 text-center font-medium text-foreground">
              {r.bucket}
            </span>
            <div className="flex flex-1 justify-start">
              <div
                className="h-3.5 rounded-r-sm"
                style={{ width: `${(r.right / max) * 100}%`, backgroundColor: right.color }}
              />
            </div>
            <span className="w-8 tabular-nums text-muted-foreground">{r.right}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Horizontal bars with a label and value, e.g. the Mahnstufen funnel. */
export function HorizontalBars({
  rows,
  color = PALETTE.amber,
  valueFormat = (n: number) => String(n),
}: {
  rows: { label: string; value: number; hint?: string }[];
  color?: string;
  valueFormat?: (n: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <NoData />;
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-3">
          <span className="w-28 shrink-0 truncate text-sm font-medium">{r.label}</span>
          <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${(r.value / max) * 100}%`, backgroundColor: color }}
            />
          </div>
          <span className="w-20 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
            {r.hint ?? valueFormat(r.value)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function NoData() {
  return <p className="py-6 text-center text-sm text-muted-foreground">Keine Daten.</p>;
}
