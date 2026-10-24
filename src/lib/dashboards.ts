import { z } from "zod";

/* -------------------------------------------------------------------------- */
/*  Widgets de dashboards                                                     */
/* -------------------------------------------------------------------------- */

export const WIDGET_TYPES = ["kpi", "bar", "hbar", "stacked", "line", "area", "pie", "donut", "progress", "pivot", "list", "text"] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export const WIDGET_LABELS: Record<WidgetType, { label: string; help: string }> = {
  kpi: { label: "KPI (número)", help: "Un número grande: cantidad, suma, promedio o % terminado." },
  bar: { label: "Barras verticales", help: "Compara cantidades entre categorías o a lo largo del tiempo." },
  hbar: { label: "Barras horizontales", help: "Ideal para rankings y nombres largos (personas, tableros)." },
  stacked: { label: "Barras apiladas", help: "Cada barra dividida por una segunda categoría." },
  line: { label: "Líneas", help: "Evolución en el tiempo." },
  area: { label: "Área", help: "Evolución en el tiempo, con el volumen relleno." },
  pie: { label: "Torta", help: "Partes de un total (pocas categorías)." },
  donut: { label: "Dona", help: "Partes de un total, con el total al centro." },
  progress: { label: "Barras de avance", help: "Una barra 100% por fila, dividida por estado u otra categoría." },
  pivot: { label: "Tabla dinámica", help: "Filas × columnas con el valor en cada celda y totales." },
  list: { label: "Lista de elementos", help: "Los elementos que cumplen los filtros, con las columnas que elijas." },
  text: { label: "Texto / título", help: "Un título o una nota para ordenar el dashboard." },
};

/** Tipos que usan una categoría (eje X / porciones). */
export const NEEDS_DIM: WidgetType[] = ["bar", "hbar", "stacked", "line", "area", "pie", "donut", "progress", "pivot"];
/** Tipos que usan una segunda categoría (series). */
export const NEEDS_SPLIT: WidgetType[] = ["stacked", "progress", "pivot"];
export const ALLOWS_SPLIT: WidgetType[] = ["bar", "hbar", "stacked", "line", "area", "progress", "pivot"];

/**
 * Campo por el que se agrupa o filtra:
 *   board, status, group, assignee, priority, state (pendiente/terminado/vencido),
 *   due, created, updated, done_at (fechas) o `col:<nombre>|<tipo>` (columnas
 *   propias; se reconocen por nombre y tipo en todos los tableros).
 */
export type FieldKey = string;
export const BASE_FIELDS = ["board", "status", "group", "assignee", "priority", "state", "due", "created", "done_at", "updated", "subitem"] as const;
export const FIELD_LABELS: Record<string, string> = {
  board: "Tablero",
  status: "Estado",
  group: "Carpeta",
  assignee: "Responsable",
  priority: "Prioridad",
  state: "Situación (pendiente / terminado / vencido)",
  due: "Vencimiento",
  created: "Fecha de creación",
  done_at: "Fecha en que se terminó",
  updated: "Última modificación",
  subitem: "Elemento o subelemento",
};
export const DATE_BASE_FIELDS = ["due", "created", "done_at", "updated"];

export const PERIODS = ["day", "week", "month", "quarter", "year"] as const;
export type Period = (typeof PERIODS)[number];
export const PERIOD_LABELS: Record<Period, string> = { day: "Día", week: "Semana", month: "Mes", quarter: "Trimestre", year: "Año" };

export const METRIC_OPS = ["count", "sum", "avg", "min", "max", "pct_done"] as const;
export type MetricOp = (typeof METRIC_OPS)[number];
export const METRIC_LABELS: Record<MetricOp, string> = {
  count: "Cantidad de elementos",
  sum: "Suma",
  avg: "Promedio",
  min: "Mínimo",
  max: "Máximo",
  pct_done: "% terminado",
};

export const COND_OPS = ["is", "is_not", "empty", "not_empty", "last_days", "next_days", "before_today", "this_month"] as const;
export type CondOp = (typeof COND_OPS)[number];
export const COND_LABELS: Record<CondOp, string> = {
  is: "es",
  is_not: "no es",
  empty: "está vacío",
  not_empty: "tiene valor",
  last_days: "en los últimos N días",
  next_days: "en los próximos N días",
  before_today: "ya pasó (vencido)",
  this_month: "es de este mes",
};
export const DATE_OPS: CondOp[] = ["last_days", "next_days", "before_today", "this_month", "empty", "not_empty"];
export const VALUE_OPS: CondOp[] = ["is", "is_not", "empty", "not_empty"];

export const STATES = ["all", "open", "done", "overdue"] as const;
export type StateFilter = (typeof STATES)[number];
export const STATE_LABELS: Record<StateFilter, string> = { all: "Todos", open: "Pendientes", done: "Terminados", overdue: "Vencidos" };

/** Anchos rápidos (de 12 columnas) y altos rápidos (en filas de la grilla). */
export const WIDTHS = [3, 4, 6, 8, 12] as const;
export const HEIGHTS = [2, 4, 6, 8] as const;
export const MAX_ROWS = 20;
/** Alto en filas: `rows` (nuevo) o el alto anterior `h` (1 h = 2 filas). */
export const rowsOf = (w: { rows?: number; h: number }) => w.rows ?? w.h * 2;

const id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const field = z.string().min(1).max(220);

const conditionSchema = z.object({
  field,
  op: z.enum(COND_OPS),
  values: z.array(z.string().max(220)).max(50).default([]),
});

