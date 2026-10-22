"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, safeNextPath } from "@/lib/auth";
import { emailSchema, newPasswordSchema, signInSchema, signUpSchema } from "@/lib/validation";
import { fail, fromZod, type ActionResult } from "@/lib/action-result";

export type AuthFormState = (ActionResult<undefined> & { email?: string }) | null;

/** URL base de la app para los enlaces de los emails. */
async function appOrigin() {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function authErrorMessage(message: string, code?: string) {
  const m = message.toLowerCase();
  if (code === "invalid_credentials" || m.includes("invalid login credentials")) return "Email o contraseña incorrectos.";
  if (code === "email_not_confirmed" || m.includes("email not confirmed"))
    return "Todavía no confirmaste tu email. Revisá tu bandeja de entrada (y la carpeta de spam).";
  if (code === "user_already_exists" || m.includes("already registered")) return "Ya existe una cuenta con ese email. Probá iniciar sesión.";
  if (code === "weak_password" || m.includes("password")) return "La contraseña no cumple los requisitos de seguridad. Probá con una más larga.";
  if (code === "over_email_send_rate_limit" || m.includes("rate limit"))
    return "Se enviaron demasiados emails en poco tiempo. Esperá unos minutos e intentá de nuevo.";
  if (code === "same_password") return "La nueva contraseña tiene que ser distinta de la anterior.";
  if (m.includes("fetch failed") || m.includes("network")) return "No pudimos conectarnos con el servidor. Revisá tu conexión.";
  return "No pudimos completar la operación. Intentá de nuevo en unos minutos.";
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

export async function signUpAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  const email = String(formData.get("email") ?? "");
  if (!parsed.success) return { ...fromZod(parsed.error), email };

  const supabase = await createClient();
  const origin = await appOrigin();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${origin}/auth/confirm?next=/inicio`,
    },
  });
  if (error) return { ...fail(authErrorMessage(error.message, error.code)), email };

  if (data.session) {
    // El proyecto no exige confirmar el email: la sesión ya está activa.
    revalidatePath("/", "layout");
    redirect("/inicio");
  }
  return {
    ok: true,
    data: undefined,
    message: `Te enviamos un email a ${parsed.data.email} para confirmar la cuenta. Abrí el enlace y vas a entrar directo.`,
    email,
  };
}

export async function requestPasswordResetAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { ...fail("Ingresá un email válido.", { email: "Ingresá un email válido." }) };

  const supabase = await createClient();
  const origin = await appOrigin();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${origin}/auth/confirm?next=/restablecer`,
  });
  if (error && (error.code === "over_email_send_rate_limit" || /rate limit/i.test(error.message))) {
    return fail(authErrorMessage(error.message, error.code));
  }
  // Mismo mensaje exista o no la cuenta, para no revelar qué emails están registrados.
  return {
    ok: true,
    data: undefined,
    message: "Si hay una cuenta con ese email, te enviamos un enlace para crear una nueva contraseña.",
  };
}

export async function updatePasswordAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  await requireUser("/restablecer");
  const parsed = newPasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return fromZod(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return fail(authErrorMessage(error.message, error.code));
  return { ok: true, data: undefined, message: "Listo: tu contraseña se actualizó." };
}

export async function resendConfirmationAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return fail("Ingresá un email válido.");
  const supabase = await createClient();
  const origin = await appOrigin();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data,
    options: { emailRedirectTo: `${origin}/auth/confirm?next=/inicio` },
  });
  if (error) return fail(authErrorMessage(error.message, error.code));
  return { ok: true, data: undefined, message: "Te reenviamos el email de confirmación.", email: parsed.data };
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
