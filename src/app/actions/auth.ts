"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth";
import { signInSchema } from "@/lib/validation";
import { fail, fromZod, type ActionResult } from "@/lib/action-result";

export type AuthFormState = (ActionResult<undefined> & { email?: string }) | null;

function authErrorMessage(message: string, code?: string) {
  const m = message.toLowerCase();
  if (code === "invalid_credentials" || m.includes("invalid login credentials")) return "Email o contraseña incorrectos.";
  if (code === "user_banned") return "Tu cuenta está suspendida. Hablá con un administrador.";
  if (m.includes("rate limit") || code === "over_request_rate_limit")
    return "Demasiados intentos seguidos. Esperá unos minutos e intentá de nuevo.";
  if (m.includes("fetch failed") || m.includes("network")) return "No pudimos conectarnos con el servidor. Revisá tu conexión.";
  return "No pudimos iniciar sesión. Intentá de nuevo en unos minutos.";
}

export async function signInAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  const email = String(formData.get("email") ?? "");
  if (!parsed.success) return { ...fromZod(parsed.error), email };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { ...fail(authErrorMessage(error.message, error.code)), email };

  revalidatePath("/", "layout");
  redirect(safeNextPath(formData.get("next")));
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
