// =============================================================================
// Vetta · reglas con IA (Supabase Edge Function)
// -----------------------------------------------------------------------------
// Recibe un pedido en lenguaje natural ("cuando pase a Listo, avisale a Jorge")
// y devuelve una PROPUESTA de regla con la estructura del motor de Vetta. No
// guarda nada: la persona la revisa en el editor de reglas y la guarda ella.
//
// Seguridad:
//   * El token de DeepSeek de cada empresa está en Supabase Vault y solo se lee
//     acá, con la clave de servicio. Nunca se devuelve ni se registra.
//   * Verifica la sesión y que la persona pueda administrar el tablero.
//   * Al modelo solo se le manda la estructura del tablero (columnas, estados,
//     carpetas, tableros y nombres de personas), nunca el contenido de los ítems.
//   * Límite de pedidos por día y por empresa, y registro de cada pedido.
//
// POST JSON { boardId, prompt } con Authorization: Bearer <token del usuario>
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

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
const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// ---------------------------------------------------------------- catálogo
const SPEC = `
Una regla tiene: disparador (cuándo), condiciones opcionales (si…) y UNA acción (entonces…).

DISPARADORES (trigger_type) y sus datos:
- "status_changed": trigger_status_id = estado al que pasa (o null = cualquier cambio). trigger_config.from_status_id opcional (estado de origen).
- "group_changed": trigger_group_id = carpeta a la que entra.
- "item_arrived": llega un ítem nuevo al tablero; trigger_group_id opcional (carpeta).
- "assignee_changed": trigger_config.user_id opcional (a quién se asigna).
- "priority_changed": trigger_config.priority opcional: "low" | "medium" | "high" | "urgent".
- "column_changed": trigger_config.column_id (obligatorio) y trigger_config.value opcional (para columnas de etiqueta, el id de la opción; para casilla "true"/"false"; si no, texto).
- "checklist_changed": cuando se tildan pasos de un checklist. trigger_config.column_id opcional (id de la columna checklist; vacío = cualquier checklist del tablero) y trigger_config.event:
    "started" = se tilda el primer paso (el checklist arranca; útil para "cuando se marca el primer ítem del checklist pasar a En curso"),
    "any_checked" = se tilda cualquier paso,
    "step_checked" = se tilda un paso puntual: trigger_config.step = texto exacto del paso, o trigger_config.step_index = número de paso (1 = el primero),
    "percent" = el avance llega a trigger_config.percent (1-100),
    "completed" = se completan todos los pasos.
- "date_arrives": trigger_config.date_field = "due_date" (vencimiento) o el id de una columna de fecha; trigger_config.offset_days (negativo = días antes, positivo = días después, 0 = el día); trigger_config.hour (0-23, por defecto 8).
- "stale": trigger_config.days (días sin cambiar de estado), trigger_config.hour, trigger_config.status_id opcional.
- "schedule": trigger_config.freq "daily" | "weekdays" | "weekly" | "monthly", trigger_config.hour, trigger_config.weekday (1=lunes…7=domingo, si weekly), trigger_config.monthday (1-31, si monthly).

CONDICIONES (conditions, lista, todas deben cumplirse): { field, op, value?, column_id? }
- field: "status" | "group" | "priority" | "assignee" | "done" | "due_date" | "column"
- op: "is" | "is_not" | "empty" | "not_empty" | "overdue" | "within_days" | "contains" | "gt" | "lt"
- value: id del estado / carpeta / persona, prioridad ("low"...), "true"/"false" para done, número de días para within_days, o el valor para columnas.
- field "column" requiere column_id.

ACCIONES (action_type) y action_config:
- "set_status": action_config.status_id
- "set_group": action_config.group_id
- "set_priority": action_config.priority
- "set_assignee": action_config.mode "user" (con user_id) | "creator" | "clear"
- "set_due_date": action_config.mode "offset" (con days = hoy + días) | "clear"
- "set_column": action_config.column_id y mode "value" (con value) | "offset" (solo fechas, con days) | "clear". Para columnas de etiqueta value = id de la opción.
- "add_comment": action_config.text (puede usar {titulo}, {tablero}, {carpeta}, {estado}, {vencimiento}, {responsable}, {hoy})
- "notify": action_config.to "assignee" | "creator" | "user" (con user_id) | "admins"; action_config.message opcional (mismas variables).
- "create_item": action_config.title, y opcionales group_id, status_id, priority, due_days, assignee_id. target_board_id = tablero donde se crea.
- "copy" | "move": copiar / mover el ítem a target_board_id, con target_group_id y target_status_id opcionales. copy_fields opcional: ["description","priority","assignee","due_date","status"].
- "update_linked": cambia el ítem vinculado (link_direction "origin" = el original del que vino esta copia, "copies" = sus copias) a target_status_id y/o target_group_id del tablero target_board_id.
`;

