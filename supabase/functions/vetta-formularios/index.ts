// =============================================================================
// Vetta · formularios públicos (Supabase Edge Function)
// -----------------------------------------------------------------------------
// Es la única puerta de entrada de quien responde un formulario (que puede no
// tener cuenta). Usa la clave de servicio, por eso valida TODO acá:
//   * el formulario existe, está publicado, abierto y con cupo;
//   * el acceso (público, solo usuarios de la empresa o con contraseña);
//   * cada respuesta contra la configuración guardada (no contra lo que mande
//     el navegador), con la misma lógica de condiciones que la página;
//   * antispam: campo trampa, tiempo mínimo y límite de envíos por IP (la IP
//     se guarda solo como hash).
// Acciones (POST JSON):
//   { action: "get", slug, password? }                → definición pública
//   { action: "upload", slug, password?, question, name, size, type }
//                                                     → URL firmada para subir un archivo
//   { action: "submit", slug, password?, answers, startedAt, website }
//                                                     → crea el elemento
//   { action: "track", token }                        → estado del pedido
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkAll, answerText, initialValue, isInput, MAX_FILE_BYTES, type FileAnswer, type FormConfig, type InputSpec, type Option, type Question } from "./form-logic.ts";

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
const BUCKET = "vetta-files";

const ALLOWED_ORIGINS = new Set(["https://vettaapp.vercel.app", "https://vetta-trazabilidad.vercel.app", "http://localhost:3000", "http://localhost:3123"]);

class HttpError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

function cors(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  const ok = ALLOWED_ORIGINS.has(origin) || /^https:\/\/vetta-[a-z0-9-]+\.vercel\.app$/.test(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : "https://vettaapp.vercel.app",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    Vary: "Origin",
  };
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(bytes = 24) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const PRIORITIES: Option[] = [
  { value: "low", label: "Baja", color: "gray" },
  { value: "medium", label: "Media", color: "blue" },
  { value: "high", label: "Alta", color: "orange" },
  { value: "urgent", label: "Urgente", color: "red" },
];

type Form = {
  id: string;
  workspace_id: string;
  board_id: string;
  name: string;
  slug: string;
  is_published: boolean;
  access: "public" | "members" | "password";
  opens_at: string | null;
  closes_at: string | null;
  max_responses: number | null;
  config: FormConfig;
};

type Column = { id: string; name: string; kind: string; options: { id: string; label: string; color?: string }[]; settings: Record<string, unknown> };
type BoardInfo = {
  columns: Column[];
  statuses: { id: string; label: string; color: string | null; is_done: boolean }[];
  groups: { id: string; name: string }[];
  members: { id: string; name: string }[];
};

/* ------------------------------------------------------------------ carga */

function cleanConfig(raw: unknown): FormConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Partial<FormConfig>;
  return {
    title: String(c.title ?? "Formulario").slice(0, 200),
    description: c.description ? String(c.description).slice(0, 5000) : undefined,
    questions: Array.isArray(c.questions) ? (c.questions as Question[]).slice(0, 200) : [],
    design: { accent: "blue", cover: "none", layout: "classic", theme: "auto", ...(c.design ?? {}) } as FormConfig["design"],
    destination: (c.destination ?? {}) as FormConfig["destination"],
    after: { allowAnother: true, tracking: true, showSummary: true, ...(c.after ?? {}) } as FormConfig["after"],
    notify: Array.isArray(c.notify) ? c.notify.map(String).slice(0, 50) : [],
  };
}

async function loadForm(slug: unknown): Promise<Form> {
  if (typeof slug !== "string" || !/^[A-Za-z0-9]{8,32}$/.test(slug)) throw new HttpError(404, "Este formulario no existe.");
  const { data } = await admin.from("board_forms").select("id, workspace_id, board_id, name, slug, is_published, access, opens_at, closes_at, max_responses, config").eq("slug", slug).maybeSingle();
  if (!data) throw new HttpError(404, "Este formulario no existe.");
  if (!data.is_published) throw new HttpError(404, "Este formulario no está disponible por ahora.");
  const { data: board } = await admin.from("boards").select("is_archived").eq("id", data.board_id).maybeSingle();
  if (!board || board.is_archived) throw new HttpError(404, "Este formulario no está disponible por ahora.");
  return { ...(data as Omit<Form, "config">), config: cleanConfig(data.config) };
}

