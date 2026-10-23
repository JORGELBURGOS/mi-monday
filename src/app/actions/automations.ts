"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { actionContext, SESSION_EXPIRED } from "./context";
import { uuidSchema } from "@/lib/validation";
import { fail, fromDb, ok, type ActionResult } from "@/lib/action-result";
import { POSITION_STEP } from "@/lib/constants";
import { normalizeValue, parseColumn, type CellValue } from "@/lib/columns";
import { displayName } from "@/lib/format";
import { ACTION_TYPES, CONDITION_FIELDS, CONDITION_OPS, COPY_FIELDS, SAME_BOARD_ACTIONS, TRIGGER_TYPES } from "@/lib/automations";

const uuid = z.uuid({ message: "Identificador inválido." });
const int = (min: number, max: number) => z.number().int().min(min).max(max);
const priority = z.enum(["low", "medium", "high", "urgent"]);

const triggerConfigSchema = z
  .object({
    from_status_id: uuid,
    user_id: uuid,
    priority,
    column_id: uuid,
    value: z.string().max(500),
    date_field: z.union([z.literal("due_date"), uuid]),
    offset_days: int(-365, 365),
    hour: int(0, 23),
    days: int(1, 365),
    status_id: uuid,
    freq: z.enum(["daily", "weekdays", "weekly", "monthly"]),
    weekday: int(1, 7),
    monthday: int(1, 31),
  })
  .partial();

const actionConfigSchema = z
  .object({
    status_id: uuid,
    group_id: uuid,
    priority,
    mode: z.enum(["user", "creator", "clear", "offset", "value"]),
    user_id: uuid,
    days: int(-365, 365),
    column_id: uuid,
    value: z.union([z.string().max(500), z.number(), z.boolean(), z.array(z.string().max(40)).max(100)]),
    to: z.enum(["assignee", "creator", "user", "admins"]),
    message: z.string().trim().max(500, { message: "El aviso puede tener hasta 500 caracteres." }),
    text: z.string().trim().max(2000, { message: "El comentario puede tener hasta 2000 caracteres." }),
    title: z.string().trim().max(200, { message: "El título puede tener hasta 200 caracteres." }),
    due_days: int(-365, 365),
    assignee_id: uuid,
  })
  .partial();

const conditionSchema = z.object({
  field: z.enum(CONDITION_FIELDS),
  op: z.enum(CONDITION_OPS),
  value: z.string().max(500).optional(),
  column_id: uuid.optional(),
});

const automationSchema = z.object({
  name: z.string().trim().min(1, { message: "Poné un nombre a la regla." }).max(80, { message: "Máximo 80 caracteres." }),
  trigger_type: z.enum(TRIGGER_TYPES, { message: "Elegí cuándo se dispara." }),
  trigger_status_id: uuid.nullable(),
  trigger_group_id: uuid.nullable(),
  trigger_config: triggerConfigSchema.default({}),
  conditions: z.array(conditionSchema).max(20, { message: "Hasta 20 condiciones por regla." }).default([]),
  action_type: z.enum(ACTION_TYPES, { message: "Elegí qué hace la regla." }),
  action_config: actionConfigSchema.default({}),
  link_direction: z.enum(["origin", "copies"]).nullable(),
  target_board_id: uuid,
  target_group_id: uuid.nullable(),
  target_status_id: uuid.nullable(),
  copy_fields: z.array(z.enum(COPY_FIELDS)).max(COPY_FIELDS.length),
  column_map: z.array(z.object({ from: uuid, to: uuid })).max(100),
  extra_values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])),
});

export type AutomationInput = z.input<typeof automationSchema>;

type Ctx = NonNullable<Awaited<ReturnType<typeof actionContext>>>;

function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && (obj[k] as unknown) !== "") out[k] = obj[k];
  return out;
}

async function memberIdsOf(ctx: Ctx, boardId: string) {
  const { data: board } = await ctx.supabase.from("boards").select("workspace_id").eq("id", boardId).maybeSingle();
  if (!board) return new Set<string>();
  const { data: members } = await ctx.supabase.from("workspace_members").select("user_id").eq("workspace_id", board.workspace_id);
  return new Set((members ?? []).map((m) => m.user_id));
}

