import { PRIORITIES, type ColorName } from "@/lib/constants";
import { COLUMN_KIND_LABELS, checklistProgress, parseTimeline, stringList, type BoardColumn, type CellValue, type ColumnKind } from "@/lib/columns";
import {
  BASE_FIELDS,
  DATE_BASE_FIELDS,
  FIELD_LABELS,
  METRIC_LABELS,
  PERIOD_LABELS,
  type Condition,
  type Period,
  type StateFilter,
  type Widget,
} from "@/lib/dashboards";

/* -------------------------------------------------------------------------- */
/*  Datos que recibe el dashboard (solo lo que la persona puede ver)          */
/* -------------------------------------------------------------------------- */

export type DsStatus = { id: string; label: string; color: string | null; is_done: boolean; position: number };
export type DsBoard = {
  id: string;
  name: string;
  statuses: DsStatus[];
  groups: { id: string; name: string; position: number }[];
  columns: BoardColumn[];
};
export type DsTask = {
  id: string;
  board_id: string;
  group_id: string;
  status_id: string | null;
  parent_id: string | null;
  title: string;
  priority: string;
  assignee_id: string | null;
  /** Todos los responsables (personas) y equipos. */
  assignee_ids?: string[];
  team_ids?: string[];
  due_date: string | null;
  /** Fechas en hora de Argentina (AAAA-MM-DD). */
  created_on: string;
  updated_on: string;
  done_on: string | null;
  values: Record<string, CellValue>;
};
export type DsMember = { user_id: string; full_name: string | null; email: string | null };
export type DsTeam = { id: string; name: string };
export type Dataset = { boards: DsBoard[]; tasks: DsTask[]; members: DsMember[]; teams?: DsTeam[]; today: string };

/** Personas y equipos responsables de un elemento. */
const peopleOf = (t: DsTask) => (t.assignee_ids?.length ? t.assignee_ids : t.assignee_id ? [t.assignee_id] : []);

export type GlobalFilters = { boards: string[]; assignee: string; state: StateFilter };
export const NO_GLOBAL_FILTERS: GlobalFilters = { boards: [], assignee: "", state: "all" };

/* -------------------------------------------------------------------------- */
/*  Catálogo de campos                                                        */
/* -------------------------------------------------------------------------- */

export type FieldType = "category" | "date" | "number";
export type FieldInfo = { key: string; label: string; type: FieldType; multi?: boolean; colKind?: ColumnKind };

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
export const columnKey = (c: Pick<BoardColumn, "name" | "kind">) => `col:${norm(c.name)}|${c.kind}`;

const CATEGORY_KINDS: ColumnKind[] = ["list", "tags", "person", "people", "checkbox", "text", "rating", "link", "email", "phone", "hour", "checklist"];
const DATE_KINDS: ColumnKind[] = ["date", "timeline"];
const NUMBER_KINDS: ColumnKind[] = ["number", "rating", "checklist"];

/** Todos los campos disponibles en los tableros del dataset (las columnas se unen por nombre y tipo). */
export function fieldCatalog(ds: Dataset): FieldInfo[] {
  const out: FieldInfo[] = BASE_FIELDS.map((k) => ({ key: k, label: FIELD_LABELS[k], type: DATE_BASE_FIELDS.includes(k) ? "date" : "category", ...(k === "assignee" ? { multi: true } : {}) }));
  const seen = new Map<string, FieldInfo>();
  for (const b of ds.boards) {
    for (const c of b.columns) {
      const key = columnKey(c);
      if (seen.has(key)) continue;
      if (CATEGORY_KINDS.includes(c.kind)) seen.set(key, { key, label: c.name, type: "category", multi: c.kind === "tags" || c.kind === "people", colKind: c.kind });
      else if (DATE_KINDS.includes(c.kind)) seen.set(key, { key, label: c.name, type: "date", colKind: c.kind });
      else if (c.kind === "number") seen.set(key, { key, label: c.name, type: "number", colKind: c.kind });
    }
  }
  // Nombres repetidos con distinto tipo: se aclara el tipo.
  const names = new Map<string, number>();
  for (const f of seen.values()) names.set(f.label, (names.get(f.label) ?? 0) + 1);
  for (const f of seen.values()) out.push(names.get(f.label)! > 1 && f.colKind ? { ...f, label: `${f.label} (${COLUMN_KIND_LABELS[f.colKind]})` } : f);
  return out;
}

