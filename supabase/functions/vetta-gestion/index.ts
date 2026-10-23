// =============================================================================
// Vetta · función de administración de cuentas (Supabase Edge Function)
// -----------------------------------------------------------------------------
// Crea usuarios y gestiona contraseñas SIN enviar emails. Es el único lugar que
// usa la clave secreta de Supabase, que nunca sale del servidor. Cada acción
// verifica quién la pide y qué rol tiene antes de hacer nada.
//
// Acciones (POST JSON { action, ... } con Authorization: Bearer <token del usuario>):
//   create_user               Alta de una persona en una empresa, con sus tableros.
//   update_user               Cambia nombre y/o email de una persona.
//   set_user_active           Desactiva o reactiva una cuenta.
//   reset_password            Asigna una contraseña temporal a otra persona.
//   complete_password_change  La persona reemplaza su contraseña temporal.
//   change_password           La persona cambia su contraseña (pide la actual).
//   create_company            (superadmin) Alta de empresa + su administrador.
//   list_companies            (superadmin) Empresas con usuarios y tableros.
//   update_company            (superadmin) Renombrar una empresa.
//   join_company              (superadmin) Sumarse como administrador a una empresa.
// =============================================================================
// Import directo (sin mapa de imports) para que el despliegue no dependa de deno.json.
import { createClient } from "npm:@supabase/supabase-js@2";

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
    .select("id, email, full_name, is_platform_admin, must_change_password, deactivated_at")
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

// ---------------------------------------------------------------- permisos
function requireActive(caller: Caller) {
  if (!caller.active) throw new HttpError(403, "Tu cuenta no puede hacer esta acción.");
}

function requirePlatformAdmin(caller: Caller) {
  requireActive(caller);
  if (!caller.isPlatformAdmin) throw new HttpError(403, "Solo el superadministrador puede hacer esto.");
}

/**
 * Para administrar a otra persona hay que administrar TODAS sus empresas: así
 * nadie toma una cuenta que también tiene acceso a empresas ajenas.
 */
async function assertCanManageUser(caller: Caller, targetId: string) {
  requireActive(caller);
  const target = await getProfile(targetId);
  if (!target) throw new HttpError(404, "La persona no existe.");
  if (caller.isPlatformAdmin) return target;
  if (target.is_platform_admin) throw new HttpError(403, "No podés modificar al superadministrador.");
  const { data: memberships, error } = await admin.from("workspace_members").select("workspace_id, role").eq("user_id", targetId);
  if (error) throw new HttpError(500, "No se pudieron leer los permisos.");
  if (!memberships?.length) throw new HttpError(403, "No tenés permiso sobre esa persona.");
  for (const m of memberships) {
    const callerRole = await getRole(m.workspace_id, caller.id);
    if (callerRole !== "owner" && callerRole !== "admin") {
      throw new HttpError(403, "Esa persona también trabaja en otras empresas: solo el superadministrador puede modificarla.");
    }
    if (m.role === "owner" && callerRole !== "owner") {
      throw new HttpError(403, "Solo el administrador principal puede modificar a otro administrador principal.");
    }
  }
  return target;
}

function emailOf(v: unknown) {
  const email = str(v, "email", { max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, "Ingresá un email válido.");
  return email;
}

/** Da acceso a tableros de la empresa (ignora los que no son de esa empresa). */
async function grantBoards(workspaceId: string, userId: string, raw: unknown) {
  if (!Array.isArray(raw) || raw.length === 0) return;
  const ids = raw.filter((x): x is string => typeof x === "string" && UUID_RE.test(x)).slice(0, 500);
  if (!ids.length) return;
  const { data: boards } = await admin.from("boards").select("id").eq("workspace_id", workspaceId).in("id", ids);
  const rows = (boards ?? []).map((b) => ({ board_id: b.id, user_id: userId }));
  if (rows.length) await admin.from("board_members").upsert(rows, { onConflict: "board_id,user_id", ignoreDuplicates: true });
}

/** Crea la cuenta (o reutiliza una existente) y la suma a la empresa. */
async function provisionMember(
  callerId: string,
  workspaceId: string,
  input: { email: string; fullName: string; role: Role; password?: unknown; boards?: unknown },
) {
  const { data: existing } = await admin.from("profiles").select("id").eq("email", input.email).maybeSingle();
  if (existing) {
    const currentRole = await getRole(workspaceId, existing.id);
    if (currentRole) throw new HttpError(409, "Esa persona ya es miembro de la empresa.");
    const { error } = await admin.from("workspace_members").insert({ workspace_id: workspaceId, user_id: existing.id, role: input.role });
    if (error) throw new HttpError(500, "No se pudo sumar a la persona a la empresa.");
    await grantBoards(workspaceId, existing.id, input.boards);
    return { existing: true, email: input.email, user_id: existing.id };
  }

  const tempPassword = input.password ? password(input.password) : generatePassword();
  const { data: token, error: tErr } = await admin.rpc("admin_issue_provision_token");
  if (tErr || !token) throw new HttpError(500, "No se pudo preparar el alta.");

  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email: input.email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: input.fullName, vetta_provision_token: token },
    app_metadata: { vetta_provisioned: true },
  });
  if (cErr || !created?.user) {
    if (cErr && /already|registered|exists/i.test(cErr.message)) throw new HttpError(409, "Ya existe una cuenta con ese email.");
    if (cErr && /password/i.test(cErr.message)) throw new HttpError(400, "La contraseña no cumple los requisitos de seguridad.");
    throw new HttpError(500, "No se pudo crear la cuenta.");
  }
  const userId = created.user.id;

  const { error: pErr } = await admin
    .from("profiles")
    .update({ must_change_password: true, created_by: callerId, full_name: input.fullName })
    .eq("id", userId);
  const { error: mErr } = pErr
    ? { error: pErr }
    : await admin.from("workspace_members").insert({ workspace_id: workspaceId, user_id: userId, role: input.role });
  if (pErr || mErr) {
    // Deshacer el alta para no dejar cuentas a medias.
    await admin.auth.admin.deleteUser(userId);
    throw new HttpError(500, "No se pudo completar el alta. Probá de nuevo.");
  }
  await grantBoards(workspaceId, userId, input.boards);
  return { existing: false, email: input.email, user_id: userId, temp_password: tempPassword };
}

