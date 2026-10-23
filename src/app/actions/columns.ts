"use server";

import { refresh } from "next/cache";
import { actionContext, SESSION_EXPIRED } from "./context";
import { uuidSchema } from "@/lib/validation";
import { fail, fromDb, ok, type ActionResult } from "@/lib/action-result";
import { POSITION_STEP } from "@/lib/constants";
import {
  COMPUTED_KINDS,
  KIND_CHANGES,
  LABEL_KINDS,
  columnInputSchema,
  columnNameSchema,
  columnSettingsSchema,
  listOptionsSchema,
  normalizeValue,
  parseColumn,
  readValues,
  stringList,
  type CellValue,
  type ColumnKind,
} from "@/lib/columns";
import { parseBoardSettings, orderedKeys, type ColumnKey } from "@/lib/board-settings";
import type { Json } from "@/lib/database.types";

type Ctx = NonNullable<Awaited<ReturnType<typeof actionContext>>>;

/** Inserta una columna en el orden del tablero, después de `afterKey` (o al final). */
async function placeInOrder(ctx: Ctx, boardId: string, key: ColumnKey, afterKey?: string) {
  const [{ data: board }, { data: cols }] = await Promise.all([
    ctx.supabase.from("boards").select("settings").eq("id", boardId).maybeSingle(),
    ctx.supabase.from("board_columns").select("id").eq("board_id", boardId).order("position"),
  ]);
  if (!board) return;
  const settings = parseBoardSettings(board.settings);
  const order = orderedKeys(settings, (cols ?? []).map((c) => c.id)).filter((k) => k !== key);
  const at = afterKey ? order.indexOf(afterKey as ColumnKey) : -1;
  order.splice(at >= 0 ? at + 1 : order.length, 0, key);
  await ctx.supabase.from("boards").update({ settings: { ...settings, order } }).eq("id", boardId);
}

export async function createColumnAction(
  boardId: string,
  input: { name: string; kind: string; options?: unknown; settings?: unknown },
  afterKey?: string,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(boardId).success) return fail("Tablero inválido.");
  const parsed = columnInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  const isLabels = LABEL_KINDS.includes(parsed.data.kind);
  if (isLabels && parsed.data.options.length === 0) return fail("Agregá al menos una etiqueta.");

  const { data: last } = await ctx.supabase
    .from("board_columns")
    .select("position")
    .eq("board_id", boardId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await ctx.supabase
    .from("board_columns")
    .insert({
      board_id: boardId,
      name: parsed.data.name,
      kind: parsed.data.kind,
      options: isLabels ? parsed.data.options : [],
      settings: parsed.data.settings as Json,
      position: (last?.position ?? 0) + POSITION_STEP,
    })
    .select("id")
    .single();
  if (error || !data) return fromDb(error, "No se pudo crear la columna.");
  await placeInOrder(ctx, boardId, `c:${data.id}`, afterKey);
  refresh();
  return ok({ id: data.id });
}

export async function updateColumnAction(
  columnId: string,
  input: { name?: string; options?: unknown; settings?: unknown; kind?: string },
): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(columnId).success) return fail("Columna inválida.");

  const { data: current } = await ctx.supabase.from("board_columns").select("*").eq("id", columnId).maybeSingle();
  if (!current) return fail("La columna ya no existe.");
  const column = parseColumn(current);

  const patch: { name?: string; options?: Json; settings?: Json; kind?: string } = {};
  if (input.name !== undefined) {
    const name = columnNameSchema.safeParse(input.name);
    if (!name.success) return fail(name.error.issues[0]?.message ?? "Nombre inválido.");
    patch.name = name.data;
  }
  let kind: ColumnKind = column.kind;
  if (input.kind !== undefined && input.kind !== column.kind) {
    if (!KIND_CHANGES[column.kind]?.includes(input.kind as ColumnKind)) return fail("Esta columna no puede cambiar a ese tipo.");
    kind = input.kind as ColumnKind;
    patch.kind = kind;
  }
  if (input.options !== undefined && LABEL_KINDS.includes(kind)) {
    const options = listOptionsSchema.safeParse(input.options);
    if (!options.success) return fail(options.error.issues[0]?.message ?? "Etiquetas inválidas.");
    if (options.data.length === 0) return fail("La columna necesita al menos una etiqueta.");
    const names = options.data.map((o) => o.label.toLowerCase());
    if (new Set(names).size !== names.length) return fail("Hay dos etiquetas con el mismo nombre.");
    patch.options = options.data;
  }
  if (input.settings !== undefined) {
    const settings = columnSettingsSchema.safeParse(input.settings);
    if (!settings.success) return fail(settings.error.issues[0]?.message ?? "Configuración inválida.");
    patch.settings = settings.data as Json;
  }
  if (Object.keys(patch).length === 0) return ok(undefined);

  const { data, error } = await ctx.supabase.from("board_columns").update(patch).eq("id", columnId).select("id");
  if (error) return fromDb(error);
  if (!data?.length) return fail("Solo quien administra el tablero puede editar sus columnas.");

  // De desplegable múltiple a estado: queda la primera opción de cada ítem.
  if (patch.kind && column.kind === "tags" && kind === "list") {
    const { data: tasks } = await ctx.supabase.from("tasks").select("id, custom_values").eq("board_id", column.board_id);
    for (const t of tasks ?? []) {
      const values = readValues(t.custom_values);
      const v = values[column.id];
      if (Array.isArray(v)) {
        const next = { ...values } as Record<string, CellValue>;
        const first = stringList(v)[0];
        if (first) next[column.id] = first;
        else delete next[column.id];
        await ctx.supabase.from("tasks").update({ custom_values: next }).eq("id", t.id);
      }
    }
  }
  if (patch.kind && column.kind === "list" && kind === "tags") {
    const { data: tasks } = await ctx.supabase.from("tasks").select("id, custom_values").eq("board_id", column.board_id);
    for (const t of tasks ?? []) {
      const values = readValues(t.custom_values);
      const v = values[column.id];
      if (typeof v === "string") await ctx.supabase.from("tasks").update({ custom_values: { ...values, [column.id]: [v] } }).eq("id", t.id);
    }
  }
  refresh();
  return ok(undefined);
}

