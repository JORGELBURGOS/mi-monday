"use client";

import { Button } from "@/components/ui/button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="contenido" className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center px-5 text-center">
      <h1 className="text-2xl font-extrabold tracking-tight">Algo salió mal</h1>
      <p className="mt-2 text-sm text-muted">
        {error.message && !error.digest ? error.message : "Hubo un problema al cargar esta pantalla. Probá de nuevo."}
      </p>
      {error.digest && <p className="mt-2 font-mono text-xs text-subtle">Código: {error.digest}</p>}
      <Button variant="primary" className="mt-6" onClick={() => reset()}>
        Reintentar
      </Button>
    </main>
  );
}
