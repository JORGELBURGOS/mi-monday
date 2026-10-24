import { z } from "zod";
import { COLOR_NAMES, PRIORITIES } from "@/lib/constants";
import type { BoardColumn, ColumnKind } from "@/lib/columns";
import { FREE_TYPES, type FormConfig, type FreeType, type InputSpec, type Option, type Question } from "@/lib/form-logic";

/* -------------------------------------------------------------------------- */
/*  Formularios: esquema, valores por defecto y catálogo de campos            */
/* -------------------------------------------------------------------------- */

export const FREE_TYPE_LABELS: Record<FreeType, string> = {
  short: "Texto corto",
  long: "Texto largo",
  number: "Número",
  date: "Fecha",
  email: "Email",
  phone: "Teléfono",
  url: "Enlace",
  choice: "Opción única",
  multi: "Varias opciones",
  yesno: "Sí / No",
  checkbox: "Casilla (acepto…)",
  rating: "Calificación",
};

/** Columnas que se pueden completar desde un formulario. */
export const FORM_COLUMN_KINDS: ColumnKind[] = ["text", "long_text", "number", "date", "timeline", "email", "phone", "link", "hour", "list", "tags", "checkbox", "rating", "files", "person", "people"];

export const CORE_TARGETS = [
  { target: "title", label: "Nombre del elemento", type: "short" },
  { target: "description", label: "Descripción", type: "long" },
  { target: "priority", label: "Prioridad", type: "choice" },
  { target: "due_date", label: "Vencimiento", type: "date" },
  { target: "status", label: "Estado", type: "choice" },
  { target: "group", label: "Carpeta", type: "choice" },
  { target: "assignee", label: "Responsable", type: "choice" },
] as const;

const id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const ruleSchema = z.object({ q: id, op: z.enum(["is", "is_not", "filled", "empty", "contains", "gt", "lt"]), value: z.string().max(200).optional() });
const questionSchema = z.object({
  id,
  kind: z.enum(["field", "free", "text", "page"]),
  target: z.string().max(60).optional(),
  freeType: z.enum(FREE_TYPES).optional(),
  options: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
  label: z.string().max(500),
  help: z.string().max(2000).optional(),
  placeholder: z.string().max(200).optional(),
  required: z.boolean().optional(),
  hidden: z.boolean().optional(),
  defaultValue: z.string().max(500).optional(),
  allowed: z.array(z.string().max(100)).max(300).optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  param: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, { message: "El nombre del parámetro solo admite letras, números, - y _." }).optional(),
  showIf: z.object({ mode: z.enum(["all", "any"]), rules: z.array(ruleSchema).max(10) }).optional(),
});