async function prepare(ctx: Ctx, boardId: string, input: AutomationInput) {
  const parsed = automationSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." } as const;
  const d = { ...parsed.data };
  const tc = d.trigger_config;
  const ac = d.action_config;

  // Disparador: solo se guardan los datos que usa cada tipo.
  d.trigger_status_id = d.trigger_type === "status_changed" ? d.trigger_status_id : null;
  d.trigger_group_id = d.trigger_type === "group_changed" || d.trigger_type === "item_arrived" ? d.trigger_group_id : null;
  switch (d.trigger_type) {
    case "status_changed":
      d.trigger_config = pick(tc, ["from_status_id"]);
      break;
    case "assignee_changed":
      d.trigger_config = pick(tc, ["user_id"]);
      break;
    case "priority_changed":
      d.trigger_config = pick(tc, ["priority"]);
      break;
    case "column_changed":
      if (!tc.column_id) return { error: "Elegí la columna que dispara la regla." } as const;
      d.trigger_config = pick(tc, ["column_id", "value"]);
      break;
    case "date_arrives":
      d.trigger_config = { date_field: tc.date_field ?? "due_date", offset_days: tc.offset_days ?? 0, hour: tc.hour ?? 8 };
      break;
    case "stale":
      d.trigger_config = { days: tc.days ?? 3, hour: tc.hour ?? 8, ...pick(tc, ["status_id"]) };
      break;
    case "schedule":
      d.trigger_config = {
        freq: tc.freq ?? "daily",
        hour: tc.hour ?? 8,
        ...(tc.freq === "weekly" ? { weekday: tc.weekday ?? 1 } : {}),
        ...(tc.freq === "monthly" ? { monthday: tc.monthday ?? 1 } : {}),
      };
      break;
    default:
      d.trigger_config = {};
  }

  // Condiciones: se descartan las incompletas.
  d.conditions = d.conditions.filter((c) => {
    if (c.field === "column" && !c.column_id) return false;
    if (["is", "is_not", "contains", "gt", "lt", "within_days"].includes(c.op) && c.field !== "done") return Boolean(c.value);
    return true;
  });

  const chain = d.action_type === "copy" || d.action_type === "move" || d.action_type === "update_linked";
  if (!chain) {
    d.column_map = [];
    d.extra_values = {};
    d.copy_fields = [];
    d.link_direction = null;
    d.target_group_id = null;
    d.target_status_id = null;
  }
  if ((SAME_BOARD_ACTIONS as string[]).includes(d.action_type)) d.target_board_id = boardId;

  switch (d.action_type) {
    case "set_status":
      if (!ac.status_id) return { error: "Elegí el estado." } as const;
      d.action_config = pick(ac, ["status_id"]);
      break;
    case "set_group":
      if (!ac.group_id) return { error: "Elegí la carpeta." } as const;
      d.action_config = pick(ac, ["group_id"]);
      break;
    case "set_priority":
      if (!ac.priority) return { error: "Elegí la prioridad." } as const;
      d.action_config = pick(ac, ["priority"]);
      break;
    case "set_assignee":
      if (ac.mode !== "clear" && ac.mode !== "creator" && !ac.user_id) return { error: "Elegí a quién asignar." } as const;
      d.action_config = ac.mode === "clear" || ac.mode === "creator" ? { mode: ac.mode } : { mode: "user", user_id: ac.user_id };
      break;
    case "set_due_date":
      d.action_config = ac.mode === "clear" ? { mode: "clear" } : { mode: "offset", days: ac.days ?? 0 };
      break;
    case "set_column": {
      if (!ac.column_id) return { error: "Elegí la columna a completar." } as const;
      const { data: raw } = await ctx.supabase.from("board_columns").select("*").eq("id", ac.column_id).eq("board_id", boardId).maybeSingle();
      if (!raw) return { error: "La columna ya no existe." } as const;
      const col = parseColumn(raw);
      if (ac.mode === "clear") d.action_config = { column_id: col.id, mode: "clear" };
      else if (col.kind === "date" && ac.mode === "offset") d.action_config = { column_id: col.id, mode: "offset", days: ac.days ?? 0 };
      else {
        const res = normalizeValue(col, ac.value, col.kind === "person" ? await memberIdsOf(ctx, boardId) : undefined);
        if (!res.ok) return { error: `${col.name}: ${res.error}` } as const;
        if (res.value === null) return { error: "Indicá el valor para la columna (o elegí vaciarla)." } as const;
        d.action_config = { column_id: col.id, mode: "value", value: res.value };
      }
      break;
    }
    case "add_comment":
      if (!ac.text) return { error: "Escribí el comentario." } as const;
      d.action_config = pick(ac, ["text"]);
      break;
    case "notify":
      if (!ac.to) return { error: "Elegí a quién avisar." } as const;
      if (ac.to === "user" && !ac.user_id) return { error: "Elegí la persona a avisar." } as const;
      d.action_config = { to: ac.to, ...pick(ac, ["message"]), ...(ac.to === "user" ? { user_id: ac.user_id } : {}) };
      break;
    case "create_item":
      if (!ac.title) return { error: "Escribí el título del ítem a crear." } as const;
      d.action_config = pick(ac, ["title", "group_id", "status_id", "priority", "due_days", "assignee_id"]);
      break;
    default:
      d.action_config = {};
  }

  if (d.action_type === "update_linked") {
    d.link_direction = d.link_direction ?? "origin";
    d.column_map = [];
    d.extra_values = {};
    d.copy_fields = [];
    if (!d.target_status_id && !d.target_group_id) {
      return { error: "Elegí qué cambiar en el ítem vinculado: el estado, la carpeta o ambos." } as const;
    }
  } else if (chain) {
    d.link_direction = null;
  }

  // Valores fijos: se validan contra las columnas del tablero de destino.
  const extraKeys = Object.keys(d.extra_values);
  if (extraKeys.length > 0) {
    if (extraKeys.some((k) => !uuidSchema.safeParse(k).success)) return { error: "Valores adicionales inválidos." } as const;
    const { data: cols } = await ctx.supabase
      .from("board_columns")
      .select("*")
      .eq("board_id", d.target_board_id)
      .in("id", extraKeys);
    const memberIds = cols?.some((c) => c.kind === "person") ? await memberIdsOf(ctx, d.target_board_id) : undefined;
    const clean: Record<string, CellValue> = {};
    for (const raw of cols ?? []) {
      const col = parseColumn(raw);
      const res = normalizeValue(col, d.extra_values[col.id], memberIds);
      if (!res.ok) return { error: `${col.name}: ${res.error}` } as const;
      if (res.value !== null) clean[col.id] = res.value;
    }
    d.extra_values = clean;
  }
  // Sin columnas repetidas en el destino.
  const seen = new Set<string>();
  d.column_map = d.column_map.filter((m) => (seen.has(m.to) ? false : (seen.add(m.to), true)));
  return { data: d } as const;
}

