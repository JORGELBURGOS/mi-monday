"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { actionContext, SESSION_EXPIRED } from "./context";
import { uuidSchema } from "@/lib/validation";
import { fail, fromDb, ok, type ActionResult } from "@/lib/action-result";
import { parseColumn } from "@/lib/columns";
import { formConfigSchema, initialConfig, type FormTemplate } from "@/lib/forms";
import type { FormConfig } from "@/lib/form-logic";

const nameSchema = z.string().trim().min(1, { message: "Poné un nombre." }).max(120, { message: "Máximo 120 caracteres." });

export async function createFormAction(boardId: string, input: { name: string; template: FormTemplate }): Promise<ActionResult<{ id: string }>> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(boardId).success) return fail("Tablero inválido.");
  const name = nameSchema.safeParse(input.name);
  if (!name.success) return fail(name.error.issues[0]?.message ?? "Nombre inválido.");
  const { data: cols } = await ctx.supabase.from("board_columns").select("*").eq("board_id", boardId);
  const config = initialConfig(name.data, ["blank", "request", "contact", "support"].includes(input.template) ? input.template : "blank", (cols ?? []).map(parseColumn));
  const { data, error } = await ctx.supabase.from("board_forms").insert({ board_id: boardId, name: name.data, config }).select("id").single();
  if (error?.code === "42501") return fail("Solo quien administra el tablero puede crear formularios.");
  if (error || !data) return fromDb(error, "No se pudo crear el formulario.");
  refresh();
  return ok({ id: data.id }, "Formulario creado.");
}

const settingsSchema = z.object({
  name: nameSchema,
  access: z.enum(["public", "members", "password"]),
  opens_at: z.iso.datetime({ offset: true }).nullable(),
  closes_at: z.iso.datetime({ offset: true }).nullable(),
  max_responses: z.number().int().min(1).max(1_000_000).nullable(),
});

/** Guarda la configuración completa (preguntas, diseño, destino, acceso). */
export async function saveFormAction(
  formId: string,
  input: { config: FormConfig; settings: z.input<typeof settingsSchema> },
): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(formId).success) return fail("Formulario inválido.");
  const config = formConfigSchema.safeParse(input.config);
  if (!config.success) return fail(config.error.issues[0]?.message ?? "Revisá la configuración.");
  const settings = settingsSchema.safeParse(input.settings);
  if (!settings.success) return fail(settings.error.issues[0]?.message ?? "Revisá el acceso.");
  const ids = new Set<string>();
  for (const q of config.data.questions) {
    if (ids.has(q.id)) return fail("Hay preguntas repetidas.");
    ids.add(q.id);
    if (q.kind === "free" && (q.freeType === "choice" || q.freeType === "multi") && !(q.options ?? []).length) return fail(`«${q.label || "Pregunta"}»: agregá al menos una opción.`);
    if ((q.kind === "field" || q.kind === "free") && !q.label.trim() && !q.hidden) return fail("Hay una pregunta sin texto.");
  }
  const params = config.data.questions.map((q) => q.param).filter(Boolean);
  if (new Set(params).size !== params.length) return fail("Dos preguntas usan el mismo parámetro del enlace.");

  const { data, error } = await ctx.supabase
    .from("board_forms")
    .update({ config: config.data, ...settings.data })
    .eq("id", formId)
    .select("id");
  if (error) return fromDb(error, "No se pudo guardar el formulario.");
  if (!data?.length) return fail("Solo quien administra el tablero puede editar el formulario.");
  refresh();
  return ok(undefined, "Formulario guardado.");
}

export async function setFormPublishedAction(formId: string, published: boolean): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(formId).success) return fail("Formulario inválido.");
  if (published) {
    const { data: f } = await ctx.supabase.from("board_forms").select("access, config").eq("id", formId).maybeSingle();
    if (!f) return fail("El formulario ya no existe.");
    const cfg = formConfigSchema.safeParse(f.config);
    if (!cfg.success) return fail("Guardá el formulario antes de publicarlo.");
    if (!cfg.data.questions.some((q) => q.kind === "field" || q.kind === "free")) return fail("Agregá al menos una pregunta antes de publicar.");
    if (f.access === "password") {
      const { data: has } = await ctx.supabase.rpc("form_has_password", { p_form: formId });
      if (!has) return fail("Definí la contraseña antes de publicar (pestaña Acceso).");
    }
  }
  const { data, error } = await ctx.supabase.from("board_forms").update({ is_published: published }).eq("id", formId).select("id");
  if (error) return fromDb(error);
  if (!data?.length) return fail("Solo quien administra el tablero puede publicarlo.");
  refresh();
  return ok(undefined, published ? "Formulario publicado: ya recibe respuestas." : "Formulario despublicado: ya no recibe respuestas.");
}

export async function setFormPasswordAction(formId: string, password: string): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(formId).success) return fail("Formulario inválido.");
  if (password.length > 100) return fail("Máximo 100 caracteres.");
  const { error } = await ctx.supabase.rpc("set_form_password", { p_form: formId, p_password: password });
  if (error) return fromDb(error, "No se pudo guardar la contraseña.");
  refresh();
  return ok(undefined, password ? "Contraseña guardada." : "Contraseña quitada.");
}

export async function duplicateFormAction(formId: string): Promise<ActionResult<{ id: string }>> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(formId).success) return fail("Formulario inválido.");
  const { data: src } = await ctx.supabase.from("board_forms").select("board_id, name, access, config").eq("id", formId).maybeSingle();
  if (!src) return fail("El formulario ya no existe.");
  const { data, error } = await ctx.supabase
    .from("board_forms")
    .insert({ board_id: src.board_id, name: `${src.name} (copia)`.slice(0, 120), access: src.access === "password" ? "public" : src.access, config: src.config })
    .select("id")
    .single();
  if (error || !data) return fromDb(error, "No se pudo duplicar.");
  refresh();
  return ok({ id: data.id }, "Formulario duplicado (sin publicar).");
}

export async function deleteFormAction(formId: string): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(formId).success) return fail("Formulario inválido.");
  const { data, error } = await ctx.supabase.from("board_forms").delete().eq("id", formId).select("id");
  if (error) return fromDb(error, "No se pudo eliminar.");
  if (!data?.length) return fail("Solo quien administra el tablero puede eliminarlo.");
  refresh();
  return ok(undefined, "Formulario eliminado. Los elementos que creó siguen en el tablero.");
}
