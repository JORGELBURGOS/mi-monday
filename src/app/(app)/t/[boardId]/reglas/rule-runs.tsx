"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getRuleRunsAction, type RuleRun } from "@/app/actions/automations";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormAlert } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { formatDateTime, relativeTime } from "@/lib/format";
import { changeSentence, describeChange } from "@/lib/history";
import type { Automation, FlowBoard, Member } from "@/lib/data";

/**
 * Detalle de ejecuciones de una regla: cada vez que se disparó, sobre qué
 * ítem, quién la provocó, qué cambió y si después se revirtió.
 */
export function RuleRunsDialog({ rule, board, members, onClose }: { rule: Automation; board: FlowBoard; members: Member[]; onClose: () => void }) {
  const [runs, setRuns] = useState<RuleRun[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [query, setQuery] = useState("");

  const lookup = useMemo(() => ({ columns: board.columns, members }), [board.columns, members]);

  const load = useCallback(
    async (before?: number) => {
      setLoading(true);
      const res = await getRuleRunsAction(rule.id, { before, errorsOnly });
      setLoading(false);
      if (!res.ok) return setError(res.error);
      setError(null);
      setMore(res.data.more);
      setRuns((prev) => (before ? [...prev, ...res.data.runs] : res.data.runs));
    },
    [rule.id, errorsOnly],
  );

  useEffect(() => {
    // Carga inicial y al cambiar el filtro de errores.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return runs;
    return runs.filter((r) => [r.task_title, r.actor_name, r.error, r.note].filter(Boolean).some((s) => String(s).toLowerCase().includes(q)));
  }, [runs, query]);

  const totals = useMemo(() => {
    let ok = 0, failed = 0, reverts = 0;
    for (const r of runs) {
      if (!r.ok) failed += 1;
      else if (r.kind === "revert") reverts += 1;
      else ok += 1;
    }
    return { ok, failed, reverts };
  }, [runs]);

  return (
    <Dialog open onClose={onClose} title={`Ejecuciones · ${rule.name}`} description="Cada vez que la regla actuó, sobre qué ítem, quién la disparó y qué cambió." size="lg">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-success-soft px-2 py-0.5 font-semibold text-success">{totals.ok} ejecutadas</span>
          {totals.reverts > 0 && <span className="rounded-full bg-warning-soft px-2 py-0.5 font-semibold text-warning">{totals.reverts} revertidas</span>}
          {totals.failed > 0 && <span className="rounded-full bg-danger-soft px-2 py-0.5 font-semibold text-danger">{totals.failed} con error</span>}
          <span className="text-muted">{more ? "(de las cargadas)" : ""}</span>
          <label className="ml-auto flex items-center gap-1.5">
            <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--accent)]" />
            Solo errores
          </label>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar ítem o persona…"
            aria-label="Buscar en las ejecuciones"
            className="h-7 w-44 rounded-md border border-line bg-surface px-2"
          />
        </div>

        {error && <FormAlert>{error}</FormAlert>}

        {!loading && visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">{errorsOnly ? "Sin errores registrados." : "Esta regla todavía no se ejecutó."}</p>
        ) : (
          <ol className="divide-y divide-line rounded-xl border border-line">
            {visible.map((r) => (
              <RunRow key={r.id} r={r} lookup={lookup} />
            ))}
          </ol>
        )}

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted" aria-live="polite">
            {loading ? "Cargando…" : `${runs.length} ${runs.length === 1 ? "ejecución" : "ejecuciones"}`}
          </p>
          {more && (
            <Button size="sm" disabled={loading} onClick={() => load(runs[runs.length - 1]?.id)}>
              Ver más antiguas
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function RunRow({ r, lookup }: { r: RuleRun; lookup: Parameters<typeof describeChange>[2] }) {
  const href = r.task_board_id && r.task_id ? `/t/${r.task_board_id}?item=${r.task_id}` : null;
  const status = !r.ok ? "error" : r.kind === "revert" ? "revert" : "ok";
  return (
    <li className="grid gap-x-3 gap-y-1 px-3 py-2.5 text-sm sm:grid-cols-[110px_minmax(0,1fr)]">
      <div className="text-xs">
        <time dateTime={r.created_at} title={formatDateTime(r.created_at)} className="block font-semibold tabular-nums" suppressHydrationWarning>
          {new Date(r.created_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
        </time>
        <span className="text-muted" suppressHydrationWarning>{relativeTime(r.created_at)}</span>
      </div>
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide",
              status === "ok" && "bg-success-soft text-success",
              status === "revert" && "bg-warning-soft text-warning",
              status === "error" && "bg-danger-soft text-danger",
            )}
          >
            {status === "ok" ? "Ejecutada" : status === "revert" ? "Reversión" : "Error"}
          </span>
          {r.task_id ? (
            href ? (
              <Link href={href} prefetch={false} className="min-w-0 truncate font-semibold hover:underline">
                {r.task_title}
              </Link>
            ) : (
              <span className="text-muted">{r.task_exists ? "Ítem sin acceso" : "Ítem eliminado"}</span>
            )
          ) : (
            <span className="text-muted">Regla programada (sin ítem)</span>
          )}
          {r.kind === "run" && r.reverted_at && (
            <span className="text-xs text-warning" suppressHydrationWarning>
              ↩ revertida {relativeTime(r.reverted_at)}
            </span>
          )}
        </p>
        <p className="text-xs text-muted">{r.actor_name ? `Disparada por ${r.actor_name}` : "Disparada por el sistema (fecha u horario)"}</p>
        {r.events.length > 0 && (
          <ul className="space-y-0.5">
            {r.events.map((e, i) => (
              <li key={i} className="text-[13px]">
                · {changeSentence(describeChange(e.kind, e.detail, lookup))}
              </li>
            ))}
          </ul>
        )}
        {r.note && <p className="text-xs text-muted">{r.note}</p>}
        {r.error && <p className="rounded-md bg-danger-soft px-2 py-1 text-xs text-danger">{r.error}</p>}
      </div>
    </li>
  );
}
