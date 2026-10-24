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
  checklistProgress,
  checklistFromTemplate,
  type CellValue,
  type ChecklistTemplate,
  type ColumnKind,
} from "@/lib/columns";
import { parseBoardSettings, orderedKeys, type ColumnKey } from "@/lib/board-settings";
import type { Json } from "@/lib/database.types";
import { renameFormulaRef } from "@/lib/formula";

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

/** Columna de fórmula "Avance de …" que muestra el % del checklist, a su derecha. */
async function addChecklistProgress(ctx: Ctx, boardId: string, checklistId: string, checklistName: string, position: number) {
  const { data: cols } = await ctx.supabase.from("board_columns").select("name").eq("board_id", boardId);
  const taken = new Set((cols ?? []).map((c) => c.name.trim().toLowerCase()));
  const base = `Avance de ${checklistName}`.slice(0, 56);
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
  const { data } = await ctx.supabase
    .from("board_columns")
    .insert({
      board_id: boardId,
      name,
      kind: "formula",
      options: [],
      settings: { formula: `{${checklistName}}`, unit: "%", unitPosition: "right", decimals: 0, summary: "avg", description: `Porcentaje de pasos tildados de «${checklistName}»` },
      position: position + 1,
    })
    .select("id")
    .single();
  if (data) await placeInOrder(ctx, boardId, `c:${data.id}`, `c:${checklistId}`);
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
  // Todo checklist viene con su columna de avance (% de pasos tildados) al lado.
  if (parsed.data.kind === "checklist") await addChecklistProgress(ctx, boardId, data.id, parsed.data.name, (last?.position ?? 0) + POSITION_STEP);
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
  // Renombrar: las fórmulas del tablero que usan esta columna siguen andando.
  if (patch.name && patch.name !== column.name) {
    const { data: formulas } = await ctx.supabase.from("board_columns").select("id, settings").eq("board_id", column.board_id).eq("kind", "formula");
    for (const f of formulas ?? []) {
      const settings = (f.settings && typeof f.settings === "object" && !Array.isArray(f.settings) ? f.settings : {}) as Record<string, Json>;
      const src = typeof settings.formula === "string" ? settings.formula : "";
      const next = src ? renameFormulaRef(src, column.name, patch.name) : src;
      if (next !== src) await ctx.supabase.from("board_columns").update({ settings: { ...settings, formula: next } }).eq("id", f.id);
    }
  }
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
  if (columns.some((c) => c.kind === "person" || c.kind === "people" || c.kind === "checklist") && board) {
    const { data: members } = await ctx.supabase.from("workspace_members").select("user_id").eq("workspace_id", board.workspace_id);
    memberIds = new Set((members ?? []).map((m) => m.user_id));
  }
  const filePrefix = board ? `${board.workspace_id}/${task.board_id}/${task.id}/` : undefined;

  const prev = readValues(task.custom_values);
  const next: Record<string, CellValue> = { ...prev };
  // Checklists que se completan con este cambio y tienen "al completar, pasar a estado".
  let completeStatus: string | undefined;
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
    if (column.kind === "checklist" && column.settings.onCompleteStatusId) {
      const before = checklistProgress(prev[column.id]);
      const after = checklistProgress(res.value ?? undefined);
      if (after.total > 0 && after.done === after.total && (before.total === 0 || before.done < before.total)) {
        completeStatus = column.settings.onCompleteStatusId;
      }
    }
    if (res.value === null) delete next[column.id];
    else next[column.id] = res.value;
  }

  const { data, error } = await ctx.supabase.from("tasks").update({ custom_values: next }).eq("id", taskId).select("id, status_id");
  if (error) return fromDb(error);
  if (!data?.length) return fail("La tarea ya no existe o no tenés acceso.");
  // Cambio de estado aparte, para que corran las reglas y el historial de estado.
  if (completeStatus && data[0].status_id !== completeStatus) {
    const { data: st } = await ctx.supabase.from("board_statuses").select("id").eq("id", completeStatus).eq("board_id", task.board_id).maybeSingle();
    if (st) await ctx.supabase.from("tasks").update({ status_id: st.id }).eq("id", taskId);
  }
  refresh();
  return ok(undefined);
}

/**
 * Carga una plantilla en el checklist de los elementos del tablero que todavía
 * no tienen pasos en esa columna. No toca los que ya tienen (ni los subelementos).
 * Corre con los permisos de quien la usa: la base solo deja cambiar los
 * elementos que esa persona puede editar.
 */
export async function applyChecklistTemplateAction(columnId: string, templateId: string): Promise<ActionResult<{ count: number }>> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(columnId).success || !uuidSchema.safeParse(templateId).success) return fail("Datos inválidos.");

  const { data: column } = await ctx.supabase.from("board_columns").select("id, board_id, kind").eq("id", columnId).maybeSingle();
  if (!column || column.kind !== "checklist") return fail("La columna ya no existe.");
  const { data: board } = await ctx.supabase.from("boards").select("workspace_id").eq("id", column.board_id).maybeSingle();
  if (!board) return fail("No tenés acceso a este tablero.");
  const { data: template } = await ctx.supabase.from("checklist_templates").select("items").eq("id", templateId).eq("workspace_id", board.workspace_id).maybeSingle();
  if (!template || !Array.isArray(template.items) || template.items.length === 0) return fail("La plantilla ya no existe o está vacía.");

  const { data: tasks, error } = await ctx.supabase.from("tasks").select("id, custom_values").eq("board_id", column.board_id).is("parent_id", null).limit(5000);
  if (error) return fromDb(error, "No se pudieron leer los elementos.");
  const empty = (tasks ?? []).filter((t) => {
    const v = readValues(t.custom_values)[columnId];
    return !Array.isArray(v) || v.length === 0;
  });
  if (empty.length === 0) return ok({ count: 0 });

  let count = 0;
  for (let i = 0; i < empty.length; i += 20) {
    const batch = empty.slice(i, i + 20);
    const results = await Promise.all(
      batch.map((t) => {
        // Cada elemento con sus propios ids de pasos.
        const steps = checklistFromTemplate(template.items as ChecklistTemplate["items"]);
        return ctx.supabase
          .from("tasks")
          .update({ custom_values: { ...readValues(t.custom_values), [columnId]: steps } as unknown as Json })
          .eq("id", t.id)
          .select("id");
      }),
    );
    count += results.filter((r) => !r.error && r.data?.length).length;
  }
  refresh();
  if (count === 0) return fail("No tenés permiso para cambiar los elementos de este tablero.");
  return ok({ count });
}
