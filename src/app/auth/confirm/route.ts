import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth";

const OTP_TYPES: EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/**
 * Destino de los enlaces de email de Supabase (confirmación de cuenta y
 * recuperación de contraseña). Soporta los dos formatos:
 *  - ?code=...        (flujo PKCE, plantillas por defecto)
 *  - ?token_hash=...  (plantillas personalizadas, funciona entre dispositivos)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(searchParams.get("next"), "/inicio");

  const target = request.nextUrl.clone();
  target.search = "";

  const supabase = await createClient();
  let failed = true;

  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    failed = Boolean(error);
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failed = Boolean(error);
  }

  if (failed) {
    target.pathname = "/login";
    target.searchParams.set("error", "enlace");
    return NextResponse.redirect(target);
  }

  target.pathname = type === "recovery" ? "/restablecer" : next;
  return NextResponse.redirect(target);
}
