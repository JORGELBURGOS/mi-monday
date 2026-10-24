/**
 * Llamadas a la función pública de formularios ("vetta-formularios"). Solo usa
 * la clave pública: la función valida todo del lado del servidor. Se puede usar
 * desde el servidor (Next) o desde el navegador.
 */
export type FormsApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; [k: string]: unknown };

export async function callForms<T>(payload: Record<string, unknown>, userToken?: string | null): Promise<FormsApiResult<T>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { ok: false, status: 500, error: "Falta configurar la conexión." };
  try {
    const res = await fetch(`${url}/functions/v1/vetta-formularios`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key, ...(userToken ? { Authorization: `Bearer ${userToken}` } : {}) },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as ({ ok: boolean; data?: T; error?: string } & Record<string, unknown>) | null;
    if (!body) return { ok: false, status: res.status, error: "El servicio de formularios no respondió bien." };
    if (!res.ok || !body.ok) return { ...body, ok: false, status: res.status, error: body.error ?? "No se pudo completar." };
    return { ok: true, data: body.data as T };
  } catch {
    return { ok: false, status: 0, error: "No hay conexión. Revisá tu internet y probá de nuevo." };
  }
}
