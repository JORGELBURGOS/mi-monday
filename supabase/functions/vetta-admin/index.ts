// =============================================================================
// Vetta · función de administración de cuentas (Supabase Edge Function)
// -----------------------------------------------------------------------------
// Crea usuarios y gestiona contraseñas SIN enviar emails. Es el único lugar que
// usa la clave secreta de Supabase, que nunca sale del servidor. Cada acción
// verifica quién la pide y qué rol tiene antes de hacer nada.
//
// Acciones (POST JSON { action, ... } con Authorization: Bearer <token del usuario>):
//   create_user               Alta de una persona en un espacio (admin/propietario).
//   reset_password            Asigna una contraseña temporal a otra persona.
//   complete_password_change  La persona reemplaza su contraseña temporal.
//   change_password           La persona cambia su contraseña (pide la actual).
// =============================================================================
import { createClient } from "@supabase/supabase-js";

type Role = "owner" | "admin" | "member";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

function pickKey(jsonVar: string, legacyVar: string) {
  const raw = Deno.env.get(jsonVar);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      if (parsed.default) return parsed.default;
      const first = Object.values(parsed)[0];
      if (first) return first;
    } catch {
      // continúa con la clave heredada
    }
  }
  return Deno.env.get(legacyVar) ?? "";
}

const SECRET_KEY = pickKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
const PUBLIC_KEY = pickKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// ---------------------------------------------------------------- validación
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(v: unknown, field: string, { min = 1, max = 200 } = {}) {
  if (typeof v !== "string") throw new HttpError(400, `Falta el campo ${field}.`);
  const s = v.trim();
  if (s.length < min || s.length > max) throw new HttpError(400, `El campo ${field} no tiene un largo válido.`);
  return s;
}

function uuid(v: unknown, field: string) {
  const s = str(v, field, { max: 36 });
  if (!UUID_RE.test(s)) throw new HttpError(400, `${field} inválido.`);
  return s;
}

function password(v: unknown, field = "contraseña") {
  if (typeof v !== "string") throw new HttpError(400, `Falta la ${field}.`);
  if (v.length < 8) throw new HttpError(400, "La contraseña debe tener al menos 8 caracteres.");
  if (v.length > 72) throw new HttpError(400, "La contraseña puede tener hasta 72 caracteres.");
  return v;
}

/** Contraseña temporal legible: sin caracteres ambiguos (0/O, 1/l/I). */
function generatePassword(length = 12) {
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = lower + upper + digits;
  const pick = (set: string) => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length];
  const chars = [pick(lower), pick(upper), pick(digits)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

// ---------------------------------------------------------------- consultas
async function getProfile(id: string) {
  const { data, error } = await admin
    .from("profiles")
    .select("id, email, full_name, is_platform_admin, must_change_password")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new HttpError(500, "No se pudo leer el perfil.");
  return data;
}

async function getRole(workspaceId: string, userId: string): Promise<Role | null> {
  const { data, error } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, "No se pudieron leer los permisos.");
  return (data?.role as Role) ?? null;
}

/** Verifica una contraseña sin dejar sesión abierta en el servidor. */
async function verifyPassword(email: string, pass: string) {
  const client = createClient(SUPABASE_URL, PUBLIC_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: pass });
  return !error;
}

async function setPassword(userId: string, pass: string, mustChange: boolean) {
  const { error } = await admin.auth.admin.updateUserById(userId, { password: pass });
  if (error) {
    if (/weak|password/i.test(error.message)) throw new HttpError(400, "La contraseña no cumple los requisitos de seguridad.");
    throw new HttpError(500, "No se pudo actualizar la contraseña.");
  }
  const { error: pErr } = await admin.from("profiles").update({ must_change_password: mustChange }).eq("id", userId);
  if (pErr) throw new HttpError(500, "La contraseña se actualizó, pero no se pudo registrar el cambio.");
}

// ---------------------------------------------------------------- acciones
async function createUser(caller: Caller, body: Record<string, unknown>) {
  const workspaceId = uuid(body.workspace_id, "espacio");
  const email = str(body.email, "email", { max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, "Ingresá un email válido.");
  const fullName = str(body.full_name, "nombre", { max: 120 });
  const role = body.role === "admin" ? "admin" : "member";
  const tempPassword = body.password ? password(body.password) : generatePassword();

  const callerRole = await getRole(workspaceId, caller.id);
  const canManage = caller.isPlatformAdmin || callerRole === "owner" || callerRole === "admin";
  if (!canManage) throw new HttpError(403, "Solo propietarios y administradores pueden agregar personas.");
  if (role === "admin" && !(caller.isPlatformAdmin || callerRole === "owner")) {
    throw new HttpError(403, "Solo un propietario puede agregar administradores.");
  }
  const { data: ws } = await admin.from("workspaces").select("id").eq("id", workspaceId).maybeSingle();
  if (!ws) throw new HttpError(404, "El espacio no existe.");

  // ¿Ya tiene cuenta? Se lo suma al espacio sin tocar su contraseña.
  const { data: existing } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existing) {
    const currentRole = await getRole(workspaceId, existing.id);
    if (currentRole) throw new HttpError(409, "Esa persona ya es miembro del espacio.");
    const { error } = await admin
      .from("workspace_members")
      .insert({ workspace_id: workspaceId, user_id: existing.id, role });
    if (error) throw new HttpError(500, "No se pudo sumar a la persona al espacio.");
    return { existing: true, email, user_id: existing.id };
  }

  const { data: token, error: tErr } = await admin.rpc("admin_issue_provision_token");
  if (tErr || !token) throw new HttpError(500, "No se pudo preparar el alta.");

  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName, vetta_provision_token: token },
    app_metadata: { vetta_provisioned: true },
  });
  if (cErr || !created?.user) {
    if (cErr && /already|registered|exists/i.test(cErr.message)) {
      throw new HttpError(409, "Ya existe una cuenta con ese email.");
    }
    if (cErr && /password/i.test(cErr.message)) throw new HttpError(400, "La contraseña no cumple los requisitos de seguridad.");
    throw new HttpError(500, "No se pudo crear la cuenta.");
  }
  const userId = created.user.id;

  const { error: pErr } = await admin
    .from("profiles")
    .update({ must_change_password: true, created_by: caller.id, full_name: fullName })
    .eq("id", userId);
  const { error: mErr } = pErr
    ? { error: pErr }
    : await admin.from("workspace_members").insert({ workspace_id: workspaceId, user_id: userId, role });
  if (pErr || mErr) {
    // Deshacer el alta para no dejar cuentas a medias.
    await admin.auth.admin.deleteUser(userId);
    throw new HttpError(500, "No se pudo completar el alta. Probá de nuevo.");
  }

  return { existing: false, email, user_id: userId, temp_password: tempPassword };
}

