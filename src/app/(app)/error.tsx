"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { buttonClasses } from "@/components/ui/button-classes";
import { IconAlert } from "@/components/ui/icons";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-5 py-20 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-danger-soft text-danger">
        <IconAlert />
      </div>
      <h1 className="text-xl font-extrabold">No pudimos cargar esta pantalla</h1>
      <p className="mt-2 text-sm text-muted">
        {error.message && !error.digest
          ? error.message
          : "Puede ser un problema de conexión o de permisos. Probá de nuevo en unos segundos."}
      </p>
      <div className="mt-6 flex gap-2">
        <Button variant="primary" onClick={() => reset()}>
          Reintentar
        </Button>
        <Link href="/inicio" className={buttonClasses("secondary")}>
          Ir al inicio
        </Link>
      </div>
    </div>
  );
}
