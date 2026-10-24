import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";
import { getSupabaseEnv } from "@/lib/env";

/** Rutas accesibles sin sesión. */
const PUBLIC_PATHS = ["/", "/login", "/recuperar", "/configuracion-pendiente", "/f", "/seguimiento"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || (p !== "/" && pathname.startsWith(`${p}/`)));
}

/**
 * Refresca el token de Supabase en cada request y hace una redirección
 * optimista a /login en rutas privadas. La autorización real se verifica en
 * el servidor (requireUser) y en la base de datos (RLS).
 */
/** Direcciones anteriores de la app: redirigen a la actual. */
const LEGACY_HOSTS = new Set(["vetta-trazabilidad.vercel.app"]);
const CANONICAL_HOST = "vettaapp.vercel.app";

export async function updateSession(request: NextRequest) {
  const host = request.headers.get("host")?.toLowerCase();
  if (host && LEGACY_HOSTS.has(host)) {
    const target = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, `https://${CANONICAL_HOST}`);
    return NextResponse.redirect(target, 308);
  }

  let response = NextResponse.next({ request });
  const { url, key } = getSupabaseEnv();

  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  // No agregar código entre createServerClient y getClaims().
  const { data } = await supabase.auth.getClaims();
  const isSignedIn = Boolean(data?.claims?.sub);
  const { pathname, search } = request.nextUrl;

  if (!isSignedIn && !isPublicPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    const redirect = NextResponse.redirect(loginUrl);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }

  if (isSignedIn && (pathname === "/login" || pathname === "/")) {
    const home = request.nextUrl.clone();
    home.pathname = "/inicio";
    home.search = "";
    const redirect = NextResponse.redirect(home);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }

  return response;
}
