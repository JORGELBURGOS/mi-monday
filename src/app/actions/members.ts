"use server";

import { revalidatePath } from "next/cache";
import { actionContext, SESSION_EXPIRED } from "./context";
import { inviteSchema, roleSchema, uuidSchema } from "@/lib/validation";
import { fail, fromDb, fromZod, ok, type ActionResult } from "@/lib/action-result";

export type InviteState = ActionResult<{ email: string }> | null;

export async function inviteMemberAction(workspaceId: string, _prev: InviteState, formData: FormData): Promise<InviteState> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(workspaceId).success) return fail("Espacio inválido.");

  const parsed = inviteSchema.safeParse({ email: formData.get("email"), role: formData.get("role") });
  if (!parsed.success) return fromZod(parsed.error);

  // ¿Ya es miembro?
  const { data: existing } = await ctx.supabase
    .from("workspace_members")
    .select("user_id, profiles!inner(email)")
    .eq("workspace_id", workspaceId)
    .eq("profiles.email", parsed.data.email)
    .maybeSingle();
  if (existing) return fail("Esa persona ya es miembro del espacio.", { email: "Ya es miembro." });

  const { error } = await ctx.supabase
    .from("workspace_invitations")
    .insert({ workspace_id: workspaceId, email: parsed.data.email, role: parsed.data.role });
  if (error) {
    if (error.code === "23505") return fail("Ya hay una invitación pendiente para ese email.", { email: "Invitación pendiente." });
    if (error.code === "42501")
      return fail(
        parsed.data.role === "admin"
          ? "Solo un propietario puede invitar administradores."
          : "Solo propietarios y administradores pueden invitar.",
      );
    return fromDb(error, "No se pudo crear la invitación.");
  }

  revalidatePath(`/e/${workspaceId}/miembros`);
  return ok({ email: parsed.data.email });
}

export async function revokeInvitationAction(invitationId: string): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(invitationId).success) return fail("Invitación inválida.");

  const { data, error } = await ctx.supabase
    .from("workspace_invitations")
    .update({ status: "revoked" })
    .eq("id", invitationId)
    .eq("status", "pending")
    .select("workspace_id");
  if (error) return fromDb(error, "No se pudo revocar la invitación.");
  if (!data?.length) return fail("La invitación ya no está pendiente o no tenés permiso.");

  revalidatePath(`/e/${data[0].workspace_id}/miembros`);
  return ok(undefined, "Invitación revocada.");
}

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
