"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { actionContext, SESSION_EXPIRED } from "./context";
import { uuidSchema } from "@/lib/validation";
import { fail, fromDb, ok, type ActionResult } from "@/lib/action-result";
import { callFunction } from "@/lib/admin-api";

/**
 * Carga o reemplaza el token de DeepSeek de una empresa. La base lo guarda
 * cifrado en Supabase Vault y verifica que quien lo carga sea el dueño o el
 * superadministrador. El token no vuelve nunca a la app.
 */
export async function saveAiKeyAction(workspaceId: string, key: string, dailyLimit: number): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(workspaceId).success) return fail("Empresa inválida.");
  const limit = z.number().int().min(0).max(1000).safeParse(dailyLimit);
  if (!limit.success) return fail("El límite diario tiene que estar entre 0 y 1000.");
  const clean = key.trim();
  if (clean && (clean.length < 20 || clean.length > 300 || /\s/.test(clean))) return fail("El token no parece válido.");
  const { error } = await ctx.supabase.rpc("set_workspace_ai_key", { p_workspace: workspaceId, p_key: clean, p_daily_limit: limit.data });
  if (error) return fromDb(error);
  refresh();
  return ok(undefined);
}

export async function clearAiKeyAction(workspaceId: string): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(workspaceId).success) return fail("Empresa inválida.");
  const { error } = await ctx.supabase.rpc("clear_workspace_ai_key", { p_workspace: workspaceId });
  if (error) return fromDb(error);
  refresh();
  return ok(undefined);
}

export type AiRuleProposal = { ok: true; rule: Record<string, unknown>; explanation?: string } | { ok: false; question: string };

/** Pide a la IA de la empresa una propuesta de regla. No guarda nada. */
export async function suggestRuleAction(boardId: string, prompt: string): Promise<ActionResult<AiRuleProposal>> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(boardId).success) return fail("Tablero inválido.");
  const text = prompt.trim();
  if (text.length < 5) return fail("Contá qué querés que haga la regla.");
  if (text.length > 1500) return fail("El pedido puede tener hasta 1500 caracteres.");
  const res = await callFunction<unknown>("vetta-ia-reglas", null, { boardId, prompt: text });
  if (!res.ok) return fail(res.error);
  const d = res.data as Record<string, unknown> | null;
  if (!d || typeof d !== "object") return fail("La IA no devolvió una propuesta.");
  if (d.ok === true && d.rule && typeof d.rule === "object" && !Array.isArray(d.rule)) {
    return ok({ ok: true, rule: d.rule as Record<string, unknown>, explanation: typeof d.explanation === "string" ? d.explanation.slice(0, 500) : undefined });
  }
  const q = typeof d.question === "string" && d.question.trim() ? d.question.trim().slice(0, 500) : "No pude armar la regla. Probá contarlo con otras palabras.";
  return ok({ ok: false, question: q });
}
