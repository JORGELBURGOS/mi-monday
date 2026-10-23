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
  return ok(undefined, "Miembro quitado del espacio.");
}
