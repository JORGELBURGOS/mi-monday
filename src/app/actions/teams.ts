"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { actionContext, SESSION_EXPIRED } from "./context";
import { uuidSchema } from "@/lib/validation";
import { fail, fromDb, fromZod, ok, type ActionResult } from "@/lib/action-result";
import { COLOR_NAMES } from "@/lib/constants";
import { BOARD_ROLES, readEditors, type Editors } from "@/lib/teams";
import { columnSettingsSchema } from "@/lib/columns";
import { parseBoardSettings } from "@/lib/board-settings";
import type { Json } from "@/lib/database.types";

/* ------------------------------------------------------------------ equipos */

const teamSchema = z.object({
  name: z.string().trim().min(1, "Poné un nombre al equipo.").max(60, "Hasta 60 caracteres."),
  color: z.enum(COLOR_NAMES).default("blue"),
  description: z.string().trim().max(300, "La descripción puede tener hasta 300 caracteres.").optional(),
  memberIds: z.array(uuidSchema).max(500).default([]),
});
export type TeamInput = z.input<typeof teamSchema>;

const dupName = (msg: string) => (msg.includes("workspace_teams_name_idx") ? "Ya hay un equipo con ese nombre." : null);

async function syncMembers(ctx: NonNullable<Awaited<ReturnType<typeof actionContext>>>, teamId: string, memberIds: string[]) {
  const { data: current } = await ctx.supabase.from("team_members").select("user_id").eq("team_id", teamId);
  const have = new Set((current ?? []).map((m) => m.user_id));
  const want = new Set(memberIds);
  const add = [...want].filter((id) => !have.has(id));
  const remove = [...have].filter((id) => !want.has(id));
  if (add.length) {
    const { error } = await ctx.supabase.from("team_members").insert(add.map((user_id) => ({ team_id: teamId, user_id })));
    if (error) return error;
  }
  if (remove.length) {
    const { error } = await ctx.supabase.from("team_members").delete().eq("team_id", teamId).in("user_id", remove);
    if (error) return error;
  }
  return null;
}

export async function createTeamAction(workspaceId: string, input: TeamInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(workspaceId).success) return fail("Empresa inválida.");
  const parsed = teamSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const { data, error } = await ctx.supabase
    .from("workspace_teams")
    .insert({ workspace_id: workspaceId, name: parsed.data.name, color: parsed.data.color, description: parsed.data.description || null })
    .select("id")
    .single();
  if (error || !data) return fail(dupName(error?.message ?? "") ?? "Solo los administradores de la empresa arman equipos.");
  const err = await syncMembers(ctx, data.id, parsed.data.memberIds);
  if (err) return fromDb(err, "El equipo se creó, pero no se pudieron sumar todas las personas.");
  refresh();
  return ok({ id: data.id }, "Equipo creado.");
}

export async function updateTeamAction(teamId: string, input: TeamInput): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(teamId).success) return fail("Equipo inválido.");
  const parsed = teamSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const { data, error } = await ctx.supabase
    .from("workspace_teams")
    .update({ name: parsed.data.name, color: parsed.data.color, description: parsed.data.description || null })
    .eq("id", teamId)
    .select("id");
  if (error) return fail(dupName(error.message) ?? "No se pudo guardar el equipo.");
  if (!data?.length) return fail("Solo los administradores de la empresa editan equipos.");
  const err = await syncMembers(ctx, teamId, parsed.data.memberIds);
  if (err) return fromDb(err, "No se pudieron actualizar los integrantes.");
  refresh();
  return ok(undefined, "Equipo guardado.");
}

export async function deleteTeamAction(teamId: string): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(teamId).success) return fail("Equipo inválido.");
  const { data, error } = await ctx.supabase.from("workspace_teams").delete().eq("id", teamId).select("id");
  if (error) return fromDb(error);
  if (!data?.length) return fail("Solo los administradores de la empresa eliminan equipos.");
  refresh();
  return ok(undefined, "Equipo eliminado.");
}

/* ------------------------------------------------------- permisos del tablero */

const roleSchema = z.enum(BOARD_ROLES).nullable();

/** Rol de una persona en un tablero (null = sin permiso propio). */
export async function setBoardMemberRoleAction(boardId: string, userId: string, role: string | null): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  const r = roleSchema.safeParse(role);
  if (!uuidSchema.safeParse(boardId).success || !uuidSchema.safeParse(userId).success || !r.success) return fail("Datos inválidos.");
  if (r.data === null) {
    const { error } = await ctx.supabase.from("board_members").delete().eq("board_id", boardId).eq("user_id", userId);
    if (error) return fromDb(error, "No se pudo quitar el permiso.");
  } else {
    const { error } = await ctx.supabase.from("board_members").upsert({ board_id: boardId, user_id: userId, role: r.data }, { onConflict: "board_id,user_id" });
    if (error) return fromDb(error, "No se pudo guardar el permiso.");
  }
  refresh();
  return ok(undefined);
}

