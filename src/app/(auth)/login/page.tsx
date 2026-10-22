import type { Metadata } from "next";
import Link from "next/link";
import { SignInForm } from "../auth-forms";
import { safeNextPath } from "@/lib/auth";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? safeNextPath(params.next) : undefined;
  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight">Iniciá sesión</h1>
      <p className="mb-6 mt-1.5 text-sm text-muted">Entrá a tus espacios y tableros.</p>
      <SignInForm next={next} linkError={params.error === "enlace"} />
      <p className="mt-6 text-center text-sm text-muted">
        ¿No tenés cuenta?{" "}
        <Link href="/registro" className="font-semibold text-accent hover:underline">
          Registrate
        </Link>
      </p>
    </>
  );
}
