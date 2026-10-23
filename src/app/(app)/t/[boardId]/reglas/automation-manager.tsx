"use client";

import { useState, useTransition } from "react";
import {
  createAutomationAction,
  deleteAutomationAction,
  setAutomationActiveAction,
  updateAutomationAction,
} from "@/app/actions/automations";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { IconCalendar, IconEdit, IconFlow, IconPlus, IconTrash } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { formatDateTime, relativeTime } from "@/lib/format";
import { readValues } from "@/lib/columns";
import { COPY_FIELD_LABELS, TIME_TRIGGERS, describeAutomation, readConditions, type CopyField, type TriggerType } from "@/lib/automations";
import type { Automation, FlowBoard, Member } from "@/lib/data";
import { RECIPES, RuleEditor, draftFromRule, emptyDraft, type Draft } from "./rule-editor";

export type RunStats = Record<string, { count: number; last: string | null; errors: number; lastError: string | null; lastErrorAt: string | null }>;

export function AutomationManager({
  boardId,
  boards,
  rules,
  members,
  canManage,
  stats,
}: {
  boardId: string;
  boards: FlowBoard[];
  rules: Automation[];
  members: Member[];
  canManage: boolean;
  stats: RunStats;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<{ rule: Automation | null; draft: Draft } | null>(null);
  const [deleting, setDeleting] = useState<Automation | null>(null);
  const current = boards.find((b) => b.id === boardId)!;
  const targets = boards.filter((b) => b.canManage && !b.is_archived);

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error ?? "No se pudo guardar.");
      else if (res.message) toast.success(res.message);
    });

  const openNew = (recipeId?: string) => {
    const base = emptyDraft(current, targets);
    const recipe = RECIPES.find((r) => r.id === recipeId);
    setEditing({ rule: null, draft: recipe ? recipe.build(current, base) : base });
  };

  return (
    <div className="space-y-4">
      {canManage && rules.length > 0 && (
        <div className="flex justify-end">
          <Button variant="primary" onClick={() => openNew()}>
            <IconPlus size={16} /> Nueva regla
          </Button>
        </div>
      )}

      {rules.length === 0 ? (
        <EmptyState
          icon={<IconFlow />}
          title="Este tablero todavía no tiene reglas"
          description="Las reglas trabajan solas: avisan antes de un vencimiento, suben la prioridad de lo atrasado, pasan los ítems a la etapa siguiente o crean tareas todas las semanas."
          action={
            canManage ? (
              <div className="flex flex-col items-center gap-3">
                <Button variant="primary" onClick={() => openNew()}>
                  <IconPlus size={16} /> Crear una regla
                </Button>
                <div className="flex max-w-xl flex-wrap justify-center gap-1.5">
                  {RECIPES.slice(0, 6).map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => openNew(r.id)}
                      className="rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] font-medium hover:border-accent hover:bg-accent-soft"
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">Solo quien administra el tablero puede crear reglas.</p>
            )
          }
        />
      ) : (
        <ul className="space-y-3">
          {rules.map((r) => {
            const d = describeAutomation(r, boards, members);
            const values = readValues(r.extra_values);
            const mapCount = Array.isArray(r.column_map) ? r.column_map.length : 0;
            const fixedCount = Object.keys(values).length;
            const conds = readConditions(r).length;
            const st = stats[r.id];
            const timed = TIME_TRIGGERS.includes(r.trigger_type as TriggerType);
            return (
              <li key={r.id} className={cn("rounded-2xl border border-line bg-surface p-4 shadow-card", !r.is_active && "opacity-70")}>
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-bold">
                      {timed && <IconCalendar size={15} className="text-accent" />}
                      {r.name}
                      {!r.is_active && <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs font-semibold text-muted">Pausada</span>}
                    </p>
                    <p className="mt-1 text-sm">
                      <span className="text-muted">{d.when}</span>
                      {conds > 0 && <span className="text-muted"> ({conds === 1 ? "1 condición" : `${conds} condiciones`})</span>}
                      <span className="text-muted">,</span> {d.then}.
                    </p>
                    {(r.action_type === "copy" || r.action_type === "move") && (
                      <p className="mt-1 text-xs text-muted">
                        {r.action_type === "copy"
                          ? `Copia: título${r.copy_fields.length ? `, ${r.copy_fields.map((f) => COPY_FIELD_LABELS[f as CopyField]?.split(" (")[0].toLowerCase()).join(", ")}` : ""}`
                          : "Viaja completo con comentarios e historial"}
                        {mapCount > 0 && ` · ${mapCount} ${mapCount === 1 ? "columna" : "columnas"}`}
                        {fixedCount > 0 && ` · ${fixedCount} ${fixedCount === 1 ? "valor fijo" : "valores fijos"}`}
                      </p>
                    )}
                    <p className="mt-1.5 text-xs text-subtle">
                      {st?.count
                        ? <>
                            Se ejecutó {st.count >= 1000 ? "más de 1000" : st.count} {st.count === 1 ? "vez" : "veces"}
                            {st.last && (
                              <>
                                {" "}· última{" "}
                                <time dateTime={st.last} title={formatDateTime(st.last)} suppressHydrationWarning>
                                  {relativeTime(st.last)}
                                </time>
                              </>
                            )}
                          </>
                        : "Todavía no se ejecutó"}
                    </p>
                    {st?.lastError && (
                      <p className="mt-1 rounded-lg bg-danger-soft px-2.5 py-1.5 text-xs text-danger">
                        Falló {st.errors === 1 ? "1 vez" : `${st.errors} veces`}. Último error ({st.lastErrorAt ? relativeTime(st.lastErrorAt) : ""}):{" "}
                        {st.lastError}
                      </p>
                    )}
                    {d.target === undefined && <p className="mt-1 text-xs font-semibold text-warning">No tenés acceso al tablero de destino.</p>}
                    {d.target?.is_archived && (
                      <p className="mt-1 text-xs font-semibold text-warning">El tablero de destino está archivado: la regla no hace nada.</p>
                    )}
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-1">
                      <label className="mr-2 flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={r.is_active}
                          disabled={pending}
                          onChange={(e) => run(() => setAutomationActiveAction(r.id, e.target.checked))}
                          className="h-4 w-4 accent-[var(--accent)]"
                        />
                        Activa
                      </label>
                      <Button size="icon-sm" variant="ghost" aria-label={`Editar la regla ${r.name}`} onClick={() => setEditing({ rule: r, draft: draftFromRule(r) })}>
                        <IconEdit size={15} />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Eliminar la regla ${r.name}`} onClick={() => setDeleting(r)} className="hover:text-danger">
                        <IconTrash size={15} />
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <RuleEditor
          key={editing.rule?.id ?? "new"}
          source={current}
          targets={targets}
          members={members}
          rule={editing.rule}
          initial={editing.draft}
          onClose={() => setEditing(null)}
          onSubmit={async (input) => {
            const res = editing.rule ? await updateAutomationAction(editing.rule.id, input) : await createAutomationAction(boardId, input);
            if (!res.ok) return res.error;
            toast.success(res.message ?? "Regla guardada.");
            setEditing(null);
            return null;
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Eliminar regla"
        description={
          <>
            Se elimina la regla <strong className="text-fg">“{deleting?.name}”</strong>. Lo que ya hizo queda registrado en el recorrido de cada
            ítem.
          </>
        }
        confirmLabel="Eliminar regla"
        onConfirm={() => {
          const r = deleting;
          setDeleting(null);
          if (r) run(() => deleteAutomationAction(r.id));
        }}
      />
    </div>
  );
}