/** Columnas numéricas para sumar / promediar (incluye calificación y avance de checklist). */
export function numberFields(ds: Dataset): FieldInfo[] {
  const out = new Map<string, FieldInfo>();
  for (const b of ds.boards)
    for (const c of b.columns)
      if (NUMBER_KINDS.includes(c.kind)) {
        const key = columnKey(c);
        if (!out.has(key)) out.set(key, { key, label: c.kind === "checklist" ? `Avance de «${c.name}» (%)` : c.name, type: "number", colKind: c.kind });
      }
  return [...out.values()];
}

export function fieldLabel(ds: Dataset, key: string | undefined) {
  if (!key) return "";
  return FIELD_LABELS[key] ?? fieldCatalog(ds).find((f) => f.key === key)?.label ?? numberFields(ds).find((f) => f.key === key)?.label ?? "Columna";
}

/* -------------------------------------------------------------------------- */
/*  Índices                                                                   */
/* -------------------------------------------------------------------------- */

type Index = {
  board: Map<string, DsBoard>;
  boardOrder: Map<string, number>;
  status: Map<string, DsStatus>;
  group: Map<string, { name: string; position: number }>;
  member: Map<string, string>;
  /** board_id → columnKey → columna */
  cols: Map<string, Map<string, BoardColumn>>;
};

const indexCache = new WeakMap<Dataset, Index>();
function indexOf(ds: Dataset): Index {
  const hit = indexCache.get(ds);
  if (hit) return hit;
  const idx: Index = { board: new Map(), boardOrder: new Map(), status: new Map(), group: new Map(), member: new Map(), cols: new Map() };
  ds.boards.forEach((b, i) => {
    idx.board.set(b.id, b);
    idx.boardOrder.set(b.id, i);
    for (const s of b.statuses) idx.status.set(s.id, s);
    for (const g of b.groups) idx.group.set(g.id, g);
    const m = new Map<string, BoardColumn>();
    for (const c of b.columns) if (!m.has(columnKey(c))) m.set(columnKey(c), c);
    idx.cols.set(b.id, m);
  });
  for (const m of ds.members) idx.member.set(m.user_id, m.full_name?.trim() || m.email || "Sin nombre");
  indexCache.set(ds, idx);
  return idx;
}

export const isDone = (ds: Dataset, t: DsTask) => Boolean(t.status_id && indexOf(ds).status.get(t.status_id)?.is_done);

/* -------------------------------------------------------------------------- */
/*  Categorías de un elemento                                                 */
/* -------------------------------------------------------------------------- */

export type Cat = { key: string; label: string; color?: ColorName | null; order?: number };
export const NONE = "__none";
export const OTHER = "__other";

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const parseIso = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
};
const toIso = (d: Date) => d.toISOString().slice(0, 10);

export function bucketOf(iso: string, period: Period): Cat {
  const d = parseIso(iso);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (period) {
    case "day":
      return { key: toIso(d), label: `${d.getUTCDate()} ${MONTHS[m]}` };
    case "week": {
      const dow = (d.getUTCDay() + 6) % 7; // lunes = 0
      const mon = new Date(d.getTime() - dow * 86400000);
      return { key: toIso(mon), label: `${mon.getUTCDate()} ${MONTHS[mon.getUTCMonth()]}` };
    }
    case "month":
      return { key: `${y}-${String(m + 1).padStart(2, "0")}`, label: `${MONTHS[m]} ${String(y).slice(2)}` };
    case "quarter":
      return { key: `${y}-T${Math.floor(m / 3) + 1}`, label: `T${Math.floor(m / 3) + 1} ${y}` };
    default:
      return { key: String(y), label: String(y) };
  }
}

