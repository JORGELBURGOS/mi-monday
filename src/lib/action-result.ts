import type { PostgrestError } from "@supabase/supabase-js";
import type { ZodError } from "zod";

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export function ok<T>(data: T, message?: string): ActionResult<T> {
  return { ok: true, data, message };
}

export function fail(error: string, fieldErrors?: Record<string, string>): { ok: false; error: string; fieldErrors?: Record<string, string> } {
  return { ok: false, error, fieldErrors };
}

export function fromZod(error: ZodError) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fail("Revisá los datos marcados.", fieldErrors);
}

/** Traduce errores de PostgREST/Postgres a mensajes comprensibles. */
export function fromDb(error: PostgrestError | { message: string; code?: string } | null, fallback = "No se pudo guardar el cambio.") {
  if (!error) return fail(fallback);
  const code = "code" in error ? error.code : undefined;
  switch (code) {
    case "42501":
      // Los permisos de Vetta (tablero, carpeta, columna, checklist) vienen redactados;
      // los de Postgres ("permission denied…", "row-level security") no.
      return fail(/permission denied|row-level security|violates/i.test(error.message) ? "No tenés permiso para hacer esto." : error.message);
    case "P0001":
      // Mensajes propios de la base, ya redactados para el usuario.
      return fail(error.message);
    case "23505":
      return fail("Ya existe un registro igual.");
    case "23514":
    case "22P02":
    case "22001":
      return fail("Algún dato no tiene el formato esperado.");
    case "23503":
      return fail("El elemento relacionado ya no existe. Recargá la página.");
    case "PGRST116":
      return fail("No se encontró el elemento o no tenés acceso.");
    default:
      if (/fetch failed|network|ECONN/i.test(error.message)) {
        return fail("No pudimos conectarnos con el servidor. Revisá tu conexión e intentá de nuevo.");
      }
      return fail(fallback);
  }
}