async function loadBoard(form: Form): Promise<BoardInfo> {
  const [cols, statuses, groups, members] = await Promise.all([
    admin.from("board_columns").select("id, name, kind, options, settings").eq("board_id", form.board_id),
    admin.from("board_statuses").select("id, label, color, is_done, position").eq("board_id", form.board_id).order("position"),
    admin.from("board_groups").select("id, name, position").eq("board_id", form.board_id).order("position"),
    admin.from("workspace_members").select("user_id").eq("workspace_id", form.workspace_id),
  ]);
  const ids = (members.data ?? []).map((m) => m.user_id);
  const { data: profiles } = ids.length
    ? await admin.from("profiles").select("id, full_name, email, is_platform_admin, deactivated_at").in("id", ids)
    : { data: [] as { id: string; full_name: string | null; email: string | null; is_platform_admin: boolean; deactivated_at: string | null }[] };
  return {
    columns: (cols.data ?? []).map((c) => ({ ...c, options: Array.isArray(c.options) ? c.options : [], settings: (c.settings ?? {}) as Record<string, unknown> })) as Column[],
    statuses: statuses.data ?? [],
    groups: groups.data ?? [],
    members: (profiles ?? []).filter((p) => !p.is_platform_admin && !p.deactivated_at).map((p) => ({ id: p.id, name: p.full_name?.trim() || p.email || "Sin nombre" })),
  };
}

/** Cómo se muestra y valida cada pregunta según el tablero. Las que no aplican, no tienen spec. */
function buildSpecs(form: Form, b: BoardInfo): Record<string, InputSpec> {
  const specs: Record<string, InputSpec> = {};
  const filter = (q: Question, opts: Option[]) => (q.allowed?.length ? opts.filter((o) => q.allowed!.includes(o.value)) : opts);
  // Personas: en formularios públicos solo se muestran las elegidas a propósito.
  const people = (q: Question) => (form.access === "public" && !q.allowed?.length ? [] : filter(q, b.members.map((m) => ({ value: m.id, label: m.name }))));
  for (const q of form.config.questions) {
    if (q.kind === "free") {
      const t = q.freeType ?? "short";
      specs[q.id] =
        t === "choice" || t === "multi"
          ? { type: t, options: (q.options ?? []).slice(0, 100).map((o) => ({ value: o, label: o })) }
          : t === "rating"
            ? { type: "rating", max: Math.min(10, Math.max(3, q.max ?? 5)) }
            : { type: t };
      continue;
    }
    if (q.kind !== "field" || !q.target) continue;
    switch (q.target) {
      case "title":
        specs[q.id] = { type: "short" };
        break;
      case "description":
        specs[q.id] = { type: "long" };
        break;
      case "due_date":
        specs[q.id] = { type: "date" };
        break;
      case "priority":
        specs[q.id] = { type: "choice", options: filter(q, PRIORITIES) };
        break;
      case "status":
        specs[q.id] = { type: "choice", options: filter(q, b.statuses.map((s) => ({ value: s.id, label: s.label, color: s.color ?? undefined }))) };
        break;
      case "group":
        specs[q.id] = { type: "choice", options: filter(q, b.groups.map((g) => ({ value: g.id, label: g.name }))) };
        break;
      case "assignee": {
        const opts = people(q);
        if (opts.length) specs[q.id] = { type: "choice", options: opts };
        break;
      }
      default: {
        const col = b.columns.find((c) => `col:${c.id}` === q.target);
        if (!col) break;
        const labels = filter(q, col.options.map((o) => ({ value: o.id, label: o.label, color: o.color })));
        const map: Record<string, InputSpec | null> = {
          text: { type: "short" },
          long_text: { type: "long" },
          number: { type: "number" },
          date: { type: "date" },
          timeline: { type: "daterange" },
          email: { type: "email" },
          phone: { type: "phone" },
          link: { type: "url" },
          hour: { type: "hour" },
          list: { type: "choice", options: labels },
          tags: { type: "multi", options: labels },
          checkbox: { type: "checkbox" },
          rating: { type: "rating", max: Number(col.settings.max) || 5 },
          files: { type: "files" },
          person: people(q).length ? { type: "choice", options: people(q) } : null,
          people: people(q).length ? { type: "multi", options: people(q) } : null,
        };
        const spec = map[col.kind];
        if (spec) specs[q.id] = spec;
      }
    }
  }
  return specs;
}

