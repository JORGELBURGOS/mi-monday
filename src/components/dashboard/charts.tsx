"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { SeriesResult } from "@/lib/dashboard-engine";

/**
 * Gráficos en SVG propios (sin librerías): barras (verticales, horizontales,
 * apiladas), líneas / área, torta / dona, barras de avance y tabla.
 * Las coordenadas del tooltip se calculan con la geometría de cada marca
 * (no con el mouse), así funcionan igual con el zoom de la interfaz.
 */

export type Fmt = (n: number | null) => string;
export type OnSelect = (ids: string[], title: string) => void;

type Tip = { x: number; y: number; title: string; rows: { label: string; value: string; fill?: string }[] } | null;

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nf * exp;
}

function ticks(max: number, n = 4) {
  const top = niceMax(max);
  return Array.from({ length: n + 1 }, (_, i) => (top / n) * i);
}

const shortLabel = (s: string, max: number) => (s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s);

function Tooltip({ tip, width }: { tip: Tip; width: number }) {
  if (!tip) return null;
  const left = Math.min(Math.max(8, tip.x + 12), Math.max(8, width - 200));
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 min-w-36 max-w-60 rounded-lg border border-line bg-surface px-2.5 py-2 text-xs shadow-lg"
      style={{ left, top: Math.max(4, tip.y - 8) }}
    >
      <p className="mb-1 font-semibold text-fg">{tip.title}</p>
      {tip.rows.map((r, i) => (
        <p key={i} className="flex items-center gap-2 text-muted">
          {r.fill && <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: r.fill }} aria-hidden />}
          <span className="min-w-0 flex-1 truncate">{r.label}</span>
          <span className="font-semibold tabular-nums text-fg">{r.value}</span>
        </p>
      ))}
      <p className="mt-1 text-[10px] text-subtle">Clic para ver los elementos</p>
    </div>
  );
}

export function Legend({ items, fmt, values }: { items: { key: string; label: string; fill: string }[]; fmt?: Fmt; values?: (number | null)[] }) {
  if (items.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 px-1 pt-1.5 text-xs text-muted" aria-label="Referencias">
      {items.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.fill }} aria-hidden />
          <span className="max-w-40 truncate">{s.label}</span>
          {values && fmt && <span className="font-semibold tabular-nums text-fg">{fmt(values[i])}</span>}
        </li>
      ))}
    </ul>
  );
}

const hasSeries = (r: SeriesResult) => r.series.length > 1 || r.series[0]?.key !== "__all";

/* ----------------------------------------------------------------- barras */

