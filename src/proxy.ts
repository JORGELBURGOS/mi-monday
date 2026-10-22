import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { hasSupabaseEnv } from "@/lib/env";

export async function proxy(request: NextRequest) {
  if (!hasSupabaseEnv()) {
    // Sin configuración no hay forma segura de autenticar: se muestra una
    // pantalla explicativa en lugar de fallar con un error genérico.
    if (request.nextUrl.pathname !== "/configuracion-pendiente") {
      const url = request.nextUrl.clone();
      url.pathname = "/configuracion-pendiente";
      url.search = "";
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
