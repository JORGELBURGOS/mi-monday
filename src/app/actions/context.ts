import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, type SessionUser } from "@/lib/auth";

type Ctx = { supabase: Awaited<ReturnType<typeof createClient>>; user: SessionUser };

/** Sesión verificada para Server Actions. Devuelve null si venció. */
export async function actionContext(): Promise<Ctx | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  return { supabase, user };
}

export const SESSION_EXPIRED = "Tu sesión venció. Volvé a iniciar sesión.";
