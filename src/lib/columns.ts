import { z } from "zod";
import type { Json, Tables } from "@/lib/database.types";
import { COLOR_NAMES, asColor, type ColorName } from "@/lib/constants";

/*
 * Columnas propias de cada tablero. Los valores
 * se guardan en tasks.custom_values como { <id de columna>: valor }:
 *   text, long_text, link, email, phone → string
 *   number, rating → number · checkbox → true
 *   date → "YYYY-MM-DD" · hour → "HH:MM" · timeline → "YYYY-MM-DD/YYYY-MM-DD"
 *   person → id de usuario · list (estado) → id de etiqueta
 *   tags (desplegable) → [ids de etiqueta]
 * Las columnas formula, item_id, created_log y updated_log se calculan al
 * mostrar el tablero y no guardan nada.
 */

export const COLUMN_KINDS = [
  "list",
  "text",
  "long_text",
  "number",
  "date",
  "timeline",
  "person",
  "tags",
  "checkbox",
  "rating",
  "link",
  "email",
  "phone",
  "hour",
  "formula",
  "item_id",
  "created_log",
  "updated_log",
  "files",
  "people",
  "checklist",
  "dependency",
  "connect",
  "mirror",
] as const;
export type ColumnKind = (typeof COLUMN_KINDS)[number];

export const COLUMN_KIND_LABELS: Record<ColumnKind, string> = {
  list: "Estado / Etiqueta",
  text: "Texto",
  long_text: "Texto largo",
  number: "Números",
  date: "Fecha",
  timeline: "Cronograma",
  person: "Persona",
  tags: "Desplegable (varias opciones)",
  checkbox: "Casilla de verificación",
  rating: "Calificación",
  link: "Enlace",
  email: "Email",
  phone: "Teléfono",
  hour: "Hora",
  formula: "Fórmula",
  item_id: "ID del elemento",
  created_log: "Registro de creación",
  updated_log: "Última actualización",
  files: "Archivos",
  people: "Personas (varias)",
  checklist: "Checklist",
  dependency: "Depende de",
  connect: "Conectar tableros",
  mirror: "Espejo",
};

export const COLUMN_KIND_HELP: Record<ColumnKind, string> = {
  list: "Etiquetas de colores que definís vos: estados, prioridades, tipos…",
  text: "Una línea de texto libre.",
  long_text: "Notas y descripciones de varias líneas.",
  number: "Cantidades, montos y porcentajes, con unidad y resumen al pie.",
  date: "Una fecha. Sirve para reglas por vencimiento.",
  timeline: "Un rango de fechas: inicio y fin.",
  person: "Una persona de la empresa.",
  tags: "Elegí una o varias opciones de una lista.",
  checkbox: "Sí o no, con un clic.",
  rating: "Estrellas de 1 a 5 (o hasta 10).",
  link: "Una dirección web que se abre con un clic.",
  email: "Una dirección de email.",
  phone: "Un número de teléfono.",
  hour: "Una hora del día.",
  formula: "Calcula un valor a partir de otras columnas.",
  item_id: "Un código único de cada elemento (solo lectura).",
  created_log: "Quién creó el elemento y cuándo (solo lectura).",
  updated_log: "Cuándo se modificó por última vez (solo lectura).",
  files: "Adjuntá documentos, fotos y planillas a cada elemento.",
  people: "Una o varias personas responsables.",
  checklist: "Lista de pasos a tildar, con el porcentaje de avance.",
  dependency: "Elementos de este tablero que tienen que terminarse antes.",
  connect: "Vinculá elementos de otro tablero de la empresa.",
  mirror: "Muestra un dato de los elementos conectados (estado, fecha, número…).",
};

/** Tipos que se calculan y no se editan. */
export const COMPUTED_KINDS: readonly ColumnKind[] = ["formula", "item_id", "created_log", "updated_log", "mirror"];
/** Tipos que las reglas automáticas no completan ni comparan. */
export const NON_RULE_KINDS: readonly ColumnKind[] = [...COMPUTED_KINDS, "files", "checklist", "dependency", "connect", "people"];
/** Tipos con etiquetas de colores. */
export const LABEL_KINDS: readonly ColumnKind[] = ["list", "tags"];
/** Cambios de tipo permitidos (guardan el mismo valor). */
export const KIND_CHANGES: Partial<Record<ColumnKind, ColumnKind[]>> = {
  text: ["long_text", "link", "email", "phone"],
  long_text: ["text"],
  link: ["text"],
  email: ["text"],
  phone: ["text"],
  list: ["tags"],
};

