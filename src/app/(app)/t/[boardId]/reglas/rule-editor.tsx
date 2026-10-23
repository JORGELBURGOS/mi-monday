"use client";

import { useId, useMemo, useState, useTransition } from "react";
import type { AutomationInput } from "@/app/actions/automations";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormAlert, Input, Select, Textarea } from "@/components/ui/form";
import { IconPlus, IconX } from "@/components/ui/icons";
import { CustomValueInput } from "@/components/board/custom-cell";
import { cn } from "@/lib/cn";
import { PRIORITIES } from "@/lib/constants";
import { displayName } from "@/lib/format";
import { COLUMN_KIND_LABELS, readValues, type BoardColumn, type CellValue } from "@/lib/columns";
import {
  ACTION_GROUPS,
  COPY_FIELD_LABELS,
  PLACEHOLDERS_HELP,
  TIME_TRIGGERS,
  TRIGGER_GROUPS,
  WEEKDAYS,
  actionModeOf,
  readActionConfig,
  readConditions,
  readTriggerConfig,
  type ActionConfig,
  type ActionMode,
  type Condition,
  type ConditionOp,
  type CopyField,
  type TriggerConfig,
  type TriggerType,
} from "@/lib/automations";
import type { Automation, FlowBoard, Member } from "@/lib/data";

export type Draft = {
  name: string;
  trigger_type: TriggerType;
  trigger_status_id: string;
  trigger_group_id: string;
  tc: TriggerConfig;
  conditions: Condition[];
  mode: ActionMode;
  target_board_id: string;
  target_group_id: string;
  /** "" = predeterminado · "same" = mismo nombre que el origen (solo copiar) · id */
  target_status: string;
  copy_fields: CopyField[];
  /** Por columna de destino: "" (no completar), "fixed" (valor fijo) o id de columna de origen. */
  sources: Record<string, string>;
  fixed: Record<string, CellValue | null>;
  ac: ActionConfig;
};

const BASIC_FIELDS: CopyField[] = ["description", "priority", "assignee", "due_date"];
const CHAIN: ActionMode[] = ["copy", "move", "origin", "copies"];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** Sugiere copiar las columnas que tienen el mismo nombre y tipo en ambos tableros. */
export function suggestSources(source: FlowBoard, target: FlowBoard | undefined) {
  const out: Record<string, string> = {};
  if (!target) return out;
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
  for (const tc of target.columns) {
    const match = source.columns.find((sc) => sc.kind === tc.kind && norm(sc.name) === norm(tc.name));
    if (match) out[tc.id] = match.id;
  }
  return out;
}

export function emptyDraft(source: FlowBoard, targets: FlowBoard[]): Draft {
  const firstOther = targets.find((b) => b.id !== source.id) ?? targets[0];
  return {
    name: "",
    trigger_type: "status_changed",
    trigger_status_id: source.statuses.find((s) => s.is_done)?.id ?? source.statuses[0]?.id ?? "",
    trigger_group_id: "",
    tc: {},
    conditions: [],
    mode: "copy",
    target_board_id: firstOther?.id ?? source.id,
    target_group_id: "",
    target_status: "",
    copy_fields: [...BASIC_FIELDS],
    sources: suggestSources(source, firstOther),
    fixed: {},
    ac: {},
  };
}

export function draftFromRule(rule: Automation): Draft {
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
    tc: readTriggerConfig(rule),
    conditions: readConditions(rule),
    mode: actionModeOf(rule),
    target_board_id: rule.target_board_id,
    target_group_id: rule.target_group_id ?? "",
    target_status: rule.target_status_id ?? (rule.copy_fields.includes("status") ? "same" : ""),
    copy_fields: rule.copy_fields.filter((f): f is CopyField => (BASIC_FIELDS as string[]).includes(f)),
    sources,
    fixed,
    ac: readActionConfig(rule),
  };
}

/* -------------------------------------------------------------------------- */
/*  Ejemplos listos para usar                                                  */
/* -------------------------------------------------------------------------- */

export type Recipe = { id: string; label: string; build: (source: FlowBoard, base: Draft) => Draft };

const notDone: Condition = { field: "done", op: "is", value: "false" };

