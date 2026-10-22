import type { Metadata } from "next";
import Link from "next/link";
import { SignUpForm } from "../auth-forms";

export const metadata: Metadata = { title: "Crear cuenta" };

export default function RegisterPage() {
  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight">Creá tu cuenta</h1>
      <p className="mb-6 mt-1.5 text-sm text-muted">Gratis. Después creás tu primer espacio de trabajo.</p>
      <SignUpForm />
      <p className="mt-6 text-center text-sm text-muted">
        ¿Ya tenés cuenta?{" "}
        <Link href="/login" className="font-semibold text-accent hover:underline">
          Iniciá sesión
        </Link>
      </p>
    </>
  );
}