export type ListOption = { id: string; label: string; color: ColorName; done?: boolean };

export const NUMBER_SUMMARIES = ["sum", "avg", "median", "min", "max", "count", "none"] as const;
export type NumberSummary = (typeof NUMBER_SUMMARIES)[number];
export const NUMBER_SUMMARY_LABELS: Record<NumberSummary, string> = {
  sum: "Suma",
  avg: "Promedio",
  median: "Mediana",
  min: "Mínimo",
  max: "Máximo",
  count: "Cantidad",
  none: "Sin resumen",
};

export type ColumnSettings = {
  /** Unidad de un número o fórmula ("$", "%", "hs"…). */
  unit?: string;
  unitPosition?: "left" | "right";
  /** Decimales: -1 automático, 0 a 5 fijo. */
  decimals?: number;
  summary?: NumberSummary;
  /** Expresión de una columna fórmula. */
  formula?: string;
  /** Máximo de una calificación (3 a 10). */
  max?: number;
  /** Descripción que se muestra en el encabezado. */
  description?: string;
  /** Oculta la columna en la tabla (sigue visible en el detalle). */
  hidden?: boolean;
  /** Conectar tableros: tablero vinculado. */
  boardId?: string;
  /** Espejo: columna "Conectar tableros" de este tablero que usa. */
  connectColumnId?: string;
  /** Espejo: qué dato mostrar de los elementos conectados (status, due, c:<id>…). */
  mirrorKey?: string;
  /** Checklist: plantilla que reciben los elementos nuevos. */
  templateId?: string;
  /** Checklist: al pasar el elemento a un estado terminado, tildar todo. */
  completeOnDone?: boolean;
  /** Quién puede cambiar la columna (vacío = todos los que editan el tablero). */
  editors?: { users?: string[]; teams?: string[] };
  /** Checklist: al completarse, pasar el elemento a este estado. */
  onCompleteStatusId?: string;
};

export const columnSettingsSchema = z
  .object({
    unit: z.string().trim().max(12, { message: "La unidad puede tener hasta 12 caracteres." }).optional(),
    unitPosition: z.enum(["left", "right"]).optional(),
    decimals: z.number().int().min(-1).max(5).optional(),
    summary: z.enum(NUMBER_SUMMARIES).optional(),
    formula: z.string().max(2000, { message: "La fórmula puede tener hasta 2000 caracteres." }).optional(),
    max: z.number().int().min(3).max(10).optional(),
    description: z.string().trim().max(300, { message: "La descripción puede tener hasta 300 caracteres." }).optional(),
    hidden: z.boolean().optional(),
    boardId: z.uuid().optional(),
    connectColumnId: z.uuid().optional(),
    mirrorKey: z.string().max(40).optional(),
    templateId: z.uuid().optional(),
    completeOnDone: z.boolean().optional(),
    onCompleteStatusId: z.uuid().optional(),
    /** Quién puede cambiar la columna (vacío = todos los que editan el tablero). */
    editors: z.object({ users: z.array(z.uuid()).max(200).optional(), teams: z.array(z.uuid()).max(50).optional() }).strip().optional(),
  })
  .strip();

export type BoardColumn = Omit<Tables<"board_columns">, "kind" | "options" | "settings" | "legacy_kind"> & {
  kind: ColumnKind;
  options: ListOption[];
  settings: ColumnSettings;
};

export type FileRef = { id: string; name: string; path: string; size: number; type: string };
/** Estado de un paso del checklist (además de tildado / sin tildar). */
export const CHECK_STATUSES = ["todo", "doing", "blocked", "na"] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];
export const CHECK_STATUS_LABELS: Record<CheckStatus, { label: string; color: string }> = {
  todo: { label: "Pendiente", color: "gray" },
  doing: { label: "En curso", color: "blue" },
  blocked: { label: "Bloqueado", color: "red" },
  na: { label: "No aplica", color: "violet" },
};
export type CheckItem = {
  id: string;
  text: string;
  done: boolean;
  /** Sección (encabezado): agrupa los pasos que siguen, no se tilda. */
  header?: boolean;
  status?: CheckStatus;
  assignee?: string;
  due?: string;
  note?: string;
};
/** Plantilla de checklist de la empresa. */
export type ChecklistTemplate = { id: string; name: string; items: { text: string; header?: boolean; note?: string }[]; created_by: string | null };

