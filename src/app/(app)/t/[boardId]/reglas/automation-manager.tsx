"use client";

import { useId, useMemo, useState, useTransition } from "react";
import {
  createAutomationAction,
  deleteAutomationAction,
  setAutomationActiveAction,
  updateAutomationAction,
  type AutomationInput,
} from "@/app/actions/automations";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, FormAlert, Input, Select } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { IconEdit, IconFlow, IconPlus, IconTrash } from "@/components/ui/icons";
import { CustomValueInput } from "@/components/board/custom-cell";
import { cn } from "@/lib/cn";
import { COLUMN_KIND_LABELS, readValues, type CellValue } from "@/lib/columns";
import {
  ACTION_LABELS,
  COPY_FIELD_LABELS,
  TRIGGER_LABELS,
  describeAutomation,
  type CopyField,
  type TriggerType,
} from "@/lib/automations";
import type { Automation, FlowBoard, Member } from "@/lib/data";

type Mode = "copy" | "move" | "origin" | "copies";

type Draft = {
  name: string;
  trigger_type: TriggerType;
  trigger_status_id: string;
  trigger_group_id: string;
  mode: Mode;
  target_board_id: string;
  target_group_id: string;
  /** "" = predeterminado · "same" = mismo nombre que el origen (solo copiar) · id */
  target_status: string;
  copy_fields: CopyField[];
  /** Por columna de destino: "" (no completar), "fixed" (valor fijo) o id de columna de origen. */
  sources: Record<string, string>;
  fixed: Record<string, CellValue | null>;
};

const BASIC_FIELDS: CopyField[] = ["description", "priority", "assignee", "due_date"];

