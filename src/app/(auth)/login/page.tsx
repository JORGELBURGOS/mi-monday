import type { Metadata } from "next";
import { SignInForm } from "../auth-forms";
import { safeNextPath } from "@/lib/auth";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? safeNextPath(params.next) : undefined;
  const deactivated = params.desactivada === "1";
  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight">Iniciá sesión</h1>
      <p className="mb-6 mt-1.5 text-sm text-muted">Entrá a tu empresa y tus tableros.</p>
      {deactivated && (
        <p role="alert" className="mb-5 rounded-xl bg-danger-soft px-3 py-2.5 text-sm text-danger">
          Tu cuenta está desactivada. Si creés que es un error, hablá con el administrador de tu empresa.
        </p>
      )}
      <SignInForm next={next} />
      <p className="mt-6 text-center text-sm text-muted">
        ¿No tenés cuenta? Pedísela al administrador de tu empresa.
      </p>
    </>
  );
}
