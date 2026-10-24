"use server";

import { redirect } from "next/navigation";
import { refresh, revalidatePath } from "next/cache";
import { actionContext, SESSION_EXPIRED } from "./context";
import { boardSchema, colorSchema, groupNameSchema, statusSchema, uuidSchema } from "@/lib/validation";
import { fail, fromDb, fromZod, ok, type ActionResult } from "@/lib/action-result";
import { POSITION_STEP } from "@/lib/constants";
import { z } from "zod";
import { boardSettingsSchema, type BoardSettings } from "@/lib/board-settings";

export type BoardFormState = ActionResult<undefined> | null;

function readBoardForm(formData: FormData) {
  return boardSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? undefined,
    visibility: formData.get("visibility") ?? "workspace",
  });
}

export async function createBoardAction(workspaceId: string, _prev: BoardFormState, formData: FormData): Promise<BoardFormState> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(workspaceId).success) return fail("Empresa inválida.");

  const parsed = readBoardForm(formData);
  if (!parsed.success) return fromZod(parsed.error);

  const { data, error } = await ctx.supabase
    .from("boards")
    .insert({ workspace_id: workspaceId, ...parsed.data })
    .select("id")
    .single();
  if (error || !data) return fromDb(error, "No se pudo crear el tablero.");

  revalidatePath("/", "layout");
  redirect(`/t/${data.id}`);
}

export async function updateBoardAction(boardId: string, _prev: BoardFormState, formData: FormData): Promise<BoardFormState> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(boardId).success) return fail("Tablero inválido.");

  const parsed = readBoardForm(formData);
  if (!parsed.success) return fromZod(parsed.error);

  // La visibilidad se cambia desde la sección "Acceso" (setBoardVisibilityAction).
  const { name, description } = parsed.data;
  const { data, error } = await ctx.supabase.from("boards").update({ name, description }).eq("id", boardId).select("id");
  if (error) return fromDb(error);
  if (!data?.length) return fail("Solo quien creó el tablero o un administrador puede editarlo.");

  revalidatePath("/", "layout");
  return ok(undefined, "Cambios guardados.");
}

export async function renameBoardAction(boardId: string, name: string): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  const parsedName = boardSchema.shape.name.safeParse(name);
  if (!uuidSchema.safeParse(boardId).success) return fail("Tablero inválido.");
  if (!parsedName.success) return fail(parsedName.error.issues[0]?.message ?? "Nombre inválido.");

  const { data, error } = await ctx.supabase.from("boards").update({ name: parsedName.data }).eq("id", boardId).select("id");
  if (error) return fromDb(error);
  if (!data?.length) return fail("Solo quien creó el tablero o un administrador puede renombrarlo.");
  revalidatePath("/", "layout");
  return ok(undefined);
}

export async function setBoardArchivedAction(boardId: string, archived: boolean): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(boardId).success) return fail("Tablero inválido.");

  const { data, error } = await ctx.supabase
    .from("boards")
    .update({ is_archived: archived })
    .eq("id", boardId)
    .select("id");
  if (error?.code === "42501") return fail("Solo un administrador de la empresa puede archivar o restaurar tableros.");
  if (error) return fromDb(error);
  if (!data?.length) return fail("Solo un administrador de la empresa puede archivar o restaurar tableros.");

  revalidatePath("/", "layout");
  return ok(undefined, archived ? "Tablero archivado." : "Tablero restaurado.");
}

export async function deleteBoardAction(boardId: string): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(boardId).success) return fail("Tablero inválido.");

  const { data: board } = await ctx.supabase.from("boards").select("workspace_id, is_archived").eq("id", boardId).maybeSingle();
  if (!board) return fail("El tablero no existe o no tenés acceso.");
  if (!board.is_archived) return fail("Primero archivá el tablero. Solo se pueden eliminar tableros archivados.");

  const { data, error } = await ctx.supabase.from("boards").delete().eq("id", boardId).select("id");
  if (error) return fromDb(error, "No se pudo eliminar el tablero.");
  if (!data?.length) return fail("Solo un administrador de la empresa puede eliminar tableros.");

  revalidatePath("/", "layout");
  redirect(`/e/${board.workspace_id}`);
}

/* ------------------------------------------------------------------ grupos */