type Ctx = {
  board: { id: string; name: string };
  statuses: { id: string; label: string; done: boolean }[];
  groups: { id: string; name: string }[];
  columns: { id: string; name: string; kind: string; options?: { id: string; label: string }[] }[];
  checklists: { id: string; name: string }[];
  boards: { id: string; name: string; statuses: { id: string; label: string }[]; groups: { id: string; name: string }[] }[];
  people: { id: string; name: string }[];
};

function systemPrompt(ctx: Ctx) {
  return `Sos el asistente de reglas automáticas de Vetta, una plataforma de gestión de tareas parecida a Monday.
Tu trabajo: convertir el pedido de la persona en UNA regla del motor de Vetta.

${SPEC}

DATOS DEL TABLERO "${ctx.board.name}" (id ${ctx.board.id}). Usá SOLO estos ids, nunca inventes:
${JSON.stringify({ estados: ctx.statuses, carpetas: ctx.groups, columnas: ctx.columns, checklists: ctx.checklists, otros_tableros: ctx.boards, personas: ctx.people })}

Respondé SOLO un objeto JSON, sin texto extra, con UNA de estas dos formas:
1) Si se puede armar la regla:
{"ok": true, "rule": {"name": "nombre corto (máx 80)", "trigger_type": "...", "trigger_status_id": null, "trigger_group_id": null, "trigger_config": {}, "conditions": [], "action_type": "...", "action_config": {}, "target_board_id": "${ctx.board.id}", "target_group_id": null, "target_status_id": null, "link_direction": null, "copy_fields": []}, "explanation": "una oración en español rioplatense explicando qué hace"}
2) Si falta un dato o el pedido es ambiguo (por ejemplo, hay dos estados parecidos o una persona que no existe) o el motor no puede hacerlo:
{"ok": false, "question": "pregunta corta en español rioplatense para aclarar, o explicación de por qué no se puede"}

Interpretá con buena fe lo que la persona quiere decir (por ejemplo "marcar como ok el primer checklist" = tildar el primer paso del checklist) y armá la regla si el motor lo permite; preguntá solo si de verdad falta un dato.
Reglas: una sola acción por regla (si piden varias, armá la primera y aclaralo en explanation). No uses ids que no estén en los datos. Las fechas y horas son de Argentina.`;
}

async function authenticate(req: Request) {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new HttpError(401, "Tu sesión venció. Volvé a iniciar sesión.");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Tu sesión venció. Volvé a iniciar sesión.");
  const { data: profile } = await admin.from("profiles").select("is_platform_admin, deactivated_at").eq("id", data.user.id).maybeSingle();
  if (profile?.deactivated_at) throw new HttpError(403, "Tu cuenta está desactivada.");
  return { id: data.user.id, isPlatformAdmin: Boolean(profile?.is_platform_admin) };
}

async function loadContext(boardId: string, workspaceId: string): Promise<Ctx> {
  const [{ data: board }, { data: boards }, { data: columns }, { data: members }] = await Promise.all([
    admin.from("boards").select("id, name").eq("id", boardId).single(),
    admin.from("boards").select("id, name").eq("workspace_id", workspaceId).eq("is_archived", false),
    admin.from("board_columns").select("id, name, kind, options, position").eq("board_id", boardId).order("position"),
    admin.from("workspace_members").select("user_id").eq("workspace_id", workspaceId),
  ]);
  const ids = [...new Set([boardId, ...(boards ?? []).map((b) => b.id)])];
  const userIds = (members ?? []).map((m) => m.user_id);
  const [{ data: statuses }, { data: groups }, { data: profiles }] = await Promise.all([
    admin.from("board_statuses").select("id, board_id, label, is_done, position").in("board_id", ids).order("position"),
    admin.from("board_groups").select("id, board_id, name, position").in("board_id", ids).order("position"),
    userIds.length ? admin.from("profiles").select("id, full_name, email, is_platform_admin").in("id", userIds) : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string | null; is_platform_admin: boolean }[] }),
  ]);
  const st = statuses ?? [];
  const gr = groups ?? [];
  return {
    board: board!,
    statuses: st.filter((s) => s.board_id === boardId).map((s) => ({ id: s.id, label: s.label, done: s.is_done })),
    groups: gr.filter((g) => g.board_id === boardId).map((g) => ({ id: g.id, name: g.name })),
    columns: (columns ?? [])
      .filter((c) => !["formula", "item_id", "created_log", "updated_log", "mirror", "files", "checklist"].includes(c.kind))
      .map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        ...(Array.isArray(c.options) && c.options.length ? { options: (c.options as { id: string; label: string }[]).map((o) => ({ id: o.id, label: o.label })) } : {}),
      })),
    checklists: (columns ?? []).filter((c) => c.kind === "checklist").map((c) => ({ id: c.id, name: c.name })),
    boards: (boards ?? [])
      .filter((b) => b.id !== boardId)
      .map((b) => ({
        id: b.id,
        name: b.name,
        statuses: st.filter((s) => s.board_id === b.id).map((s) => ({ id: s.id, label: s.label })),
        groups: gr.filter((g) => g.board_id === b.id).map((g) => ({ id: g.id, name: g.name })),
      })),
    // El superadministrador es invisible para las empresas: no se ofrece como persona.
    people: (profiles ?? []).filter((p) => !p.is_platform_admin).map((p) => ({ id: p.id, name: p.full_name?.trim() || p.email || "Sin nombre" })),
  };
}