/** Normaliza un paso leído de la base o recibido del cliente. */
export function cleanCheckItem(i: Partial<CheckItem> & { text: string }): CheckItem {
  const out: CheckItem = { id: String(i.id || newOptionId()).slice(0, 40), text: String(i.text).trim().slice(0, 300), done: Boolean(i.done) };
  if (i.header) out.header = true;
  if (i.status && (CHECK_STATUSES as readonly string[]).includes(i.status) && i.status !== "todo") out.status = i.status;
  if (typeof i.assignee === "string" && i.assignee) out.assignee = i.assignee;
  if (typeof i.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(i.due)) out.due = i.due;
  if (typeof i.note === "string" && i.note.trim()) out.note = i.note.trim().slice(0, 1000);
  if (out.header) {
    out.done = false;
    delete out.status;
    delete out.assignee;
    delete out.due;
  }
  return out;
}

/** Pasos nuevos (sin tildar) a partir de los pasos de una plantilla. */
export function checklistFromTemplate(items: ChecklistTemplate["items"]): CheckItem[] {
  return items.map((i) => cleanCheckItem({ text: i.text, header: i.header, note: i.note }));
}
export type CellValue = string | number | boolean | string[] | FileRef[] | CheckItem[];

export function isFileList(v: unknown): v is FileRef[] {
  return Array.isArray(v) && v.every((x) => x && typeof x === "object" && typeof (x as FileRef).path === "string" && typeof (x as FileRef).name === "string");
}
export function isChecklist(v: unknown): v is CheckItem[] {
  return Array.isArray(v) && v.every((x) => x && typeof x === "object" && typeof (x as CheckItem).text === "string" && typeof (x as CheckItem).done === "boolean");
}
export function stringList(v: CellValue | undefined): string[] {
  return Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : [];
}
/** Avance: cuentan los pasos (no las secciones) y no cuentan los "No aplica". */
export function checklistProgress(v: CellValue | undefined): { done: number; total: number } {
  const list = (isChecklist(v) ? v : []).filter((i) => !i.header && i.status !== "na");
  return { done: list.filter((i) => i.done).length, total: list.length };
}
export type CustomValues = Record<string, CellValue>;

export function parseColumn(row: Tables<"board_columns">): BoardColumn {
  const kind = (COLUMN_KINDS as readonly string[]).includes(row.kind) ? (row.kind as ColumnKind) : "text";
  const options = Array.isArray(row.options)
    ? row.options
        .filter((o): o is { id: string; label: string; color?: string; done?: boolean } =>
          Boolean(o && typeof o === "object" && !Array.isArray(o) && typeof (o as Record<string, unknown>).id === "string"),
        )
        .map((o) => ({ id: o.id, label: String(o.label ?? ""), color: asColor(o.color), ...(o.done ? { done: true } : {}) }))
    : [];
  const parsed = columnSettingsSchema.safeParse(row.settings ?? {});
  return {
    id: row.id,
    board_id: row.board_id,
    name: row.name,
    position: row.position,
    created_at: row.created_at,
    updated_at: row.updated_at,
    kind,
    options,
    settings: parsed.success ? parsed.data : {},
  };
}