/** Duplica una columna (solo la estructura, o también los valores). */
export async function duplicateColumnAction(columnId: string, withValues: boolean): Promise<ActionResult<{ id: string }>> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(columnId).success) return fail("Columna inválida.");
  const { data: current } = await ctx.supabase.from("board_columns").select("*").eq("id", columnId).maybeSingle();
  if (!current) return fail("La columna ya no existe.");
  const name = `${current.name} (copia)`.slice(0, 60);
  const { data, error } = await ctx.supabase
    .from("board_columns")
    .insert({ board_id: current.board_id, name, kind: current.kind, options: current.options, settings: current.settings, position: current.position + 1 })
    .select("id")
    .single();
  if (error || !data) return fromDb(error, "No se pudo duplicar la columna.");
  await placeInOrder(ctx, current.board_id, `c:${data.id}`, `c:${columnId}`);

  if (withValues && !COMPUTED_KINDS.includes(current.kind as ColumnKind)) {
    const { data: tasks } = await ctx.supabase.from("tasks").select("id, custom_values").eq("board_id", current.board_id);
    for (const t of tasks ?? []) {
      const values = readValues(t.custom_values);
      if (values[columnId] !== undefined) {
        await ctx.supabase.from("tasks").update({ custom_values: { ...values, [data.id]: values[columnId] } }).eq("id", t.id);
      }
    }
  }
  refresh();
  return ok({ id: data.id }, "Columna duplicada.");
}

export async function deleteColumnAction(columnId: string): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(columnId).success) return fail("Columna inválida.");

  const { data, error } = await ctx.supabase.from("board_columns").delete().eq("id", columnId).select("id");
  if (error) return fromDb(error, "No se pudo eliminar la columna.");
  if (!data?.length) return fail("Solo quien administra el tablero puede eliminar columnas.");
  refresh();
  return ok(undefined, "Columna eliminada.");
}

/**
 * Guarda uno o varios valores de columnas de un ítem. Cada valor se valida
 * contra la definición de su columna; null vacía el valor.
 */
export async function setCustomValuesAction(taskId: string, values: Record<string, CellValue | null>): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(taskId).success) return fail("Tarea inválida.");
  const keys = Object.keys(values ?? {});
  if (keys.length === 0) return ok(undefined);
  if (keys.length > 100 || keys.some((k) => !uuidSchema.safeParse(k).success)) return fail("Datos inválidos.");

  const { data: task } = await ctx.supabase.from("tasks").select("id, board_id, custom_values").eq("id", taskId).maybeSingle();
  if (!task) return fail("La tarea ya no existe o no tenés acceso.");

  const [{ data: columns }, { data: board }] = await Promise.all([
    ctx.supabase.from("board_columns").select("*").eq("board_id", task.board_id).in("id", keys),
    ctx.supabase.from("boards").select("workspace_id").eq("id", task.board_id).maybeSingle(),
  ]);
  if (!columns || columns.length !== keys.length) return fail("Alguna columna ya no existe. Recargá la página.");

  let memberIds: Set<string> | undefined;
  if (columns.some((c) => c.kind === "person" || c.kind === "people") && board) {
    const { data: members } = await ctx.supabase.from("workspace_members").select("user_id").eq("workspace_id", board.workspace_id);
    memberIds = new Set((members ?? []).map((m) => m.user_id));
  }

  if (columns.some((c) => c.kind === "people") && board && !memberIds) {
    const { data: members } = await ctx.supabase.from("workspace_members").select("user_id").eq("workspace_id", board.workspace_id);
    memberIds = new Set((members ?? []).map((m) => m.user_id));
  }
  const filePrefix = board ? `${board.workspace_id}/${task.board_id}/${task.id}/` : undefined;

  const next: Record<string, CellValue> = { ...readValues(task.custom_values) };
  for (const raw of columns) {
    const column = parseColumn(raw);
    const res = normalizeValue(column, values[column.id], memberIds, filePrefix);
    if (!res.ok) return fail(`${column.name}: ${res.error}`);
    // Los vínculos tienen que apuntar a elementos que existen (y que la persona ve).
    if ((column.kind === "dependency" || column.kind === "connect") && Array.isArray(res.value) && res.value.length) {
      const ids = stringList(res.value);
      if (column.kind === "dependency" && ids.includes(task.id)) return fail(`${column.name}: un elemento no puede depender de sí mismo.`);
      const target = column.kind === "dependency" ? task.board_id : column.settings.boardId;
      if (!target) return fail(`${column.name}: elegí el tablero a conectar en la configuración de la columna.`);
      const { count } = await ctx.supabase.from("tasks").select("id", { count: "exact", head: true }).eq("board_id", target).in("id", ids);
      if ((count ?? 0) !== ids.length) return fail(`${column.name}: algún elemento vinculado ya no existe.`);
    }
    if (res.value === null) delete next[column.id];
    else next[column.id] = res.value;
  }

  const { data, error } = await ctx.supabase.from("tasks").update({ custom_values: next }).eq("id", taskId).select("id");
  if (error) return fromDb(error);
  if (!data?.length) return fail("La tarea ya no existe o no tenés acceso.");
  refresh();
  return ok(undefined);
}
