"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { Dialog } from "@/components/ui/dialog";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { IconDots, IconGrip } from "@/components/ui/icons";
import {
  catsOf,
  computeWidget,
  dateOf,
  describeDim,
  fieldCatalog,
  fieldLabel,
  formatValue,
  isDone,
  type Dataset,
  type DsTask,
  type GlobalFilters,
  type SeriesResult,
} from "@/lib/dashboard-engine";
import { DATE_BASE_FIELDS, HEIGHTS, WIDTHS, type Widget } from "@/lib/dashboards";
import { BarChart, Legend, LineChart, PieChart, ProgressRows, SeriesTable, type Fmt } from "./charts";

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const shortDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}${y !== new Date().getFullYear() ? ` ${String(y).slice(2)}` : ""}`;
};

/** Texto de un campo para un elemento (para listas y para el detalle). */
export function fieldText(ds: Dataset, t: DsTask, field: string): string {
  const isDate = DATE_BASE_FIELDS.includes(field) || /\|(date|timeline)$/.test(field);
  if (isDate) {
    const d = dateOf(ds, t, field);
    return d ? shortDate(d) : "";
  }
  return catsOf(ds, t, field)
    .filter((c) => c.key !== "__none")
    .map((c) => c.label)
    .join(", ");
}

const WIDTH_LABELS: Record<number, string> = { 3: "¼", 4: "⅓", 6: "½", 8: "⅔", 12: "Completo" };

export function WidgetCard({
  w,
  ds,
  filters,
  editing,
  onEdit,
  onChange,
  onDuplicate,
  onRemove,
  onMove,
  dragProps,
}: {
  w: Widget;
  ds: Dataset;
  filters: GlobalFilters;
  editing: boolean;
  onEdit: () => void;
  onChange: (w: Widget) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  dragProps?: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
}) {
  const { className: dragClass, ...drag } = dragProps ?? {};
  const [asTable, setAsTable] = useState(w.type === "pivot");
  const [drill, setDrill] = useState<{ ids: string[]; title: string } | null>(null);
  const result = useMemo(() => {
    try {
      return computeWidget(ds, w, filters);
    } catch {
      return null;
    }
  }, [ds, w, filters]);
  const fmt: Fmt = (n) => formatValue(n, w, { compact: true });
  const isChart = result?.kind === "series";

  const items: MenuItem[] = [];
  if (isChart && w.type !== "pivot") items.push({ label: asTable ? "Ver como gráfico" : "Ver como tabla", onSelect: () => setAsTable((x) => !x) });
  if (result && result.kind !== "text") items.push({ label: "Descargar CSV", onSelect: () => downloadCsv(ds, w, result) });
  if (result?.kind === "kpi") items.push({ label: "Ver los elementos", onSelect: () => setDrill({ ids: result.ids, title: w.title || "Elementos" }) });
  if (editing) {
    if (items.length) items.push({ type: "separator" });
    items.push({ label: "Configurar…", onSelect: onEdit });
    items.push({ label: "Duplicar", onSelect: onDuplicate });
    items.push({ label: "Mover antes", onSelect: () => onMove(-1) });
    items.push({ label: "Mover después", onSelect: () => onMove(1) });
    items.push({ type: "label", label: "Ancho" });
    for (const n of WIDTHS) items.push({ label: `${n === w.w ? "✓ " : ""}${WIDTH_LABELS[n]}`, onSelect: () => onChange({ ...w, w: n }) });
    items.push({ type: "label", label: "Alto" });
    for (const n of HEIGHTS) items.push({ label: `${n === w.h ? "✓ " : ""}${n === 1 ? "Bajo" : n === 2 ? "Medio" : n === 3 ? "Alto" : "Muy alto"}`, onSelect: () => onChange({ ...w, h: n }) });
    items.push({ type: "separator" });
    items.push({ label: "Quitar widget", danger: true, onSelect: onRemove });
  }

  return (
    <section
      aria-label={w.title || "Widget"}
      className={cn(
        "dash-cell group flex min-w-0 flex-col rounded-2xl border bg-surface shadow-card",
        w.type === "text" ? "border-transparent bg-transparent shadow-none" : "border-line",
        editing && "border-dashed border-line-strong",
        editing && dragClass,
      )}
      data-w={w.w}
      style={{ ["--w" as string]: w.w, ["--h" as string]: w.h }}
      {...(editing ? drag : {})}
    >
      <header className={cn("flex items-center gap-1 px-4 pt-3", w.type === "text" && "px-1")}>
        {editing && (
          <span className="cursor-grab text-subtle active:cursor-grabbing" title="Arrastrá para mover" aria-hidden>
            <IconGrip size={14} />
          </span>
        )}
        {w.type !== "text" && (
          <h3 className="min-w-0 flex-1 truncate text-sm font-bold" title={w.title}>
            {w.title || "Sin título"}
          </h3>
        )}
        {w.type === "text" && <span className="flex-1" />}
        {editing && (
          <button type="button" onClick={onEdit} className="rounded-md px-2 py-1 text-xs font-semibold text-accent hover:bg-accent-soft">
            Configurar
          </button>
        )}
        {items.length > 0 && (
          <Menu
            label={`Opciones de ${w.title || "widget"}`}
            items={items}
            trigger={<IconDots size={16} />}
            triggerClassName={cn("h-7 w-7 rounded-md text-muted hover:bg-surface-2", !editing && "opacity-0 focus:opacity-100 group-hover:opacity-100")}
          />
        )}
      </header>
      {w.type !== "text" && (w.dim || w.filters.state !== "all" || w.filters.conditions.length > 0) && (
        <p className="truncate px-4 text-[11px] text-subtle">{subtitle(ds, w)}</p>
      )}
      <div className={cn("min-h-0 flex-1 px-4 pb-3 pt-2", w.type === "text" && "px-1")}>
        {!result ? (
          <p className="text-sm text-danger">Este widget tiene una configuración que no se pudo calcular. Revisala.</p>
        ) : result.kind === "text" ? (
          <TextBody w={w} />
        ) : result.kind === "kpi" ? (
          <button type="button" onClick={() => setDrill({ ids: result.ids, title: w.title || "Elementos" })} className="flex h-full w-full flex-col justify-center text-left">
            <span className="text-4xl font-extrabold tracking-tight tabular-nums">{formatValue(result.value, w)}</span>
            {w.metric.op !== "count" && <span className="text-xs text-muted">{result.count} elementos</span>}
            {w.options.goal !== undefined && w.options.goal !== 0 && result.value !== null && (
              <span className="mt-2 block">
                <span className="flex justify-between text-[11px] text-muted">
                  <span>Meta {formatValue(w.options.goal, w)}</span>
                  <span className="font-semibold">{Math.round((result.value / w.options.goal) * 100)}%</span>
                </span>
                <span className="mt-1 block h-2 overflow-hidden rounded-full bg-surface-3">
                  <span className="block h-full rounded-full bg-[var(--series-1)]" style={{ width: `${Math.min(100, Math.max(0, (result.value / w.options.goal) * 100))}%` }} />
                </span>
              </span>
            )}
          </button>
        ) : result.kind === "list" ? (
          <ListBody ds={ds} w={w} tasks={result.tasks} total={result.total} />
        ) : result.categories.length === 0 ? (
          <p className="flex h-full items-center justify-center text-sm text-muted">Sin datos con estos filtros.</p>
        ) : asTable || w.type === "pivot" ? (
          <SeriesTable r={result} fmt={fmt} onSelect={(ids, title) => setDrill({ ids, title })} dimLabel={fieldLabel(ds, w.dim?.field)} />
        ) : (
          <ChartBody w={w} r={result} fmt={fmt} onSelect={(ids, title) => setDrill({ ids, title })} />
        )}
      </div>
      {drill && <DrillDialog ds={ds} title={`${w.title || "Widget"} · ${drill.title}`} ids={drill.ids} onClose={() => setDrill(null)} />}
    </section>
  );
}

function subtitle(ds: Dataset, w: Widget) {
  const parts: string[] = [];
  if (w.dim && w.type !== "kpi" && w.type !== "list") parts.push(`por ${describeDim(ds, w.dim).toLowerCase()}`);
  if (w.split?.field && w.type !== "kpi" && w.type !== "list") parts.push(`y ${fieldLabel(ds, w.split.field).toLowerCase()}`);
  if (w.filters.state !== "all") parts.push({ open: "pendientes", done: "terminados", overdue: "vencidos" }[w.filters.state]);
  if (w.filters.boards.length) parts.push(w.filters.boards.length === 1 ? (ds.boards.find((b) => b.id === w.filters.boards[0])?.name ?? "1 tablero") : `${w.filters.boards.length} tableros`);
  if (w.filters.conditions.length) parts.push(`${w.filters.conditions.length} ${w.filters.conditions.length === 1 ? "filtro" : "filtros"}`);
  return parts.join(" · ");
}

function ChartBody({ w, r, fmt, onSelect }: { w: Widget; r: SeriesResult; fmt: Fmt; onSelect: (ids: string[], title: string) => void }) {
  const multi = r.series.length > 1 || r.series[0]?.key !== "__all";
  switch (w.type) {
    case "pie":
    case "donut":
      return <PieChart r={r} fmt={fmt} donut={w.type === "donut"} onSelect={onSelect} />;
    case "progress":
      return <ProgressRows r={r} fmt={fmt} onSelect={onSelect} />;
    case "line":
    case "area":
      return (
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1">
            <LineChart r={r} fmt={fmt} area={w.type === "area"} onSelect={onSelect} />
          </div>
          {multi && <Legend items={r.series} />}
        </div>
      );
    default:
      return (
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1">
            <BarChart r={r} fmt={fmt} horizontal={w.type === "hbar"} stacked={w.type === "stacked"} showValues={w.options.showValues ?? w.type === "hbar"} onSelect={onSelect} />
          </div>
          {multi && <Legend items={r.series} />}
        </div>
      );
  }
}

function TextBody({ w }: { w: Widget }) {
  return (
    <div className="h-full overflow-auto">
      {w.title && <h2 className="text-lg font-extrabold tracking-tight">{w.title}</h2>}
      {w.options.text && <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{w.options.text}</p>}
    </div>
  );
}

function ListBody({ ds, w, tasks, total }: { ds: Dataset; w: Widget; tasks: DsTask[]; total: number }) {
  const fields = w.options.fields?.length ? w.options.fields : ["board", "assignee", "due"];
  if (!tasks.length) return <p className="flex h-full items-center justify-center text-sm text-muted">No hay elementos con estos filtros.</p>;
  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead className="sticky top-0 bg-surface">
          <tr>
            <th scope="col" className="border-b border-line px-2 py-1.5 text-left font-semibold text-muted">
              Elemento
            </th>
            {fields.map((f) => (
              <th key={f} scope="col" className="border-b border-line px-2 py-1.5 text-left font-semibold text-muted">
                {fieldLabel(ds, f)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} className="hover:bg-surface-2">
              <td className="max-w-64 truncate border-b border-line px-2 py-1.5">
                <Link href={`/t/${t.board_id}?item=${t.parent_id ?? t.id}`} prefetch={false} className={cn("font-medium hover:underline", isDone(ds, t) && "text-muted line-through")}>
                  {t.title}
                </Link>
              </td>
              {fields.map((f) => (
                <td key={f} className={cn("max-w-40 truncate border-b border-line px-2 py-1.5 text-muted", f === "due" && t.due_date && t.due_date < ds.today && !isDone(ds, t) && "font-semibold text-danger")}>
                  {fieldText(ds, t, f)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {total > tasks.length && <p className="px-2 pt-1.5 text-[11px] text-subtle">Mostrando {tasks.length} de {total}.</p>}
    </div>
  );
}

export function DrillDialog({ ds, title, ids, onClose }: { ds: Dataset; title: string; ids: string[]; onClose: () => void }) {
  const tasks = useMemo(() => {
    const set = new Set(ids);
    return ds.tasks.filter((t) => set.has(t.id)).sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  }, [ds, ids]);
  return (
    <Dialog open onClose={onClose} title={title} description={`${tasks.length} ${tasks.length === 1 ? "elemento" : "elementos"}`} size="lg">
      {tasks.length === 0 ? (
        <p className="text-sm text-muted">No hay elementos.</p>
      ) : (
        <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
          {tasks.slice(0, 500).map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
              <Link href={`/t/${t.board_id}?item=${t.parent_id ?? t.id}`} prefetch={false} className={cn("min-w-0 flex-1 truncate font-medium hover:underline", isDone(ds, t) && "text-muted line-through")}>
                {t.title}
              </Link>
              <span className="text-xs text-muted">{fieldText(ds, t, "board")}</span>
              <span className="text-xs text-muted">{fieldText(ds, t, "status") || "Sin estado"}</span>
              <span className="text-xs text-muted">{fieldText(ds, t, "assignee")}</span>
              {t.due_date && <span className={cn("text-xs tabular-nums", t.due_date < ds.today && !isDone(ds, t) ? "font-semibold text-danger" : "text-muted")}>{shortDate(t.due_date)}</span>}
            </li>
          ))}
        </ul>
      )}
      {tasks.length > 500 && <p className="mt-2 text-xs text-muted">Mostrando 500 de {tasks.length}.</p>}
    </Dialog>
  );
}

/* ----------------------------------------------------------------- CSV */

function csvCell(v: unknown) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(ds: Dataset, w: Widget, r: NonNullable<ReturnType<typeof computeWidget>>) {
  let rows: unknown[][] = [];
  if (r.kind === "kpi") rows = [["Indicador", "Valor"], [w.title || "KPI", r.value ?? ""]];
  else if (r.kind === "list") {
    const fields = w.options.fields?.length ? w.options.fields : ["board", "assignee", "due"];
    rows = [["Elemento", ...fields.map((f) => fieldLabel(ds, f))], ...r.tasks.map((t) => [t.title, ...fields.map((f) => fieldText(ds, t, f))])];
  } else if (r.kind === "series") {
    const multi = r.series.length > 1 || r.series[0]?.key !== "__all";
    rows = [
      [fieldLabel(ds, w.dim?.field), ...(multi ? r.series.map((s) => s.label) : [r.metricLabel]), ...(multi ? ["Total"] : [])],
      ...r.categories.map((c, ci) => [c.label, ...r.series.map((_, si) => r.values[si][ci] ?? ""), ...(multi ? [r.totals[ci] ?? ""] : [])]),
    ];
  }
  // Punto y coma: lo abre bien una planilla en español.
  const csv = "﻿" + rows.map((row) => row.map(csvCell).join(";")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(w.title || "widget").replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "widget"}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { fieldCatalog };
