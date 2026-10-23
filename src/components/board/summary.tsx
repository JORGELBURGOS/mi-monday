"use client";

import { cn } from "@/lib/cn";
import { asColor, type ColorName } from "@/lib/constants";
import { formatNumber, parseTimeline, readValues, shortDate, NUMBER_SUMMARY_LABELS, type BoardColumn, type NumberSummary } from "@/lib/columns";
import { formulaValue, type RowEnv } from "@/lib/row-values";
import type { PriorityLabel } from "@/lib/board-settings";
import type { ColumnDef } from "./columns-ui";
import type { Member, Status, Task } from "./types";

/** Fila de resumen al pie de cada carpeta (como el pie de grupo de Monday). */
export function GroupSummaryRow({
  defs,
  tasks,
  env,
  statuses,
  priorities,
  members,
}: {
  defs: ColumnDef[];
  tasks: Task[];
  env: RowEnv;
  statuses: Status[];
  priorities: PriorityLabel[];
  members: Member[];
}) {
  return (
    <tr className="border-t border-line text-xs">
      <td />
      <td />
      <td className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-subtle">Resumen</td>
      {defs.map((d) => (
        <td key={d.key} className="border-l border-line/60 px-1.5 py-1.5">
          <Summary def={d} tasks={tasks} env={env} statuses={statuses} priorities={priorities} members={members} />
        </td>
      ))}
      <td />
    </tr>
  );
}

function Summary({ def, tasks, env, statuses, priorities, members }: { def: ColumnDef; tasks: Task[]; env: RowEnv; statuses: Status[]; priorities: PriorityLabel[]; members: Member[] }) {
  if (tasks.length === 0) return null;
  if (def.builtin === "status") {
    return (
      <Battery
        total={tasks.length}
        parts={[
          ...statuses.map((s) => ({ label: s.label, color: asColor(s.color), n: tasks.filter((t) => t.status_id === s.id).length })),
          { label: "Sin estado", color: null, n: tasks.filter((t) => !t.status_id).length },
        ]}
      />
    );
  }
  if (def.builtin === "priority") {
    return <Battery total={tasks.length} parts={priorities.map((p) => ({ label: p.label, color: p.color, n: tasks.filter((t) => t.priority === p.value).length }))} />;
  }
  if (def.builtin === "due") return <DateRange dates={tasks.map((t) => t.due_date).filter((d): d is string => Boolean(d))} />;
  if (def.builtin === "assignee") {
    const people = new Set(tasks.map((t) => t.assignee_id).filter(Boolean));
    return <Muted>{people.size ? `${people.size} ${people.size === 1 ? "persona" : "personas"}` : ""}</Muted>;
  }
  const c = def.column!;
  const values = tasks.map((t) => readValues(t.custom_values)[c.id]);
  switch (c.kind) {
    case "list":
      return (
        <Battery
          total={tasks.length}
          parts={[
            ...c.options.map((o) => ({ label: o.label, color: o.color, n: values.filter((v) => v === o.id).length })),
            { label: "Vacío", color: null, n: values.filter((v) => !c.options.some((o) => o.id === v)).length },
          ]}
        />
      );
    case "number":
      return <NumberSummaryCell column={c} nums={values.filter((v): v is number => typeof v === "number")} fallback="sum" />;
    case "formula": {
      const nums = tasks
        .map((t) => formulaValue(t, c, env))
        .map((r) => (r.ok && typeof r.value === "number" ? r.value : null))
        .filter((n): n is number => n !== null);
      return nums.length ? <NumberSummaryCell column={c} nums={nums} fallback="none" /> : null;
    }
    case "rating": {
      const nums = values.filter((v): v is number => typeof v === "number");
      if (!nums.length) return null;
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
      return (
        <span className="flex justify-center gap-1 font-semibold" title="Promedio">
          <span className="text-[var(--solid-yellow)]">★</span>
          {avg.toLocaleString("es-AR", { maximumFractionDigits: 1 })}
        </span>
      );
    }
    case "checkbox": {
      const n = values.filter((v) => v === true).length;
      return <Muted>{`${n} / ${tasks.length}`}</Muted>;
    }
    case "date":
      return <DateRange dates={values.filter((v): v is string => typeof v === "string")} />;
    case "timeline": {
      const ranges = values.map(parseTimeline).filter((t): t is { start: string; end: string } => Boolean(t));
      return <DateRange dates={ranges.flatMap((r) => [r.start, r.end])} />;
    }
    case "person": {
      const people = new Set(values.filter((v) => typeof v === "string" && members.some((m) => m.user_id === v)));
      return <Muted>{people.size ? `${people.size} ${people.size === 1 ? "persona" : "personas"}` : ""}</Muted>;
    }
    case "tags": {
      const n = values.filter((v) => Array.isArray(v) && v.length).length;
      return <Muted>{n ? `${n} con opciones` : ""}</Muted>;
    }
    default:
      return null;
  }
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="block truncate text-center text-muted">{children}</span>;
}

function NumberSummaryCell({ column, nums, fallback }: { column: BoardColumn; nums: number[]; fallback: NumberSummary }) {
  const kind = column.settings.summary ?? fallback;
  if (kind === "none" || nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const value =
    kind === "sum"
      ? nums.reduce((a, b) => a + b, 0)
      : kind === "avg"
        ? nums.reduce((a, b) => a + b, 0) / nums.length
        : kind === "median"
          ? sorted.length % 2
            ? sorted[(sorted.length - 1) / 2]
            : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
          : kind === "min"
            ? sorted[0]
            : kind === "max"
              ? sorted[sorted.length - 1]
              : nums.length;
  const text = kind === "count" ? String(value) : formatNumber(value, { ...column.settings, decimals: column.settings.decimals ?? (kind === "avg" || kind === "median" ? 2 : -1) });
  return (
    <span className="block text-right tabular-nums" title={NUMBER_SUMMARY_LABELS[kind]}>
      <span className="font-bold text-fg">{text}</span>
      <span className="block text-[10px] uppercase tracking-wide text-subtle">{NUMBER_SUMMARY_LABELS[kind]}</span>
    </span>
  );
}

function DateRange({ dates }: { dates: string[] }) {
  if (!dates.length) return null;
  const sorted = [...dates].sort();
  const a = sorted[0];
  const b = sorted[sorted.length - 1];
  return (
    <span className="mx-auto block w-fit rounded-full bg-surface-3 px-2 py-0.5 text-center text-[11px] font-semibold tabular-nums text-muted">
      {a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}`}
    </span>
  );
}

/** Barra de distribución por etiqueta (la "batería" de Monday). */
function Battery({ total, parts }: { total: number; parts: { label: string; color: ColorName | null; n: number }[] }) {
  const shown = parts.filter((p) => p.n > 0);
  const summary = shown.map((p) => `${p.label}: ${p.n} (${Math.round((p.n / total) * 100)}%)`).join(", ");
  return (
    <div className="flex h-6 overflow-hidden rounded-md bg-surface-3" role="img" aria-label={`Distribución: ${summary}`} title={summary}>
      {shown.map((p, i) => (
        <span key={i} className={cn(p.color ? `solid-${p.color}` : "bg-surface-3", "h-full")} style={{ width: `${(p.n / total) * 100}%` }} />
      ))}
    </div>
  );
}