export async function createAutomationAction(boardId: string, input: AutomationInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(boardId).success) return fail("Tablero inválido.");
  const prepared = await prepare(ctx, boardId, input);
  if ("error" in prepared) return fail(prepared.error ?? "Datos inválidos.");

  const { data: board } = await ctx.supabase.from("boards").select("workspace_id").eq("id", boardId).maybeSingle();
  if (!board) return fail("El tablero ya no existe o no tenés acceso.");

  const { data: last } = await ctx.supabase
    .from("board_automations")
    .select("position")
    .eq("board_id", boardId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await ctx.supabase
    .from("board_automations")
    .insert({
      ...prepared.data,
      board_id: boardId,
      workspace_id: board.workspace_id,
      position: (last?.position ?? 0) + POSITION_STEP,
    })
    .select("id")
    .single();
  if (error || !data) {
    if (error?.code === "42501") return fail("Necesitás administrar los dos tableros para crear esta regla.");
    return fromDb(error, "No se pudo crear la regla.");
  }
  refresh();
  return ok({ id: data.id }, "Regla creada.");
}

export async function updateAutomationAction(automationId: string, input: AutomationInput): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(automationId).success) return fail("Regla inválida.");
  const { data: current } = await ctx.supabase.from("board_automations").select("board_id").eq("id", automationId).maybeSingle();
  if (!current) return fail("La regla ya no existe.");
  const prepared = await prepare(ctx, current.board_id, input);
  if ("error" in prepared) return fail(prepared.error ?? "Datos inválidos.");

  const { data, error } = await ctx.supabase
    .from("board_automations")
    .update(prepared.data)
    .eq("id", automationId)
    .select("id");
  if (error) {
    if (error.code === "42501") return fail("Necesitás administrar los dos tableros para guardar esta regla.");
    return fromDb(error);
  }
  if (!data?.length) return fail("La regla ya no existe o no tenés permiso para editarla.");
  refresh();
  return ok(undefined, "Regla guardada.");
}

