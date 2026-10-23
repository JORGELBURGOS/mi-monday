"use server";

import { refresh } from "next/cache";
import { actionContext, SESSION_EXPIRED } from "./context";
import { commentSchema, moveTaskSchema, taskPatchSchema, taskTitleSchema, uuidSchema } from "@/lib/validation";
import { fail, fromDb, ok, type ActionResult } from "@/lib/action-result";
import { POSITION_STEP } from "@/lib/constants";
import { displayName } from "@/lib/format";

export async function createTaskAction(
  boardId: string,
  groupId: string,
  title: string,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(boardId).success || !uuidSchema.safeParse(groupId).success) return fail("Datos inválidos.");
  const parsed = taskTitleSchema.safeParse(title);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Título inválido.");

  const [{ data: last }, { data: firstStatus }] = await Promise.all([
    ctx.supabase
      .from("tasks")
      .select("position")
      .eq("group_id", groupId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle(),
    ctx.supabase.from("board_statuses").select("id").eq("board_id", boardId).order("position").limit(1).maybeSingle(),
  ]);

  const { data, error } = await ctx.supabase
    .from("tasks")
    .insert({
      board_id: boardId,
      group_id: groupId,
      title: parsed.data,
      status_id: firstStatus?.id ?? null,
      position: (last?.position ?? 0) + POSITION_STEP,
    })
    .select("id")
    .single();
  if (error || !data) return fromDb(error, "No se pudo crear la tarea.");
  refresh();
  return ok({ id: data.id });
}

export async function updateTaskAction(taskId: string, patch: Record<string, unknown>): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(taskId).success) return fail("Tarea inválida.");
  const parsed = taskPatchSchema.safeParse(patch);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos.");

  const update = { ...parsed.data };
  if (update.description !== undefined) update.description = update.description?.trim() ? update.description : null;

  const { data, error } = await ctx.supabase.from("tasks").update(update).eq("id", taskId).select("id");
  if (error) return fromDb(error);
  if (!data?.length) return fail("La tarea ya no existe o no tenés acceso.");
  refresh();
  return ok(undefined);
}

export async function moveTaskAction(input: { taskId: string; groupId: string; position: number }): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  const parsed = moveTaskSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");

  const { data, error } = await ctx.supabase
    .from("tasks")
    .update({ group_id: parsed.data.groupId, position: parsed.data.position })
    .eq("id", parsed.data.taskId)
    .select("id");
  if (error) return fromDb(error, "No se pudo mover la tarea.");
  if (!data?.length) return fail("La tarea ya no existe o no tenés acceso.");
  refresh();
  return ok(undefined);
}

export async function duplicateTaskAction(taskId: string): Promise<ActionResult<{ id: string }>> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(taskId).success) return fail("Tarea inválida.");

  const { data: src } = await ctx.supabase.from("tasks").select("*").eq("id", taskId).maybeSingle();
  if (!src) return fail("La tarea ya no existe o no tenés acceso.");

  const { data: next } = await ctx.supabase
    .from("tasks")
    .select("position")
    .eq("group_id", src.group_id)
    .gt("position", src.position)
    .order("position")
    .limit(1)
    .maybeSingle();
  const position = next ? (src.position + next.position) / 2 : src.position + POSITION_STEP;
  const title = `${src.title} (copia)`.slice(0, 500);

  const { data, error } = await ctx.supabase
    .from("tasks")
    .insert({
      board_id: src.board_id,
      group_id: src.group_id,
      title,
      description: src.description,
      status_id: src.status_id,
      priority: src.priority,
      assignee_id: src.assignee_id,
      due_date: src.due_date,
      custom_values: src.custom_values,
      position,
    })
    .select("id")
    .single();
  if (error || !data) return fromDb(error, "No se pudo duplicar la tarea.");
  refresh();
  return ok({ id: data.id }, "Tarea duplicada.");
}

export async function deleteTaskAction(taskId: string): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(taskId).success) return fail("Tarea inválida.");

  const { data, error } = await ctx.supabase.from("tasks").delete().eq("id", taskId).select("id");
  if (error) return fromDb(error, "No se pudo eliminar la tarea.");
  if (!data?.length) return fail("La tarea ya no existe o no tenés acceso.");
  refresh();
  return ok(undefined, "Tarea eliminada.");
}

/* -------------------------------------------------------------- comentarios */

