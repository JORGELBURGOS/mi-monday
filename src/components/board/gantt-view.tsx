"use client";

import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { asColor } from "@/lib/constants";
import { parseTimeline, readValues, stringList, type BoardColumn } from "@/lib/columns";
import { Select } from "@/components/ui/form";
import type { Group, Status, Task } from "./types";

const ROW = 36;
const ZOOM = { dias: 34, semanas: 14, meses: 4 } as const;
type Zoom = keyof typeof ZOOM;

const DAY = 86400000;
const toDay = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);
const fromDay = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

type Bar = { task: Task; start: number; end: number; sub: boolean };

/**
 * Vista Gantt: una barra por elemento según su cronograma (o su vencimiento),
 * agrupadas por carpeta, con las dependencias y la línea de hoy. Las barras se
 * arrastran para mover las fechas y se estiran desde el borde derecho.
 */
export function GanttView({
  tasks,
  groups,
  columns,
  statuses,
  today,
  readOnly,
  onOpenTask,
  onChangeDates,
}: {
  tasks: Task[];
  groups: Group[];
  columns: BoardColumn[];
  statuses: Status[];
  today: string;
  readOnly: boolean;
  onOpenTask: (t: Task) => void;
  onChangeDates: (t: Task, source: string, start: string, end: string) => void;
}) {
  const timelines = columns.filter((c) => c.kind === "timeline");
  const dependency = columns.find((c) => c.kind === "dependency");
  const [source, setSource] = useState<string>(timelines[0]?.id ?? "due");
  const [zoom, setZoom] = useState<Zoom>("semanas");
  const [colorBy, setColorBy] = useState<"group" | "status">("group");
  const [drag, setDrag] = useState<{ id: string; mode: "move" | "end"; x0: number; delta: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const px = ZOOM[zoom];

  const span = (t: Task): { start: number; end: number } | null => {
    if (source === "due") return t.due_date ? { start: toDay(t.due_date), end: toDay(t.due_date) } : null;
    const tl = parseTimeline(readValues(t.custom_values)[source]);
    return tl ? { start: toDay(tl.start), end: toDay(tl.end) } : null;
  };

  // Filas: carpeta → elementos → subelementos.
  const rows = useMemo(() => {
    const out: ({ kind: "group"; group: Group } | ({ kind: "bar" } & Bar) | { kind: "empty"; task: Task; sub: boolean })[] = [];
    for (const g of groups) {
      const top = tasks.filter((t) => t.group_id === g.id && !t.parent_id).sort((a, b) => a.position - b.position);
      if (!top.length) continue;
      out.push({ kind: "group", group: g });
      for (const t of top) {
        const s = span(t);
        out.push(s ? { kind: "bar", task: t, ...s, sub: false } : { kind: "empty", task: t, sub: false });
        for (const c of tasks.filter((x) => x.parent_id === t.id).sort((a, b) => a.position - b.position)) {
          const cs = span(c);
          out.push(cs ? { kind: "bar", task: c, ...cs, sub: true } : { kind: "empty", task: c, sub: true });
        }
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, groups, source]);

  const bars = rows.filter((r): r is { kind: "bar" } & Bar => r.kind === "bar");
  const todayN = toDay(today);
  const min = Math.min(todayN - 14, ...bars.map((b) => b.start)) - 3;
  const max = Math.max(todayN + 45, ...bars.map((b) => b.end)) + 10;
  const days = max - min + 1;
  const width = days * px;
  const x = (d: number) => (d - min) * px;

  // Encabezado: meses y, si entra, días o semanas.
  const months: { label: string; from: number; to: number }[] = [];
  for (let d = min; d <= max; d++) {
    const date = new Date(d * DAY);
    const label = `${MONTHS[date.getUTCMonth()]} ${String(date.getUTCFullYear()).slice(2)}`;
    const last = months[months.length - 1];
    if (last && last.label === label) last.to = d;
    else months.push({ label, from: d, to: d });
  }

  const shift = (b: Bar) => {
    if (!drag || drag.id !== b.task.id) return { start: b.start, end: b.end };
    return drag.mode === "move" ? { start: b.start + drag.delta, end: b.end + drag.delta } : { start: b.start, end: Math.max(b.start, b.end + drag.delta) };
  };

  const rowIndex = new Map(rows.map((r, i) => [r.kind === "group" ? `g:${r.group.id}` : r.task.id, i]));
  const statusById = new Map(statuses.map((s) => [s.id, s]));
  const done = (t: Task) => Boolean(t.status_id && statusById.get(t.status_id)?.is_done);

  return (
    <div className="py-4">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
        <label className="flex items-center gap-1.5">
          <span className="text-muted">Fechas:</span>
          <Select value={source} onChange={(e) => setSource(e.target.value)} className="h-8 w-auto text-[13px]">
            {timelines.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="due">Vencimiento</option>
          </Select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-muted">Color:</span>
          <Select value={colorBy} onChange={(e) => setColorBy(e.target.value as "group" | "status")} className="h-8 w-auto text-[13px]">
            <option value="group">Por carpeta</option>
            <option value="status">Por estado</option>
          </Select>
        </label>
        <div className="flex rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="Escala">
          {(Object.keys(ZOOM) as Zoom[]).map((z) => (
            <button key={z} type="button" aria-pressed={zoom === z} onClick={() => setZoom(z)} className={cn("h-7 rounded-md px-2.5 text-xs font-semibold capitalize", zoom === z ? "bg-fg text-bg" : "text-muted hover:text-fg")}>
              {z}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => scroller.current?.scrollTo({ left: x(todayN) - 200, behavior: "smooth" })}
          className="h-8 rounded-lg border border-line px-2.5 text-xs font-semibold hover:bg-surface-2"
        >
          Hoy
        </button>
        {!readOnly && <span className="text-xs text-muted">Arrastrá una barra para mover sus fechas o su borde derecho para alargarla.</span>}
        {timelines.length === 0 && <span className="text-xs text-muted">Tip: agregá una columna “Cronograma” para tener barras de inicio a fin.</span>}
      </div>

      <div className="flex overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
        {/* Nombres */}
        <div className="w-[280px] shrink-0 border-r border-line">
          <div className="h-[52px] border-b border-line px-3 py-2 text-xs font-semibold text-muted">Elemento</div>
          {rows.map((r, i) =>
            r.kind === "group" ? (
              <div key={`g${r.group.id}`} className={cn(`solid-${asColor(r.group.color)}`, "flex items-center px-3 text-[13px] font-bold")} style={{ height: ROW, background: "var(--surface-2)", color: "var(--dot)" }}>
                <span className="truncate">{r.group.name}</span>
              </div>
            ) : (
              <button
                key={`n${r.task.id}${i}`}
                type="button"
                onClick={() => onOpenTask(r.task)}
                className={cn("flex w-full items-center border-t border-line/60 px-3 text-left text-[13px] hover:bg-surface-2", r.sub && "pl-7 text-muted", done(r.task) && "line-through")}
                style={{ height: ROW }}
                title={r.task.title}
              >
                {r.sub && <span className="mr-1 text-subtle">↳</span>}
                <span className="truncate">{r.task.title}</span>
              </button>
            ),
          )}
          {rows.length === 0 && <p className="p-4 text-sm text-muted">No hay elementos.</p>}
        </div>

        {/* Línea de tiempo */}
        <div ref={scroller} className="relative min-w-0 flex-1 overflow-x-auto">
          <div style={{ width }} className="relative">
            <div className="sticky top-0 h-[52px] border-b border-line bg-surface">
              <div className="relative h-6">
                {months.map((m) => (
                  <div key={m.from} className="absolute top-0 h-6 truncate border-l border-line px-1.5 pt-1 text-[11px] font-semibold capitalize text-muted" style={{ left: x(m.from), width: (m.to - m.from + 1) * px }}>
                    {m.label}
                  </div>
                ))}
              </div>
              <div className="relative h-[28px]">
                {Array.from({ length: days }, (_, k) => min + k)
                  .filter((d) => (zoom === "dias" ? true : zoom === "semanas" ? new Date(d * DAY).getUTCDay() === 1 : new Date(d * DAY).getUTCDate() === 1))
                  .map((d) => (
                    <div key={d} className={cn("absolute top-0 h-7 border-l border-line/70 pl-1 pt-1.5 text-[10px] tabular-nums", d === todayN ? "font-bold text-danger" : "text-subtle")} style={{ left: x(d) }}>
                      {new Date(d * DAY).getUTCDate()}
                    </div>
                  ))}
              </div>
            </div>

            {/* fines de semana y hoy */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 top-[52px]">
              {zoom === "dias" &&
                Array.from({ length: days }, (_, k) => min + k)
                  .filter((d) => [0, 6].includes(new Date(d * DAY).getUTCDay()))
                  .map((d) => <div key={d} className="absolute bottom-0 top-0 bg-surface-2/70" style={{ left: x(d), width: px }} />)}
              <div className="absolute bottom-0 top-0 w-0.5 bg-danger/70" style={{ left: x(todayN) + px / 2 }} aria-hidden />
            </div>

            {/* filas */}
            <div className="relative">
              {rows.map((r, i) => {
                if (r.kind === "group") return <div key={`G${r.group.id}`} style={{ height: ROW }} className="border-t border-line/60 bg-surface-2/50" />;
                if (r.kind === "empty") return <div key={`E${r.task.id}${i}`} style={{ height: ROW }} className="border-t border-line/60" />;
                const s = shift(r);
                const status = r.task.status_id ? statusById.get(r.task.status_id) : undefined;
                const color = colorBy === "status" ? asColor(status?.color) : asColor(groups.find((g) => g.id === r.task.group_id)?.color);
                const label = `${r.task.title}: ${fromDay(s.start)}${s.end !== s.start ? ` a ${fromDay(s.end)}` : ""}`;
                return (
                  <div key={`B${r.task.id}${i}`} style={{ height: ROW }} className="relative border-t border-line/60">
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={label}
                      title={label}
                      onKeyDown={(e) => e.key === "Enter" && onOpenTask(r.task)}
                      onPointerDown={(e) => {
                        if (readOnly || e.button !== 0) return;
                        const mode = (e.target as HTMLElement).dataset.handle === "end" ? "end" : "move";
                        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                        setDrag({ id: r.task.id, mode, x0: e.clientX, delta: 0 });
                      }}
                      onPointerMove={(e) => {
                        if (!drag || drag.id !== r.task.id) return;
                        setDrag({ ...drag, delta: Math.round((e.clientX - drag.x0) / px) });
                      }}
                      onPointerUp={() => {
                        if (!drag || drag.id !== r.task.id) return;
                        const d = drag;
                        setDrag(null);
                        if (d.delta === 0) return onOpenTask(r.task);
                        const ns = d.mode === "move" ? r.start + d.delta : r.start;
                        const ne = d.mode === "move" ? r.end + d.delta : Math.max(r.start, r.end + d.delta);
                        onChangeDates(r.task, source, fromDay(ns), fromDay(ne));
                      }}
                      className={cn(
                        `solid-${color}`,
                        "absolute top-1.5 flex h-6 select-none items-center overflow-hidden rounded-md px-2 text-[11px] font-semibold shadow-sm",
                        readOnly ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
                        r.sub && "h-5 top-2 opacity-85",
                        done(r.task) && "opacity-60",
                      )}
                      style={{ left: x(s.start) + 1, width: Math.max(px - 2, (s.end - s.start + 1) * px - 2) }}
                    >
                      <span className="truncate">{r.task.title}</span>
                      {!readOnly && <span data-handle="end" aria-hidden className="absolute bottom-0 right-0 top-0 w-2 cursor-ew-resize bg-black/10" />}
                    </div>
                  </div>
                );
              })}

              {/* dependencias */}
              {dependency && (
                <svg className="pointer-events-none absolute inset-0" width={width} height={rows.length * ROW} aria-hidden>
                  <defs>
                    <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                      <path d="M0,0 L8,4 L0,8 z" fill="var(--muted)" />
                    </marker>
                  </defs>
                  {bars.flatMap((b) =>
                    stringList(readValues(b.task.custom_values)[dependency.id]).map((pid) => {
                      const p = bars.find((x) => x.task.id === pid);
                      const ri = rowIndex.get(b.task.id);
                      const pi = rowIndex.get(pid);
                      if (!p || ri === undefined || pi === undefined) return null;
                      const ps = shift(p);
                      const bs = shift(b);
                      const x1 = x(ps.end + 1);
                      const y1 = pi * ROW + ROW / 2;
                      const x2 = x(bs.start);
                      const y2 = ri * ROW + ROW / 2;
                      const late = bs.start <= ps.end;
                      return (
                        <path
                          key={`${pid}-${b.task.id}`}
                          d={
                            x2 - 10 >= x1
                              ? `M${x1},${y1} h6 V${y2} H${x2 - 1}`
                              : // Si empieza antes de que termine la previa, la flecha rodea por debajo.
                                `M${x1},${y1} h6 V${y2 - ROW / 2 + 3} H${x2 - 8} V${y2} H${x2 - 1}`
                          }
                          fill="none"
                          stroke={late ? "var(--danger)" : "var(--muted)"}
                          strokeWidth={1.5}
                          strokeDasharray={late ? "4 3" : undefined}
                          markerEnd="url(#arrow)"
                        />
                      );
                    }),
                  )}
                </svg>
              )}
            </div>
          </div>
        </div>
      </div>
      {dependency && <p className="mt-2 text-xs text-muted">Las flechas muestran “{dependency.name}”. En rojo punteado: la tarea empieza antes de que termine la que depende.</p>}
    </div>
  );
}