export async function setAutomationActiveAction(automationId: string, active: boolean): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(automationId).success) return fail("Regla inválida.");
  const { data, error } = await ctx.supabase
    .from("board_automations")
    .update({ is_active: Boolean(active) })
    .eq("id", automationId)
    .select("id");
  if (error) return fromDb(error);
  if (!data?.length) return fail("No tenés permiso para cambiar esta regla.");
  refresh();
  return ok(undefined, active ? "Regla activada." : "Regla pausada.");
}

export async function deleteAutomationAction(automationId: string): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(automationId).success) return fail("Regla inválida.");
  const { data, error } = await ctx.supabase.from("board_automations").delete().eq("id", automationId).select("id");
  if (error) return fromDb(error, "No se pudo eliminar la regla.");
  if (!data?.length) return fail("No tenés permiso para eliminar esta regla.");
  refresh();
  return ok(undefined, "Regla eliminada.");
}

/* ------------------------------------------------------------ trazabilidad */

export type TraceNode = {
  task_id: string;
  parent_id: string | null;
  depth: number;
  linked_at: string | null;
  automation_name: string | null;
  title: string | null;
  board_id: string | null;
  board_name: string | null;
  group_name: string | null;
  status_label: string | null;
  status_color: string | null;
  status_done: boolean | null;
};

export type TraceEvent = {
  id: number;
  kind: string;
  detail: Record<string, unknown>;
  automation_name: string | null;
  actor_name: string | null;
  created_at: string;
  board_id: string;
};

export async function getTaskTraceAction(taskId: string): Promise<ActionResult<{ chain: TraceNode[]; events: TraceEvent[] }>> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(taskId).success) return fail("Tarea inválida.");

  const [chain, events] = await Promise.all([
    ctx.supabase.rpc("task_trace", { p_task_id: taskId }),
    ctx.supabase
      .from("task_events")
      .select("id, kind, detail, automation_name, actor_id, created_at, board_id")
      .eq("task_id", taskId)
      .order("created_at")
      .order("id")
      .limit(500),
  ]);
  if (chain.error || events.error) return fromDb(chain.error ?? events.error, "No se pudo cargar el recorrido.");

  const actorIds = [...new Set((events.data ?? []).map((e) => e.actor_id).filter((x): x is string => Boolean(x)))];
  const names = new Map<string, string>();
  if (actorIds.length) {
    const { data: people } = await ctx.supabase.from("profiles").select("id, full_name, email").in("id", actorIds);
    for (const p of people ?? []) names.set(p.id, displayName(p));
  }

  return ok({
    chain: (chain.data ?? []) as TraceNode[],
    events: (events.data ?? []).map((e) => ({
      id: e.id,
      kind: e.kind,
      detail: e.detail && typeof e.detail === "object" && !Array.isArray(e.detail) ? (e.detail as Record<string, unknown>) : {},
      automation_name: e.automation_name,
      actor_name: e.actor_id ? names.get(e.actor_id) ?? "Ex miembro" : null,
      created_at: e.created_at,
      board_id: e.board_id,
    })),
  });
}
