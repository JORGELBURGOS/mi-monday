"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { actionContext, SESSION_EXPIRED } from "./context";
import { fail, fromDb, ok, type ActionResult } from "@/lib/action-result";

const idsSchema = z.union([z.literal("all"), z.array(z.number().int().positive()).min(1).max(200)]);

/** Marca avisos propios como leídos (la base solo permite tocar read_at de los propios). */
export async function markNotificationsReadAction(ids: number[] | "all"): Promise<ActionResult> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return fail("Datos inválidos.");

  let query = ctx.supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", ctx.user.id).is("read_at", null);
  if (parsed.data !== "all") query = query.in("id", parsed.data);
  const { error } = await query;
  if (error) return fromDb(error, "No se pudieron marcar los avisos.");
  refresh();
  return ok(undefined);
}