export function readValues(json: Json | null | undefined): CustomValues {
  if (!json || typeof json !== "object" || Array.isArray(json)) return {};
  const out: CustomValues = {};
  for (const [k, v] of Object.entries(json)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (Array.isArray(v)) {
      if (v.length && v.every((x) => x && typeof x === "object")) {
        if (isFileList(v)) out[k] = v.map((f) => ({ id: String(f.id ?? f.path), name: String(f.name), path: String(f.path), size: Number(f.size) || 0, type: String(f.type ?? "") }));
        else if (isChecklist(v)) out[k] = v.map((i) => cleanCheckItem(i));
      } else out[k] = v.filter((x): x is string => typeof x === "string");
    }
  }
  return out;
}

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (v: string) => dateRe.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Normaliza un enlace: agrega https:// si falta. */
export function normalizeUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Normaliza y valida un valor según el tipo de columna. null = vaciar. */
export function normalizeValue(
  column: Pick<BoardColumn, "kind" | "options" | "settings">,
  raw: unknown,
  memberIds?: Set<string>,
  /** Para archivos: prefijo obligatorio de la ruta (empresa/tablero/elemento/). */
  filePrefix?: string,
): { ok: true; value: CellValue | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === "") return { ok: true, value: null };
  if (Array.isArray(raw) && raw.length === 0) return { ok: true, value: null };
  switch (column.kind) {
    case "text":
    case "long_text": {
      const max = column.kind === "text" ? 500 : 5000;
      const v = String(raw).trim();
      if (v.length > max) return { ok: false, error: `El texto puede tener hasta ${max} caracteres.` };
      return { ok: true, value: v || null };
    }
    case "number": {
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
      if (!Number.isFinite(n) || Math.abs(n) > 1e15) return { ok: false, error: "Ingresá un número válido." };
      return { ok: true, value: n };
    }
    case "rating": {
      const n = Number(raw);
      const max = column.settings.max ?? 5;
      if (!Number.isInteger(n) || n < 0 || n > max) return { ok: false, error: `La calificación va de 1 a ${max}.` };
      return { ok: true, value: n === 0 ? null : n };
    }
    case "date": {
      const v = String(raw);
      if (!validDate(v)) return { ok: false, error: "Fecha inválida." };
      return { ok: true, value: v };
    }
    case "timeline": {
      const [a, b] = String(raw).split("/");
      if (!a || !b || !validDate(a) || !validDate(b)) return { ok: false, error: "Indicá fecha de inicio y de fin." };
      const [start, end] = a <= b ? [a, b] : [b, a];
      return { ok: true, value: `${start}/${end}` };
    }
    case "hour": {
      const v = String(raw).trim();
      const m = /^(\d{1,2}):(\d{2})$/.exec(v);
      if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return { ok: false, error: "Hora inválida (HH:MM)." };
      return { ok: true, value: `${m[1].padStart(2, "0")}:${m[2]}` };
    }
    case "link": {
      const v = normalizeUrl(String(raw));
      if (!v) return { ok: false, error: "Ingresá una dirección web válida." };
      if (v.length > 2000) return { ok: false, error: "El enlace es demasiado largo." };
      return { ok: true, value: v };
    }
    case "email": {
      const v = String(raw).trim().toLowerCase();
      if (!emailRe.test(v) || v.length > 254) return { ok: false, error: "Email inválido." };
      return { ok: true, value: v };
    }
    case "phone": {
      const v = String(raw).trim();
      if (!/^[+()\d\s.-]{5,30}$/.test(v)) return { ok: false, error: "Teléfono inválido." };
      return { ok: true, value: v };
    }
    case "person": {
      const v = String(raw);
      if (!z.uuid().safeParse(v).success) return { ok: false, error: "Persona inválida." };
      if (memberIds && !memberIds.has(v)) return { ok: false, error: "La persona tiene que ser usuario de la empresa." };
      return { ok: true, value: v };
    }
    case "list": {
      const v = String(raw);
      if (!column.options.some((o) => o.id === v)) return { ok: false, error: "Etiqueta inválida." };
      return { ok: true, value: v };
    }
    case "tags": {
      const list = Array.isArray(raw) ? raw.map(String) : [String(raw)];
      const valid = [...new Set(list)].filter((id) => column.options.some((o) => o.id === id));
      if (valid.length !== new Set(list).size) return { ok: false, error: "Opción inválida." };
      return { ok: true, value: valid.length ? valid : null };
    }
    case "checkbox":
      return { ok: true, value: raw === true || raw === "true" || raw === "on" ? true : null };
    case "people":
    case "dependency":
    case "connect": {
      const list = [...new Set((Array.isArray(raw) ? raw : [raw]).map(String))];
      if (list.length > 50) return { ok: false, error: "Hasta 50 elementos." };
      if (list.some((id) => !z.uuid().safeParse(id).success)) return { ok: false, error: "Valor inválido." };
      if (column.kind === "people" && memberIds && list.some((id) => !memberIds.has(id))) {
        return { ok: false, error: "Las personas tienen que ser usuarios de la empresa." };
      }
      return { ok: true, value: list };
    }
    case "checklist": {
      if (!isChecklist(raw)) return { ok: false, error: "Checklist inválido." };
      if (raw.length > 300) return { ok: false, error: "Hasta 300 pasos." };
      const items = raw.map(cleanCheckItem).filter((i) => i.text);
      if (memberIds && items.some((i) => i.assignee && !memberIds.has(i.assignee))) return { ok: false, error: "El responsable del paso tiene que ser usuario de la empresa." };
      if (items.some((i) => i.assignee && !z.uuid().safeParse(i.assignee).success)) return { ok: false, error: "Responsable inválido." };
      return { ok: true, value: items.length ? items : null };
    }
    case "files": {
      if (!isFileList(raw)) return { ok: false, error: "Archivos inválidos." };
      if (raw.length > 50) return { ok: false, error: "Hasta 50 archivos por elemento." };
      if (filePrefix && raw.some((f) => !f.path.startsWith(filePrefix) || f.path.includes(".."))) return { ok: false, error: "Archivo inválido." };
      const files = raw.map((f) => ({
        id: String(f.id || f.path).slice(0, 300),
        name: String(f.name).slice(0, 200),
        path: String(f.path).slice(0, 500),
        size: Math.max(0, Number(f.size) || 0),
        type: String(f.type ?? "").slice(0, 100),
      }));
      return { ok: true, value: files };
    }
    default:
      return { ok: false, error: "Esta columna se calcula sola y no se puede editar." };
  }
}