// ---------------------------------------------------------------- acciones
async function createUser(caller: Caller, body: Record<string, unknown>) {
  requireActive(caller);
  const workspaceId = uuid(body.workspace_id, "empresa");
  const email = emailOf(body.email);
  const fullName = str(body.full_name, "nombre", { max: 120 });
  const role: Role = body.role === "owner" ? "owner" : body.role === "admin" ? "admin" : "member";

  const callerRole = await getRole(workspaceId, caller.id);
  const canManage = caller.isPlatformAdmin || callerRole === "owner" || callerRole === "admin";
  if (!canManage) throw new HttpError(403, "Solo los administradores pueden agregar personas.");
  if (role === "owner" && !(caller.isPlatformAdmin || callerRole === "owner")) {
    throw new HttpError(403, "Solo el administrador principal puede sumar a otro administrador principal.");
  }
  const { data: ws } = await admin.from("workspaces").select("id").eq("id", workspaceId).maybeSingle();
  if (!ws) throw new HttpError(404, "La empresa no existe.");

  return await provisionMember(caller.id, workspaceId, { email, fullName, role, password: body.password, boards: body.board_ids });
}

async function updateUser(caller: Caller, body: Record<string, unknown>) {
  const targetId = uuid(body.user_id, "usuario");
  const target = targetId === caller.id ? await getProfile(targetId) : await assertCanManageUser(caller, targetId);
  if (!target) throw new HttpError(404, "La persona no existe.");
  if (targetId === caller.id) requireActive(caller);

  const fullName = body.full_name !== undefined ? str(body.full_name, "nombre", { max: 120 }) : undefined;
  const email = body.email !== undefined ? emailOf(body.email) : undefined;

  if (email && email !== (target.email ?? "").toLowerCase()) {
    const { data: taken } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
    if (taken && taken.id !== targetId) throw new HttpError(409, "Ya existe otra cuenta con ese email.");
    const { error } = await admin.auth.admin.updateUserById(targetId, { email, email_confirm: true });
    if (error) {
      if (/already|registered|exists/i.test(error.message)) throw new HttpError(409, "Ya existe otra cuenta con ese email.");
      throw new HttpError(500, "No se pudo cambiar el email.");
    }
    // El perfil se sincroniza solo, pero se actualiza también por las dudas.
    await admin.from("profiles").update({ email }).eq("id", targetId);
  }
  if (fullName !== undefined) {
    const { error } = await admin.from("profiles").update({ full_name: fullName }).eq("id", targetId);
    if (error) throw new HttpError(500, "No se pudo cambiar el nombre.");
    await admin.auth.admin.updateUserById(targetId, { user_metadata: { full_name: fullName } });
  }
  return { user_id: targetId, email: email ?? target.email, full_name: fullName ?? target.full_name };
}

async function setUserActive(caller: Caller, body: Record<string, unknown>) {
  const targetId = uuid(body.user_id, "usuario");
  if (targetId === caller.id) throw new HttpError(400, "No podés desactivar tu propia cuenta.");
  await assertCanManageUser(caller, targetId);
  const active = body.active === true;
  const { error } = await admin.auth.admin.updateUserById(targetId, { ban_duration: active ? "none" : "876000h" });
  if (error) throw new HttpError(500, "No se pudo cambiar el estado de la cuenta.");
  const { error: pErr } = await admin
    .from("profiles")
    .update({ deactivated_at: active ? null : new Date().toISOString() })
    .eq("id", targetId);
  if (pErr) throw new HttpError(500, "No se pudo registrar el cambio.");
  return { user_id: targetId, active };
}