function nextBucket(key: string, period: Period): string {
  switch (period) {
    case "day":
      return toIso(new Date(parseIso(key).getTime() + 86400000));
    case "week":
      return toIso(new Date(parseIso(key).getTime() + 7 * 86400000));
    case "month": {
      const [y, m] = key.split("-").map(Number);
      return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    }
    case "quarter": {
      const [y, q] = key.split("-T").map(Number);
      return q === 4 ? `${y + 1}-T1` : `${y}-T${q + 1}`;
    }
    default:
      return String(Number(key) + 1);
  }
}

function labelOfBucket(key: string, period: Period): string {
  if (period === "quarter") {
    const [y, q] = key.split("-T");
    return `T${q} ${y}`;
  }
  if (period === "year") return key;
  return bucketOf(period === "month" ? `${key}-01` : key, period).label;
}

/** Valor de fecha (AAAA-MM-DD) de un campo para un elemento. */
export function dateOf(ds: Dataset, t: DsTask, field: string): string | null {
  switch (field) {
    case "due":
      return t.due_date;
    case "created":
      return t.created_on;
    case "updated":
      return t.updated_on;
    case "done_at":
      return t.done_on;
  }
  const col = indexOf(ds).cols.get(t.board_id)?.get(field);
  if (!col) return null;
  const v = t.values[col.id];
  if (col.kind === "date") return typeof v === "string" && v ? v.slice(0, 10) : null;
  if (col.kind === "timeline") return parseTimeline(v)?.start ?? null;
  return null;
}

