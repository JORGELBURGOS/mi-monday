"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { actionContext, SESSION_EXPIRED } from "./context";
import { uuidSchema } from "@/lib/validation";
import { fail, fromDb, ok, type ActionResult } from "@/lib/action-result";
import { POSITION_STEP } from "@/lib/constants";
import { normalizeValue, parseColumn, type CellValue } from "@/lib/columns";
import { displayName } from "@/lib/format";
import { COPY_FIELDS } from "@/lib/automations";

const uuid = z.uuid({ message: "Identificador inválido." });

const automationSchema = z.object({
  name: z.string().trim().min(1, { message: "Poné un nombre a la regla." }).max(80, { message: "Máximo 80 caracteres." }),
  trigger_type: z.enum(["item_arrived", "status_changed", "group_changed"], { message: "Elegí cuándo se dispara." }),
  trigger_status_id: uuid.nullable(),
  trigger_group_id: uuid.nullable(),
  action_type: z.enum(["move", "copy", "update_linked"], { message: "Elegí qué hace la regla." }),
  link_direction: z.enum(["origin", "copies"]).nullable(),
  target_board_id: uuid,
  target_group_id: uuid.nullable(),
  target_status_id: uuid.nullable(),
  copy_fields: z.array(z.enum(COPY_FIELDS)).max(COPY_FIELDS.length),
  column_map: z.array(z.object({ from: uuid, to: uuid })).max(100),
  extra_values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

export type AutomationInput = z.input<typeof automationSchema>;

async function prepare(ctx: NonNullable<Awaited<ReturnType<typeof actionContext>>>, input: AutomationInput) {
  const parsed = automationSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." } as const;
  const d = { ...parsed.data };

  if (d.trigger_type !== "status_changed") d.trigger_status_id = null;
  if (d.trigger_type === "status_changed") d.trigger_group_id = null;

  if (d.action_type === "update_linked") {
    d.link_direction = d.link_direction ?? "origin";
    d.column_map = [];
    d.extra_values = {};
    d.copy_fields = [];
    if (!d.target_status_id && !d.target_group_id) {
      return { error: "Elegí qué cambiar en el ítem vinculado: el estado, la carpeta o ambos." } as const;
    }
  } else {
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
    let memberIds: Set<string> | undefined;
    const { data: board } = await ctx.supabase.from("boards").select("workspace_id").eq("id", d.target_board_id).maybeSingle();
    if (board && cols?.some((c) => c.kind === "person")) {
      const { data: members } = await ctx.supabase.from("workspace_members").select("user_id").eq("workspace_id", board.workspace_id);
      memberIds = new Set((members ?? []).map((m) => m.user_id));
    }
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
  const prepared = await prepare(ctx, input);
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
  const prepared = await prepare(ctx, input);
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
