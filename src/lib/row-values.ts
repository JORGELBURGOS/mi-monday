import { FormulaError, runFormula, type FValue, type FormulaResult } from "@/lib/formula";
import { readValues, parseTimeline, type BoardColumn, type CellValue } from "@/lib/columns";
import { BUILTIN_DEFAULT_LABELS, builtinLabel, priorityLabel, type BoardSettings } from "@/lib/board-settings";
import type { Group, Member, Status, Task } from "@/lib/data";

/** Todo lo que hace falta para calcular columnas de una fila. */
export type RowEnv = {
  columns: BoardColumn[];
  statuses: Status[];
  groups: Group[];
  members: Member[];
  settings: BoardSettings;
  today: string;
  now: string;
};

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();

const personName = (members: Member[], id: string | null | undefined) => {
  if (!id) return "";
  const m = members.find((x) => x.user_id === id);
  return m ? m.full_name?.trim() || m.email || "" : "";
};

const localStamp = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Código corto y estable de un ítem (los primeros 8 caracteres del id). */
export const itemCode = (id: string) => id.replace(/-/g, "").slice(0, 8).toUpperCase();

/** Valor de una columna propia tal como lo ve una fórmula. */
function columnFormulaValue(task: Task, col: BoardColumn, env: RowEnv, part: string | null, stack: string[]): FValue {
  const v = readValues(task.custom_values)[col.id];
  switch (col.kind) {
    case "formula": {
      if (stack.includes(col.id)) throw new FormulaError("hay fórmulas que se usan entre sí en círculo.");
      const r = formulaValue(task, col, env, [...stack, col.id]);
      if (!r.ok) throw new FormulaError(r.error);
      return r.value;
    }
    case "item_id":
      return itemCode(task.id);
    case "created_log":
      return localStamp(task.created_at);
    case "updated_log":
      return localStamp(task.updated_at);
    case "number":
    case "rating":
      return typeof v === "number" ? v : null;
    case "checkbox":
      return v === true;
    case "list":
      return col.options.find((o) => o.id === v)?.label ?? "";
    case "tags":
      return (Array.isArray(v) ? v : [])
        .map((id) => col.options.find((o) => o.id === id)?.label)
        .filter(Boolean)
        .join(", ");
    case "person":
      return personName(env.members, typeof v === "string" ? v : null);
    case "timeline": {
      const t = parseTimeline(v);
      if (!t) return "";
      if (part === "start" || part === "inicio") return t.start;
      if (part === "end" || part === "fin") return t.end;
      return `${t.start} - ${t.end}`;
    }
    default:
      return v === undefined ? "" : Array.isArray(v) ? v.join(", ") : (v as FValue);
  }
}

function resolverFor(task: Task, env: RowEnv, stack: string[]) {
  return (rawName: string): FValue | undefined => {
    const [namePart, partRaw] = rawName.split("#");
    const name = norm(namePart);
    const part = partRaw ? norm(partRaw) : null;

    const col = env.columns.find((c) => norm(c.name) === name);
    if (col) {
      try {
        return columnFormulaValue(task, col, env, part, stack);
      } catch (e) {
        throw new FormulaError(`{${namePart.trim()}}: ${e instanceof Error ? e.message : "no se pudo calcular."}`);
      }
    }
    const is = (key: keyof typeof BUILTIN_DEFAULT_LABELS, ...aliases: string[]) =>
      [BUILTIN_DEFAULT_LABELS[key], builtinLabel(env.settings, key), ...aliases].some((l) => norm(l) === name);
    if (is("title", "Nombre", "Tarea", "Item", "Ítem")) return task.title;
    if (is("status")) return env.statuses.find((s) => s.id === task.status_id)?.label ?? "";
    if (is("priority")) return priorityLabel(env.settings, task.priority).label;
    if (is("assignee", "Persona", "Personas")) return personName(env.members, task.assignee_id);
    if (is("due", "Fecha de vencimiento")) return task.due_date ?? "";
    if (["carpeta", "grupo", "group"].includes(name)) return env.groups.find((g) => g.id === task.group_id)?.name ?? "";
    if (["descripcion", "description"].includes(name)) return task.description ?? "";
    return undefined;
  };
}

export function formulaValue(task: Task, col: BoardColumn, env: RowEnv, stack: string[] = [col.id]): FormulaResult {
  const src = col.settings.formula?.trim();
  if (!src) return { ok: false, error: "Escribí la fórmula en la configuración de la columna." };
  return runFormula(src, { resolve: resolverFor(task, env, stack), today: env.today, now: env.now });
}

/**
 * Valor numérico de una celda para ordenar y resumir (o texto si no es número).
 * Las columnas calculadas se evalúan.
 */
export function sortableValue(task: Task, col: BoardColumn, env: RowEnv): string | number | null {
  const v: CellValue | undefined = readValues(task.custom_values)[col.id];
  switch (col.kind) {
    case "formula": {
      const r = formulaValue(task, col, env);
      if (!r.ok || r.value === null || r.value === "") return null;
      return typeof r.value === "number" ? r.value : typeof r.value === "boolean" ? Number(r.value) : r.value;
    }
    case "item_id":
      return itemCode(task.id);
    case "created_log":
      return task.created_at;
    case "updated_log":
      return task.updated_at;
    case "list": {
      const i = col.options.findIndex((o) => o.id === v);
      return i >= 0 ? i : null;
    }
    case "tags":
      return Array.isArray(v) && v.length ? (col.options.find((o) => o.id === v[0])?.label ?? null) : null;
    case "person":
      return personName(env.members, typeof v === "string" ? v : null) || null;
    case "checkbox":
      return v === true ? 1 : 0;
    case "timeline":
      return parseTimeline(v)?.start ?? null;
    default:
      if (v === undefined || v === "") return null;
      return typeof v === "number" ? v : Array.isArray(v) ? v.join(", ") : String(v);
  }
}