async function suggest(callerId: string, isPlatformAdmin: boolean, body: Record<string, unknown>) {
  const boardId = String(body.boardId ?? "");
  const prompt = String(body.prompt ?? "").trim();
  if (!UUID_RE.test(boardId)) throw new HttpError(400, "Tablero inválido.");
  if (prompt.length < 5) throw new HttpError(400, "Contá qué querés que haga la regla.");
  if (prompt.length > 1500) throw new HttpError(400, "El pedido puede tener hasta 1500 caracteres.");

  const { data: board } = await admin.from("boards").select("id, workspace_id, created_by, is_archived").eq("id", boardId).maybeSingle();
  if (!board) throw new HttpError(404, "El tablero no existe.");
  if (board.is_archived) throw new HttpError(400, "El tablero está archivado.");
  const { data: member } = await admin.from("workspace_members").select("role").eq("workspace_id", board.workspace_id).eq("user_id", callerId).maybeSingle();
  const canManage = isPlatformAdmin || (Boolean(member) && (board.created_by === callerId || member?.role === "owner" || member?.role === "admin"));
  if (!canManage) throw new HttpError(403, "Solo quien administra el tablero puede crear reglas.");

  const { data: settings } = await admin.from("workspace_ai_settings").select("model, daily_limit").eq("workspace_id", board.workspace_id).maybeSingle();
  const { data: key } = await admin.rpc("workspace_ai_key", { p_workspace: board.workspace_id });
  if (!settings || !key) throw new HttpError(409, "Esta empresa todavía no tiene cargado el token de DeepSeek (Ajustes de la empresa).");

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await admin.from("ai_requests").select("id", { count: "exact", head: true }).eq("workspace_id", board.workspace_id).gte("created_at", since);
  if ((count ?? 0) >= settings.daily_limit) throw new HttpError(429, `La empresa llegó al límite de ${settings.daily_limit} pedidos a la IA en 24 horas.`);

  const ctx = await loadContext(boardId, board.workspace_id);
  const log = async (ok: boolean, result: unknown, error: string | null) => {
    await admin.from("ai_requests").insert({ workspace_id: board.workspace_id, board_id: boardId, user_id: callerId, prompt: prompt.slice(0, 2000), ok, result, error });
  };

  let content = "";
  try {
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: settings.model || "deepseek-chat",
        temperature: 0,
        max_tokens: 1500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt(ctx) },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (res.status === 401 || res.status === 403) {
      await log(false, null, `deepseek ${res.status}`);
      throw new HttpError(502, "DeepSeek rechazó el token de esta empresa. Revisalo en Ajustes de la empresa.");
    }
    if (res.status === 402) {
      await log(false, null, "deepseek 402");
      throw new HttpError(502, "La cuenta de DeepSeek de esta empresa no tiene saldo.");
    }
    if (!res.ok) {
      await log(false, null, `deepseek ${res.status}`);
      throw new HttpError(502, "DeepSeek no respondió bien. Probá de nuevo en un rato.");
    }
    const data = await res.json();
    content = String(data?.choices?.[0]?.message?.content ?? "");
  } catch (e) {
    if (e instanceof HttpError) throw e;
    await log(false, null, "sin respuesta");
    throw new HttpError(504, "DeepSeek tardó demasiado en responder. Probá de nuevo.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    await log(false, null, "respuesta no JSON");
    throw new HttpError(502, "La IA respondió algo que no se pudo interpretar. Probá reformular el pedido.");
  }
  await log(true, parsed, null);
  return parsed;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "Método no permitido." });
  if (!SECRET_KEY) return json(500, { ok: false, error: "La función no está configurada." });
  try {
    const caller = await authenticate(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const data = await suggest(caller.id, caller.isPlatformAdmin, body);
    return json(200, { ok: true, data });
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { ok: false, error: e.message });
    console.error("vetta-ia-reglas", e instanceof Error ? e.message : "error");
    return json(500, { ok: false, error: "No se pudo completar el pedido." });
  }
});