/* ------------------------------------------------------------------ acceso */

async function caller(req: Request) {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || token.split(".").length !== 3) return null;
  const { data } = await admin.auth.getUser(token);
  return data.user?.id ?? null;
}

async function checkAccess(req: Request, form: Form, password: unknown): Promise<string | null> {
  const userId = await caller(req);
  if (form.access === "members") {
    if (!userId) throw new HttpError(401, "Este formulario es solo para usuarios de la empresa. Iniciá sesión para responderlo.", { needsLogin: true });
    const { data: m } = await admin.from("workspace_members").select("user_id").eq("workspace_id", form.workspace_id).eq("user_id", userId).maybeSingle();
    const { data: p } = await admin.from("profiles").select("is_platform_admin, deactivated_at").eq("id", userId).maybeSingle();
    if ((!m && !p?.is_platform_admin) || p?.deactivated_at) throw new HttpError(403, "Este formulario es solo para usuarios de la empresa.", { needsLogin: true });
  }
  if (form.access === "password") {
    if (typeof password !== "string" || !password) throw new HttpError(401, "Este formulario tiene contraseña.", { needsPassword: true });
    const { data: ok } = await admin.rpc("form_password_ok", { p_form: form.id, p_password: password.slice(0, 100) });
    if (!ok) throw new HttpError(401, "La contraseña no es correcta.", { needsPassword: true, wrongPassword: true });
  }
  return userId;
}

async function availability(form: Form): Promise<{ open: boolean; reason?: string }> {
  const now = Date.now();
  if (form.opens_at && Date.parse(form.opens_at) > now) return { open: false, reason: `Este formulario abre el ${new Date(form.opens_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "long", timeStyle: "short" })}.` };
  if (form.closes_at && Date.parse(form.closes_at) <= now) return { open: false, reason: "Este formulario ya cerró. Gracias por tu interés." };
  if (form.max_responses) {
    const { count } = await admin.from("form_submissions").select("id", { count: "exact", head: true }).eq("form_id", form.id);
    if ((count ?? 0) >= form.max_responses) return { open: false, reason: "Este formulario ya recibió todas las respuestas que esperaba." };
  }
  return { open: true };
}

function clientIp(req: Request) {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "desconocida";
}

/* ------------------------------------------------------------------ acciones */

async function getForm(req: Request, body: Record<string, unknown>) {
  const form = await loadForm(body.slug);
  const base = { id: form.id, slug: form.slug, title: form.config.title, design: form.config.design, access: form.access };
  try {
    await checkAccess(req, form, body.password);
  } catch (e) {
    if (e instanceof HttpError && (e.extra.needsLogin || e.extra.needsPassword)) return { locked: true, ...base, ...e.extra, message: e.message };
    throw e;
  }
  const avail = await availability(form);
  const board = await loadBoard(form);
  const specs = buildSpecs(form, board);
  // Solo se envían las preguntas que se pueden mostrar, sin datos internos (destino, avisos).
  const questions = form.config.questions.filter((q) => !isInput(q) || specs[q.id]);
  return {
    locked: false,
    ...base,
    description: form.config.description ?? null,
    questions,
    specs,
    open: avail.open,
    closedReason: avail.reason ?? null,
    after: { allowAnother: form.config.after.allowAnother, tracking: form.config.after.tracking, showSummary: form.config.after.showSummary },
  };
}

async function upload(req: Request, body: Record<string, unknown>) {
  const form = await loadForm(body.slug);
  await checkAccess(req, form, body.password);
  const avail = await availability(form);
  if (!avail.open) throw new HttpError(409, avail.reason ?? "El formulario no está abierto.");
  const board = await loadBoard(form);
  const specs = buildSpecs(form, board);
  const qid = String(body.question ?? "");
  if (specs[qid]?.type !== "files") throw new HttpError(400, "Esta pregunta no acepta archivos.");
  const size = Number(body.size);
  if (!Number.isFinite(size) || size <= 0) throw new HttpError(400, "Archivo vacío.");
  if (size > MAX_FILE_BYTES) throw new HttpError(413, "El archivo supera los 25 MB.");
  const ipHash = await sha256(`${clientIp(req)}|${form.id}|${SECRET_KEY.slice(-12)}`);
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from("form_uploads").select("id", { count: "exact", head: true }).eq("form_id", form.id).eq("ip_hash", ipHash).gte("created_at", since);
  if ((count ?? 0) >= 60) throw new HttpError(429, "Subiste demasiados archivos en poco tiempo. Probá más tarde.");

  const name = String(body.name ?? "archivo").replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 150) || "archivo";
  const safe = name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 100) || "archivo";
  const id = crypto.randomUUID();
  const path = `${form.workspace_id}/${form.board_id}/formularios/${form.id}/${id}/${safe}`;
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new HttpError(500, "No se pudo preparar la subida.");
  await admin.from("form_uploads").insert({ id, form_id: form.id, question_id: qid, path, name, size, type: String(body.type ?? "application/octet-stream").slice(0, 100), ip_hash: ipHash });
  return { upload: id, path, token: data.token };
}

