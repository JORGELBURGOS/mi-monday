"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { actionContext, SESSION_EXPIRED } from "./context";
import { uuidSchema } from "@/lib/validation";
import { fail, fromDb, fromZod, ok, type ActionResult } from "@/lib/action-result";

/** Paso de una plantilla: solo el texto, si es sección y la nota. */
const templateItemSchema = z.object({
  text: z.string().trim().min(1).max(300),
  header: z.boolean().optional(),
  note: z.string().trim().max(1000).optional(),
});
const templateSchema = z.object({
  name: z.string().trim().min(1, "Poné un nombre a la plantilla.").max(80, "Hasta 80 caracteres."),
  items: z.array(templateItemSchema).min(1, "La plantilla necesita al menos un paso.").max(300, "Hasta 300 pasos."),
});

export type TemplateInput = z.input<typeof templateSchema>;

function clean(items: z.output<typeof templateSchema>["items"]) {
  return items.map((i) => ({ text: i.text, ...(i.header ? { header: true } : {}), ...(i.note ? { note: i.note } : {}) }));
}

export async function createChecklistTemplateAction(workspaceId: string, input: TemplateInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(workspaceId).success) return fail("Empresa inválida.");
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const { data, error } = await ctx.supabase
    .from("checklist_templates")
    .insert({ workspace_id: workspaceId, name: parsed.data.name, items: clean(parsed.data.items), created_by: ctx.user.id })
    .select("id")
    .single();
  if (error || !data) return fromDb(error, "No se pudo guardar la plantilla.");
  refresh();
  return ok({ id: data.id });
}

export async function updateChecklistTemplateAction(id: string, input: TemplateInput): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(id).success) return fail("Plantilla inválida.");
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const { data, error } = await ctx.supabase
    .from("checklist_templates")
    .update({ name: parsed.data.name, items: clean(parsed.data.items) })
    .eq("id", id)
    .select("id");
  if (error) return fromDb(error);
  if (!data?.length) return fail("Solo quien creó la plantilla o un administrador la puede cambiar.");
  refresh();
  return ok(undefined);
}

export async function deleteChecklistTemplateAction(id: string): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(id).success) return fail("Plantilla inválida.");
  const { data, error } = await ctx.supabase.from("checklist_templates").delete().eq("id", id).select("id");
  if (error) return fromDb(error);
  if (!data?.length) return fail("Solo quien creó la plantilla o un administrador la puede eliminar.");
  refresh();
  return ok(undefined);
}
