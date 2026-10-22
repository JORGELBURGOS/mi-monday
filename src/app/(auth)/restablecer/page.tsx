import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { NewPasswordForm } from "@/components/new-password-form";

export const metadata: Metadata = { title: "Nueva contraseña" };

export default async function ResetPasswordPage() {
  const user = await requireUser("/restablecer");
  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight">Elegí una contraseña nueva</h1>
      <p className="mb-6 mt-1.5 text-sm text-muted">Para la cuenta {user.email}.</p>
      <NewPasswordForm />
    </>
  );
}