export async function createGroupAction(boardId: string, name: string): Promise<ActionResult<{ id: string }>> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  const parsed = groupNameSchema.safeParse(name);
  if (!uuidSchema.safeParse(boardId).success) return fail("Tablero inválido.");
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Nombre inválido.");

  const { data: last } = await ctx.supabase
    .from("board_groups")
    .select("position")
    .eq("board_id", boardId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const colors = ["blue", "green", "violet", "amber", "teal", "pink", "orange"] as const;
  const { count } = await ctx.supabase.from("board_groups").select("id", { count: "exact", head: true }).eq("board_id", boardId);

  const { data, error } = await ctx.supabase
    .from("board_groups")
    .insert({
      board_id: boardId,
      name: parsed.data,
      position: (last?.position ?? 0) + POSITION_STEP,
      color: colors[(count ?? 0) % colors.length],
    })
    .select("id")
    .single();
  if (error || !data) return fromDb(error, "No se pudo crear la carpeta.");
  refresh();
  return ok({ id: data.id });
}

const groupPatchSchema = z
  .object({ name: groupNameSchema, color: colorSchema, position: z.number().finite() })
  .partial()
  .refine((d) => Object.keys(d).length > 0);

export async function updateGroupAction(groupId: string, patch: { name?: string; color?: string; position?: number }): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(groupId).success) return fail("Carpeta inválida.");
  const parsed = groupPatchSchema.safeParse(patch);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos.");

  const { data, error } = await ctx.supabase.from("board_groups").update(parsed.data).eq("id", groupId).select("id");
  if (error) return fromDb(error);
  if (!data?.length) return fail("La carpeta ya no existe o no tenés acceso.");
  refresh();
  return ok(undefined);
}

export async function deleteGroupAction(groupId: string): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(groupId).success) return fail("Carpeta inválida.");

  const { data: group } = await ctx.supabase.from("board_groups").select("board_id").eq("id", groupId).maybeSingle();
  if (!group) return fail("La carpeta ya no existe.");
  const { count } = await ctx.supabase
    .from("board_groups")
    .select("id", { count: "exact", head: true })
    .eq("board_id", group.board_id);
  if ((count ?? 0) <= 1) return fail("Un tablero necesita al menos una carpeta.");

  const { data, error } = await ctx.supabase.from("board_groups").delete().eq("id", groupId).select("id");
  if (error) return fromDb(error, "No se pudo eliminar la carpeta.");
  if (!data?.length) return fail("No tenés permiso para eliminar esta carpeta.");
  refresh();
  return ok(undefined, "Carpeta eliminada.");
}

/* ----------------------------------------------------------------- estados */

export async function createStatusAction(boardId: string, input: { label: string; color: string; isDone: boolean }): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(boardId).success) return fail("Tablero inválido.");
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos.");

  const { data: last } = await ctx.supabase
    .from("board_statuses")
    .select("position")
    .eq("board_id", boardId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await ctx.supabase.from("board_statuses").insert({
    board_id: boardId,
    label: parsed.data.label,
    color: parsed.data.color,
    is_done: parsed.data.isDone,
    position: (last?.position ?? -1) + 1,
  });
  if (error) return fromDb(error, "No se pudo crear el estado.");
  refresh();
  return ok(undefined, "Estado creado.");
}

export async function updateStatusAction(statusId: string, input: { label: string; color: string; isDone: boolean }): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(statusId).success) return fail("Estado inválido.");
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos.");

  const { data, error } = await ctx.supabase
    .from("board_statuses")
    .update({ label: parsed.data.label, color: parsed.data.color, is_done: parsed.data.isDone })
    .eq("id", statusId)
    .select("id");
  if (error) return fromDb(error);
  if (!data?.length) return fail("No tenés permiso para editar los estados de este tablero.");
  refresh();
  return ok(undefined, "Estado actualizado.");
}

export async function moveStatusAction(statusId: string, direction: "up" | "down"): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(statusId).success) return fail("Estado inválido.");

  const { data: current } = await ctx.supabase.from("board_statuses").select("board_id").eq("id", statusId).maybeSingle();
  if (!current) return fail("El estado ya no existe.");
  const { data: all } = await ctx.supabase
    .from("board_statuses")
    .select("id, position")
    .eq("board_id", current.board_id)
    .order("position");
  if (!all) return fail("No se pudieron leer los estados.");

  const idx = all.findIndex((s) => s.id === statusId);
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapWith < 0 || swapWith >= all.length) return ok(undefined);

  const reordered = [...all];
  [reordered[idx], reordered[swapWith]] = [reordered[swapWith], reordered[idx]];
  for (const [i, s] of reordered.entries()) {
    if (s.position !== i) {
      const { error } = await ctx.supabase.from("board_statuses").update({ position: i }).eq("id", s.id);
      if (error) return fromDb(error);
    }
  }
  refresh();
  return ok(undefined);
}

