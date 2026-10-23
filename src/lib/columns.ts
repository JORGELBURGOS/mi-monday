import { z } from "zod";
import type { Json, Tables } from "@/lib/database.types";
import { COLOR_NAMES, asColor, type ColorName } from "@/lib/constants";

/*
 * Columnas propias de cada tablero (como las columnas de Monday). Los valores
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
  formula: "Calcula un valor a partir de otras columnas, como en Excel.",
  item_id: "Un código único de cada elemento (solo lectura).",
  created_log: "Quién creó el elemento y cuándo (solo lectura).",
  updated_log: "Cuándo se modificó por última vez (solo lectura).",
};

/** Tipos que se calculan y no se editan. */
export const COMPUTED_KINDS: readonly ColumnKind[] = ["formula", "item_id", "created_log", "updated_log"];
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
  })
  .strip();

export type BoardColumn = Omit<Tables<"board_columns">, "kind" | "options" | "settings" | "legacy_kind"> & {
  kind: ColumnKind;
  options: ListOption[];
  settings: ColumnSettings;
};

export type CellValue = string | number | boolean | string[];
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
    else if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === "string");
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
): { ok: true; value: CellValue | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === "") return { ok: true, value: null };
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
    default:
      return Array.isArray(value) ? value.join(", ") : String(value);
  }
}
