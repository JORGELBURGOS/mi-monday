"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { actionContext, SESSION_EXPIRED } from "./context";
import { uuidSchema } from "@/lib/validation";
import { fail, fromDb, ok, type ActionResult } from "@/lib/action-result";
import { templateWidgets, widgetsSchema, type Widget } from "@/lib/dashboards";

const metaSchema = z.object({
  name: z.string().trim().min(1, { message: "Poné un nombre." }).max(80, { message: "Máximo 80 caracteres." }),
  description: z.string().trim().max(300, { message: "Máximo 300 caracteres." }).optional(),
  visibility: z.enum(["workspace", "private"]),
});

export async function createDashboardAction(
  workspaceId: string,
  input: { name: string; visibility: "workspace" | "private"; template: "blank" | "summary" },
): Promise<ActionResult<{ id: string }>> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(workspaceId).success) return fail("Empresa inválida.");
  const parsed = metaSchema.safeParse({ name: input.name, visibility: input.visibility });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos.");

  const { data: last } = await ctx.supabase.from("dashboards").select("position").eq("workspace_id", workspaceId).order("position", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await ctx.supabase
    .from("dashboards")
    .insert({
      workspace_id: workspaceId,
      name: parsed.data.name,
      visibility: parsed.data.visibility,
      widgets: templateWidgets(input.template === "summary" ? "summary" : "blank"),
      position: (last?.position ?? 0) + 1000,
    })
    .select("id")
    .single();
  if (error || !data) return fromDb(error, "No se pudo crear el dashboard.");
  refresh();
  return ok({ id: data.id }, "Dashboard creado.");
}

export async function updateDashboardMetaAction(
  dashboardId: string,
  input: { name: string; description?: string; visibility: "workspace" | "private" },
): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(dashboardId).success) return fail("Dashboard inválido.");
  const parsed = metaSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  const { data, error } = await ctx.supabase
    .from("dashboards")
    .update({ name: parsed.data.name, description: parsed.data.description || null, visibility: parsed.data.visibility })
    .eq("id", dashboardId)
    .select("id");
  if (error) return fromDb(error);
  if (!data?.length) return fail("Solo quien creó el dashboard o un administrador puede cambiarlo.");
  refresh();
  return ok(undefined, "Dashboard actualizado.");
}

export async function saveDashboardWidgetsAction(dashboardId: string, widgets: Widget[]): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(dashboardId).success) return fail("Dashboard inválido.");
  const parsed = widgetsSchema.safeParse(widgets);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Algún widget no es válido.");
  const ids = new Set(parsed.data.map((w) => w.id));
  if (ids.size !== parsed.data.length) return fail("Hay widgets repetidos.");
  const { data, error } = await ctx.supabase.from("dashboards").update({ widgets: parsed.data }).eq("id", dashboardId).select("id");
  if (error) return fromDb(error, "No se pudo guardar el dashboard.");
  if (!data?.length) return fail("Solo quien creó el dashboard o un administrador puede editarlo.");
  refresh();
  return ok(undefined, "Dashboard guardado.");
}

export async function duplicateDashboardAction(dashboardId: string): Promise<ActionResult<{ id: string }>> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(dashboardId).success) return fail("Dashboard inválido.");
  const { data: src } = await ctx.supabase.from("dashboards").select("workspace_id, name, description, widgets").eq("id", dashboardId).maybeSingle();
  if (!src) return fail("El dashboard ya no existe.");
  const { data: last } = await ctx.supabase.from("dashboards").select("position").eq("workspace_id", src.workspace_id).order("position", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await ctx.supabase
    .from("dashboards")
    .insert({
      workspace_id: src.workspace_id,
      name: `${src.name} (copia)`.slice(0, 80),
      description: src.description,
      // La copia arranca privada: la persona decide si la comparte.
      visibility: "private",
      widgets: src.widgets,
      position: (last?.position ?? 0) + 1000,
    })
    .select("id")
    .single();
  if (error || !data) return fromDb(error, "No se pudo duplicar.");
  refresh();
  return ok({ id: data.id }, "Dashboard duplicado (privado).");
}

export async function deleteDashboardAction(dashboardId: string): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(dashboardId).success) return fail("Dashboard inválido.");
  const { data, error } = await ctx.supabase.from("dashboards").delete().eq("id", dashboardId).select("id");
  if (error) return fromDb(error, "No se pudo eliminar.");
  if (!data?.length) return fail("Solo quien creó el dashboard o un administrador puede eliminarlo.");
  refresh();
  return ok(undefined, "Dashboard eliminado.");
}