export const RECIPES: Recipe[] = [
  {
    id: "due-soon",
    label: "Avisar 2 días antes del vencimiento",
    build: (_s, d) => ({
      ...d,
      name: "Avisar antes del vencimiento",
      trigger_type: "date_arrives",
      tc: { date_field: "due_date", offset_days: -2, hour: 8 },
      conditions: [notDone],
      mode: "notify",
      ac: { to: "assignee", message: "«{titulo}» vence el {vencimiento}" },
    }),
  },
  {
    id: "overdue-urgent",
    label: "Vencido sin terminar → Urgente",
    build: (_s, d) => ({
      ...d,
      name: "Vencidos a urgente",
      trigger_type: "date_arrives",
      tc: { date_field: "due_date", offset_days: 1, hour: 8 },
      conditions: [notDone],
      mode: "set_priority",
      ac: { priority: "urgent" },
    }),
  },
  {
    id: "overdue-admins",
    label: "Vencido → avisar a administradores",
    build: (_s, d) => ({
      ...d,
      name: "Avisar vencidos",
      trigger_type: "date_arrives",
      tc: { date_field: "due_date", offset_days: 1, hour: 9 },
      conditions: [notDone],
      mode: "notify",
      ac: { to: "admins", message: "«{titulo}» está vencido (responsable: {responsable})" },
    }),
  },
  {
    id: "stale",
    label: "Trabado 5 días → avisar",
    build: (_s, d) => ({
      ...d,
      name: "Ítems trabados",
      trigger_type: "stale",
      tc: { days: 5, hour: 9 },
      conditions: [notDone],
      mode: "notify",
      ac: { to: "admins", message: "«{titulo}» lleva 5 días en {estado}" },
    }),
  },
  {
    id: "assigned",
    label: "Al asignar, avisar a la persona",
    build: (_s, d) => ({
      ...d,
      name: "Avisar asignación",
      trigger_type: "assignee_changed",
      tc: {},
      mode: "notify",
      ac: { to: "assignee", message: "Te asignaron «{titulo}» (vence: {vencimiento})" },
    }),
  },
  {
    id: "arrival-due",
    label: "Al llegar, vencimiento en 7 días",
    build: (_s, d) => ({
      ...d,
      name: "Plazo de 7 días",
      trigger_type: "item_arrived",
      trigger_group_id: "",
      mode: "set_due_date",
      ac: { mode: "offset", days: 7 },
      conditions: [{ field: "due_date", op: "empty" }],
    }),
  },
  {
    id: "done-folder",
    label: "Al terminar, mover a otra carpeta",
    build: (s, d) => ({
      ...d,
      name: "Terminados a su carpeta",
      trigger_type: "status_changed",
      trigger_status_id: s.statuses.find((x) => x.is_done)?.id ?? "",
      mode: "set_group",
      ac: { group_id: s.groups[s.groups.length - 1]?.id },
    }),
  },
  {
    id: "weekly",
    label: "Revisión semanal los lunes",
    build: (s, d) => ({
      ...d,
      name: "Revisión semanal",
      trigger_type: "schedule",
      tc: { freq: "weekly", weekday: 1, hour: 9 },
      conditions: [],
      mode: "create_item",
      target_board_id: s.id,
      ac: { title: "Revisión semanal {hoy}", due_days: 2 },
    }),
  },
  {
    id: "copy-next",
    label: "Al aprobar, pasar a la siguiente etapa",
    build: (s, d) => ({ ...d, name: "", trigger_type: "status_changed", trigger_status_id: s.statuses.find((x) => x.is_done)?.id ?? "", mode: "copy" }),
  },
];

/* -------------------------------------------------------------------------- */
/*  Editor                                                                     */
/* -------------------------------------------------------------------------- */

