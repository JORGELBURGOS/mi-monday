"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { callAccountAdmin } from "@/lib/admin-api";
import { getCurrentUser } from "@/lib/auth";
import { emailSchema, passwordSchema, uuidSchema } from "@/lib/validation";
import { fail, fromZod, ok, type ActionResult } from "@/lib/action-result";
import { SESSION_EXPIRED } from "./context";

/* ------------------------------------------------------------- alta de personas */

export type CreatePersonState =
  | ActionResult<{ email: string; fullName: string; existing: boolean; tempPassword?: string }>
  | null;

const createPersonSchema = z.object({
  fullName: z.string().trim().min(1, { message: "Ingresá el nombre." }).max(120, { message: "Máximo 120 caracteres." }),
  email: emailSchema,
  role: z.enum(["member", "admin", "owner"], { message: "Rol inválido." }),
  password: z.union([z.literal(""), passwordSchema]),
  boards: z.array(z.uuid()).max(500),
});

export async function createPersonAction(
  workspaceId: string,
  _prev: CreatePersonState,
  formData: FormData,
): Promise<CreatePersonState> {
  if (!(await getCurrentUser())) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(workspaceId).success) return fail("Empresa inválida.");
  const parsed = createPersonSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    role: formData.get("role"),
    password: formData.get("password") ?? "",
    boards: formData.getAll("boards").map(String),
  });
  if (!parsed.success) return fromZod(parsed.error);

  const res = await callAccountAdmin<{ existing: boolean; email: string; temp_password?: string }>("create_user", {
    workspace_id: workspaceId,
    email: parsed.data.email,
    full_name: parsed.data.fullName,
    role: parsed.data.role,
    password: parsed.data.password || undefined,
    board_ids: parsed.data.boards,
  });
  if (!res.ok) return fail(res.error);

  revalidatePath(`/e/${workspaceId}`, "layout");
  return ok({
    email: res.data.email,
    fullName: parsed.data.fullName,
    existing: res.data.existing,
    tempPassword: res.data.temp_password,
  });
}

/* ------------------------------------------------------- reseteo por un admin */

export async function resetPasswordAction(
  workspaceId: string,
  userId: string,
): Promise<ActionResult<{ email: string; tempPassword: string }>> {
  if (!(await getCurrentUser())) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(userId).success || !uuidSchema.safeParse(workspaceId).success) return fail("Datos inválidos.");
  const res = await callAccountAdmin<{ email: string; temp_password: string }>("reset_password", { user_id: userId });
  if (!res.ok) return fail(res.error);
  revalidatePath(`/e/${workspaceId}/miembros`);
  return ok({ email: res.data.email, tempPassword: res.data.temp_password });
}

/* ------------------------------------------------- edición completa de personas */

const updatePersonSchema = z.object({
  fullName: z.string().trim().min(1, { message: "Ingresá el nombre." }).max(120, { message: "Máximo 120 caracteres." }),
  email: emailSchema,
});

export async function updatePersonAction(
  workspaceId: string,
  userId: string,
  input: { fullName: string; email: string },
): Promise<ActionResult> {
  if (!(await getCurrentUser())) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(userId).success || !uuidSchema.safeParse(workspaceId).success) return fail("Datos inválidos.");
  const parsed = updatePersonSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const res = await callAccountAdmin("update_user", { user_id: userId, full_name: parsed.data.fullName, email: parsed.data.email });
  if (!res.ok) return fail(res.error);
  revalidatePath(`/e/${workspaceId}`, "layout");
  return ok(undefined, "Datos actualizados.");
}

export async function setPersonActiveAction(workspaceId: string, userId: string, active: boolean): Promise<ActionResult> {
  if (!(await getCurrentUser())) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(userId).success || !uuidSchema.safeParse(workspaceId).success) return fail("Datos inválidos.");
  const res = await callAccountAdmin("set_user_active", { user_id: userId, active: Boolean(active) });
  if (!res.ok) return fail(res.error);
  revalidatePath(`/e/${workspaceId}`, "layout");
  return ok(undefined, active ? "Cuenta reactivada." : "Cuenta desactivada: ya no puede entrar.");
}

/* ------------------------------------------- cambio obligatorio (primer ingreso) */

export type PasswordFormState = ActionResult<undefined> | null;

const forcedChangeSchema = z
  .object({ temp: z.string().min(1, { message: "Ingresá la contraseña temporal." }), password: passwordSchema, confirm: z.string() })
  .refine((d) => d.password === d.confirm, { path: ["confirm"], message: "Las contraseñas no coinciden." })
  .refine((d) => d.password !== d.temp, { path: ["password"], message: "Tiene que ser distinta de la temporal." });

export async function completePasswordChangeAction(_prev: PasswordFormState, formData: FormData): Promise<PasswordFormState> {
  if (!(await getCurrentUser())) return fail(SESSION_EXPIRED);
  const parsed = forcedChangeSchema.safeParse({
    temp: formData.get("temp"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return fromZod(parsed.error);

  const res = await callAccountAdmin("complete_password_change", {
    temp_password: parsed.data.temp,
    new_password: parsed.data.password,
  });
  if (!res.ok) {
    return /temporal/i.test(res.error) ? fail(res.error, { temp: res.error }) : fail(res.error);
  }
  revalidatePath("/", "layout");
  redirect("/inicio");
}

/* --------------------------------------------------- cambio desde Mi cuenta */

const changeSchema = z
  .object({ current: z.string().min(1, { message: "Ingresá tu contraseña actual." }), password: passwordSchema, confirm: z.string() })
  .refine((d) => d.password === d.confirm, { path: ["confirm"], message: "Las contraseñas no coinciden." })
  .refine((d) => d.password !== d.current, { path: ["password"], message: "Tiene que ser distinta de la actual." });

export async function changePasswordAction(_prev: PasswordFormState, formData: FormData): Promise<PasswordFormState> {
  if (!(await getCurrentUser())) return fail(SESSION_EXPIRED);
  const parsed = changeSchema.safeParse({
    current: formData.get("current"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return fromZod(parsed.error);

  const res = await callAccountAdmin("change_password", {
    current_password: parsed.data.current,
    new_password: parsed.data.password,
  });
  if (!res.ok) {
    return /actual/i.test(res.error) ? fail(res.error, { current: res.error }) : fail(res.error);
  }
  return ok(undefined, "Listo: tu contraseña se actualizó.");
}