export type CommentView = {
  id: string;
  body: string;
  created_at: string;
  author_id: string | null;
  author_name: string;
  is_mine: boolean;
};

export async function listCommentsAction(taskId: string): Promise<ActionResult<CommentView[]>> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(taskId).success) return fail("Tarea inválida.");

  const { data, error } = await ctx.supabase
    .from("task_comments")
    .select("id, body, created_at, author_id, profiles(full_name, email)")
    .eq("task_id", taskId)
    .order("created_at");
  if (error) return fromDb(error, "No se pudieron cargar los comentarios.");
  return ok(
    (data ?? []).map((c) => ({
      id: c.id,
      body: c.body,
      created_at: c.created_at,
      author_id: c.author_id,
      author_name: c.profiles ? displayName(c.profiles) : c.author_id ? "Ex miembro" : "Vetta · regla automática",
      is_mine: c.author_id === ctx.user.id,
    })),
  );
}

export async function addCommentAction(taskId: string, body: string): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(taskId).success) return fail("Tarea inválida.");
  const parsed = commentSchema.safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Comentario inválido.");

  const { error } = await ctx.supabase.from("task_comments").insert({ task_id: taskId, body: parsed.data });
  if (error) return fromDb(error, "No se pudo publicar el comentario.");
  return ok(undefined);
}

export async function deleteCommentAction(commentId: string): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(commentId).success) return fail("Comentario inválido.");

  const { data, error } = await ctx.supabase.from("task_comments").delete().eq("id", commentId).select("id");
  if (error) return fromDb(error, "No se pudo eliminar el comentario.");
  if (!data?.length) return fail("Solo podés eliminar tus propios comentarios.");
  return ok(undefined);
}

/* ------------------------------------------------- acciones en lote (selección) */

const idsSchema = uuidSchema.array().min(1).max(500);

/** Cambia el mismo campo en varios elementos a la vez. */
export async function updateTasksAction(taskIds: string[], patch: Record<string, unknown>): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  const ids = idsSchema.safeParse(taskIds);
  const parsed = taskPatchSchema.safeParse(patch);
  if (!ids.success || !parsed.success) return fail("Datos inválidos.");
  const { data, error } = await ctx.supabase.from("tasks").update(parsed.data).in("id", ids.data).select("id");
  if (error) return fromDb(error);
  refresh();
  return ok(undefined, `${data?.length ?? 0} ${data?.length === 1 ? "elemento actualizado" : "elementos actualizados"}.`);
}

/** Mueve varios elementos al final de una carpeta. */
export async function moveTasksAction(taskIds: string[], groupId: string): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  const ids = idsSchema.safeParse(taskIds);
  if (!ids.success || !uuidSchema.safeParse(groupId).success) return fail("Datos inválidos.");
  const { data: last } = await ctx.supabase.from("tasks").select("position").eq("group_id", groupId).order("position", { ascending: false }).limit(1).maybeSingle();
  let position = (last?.position ?? 0) + POSITION_STEP;
  for (const id of ids.data) {
    const { error } = await ctx.supabase.from("tasks").update({ group_id: groupId, position }).eq("id", id);
    if (error) return fromDb(error, "No se pudo mover un elemento.");
    position += POSITION_STEP;
  }
  refresh();
  return ok(undefined, ids.data.length === 1 ? "Elemento movido." : `${ids.data.length} elementos movidos.`);
}

export async function duplicateTasksAction(taskIds: string[]): Promise<ActionResult> {
  const ids = idsSchema.safeParse(taskIds);
  if (!ids.success) return fail("Datos inválidos.");
  for (const id of ids.data) {
    const res = await duplicateTaskAction(id);
    if (!res.ok) return res;
  }
  return ok(undefined, ids.data.length === 1 ? "Elemento duplicado." : `${ids.data.length} elementos duplicados.`);
}

export async function deleteTasksAction(taskIds: string[]): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  const ids = idsSchema.safeParse(taskIds);
  if (!ids.success) return fail("Datos inválidos.");
  const { data, error } = await ctx.supabase.from("tasks").delete().in("id", ids.data).select("id");
  if (error) return fromDb(error, "No se pudieron eliminar los elementos.");
  refresh();
  return ok(undefined, `${data?.length ?? 0} ${data?.length === 1 ? "elemento eliminado" : "elementos eliminados"}.`);
}