export function RuleEditor({
  source,
  targets,
  members,
  rule,
  initial,
  onClose,
  onSubmit,
}: {
  source: FlowBoard;
  targets: FlowBoard[];
  members: Member[];
  rule: Automation | null;
  initial: Draft;
  onClose: () => void;
  onSubmit: (input: AutomationInput) => Promise<string | null>;
}) {
  const uid = useId();
  const [d, setD] = useState<Draft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const chain = CHAIN.includes(d.mode);
  const linked = d.mode === "origin" || d.mode === "copies";
  const sameBoard = !chain && d.mode !== "create_item";
  const target = sameBoard ? source : targets.find((b) => b.id === d.target_board_id) ?? (d.target_board_id === source.id ? source : undefined);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setD((x) => ({ ...x, [key]: value }));
  const setTc = (patch: Partial<TriggerConfig>) => setD((x) => ({ ...x, tc: { ...x.tc, ...patch } }));
  const setAc = (patch: Partial<ActionConfig>) => setD((x) => ({ ...x, ac: { ...x.ac, ...patch } }));
  const isTime = TIME_TRIGGERS.includes(d.trigger_type);
  const actionHelp = ACTION_GROUPS.flatMap((g) => g.items).find((i) => i.value === d.mode)?.help;

  const autoName = useMemo(() => {
    const label = ACTION_GROUPS.flatMap((g) => g.items).find((i) => i.value === d.mode)?.label ?? "Regla";
    return CHAIN.includes(d.mode) || d.mode === "create_item" ? `${label} · ${target?.name ?? ""}`.replace(/ · $/, "") : label;
  }, [d.mode, target?.name]);

  const changeTrigger = (t: TriggerType) =>
    setD((x) => ({
      ...x,
      trigger_type: t,
      tc: t === "date_arrives" ? { date_field: "due_date", offset_days: 0, hour: 8 } : t === "stale" ? { days: 3, hour: 8 } : t === "schedule" ? { freq: "daily", hour: 8 } : {},
      conditions: TIME_TRIGGERS.includes(t) && x.conditions.length === 0 && t !== "schedule" ? [notDone] : x.conditions,
    }));

  const changeMode = (m: ActionMode) =>
    setD((x) => {
      const next = { ...x, mode: m, ac: {}, target_status: "", target_group_id: "" };
      if (CHAIN.includes(m) || m === "create_item") {
        const t = targets.find((b) => b.id === x.target_board_id) ?? targets[0];
        next.target_board_id = t?.id ?? source.id;
        next.sources = suggestSources(source, t);
      }
      return next;
    });

  const changeTarget = (id: string) => {
    const t = targets.find((b) => b.id === id);
    setD((x) => ({ ...x, target_board_id: id, target_group_id: "", target_status: "", sources: suggestSources(source, t), fixed: {}, ac: { ...x.ac, group_id: undefined, status_id: undefined } }));
  };

  const submit = () => {
    setError(null);
    if (!target) return setError("Elegí el tablero de destino.");
    if (linked && !d.target_status && !d.target_group_id) {
      return setError("Elegí qué cambiar en el ítem vinculado: el estado, la carpeta o ambos.");
    }
    const column_map: { from: string; to: string }[] = [];
    const extra_values: Record<string, CellValue> = {};
    if (d.mode === "copy" || d.mode === "move") {
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
      trigger_group_id: d.trigger_type === "group_changed" || d.trigger_type === "item_arrived" ? d.trigger_group_id || null : null,
      trigger_config: d.tc,
      conditions: d.conditions,
      action_type: linked ? "update_linked" : (d.mode as Exclude<ActionMode, "origin" | "copies">),
      action_config: d.ac,
      link_direction: linked ? (d.mode === "copies" ? "copies" : "origin") : null,
      target_board_id: sameBoard ? source.id : target.id,
      target_group_id: chain ? d.target_group_id || null : null,
      target_status_id: chain && d.target_status && d.target_status !== "same" ? d.target_status : null,
      copy_fields: d.mode === "copy" ? [...d.copy_fields, ...(d.target_status === "same" ? (["status"] as CopyField[]) : [])] : [],
      column_map,
      extra_values: extra_values as Record<string, string | number | boolean | string[]>,
    };
    startSaving(async () => {
      const err = await onSubmit(input);
      if (err) setError(err);
    });
  };

  return (
    <Dialog open onClose={onClose} title={rule ? "Editar regla" : "Nueva regla"} size="lg">
      <div className="space-y-6">
        {!rule && (
          <section aria-label="Ejemplos">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">Empezar con un ejemplo</p>
            <div className="flex flex-wrap gap-1.5">
              {RECIPES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setD(r.build(source, { ...initial }))}
                  className="rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] font-medium hover:border-accent hover:bg-accent-soft"
                >
                  {r.label}
                </button>
              ))}
            </div>
          </section>
        )}

        {error && <FormAlert>{error}</FormAlert>}

        {/* 1 · Cuándo */}
        <Step n={1} title="Cuándo">
          <Field id={`${uid}-tt`} label="Se dispara">
            <Select id={`${uid}-tt`} value={d.trigger_type} onChange={(e) => changeTrigger(e.target.value as TriggerType)}>
              {TRIGGER_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.items.map((i) => (
                    <option key={i.value} value={i.value}>
                      {i.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <TriggerDetails uid={uid} d={d} source={source} members={members} set={set} setTc={setTc} />
          </div>
          {isTime && (
            <p className="mt-2 text-xs text-muted">
              Vetta revisa las reglas por tiempo cada 15 minutos, en hora de Argentina. Cada ítem dispara la regla una sola vez por fecha.
            </p>
          )}
        </Step>

        {/* 2 · Condiciones */}
        <Step n={2} title="Solo si… (opcional)">
          <ConditionsEditor uid={uid} conditions={d.conditions} source={source} members={members} onChange={(c) => set("conditions", c)} />
        </Step>

        {/* 3 · Qué hacer */}
        <Step n={3} title="Qué hacer">
          <Field id={`${uid}-act`} label="Acción">
            <Select id={`${uid}-act`} value={d.mode} onChange={(e) => changeMode(e.target.value as ActionMode)}>
              {ACTION_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.items.map((i) => (
                    <option key={i.value} value={i.value} disabled={d.trigger_type === "schedule" && (i.value === "origin" || i.value === "copies")}>
                      {i.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          {actionHelp && <p className="mt-1.5 text-xs text-muted">{actionHelp}</p>}
          <div className="mt-3">
            {chain ? (
              <ChainDetails uid={uid} d={d} source={source} target={target} targets={targets} members={members} linked={linked} setD={setD} set={set} changeTarget={changeTarget} />
            ) : (
              <ActionDetails uid={uid} d={d} source={source} target={target} targets={targets} members={members} setAc={setAc} changeTarget={changeTarget} />
            )}
          </div>
        </Step>

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

/* -------------------------------------------------------------------------- */
/*  Detalle del disparador                                                     */
/* -------------------------------------------------------------------------- */

function TriggerDetails({
  uid,
  d,
  source,
  members,
  set,
  setTc,
}: {
  uid: string;
  d: Draft;
  source: FlowBoard;
  members: Member[];
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  setTc: (patch: Partial<TriggerConfig>) => void;
}) {
  const tc = d.tc;
  const dateColumns = source.columns.filter((c) => c.kind === "date");
  switch (d.trigger_type) {
    case "status_changed":
      return (
        <>
          <Field id={`${uid}-from`} label="Desde">
            <Select id={`${uid}-from`} value={tc.from_status_id ?? ""} onChange={(e) => setTc({ from_status_id: e.target.value || undefined })}>
              <option value="">Cualquier estado</option>
              {source.statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={`${uid}-to`} label="Hacia">
            <Select id={`${uid}-to`} value={d.trigger_status_id} onChange={(e) => set("trigger_status_id", e.target.value)}>
              <option value="">Cualquier estado</option>
              {source.statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
        </>
      );
    case "group_changed":
    case "item_arrived":
      return (
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
      );
    case "assignee_changed":
      return (
        <Field id={`${uid}-who`} label="A quién">
          <Select id={`${uid}-who`} value={tc.user_id ?? ""} onChange={(e) => setTc({ user_id: e.target.value || undefined })}>
            <option value="">A cualquier persona</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {displayName(m)}
              </option>
            ))}
          </Select>
        </Field>
      );
    case "priority_changed":
      return (
        <Field id={`${uid}-prio`} label="Nueva prioridad">
          <Select id={`${uid}-prio`} value={tc.priority ?? ""} onChange={(e) => setTc({ priority: (e.target.value || undefined) as TriggerConfig["priority"] })}>
            <option value="">Cualquiera</option>
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
      );
    case "column_changed": {
      const col = source.columns.find((c) => c.id === tc.column_id);
      return source.columns.length === 0 ? (
        <p className="text-sm text-muted sm:col-span-2">Este tablero no tiene columnas propias. Agregalas en Ajustes del tablero.</p>
      ) : (
        <>
          <Field id={`${uid}-col`} label="Columna">
            <Select id={`${uid}-col`} value={tc.column_id ?? ""} onChange={(e) => setTc({ column_id: e.target.value || undefined, value: undefined })}>
              <option value="">Elegí una columna</option>
              {source.columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          {col && (
            <Field id={`${uid}-colv`} label="Nuevo valor" hint="Vacío = cualquier valor">
              <ValueInput id={`${uid}-colv`} column={col} members={members} value={tc.value} onChange={(v) => setTc({ value: v })} />
            </Field>
          )}
        </>
      );
    }
    case "date_arrives": {
      const off = tc.offset_days ?? 0;
      const timing = off < 0 ? "before" : off > 0 ? "after" : "same";
      return (
        <>
          <Field id={`${uid}-df`} label="Fecha">
            <Select id={`${uid}-df`} value={tc.date_field ?? "due_date"} onChange={(e) => setTc({ date_field: e.target.value })}>
              <option value="due_date">Vencimiento</option>
              {dateColumns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={`${uid}-when`} label="Momento">
            <div className="flex gap-2">
              {timing !== "same" && (
                <Input
                  id={`${uid}-when`}
                  type="number"
                  min={1}
                  max={365}
                  value={Math.abs(off)}
                  aria-label="Cantidad de días"
                  onChange={(e) => {
                    const n = Math.max(1, Math.min(365, Number(e.target.value) || 1));
                    setTc({ offset_days: timing === "before" ? -n : n });
                  }}
                  className="w-20"
                />
              )}
              <Select
                aria-label="Antes, el día o después"
                value={timing}
                onChange={(e) => {
                  const n = Math.abs(off) || 1;
                  setTc({ offset_days: e.target.value === "same" ? 0 : e.target.value === "before" ? -n : n });
                }}
              >
                <option value="before">días antes</option>
                <option value="same">el mismo día</option>
                <option value="after">días después</option>
              </Select>
            </div>
          </Field>
          <HourField uid={uid} value={tc.hour} onChange={(hour) => setTc({ hour })} />
        </>
      );
    }
    case "stale":
      return (
        <>
          <Field id={`${uid}-days`} label="Días sin cambiar de estado">
            <Input id={`${uid}-days`} type="number" min={1} max={365} value={tc.days ?? 3} onChange={(e) => setTc({ days: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })} />
          </Field>
          <Field id={`${uid}-sst`} label="En el estado">
            <Select id={`${uid}-sst`} value={tc.status_id ?? ""} onChange={(e) => setTc({ status_id: e.target.value || undefined })}>
              <option value="">Cualquier estado</option>
              {source.statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <HourField uid={uid} value={tc.hour} onChange={(hour) => setTc({ hour })} />
        </>
      );
    case "schedule":
      return (
        <>
          <Field id={`${uid}-freq`} label="Frecuencia">
            <Select id={`${uid}-freq`} value={tc.freq ?? "daily"} onChange={(e) => setTc({ freq: e.target.value as TriggerConfig["freq"] })}>
              <option value="daily">Todos los días</option>
              <option value="weekdays">De lunes a viernes</option>
              <option value="weekly">Una vez por semana</option>
              <option value="monthly">Una vez por mes</option>
            </Select>
          </Field>
          {tc.freq === "weekly" && (
            <Field id={`${uid}-wd`} label="Día">
              <Select id={`${uid}-wd`} value={tc.weekday ?? 1} onChange={(e) => setTc({ weekday: Number(e.target.value) })}>
                {WEEKDAYS.slice(1).map((w, i) => (
                  <option key={w} value={i + 1}>
                    {w.charAt(0).toUpperCase() + w.slice(1)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {tc.freq === "monthly" && (
            <Field id={`${uid}-md`} label="Día del mes" hint="31 = último día">
              <Input id={`${uid}-md`} type="number" min={1} max={31} value={tc.monthday ?? 1} onChange={(e) => setTc({ monthday: Math.max(1, Math.min(31, Number(e.target.value) || 1)) })} />
            </Field>
          )}
          <HourField uid={uid} value={tc.hour} onChange={(hour) => setTc({ hour })} />
        </>
      );
  }
}

function HourField({ uid, value, onChange }: { uid: string; value: number | undefined; onChange: (h: number) => void }) {
  return (
    <Field id={`${uid}-hour`} label="Desde las">
      <Select id={`${uid}-hour`} value={value ?? 8} onChange={(e) => onChange(Number(e.target.value))}>
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {String(h).padStart(2, "0")}:00
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** Valor de una columna guardado como texto (para disparadores y condiciones). */
function ValueInput({
  id,
  column,
  members,
  value,
  onChange,
}: {
  id: string;
  column: BoardColumn;
  members: Member[];
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  const current: CellValue | undefined =
    value === undefined ? undefined : column.kind === "checkbox" ? value === "true" : column.kind === "number" && value !== "" ? Number(value) : value;
  return (
    <CustomValueInput
      id={id}
      variant="field"
      column={column}
      value={current}
      members={members}
      label={`Valor de ${column.name}`}
      onChange={(v) => onChange(v === null || v === "" ? undefined : String(v))}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  Condiciones                                                                */
/* -------------------------------------------------------------------------- */

const OPS: Record<string, { value: ConditionOp; label: string }[]> = {
  status: [
    { value: "is", label: "es" },
    { value: "is_not", label: "no es" },
  ],
  group: [
    { value: "is", label: "es" },
    { value: "is_not", label: "no es" },
  ],
  priority: [
    { value: "is", label: "es" },
    { value: "is_not", label: "no es" },
  ],
  assignee: [
    { value: "is", label: "es" },
    { value: "is_not", label: "no es" },
    { value: "empty", label: "está vacío" },
    { value: "not_empty", label: "tiene alguien" },
  ],
  due_date: [
    { value: "overdue", label: "ya venció" },
    { value: "within_days", label: "vence en los próximos" },
    { value: "empty", label: "no tiene fecha" },
    { value: "not_empty", label: "tiene fecha" },
  ],
};

function columnOps(c: BoardColumn): { value: ConditionOp; label: string }[] {
  const base: { value: ConditionOp; label: string }[] = [
    { value: "is", label: "es" },
    { value: "is_not", label: "no es" },
    { value: "empty", label: "está vacía" },
    { value: "not_empty", label: "tiene valor" },
  ];
  if (c.kind === "number") return [...base, { value: "gt", label: "es mayor que" }, { value: "lt", label: "es menor que" }];
  if (c.kind === "text") return [...base, { value: "contains", label: "contiene" }];
  if (c.kind === "checkbox") return [{ value: "is", label: "está marcada" }, { value: "is_not", label: "no está marcada" }];
  return base;
}

function ConditionsEditor({
  uid,
  conditions,
  source,
  members,
  onChange,
}: {
  uid: string;
  conditions: Condition[];
  source: FlowBoard;
  members: Member[];
  onChange: (c: Condition[]) => void;
}) {
  const update = (i: number, patch: Partial<Condition>) => onChange(conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const fieldKey = (c: Condition) => (c.field === "column" ? `column:${c.column_id}` : c.field);

  return (
    <div className="space-y-2">
      {conditions.length === 0 && <p className="text-sm text-muted">Sin condiciones: la regla se aplica a todos los ítems.</p>}
      {conditions.map((c, i) => {
        const col = c.field === "column" ? source.columns.find((x) => x.id === c.column_id) : undefined;
        const ops = c.field === "done" ? [] : col ? columnOps(col) : OPS[c.field] ?? [];
        const needsValue = c.field !== "done" && !["empty", "not_empty", "overdue"].includes(c.op) && !(col?.kind === "checkbox");
        return (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 p-2">
            <span className="w-6 text-center text-xs font-semibold text-subtle">{i === 0 ? "Si" : "y"}</span>
            <Select
              aria-label="Campo"
              value={fieldKey(c)}
              onChange={(e) => {
                const v = e.target.value;
                if (v.startsWith("column:")) {
                  const nc = source.columns.find((x) => x.id === v.slice(7));
                  update(i, { field: "column", column_id: v.slice(7), op: nc?.kind === "checkbox" ? "is" : "not_empty", value: nc?.kind === "checkbox" ? "true" : undefined });
                } else {
                  const f = v as Condition["field"];
                  update(i, { field: f, column_id: undefined, op: f === "done" ? "is" : f === "due_date" ? "overdue" : "is", value: f === "done" ? "false" : undefined });
                }
              }}
              className="h-9 w-auto min-w-36 text-[13px]"
            >
              <option value="status">Estado</option>
              <option value="group">Carpeta</option>
              <option value="priority">Prioridad</option>
              <option value="assignee">Responsable</option>
              <option value="done">Terminado</option>
              <option value="due_date">Vencimiento</option>
              {source.columns.map((x) => (
                <option key={x.id} value={`column:${x.id}`}>
                  {x.name}
                </option>
              ))}
            </Select>
            {c.field === "done" ? (
              <Select aria-label="Valor" value={c.value ?? "false"} onChange={(e) => update(i, { value: e.target.value })} className="h-9 w-auto text-[13px]">
                <option value="false">no está terminado</option>
                <option value="true">está terminado</option>
              </Select>
            ) : (
              <Select
                aria-label="Operador"
                value={c.op}
                onChange={(e) => update(i, { op: e.target.value as ConditionOp, ...(col?.kind === "checkbox" ? { value: "true" } : {}) })}
                className="h-9 w-auto text-[13px]"
              >
                {ops.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
            {needsValue && (
              <div className="min-w-40 flex-1">
                <ConditionValue uid={`${uid}-c${i}`} c={c} col={col} source={source} members={members} onChange={(value) => update(i, { value })} />
              </div>
            )}
            <Button size="icon-sm" variant="ghost" aria-label="Quitar condición" onClick={() => onChange(conditions.filter((_, j) => j !== i))} className="ml-auto">
              <IconX size={14} />
            </Button>
          </div>
        );
      })}
      <Button
        size="sm"
        variant="ghost"
        disabled={conditions.length >= 20}
        onClick={() => onChange([...conditions, { field: "done", op: "is", value: "false" }])}
      >
        <IconPlus size={14} /> Agregar condición
      </Button>
    </div>
  );
}

function ConditionValue({
  uid,
  c,
  col,
  source,
  members,
  onChange,
}: {
  uid: string;
  c: Condition;
  col: BoardColumn | undefined;
  source: FlowBoard;
  members: Member[];
  onChange: (v: string | undefined) => void;
}) {
  const sel = (options: { value: string; label: string }[]) => (
    <Select aria-label="Valor" value={c.value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} className="h-9 text-[13px]">
      <option value="">Elegí…</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
  if (c.field === "status") return sel(source.statuses.map((s) => ({ value: s.id, label: s.label })));
  if (c.field === "group") return sel(source.groups.map((g) => ({ value: g.id, label: g.name })));
  if (c.field === "priority") return sel(PRIORITIES.map((p) => ({ value: p.value, label: p.label })));
  if (c.field === "assignee") return sel(members.map((m) => ({ value: m.user_id, label: displayName(m) })));
  if (c.field === "due_date")
    return (
      <span className="flex items-center gap-2 text-[13px]">
        <Input aria-label="Días" type="number" min={0} max={365} value={c.value ?? "3"} onChange={(e) => onChange(e.target.value)} className="h-9 w-20" />
        días
      </span>
    );
  if (col && (c.op === "gt" || c.op === "lt"))
    return <Input aria-label="Número" type="number" step="any" value={c.value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} className="h-9" />;
  if (col && c.op === "contains")
    return <Input aria-label="Texto" value={c.value ?? ""} maxLength={200} onChange={(e) => onChange(e.target.value || undefined)} className="h-9" />;
  if (col) return <ValueInput id={uid} column={col} members={members} value={c.value} onChange={onChange} />;
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Acciones sobre el ítem, avisos y creación                                  */
/* -------------------------------------------------------------------------- */

function ActionDetails({
  uid,
  d,
  source,
  target,
  targets,
  members,
  setAc,
  changeTarget,
}: {
  uid: string;
  d: Draft;
  source: FlowBoard;
  target: FlowBoard | undefined;
  targets: FlowBoard[];
  members: Member[];
  setAc: (patch: Partial<ActionConfig>) => void;
  changeTarget: (id: string) => void;
}) {
  const ac = d.ac;
  const people = (value: string | undefined, onChange: (v: string | undefined) => void, id: string, label: string, empty = "Elegí una persona") => (
    <Field id={id} label={label}>
      <Select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">{empty}</option>
        {members.map((m) => (
          <option key={m.user_id} value={m.user_id}>
            {displayName(m)}
          </option>
        ))}
      </Select>
    </Field>
  );

  switch (d.mode) {
    case "set_status":
      return (
        <Field id={`${uid}-ast`} label="Nuevo estado">
          <Select id={`${uid}-ast`} value={ac.status_id ?? ""} onChange={(e) => setAc({ status_id: e.target.value || undefined })}>
            <option value="">Elegí un estado</option>
            {source.statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
      );
    case "set_group":
      return (
        <Field id={`${uid}-agr`} label="Carpeta">
          <Select id={`${uid}-agr`} value={ac.group_id ?? ""} onChange={(e) => setAc({ group_id: e.target.value || undefined })}>
            <option value="">Elegí una carpeta</option>
            {source.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </Field>
      );
    case "set_priority":
      return (
        <Field id={`${uid}-apr`} label="Prioridad">
          <Select id={`${uid}-apr`} value={ac.priority ?? ""} onChange={(e) => setAc({ priority: (e.target.value || undefined) as ActionConfig["priority"] })}>
            <option value="">Elegí una prioridad</option>
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
      );
    case "set_assignee":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${uid}-amode`} label="Asignar">
            <Select id={`${uid}-amode`} value={ac.mode ?? "user"} onChange={(e) => setAc({ mode: e.target.value as ActionConfig["mode"] })}>
              <option value="user">A una persona</option>
              <option value="creator">A quien creó el ítem</option>
              <option value="clear">Quitar el responsable</option>
            </Select>
          </Field>
          {(ac.mode ?? "user") === "user" && people(ac.user_id, (v) => setAc({ user_id: v }), `${uid}-auser`, "Persona")}
        </div>
      );
    case "set_due_date":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${uid}-dmode`} label="Vencimiento">
            <Select id={`${uid}-dmode`} value={ac.mode === "clear" ? "clear" : "offset"} onChange={(e) => setAc({ mode: e.target.value as ActionConfig["mode"] })}>
              <option value="offset">Hoy más algunos días</option>
              <option value="clear">Quitar el vencimiento</option>
            </Select>
          </Field>
          {ac.mode !== "clear" && (
            <Field id={`${uid}-ddays`} label="Días desde hoy" hint="0 = hoy">
              <Input id={`${uid}-ddays`} type="number" min={-365} max={365} value={ac.days ?? 0} onChange={(e) => setAc({ days: Number(e.target.value) || 0 })} />
            </Field>
          )}
        </div>
      );
    case "set_column": {
      const col = source.columns.find((c) => c.id === ac.column_id);
      if (source.columns.length === 0) return <p className="text-sm text-muted">Este tablero no tiene columnas propias. Agregalas en Ajustes del tablero.</p>;
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${uid}-scol`} label="Columna">
            <Select id={`${uid}-scol`} value={ac.column_id ?? ""} onChange={(e) => setAc({ column_id: e.target.value || undefined, value: undefined, mode: "value" })}>
              <option value="">Elegí una columna</option>
              {source.columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({COLUMN_KIND_LABELS[c.kind].toLowerCase()})
                </option>
              ))}
            </Select>
          </Field>
          {col && (
            <Field id={`${uid}-smode`} label="Completar con">
              <Select id={`${uid}-smode`} value={ac.mode ?? "value"} onChange={(e) => setAc({ mode: e.target.value as ActionConfig["mode"] })}>
                <option value="value">Un valor fijo</option>
                {col.kind === "date" && <option value="offset">Hoy más algunos días</option>}
                <option value="clear">Dejarla vacía</option>
              </Select>
            </Field>
          )}
          {col && (ac.mode ?? "value") === "value" && (
            <Field id={`${uid}-sval`} label="Valor">
              <CustomValueInput
                id={`${uid}-sval`}
                variant="field"
                column={col}
                members={members}
                value={ac.value ?? undefined}
                label={`Valor para ${col.name}`}
                onChange={(v) => setAc({ value: (v ?? undefined) as string | number | boolean | string[] | undefined })}
              />
            </Field>
          )}
          {col && ac.mode === "offset" && (
            <Field id={`${uid}-sdays`} label="Días desde hoy">
              <Input id={`${uid}-sdays`} type="number" min={-365} max={365} value={ac.days ?? 0} onChange={(e) => setAc({ days: Number(e.target.value) || 0 })} />
            </Field>
          )}
        </div>
      );
    }
    case "add_comment":
      return (
        <Field id={`${uid}-txt`} label="Comentario" hint={PLACEHOLDERS_HELP}>
          <Textarea id={`${uid}-txt`} value={ac.text ?? ""} maxLength={2000} onChange={(e) => setAc({ text: e.target.value })} className="min-h-20" placeholder="Por ejemplo: Revisar con {responsable} antes del {vencimiento}." />
        </Field>
      );
    case "notify":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${uid}-to`} label="Avisar a">
            <Select id={`${uid}-to`} value={ac.to ?? ""} onChange={(e) => setAc({ to: (e.target.value || undefined) as ActionConfig["to"] })}>
              <option value="">Elegí a quién</option>
              <option value="assignee">El responsable del ítem</option>
              <option value="creator">Quien creó el ítem</option>
              <option value="admins">Los administradores de la empresa</option>
              <option value="user">Una persona en particular</option>
            </Select>
          </Field>
          {ac.to === "user" && people(ac.user_id, (v) => setAc({ user_id: v }), `${uid}-nuser`, "Persona")}
          <div className="sm:col-span-2">
            <Field id={`${uid}-msg`} label="Mensaje" hint={PLACEHOLDERS_HELP}>
              <Input id={`${uid}-msg`} value={ac.message ?? ""} maxLength={500} onChange={(e) => setAc({ message: e.target.value })} placeholder="«{titulo}» vence el {vencimiento}" />
            </Field>
          </div>
          <p className="text-xs text-muted sm:col-span-2">Solo reciben el aviso quienes pueden ver este tablero.</p>
        </div>
      );
    case "create_item":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${uid}-cb`} label="Tablero">
            <Select id={`${uid}-cb`} value={d.target_board_id} onChange={(e) => changeTarget(e.target.value)}>
              {targets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.id === source.id ? " (este tablero)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={`${uid}-cg`} label="Carpeta">
            <Select id={`${uid}-cg`} value={ac.group_id ?? ""} onChange={(e) => setAc({ group_id: e.target.value || undefined })}>
              <option value="">La primera carpeta</option>
              {target?.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field id={`${uid}-ct`} label="Título" hint={PLACEHOLDERS_HELP}>
              <Input id={`${uid}-ct`} value={ac.title ?? ""} maxLength={200} onChange={(e) => setAc({ title: e.target.value })} placeholder="Facturar {titulo}" />
            </Field>
          </div>
          <Field id={`${uid}-cs`} label="Estado">
            <Select id={`${uid}-cs`} value={ac.status_id ?? ""} onChange={(e) => setAc({ status_id: e.target.value || undefined })}>
              <option value="">El primero del tablero</option>
              {target?.statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={`${uid}-cp`} label="Prioridad">
            <Select id={`${uid}-cp`} value={ac.priority ?? "medium"} onChange={(e) => setAc({ priority: e.target.value as ActionConfig["priority"] })}>
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={`${uid}-cd`} label="Vence en (días)" hint="Vacío = sin fecha">
            <Input
              id={`${uid}-cd`}
              type="number"
              min={-365}
              max={365}
              value={ac.due_days ?? ""}
              onChange={(e) => setAc({ due_days: e.target.value === "" ? undefined : Number(e.target.value) })}
            />
          </Field>
          {people(ac.assignee_id, (v) => setAc({ assignee_id: v }), `${uid}-ca`, "Responsable", "Sin responsable")}
          {d.trigger_type !== "schedule" && (
            <p className="text-xs text-muted sm:col-span-2">El ítem nuevo queda vinculado al que disparó la regla y aparece en su recorrido.</p>
          )}
        </div>
      );
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/*  Copiar, mover y actualizar vinculados                                      */
/* -------------------------------------------------------------------------- */

function ChainDetails({
  uid,
  d,
  source,
  target,
  targets,
  members,
  linked,
  setD,
  set,
  changeTarget,
}: {
  uid: string;
  d: Draft;
  source: FlowBoard;
  target: FlowBoard | undefined;
  targets: FlowBoard[];
  members: Member[];
  linked: boolean;
  setD: React.Dispatch<React.SetStateAction<Draft>>;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  changeTarget: (id: string) => void;
}) {
  return (
    <div className="space-y-4">
      {targets.length === 0 ? (
        <p className="text-sm text-muted">No administrás ningún tablero activo en esta empresa.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id={`${uid}-tb`} label={linked ? (d.mode === "origin" ? "Tablero del original" : "Tablero de las copias") : "Tablero"}>
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
              <option value="">{linked ? "No cambiar" : d.mode === "move" ? "El mismo (o el primero)" : "El primero del tablero"}</option>
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

      {!linked && target && (
        <div>
          {d.mode === "copy" ? (
            <fieldset>
              <legend className="mb-2 text-sm text-muted">El título siempre se copia. Además:</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {BASIC_FIELDS.map((f) => (
                  <label key={f} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={d.copy_fields.includes(f)}
                      onChange={(e) => set("copy_fields", e.target.checked ? [...d.copy_fields, f] : d.copy_fields.filter((x) => x !== f))}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                    {COPY_FIELD_LABELS[f]}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <p className="text-sm text-muted">El ítem viaja completo: título, descripción, prioridad, responsable, vencimiento, comentarios e historial.</p>
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
        </div>
      )}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold">
        <span aria-hidden className={cn("flex h-6 w-6 items-center justify-center rounded-full bg-fg text-xs text-bg")}>
          {n}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}
