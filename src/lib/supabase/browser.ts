"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

let client: ReturnType<typeof createBrowserClient<Database>> | null = null;

/**
 * Cliente de Supabase en el navegador (solo clave pública + sesión del
 * usuario). Se usa para subir y descargar archivos adjuntos: el acceso lo
 * controlan las políticas del bucket "vetta-files" en la base.
 */
export function browserClient() {
  if (!client) {
    client = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
    );
  }
  return client;
}

export const FILES_BUCKET = "vetta-files";
