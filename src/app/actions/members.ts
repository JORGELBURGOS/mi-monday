"use server";

import { revalidatePath } from "next/cache";
import { actionContext, SESSION_EXPIRED } from "./context";
import { roleSchema, uuidSchema } from "@/lib/validation";
import { fail, fromDb, ok, type ActionResult } from "@/lib/action-result";

export async function changeRoleAction(workspaceId: string, userId: string, role: string): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  const parsedRole = roleSchema.safeParse(role);
  if (!uuidSchema.safeParse(workspaceId).success || !uuidSchema.safeParse(userId).success || !parsedRole.success) {
    return fail("Datos inválidos.");
  }

  const { data, error } = await ctx.supabase
    .from("workspace_members")
    .update({ role: parsedRole.data })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .select("user_id");
  if (error) return fromDb(error, "No se pudo cambiar el rol.");
  if (!data?.length) return fail("No tenés permiso para cambiar ese rol.");

  revalidatePath(`/e/${workspaceId}`, "layout");
  return ok(undefined, "Rol actualizado.");
}

export async function removeMemberAction(workspaceId: string, userId: string): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(workspaceId).success || !uuidSchema.safeParse(userId).success) return fail("Datos inválidos.");

  const { data, error } = await ctx.supabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .select("user_id");
  if (error) return fromDb(error, "No se pudo quitar al miembro.");
  if (!data?.length) return fail("No tenés permiso para quitar a esa persona.");

  revalidatePath(`/e/${workspaceId}`, "layout");
  return ok(undefined, "Usuario quitado de la empresa.");
}

/* ----------------------------------------------------------- acceso a tableros */

/** Define a qué tableros privados de la empresa tiene acceso una persona. */
export async function setPersonBoardsAction(workspaceId: string, userId: string, boardIds: string[]): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(workspaceId).success || !uuidSchema.safeParse(userId).success) return fail("Datos inválidos.");
  if (!Array.isArray(boardIds) || boardIds.length > 500 || boardIds.some((b) => !uuidSchema.safeParse(b).success)) {
    return fail("Datos inválidos.");
  }

  const { data: boards, error: bErr } = await ctx.supabase.from("boards").select("id").eq("workspace_id", workspaceId);
  if (bErr) return fromDb(bErr);
  const workspaceBoards = new Set((boards ?? []).map((b) => b.id));
  const wanted = new Set(boardIds.filter((b) => workspaceBoards.has(b)));

  const { data: current, error: cErr } = await ctx.supabase
    .from("board_members")
    .select("board_id")
    .eq("user_id", userId)
    .in("board_id", [...workspaceBoards]);
  if (cErr) return fromDb(cErr);
  const have = new Set((current ?? []).map((r) => r.board_id));

  const toAdd = [...wanted].filter((b) => !have.has(b));
  const toRemove = [...have].filter((b) => !wanted.has(b));
  if (toAdd.length) {
    const { error } = await ctx.supabase.from("board_members").insert(toAdd.map((board_id) => ({ board_id, user_id: userId })));
    if (error) return fromDb(error, "No se pudo dar acceso a los tableros.");
  }
  if (toRemove.length) {
    const { error } = await ctx.supabase.from("board_members").delete().eq("user_id", userId).in("board_id", toRemove);
    if (error) return fromDb(error, "No se pudo quitar el acceso.");
  }
  revalidatePath(`/e/${workspaceId}`, "layout");
  return ok(undefined, "Accesos actualizados.");
}

/** Da o quita acceso de una persona a un tablero. */
export async function setBoardAccessAction(boardId: string, userId: string, granted: boolean): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(boardId).success || !uuidSchema.safeParse(userId).success) return fail("Datos inválidos.");
  if (granted) {
    const { error } = await ctx.supabase.from("board_members").upsert({ board_id: boardId, user_id: userId }, { onConflict: "board_id,user_id", ignoreDuplicates: true });
    if (error) return fromDb(error, "No se pudo dar acceso.");
  } else {
    const { error } = await ctx.supabase.from("board_members").delete().eq("board_id", boardId).eq("user_id", userId);
    if (error) return fromDb(error, "No se pudo quitar el acceso.");
  }
  revalidatePath(`/t/${boardId}`, "layout");
  return ok(undefined);
}

/** Tablero para todo el equipo o solo para las personas elegidas. */
export async function setBoardVisibilityAction(boardId: string, visibility: "workspace" | "private"): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(boardId).success || (visibility !== "workspace" && visibility !== "private")) return fail("Datos inválidos.");
  const { data, error } = await ctx.supabase.from("boards").update({ visibility }).eq("id", boardId).select("id");
  if (error) return fromDb(error);
  if (!data?.length) return fail("Solo un administrador puede cambiar el acceso a este tablero.");
  revalidatePath("/", "layout");
  return ok(undefined, visibility === "workspace" ? "Ahora lo ve todo el equipo." : "Ahora solo lo ven las personas elegidas.");
}