async function resetPassword(caller: Caller, body: Record<string, unknown>) {
  const targetId = uuid(body.user_id, "usuario");
  if (targetId === caller.id) throw new HttpError(400, "Para cambiar tu propia contraseña usá Mi cuenta.");
  const target = await getProfile(targetId);
  if (!target) throw new HttpError(404, "La persona no existe.");

  if (!caller.isPlatformAdmin) {
    if (target.is_platform_admin) throw new HttpError(403, "No podés resetear la contraseña de un administrador de la plataforma.");
    const { data: memberships, error } = await admin
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", targetId);
    if (error) throw new HttpError(500, "No se pudieron leer los permisos.");
    if (!memberships?.length) throw new HttpError(403, "No tenés permiso sobre esa persona.");
    // Hay que administrar TODOS los espacios de la persona: así nadie toma una
    // cuenta que también tiene acceso a espacios ajenos.
    for (const m of memberships) {
      const callerRole = await getRole(m.workspace_id, caller.id);
      if (callerRole !== "owner" && callerRole !== "admin") {
        throw new HttpError(403, "Esa persona también trabaja en otros espacios: solo un administrador de la plataforma puede resetear su contraseña.");
      }
      if (m.role === "owner" && callerRole !== "owner") {
        throw new HttpError(403, "Solo un propietario puede resetear la contraseña de otro propietario.");
      }
    }
  }

  const tempPassword = body.password ? password(body.password) : generatePassword();
  await setPassword(targetId, tempPassword, true);
  return { email: target.email, temp_password: tempPassword };
}

async function completePasswordChange(caller: Caller, body: Record<string, unknown>) {
  const temp = password(body.temp_password, "contraseña temporal");
  const next = password(body.new_password, "contraseña nueva");
  if (temp === next) throw new HttpError(400, "La contraseña nueva tiene que ser distinta de la temporal.");
  const profile = await getProfile(caller.id);
  if (!profile?.must_change_password) throw new HttpError(400, "Tu contraseña no necesita cambiarse.");
  if (!(await verifyPassword(caller.email, temp))) throw new HttpError(400, "La contraseña temporal no es correcta.");
  await setPassword(caller.id, next, false);
  return { done: true };
}

async function changePassword(caller: Caller, body: Record<string, unknown>) {
  const current = password(body.current_password, "contraseña actual");
  const next = password(body.new_password, "contraseña nueva");
  if (current === next) throw new HttpError(400, "La contraseña nueva tiene que ser distinta de la actual.");
  if (!(await verifyPassword(caller.email, current))) throw new HttpError(400, "La contraseña actual no es correcta.");
  await setPassword(caller.id, next, false);
  return { done: true };
}

// ---------------------------------------------------------------- servidor
type Caller = { id: string; email: string; isPlatformAdmin: boolean };

async function authenticate(req: Request): Promise<Caller> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new HttpError(401, "Tu sesión venció. Volvé a iniciar sesión.");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user?.email) throw new HttpError(401, "Tu sesión venció. Volvé a iniciar sesión.");
  const profile = await getProfile(data.user.id);
  return { id: data.user.id, email: data.user.email, isPlatformAdmin: Boolean(profile?.is_platform_admin) };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "Método no permitido." });
  if (!SECRET_KEY || !PUBLIC_KEY) return json(500, { ok: false, error: "La función no está configurada." });

  try {
    const caller = await authenticate(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    let data: unknown;
    switch (body.action) {
      case "create_user":
        data = await createUser(caller, body);
        break;
      case "reset_password":
        data = await resetPassword(caller, body);
        break;
      case "complete_password_change":
        data = await completePasswordChange(caller, body);
        break;
      case "change_password":
        data = await changePassword(caller, body);
        break;
      default:
        throw new HttpError(400, "Acción desconocida.");
    }
    return json(200, { ok: true, data });
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { ok: false, error: err.message });
    console.error("vetta-admin error", err instanceof Error ? err.message : err);
    return json(500, { ok: false, error: "Ocurrió un error inesperado." });
  }
});
