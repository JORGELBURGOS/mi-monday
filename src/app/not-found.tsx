import Link from "next/link";
import { buttonClasses } from "@/components/ui/button-classes";

export default function NotFound() {
  return (
    <main id="contenido" className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center px-5 text-center">
      <p className="text-sm font-bold text-accent">404</p>
      <h1 className="mt-2 text-2xl font-extrabold tracking-tight">No encontramos esta página</h1>
      <p className="mt-2 text-sm text-muted">
        Puede que el enlace esté mal, que el elemento se haya eliminado o que no tengas acceso.
      </p>
      <Link href="/inicio" className={buttonClasses("primary", "md", "mt-6")}>
        Ir al inicio
      </Link>
    </main>
  );
}