/** Rol de un equipo entero en un tablero (null = sin permiso). */
export async function setBoardTeamRoleAction(boardId: string, teamId: string, role: string | null): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  const r = roleSchema.safeParse(role);
  if (!uuidSchema.safeParse(boardId).success || !uuidSchema.safeParse(teamId).success || !r.success) return fail("Datos inválidos.");
  if (r.data === null) {
    const { error } = await ctx.supabase.from("board_teams").delete().eq("board_id", boardId).eq("team_id", teamId);
    if (error) return fromDb(error, "No se pudo quitar el permiso.");
  } else {
    const { error } = await ctx.supabase.from("board_teams").upsert({ board_id: boardId, team_id: teamId, role: r.data }, { onConflict: "board_id,team_id" });
    if (error) return fromDb(error, "No se pudo guardar el permiso.");
  }
  refresh();
  return ok(undefined);
}

/** Rol del resto de la empresa en un tablero "para todos". */
export async function setBoardDefaultRoleAction(boardId: string, role: string): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  const r = z.enum(["editor", "own", "commenter", "viewer"]).safeParse(role);
  if (!uuidSchema.safeParse(boardId).success || !r.success) return fail("Datos inválidos.");
  const { data, error } = await ctx.supabase.from("boards").update({ default_role: r.data }).eq("id", boardId).select("id");
  if (error) return fromDb(error);
  if (!data?.length) return fail("Solo quien administra el tablero cambia sus permisos.");
  refresh();
  return ok(undefined, "Permiso guardado.");
}

/* ------------------------------------------------------- restricciones finas */

const editorsSchema = z.object({ users: z.array(uuidSchema).max(200).optional(), teams: z.array(uuidSchema).max(50).optional() });
const clean = (e: z.output<typeof editorsSchema>): Editors => readEditors(e);

/** Quién edita los elementos de una carpeta (vacío = todos los que pueden editar el tablero). */
export async function setGroupEditorsAction(groupId: string, editors: Editors): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  const e = editorsSchema.safeParse(editors);
  if (!uuidSchema.safeParse(groupId).success || !e.success) return fail("Datos inválidos.");
  const { data, error } = await ctx.supabase.from("board_groups").update({ editors: clean(e.data) as Json }).eq("id", groupId).select("id");
  if (error) return fromDb(error);
  if (!data?.length) return fail("La carpeta ya no existe.");
  refresh();
  return ok(undefined, "Permisos de la carpeta guardados.");
}

/** Quién puede cambiar una columna (propia o fija). */
export async function setColumnEditorsAction(boardId: string, key: string, editors: Editors): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  const e = editorsSchema.safeParse(editors);
  if (!uuidSchema.safeParse(boardId).success || !e.success) return fail("Datos inválidos.");
  const value = clean(e.data);
  if (key.startsWith("c:")) {
    const columnId = key.slice(2);
    if (!uuidSchema.safeParse(columnId).success) return fail("Columna inválida.");
    const { data: col } = await ctx.supabase.from("board_columns").select("settings").eq("id", columnId).eq("board_id", boardId).maybeSingle();
    if (!col) return fail("La columna ya no existe.");
    const current = columnSettingsSchema.safeParse(col.settings);
    const next = { ...(current.success ? current.data : {}), editors: value } as Record<string, unknown>;
    if (!value.users && !value.teams) delete next.editors;
    const { data, error } = await ctx.supabase.from("board_columns").update({ settings: next as Json }).eq("id", columnId).select("id");
    if (error) return fromDb(error);
    if (!data?.length) return fail("Solo quien administra el tablero decide quién edita cada columna.");
  } else {
    if (!["title", "assignee", "status", "priority", "due"].includes(key)) return fail("Columna inválida.");
    const { data: board } = await ctx.supabase.from("boards").select("settings").eq("id", boardId).maybeSingle();
    if (!board) return fail("El tablero ya no existe.");
    const settings = parseBoardSettings(board.settings);
    const cols = { ...(settings.columns ?? {}) } as Record<string, Record<string, unknown>>;
    const entry = { ...(cols[key] ?? {}) };
    if (value.users || value.teams) entry.editors = value;
    else delete entry.editors;
    cols[key] = entry;
    const { data, error } = await ctx.supabase.from("boards").update({ settings: { ...settings, columns: cols } as Json }).eq("id", boardId).select("id");
    if (error) return fromDb(error);
    if (!data?.length) return fail("Solo quien administra el tablero decide quién edita cada columna.");
  }
  refresh();
  return ok(undefined, "Permisos de la columna guardados.");
}