export async function deleteStatusAction(statusId: string): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(statusId).success) return fail("Estado inválido.");

  const { data: status } = await ctx.supabase.from("board_statuses").select("board_id").eq("id", statusId).maybeSingle();
  if (!status) return fail("El estado ya no existe.");
  const { count } = await ctx.supabase
    .from("board_statuses")
    .select("id", { count: "exact", head: true })
    .eq("board_id", status.board_id);
  if ((count ?? 0) <= 1) return fail("El tablero necesita al menos un estado.");

  const { data, error } = await ctx.supabase.from("board_statuses").delete().eq("id", statusId).select("id");
  if (error) return fromDb(error, "No se pudo eliminar el estado.");
  if (!data?.length) return fail("No tenés permiso para editar los estados de este tablero.");
  refresh();
  return ok(undefined, "Estado eliminado. Las tareas que lo usaban quedaron sin estado.");
}

/**
 * Guarda de una vez las etiquetas del Estado (edición en la celda, como en
 * Monday): actualiza las existentes, crea las nuevas, elimina las quitadas y
 * respeta el orden recibido.
 */
const statusListSchema = z
  .array(
    z.object({
      id: z.string().optional(),
      label: statusSchema.shape.label,
      color: colorSchema,
      isDone: z.boolean(),
    }),
  )
  .min(1, { message: "El tablero necesita al menos un estado." })
  .max(60, { message: "Hasta 60 estados." });

export async function saveStatusesAction(
  boardId: string,
  input: { id?: string; label: string; color: string; isDone: boolean }[],
): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(boardId).success) return fail("Tablero inválido.");
  const parsed = statusListSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  const labels = parsed.data.map((s) => s.label.toLowerCase());
  if (new Set(labels).size !== labels.length) return fail("Hay dos estados con el mismo nombre.");

  const { data: current, error: readError } = await ctx.supabase.from("board_statuses").select("id").eq("board_id", boardId);
  if (readError || !current) return fail("No se pudieron leer los estados.");
  const existing = new Set(current.map((s) => s.id));
  const keep = new Set(parsed.data.filter((s) => s.id && existing.has(s.id)).map((s) => s.id!));

  for (const [i, s] of parsed.data.entries()) {
    if (s.id && existing.has(s.id)) {
      const { data, error } = await ctx.supabase
        .from("board_statuses")
        .update({ label: s.label, color: s.color, is_done: s.isDone, position: i })
        .eq("id", s.id)
        .select("id");
      if (error) return fromDb(error);
      if (!data?.length) return fail("No tenés permiso para editar los estados de este tablero.");
    } else {
      const { error } = await ctx.supabase
        .from("board_statuses")
        .insert({ board_id: boardId, label: s.label, color: s.color, is_done: s.isDone, position: i });
      if (error) return fromDb(error, "No se pudo crear el estado.");
    }
  }
  const removed = [...existing].filter((id) => !keep.has(id));
  if (removed.length) {
    const { error } = await ctx.supabase.from("board_statuses").delete().in("id", removed);
    if (error) return fromDb(error, "No se pudo eliminar un estado (puede que lo use una regla).");
  }
  refresh();
  return ok(undefined, "Etiquetas guardadas.");
}

/* ------------------------------------------------- ajustes visuales del tablero */

export async function updateBoardSettingsAction(boardId: string, settings: BoardSettings): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(boardId).success) return fail("Tablero inválido.");
  const parsed = boardSettingsSchema.safeParse(settings);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Ajustes inválidos.");
  const { data, error } = await ctx.supabase.from("boards").update({ settings: parsed.data }).eq("id", boardId).select("id");
  if (error) return fromDb(error);
  if (!data?.length) return fail("Solo quien administra el tablero puede cambiar sus columnas.");
  refresh();
  return ok(undefined);
}
