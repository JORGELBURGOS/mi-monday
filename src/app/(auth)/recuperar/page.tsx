import type { Metadata } from "next";
import Link from "next/link";
import { RecoverForm } from "../auth-forms";

export const metadata: Metadata = { title: "Recuperar contraseña" };

export default function RecoverPage() {
  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight">Recuperá tu contraseña</h1>
      <p className="mb-6 mt-1.5 text-sm text-muted">Te enviamos un enlace para crear una nueva.</p>
      <RecoverForm />
      <p className="mt-6 text-center text-sm text-muted">
        <Link href="/login" className="font-semibold text-accent hover:underline">
          Volver a iniciar sesión
        </Link>
      </p>
    </>
  );
}