async function submit(req: Request, body: Record<string, unknown>) {
  const form = await loadForm(body.slug);
  const userId = await checkAccess(req, form, body.password);
  const avail = await availability(form);
  if (!avail.open) throw new HttpError(409, avail.reason ?? "El formulario no está abierto.");

  // Antispam: el campo trampa ("website") lo completan solo los robots.
  if (typeof body.website === "string" && body.website.trim()) return { ok: true, tracking: null, message: form.config.after.message ?? null, summary: [] };
  const startedAt = Number(body.startedAt);
  const duration = Number.isFinite(startedAt) ? Date.now() - startedAt : null;
  if (duration !== null && duration < 2500) throw new HttpError(429, "Lo enviaste demasiado rápido. Revisá tus respuestas y probá de nuevo.");
  const ipHash = await sha256(`${clientIp(req)}|${form.id}|${SECRET_KEY.slice(-12)}`);
  const since = new Date(Date.now() - 3600_000).toISOString();
  const [{ count: byIp }, { count: total }] = await Promise.all([
    admin.from("form_submissions").select("id", { count: "exact", head: true }).eq("form_id", form.id).eq("ip_hash", ipHash).gte("created_at", since),
    admin.from("form_submissions").select("id", { count: "exact", head: true }).eq("form_id", form.id).gte("created_at", since),
  ]);
  if ((byIp ?? 0) >= 20) throw new HttpError(429, "Recibimos muchas respuestas desde tu conexión. Probá más tarde.");
  if ((total ?? 0) >= 1000) throw new HttpError(429, "El formulario está recibiendo demasiadas respuestas. Probá en unos minutos.");

  const board = await loadBoard(form);
  const specs = buildSpecs(form, board);
  const answers = body.answers && typeof body.answers === "object" && !Array.isArray(body.answers) ? (body.answers as Record<string, unknown>) : {};
  // Las preguntas ocultas sin parámetro de enlace siempre toman su valor por defecto
  // (no se pueden cambiar desde el navegador).
  for (const q of form.config.questions) {
    if (q.hidden && !q.param && specs[q.id]) answers[q.id] = initialValue(q, specs[q.id], {});
  }
  const { values, errors } = checkAll(form.config, specs, answers as never);
  if (Object.keys(errors).length) throw new HttpError(422, "Revisá las respuestas marcadas.", { errors });

  // Archivos: tienen que ser subidas de este formulario, de esta pregunta y sin usar.
  const fileRefs: Record<string, { id: string; name: string; path: string; size: number; type: string }[]> = {};
  for (const [qid, v] of Object.entries(values)) {
    if (specs[qid]?.type !== "files") continue;
    const list = v as FileAnswer[];
    const ids = list.map((f) => f.upload).filter((x) => /^[0-9a-f-]{36}$/.test(x));
    if (ids.length !== list.length) throw new HttpError(422, "Algún archivo no es válido.", { errors: { [qid]: "Volvé a subir los archivos." } });
    const { data: ups } = ids.length ? await admin.from("form_uploads").select("id, question_id, path, name, size, type, used").eq("form_id", form.id).in("id", ids) : { data: [] };
    if ((ups ?? []).length !== ids.length || (ups ?? []).some((u) => u.used || u.question_id !== qid)) {
      throw new HttpError(422, "Algún archivo no se pudo usar.", { errors: { [qid]: "Volvé a subir los archivos." } });
    }
    fileRefs[qid] = (ups ?? []).map((u) => ({ id: u.id, name: u.name, path: u.path, size: Number(u.size), type: u.type }));
  }

  // Armar el elemento.
  const dest = form.config.destination;
  const task: Record<string, unknown> = { board_id: form.board_id, custom_values: {} };
  const custom: Record<string, unknown> = {};
  const free: { label: string; text: string }[] = [];
  const summary: { label: string; text: string }[] = [];
  for (const q of form.config.questions) {
    if (!isInput(q) || !(q.id in values)) continue;
    const v = values[q.id];
    const spec = specs[q.id];
    const text = answerText(spec, v as never);
    if (!q.hidden) summary.push({ label: q.label, text });
    if (q.kind === "free") {
      free.push({ label: q.label, text });
      continue;
    }
    switch (q.target) {
      case "title":
        task.title = String(v).slice(0, 500);
        break;
      case "description":
        task.description = String(v).slice(0, 10000);
        break;
      case "priority":
        task.priority = v;
        break;
      case "assignee":
        task.assignee_id = v;
        break;
      case "due_date":
        task.due_date = v;
        break;
      case "status":
        task.status_id = v;
        break;
      case "group":
        task.group_id = v;
        break;
      default: {
        const colId = String(q.target).slice(4);
        const col = board.columns.find((c) => c.id === colId);
        if (!col) break;
        custom[colId] = col.kind === "files" ? fileRefs[q.id] ?? [] : col.kind === "rating" ? Number(v) : v;
      }
    }
  }
  if (!task.title) {
    const tpl = (dest.titleTemplate || `${form.config.title} · {fecha}`).slice(0, 300);
    const today = new Date().toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
    task.title =
      tpl
        .replace(/\{fecha\}/g, today)
        .replace(/\{([a-z0-9_-]{1,40})\}/gi, (_, id: string) => {
          const q = form.config.questions.find((x) => x.id === id);
          return q && id in values ? answerText(specs[id], values[id] as never).slice(0, 200) : "";
        })
        .trim()
        .slice(0, 500) || form.config.title;
  }
  task.group_id ??= board.groups.find((g) => g.id === dest.groupId)?.id ?? board.groups[0]?.id;
  if (!task.group_id) throw new HttpError(500, "El tablero no tiene carpetas.");
  if (task.status_id === undefined && dest.statusId && board.statuses.some((s) => s.id === dest.statusId)) task.status_id = dest.statusId;
  if (task.status_id === undefined && board.statuses.length) task.status_id = board.statuses[0].id;
  if (task.assignee_id === undefined && dest.assigneeId && board.members.some((m) => m.id === dest.assigneeId)) task.assignee_id = dest.assigneeId;
  if (task.priority === undefined && dest.priority && PRIORITIES.some((p) => p.value === dest.priority)) task.priority = dest.priority;
  task.custom_values = custom;
  const { data: last } = await admin.from("tasks").select("position").eq("group_id", task.group_id as string).order("position", { ascending: false }).limit(1).maybeSingle();
  task.position = (last?.position ?? 0) + 1000;

  const { data: created, error } = await admin.from("tasks").insert(task).select("id").single();
  if (error || !created) {
    console.error("vetta-formularios insert", error?.message);
    throw new HttpError(500, "No se pudo guardar tu respuesta. Probá de nuevo.");
  }
  const taskId = created.id as string;
  const ids = Object.values(fileRefs).flat().map((f) => f.id);
  if (ids.length) await admin.from("form_uploads").update({ used: true }).in("id", ids);

  // Historial, respuestas libres y avisos.
  const respondent = userId ? board.members.find((m) => m.id === userId)?.name ?? null : null;
  await admin.from("task_events").insert({
    workspace_id: form.workspace_id,
    board_id: form.board_id,
    task_id: taskId,
    kind: "form_submitted",
    detail: { form: form.name, ...(respondent ? { by: respondent } : {}) },
    actor_id: userId,
  });
  if (free.length) {
    const body = [`Respuestas del formulario «${form.config.title}»${respondent ? ` (enviado por ${respondent})` : ""}`, ...free.map((f) => `• ${f.label}: ${f.text || "—"}`)].join("\n").slice(0, 5000);
    await admin.from("task_comments").insert({ task_id: taskId, body, author_id: userId });
  }
  const notify = form.config.notify.filter((id) => board.members.some((m) => m.id === id));
  if (notify.length) {
    const title = String(task.title);
    await admin.from("notifications").insert(
      notify.map((id) => ({
        user_id: id,
        workspace_id: form.workspace_id,
        board_id: form.board_id,
        task_id: taskId,
        title: `Nueva respuesta: ${form.name}`.slice(0, 300),
        body: `${title}${respondent ? ` · enviada por ${respondent}` : ""}`.slice(0, 1000),
      })),
    );
  }

  let tracking: string | null = null;
  if (form.config.after.tracking) tracking = randomToken();
  await admin.from("form_submissions").insert({
    form_id: form.id,
    workspace_id: form.workspace_id,
    board_id: form.board_id,
    task_id: taskId,
    submitted_by: userId,
    answers: Object.fromEntries(form.config.questions.filter((q) => q.id in values).map((q) => [q.id, { label: q.label, value: values[q.id], text: answerText(specs[q.id], values[q.id] as never) }])),
    tracking_hash: tracking ? await sha256(tracking) : null,
    ip_hash: ipHash,
    duration_ms: duration !== null ? Math.min(duration, 2_000_000_000) : null,
  });

  return {
    ok: true,
    tracking,
    message: form.config.after.message ?? null,
    redirectUrl: form.config.after.redirectUrl && /^https:\/\//.test(form.config.after.redirectUrl) ? form.config.after.redirectUrl : null,
    summary: form.config.after.showSummary ? summary : [],
  };
}

