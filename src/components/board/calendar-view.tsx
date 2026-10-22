"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { asColor } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { IconChevronLeft, IconChevronRight } from "@/components/ui/icons";
import type { Status, Task } from "./types";

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const monthFmt = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
const dayFmt = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

function iso(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function CalendarView({
  tasks,
  statuses,
  today,
  onOpenTask,
}: {
  tasks: Task[];
  statuses: Status[];
  today: string;
  onOpenTask: (t: Task) => void;
}) {
  const [cursor, setCursor] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }));
  const statusById = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);

  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.due_date) continue;
      const list = map.get(t.due_date) ?? [];
      list.push(t);
      map.set(t.due_date, list);
    }
    return map;
  }, [tasks]);

  const undated = tasks.filter((t) => !t.due_date).length;
  const first = new Date(Date.UTC(cursor.y, cursor.m, 1));
  const daysInMonth = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7; // semana empieza el lunes
  const cells: (number | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7) cells.push(null);

  const shift = (delta: number) =>
    setCursor(({ y, m }) => {
      const d = new Date(Date.UTC(y, m + delta, 1));
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
    });

  const monthCount = tasks.filter((t) => t.due_date?.startsWith(iso(cursor.y, cursor.m, 1).slice(0, 7))).length;

  return (
    <div className="py-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-extrabold first-letter:uppercase" aria-live="polite">
          {monthFmt.format(first)}
          <span className="ml-2 text-sm font-normal normal-case text-muted">
            {monthCount} {monthCount === 1 ? "tarea" : "tareas"} con vencimiento
          </span>
        </h2>
        <Button size="sm" onClick={() => setCursor({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 })}>
          Hoy
        </Button>
        <Button size="icon-sm" onClick={() => shift(-1)} aria-label="Mes anterior">
          <IconChevronLeft size={16} />
        </Button>
        <Button size="icon-sm" onClick={() => shift(1)} aria-label="Mes siguiente">
          <IconChevronRight size={16} />
        </Button>
      </div>

      {/* Grilla mensual (tablet y escritorio) */}
      <div className="hidden overflow-hidden rounded-2xl border border-line bg-surface shadow-card md:block">
        <div className="grid grid-cols-7 border-b border-line bg-surface-2 text-xs font-semibold text-muted" aria-hidden>
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-2">
              {d}
            </div>
          ))}
        </div>
        <ol className="grid grid-cols-7">
          {cells.map((day, i) => {
            if (!day) return <li key={i} className="min-h-28 border-b border-r border-line bg-surface-2/40" aria-hidden />;
            const key = iso(cursor.y, cursor.m, day);
            const items = byDay.get(key) ?? [];
            const isToday = key === today;
            return (
              <li key={i} className="min-h-28 border-b border-r border-line p-1.5">
                <div className="mb-1 flex items-center justify-between">
                  <span
                    className={cn(
                      "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold",
                      isToday ? "bg-accent text-accent-fg" : "text-muted",
                    )}
                  >
                    <span className="sr-only">{dayFmt.format(new Date(`${key}T00:00:00Z`))}</span>
                    <span aria-hidden>{day}</span>
                  </span>
                  {isToday && <span className="sr-only">(hoy)</span>}
                </div>
                <ul className="space-y-1">
                  {items.slice(0, 4).map((t) => (
                    <CalendarItem key={t.id} task={t} status={t.status_id ? statusById.get(t.status_id) : undefined} today={today} onOpen={onOpenTask} />
                  ))}
                  {items.length > 4 && <li className="px-1 text-[11px] font-semibold text-muted">+{items.length - 4} más</li>}
                </ul>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Lista por día (celular) */}
      <div className="md:hidden">
        {cells.filter((d): d is number => d !== null && (byDay.get(iso(cursor.y, cursor.m, d))?.length ?? 0) > 0).length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-muted">
            No hay tareas con vencimiento este mes.
          </p>
        ) : (
          <ol className="space-y-4">
            {cells
              .filter((d): d is number => d !== null)
              .map((day) => {
                const key = iso(cursor.y, cursor.m, day);
                const items = byDay.get(key) ?? [];
                if (!items.length) return null;
                return (
                  <li key={key}>
                    <h3 className={cn("mb-2 text-sm font-bold first-letter:uppercase", key === today && "text-accent")}>
                      {dayFmt.format(new Date(`${key}T00:00:00Z`))}
                      {key === today && " · hoy"}
                    </h3>
                    <ul className="space-y-1.5">
                      {items.map((t) => (
                        <CalendarItem key={t.id} task={t} status={t.status_id ? statusById.get(t.status_id) : undefined} today={today} onOpen={onOpenTask} />
                      ))}
                    </ul>
                  </li>
                );
              })}
          </ol>
        )}
      </div>

      {undated > 0 && (
        <p className="mt-3 text-sm text-muted">
          {undated} {undated === 1 ? "tarea no tiene" : "tareas no tienen"} fecha de vencimiento y no aparecen en el calendario.
        </p>
      )}
    </div>
  );
}

function CalendarItem({ task, status, today, onOpen }: { task: Task; status?: Status; today: string; onOpen: (t: Task) => void }) {
  const overdue = !status?.is_done && task.due_date! < today;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(task)}
        className={cn(
          `chip-${asColor(status?.color)}`,
          "flex w-full items-center gap-1.5 truncate rounded-md px-1.5 py-1 text-left text-xs font-medium hover:brightness-95",
          status?.is_done && "line-through decoration-1 opacity-75",
        )}
      >
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--dot)]" />
        <span className="truncate">{task.title}</span>
        <span className="sr-only">
          {" "}
          — {status?.label ?? "Sin estado"}
          {overdue ? ", vencida" : ""}
        </span>
      </button>
    </li>
  );
}