export const formConfigSchema = z.object({
  title: z.string().trim().min(1, { message: "Poné un título al formulario." }).max(200),
  description: z.string().max(5000).optional(),
  questions: z.array(questionSchema).max(200, { message: "Hasta 200 preguntas." }),
  design: z.object({
    accent: z.enum(COLOR_NAMES),
    cover: z.enum(["none", "solid", "gradient"]),
    logoUrl: z
      .string()
      .max(1000)
      .refine((v) => v === "" || /^https:\/\//i.test(v), { message: "El logo tiene que ser un enlace https." })
      .optional(),
    layout: z.enum(["classic", "steps", "focus"]),
    submitLabel: z.string().max(40).optional(),
    theme: z.enum(["auto", "light", "dark"]),
  }),
  destination: z.object({
    groupId: z.string().max(60).optional(),
    statusId: z.string().max(60).optional(),
    assigneeId: z.string().max(60).optional(),
    priority: z.string().max(20).optional(),
    titleTemplate: z.string().max(300).optional(),
  }),
  after: z.object({
    message: z.string().max(3000).optional(),
    redirectUrl: z
      .string()
      .max(1000)
      .refine((v) => v === "" || /^https:\/\//i.test(v), { message: "El enlace de redirección tiene que empezar con https://" })
      .optional(),
    allowAnother: z.boolean(),
    tracking: z.boolean(),
    showSummary: z.boolean(),
  }),
  notify: z.array(z.string().max(60)).max(50),
});

export function newQuestionId() {
  return `q${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
}

export type FormTemplate = "blank" | "request" | "contact" | "support";

/** Configuración de partida según la plantilla y las columnas del tablero. */
export function initialConfig(name: string, template: FormTemplate, columns: Pick<BoardColumn, "id" | "kind" | "name">[]): FormConfig {
  const q = (x: Partial<Question> & Pick<Question, "kind" | "label">): Question => ({ id: newQuestionId(), ...x });
  const files = columns.find((c) => c.kind === "files");
  let questions: Question[] = [];
  let titleTemplate: string | undefined;
  switch (template) {
    case "request":
      questions = [
        q({ kind: "field", target: "title", label: "¿Qué necesitás?", placeholder: "Contalo en pocas palabras", required: true }),
        q({ kind: "field", target: "description", label: "Detalle", help: "Todo lo que nos ayude a resolverlo." }),
        q({ kind: "field", target: "priority", label: "¿Qué tan urgente es?" }),
        q({ kind: "field", target: "due_date", label: "¿Para cuándo lo necesitás?" }),
        q({ kind: "free", freeType: "email", label: "Tu email", required: true }),
        ...(files ? [q({ kind: "field", target: `col:${files.id}`, label: "Adjuntos" })] : []),
      ];
      break;
    case "contact": {
      const nombre = q({ kind: "free", freeType: "short", label: "Nombre y apellido", required: true });
      questions = [
        nombre,
        q({ kind: "free", freeType: "email", label: "Email", required: true }),
        q({ kind: "free", freeType: "phone", label: "Teléfono" }),
        q({ kind: "field", target: "description", label: "Mensaje", required: true }),
      ];
      titleTemplate = `Contacto de {${nombre.id}}`;
      break;
    }
    case "support": {
      const tipo = q({ kind: "free", freeType: "choice", label: "Tipo de consulta", options: ["Problema", "Consulta", "Sugerencia"], required: true });
      questions = [
        q({ kind: "field", target: "title", label: "Resumen", required: true }),
        tipo,
        q({
          kind: "free",
          freeType: "short",
          label: "¿Dónde ocurre el problema?",
          showIf: { mode: "all", rules: [{ q: tipo.id, op: "is", value: "Problema" }] },
        }),
        q({ kind: "field", target: "description", label: "Contanos qué pasó", required: true }),
        q({ kind: "free", freeType: "email", label: "Email para responderte", required: true }),
        ...(files ? [q({ kind: "field", target: `col:${files.id}`, label: "Capturas o archivos" })] : []),
      ];
      break;
    }
    default:
      questions = [q({ kind: "field", target: "title", label: "Título", required: true })];
  }
  return {
    title: name,
    description: "",
    questions,
    design: { accent: "blue", cover: "gradient", layout: "classic", theme: "auto" },
    destination: { titleTemplate },
    after: { message: "¡Gracias! Recibimos tu respuesta.", allowAnother: true, tracking: true, showSummary: true },
    notify: [],
  };
}

/** Configuración guardada → completa (con valores por defecto). */
export function readConfig(raw: unknown, fallbackTitle: string): FormConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Partial<FormConfig>;
  return {
    title: c.title ?? fallbackTitle,
    description: c.description ?? "",
    questions: Array.isArray(c.questions) ? c.questions : [],
    design: { accent: "blue", cover: "gradient", layout: "classic", theme: "auto", ...(c.design ?? {}) },
    destination: c.destination ?? {},
    after: { allowAnother: true, tracking: true, showSummary: true, ...(c.after ?? {}) },
    notify: c.notify ?? [],
  };
}

export type BoardForForm = {
  columns: BoardColumn[];
  statuses: { id: string; label: string; color: string | null }[];
  groups: { id: string; name: string }[];
  members: { user_id: string; full_name: string | null; email: string | null }[];
};

/** Mismo criterio que la función de servidor, para la vista previa del editor. */
export function previewSpecs(config: FormConfig, b: BoardForForm, access: "public" | "members" | "password"): Record<string, InputSpec> {
  const specs: Record<string, InputSpec> = {};
  const filter = (q: Question, opts: Option[]) => (q.allowed?.length ? opts.filter((o) => q.allowed!.includes(o.value)) : opts);
  const members = b.members.map((m) => ({ value: m.user_id, label: m.full_name?.trim() || m.email || "Sin nombre" }));
  const people = (q: Question) => (access === "public" && !q.allowed?.length ? [] : filter(q, members));
  for (const q of config.questions) {
    if (q.kind === "free") {
      const t = q.freeType ?? "short";
      specs[q.id] = t === "choice" || t === "multi" ? { type: t, options: (q.options ?? []).map((o) => ({ value: o, label: o })) } : t === "rating" ? { type: "rating", max: Math.min(10, Math.max(3, q.max ?? 5)) } : { type: t };
      continue;
    }
    if (q.kind !== "field" || !q.target) continue;
    if (q.target === "title") specs[q.id] = { type: "short" };
    else if (q.target === "description") specs[q.id] = { type: "long" };
    else if (q.target === "due_date") specs[q.id] = { type: "date" };
    else if (q.target === "priority") specs[q.id] = { type: "choice", options: filter(q, PRIORITIES.map((p) => ({ value: p.value, label: p.label, color: p.color }))) };
    else if (q.target === "status") specs[q.id] = { type: "choice", options: filter(q, b.statuses.map((s) => ({ value: s.id, label: s.label, color: s.color ?? undefined }))) };
    else if (q.target === "group") specs[q.id] = { type: "choice", options: filter(q, b.groups.map((g) => ({ value: g.id, label: g.name }))) };
    else if (q.target === "assignee") {
      const o = people(q);
      if (o.length) specs[q.id] = { type: "choice", options: o };
    } else if (q.target.startsWith("col:")) {
      const col = b.columns.find((c) => `col:${c.id}` === q.target);
      if (!col) continue;
      const labels = filter(q, col.options.map((o) => ({ value: o.id, label: o.label, color: o.color })));
      const map: Partial<Record<ColumnKind, InputSpec | null>> = {
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
  return specs;
}

/** Opciones posibles de una pregunta de campo (para elegir cuáles se permiten). */
export function targetOptions(target: string, b: BoardForForm): Option[] {
  if (target === "priority") return PRIORITIES.map((p) => ({ value: p.value, label: p.label, color: p.color }));
  if (target === "status") return b.statuses.map((s) => ({ value: s.id, label: s.label, color: s.color ?? undefined }));
  if (target === "group") return b.groups.map((g) => ({ value: g.id, label: g.name }));
  const members = b.members.map((m) => ({ value: m.user_id, label: m.full_name?.trim() || m.email || "Sin nombre" }));
  if (target === "assignee") return members;
  const col = b.columns.find((c) => `col:${c.id}` === target);
  if (!col) return [];
  if (col.kind === "person" || col.kind === "people") return members;
  if (col.kind === "list" || col.kind === "tags") return col.options.map((o) => ({ value: o.id, label: o.label, color: o.color }));
  return [];
}

export function targetLabel(target: string | undefined, b: BoardForForm): string {
  if (!target) return "";
  const core = CORE_TARGETS.find((c) => c.target === target);
  if (core) return core.label;
  return b.columns.find((c) => `col:${c.id}` === target)?.name ?? "Columna eliminada";
}
