import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button-classes";

export const metadata: Metadata = { title: "Recuperar contraseña" };

export default function RecoverPage() {
  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight">¿Olvidaste tu contraseña?</h1>
      <div className="mb-6 mt-3 space-y-3 text-sm leading-relaxed text-muted">
        <p>
          Pedile a un administrador de tu espacio de trabajo que te asigne una <strong className="text-fg">contraseña temporal</strong>.
          Lo hace desde la sección <em>Miembros</em>, en un minuto.
        </p>
        <p>Cuando entres con la temporal, el sistema te va a pedir que elijas una nueva.</p>
      </div>
      <Link href="/login" className={buttonClasses("primary", "md", "w-full")}>
        Volver a iniciar sesión
      </Link>
    </>
  );
}
