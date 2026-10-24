import { PRIORITY_BY_VALUE, type Priority } from "@/lib/constants";
import { formatDueDate, todayIsoLocal } from "@/lib/format";
import { valueLabel, type BoardColumn, type CellValue } from "@/lib/columns";

type Person = { user_id: string; full_name: string | null; email: string | null };

export type HistoryLookup = { columns?: BoardColumn[]; members?: Person[] };

/** Un cambio del historial, listo para mostrar: qué campo, antes y después. */
export type DescribedChange = {
  /** Grupo para filtrar: estado, checklist, columnas, actualizaciones, item. */
  group: "status" | "checklist" | "columns" | "comments" | "item";
  field: string;
  from: string | null;
  to: string | null;
  /** Frase completa (para cuando no hay antes/después). */
  text: string;
};

function str(v: unknown) {
  return typeof v === "string" && v ? v : null;
}

function priorityLabel(v: unknown) {
  const s = str(v);
  return s ? PRIORITY_BY_VALUE[s as Priority]?.label ?? s : null;
}

function dueLabel(v: unknown) {
  const s = str(v);
  return s ? formatDueDate(s, todayIsoLocal()) : null;
}

function columnValue(detail: Record<string, unknown>, key: "from" | "to", lookup: HistoryLookup): string | null {
  const raw = detail[key];
  if (raw === undefined || raw === null || raw === "") return null;
  const col = lookup.columns?.find((c) => c.id === detail.column_id);
  if (col) return valueLabel(col, raw as CellValue, lookup.members ?? []) || null;
  if (Array.isArray(raw)) return raw.map((x) => (typeof x === "object" && x && "name" in x ? String((x as { name: unknown }).name) : String(x))).join(", ");
  if (typeof raw === "boolean") return raw ? "Sí" : "No";
  return typeof raw === "object" ? null : String(raw);
}

export function describeChange(kind: string, d: Record<string, unknown>, lookup: HistoryLookup = {}): DescribedChange {
  const change = (group: DescribedChange["group"], field: string, from: string | null, to: string | null, text?: string): DescribedChange => ({
    group,
    field,
    from,
    to,
    text: text ?? `${field}: ${from ?? "—"} → ${to ?? "—"}`,
  });
  switch (kind) {
    case "created": {
      const where = [str(d.board), str(d.group)].filter(Boolean).join(" › ");
      const text = str(d.from_board)
        ? `Llegó como copia desde «${str(d.from_board)}» a ${where}`
        : str(d.parent)
          ? `Se creó como subelemento de «${str(d.parent)}»`
          : `Se creó en ${where}`;
      return change("item", "Creación", null, str(d.status), text);
    }
    case "status_changed":
      return change("status", "Estado", str(d.from) ?? "Sin estado", str(d.to) ?? "Sin estado");
    case "group_changed":
      return change("item", "Carpeta", str(d.from), str(d.to));
    case "moved":
      return change("item", "Tablero", str(d.from_board), str(d.to_board), `Viajó de «${str(d.from_board) ?? "—"}» a «${str(d.to_board) ?? "—"}»${str(d.group) ? ` › ${str(d.group)}` : ""}`);
    case "copied_to":
      return change("item", "Copia", null, str(d.board), `Se copió a «${str(d.board) ?? "—"}»${str(d.group) ? ` › ${str(d.group)}` : ""}`);
    case "assignee_changed":
      return change("item", "Responsable", str(d.from), str(d.to));
    case "due_changed":
      return change("item", "Vencimiento", dueLabel(d.from), dueLabel(d.to));
    case "priority_changed":
      return change("item", "Prioridad", priorityLabel(d.from), priorityLabel(d.to));
    case "renamed":
      return change("item", "Título", str(d.from), str(d.to));
    case "description_changed":
      return change("item", "Descripción", str(d.from), str(d.to), str(d.to) ? "Editó la descripción" : "Borró la descripción");
    case "value_changed": {
      const field = str(d.column) ?? "Columna";
      return change("columns", field, columnValue(d, "from", lookup), columnValue(d, "to", lookup));
    }
    case "checklist_item": {
      const item = str(d.item) ?? "paso";
      return change("checklist", str(d.column) ?? "Checklist", d.done ? "Sin tildar" : "Tildado", d.done ? "Tildado" : "Sin tildar", `${d.done ? "Tildó" : "Destildó"} «${item}»${str(d.column) ? ` · ${str(d.column)}` : ""}`);
    }
    case "checklist_completed":
      return change("checklist", str(d.column) ?? "Checklist", null, "Completo", `Checklist completo${str(d.column) ? ` «${str(d.column)}»` : ""}${typeof d.total === "number" ? ` (${d.total} pasos)` : ""}`);
    case "form_submitted":
      return change("item", "Formulario", null, str(d.form), `Llegó por el formulario «${str(d.form) ?? ""}»${str(d.by) ? `, enviado por ${str(d.by)}` : ""}`);
    case "comment":
      return change("comments", "Actualización", null, null, `Escribió una actualización: «${str(d.body) ?? ""}»`);
    case "deleted":
      return change("item", "Eliminación", null, null, "Se eliminó");
    case "automation_limit":
      return change("item", "Reglas", null, null, "Una cadena de reglas se detuvo para evitar un ciclo infinito");
    default:
      return change("item", kind, null, null, kind);
  }
}

/** Con el dato de antes/después en la frase (para listas compactas). */
export function changeSentence(c: DescribedChange) {
  if (c.from === null && c.to === null) return c.text;
  if (["checklist", "comments"].includes(c.group) || ["Creación", "Copia", "Tablero", "Formulario"].includes(c.field)) return c.text;
  if (c.field === "Descripción") return c.text;
  return `${c.field}: ${c.from ?? "vacío"} → ${c.to ?? "vacío"}`;
}