export const columnNameSchema = z
  .string()
  .trim()
  .min(1, { message: "El nombre de la columna es obligatorio." })
  .max(60, { message: "Máximo 60 caracteres." });

export const listOptionsSchema = z
  .array(
    z.object({
      id: z.string().min(1).max(40),
      label: z.string().trim().min(1, { message: "Cada etiqueta necesita un nombre." }).max(40, { message: "Máximo 40 caracteres por etiqueta." }),
      color: z.enum(COLOR_NAMES),
      done: z.boolean().optional(),
    }),
  )
  .max(100, { message: "Hasta 100 etiquetas." });

export const columnInputSchema = z.object({
  name: columnNameSchema,
  kind: z.enum(COLUMN_KINDS, { message: "Tipo de columna inválido." }),
  options: listOptionsSchema.default([]),
  settings: columnSettingsSchema.default({}),
});

export function newOptionId() {
  return Math.random().toString(36).slice(2, 10);
}

/** Etiquetas iniciales de una columna nueva de estado. */
export function defaultLabels(kind: ColumnKind): ListOption[] {
  if (kind === "list")
    return [
      { id: newOptionId(), label: "Listo", color: "green", done: true },
      { id: newOptionId(), label: "En curso", color: "orange" },
      { id: newOptionId(), label: "Detenido", color: "red" },
    ];
  if (kind === "tags")
    return [
      { id: newOptionId(), label: "Opción 1", color: "blue" },
      { id: newOptionId(), label: "Opción 2", color: "violet" },
    ];
  return [];
}

/* ------------------------------------------------------------- formatos */

export function parseTimeline(v: CellValue | undefined): { start: string; end: string } | null {
  if (typeof v !== "string") return null;
  const [start, end] = v.split("/");
  return start && end ? { start, end } : null;
}

export function formatNumber(n: number, settings: ColumnSettings = {}): string {
  const d = settings.decimals ?? -1;
  const text = n.toLocaleString("es-AR", d >= 0 ? { minimumFractionDigits: d, maximumFractionDigits: d } : { maximumFractionDigits: 6 });
  const unit = settings.unit?.trim();
  if (!unit) return text;
  return settings.unitPosition === "left" ? `${unit} ${text}` : `${text} ${unit}`;
}

export function shortDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-AR", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** Texto plano de un valor (para lectores de pantalla, resúmenes y exportar). */
export function valueLabel(
  column: BoardColumn,
  value: CellValue | undefined,
  members: { user_id: string; full_name: string | null; email: string | null }[],
): string {
  if (value === undefined || value === null || value === "") return "";
  switch (column.kind) {
    case "list":
      return column.options.find((o) => o.id === value)?.label ?? "";
    case "tags":
      return (Array.isArray(value) ? value : [String(value)])
        .map((id) => column.options.find((o) => o.id === id)?.label)
        .filter(Boolean)
        .join(", ");
    case "person": {
      const m = members.find((x) => x.user_id === value);
      return m ? m.full_name?.trim() || m.email || "" : "Ex usuario";
    }
    case "checkbox":
      return value ? "Sí" : "";
    case "number":
      return typeof value === "number" ? formatNumber(value, column.settings) : String(value);
    case "rating":
      return typeof value === "number" ? `${value}/${column.settings.max ?? 5}` : "";
    case "timeline": {
      const t = parseTimeline(value);
      return t ? `${t.start} → ${t.end}` : "";
    }
    case "people":
      return stringList(value)
        .map((id) => {
          const m = members.find((x) => x.user_id === id);
          return m ? m.full_name?.trim() || m.email || "" : "";
        })
        .filter(Boolean)
        .join(", ");
    case "files":
      return isFileList(value) ? value.map((f) => f.name).join(", ") : "";
    case "checklist": {
      const p = checklistProgress(value);
      return p.total ? `${p.done}/${p.total}` : "";
    }
    case "dependency":
    case "connect":
      return stringList(value).length ? `${stringList(value).length} vinculados` : "";
    default:
      return Array.isArray(value) ? stringList(value).join(", ") : String(value);
  }
}
