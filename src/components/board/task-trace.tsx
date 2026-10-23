"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getTaskTraceAction, type TraceEvent, type TraceNode } from "@/app/actions/automations";
import { cn } from "@/lib/cn";
import { PRIORITY_BY_VALUE, asColor, type Priority } from "@/lib/constants";
import { formatDateTime, formatDueDate, relativeTime, todayIsoLocal } from "@/lib/format";
import { Chip } from "@/components/ui/misc";
import { FormAlert } from "@/components/ui/form";

/**
 * Recorrido de un ítem: la cadena de tableros por la que pasó (original y
 * copias), cuánto tiempo estuvo en cada estado y el historial completo.
 */
export function TaskTrace({
  taskId,
  boardId,
  onOpenTask,
}: {
  taskId: string;
  boardId: string;
  /** Abre otro ítem del mismo tablero sin salir de la página. */
  onOpenTask?: (taskId: string) => void;
}) {
  const [data, setData] = useState<{ chain: TraceNode[]; events: TraceEvent[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTaskTraceAction(taskId).then((res) => {
      if (cancelled) return;
      if (res.ok) setData(res.data);
      else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  if (error) return <FormAlert>{error}</FormAlert>;
  if (!data) return <p className="text-sm text-muted">Cargando recorrido…</p>;

  const upstream = data.chain.filter((n) => n.depth < 0);
  const downstream = data.chain.filter((n) => n.depth > 0);
  const stages = timeByStatus(data.events);

  return (
    <div className="space-y-6">
      <section aria-labelledby="trace-chain">
        <h3 id="trace-chain" className="mb-2 text-sm font-bold">
          Cadena
        </h3>
        {upstream.length === 0 && downstream.length === 0 ? (
          <p className="text-sm text-muted">
            Este ítem todavía no pasó a otros tableros. Cuando una regla lo copie, acá vas a ver de dónde viene y a dónde fue.
          </p>
        ) : (
          <ol className="relative space-y-2 border-l-2 border-line pl-4">
            {upstream
              .sort((a, b) => a.depth - b.depth)
              .map((n) => (
                <ChainNode key={`u-${n.task_id}`} node={n} role="Origen" currentBoardId={boardId} onOpenTask={onOpenTask} />
              ))}
            <li className="relative">
              <span aria-hidden className="absolute -left-[23px] top-3 h-3 w-3 rounded-full border-2 border-surface bg-accent" />
              <div className="rounded-xl border-2 border-accent/40 bg-accent-soft px-3 py-2 text-sm font-semibold">Este ítem</div>
            </li>
            {downstream
              .sort((a, b) => a.depth - b.depth)
              .map((n) => (
                <ChainNode
                  key={`d-${n.task_id}`}
                  node={n}
                  role={n.depth === 1 ? "Copia" : "Copia de la copia"}
                  currentBoardId={boardId}
                  onOpenTask={onOpenTask}
                />
              ))}
          </ol>
        )}
      </section>

      {stages.length > 0 && (
        <section aria-labelledby="trace-stages">
          <h3 id="trace-stages" className="mb-2 text-sm font-bold">
            Tiempo en cada estado
          </h3>
          <ul className="space-y-1.5">
            {stages.map((s) => (
              <li key={s.label} className="grid grid-cols-[minmax(0,140px)_1fr_auto] items-center gap-3 text-sm">
                <span className="truncate">{s.label}</span>
                <span className="h-2 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                  <span
                    className={cn(`dot-${asColor(s.color)}`, "block h-full rounded-full bg-[var(--dot)]")}
                    style={{ width: `${Math.max(4, (s.ms / stages[0].ms) * 100)}%` }}
                  />
                </span>
                <span className="tabular-nums text-muted">
                  {formatDuration(s.ms)}
                  {s.current && <span className="sr-only"> (estado actual)</span>}
                  {s.current && <span aria-hidden> · ahora</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="trace-history">
        <h3 id="trace-history" className="mb-2 text-sm font-bold">
          Historial
        </h3>
        {data.events.length === 0 ? (
          <p className="text-sm text-muted">Sin movimientos registrados todavía.</p>
        ) : (
          <ol className="space-y-2.5">
            {[...data.events].reverse().map((e) => (
              <li key={e.id} className="flex gap-3 text-sm">
                <span
                  aria-hidden
                  className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", e.automation_name ? "bg-accent" : "bg-line-strong")}
                />
                <div className="min-w-0">
                  <p className="break-words">{describeEvent(e)}</p>
                  <p className="text-xs text-muted">
                    {e.automation_name ? (
                      <>
                        Regla «{e.automation_name}»{e.actor_name ? ` · disparada por ${e.actor_name}` : ""}
                      </>
                    ) : (
                      e.actor_name ?? "Sistema"
                    )}{" "}
                    ·{" "}
                    <time dateTime={e.created_at} title={formatDateTime(e.created_at)}>
                      {relativeTime(e.created_at)}
                    </time>
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function ChainNode({
  node,
  role,
  currentBoardId,
  onOpenTask,
}: {
  node: TraceNode;
  role: string;
  currentBoardId: string;
  onOpenTask?: (taskId: string) => void;
}) {
  const hidden = !node.title;
  const href = node.board_id ? `/t/${node.board_id}?item=${node.task_id}` : null;
  return (
    <li className="relative">
      <span aria-hidden className="absolute -left-[23px] top-3 h-3 w-3 rounded-full border-2 border-surface bg-line-strong" />
      <div className="rounded-xl border border-line bg-surface px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-subtle">{role}</p>
        {hidden ? (
          <p className="text-sm text-muted">Está en un tablero al que no tenés acceso.</p>
        ) : (
          <>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              {node.board_id === currentBoardId && onOpenTask ? (
                <button type="button" onClick={() => onOpenTask(node.task_id)} className="text-left font-semibold hover:underline">
                  {node.title}
                </button>
              ) : href ? (
                <Link href={href} prefetch={false} className="font-semibold hover:underline">
                  {node.title}
                </Link>
              ) : (
                <span className="font-semibold">{node.title}</span>
              )}
              {node.status_label && <Chip color={asColor(node.status_color)}>{node.status_label}</Chip>}
            </p>
            <p className="text-xs text-muted">
              {node.board_name}
              {node.group_name && ` › ${node.group_name}`}
              {node.automation_name && ` · regla «${node.automation_name}»`}
              {node.linked_at && ` · ${relativeTime(node.linked_at)}`}
            </p>
          </>
        )}
      </div>
    </li>
  );
}

function str(v: unknown) {
  return typeof v === "string" && v ? v : null;
}

function describeEvent(e: TraceEvent): string {
  const d = e.detail;
  switch (e.kind) {
    case "created": {
      const where = [str(d.board), str(d.group)].filter(Boolean).join(" › ");
      return str(d.from_board) ? `Llegó como copia desde «${str(d.from_board)}» a ${where}` : `Se creó en ${where}`;
    }
    case "status_changed":
      return `Estado: ${str(d.from) ?? "sin estado"} → ${str(d.to) ?? "sin estado"}`;
    case "group_changed":
      return `Carpeta: ${str(d.from) ?? "—"} → ${str(d.to) ?? "—"}`;
    case "moved":
      return `Viajó de «${str(d.from_board) ?? "—"}» a «${str(d.to_board) ?? "—"}»${str(d.group) ? ` › ${str(d.group)}` : ""}`;
    case "copied_to":
      return `Se copió a «${str(d.board) ?? "—"}»${str(d.group) ? ` › ${str(d.group)}` : ""}`;
    case "assignee_changed":
      return str(d.to) ? `Responsable: ${str(d.to)}` : "Se quitó el responsable";
    case "due_changed":
      return str(d.to) ? `Vencimiento: ${formatDueDate(str(d.to)!, todayIsoLocal())}` : "Se quitó el vencimiento";
    case "priority_changed": {
      const p = PRIORITY_BY_VALUE[str(d.to) as Priority];
      return `Prioridad: ${p?.label ?? str(d.to) ?? "—"}`;
    }
    case "renamed":
      return `Título: «${str(d.from) ?? ""}» → «${str(d.to) ?? ""}»`;
    case "deleted":
      return "Se eliminó";
    case "automation_limit":
      return "Una cadena de reglas se detuvo para evitar un ciclo infinito";
    default:
      return e.kind;
  }
}

type Stage = { label: string; color: string | null; ms: number; current: boolean };

/** Suma el tiempo que el ítem pasó en cada estado a partir del historial. */
function timeByStatus(events: TraceEvent[]): Stage[] {
  const totals = new Map<string, Stage>();
  let current: { label: string; color: string | null; since: number } | null = null;
  const close = (until: number) => {
    if (!current) return;
    const s = totals.get(current.label) ?? { label: current.label, color: current.color, ms: 0, current: false };
    s.ms += Math.max(0, until - current.since);
    totals.set(current.label, s);
  };
  for (const e of events) {
    const at = new Date(e.created_at).getTime();
    if (e.kind === "created" && str(e.detail.status)) {
      current = { label: str(e.detail.status)!, color: null, since: at };
    } else if (e.kind === "status_changed") {
      close(at);
      const to = str(e.detail.to);
      current = to ? { label: to, color: str(e.detail.to_color), since: at } : null;
    } else if (e.kind === "deleted") {
      close(at);
      current = null;
    }
  }
  if (current) {
    close(Date.now());
    const s = totals.get(current.label);
    if (s) s.current = true;
  }
  return [...totals.values()].filter((s) => s.ms > 0).sort((a, b) => b.ms - a.ms);
}

function formatDuration(ms: number) {
  const min = Math.round(ms / 60_000);
  if (min < 1) return "menos de 1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${min % 60 ? `${min % 60} min` : ""}`.trim();
  const d = Math.floor(h / 24);
  return `${d} d ${h % 24 ? `${h % 24} h` : ""}`.trim();
}