export function AutomationManager({
  boardId,
  boards,
  rules,
  members,
  canManage,
}: {
  boardId: string;
  boards: FlowBoard[];
  rules: Automation[];
  members: Member[];
  canManage: boolean;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Automation | "new" | null>(null);
  const [deleting, setDeleting] = useState<Automation | null>(null);
  const current = boards.find((b) => b.id === boardId)!;
  const targets = boards.filter((b) => b.canManage && !b.is_archived);

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error ?? "No se pudo guardar.");
      else if (res.message) toast.success(res.message);
    });

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button variant="primary" onClick={() => setEditing("new")}>
            <IconPlus size={16} /> Nueva regla
          </Button>
        </div>
      )}

      {rules.length === 0 ? (
        <EmptyState
          icon={<IconFlow />}
          title="Este tablero todavía no tiene reglas"
          description={
            <>
              Por ejemplo: “cuando un pedido pasa a <em>Aprobado</em>, copiarlo al tablero de Producción con el cliente y el monto”, o
              “cuando Producción lo termina, mover el original a la carpeta <em>Entregados</em>”.
            </>
          }
          action={
            canManage ? (
              <Button variant="primary" onClick={() => setEditing("new")}>
                <IconPlus size={16} /> Crear la primera regla
              </Button>
            ) : (
              <p className="text-sm text-muted">Solo quien administra el tablero puede crear reglas.</p>
            )
          }
        />
      ) : (
        <ul className="space-y-3">
          {rules.map((r) => {
            const d = describeAutomation(r, boards);
            const values = readValues(r.extra_values);
            const mapCount = Array.isArray(r.column_map) ? r.column_map.length : 0;
            const fixedCount = Object.keys(values).length;
            return (
              <li key={r.id} className={cn("rounded-2xl border border-line bg-surface p-4 shadow-card", !r.is_active && "opacity-70")}>
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-bold">
                      {r.name}
                      {!r.is_active && <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs font-semibold text-muted">Pausada</span>}
                    </p>
                    <p className="mt-1 text-sm">
                      <span className="text-muted">{d.when},</span> {d.then}.
                    </p>
                    {r.action_type !== "update_linked" && (
                      <p className="mt-1 text-xs text-muted">
                        {r.action_type === "copy"
                          ? `Copia: título${r.copy_fields.length ? `, ${r.copy_fields.map((f) => COPY_FIELD_LABELS[f as CopyField]?.split(" (")[0].toLowerCase()).join(", ")}` : ""}`
                          : "Viaja completo con comentarios e historial"}
                        {mapCount > 0 && ` · ${mapCount} ${mapCount === 1 ? "columna" : "columnas"}`}
                        {fixedCount > 0 && ` · ${fixedCount} ${fixedCount === 1 ? "valor fijo" : "valores fijos"}`}
                      </p>
                    )}
                    {d.target === undefined && (
                      <p className="mt-1 text-xs font-semibold text-warning">No tenés acceso al tablero de destino.</p>
                    )}
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
                      <Button size="icon-sm" variant="ghost" aria-label={`Editar la regla ${r.name}`} onClick={() => setEditing(r)}>
                        <IconEdit size={15} />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Eliminar la regla ${r.name}`}
                        onClick={() => setDeleting(r)}
                        className="hover:text-danger"
                      >
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
        <AutomationEditor
          key={editing === "new" ? "new" : editing.id}
          source={current}
          targets={targets}
          members={members}
          rule={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSubmit={async (input) => {
            const res = editing === "new" ? await createAutomationAction(boardId, input) : await updateAutomationAction(editing.id, input);
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
            Se elimina la regla <strong className="text-fg">“{deleting?.name}”</strong>. Los ítems que ya copió o movió quedan donde están y
            conservan su recorrido.
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

function initialDraft(rule: Automation | null, source: FlowBoard, targets: FlowBoard[]): Draft {
  if (!rule) {
    const firstOther = targets.find((b) => b.id !== source.id) ?? targets[0];
    const d: Draft = {
      name: "",
      trigger_type: "status_changed",
      trigger_status_id: source.statuses.find((s) => s.is_done)?.id ?? source.statuses[0]?.id ?? "",
      trigger_group_id: "",
      mode: "copy",
      target_board_id: firstOther?.id ?? "",
      target_group_id: "",
      target_status: "",
      copy_fields: [...BASIC_FIELDS],
      sources: {},
      fixed: {},
    };
    return { ...d, sources: suggestSources(source, firstOther) };
  }
  const map = Array.isArray(rule.column_map) ? (rule.column_map as { from: string; to: string }[]) : [];
  const fixed = readValues(rule.extra_values);
  const sources: Record<string, string> = {};
  for (const m of map) sources[m.to] = m.from;
  for (const k of Object.keys(fixed)) sources[k] = "fixed";
  return {
    name: rule.name,
    trigger_type: rule.trigger_type as TriggerType,
    trigger_status_id: rule.trigger_status_id ?? "",
    trigger_group_id: rule.trigger_group_id ?? "",
    mode: rule.action_type === "update_linked" ? (rule.link_direction === "copies" ? "copies" : "origin") : (rule.action_type as Mode),
    target_board_id: rule.target_board_id,
    target_group_id: rule.target_group_id ?? "",
    target_status: rule.target_status_id ?? (rule.copy_fields.includes("status") ? "same" : ""),
    copy_fields: rule.copy_fields.filter((f): f is CopyField => f !== "status" && (BASIC_FIELDS as string[]).includes(f)),
    sources,
    fixed,
  };
}

/** Sugiere copiar las columnas que tienen el mismo nombre y tipo en ambos tableros. */
function suggestSources(source: FlowBoard, target: FlowBoard | undefined) {
  const out: Record<string, string> = {};
  if (!target) return out;
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
  for (const tc of target.columns) {
    const match = source.columns.find((sc) => sc.kind === tc.kind && norm(sc.name) === norm(tc.name));
    if (match) out[tc.id] = match.id;
  }
  return out;
}

function AutomationEditor({
  source,
  targets,
  members,
  rule,
  onClose,
  onSubmit,
}: {
  source: FlowBoard;
  targets: FlowBoard[];
  members: Member[];
  rule: Automation | null;
  onClose: () => void;
  onSubmit: (input: AutomationInput) => Promise<string | null>;
}) {
  const uid = useId();
  const [d, setD] = useState<Draft>(() => initialDraft(rule, source, targets));
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const target = targets.find((b) => b.id === d.target_board_id);
  const linked = d.mode === "origin" || d.mode === "copies";
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setD((x) => ({ ...x, [key]: value }));

  const autoName = useMemo(() => {
    const t = target?.name ?? "otro tablero";
    if (d.mode === "copy") return `Copiar a ${t}`;
    if (d.mode === "move") return `Mover a ${t}`;
    return d.mode === "origin" ? `Avisar al original en ${t}` : `Avisar a las copias en ${t}`;
  }, [d.mode, target?.name]);

  const changeTarget = (id: string) => {
    const t = targets.find((b) => b.id === id);
    setD((x) => ({ ...x, target_board_id: id, target_group_id: "", target_status: "", sources: suggestSources(source, t), fixed: {} }));
  };

  const submit = () => {
    setError(null);
    if (!target) return setError("Elegí el tablero de destino.");
    if (linked && !d.target_status && !d.target_group_id) {
      return setError("Elegí qué cambiar en el ítem vinculado: el estado, la carpeta o ambos.");
    }
    const column_map: { from: string; to: string }[] = [];
    const extra_values: Record<string, CellValue> = {};
    if (!linked) {
      for (const tc of target.columns) {
        const src = d.sources[tc.id];
        if (!src) continue;
        if (src === "fixed") {
          const v = d.fixed[tc.id];
          if (v !== null && v !== undefined && v !== "") extra_values[tc.id] = v;
        } else column_map.push({ from: src, to: tc.id });
      }
    }
    const input: AutomationInput = {
      name: d.name.trim() || autoName,
      trigger_type: d.trigger_type,
      trigger_status_id: d.trigger_type === "status_changed" ? d.trigger_status_id || null : null,
      trigger_group_id: d.trigger_type !== "status_changed" ? d.trigger_group_id || null : null,
      action_type: linked ? "update_linked" : d.mode === "move" ? "move" : "copy",
      link_direction: linked ? (d.mode === "copies" ? "copies" : "origin") : null,
      target_board_id: target.id,
      target_group_id: d.target_group_id || null,
      target_status_id: d.target_status && d.target_status !== "same" ? d.target_status : null,
      copy_fields: d.mode === "copy" ? [...d.copy_fields, ...(d.target_status === "same" ? (["status"] as CopyField[]) : [])] : [],
      column_map,
      extra_values,
    };
    startSaving(async () => {
      const err = await onSubmit(input);
      if (err) setError(err);
    });
  };

  return (
    <Dialog open onClose={onClose} title={rule ? "Editar regla" : "Nueva regla"} size="lg">
      <div className="space-y-6">
        {error && <FormAlert>{error}</FormAlert>}

        <Step n={1} title="Cuándo">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`${uid}-tt`} label="Se dispara cuando">
              <Select id={`${uid}-tt`} value={d.trigger_type} onChange={(e) => set("trigger_type", e.target.value as TriggerType)}>
                {(Object.keys(TRIGGER_LABELS) as TriggerType[]).map((k) => (
                  <option key={k} value={k}>
                    {TRIGGER_LABELS[k]}
                  </option>
                ))}
              </Select>
            </Field>
            {d.trigger_type === "status_changed" ? (
              <Field id={`${uid}-ts`} label="Estado">
                <Select id={`${uid}-ts`} value={d.trigger_status_id} onChange={(e) => set("trigger_status_id", e.target.value)}>
                  <option value="">Cualquier estado</option>
                  {source.statuses.map((s) => (
                    <option key={s.id} value={s.id}>
                      Pasa a «{s.label}»
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field id={`${uid}-tg`} label="Carpeta">
                <Select id={`${uid}-tg`} value={d.trigger_group_id} onChange={(e) => set("trigger_group_id", e.target.value)}>
                  <option value="">{d.trigger_type === "item_arrived" ? "En cualquier carpeta" : "Cualquier carpeta"}</option>
                  {source.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
          {d.trigger_type === "item_arrived" && (
            <p className="mt-2 text-xs text-muted">Incluye ítems creados a mano y los que llegan copiados o movidos desde otro tablero.</p>
          )}
        </Step>

        <Step n={2} title="Qué hacer">
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Acción">
            {(["copy", "move", "origin", "copies"] as Mode[]).map((m) => (
              <label
                key={m}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-sm",
                  d.mode === m ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong",
                )}
              >
                <input
                  type="radio"
                  name={`${uid}-mode`}
                  checked={d.mode === m}
                  onChange={() => setD((x) => ({ ...x, mode: m, target_status: "", target_group_id: "" }))}
                  className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                />
                <span>
                  <span className="block font-semibold">{ACTION_LABELS[m]}</span>
                  <span className="text-xs text-muted">{MODE_HELP[m]}</span>
                </span>
              </label>
            ))}
          </div>
        </Step>

        <Step n={3} title={linked ? (d.mode === "origin" ? "Dónde está el original" : "Dónde están las copias") : "A dónde"}>
          {targets.length === 0 ? (
            <p className="text-sm text-muted">No administrás ningún tablero activo en este espacio.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id={`${uid}-tb`} label="Tablero">
                <Select id={`${uid}-tb`} value={d.target_board_id} onChange={(e) => changeTarget(e.target.value)}>
                  {!target && <option value="">Elegí un tablero</option>}
                  {targets.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.id === source.id ? " (este tablero)" : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id={`${uid}-tgr`} label="Carpeta">
                <Select id={`${uid}-tgr`} value={d.target_group_id} onChange={(e) => set("target_group_id", e.target.value)}>
                  <option value="">{linked ? "No cambiar" : "La primera carpeta"}</option>
                  {target?.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id={`${uid}-tst`} label="Estado">
                <Select id={`${uid}-tst`} value={d.target_status} onChange={(e) => set("target_status", e.target.value)}>
                  <option value="">
                    {linked ? "No cambiar" : d.mode === "move" ? "El mismo (o el primero)" : "El primero del tablero"}
                  </option>
                  {d.mode === "copy" && <option value="same">El mismo que el original</option>}
                  {target?.statuses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
        </Step>

        {!linked && target && (
          <Step n={4} title="Qué datos viajan">
            {d.mode === "copy" ? (
              <fieldset>
                <legend className="mb-2 text-sm text-muted">El título siempre se copia. Además:</legend>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {BASIC_FIELDS.map((f) => (
                    <label key={f} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={d.copy_fields.includes(f)}
                        onChange={(e) =>
                          set("copy_fields", e.target.checked ? [...d.copy_fields, f] : d.copy_fields.filter((x) => x !== f))
                        }
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                      {COPY_FIELD_LABELS[f]}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : (
              <p className="text-sm text-muted">
                El ítem viaja completo: título, descripción, prioridad, responsable, vencimiento, comentarios e historial.
              </p>
            )}

            <div className="mt-4">
              <p className="mb-2 text-sm font-semibold">Columnas de «{target.name}»</p>
              {target.columns.length === 0 ? (
                <p className="text-sm text-muted">
                  El tablero de destino no tiene columnas propias.
                  {source.columns.length > 0 && " Los datos de las columnas de este tablero no viajan."}
                </p>
              ) : (
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {target.columns.map((tc) => {
                    const compatible = source.columns.filter((sc) => sc.kind === tc.kind);
                    const src = d.sources[tc.id] ?? "";
                    return (
                      <li key={tc.id} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:items-center">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{tc.name}</p>
                          <p className="text-xs text-muted">{COLUMN_KIND_LABELS[tc.kind]}</p>
                        </div>
                        <div className="space-y-2">
                          <Select
                            aria-label={`Cómo completar ${tc.name}`}
                            value={src}
                            onChange={(e) => setD((x) => ({ ...x, sources: { ...x.sources, [tc.id]: e.target.value } }))}
                            className="h-9 text-[13px]"
                          >
                            <option value="">Dejar vacía</option>
                            {compatible.map((sc) => (
                              <option key={sc.id} value={sc.id}>
                                Copiar de «{sc.name}»
                              </option>
                            ))}
                            <option value="fixed">Completar con un valor fijo</option>
                          </Select>
                          {src === "fixed" && (
                            <CustomValueInput
                              variant="field"
                              column={tc}
                              value={d.fixed[tc.id] ?? undefined}
                              members={members}
                              label={`Valor fijo para ${tc.name}`}
                              onChange={(v) => setD((x) => ({ ...x, fixed: { ...x.fixed, [tc.id]: v } }))}
                            />
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Step>
        )}

        <Field id={`${uid}-name`} label="Nombre de la regla" hint="Opcional">
          <Input id={`${uid}-name`} value={d.name} onChange={(e) => set("name", e.target.value)} maxLength={80} placeholder={autoName} />
        </Field>
      </div>

      <div className="sticky bottom-0 -mx-5 -mb-4 mt-6 flex flex-col-reverse gap-2 border-t border-line bg-surface px-5 py-3 sm:flex-row sm:justify-end">
        <Button onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={submit} disabled={saving || !target}>
          {saving ? "Guardando…" : rule ? "Guardar regla" : "Crear regla"}
        </Button>
      </div>
    </Dialog>
  );
}

const MODE_HELP: Record<Mode, string> = {
  copy: "Crea una copia vinculada en otro tablero. El original sigue acá.",
  move: "El ítem sale de este tablero y continúa en otro.",
  origin: "Cambia el estado o la carpeta del ítem del que vino esta copia.",
  copies: "Cambia el estado o la carpeta de las copias que salieron de este ítem.",
};

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold">
        <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-full bg-fg text-xs text-bg">
          {n}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}
