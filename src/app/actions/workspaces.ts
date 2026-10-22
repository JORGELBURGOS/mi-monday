"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { actionContext, SESSION_EXPIRED } from "./context";
import { createWorkspaceSchema, uuidSchema, workspaceSchema } from "@/lib/validation";
import { fail, fromDb, fromZod, ok, type ActionResult } from "@/lib/action-result";
import { POSITION_STEP } from "@/lib/constants";
import type { createClient } from "@/lib/supabase/server";

export type FormState = ActionResult<undefined> | null;

export async function createWorkspaceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);

  const parsed = createWorkspaceSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? undefined,
    withSample: formData.get("withSample") === "on",
  });
  if (!parsed.success) return fromZod(parsed.error);

  const { data: ws, error } = await ctx.supabase
    .from("workspaces")
    .insert({ name: parsed.data.name, description: parsed.data.description, created_by: ctx.user.id })
    .select("id")
    .single();
  if (error || !ws) return fromDb(error, "No se pudo crear el espacio.");

  let target = `/e/${ws.id}`;
  if (parsed.data.withSample) {
    const boardId = await createSampleBoard(ctx.supabase, ws.id);
    if (boardId) target = `/t/${boardId}`;
  }

  revalidatePath("/", "layout");
  redirect(target);
}

/**
 * Tablero de ejemplo opcional, solo para espacios recién creados. Todo el
 * contenido está marcado como ejemplo para no confundirse con datos reales.
 */
async function createSampleBoard(supabase: Awaited<ReturnType<typeof createClient>>, workspaceId: string) {
  const { data: board } = await supabase
    .from("boards")
    .insert({
      workspace_id: workspaceId,
      name: "Ejemplo: lanzamiento de proyecto",
      description: "Tablero de ejemplo para conocer la herramienta. Podés editarlo, archivarlo o eliminarlo.",
    })
    .select("id")
    .single();
  if (!board) return null;

  const [{ data: groups }, { data: statuses }] = await Promise.all([
    supabase.from("board_groups").select("id").eq("board_id", board.id).order("position"),
    supabase.from("board_statuses").select("id, position").eq("board_id", board.id).order("position"),
  ]);
  const firstGroup = groups?.[0]?.id;
  if (!firstGroup || !statuses) return board.id;

  await supabase.from("board_groups").update({ name: "Esta semana" }).eq("id", firstGroup);
  const { data: later } = await supabase
    .from("board_groups")
    .insert({ board_id: board.id, name: "Próximamente", color: "violet", position: 2 * POSITION_STEP })
    .select("id")
    .single();

  const st = (p: number) => statuses.find((s) => s.position === p)?.id ?? null;
  const inDays = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };

  await supabase.from("tasks").insert([
    { board_id: board.id, group_id: firstGroup, title: "Ejemplo: definir el alcance", status_id: st(3), priority: "high", due_date: inDays(-1), position: 1 * POSITION_STEP },
    { board_id: board.id, group_id: firstGroup, title: "Ejemplo: armar el cronograma", status_id: st(1), priority: "medium", due_date: inDays(2), position: 2 * POSITION_STEP },
    { board_id: board.id, group_id: firstGroup, title: "Ejemplo: revisar presupuesto", status_id: st(2), priority: "urgent", due_date: inDays(4), position: 3 * POSITION_STEP },
    ...(later
      ? [
          { board_id: board.id, group_id: later.id, title: "Ejemplo: presentar avances", status_id: st(0), priority: "low" as const, due_date: inDays(10), position: 1 * POSITION_STEP },
          { board_id: board.id, group_id: later.id, title: "Ejemplo: recopilar comentarios", status_id: st(0), priority: "medium" as const, due_date: null, position: 2 * POSITION_STEP },
        ]
      : []),
  ]);
  return board.id;
}

export async function updateWorkspaceAction(workspaceId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(workspaceId).success) return fail("Espacio inválido.");

  const parsed = workspaceSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? undefined,
  });
  if (!parsed.success) return fromZod(parsed.error);

  const { data, error } = await ctx.supabase
    .from("workspaces")
    .update({ name: parsed.data.name, description: parsed.data.description })
    .eq("id", workspaceId)
    .select("id");
  if (error) return fromDb(error);
  if (!data?.length) return fail("Solo propietarios y administradores pueden editar el espacio.");

  revalidatePath("/", "layout");
  return ok(undefined, "Cambios guardados.");
}

export async function deleteWorkspaceAction(workspaceId: string): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(workspaceId).success) return fail("Espacio inválido.");

  const { data, error } = await ctx.supabase.from("workspaces").delete().eq("id", workspaceId).select("id");
  if (error) return fromDb(error, "No se pudo eliminar el espacio.");
  if (!data?.length) return fail("Solo un propietario puede eliminar el espacio.");

  revalidatePath("/", "layout");
  redirect("/inicio");
}

export async function leaveWorkspaceAction(workspaceId: string): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(workspaceId).success) return fail("Espacio inválido.");

  const { data, error } = await ctx.supabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", ctx.user.id)
    .select("user_id");
  if (error) return fromDb(error, "No pudiste salir del espacio.");
  if (!data?.length) return fail("No sos miembro de este espacio.");

  revalidatePath("/", "layout");
  redirect("/inicio");
}

export async function respondInvitationAction(invitationId: string, accept: boolean): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(invitationId).success) return fail("Invitación inválida.");

  const { data: workspaceId, error } = await ctx.supabase.rpc("respond_to_invitation", {
    p_invitation_id: invitationId,
    p_accept: accept,
  });
  if (error) return fromDb(error, "No se pudo responder la invitación.");

  revalidatePath("/", "layout");
  if (accept && workspaceId) redirect(`/e/${workspaceId}`);
  return ok(undefined, "Invitación rechazada.");
}