async function createCompany(caller: Caller, body: Record<string, unknown>) {
  requirePlatformAdmin(caller);
  const name = str(body.name, "nombre de la empresa", { max: 80 });
  const email = emailOf(body.admin_email);
  const fullName = str(body.admin_full_name, "nombre del administrador", { max: 120 });

  const { data: ws, error } = await admin.from("workspaces").insert({ name }).select("id").single();
  if (error || !ws) throw new HttpError(500, "No se pudo crear la empresa.");
  try {
    const member = await provisionMember(caller.id, ws.id, { email, fullName, role: "owner", password: body.admin_password });
    return { workspace_id: ws.id, name, admin: member };
  } catch (err) {
    // Sin administrador no hay empresa: se deshace el alta.
    await admin.from("workspaces").delete().eq("id", ws.id);
    throw err;
  }
}

async function listCompanies(caller: Caller) {
  requirePlatformAdmin(caller);
  const [{ data: workspaces }, { data: members }, { data: boards }] = await Promise.all([
    admin.from("workspaces").select("id, name, created_at").order("name"),
    admin.from("workspace_members").select("workspace_id, user_id, role, profiles(full_name, email, deactivated_at, must_change_password)"),
    admin.from("boards").select("workspace_id, is_archived"),
  ]);
  return (workspaces ?? []).map((w) => {
    const people = (members ?? []).filter((m) => m.workspace_id === w.id);
    return {
      id: w.id,
      name: w.name,
      created_at: w.created_at,
      boards: (boards ?? []).filter((b) => b.workspace_id === w.id && !b.is_archived).length,
      users: people.length,
      is_member: people.some((m) => m.user_id === caller.id),
      admins: people
        .filter((m) => m.role === "owner" || m.role === "admin")
        .map((m) => {
          const p = m.profiles as unknown as { full_name: string | null; email: string | null; deactivated_at: string | null } | null;
          return { user_id: m.user_id, role: m.role, full_name: p?.full_name ?? null, email: p?.email ?? null, active: !p?.deactivated_at };
        }),
    };
  });
}

async function updateCompany(caller: Caller, body: Record<string, unknown>) {
  requirePlatformAdmin(caller);
  const workspaceId = uuid(body.workspace_id, "empresa");
  const name = str(body.name, "nombre de la empresa", { max: 80 });
  const { data, error } = await admin.from("workspaces").update({ name }).eq("id", workspaceId).select("id");
  if (error || !data?.length) throw new HttpError(500, "No se pudo renombrar la empresa.");
  return { workspace_id: workspaceId, name };
}

async function joinCompany(caller: Caller, body: Record<string, unknown>) {
  requirePlatformAdmin(caller);
  const workspaceId = uuid(body.workspace_id, "empresa");
  const { error } = await admin
    .from("workspace_members")
    .upsert({ workspace_id: workspaceId, user_id: caller.id, role: "owner" }, { onConflict: "workspace_id,user_id" });
  if (error) throw new HttpError(500, "No se pudo sumar a la empresa.");
  return { workspace_id: workspaceId };
}

async function resetPassword(caller: Caller, body: Record<string, unknown>) {
  const targetId = uuid(body.user_id, "usuario");
  if (targetId === caller.id) throw new HttpError(400, "Para cambiar tu propia contraseña usá Mi cuenta.");
  const target = await assertCanManageUser(caller, targetId);
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
type Caller = { id: string; email: string; isPlatformAdmin: boolean; active: boolean };

async function authenticate(req: Request): Promise<Caller> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new HttpError(401, "Tu sesión venció. Volvé a iniciar sesión.");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user?.email) throw new HttpError(401, "Tu sesión venció. Volvé a iniciar sesión.");
  const profile = await getProfile(data.user.id);
  if (profile?.deactivated_at) throw new HttpError(403, "Tu cuenta está desactivada.");
  return {
    id: data.user.id,
    email: data.user.email,
    isPlatformAdmin: Boolean(profile?.is_platform_admin),
    active: Boolean(profile && !profile.must_change_password && !profile.deactivated_at),
  };
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
      case "update_user":
        data = await updateUser(caller, body);
        break;
      case "set_user_active":
        data = await setUserActive(caller, body);
        break;
      case "create_company":
        data = await createCompany(caller, body);
        break;
      case "list_companies":
        data = await listCompanies(caller);
        break;
      case "update_company":
        data = await updateCompany(caller, body);
        break;
      case "join_company":
        data = await joinCompany(caller, body);
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
