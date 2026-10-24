import { ACTION_TYPES, CHECKLIST_EVENTS, CONDITION_FIELDS, CONDITION_OPS, COPY_FIELDS, TRIGGER_TYPES, type ActionConfig, type ActionMode, type Condition, type CopyField, type TriggerConfig, type TriggerType } from "@/lib/automations";
import type { FlowBoard, Member } from "@/lib/data";
import type { Draft } from "./rule-editor";

/**
 * Convierte la propuesta de la IA en un borrador del editor de reglas,
 * descartando todo lo que no exista en la empresa (ids inventados, tipos
 * desconocidos). La persona revisa el borrador y lo guarda con la validación
 * de siempre.
 */
export function draftFromProposal(
  raw: Record<string, unknown>,
  source: FlowBoard,
  boards: FlowBoard[],
  members: Member[],
  base: Draft,
  suggestSources: (source: FlowBoard, target: FlowBoard) => Record<string, string>,
): Draft {
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const num = (v: unknown, min: number, max: number) => {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    return Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n))) : undefined;
  };
  const boardOf = (id: string) => boards.find((b) => b.id === id);
  const statusIn = (b: FlowBoard | undefined, id: unknown) => (b?.statuses.some((s) => s.id === id) ? (id as string) : undefined);
  const groupIn = (b: FlowBoard | undefined, id: unknown) => (b?.groups.some((g) => g.id === id) ? (id as string) : undefined);
  const columnIn = (b: FlowBoard | undefined, id: unknown) => (b?.columns.some((c) => c.id === id) ? (id as string) : undefined);
  const person = (id: unknown) => (members.some((m) => m.user_id === id) ? (id as string) : undefined);
  const priority = (v: unknown) => (["low", "medium", "high", "urgent"].includes(str(v)) ? (str(v) as TriggerConfig["priority"]) : undefined);
  const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as T;

  const trigger_type = (TRIGGER_TYPES as readonly string[]).includes(str(raw.trigger_type)) ? (str(raw.trigger_type) as TriggerType) : base.trigger_type;
  const t = obj(raw.trigger_config);
  const tc: TriggerConfig = clean({
    from_status_id: statusIn(source, t.from_status_id),
    user_id: person(t.user_id),
    priority: priority(t.priority),
    column_id: columnIn(source, t.column_id),
    value: t.value === undefined || t.value === null ? undefined : String(t.value).slice(0, 500),
    date_field: t.date_field === "due_date" ? "due_date" : columnIn(source, t.date_field),
    offset_days: num(t.offset_days, -365, 365),
    hour: num(t.hour, 0, 23),
    days: num(t.days, 1, 365),
    status_id: statusIn(source, t.status_id),
    freq: ["daily", "weekdays", "weekly", "monthly"].includes(str(t.freq)) ? (str(t.freq) as TriggerConfig["freq"]) : undefined,
    weekday: num(t.weekday, 1, 7),
    monthday: num(t.monthday, 1, 31),
    event: (CHECKLIST_EVENTS as readonly string[]).includes(str(t.event)) ? (str(t.event) as TriggerConfig["event"]) : undefined,
    step: str(t.step).trim().slice(0, 300) || undefined,
    step_index: num(t.step_index, 1, 300),
    percent: num(t.percent, 1, 100),
  });
  if (trigger_type === "checklist_changed") {
    // La columna de checklist no está entre las columnas de reglas: se valida aparte.
    tc.column_id = source.checklists?.some((c) => c.id === t.column_id) ? (t.column_id as string) : undefined;
    tc.event ??= "any_checked";
  }

  const conditions: Condition[] = (Array.isArray(raw.conditions) ? raw.conditions : [])
    .slice(0, 20)
    .map((c) => obj(c))
    .filter((c) => (CONDITION_FIELDS as readonly string[]).includes(str(c.field)) && (CONDITION_OPS as readonly string[]).includes(str(c.op)))
    .map((c) => clean({ field: c.field as Condition["field"], op: c.op as Condition["op"], value: c.value === undefined || c.value === null ? undefined : String(c.value).slice(0, 500), column_id: columnIn(source, c.column_id) }))
    .filter((c) => c.field !== "column" || c.column_id);

  const actionType = (ACTION_TYPES as readonly string[]).includes(str(raw.action_type)) ? str(raw.action_type) : "set_status";
  const mode: ActionMode = actionType === "update_linked" ? (raw.link_direction === "copies" ? "copies" : "origin") : (actionType as ActionMode);
  const target = boardOf(str(raw.target_board_id)) ?? source;
  const a = obj(raw.action_config);
  const actionBoard = mode === "create_item" ? target : source;
  const ac: ActionConfig = clean({
    status_id: statusIn(actionBoard, a.status_id),
    group_id: groupIn(actionBoard, a.group_id),
    priority: priority(a.priority),
    mode: ["user", "creator", "clear", "offset", "value"].includes(str(a.mode)) ? (str(a.mode) as ActionConfig["mode"]) : undefined,
    user_id: person(a.user_id),
    days: num(a.days, -365, 365),
    column_id: columnIn(source, a.column_id),
    value: typeof a.value === "string" || typeof a.value === "number" || typeof a.value === "boolean" ? a.value : Array.isArray(a.value) ? a.value.map(String).slice(0, 100) : undefined,
    to: ["assignee", "creator", "user", "admins"].includes(str(a.to)) ? (str(a.to) as ActionConfig["to"]) : undefined,
    message: str(a.message).slice(0, 500) || undefined,
    text: str(a.text).slice(0, 2000) || undefined,
    title: str(a.title).slice(0, 200) || undefined,
    due_days: num(a.due_days, -365, 365),
    assignee_id: person(a.assignee_id),
    template_id: /^[0-9a-f-]{36}$/i.test(str(a.template_id)) ? str(a.template_id) : undefined,
    section: typeof a.section === "string" ? a.section.slice(0, 300) : mode === "add_checklist" ? "{carpeta}" : undefined,
    assign: ["user", "assignee"].includes(str(a.assign)) ? (str(a.assign) as ActionConfig["assign"]) : undefined,
  });

  const chain = mode === "copy" || mode === "move";
  const copy_fields = (Array.isArray(raw.copy_fields) ? raw.copy_fields : []).filter((f): f is CopyField => (COPY_FIELDS as readonly string[]).includes(String(f)) && f !== "status");

  return {
    ...base,
    name: str(raw.name).trim().slice(0, 80) || "Regla creada con IA",
    trigger_type,
    trigger_status_id: trigger_type === "status_changed" ? (statusIn(source, raw.trigger_status_id) ?? "") : "",
    trigger_group_id: trigger_type === "group_changed" || trigger_type === "item_arrived" ? (groupIn(source, raw.trigger_group_id) ?? "") : "",
    tc,
    conditions,
    mode,
    target_board_id: target.id,
    target_group_id: groupIn(target, raw.target_group_id) ?? "",
    target_status: chain && Array.isArray(raw.copy_fields) && raw.copy_fields.includes("status") ? "same" : (statusIn(target, raw.target_status_id) ?? ""),
    copy_fields: chain ? (copy_fields.length ? copy_fields : base.copy_fields) : base.copy_fields,
    sources: chain ? suggestSources(source, target) : {},
    fixed: {},
    ac,
    revert: raw.revert_on_undo === true,
  };
}