/** Valor numérico de un campo (columnas de número, calificación o avance de checklist en %). */
export function numberOf(ds: Dataset, t: DsTask, field: string | undefined): number | null {
  if (!field) return null;
  const col = indexOf(ds).cols.get(t.board_id)?.get(field);
  if (!col) return null;
  const v = t.values[col.id];
  if (col.kind === "checklist") {
    const p = checklistProgress(v);
    return p.total ? (p.done / p.total) * 100 : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

const PRIORITY_ORDER = new Map(PRIORITIES.map((p, i) => [p.value as string, i]));

/** Categorías de un elemento para un campo (varias si es de selección múltiple). */
export function catsOf(ds: Dataset, t: DsTask, field: string, period?: Period): Cat[] {
  const idx = indexOf(ds);
  if (DATE_BASE_FIELDS.includes(field) || (field.startsWith("col:") && /\|(date|timeline)$/.test(field))) {
    const d = dateOf(ds, t, field);
    return d ? [bucketOf(d, period ?? "month")] : [{ key: NONE, label: "Sin fecha" }];
  }
  switch (field) {
    case "board": {
      const b = idx.board.get(t.board_id);
      return [{ key: t.board_id, label: b?.name ?? "Tablero", order: idx.boardOrder.get(t.board_id) }];
    }
    case "status": {
      const s = t.status_id ? idx.status.get(t.status_id) : undefined;
      return s ? [{ key: norm(s.label), label: s.label, color: (s.color as ColorName) ?? null, order: s.position }] : [{ key: NONE, label: "Sin estado", order: 9999 }];
    }
    case "group": {
      const g = idx.group.get(t.group_id);
      return [{ key: g ? norm(g.name) : NONE, label: g?.name ?? "Sin carpeta", order: g?.position }];
    }
    case "assignee": {
      const people = peopleOf(t).map((id) => ({ key: id, label: idx.member.get(id) ?? "Ex miembro" }));
      const teams = (t.team_ids ?? []).map((id) => ({ key: id, label: `Equipo ${ds.teams?.find((x) => x.id === id)?.name ?? ""}`.trim() }));
      return people.length + teams.length ? [...teams, ...people] : [{ key: NONE, label: "Sin responsable", order: 9999 }];
    }
    case "priority": {
      const p = PRIORITIES.find((x) => x.value === t.priority);
      return [{ key: t.priority, label: p?.label ?? t.priority, color: p?.color ?? null, order: PRIORITY_ORDER.get(t.priority) }];
    }
    case "state": {
      if (isDone(ds, t)) return [{ key: "done", label: "Terminado", color: "green", order: 2 }];
      if (t.due_date && t.due_date < ds.today) return [{ key: "overdue", label: "Vencido", color: "red", order: 1 }];
      return [{ key: "open", label: "Pendiente", color: "blue", order: 0 }];
    }
    case "subitem":
      return t.parent_id ? [{ key: "sub", label: "Subelemento", order: 1 }] : [{ key: "item", label: "Elemento", order: 0 }];
  }
  const col = idx.cols.get(t.board_id)?.get(field);
  if (!col) return [{ key: NONE, label: "Sin valor", order: 9999 }];
  const v = t.values[col.id];
  const none: Cat[] = [{ key: NONE, label: "Sin valor", order: 9999 }];
  switch (col.kind) {
    case "list": {
      const o = col.options.find((x) => x.id === v);
      return o ? [{ key: norm(o.label), label: o.label, color: o.color, order: col.options.indexOf(o) }] : none;
    }
    case "tags": {
      const list = stringList(v)
        .map((id) => col.options.find((x) => x.id === id))
        .filter((o): o is NonNullable<typeof o> => Boolean(o))
        .map((o) => ({ key: norm(o.label), label: o.label, color: o.color, order: col.options.indexOf(o) }));
      return list.length ? list : none;
    }
    case "person":
      return typeof v === "string" && v ? [{ key: v, label: idx.member.get(v) ?? "Ex miembro" }] : none;
    case "people": {
      const list = stringList(v).map((id) => ({ key: id, label: idx.member.get(id) ?? "Ex miembro" }));
      return list.length ? list : none;
    }
    case "checkbox":
      return v ? [{ key: "yes", label: "Sí", order: 0 }] : [{ key: "no", label: "No", order: 1 }];
    case "checklist": {
      const p = checklistProgress(v);
      if (!p.total) return [{ key: NONE, label: "Sin checklist", order: 9 }];
      if (p.done === p.total) return [{ key: "complete", label: "Completo", color: "green", order: 2 }];
      if (p.done === 0) return [{ key: "todo", label: "Sin empezar", color: "gray", order: 0 }];
      return [{ key: "doing", label: "En curso", color: "blue", order: 1 }];
    }
    case "rating":
      return typeof v === "number" && v > 0 ? [{ key: String(v), label: "★".repeat(v), order: -v }] : none;
    default: {
      const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
      return s ? [{ key: norm(s), label: s.length > 40 ? `${s.slice(0, 40)}…` : s }] : none;
    }
  }
}

/** Valores posibles de un campo (para armar filtros). */
export function optionsOf(ds: Dataset, field: string): Cat[] {
  const out = new Map<string, Cat>();
  if (field === "board") ds.boards.forEach((b, i) => out.set(b.id, { key: b.id, label: b.name, order: i }));
  if (field === "assignee") {
    for (const t of ds.teams ?? []) out.set(t.id, { key: t.id, label: `Equipo ${t.name}` });
    for (const m of ds.members) out.set(m.user_id, { key: m.user_id, label: m.full_name?.trim() || m.email || "Sin nombre" });
  }
  if (field === "priority") for (const p of PRIORITIES) out.set(p.value, { key: p.value, label: p.label, color: p.color, order: PRIORITY_ORDER.get(p.value) });
  if (field === "status") for (const b of ds.boards) for (const s of b.statuses) if (!out.has(norm(s.label))) out.set(norm(s.label), { key: norm(s.label), label: s.label, color: s.color as ColorName, order: s.position });
  if (field.startsWith("col:") && /\|(list|tags)$/.test(field))
    for (const b of ds.boards) {
      const c = indexOf(ds).cols.get(b.id)?.get(field);
      c?.options.forEach((o, i) => out.has(norm(o.label)) || out.set(norm(o.label), { key: norm(o.label), label: o.label, color: o.color, order: i }));
    }
  for (const t of ds.tasks) for (const c of catsOf(ds, t, field)) if (!out.has(c.key)) out.set(c.key, c);
  return sortCats([...out.values()]);
}

export function sortCats(list: Cat[]) {
  return list.sort((a, b) => (a.order ?? 500) - (b.order ?? 500) || a.label.localeCompare(b.label, "es"));
}

/* -------------------------------------------------------------------------- */
/*  Filtros                                                                   */
/* -------------------------------------------------------------------------- */

function addDays(iso: string, n: number) {
  return toIso(new Date(parseIso(iso).getTime() + n * 86400000));
}

function matchCondition(ds: Dataset, t: DsTask, c: Condition): boolean {
  const isDate = DATE_BASE_FIELDS.includes(c.field) || (c.field.startsWith("col:") && /\|(date|timeline)$/.test(c.field));
  if (isDate) {
    const d = dateOf(ds, t, c.field);
    const n = Math.max(0, Math.min(3650, Number(c.values[0] ?? 0) || 0));
    switch (c.op) {
      case "empty":
        return !d;
      case "not_empty":
        return Boolean(d);
      case "last_days":
        return Boolean(d && d <= ds.today && d >= addDays(ds.today, -n));
      case "next_days":
        return Boolean(d && d >= ds.today && d <= addDays(ds.today, n));
      case "before_today":
        return Boolean(d && d < ds.today);
      case "this_month":
        return Boolean(d && d.slice(0, 7) === ds.today.slice(0, 7));
      default: {
        const keys = d ? [d] : [NONE];
        return c.op === "is" ? keys.some((k) => c.values.includes(k)) : !keys.some((k) => c.values.includes(k));
      }
    }
  }
  const cats = catsOf(ds, t, c.field);
  const empty = cats.every((x) => x.key === NONE);
  switch (c.op) {
    case "empty":
      return empty;
    case "not_empty":
      return !empty;
    case "is":
      return c.values.length === 0 || cats.some((x) => c.values.includes(x.key));
    case "is_not":
      return !cats.some((x) => c.values.includes(x.key));
    default:
      return true;
  }
}

function matchState(ds: Dataset, t: DsTask, state: StateFilter) {
  if (state === "all") return true;
  const done = isDone(ds, t);
  if (state === "done") return done;
  if (state === "open") return !done;
  return !done && Boolean(t.due_date && t.due_date < ds.today);
}

/** Elementos que entran en un widget (sus filtros + los filtros generales del dashboard). */
export function filterTasks(ds: Dataset, w: Pick<Widget, "filters">, g: GlobalFilters = NO_GLOBAL_FILTERS): DsTask[] {
  const f = w.filters;
  return ds.tasks.filter((t) => {
    if (!f.subitems && t.parent_id) return false;
    if (f.boards.length && !f.boards.includes(t.board_id)) return false;
    if (g.boards.length && !g.boards.includes(t.board_id)) return false;
    if (g.assignee) {
      const all = [...peopleOf(t), ...(t.team_ids ?? [])];
      if (g.assignee === NONE ? all.length > 0 : !all.includes(g.assignee)) return false;
    }
    if (!matchState(ds, t, f.state) || !matchState(ds, t, g.state)) return false;
    return f.conditions.every((c) => matchCondition(ds, t, c));
  });
}

/* -------------------------------------------------------------------------- */
/*  Métricas                                                                  */
/* -------------------------------------------------------------------------- */

export function aggregate(ds: Dataset, tasks: DsTask[], metric: Widget["metric"]): number | null {
  if (metric.op === "count") return tasks.length;
  if (metric.op === "pct_done") return tasks.length ? (tasks.filter((t) => isDone(ds, t)).length / tasks.length) * 100 : null;
  const nums = tasks.map((t) => numberOf(ds, t, metric.field)).filter((n): n is number => n !== null);
  if (!nums.length) return metric.op === "sum" ? 0 : null;
  switch (metric.op) {
    case "sum":
      return nums.reduce((a, b) => a + b, 0);
    case "avg":
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case "min":
      return Math.min(...nums);
    case "max":
      return Math.max(...nums);
  }
  return null;
}

export function metricLabel(ds: Dataset, metric: Widget["metric"]) {
  if (metric.op === "count" || metric.op === "pct_done") return METRIC_LABELS[metric.op];
  return `${METRIC_LABELS[metric.op]} de ${fieldLabel(ds, metric.field)}`;
}

export function formatValue(n: number | null, w: Pick<Widget, "metric" | "options">, opts: { compact?: boolean; percent?: boolean } = {}): string {
  if (n === null || !Number.isFinite(n)) return "—";
  const pct = opts.percent || w.metric.op === "pct_done";
  const decimals = w.options.decimals ?? (pct || w.metric.op === "avg" ? (Math.abs(n) < 10 && !Number.isInteger(n) ? 1 : 0) : Number.isInteger(n) ? 0 : 1);
  const text = new Intl.NumberFormat("es-AR", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: w.options.decimals ?? 0,
    notation: opts.compact && Math.abs(n) >= 100000 ? "compact" : "standard",
  }).format(n);
  if (pct) return `${text}%`;
  return `${w.options.prefix ?? ""}${text}${w.options.suffix ? ` ${w.options.suffix}` : ""}`;
}

/* -------------------------------------------------------------------------- */
/*  Colores                                                                   */
/* -------------------------------------------------------------------------- */

export const SERIES_SLOTS = 8;
/** Color de una categoría: el de la etiqueta si tiene, si no un color fijo de la paleta (por orden estable). */
export function colorOf(c: Cat, slot: number): string {
  if (c.key === NONE) return "var(--series-none)";
  if (c.key === OTHER) return "var(--series-other)";
  if (c.color) return `var(--chip-${c.color}-dot)`;
  return `var(--series-${(slot % SERIES_SLOTS) + 1})`;
}

/* -------------------------------------------------------------------------- */
/*  Resultados                                                                */
/* -------------------------------------------------------------------------- */

export type SeriesResult = {
  kind: "series";
  categories: (Cat & { fill: string })[];
  series: (Cat & { fill: string })[];
  /** values[serie][categoría] */
  values: (number | null)[][];
  /** ids de los elementos de cada celda (para ver el detalle). */
  ids: string[][][];
  totals: (number | null)[];
  time: boolean;
  metricLabel: string;
};
export type KpiResult = { kind: "kpi"; value: number | null; count: number; ids: string[] };
export type ListResult = { kind: "list"; tasks: DsTask[]; total: number };
export type TextResult = { kind: "text" };
export type WidgetResult = SeriesResult | KpiResult | ListResult | TextResult;

const isTimeField = (f: string | undefined) => Boolean(f && (DATE_BASE_FIELDS.includes(f) || (f.startsWith("col:") && /\|(date|timeline)$/.test(f))));

export function computeWidget(ds: Dataset, w: Widget, g: GlobalFilters = NO_GLOBAL_FILTERS): WidgetResult {
  if (w.type === "text") return { kind: "text" };
  const tasks = filterTasks(ds, w, g);
  if (w.type === "kpi") return { kind: "kpi", value: aggregate(ds, tasks, w.metric), count: tasks.length, ids: tasks.map((t) => t.id) };
  if (w.type === "list") {
    const sorted = sortTasks(ds, tasks, w.options.orderBy ?? { field: "due", dir: "asc" });
    return { kind: "list", tasks: sorted.slice(0, w.options.limit ?? 20), total: tasks.length };
  }
  return computeSeries(ds, w, tasks);
}

/** Valor para ordenar un elemento por un campo (fechas y números como tales; el resto, por texto). */
function sortValue(ds: Dataset, t: DsTask, field: string): string | number | null {
  if (field === "title") return t.title.toLocaleLowerCase("es");
  if (isTimeField(field)) return dateOf(ds, t, field);
  if (field.startsWith("col:") && /\|(number|rating|checklist)$/.test(field)) return numberOf(ds, t, field);
  const cats = catsOf(ds, t, field).filter((c) => c.key !== NONE);
  if (!cats.length) return null;
  // Etiquetas con orden propio (estado, prioridad, opciones): se respeta ese orden.
  const c = cats[0];
  return c.order !== undefined && field !== "board" && field !== "assignee" ? c.order : c.label.toLocaleLowerCase("es");
}

/** Ordena elementos por un campo; los vacíos van siempre al final. */
export function sortTasks(ds: Dataset, tasks: DsTask[], by: { field: string; dir: "asc" | "desc" }): DsTask[] {
  const dir = by.dir === "desc" ? -1 : 1;
  const keyed = tasks.map((t) => ({ t, v: sortValue(ds, t, by.field) }));
  keyed.sort((a, b) => {
    if (a.v === null && b.v === null) return a.t.title.localeCompare(b.t.title, "es");
    if (a.v === null) return 1;
    if (b.v === null) return -1;
    const cmp = typeof a.v === "number" && typeof b.v === "number" ? a.v - b.v : String(a.v).localeCompare(String(b.v), "es", { numeric: true });
    return cmp * dir || a.t.title.localeCompare(b.t.title, "es");
  });
  return keyed.map((x) => x.t);
}

/** Aplica un orden personalizado (claves guardadas); lo que no está en la lista va al final, en su orden. */
function byCustomOrder<T extends { key: string }>(list: T[], order: string[] | undefined): T[] {
  if (!order?.length) return list;
  const pos = new Map(order.map((k, i) => [k, i]));
  return list
    .map((x, i) => ({ x, i }))
    .sort((a, b) => (pos.get(a.x.key) ?? 1e6 + a.i) - (pos.get(b.x.key) ?? 1e6 + b.i))
    .map((y) => y.x);
}

function computeSeries(ds: Dataset, w: Widget, tasks: DsTask[]): SeriesResult {
  const dimField = w.dim?.field ?? "status";
  const time = isTimeField(dimField);
  const period = w.dim?.period ?? "month";
  const splitField = w.split?.field && w.split.field !== dimField ? w.split.field : undefined;
  const splitPeriod = w.split?.period ?? "month";

  // Celdas: categoría × serie → elementos.
  const catMap = new Map<string, Cat>();
  const serMap = new Map<string, Cat>();
  const cells = new Map<string, DsTask[]>();
  const ALL: Cat = { key: "__all", label: metricLabel(ds, w.metric) };
  for (const t of tasks) {
    const cs = catsOf(ds, t, dimField, period);
    const ss = splitField ? catsOf(ds, t, splitField, splitPeriod) : [ALL];
    for (const c of cs) {
      if (!catMap.has(c.key)) catMap.set(c.key, c);
      for (const s of ss) {
        if (!serMap.has(s.key)) serMap.set(s.key, s);
        const k = `${c.key}\u0000${s.key}`;
        const list = cells.get(k);
        if (list) list.push(t);
        else cells.set(k, [t]);
      }
    }
  }
  if (!splitField) serMap.set(ALL.key, ALL);

  // Categorías en orden: cronológico (con huecos) o por etiqueta / valor.
  let cats: Cat[];
  if (time) {
    const keys = [...catMap.keys()].filter((k) => k !== NONE).sort();
    cats = [];
    if (keys.length) {
      let k = keys[0];
      const last = keys[keys.length - 1];
      let guard = 0;
      while (k <= last && guard++ < 400) {
        cats.push(catMap.get(k) ?? { key: k, label: labelOfBucket(k, period) });
        k = nextBucket(k, period);
      }
    }
    if (catMap.has(NONE) && w.options.emptyCategories) cats.push(catMap.get(NONE)!);
  } else {
    cats = sortCats([...catMap.values()]);
  }

  // Colores estables: por el orden natural de todas las categorías / series (no por ranking).
  const stableCats = sortCats([...catMap.values()]).filter((c) => c.key !== NONE);
  const stableSeries = sortCats([...serMap.values()]).filter((c) => c.key !== NONE);
  const catSlot = new Map(stableCats.map((c, i) => [c.key, i]));
  const serSlot = new Map(stableSeries.map((c, i) => [c.key, i]));

  const cellTasks = (c: string, s: string) => cells.get(`${c}\u0000${s}`) ?? [];
  const catTotal = (c: string) => aggregate(ds, [...new Set([...serMap.keys()].flatMap((s) => cellTasks(c, s)))], w.metric);

  if (!time && w.options.sort === "custom") cats = byCustomOrder(cats, w.options.catOrder);
  else if (!time && w.options.sort && w.options.sort !== "label") {
    const dir = w.options.sort === "value_desc" ? -1 : 1;
    cats.sort((a, b) => dir * ((catTotal(a.key) ?? 0) - (catTotal(b.key) ?? 0)));
  }

  // Límite de categorías: el resto va a "Otros". Torta y dona: máximo 8 porciones.
  const pie = w.type === "pie" || w.type === "donut";
  const limit = time ? undefined : (w.options.limit ?? (pie ? 8 : undefined));
  let other: string[] = [];
  if (limit && cats.length > limit) {
    if (!w.options.sort || w.options.sort === "label" || w.options.sort === "custom") cats.sort((a, b) => (catTotal(b.key) ?? 0) - (catTotal(a.key) ?? 0));
    other = cats.slice(limit - 1).map((c) => c.key);
    cats = [...cats.slice(0, limit - 1), { key: OTHER, label: "Otros" }];
  }

  // Series: máximo 8 con color propio; el resto, "Otros".
  // Las tablas pueden tener más columnas (no dependen de colores distintos).
  const maxSeries = w.type === "pivot" ? 30 : SERIES_SLOTS;
  let series = byCustomOrder(sortCats([...serMap.values()]), w.options.seriesOrder);
  let otherSeries: string[] = [];
  if (series.length > maxSeries) {
    const tot = (s: string) => aggregate(ds, [...new Set([...catMap.keys()].flatMap((c) => cellTasks(c, s)))], w.metric) ?? 0;
    series.sort((a, b) => tot(b.key) - tot(a.key));
    otherSeries = series.slice(maxSeries - 1).map((s) => s.key);
    series = [...byCustomOrder(sortCats(series.slice(0, maxSeries - 1)), w.options.seriesOrder), { key: OTHER, label: "Otros" }];
  }

  const tasksIn = (c: string, s: string) => {
    const cs = c === OTHER ? other : [c];
    const ss = s === OTHER ? otherSeries : [s];
    const set = new Set<DsTask>();
    for (const ci of cs) for (const si of ss) for (const t of cellTasks(ci, si)) set.add(t);
    return [...set];
  };

  const values: (number | null)[][] = [];
  const ids: string[][][] = [];
  for (const s of series) {
    const row: (number | null)[] = [];
    const idRow: string[][] = [];
    let running = 0;
    for (const c of cats) {
      const list = tasksIn(c.key, s.key);
      let v = list.length || w.metric.op === "count" ? aggregate(ds, list, w.metric) : null;
      if (w.options.cumulative && v !== null) {
        running += v;
        v = running;
      }
      row.push(v);
      idRow.push(list.map((t) => t.id));
    }
    values.push(row);
    ids.push(idRow);
  }
  const totals = cats.map((c) => aggregate(ds, [...new Set(series.flatMap((s) => tasksIn(c.key, s.key)))], w.metric));

  const singleSeries = !splitField;
  const colored = (list: Cat[], slots: Map<string, number>, fallback: (i: number) => number) =>
    list.map((c, i) => ({ ...c, fill: colorOf(c, slots.get(c.key) ?? fallback(i)) }));

  return {
    kind: "series",
    // Sin segunda categoría, las barras/porciones toman el color de su categoría (si es una etiqueta) o el primer color.
    categories: colored(cats, catSlot, (i) => i).map((c) => (singleSeries && !pie && !c.color && c.key !== NONE && c.key !== OTHER ? { ...c, fill: "var(--series-1)" } : c)),
    series: colored(series, serSlot, (i) => i),
    values,
    ids,
    totals,
    time,
    metricLabel: metricLabel(ds, w.metric),
  };
}

export function describeDim(ds: Dataset, d: Widget["dim"]) {
  if (!d) return "";
  return `${fieldLabel(ds, d.field)}${isTimeField(d.field) ? ` (por ${PERIOD_LABELS[d.period ?? "month"].toLowerCase()})` : ""}`;
}

export { isTimeField };
