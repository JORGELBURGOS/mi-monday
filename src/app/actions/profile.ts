"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionContext, SESSION_EXPIRED } from "./context";
import { fail, fromDb, fromZod, ok, type ActionResult } from "@/lib/action-result";

export type ProfileState = ActionResult<undefined> | null;

const schema = z.object({
  fullName: z.string().trim().min(1, { message: "Ingresá tu nombre." }).max(120, { message: "Máximo 120 caracteres." }),
});

export async function updateProfileAction(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const ctx = await actionContext();
  if (!ctx) return fail(SESSION_EXPIRED);
  const parsed = schema.safeParse({ fullName: formData.get("fullName") });
  if (!parsed.success) return fromZod(parsed.error);

  const { error } = await ctx.supabase.from("profiles").update({ full_name: parsed.data.fullName }).eq("id", ctx.user.id);
  if (error) return fromDb(error);
  revalidatePath("/", "layout");
  return ok(undefined, "Perfil actualizado.");
}