async function track(body: Record<string, unknown>) {
  const token = String(body.token ?? "");
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new HttpError(404, "No encontramos ese pedido.");
  const { data: sub } = await admin.from("form_submissions").select("id, form_id, task_id, created_at").eq("tracking_hash", await sha256(token)).maybeSingle();
  if (!sub) throw new HttpError(404, "No encontramos ese pedido.");
  const { data: form } = await admin.from("board_forms").select("name, config").eq("id", sub.form_id).maybeSingle();
  const config = cleanConfig(form?.config);
  if (!sub.task_id) return { found: true, deleted: true, form: config.title, design: config.design, created_at: sub.created_at };
  const { data: task } = await admin.from("tasks").select("title, status_id, updated_at").eq("id", sub.task_id).maybeSingle();
  if (!task) return { found: true, deleted: true, form: config.title, design: config.design, created_at: sub.created_at };
  const [{ data: status }, { data: events }] = await Promise.all([
    task.status_id ? admin.from("board_statuses").select("label, color, is_done").eq("id", task.status_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("task_events").select("kind, detail, created_at").eq("task_id", sub.task_id).in("kind", ["status_changed"]).order("created_at").limit(100),
  ]);
  return {
    found: true,
    deleted: false,
    form: config.title,
    design: config.design,
    title: task.title,
    created_at: sub.created_at,
    updated_at: task.updated_at,
    status: status ? { label: status.label, color: status.color, done: status.is_done } : null,
    timeline: (events ?? []).map((e) => {
      const d = (e.detail ?? {}) as Record<string, unknown>;
      return { at: e.created_at, to: typeof d.to === "string" ? d.to : null, color: typeof d.to_color === "string" ? d.to_color : null, done: d.done === true };
    }),
  };
}

Deno.serve(async (req) => {
  const headers = { ...cors(req), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ ok: false, error: "Método no permitido." }), { status: 405, headers });
  if (!SECRET_KEY) return new Response(JSON.stringify({ ok: false, error: "La función no está configurada." }), { status: 500, headers });
  try {
    const text = await req.text();
    if (text.length > 400_000) throw new HttpError(413, "La respuesta es demasiado grande.");
    const body = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
    let data: unknown;
    switch (body.action) {
      case "get":
        data = await getForm(req, body);
        break;
      case "upload":
        data = await upload(req, body);
        break;
      case "submit":
        data = await submit(req, body);
        break;
      case "track":
        data = await track(body);
        break;
      default:
        throw new HttpError(400, "Acción desconocida.");
    }
    return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers });
  } catch (e) {
    if (e instanceof HttpError) return new Response(JSON.stringify({ ok: false, error: e.message, ...e.extra }), { status: e.status, headers });
    if (e instanceof SyntaxError) return new Response(JSON.stringify({ ok: false, error: "Datos inválidos." }), { status: 400, headers });
    console.error("vetta-formularios", e instanceof Error ? e.message : "error");
    return new Response(JSON.stringify({ ok: false, error: "No se pudo completar. Probá de nuevo." }), { status: 500, headers });
  }
});
