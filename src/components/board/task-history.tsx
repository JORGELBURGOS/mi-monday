"use client";

import { useEffect, useMemo, useState } from "react";
import { getTaskHistoryAction, type HistoryEntry } from "@/app/actions/automations";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { describeChange, type DescribedChange, type HistoryLookup } from "@/lib/history";
import { FormAlert } from "@/components/ui/form";

const FILTERS = [
  { key: "all", label: "Todo" },
  { key: "status", label: "Estado" },
  { key: "checklist", label: "Checklist" },
  { key: "columns", label: "Columnas" },
  { key: "item", label: "Datos del ítem" },
  { key: "comments", label: "Actualizaciones" },
  { key: "rules", label: "Reglas" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

type Row = HistoryEntry & { change: DescribedChange };

/**
 * Historial completo del ítem:
 * quién cambió qué, cuándo, el valor anterior y el nuevo, y qué regla lo hizo.
 */
export function TaskHistory({ taskId, lookup, reloadKey }: { taskId: string; lookup: HistoryLookup; reloadKey?: string }) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    getTaskHistoryAction(taskId).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setEntries(res.data);
        setError(null);
      } else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [taskId, reloadKey]);

  const rows: Row[] = useMemo(() => (entries ?? []).map((e) => ({ ...e, change: describeChange(e.kind, e.detail, lookup) })), [entries, lookup]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, rules: 0 };
    for (const r of rows) {
      c[r.change.group] = (c[r.change.group] ?? 0) + 1;
      if (r.automation_name) c.rules += 1;
    }
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "rules" ? !r.automation_name : filter !== "all" && r.change.group !== filter) return false;
      if (!q) return true;
      return [r.change.field, r.change.from, r.change.to, r.change.text, r.actor_name, r.automation_name, r.subitem]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q));
    });
  }, [rows, filter, query]);

  const byDay = useMemo(() => {
    const groups: { day: string; rows: Row[] }[] = [];
    for (const r of visible) {
      const day = new Date(r.created_at).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      const last = groups[groups.length - 1];
      if (last?.day === day) last.rows.push(r);
      else groups.push({ day, rows: [r] });
    }
    return groups;
  }, [visible]);

  if (error) return <FormAlert>{error}</FormAlert>;
  if (!entries) return <p className="text-sm text-muted">Cargando historial…</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "h-7 rounded-full border px-2.5 text-xs font-semibold",
              filter === f.key ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg",
            )}
          >
            {f.label}
            {counts[f.key] ? <span className="ml-1 font-normal opacity-70">{counts[f.key]}</span> : null}
          </button>
        ))}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar en el historial…"
          aria-label="Buscar en el historial"
          className="ml-auto h-7 w-44 rounded-md border border-line bg-surface px-2 text-xs"
        />
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted">{rows.length === 0 ? "Sin movimientos registrados todavía." : "No hay movimientos con este filtro."}</p>
      ) : (
        byDay.map((g) => (
          <section key={g.day} aria-label={g.day}>
            <h4 className="sticky top-0 z-[1] bg-surface py-1 text-xs font-semibold capitalize text-subtle">{g.day}</h4>
            <ol className="divide-y divide-line rounded-xl border border-line">
              {g.rows.map((r) => (
                <HistoryRow key={r.id} r={r} />
              ))}
            </ol>
          </section>
        ))
      )}
    </div>
  );
}

function HistoryRow({ r }: { r: Row }) {
  const c = r.change;
  const hasValues = (c.from !== null || c.to !== null) && !["comments"].includes(c.group) && c.field !== "Creación" && c.field !== "Formulario";
  const revert = r.automation_name?.endsWith("(reversión)");
  return (
    <li className="grid gap-x-3 gap-y-1 px-3 py-2 text-sm sm:grid-cols-[64px_minmax(0,150px)_minmax(0,1fr)]">
      <time dateTime={r.created_at} title={formatDateTime(r.created_at)} className="tabular-nums text-xs text-muted sm:pt-0.5">
        {new Date(r.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
      </time>
      <div className="min-w-0 text-xs">
        {r.automation_name ? (
          <>
            <span className={cn("inline-block max-w-full truncate rounded px-1.5 py-0.5 font-semibold", revert ? "bg-warning-soft text-warning" : "bg-accent-soft text-accent")}>
              ⚡ {r.automation_name}
            </span>
            {r.actor_name && <span className="block truncate text-muted">disparada por {r.actor_name}</span>}
          </>
        ) : (
          <span className="block truncate font-semibold">{r.actor_name ?? "Sistema"}</span>
        )}
      </div>
      <div className="min-w-0">
        {r.subitem && <span className="mb-0.5 inline-block rounded bg-surface-3 px-1.5 text-[11px] text-muted">Subelemento · {r.subitem}</span>}
        {hasValues ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 break-words">
            <span className="font-semibold">{c.field}</span>
            {c.group === "checklist" ? (
              <span className="text-muted">{c.text}</span>
            ) : (
              <>
                <span className="rounded bg-surface-2 px-1.5 text-muted line-through decoration-line-strong">{c.from ?? "vacío"}</span>
                <span aria-hidden className="text-subtle">→</span>
                <span className="sr-only">pasó a</span>
                <span className="rounded bg-surface-2 px-1.5 font-medium">{c.to ?? "vacío"}</span>
              </>
            )}
          </p>
        ) : (
          <p className="break-words">{c.text}</p>
        )}
      </div>
    </li>
  );
}
