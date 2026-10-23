import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseEnv } from "@/lib/env";

/**
 * Llama a la función de administración de cuentas (supabase/functions/vetta-admin)
 * desde el servidor, con el token de la sesión actual. La función valida la
 * identidad y los permisos; la clave secreta de Supabase nunca pasa por la app.
 */
export async function callAccountAdmin<T>(
  action: "create_user" | "reset_password" | "complete_password_change" | "change_password",
  payload: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { ok: false, error: "Tu sesión venció. Volvé a iniciar sesión." };

  const { url, key } = getSupabaseEnv();
  try {
    const res = await fetch(`${url}/functions/v1/vetta-admin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: key,
      },
      body: JSON.stringify({ action, ...payload }),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as { ok: boolean; data?: T; error?: string } | null;
    if (!body) return { ok: false, error: "El servidor no respondió correctamente. Probá de nuevo." };
    if (!body.ok) return { ok: false, error: body.error ?? "No se pudo completar la operación." };
    return { ok: true, data: body.data as T };
  } catch {
    return { ok: false, error: "No pudimos conectarnos con el servidor. Revisá tu conexión." };
  }
}
