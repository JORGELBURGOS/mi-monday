"use server";

import { refresh } from "next/cache";
import { actionContext, SESSION_EXPIRED } from "./context";
import { uuidSchema } from "@/lib/validation";
import { fail, fromDb, ok, type ActionResult } from "@/lib/action-result";
import { POSITION_STEP } from "@/lib/constants";
import {
  columnInputSchema,
  columnNameSchema,
  listOptionsSchema,
  normalizeValue,
  parseColumn,
  readValues,
  type CellValue,
} from "@/lib/columns";
import type { Json } from "@/lib/database.types";

export async function createColumnAction(
  boardId: string,
  input: { name: string; kind: string; options?: unknown },
): Promise<ActionResult<{ id: string }>> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(boardId).success) return fail("Tablero inválido.");
  const parsed = columnInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  if (parsed.data.kind === "list" && parsed.data.options.length === 0) return fail("Agregá al menos una opción a la lista.");

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
      options: parsed.data.kind === "list" ? parsed.data.options : [],
      position: (last?.position ?? 0) + POSITION_STEP,
    })
    .select("id")
    .single();
  if (error || !data) return fromDb(error, "No se pudo crear la columna.");
  refresh();
  return ok({ id: data.id }, "Columna creada.");
}

export async function updateColumnAction(
  columnId: string,
  input: { name: string; options?: unknown },
): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(columnId).success) return fail("Columna inválida.");
  const name = columnNameSchema.safeParse(input.name);
  if (!name.success) return fail(name.error.issues[0]?.message ?? "Nombre inválido.");

  const { data: current } = await ctx.supabase.from("board_columns").select("*").eq("id", columnId).maybeSingle();
  if (!current) return fail("La columna ya no existe.");

  const patch: { name: string; options?: Json } = { name: name.data };
  if (current.kind === "list") {
    const options = listOptionsSchema.safeParse(input.options ?? []);
    if (!options.success) return fail(options.error.issues[0]?.message ?? "Opciones inválidas.");
    if (options.data.length === 0) return fail("La lista necesita al menos una opción.");
    patch.options = options.data;
  }

  const { data, error } = await ctx.supabase.from("board_columns").update(patch).eq("id", columnId).select("id");
  if (error) return fromDb(error);
  if (!data?.length) return fail("Solo quien administra el tablero puede editar sus columnas.");
  refresh();
  return ok(undefined, "Columna actualizada.");
}

export async function moveColumnAction(columnId: string, direction: "up" | "down"): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(columnId).success) return fail("Columna inválida.");

  const { data: current } = await ctx.supabase.from("board_columns").select("board_id").eq("id", columnId).maybeSingle();
  if (!current) return fail("La columna ya no existe.");
  const { data: all } = await ctx.supabase
    .from("board_columns")
    .select("id, position")
    .eq("board_id", current.board_id)
    .order("position");
  if (!all) return fail("No se pudieron leer las columnas.");

  const idx = all.findIndex((c) => c.id === columnId);
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapWith < 0 || swapWith >= all.length) return ok(undefined);
  const reordered = [...all];
  [reordered[idx], reordered[swapWith]] = [reordered[swapWith], reordered[idx]];
  for (const [i, c] of reordered.entries()) {
    const position = (i + 1) * POSITION_STEP;
    if (c.position !== position) {
      const { error } = await ctx.supabase.from("board_columns").update({ position }).eq("id", c.id);
      if (error) return fromDb(error);
    }
  }
  refresh();
  return ok(undefined);
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
export async function setCustomValuesAction(
  taskId: string,
  values: Record<string, CellValue | null>,
): Promise<ActionResult> {
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
  if (columns.some((c) => c.kind === "person") && board) {
    const { data: members } = await ctx.supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", board.workspace_id);
    memberIds = new Set((members ?? []).map((m) => m.user_id));
  }

  const next: Record<string, CellValue> = { ...readValues(task.custom_values) };
  for (const raw of columns) {
    const column = parseColumn(raw);
    const res = normalizeValue(column, values[column.id], memberIds);
    if (!res.ok) return fail(`${column.name}: ${res.error}`);
    if (res.value === null) delete next[column.id];
    else next[column.id] = res.value;
  }

  const { data, error } = await ctx.supabase.from("tasks").update({ custom_values: next }).eq("id", taskId).select("id");
  if (error) return fromDb(error);
  if (!data?.length) return fail("La tarea ya no existe o no tenés acceso.");
  refresh();
  return ok(undefined);
}