const filtersSchema = z.object({
  boards: z.array(z.uuid()).max(100).default([]),
  state: z.enum(STATES).default("all"),
  subitems: z.boolean().default(false),
  conditions: z.array(conditionSchema).max(10).default([]),
});

export const widgetSchema = z.object({
  id,
  type: z.enum(WIDGET_TYPES),
  title: z.string().max(80).default(""),
  w: z.number().int().min(1).max(12).default(6),
  /** Alto anterior (en bloques grandes); se conserva por compatibilidad. */
  h: z.number().int().min(1).max(10).default(2),
  /** Alto en filas de la grilla (cada fila ≈ 67 px). */
  rows: z.number().int().min(1).max(MAX_ROWS).optional(),
  dim: z.object({ field, period: z.enum(PERIODS).optional() }).optional(),
  split: z.object({ field, period: z.enum(PERIODS).optional() }).optional(),
  metric: z.object({ op: z.enum(METRIC_OPS).default("count"), field: field.optional() }).default({ op: "count" }),
  filters: filtersSchema.default({ boards: [], state: "all", subitems: false, conditions: [] }),
  options: z
    .object({
      sort: z.enum(["label", "value_desc", "value_asc"]).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      showValues: z.boolean().optional(),
      cumulative: z.boolean().optional(),
      percent: z.boolean().optional(),
      prefix: z.string().max(6).optional(),
      suffix: z.string().max(10).optional(),
      decimals: z.number().int().min(0).max(4).optional(),
      goal: z.number().finite().optional(),
      text: z.string().max(2000).optional(),
      fields: z.array(field).max(8).optional(),
      emptyCategories: z.boolean().optional(),
    })
    .default({}),
});

export type Widget = z.infer<typeof widgetSchema>;
export type WidgetInput = z.input<typeof widgetSchema>;
export type Condition = z.infer<typeof conditionSchema>;
export type WidgetFilters = z.infer<typeof filtersSchema>;

export const widgetsSchema = z.array(widgetSchema).max(60, { message: "Hasta 60 widgets por dashboard." });

export function newWidgetId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function blankWidget(type: WidgetType): Widget {
  const base = widgetSchema.parse({ id: newWidgetId(), type });
  switch (type) {
    case "kpi":
      return { ...base, title: "Elementos", w: 3, rows: 2 };
    case "text":
      return { ...base, title: "Título", w: 12, rows: 2, options: { text: "" } };
    case "line":
    case "area":
      return { ...base, title: "Terminados por semana", w: 6, dim: { field: "done_at", period: "week" }, filters: { ...base.filters, state: "done" } };
    case "pie":
    case "donut":
      return { ...base, title: "Por estado", w: 4, dim: { field: "status" } };
    case "progress":
      return { ...base, title: "Avance por tablero", w: 6, dim: { field: "board" }, split: { field: "status" } };
    case "stacked":
      return { ...base, title: "Estado por tablero", w: 6, dim: { field: "board" }, split: { field: "status" } };
    case "pivot":
      return { ...base, title: "Responsable × estado", w: 6, dim: { field: "assignee" }, split: { field: "status" } };
    case "list":
      return { ...base, title: "Vencidos", w: 6, filters: { ...base.filters, state: "overdue" }, options: { fields: ["board", "assignee", "due"], limit: 20 } };
    case "hbar":
      return { ...base, title: "Pendientes por persona", w: 6, dim: { field: "assignee" }, filters: { ...base.filters, state: "open" }, options: { sort: "value_desc" } };
    default:
      return { ...base, title: "Por estado", w: 6, dim: { field: "status" } };
  }
}

/** Dashboard de partida: un resumen general de la empresa. */
export function templateWidgets(kind: "blank" | "summary"): Widget[] {
  if (kind === "blank") return [];
  const w = (x: Partial<Widget> & { type: WidgetType }): Widget => widgetSchema.parse({ id: newWidgetId(), ...x });
  return [
    w({ type: "kpi", title: "Elementos", w: 3, rows: 2 }),
    w({ type: "kpi", title: "Terminados", w: 3, rows: 2, metric: { op: "pct_done" } }),
    w({ type: "kpi", title: "Vencidos", w: 3, rows: 2, filters: { boards: [], state: "overdue", subitems: false, conditions: [] } }),
    w({
      type: "kpi",
      title: "Vencen en 7 días",
      w: 3,
      rows: 2,
      filters: { boards: [], state: "open", subitems: false, conditions: [{ field: "due", op: "next_days", values: ["7"] }] },
    }),
    w({ type: "progress", title: "Avance por tablero", w: 8, rows: 4, dim: { field: "board" }, split: { field: "status" } }),
    w({ type: "donut", title: "Por prioridad", w: 4, rows: 4, dim: { field: "priority" }, filters: { boards: [], state: "open", subitems: false, conditions: [] } }),
    w({ type: "hbar", title: "Pendientes por persona", w: 6, rows: 4, dim: { field: "assignee" }, filters: { boards: [], state: "open", subitems: false, conditions: [] }, options: { sort: "value_desc" } }),
    w({ type: "line", title: "Terminados por semana", w: 6, rows: 4, dim: { field: "done_at", period: "week" }, filters: { boards: [], state: "done", subitems: false, conditions: [{ field: "done_at", op: "last_days", values: ["90"] }] } }),
    w({ type: "list", title: "Vencidos", w: 12, rows: 4, filters: { boards: [], state: "overdue", subitems: false, conditions: [] }, options: { fields: ["board", "assignee", "due", "status"], limit: 20 } }),
  ];
}
