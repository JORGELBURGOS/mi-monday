"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { callAccountAdmin } from "@/lib/admin-api";
import { getCurrentUser } from "@/lib/auth";
import { emailSchema, passwordSchema, uuidSchema } from "@/lib/validation";
import { fail, fromZod, ok, type ActionResult } from "@/lib/action-result";
import { SESSION_EXPIRED } from "./context";

/*
 * Acciones del superadministrador. La función vetta-gestion vuelve a verificar
 * en cada llamada que quien la invoca sea superadministrador.
 */

export type Company = {
  id: string;
  name: string;
  created_at: string;
  boards: number;
  users: number;
  is_member: boolean;
  admins: { user_id: string; role: string; full_name: string | null; email: string | null; active: boolean }[];
};

export async function listCompaniesAction(): Promise<ActionResult<Company[]>> {
  if (!(await getCurrentUser())) return fail(SESSION_EXPIRED);
  const res = await callAccountAdmin<Company[]>("list_companies", {});
  if (!res.ok) return fail(res.error);
  return ok(res.data);
}

export type CreateCompanyState =
  | ActionResult<{ company: string; name: string; email: string; existing: boolean; tempPassword?: string }>
  | null;

const companySchema = z.object({
  name: z.string().trim().min(1, { message: "Ingresá el nombre de la empresa." }).max(80, { message: "Máximo 80 caracteres." }),
  adminName: z.string().trim().min(1, { message: "Ingresá el nombre del administrador." }).max(120, { message: "Máximo 120 caracteres." }),
  adminEmail: emailSchema,
  password: z.union([z.literal(""), passwordSchema]),
});

export async function createCompanyAction(_prev: CreateCompanyState, formData: FormData): Promise<CreateCompanyState> {
  if (!(await getCurrentUser())) return fail(SESSION_EXPIRED);
  const parsed = companySchema.safeParse({
    name: formData.get("name"),
    adminName: formData.get("adminName"),
    adminEmail: formData.get("adminEmail"),
    password: formData.get("password") ?? "",
  });
  if (!parsed.success) return fromZod(parsed.error);

  const res = await callAccountAdmin<{ workspace_id: string; name: string; admin: { existing: boolean; email: string; temp_password?: string } }>(
    "create_company",
    {
      name: parsed.data.name,
      admin_full_name: parsed.data.adminName,
      admin_email: parsed.data.adminEmail,
      admin_password: parsed.data.password || undefined,
    },
  );
  if (!res.ok) return fail(res.error);
  revalidatePath("/superadmin");
  return ok({
    company: res.data.name,
    name: parsed.data.adminName,
    email: res.data.admin.email,
    existing: res.data.admin.existing,
    tempPassword: res.data.admin.temp_password,
  });
}

export async function renameCompanyAction(workspaceId: string, name: string): Promise<ActionResult> {
  if (!(await getCurrentUser())) return fail(SESSION_EXPIRED);
  const parsed = z.string().trim().min(1, { message: "Ingresá un nombre." }).max(80, { message: "Máximo 80 caracteres." }).safeParse(name);
  if (!uuidSchema.safeParse(workspaceId).success) return fail("Empresa inválida.");
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Nombre inválido.");
  const res = await callAccountAdmin("update_company", { workspace_id: workspaceId, name: parsed.data });
  if (!res.ok) return fail(res.error);
  revalidatePath("/", "layout");
  return ok(undefined, "Empresa renombrada.");
}

export async function joinCompanyAction(workspaceId: string): Promise<ActionResult> {
  if (!(await getCurrentUser())) return fail(SESSION_EXPIRED);
  if (!uuidSchema.safeParse(workspaceId).success) return fail("Empresa inválida.");
  const res = await callAccountAdmin("join_company", { workspace_id: workspaceId });
  if (!res.ok) return fail(res.error);
  revalidatePath("/", "layout");
  return ok(undefined, "Te sumaste como administrador principal.");
}