export function BarChart({
  r,
  fmt,
  horizontal,
  stacked,
  showValues,
  onSelect,
}: {
  r: SeriesResult;
  fmt: Fmt;
  horizontal?: boolean;
  stacked?: boolean;
  showValues?: boolean;
  onSelect: OnSelect;
}) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const [tip, setTip] = useState<Tip>(null);
  const multi = hasSeries(r);
  const nCat = r.categories.length;
  const nSer = r.series.length;
  const stackedMax = Math.max(0, ...r.categories.map((_, c) => r.values.reduce((a, row) => a + Math.max(0, row[c] ?? 0), 0)));
  const plainMax = Math.max(0, ...r.values.flat().map((v) => v ?? 0));
  const tk = ticks(stacked ? stackedMax : plainMax);
  const top = tk[tk.length - 1];
  const yLabelW = Math.min(90, Math.max(...tk.map((t) => fmt(t).length)) * 6.5 + 10);

  const select = (c: number, s: number | null) => {
    const ids = s === null ? [...new Set(r.ids.flatMap((row) => row[c]))] : r.ids[s][c];
    const label = r.categories[c].label + (s !== null && multi ? ` · ${r.series[s].label}` : "");
    onSelect(ids, label);
  };
  const tipRows = (c: number) =>
    r.series.map((s, i) => ({ label: multi ? s.label : r.metricLabel, value: fmt(r.values[i][c]), fill: multi ? s.fill : r.categories[c].fill })).filter((_, i) => !multi || (r.values[i][c] ?? 0) !== 0);

  if (!w || !h) return <div ref={ref} className="h-full w-full" />;

  if (horizontal) {
    const labelW = Math.min(Math.max(70, w * 0.32), 180);
    const padR = showValues !== false ? 56 : 12;
    const plotW = Math.max(10, w - labelW - padR);
    const band = Math.max(14, Math.min(40, (h - 4) / Math.max(1, nCat)));
    const barH = Math.max(8, band * 0.68);
    const totalH = band * nCat;
    const x = (v: number) => (top ? (v / top) * plotW : 0);
    return (
      <div ref={ref} className="relative h-full w-full overflow-y-auto overflow-x-hidden" onMouseLeave={() => setTip(null)}>
        <svg width={w} height={Math.max(h - 2, totalH)} role="img" aria-label={`${r.metricLabel} por categoría`}>
          {r.categories.map((c, ci) => {
            const y = ci * band + (band - barH) / 2;
            let acc = 0;
            const total = r.values.reduce((a, row) => a + (row[ci] ?? 0), 0);
            return (
              <g key={c.key}>
                <text x={labelW - 8} y={y + barH / 2} dy="0.35em" textAnchor="end" className="fill-[var(--muted)] text-[11px]">
                  <title>{c.label}</title>
                  {shortLabel(c.label, Math.floor(labelW / 6.5))}
                </text>
                {(stacked || !multi ? r.series : r.series).map((s, si) => {
                  const v = r.values[si][ci] ?? 0;
                  if (v <= 0) return null;
                  const bw = stacked || !multi ? x(v) : x(v);
                  const by = stacked || !multi ? y : y + (barH / nSer) * si;
                  const bh = stacked || !multi ? barH : Math.max(3, barH / nSer - 1);
                  const bx = labelW + (stacked ? x(acc) : 0);
                  if (stacked) acc += v;
                  const fill = multi ? s.fill : c.fill;
                  return (
                    <rect
                      key={s.key}
                      x={bx}
                      y={by}
                      width={Math.max(1, bw - (stacked ? 2 : 0))}
                      height={bh}
                      rx={3}
                      fill={fill}
                      className="cursor-pointer transition-opacity hover:opacity-85"
                      onMouseEnter={() => setTip({ x: bx + bw, y: by, title: c.label, rows: tipRows(ci) })}
                      onClick={() => select(ci, multi ? si : null)}
                    />
                  );
                })}
                {showValues !== false && (
                  <text x={labelW + x(stacked || !multi ? total : Math.max(...r.values.map((row) => row[ci] ?? 0))) + 6} y={y + barH / 2} dy="0.35em" className="fill-[var(--fg)] text-[11px] font-semibold tabular-nums">
                    {fmt(stacked || !multi ? (multi ? total : r.values[0][ci]) : r.totals[ci])}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        <Tooltip tip={tip} width={w} />
      </div>
    );
  }

  const padB = 30;
  const padT = showValues ? 16 : 6;
  const plotH = Math.max(10, h - padB - padT);
  const plotW = Math.max(10, w - yLabelW - 6);
  const band = plotW / Math.max(1, nCat);
  const groupW = Math.min(band * 0.72, multi && !stacked ? 24 * nSer : 56);
  const y = (v: number) => padT + plotH - (top ? (v / top) * plotH : 0);
  const labelEvery = Math.max(1, Math.ceil((nCat * 46) / plotW));
  const maxChars = Math.max(3, Math.floor((band * labelEvery) / 6.2));

  return (
    <div ref={ref} className="relative h-full w-full" onMouseLeave={() => setTip(null)}>
      <svg width={w} height={h} role="img" aria-label={`${r.metricLabel} por categoría`}>
        {tk.map((t) => (
          <g key={t}>
            <line x1={yLabelW} x2={w - 4} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={yLabelW - 6} y={y(t)} dy="0.35em" textAnchor="end" className="fill-[var(--subtle)] text-[10px] tabular-nums">
              {fmt(t)}
            </text>
          </g>
        ))}
        {r.categories.map((c, ci) => {
          const cx = yLabelW + band * ci + band / 2;
          let acc = 0;
          return (
            <g key={c.key}>
              {r.series.map((s, si) => {
                const v = r.values[si][ci] ?? 0;
                if (v <= 0) return null;
                const bw = stacked || !multi ? groupW : groupW / nSer;
                const bx = stacked || !multi ? cx - groupW / 2 : cx - groupW / 2 + bw * si;
                const y0 = stacked ? y(acc) : y(0);
                const y1 = stacked ? y(acc + v) : y(v);
                if (stacked) acc += v;
                const fill = multi ? s.fill : c.fill;
                const hgt = Math.max(1, y0 - y1 - (stacked ? 2 : 0));
                return (
                  <rect
                    key={s.key}
                    x={bx + (multi && !stacked ? 1 : 0)}
                    y={y1}
                    width={Math.max(2, bw - (multi && !stacked ? 2 : 0))}
                    height={hgt}
                    rx={Math.min(4, bw / 3)}
                    fill={fill}
                    className="cursor-pointer transition-opacity hover:opacity-85"
                    onMouseEnter={() => setTip({ x: cx, y: y1, title: c.label, rows: tipRows(ci) })}
                    onClick={() => select(ci, multi ? si : null)}
                  />
                );
              })}
              {showValues && (
                <text x={cx} y={y(stacked ? acc : Math.max(...r.values.map((row) => row[ci] ?? 0))) - 4} textAnchor="middle" className="fill-[var(--fg)] text-[10px] font-semibold tabular-nums">
                  {fmt(stacked || !multi ? (stacked ? acc : r.values[0][ci]) : r.totals[ci])}
                </text>
              )}
              {ci % labelEvery === 0 && (
                <text x={cx} y={h - padB + 14} textAnchor="middle" className="fill-[var(--muted)] text-[10px]">
                  <title>{c.label}</title>
                  {shortLabel(c.label, maxChars)}
                </text>
              )}
            </g>
          );
        })}
        <line x1={yLabelW} x2={w - 4} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" strokeWidth={1} />
      </svg>
      <Tooltip tip={tip} width={w} />
    </div>
  );
}

/* ----------------------------------------------------------------- líneas */

export function LineChart({ r, fmt, area, onSelect }: { r: SeriesResult; fmt: Fmt; area?: boolean; onSelect: OnSelect }) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const multi = hasSeries(r);
  const n = r.categories.length;
  const tk = ticks(Math.max(0, ...r.values.flat().map((v) => v ?? 0)));
  const top = tk[tk.length - 1];
  const yLabelW = Math.min(90, Math.max(...tk.map((t) => fmt(t).length)) * 6.5 + 10);
  if (!w || !h) return <div ref={ref} className="h-full w-full" />;
  const padB = 30;
  const padT = 8;
  const plotH = Math.max(10, h - padB - padT);
  const plotW = Math.max(10, w - yLabelW - 12);
  const step = n > 1 ? plotW / (n - 1) : 0;
  const x = (i: number) => yLabelW + (n > 1 ? step * i : plotW / 2);
  const y = (v: number) => padT + plotH - (top ? (v / top) * plotH : 0);
  const labelEvery = Math.max(1, Math.ceil((n * 48) / plotW));
  const markers = n <= 40;
  const band = n > 1 ? step : plotW;

  return (
    <div ref={ref} className="relative h-full w-full" onMouseLeave={() => setHover(null)}>
      <svg width={w} height={h} role="img" aria-label={`${r.metricLabel} en el tiempo`}>
        {tk.map((t) => (
          <g key={t}>
            <line x1={yLabelW} x2={w - 4} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={yLabelW - 6} y={y(t)} dy="0.35em" textAnchor="end" className="fill-[var(--subtle)] text-[10px] tabular-nums">
              {fmt(t)}
            </text>
          </g>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + plotH} stroke="var(--line-strong)" strokeDasharray="3 3" />}
        {r.series.map((s, si) => {
          const pts = r.categories.map((_, ci) => [x(ci), y(r.values[si][ci] ?? 0)] as const);
          const d = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("");
          const fill = multi ? s.fill : "var(--series-1)";
          return (
            <g key={s.key}>
              {area && pts.length > 0 && <path d={`${d}L${pts[pts.length - 1][0]},${y(0)}L${pts[0][0]},${y(0)}Z`} fill={fill} opacity={multi ? 0.12 : 0.18} />}
              <path d={d} fill="none" stroke={fill} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {pts.map(([px, py], ci) =>
                markers || hover === ci ? (
                  <circle key={ci} cx={px} cy={py} r={hover === ci ? 5 : 3.5} fill={fill} stroke="var(--surface)" strokeWidth={2} />
                ) : null,
              )}
            </g>
          );
        })}
        {r.categories.map((c, ci) => (
          <g key={c.key}>
            {ci % labelEvery === 0 && (
              <text x={x(ci)} y={h - padB + 14} textAnchor="middle" className="fill-[var(--muted)] text-[10px]">
                {shortLabel(c.label, 10)}
              </text>
            )}
            {/* Zona de interacción por punto, más grande que la marca. */}
            <rect
              x={x(ci) - band / 2}
              y={padT}
              width={Math.max(6, band)}
              height={plotH}
              fill="transparent"
              className="cursor-pointer"
              onMouseEnter={() => setHover(ci)}
              onClick={() => onSelect([...new Set(r.ids.flatMap((row) => row[ci]))], c.label)}
            />
          </g>
        ))}
        <line x1={yLabelW} x2={w - 4} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" strokeWidth={1} />
      </svg>
      {hover !== null && (
        <Tooltip
          tip={{
            x: x(hover),
            y: Math.min(...r.series.map((_, si) => y(r.values[si][hover] ?? 0))),
            title: r.categories[hover].label,
            rows: r.series.map((s, si) => ({ label: multi ? s.label : r.metricLabel, value: fmt(r.values[si][hover]), fill: multi ? s.fill : "var(--series-1)" })),
          }}
          width={w}
        />
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- torta */

function pieArcs(vals: number[], total: number, cx: number, cy: number, R: number, inner: number) {
  const out: { d: string; v: number; i: number }[] = [];
  let a0 = -Math.PI / 2;
  const p = (a: number, rr: number) => `${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`;
  vals.forEach((v, i) => {
    const a1 = a0 + (total ? (v / total) * Math.PI * 2 : 0);
    const big = a1 - a0 > Math.PI ? 1 : 0;
    const full = total > 0 && v === total;
    const d = full
      ? `M${cx - R},${cy}A${R},${R} 0 1 1 ${cx + R},${cy}A${R},${R} 0 1 1 ${cx - R},${cy}Z` +
        (inner ? `M${cx - inner},${cy}A${inner},${inner} 0 1 0 ${cx + inner},${cy}A${inner},${inner} 0 1 0 ${cx - inner},${cy}Z` : "")
      : inner
        ? `M${p(a0, R)}A${R},${R} 0 ${big} 1 ${p(a1, R)}L${p(a1, inner)}A${inner},${inner} 0 ${big} 0 ${p(a0, inner)}Z`
        : `M${cx},${cy}L${p(a0, R)}A${R},${R} 0 ${big} 1 ${p(a1, R)}Z`;
    out.push({ d, v, i });
    a0 = a1;
  });
  return out;
}

export function PieChart({ r, fmt, donut, onSelect }: { r: SeriesResult; fmt: Fmt; donut?: boolean; onSelect: OnSelect }) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const vals = r.categories.map((_, ci) => Math.max(0, r.totals[ci] ?? 0));
  const total = vals.reduce((a, b) => a + b, 0);
  if (!w || !h) return <div ref={ref} className="h-full w-full" />;
  const size = Math.min(h, w * 0.5, 260);
  const R = size / 2 - 4;
  const inner = donut ? R * 0.6 : 0;
  const cx = size / 2;
  const cy = size / 2;
  const arcs = pieArcs(vals, total, cx, cy, R, inner);
  const pct = (v: number) => (total ? `${Math.round((v / total) * 100)}%` : "0%");

  return (
    <div ref={ref} className="relative flex h-full w-full items-center gap-4 overflow-hidden" onMouseLeave={() => setHover(null)}>
      <svg width={size} height={size} role="img" aria-label={`Distribución: ${r.categories.map((c, i) => `${c.label} ${fmt(vals[i])}`).join(", ")}`} className="shrink-0">
        {arcs.map((a) =>
          a.v > 0 ? (
            <path
              key={a.i}
              d={a.d}
              fill={r.categories[a.i].fill}
              fillRule="evenodd"
              stroke="var(--surface)"
              strokeWidth={2}
              opacity={hover === null || hover === a.i ? 1 : 0.55}
              className="cursor-pointer transition-opacity"
              onMouseEnter={() => setHover(a.i)}
              onClick={() => onSelect(r.ids.flatMap((row) => row[a.i]), r.categories[a.i].label)}
            />
          ) : null,
        )}
        {donut && (
          <>
            <text x={cx} y={cy - 4} textAnchor="middle" className="fill-[var(--fg)] text-[18px] font-extrabold tabular-nums">
              {hover !== null ? fmt(vals[hover]) : fmt(total)}
            </text>
            <text x={cx} y={cy + 13} textAnchor="middle" className="fill-[var(--muted)] text-[10px]">
              {hover !== null ? shortLabel(r.categories[hover].label, 16) : "Total"}
            </text>
          </>
        )}
      </svg>
      <ul className="min-w-0 flex-1 space-y-1 overflow-y-auto text-xs" aria-label="Referencias" style={{ maxHeight: h }}>
        {r.categories.map((c, i) => (
          <li key={c.key}>
            <button
              type="button"
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onClick={() => onSelect(r.ids.flatMap((row) => row[i]), c.label)}
              className={cn("flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-surface-2", hover === i && "bg-surface-2")}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: c.fill }} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-muted">{c.label}</span>
              <span className="font-semibold tabular-nums">{fmt(vals[i])}</span>
              <span className="w-9 text-right tabular-nums text-subtle">{pct(vals[i])}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ----------------------------------------------------------------- avance */

export function ProgressRows({ r, fmt, onSelect }: { r: SeriesResult; fmt: Fmt; onSelect: OnSelect }) {
  return (
    <div className="flex h-full flex-col">
      <ul className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1">
        {r.categories.map((c, ci) => {
          const total = r.values.reduce((a, row) => a + Math.max(0, row[ci] ?? 0), 0);
          const summary = r.series.map((s, si) => `${s.label}: ${fmt(r.values[si][ci])}`).join(", ");
          return (
            <li key={c.key}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate font-semibold">{c.label}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted">{fmt(total)}</span>
              </div>
              <div className="flex h-3 gap-[2px] overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`${c.label}: ${summary}`}>
                {r.series.map((s, si) => {
                  const v = Math.max(0, r.values[si][ci] ?? 0);
                  if (!v || !total) return null;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      title={`${s.label}: ${fmt(v)} (${Math.round((v / total) * 100)}%)`}
                      aria-label={`${c.label}, ${s.label}: ${fmt(v)}`}
                      onClick={() => onSelect(r.ids[si][ci], `${c.label} · ${s.label}`)}
                      className="h-full first:rounded-l-full last:rounded-r-full hover:opacity-85"
                      style={{ width: `${(v / total) * 100}%`, background: s.fill }}
                    />
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
      <Legend items={r.series} />
    </div>
  );
}

/* ----------------------------------------------------------------- tabla */

export function SeriesTable({ r, fmt, onSelect, dimLabel }: { r: SeriesResult; fmt: Fmt; onSelect: OnSelect; dimLabel: string }) {
  const multi = hasSeries(r);
  const colTotals = r.series.map((_, si) => r.values[si].reduce<number>((a, v) => a + (v ?? 0), 0));
  const additive = ["Cantidad de elementos"].includes(r.metricLabel) || r.metricLabel.startsWith("Suma");
  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead className="sticky top-0 bg-surface">
          <tr>
            <th scope="col" className="border-b border-line px-2 py-1.5 text-left font-semibold text-muted">
              {dimLabel}
            </th>
            {r.series.map((s) => (
              <th key={s.key} scope="col" className="border-b border-line px-2 py-1.5 text-right font-semibold text-muted">
                <span className="inline-flex items-center gap-1.5">
                  {multi && <span className="h-2 w-2 rounded-sm" style={{ background: s.fill }} aria-hidden />}
                  {multi ? s.label : r.metricLabel}
                </span>
              </th>
            ))}
            {multi && (
              <th scope="col" className="border-b border-line px-2 py-1.5 text-right font-semibold text-muted">
                Total
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {r.categories.map((c, ci) => (
            <tr key={c.key} className="hover:bg-surface-2">
              <th scope="row" className="border-b border-line px-2 py-1.5 text-left font-medium">
                {c.label}
              </th>
              {r.series.map((s, si) => (
                <td key={s.key} className="border-b border-line px-2 py-1.5 text-right tabular-nums">
                  {r.ids[si][ci].length ? (
                    <button type="button" className="hover:underline" onClick={() => onSelect(r.ids[si][ci], `${c.label}${multi ? ` · ${s.label}` : ""}`)}>
                      {fmt(r.values[si][ci])}
                    </button>
                  ) : (
                    <span className="text-subtle">{fmt(r.values[si][ci])}</span>
                  )}
                </td>
              ))}
              {multi && <td className="border-b border-line px-2 py-1.5 text-right font-semibold tabular-nums">{fmt(r.totals[ci])}</td>}
            </tr>
          ))}
        </tbody>
        {additive && r.categories.length > 1 && (
          <tfoot>
            <tr className="font-semibold">
              <th scope="row" className="px-2 py-1.5 text-left">
                Total
              </th>
              {colTotals.map((t, i) => (
                <td key={i} className="px-2 py-1.5 text-right tabular-nums">
                  {fmt(t)}
                </td>
              ))}
              {multi && <td className="px-2 py-1.5 text-right tabular-nums">{fmt(colTotals.reduce((a, b) => a + b, 0))}</td>}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
