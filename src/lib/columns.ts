import { z } from "zod";
import type { Json, Tables } from "@/lib/database.types";
import { COLOR_NAMES, asColor, type ColorName } from "@/lib/constants";

/*
 * Columnas propias de cada tablero. Los valores se guardan en
 * tasks.custom_values como { <id de columna>: valor }:
 *   text → string · number → number · date → "YYYY-MM-DD" · person → user id
 *   list → id de opción · checkbox → boolean
 */

export const COLUMN_KINDS = ["text", "number", "date", "person", "list", "checkbox"] as const;
export type ColumnKind = (typeof COLUMN_KINDS)[number];

export const COLUMN_KIND_LABELS: Record<ColumnKind, string> = {
  text: "Texto",
  number: "Número",
  date: "Fecha",
  person: "Persona",
  list: "Lista de opciones",
  checkbox: "Casilla (sí / no)",
};

export type ListOption = { id: string; label: string; color: ColorName };

export type BoardColumn = Omit<Tables<"board_columns">, "kind" | "options"> & {
  kind: ColumnKind;
  options: ListOption[];
};

export type CellValue = string | number | boolean;
export type CustomValues = Record<string, CellValue>;

export function parseColumn(row: Tables<"board_columns">): BoardColumn {
  const kind = (COLUMN_KINDS as readonly string[]).includes(row.kind) ? (row.kind as ColumnKind) : "text";
  const options = Array.isArray(row.options)
    ? row.options
        .filter((o): o is { id: string; label: string; color?: string } =>
          Boolean(o && typeof o === "object" && !Array.isArray(o) && typeof (o as Record<string, unknown>).id === "string"),
        )
        .map((o) => ({ id: o.id, label: String(o.label ?? ""), color: asColor(o.color) }))
    : [];
  return { ...row, kind, options };
}

export function readValues(json: Json | null | undefined): CustomValues {
  if (!json || typeof json !== "object" || Array.isArray(json)) return {};
  const out: CustomValues = {};
  for (const [k, v] of Object.entries(json)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return out;
}

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

/** Normaliza y valida un valor según el tipo de columna. null = vaciar. */
export function normalizeValue(
  column: Pick<BoardColumn, "kind" | "options">,
  raw: unknown,
  memberIds?: Set<string>,
): { ok: true; value: CellValue | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === "") return { ok: true, value: null };
  switch (column.kind) {
    case "text": {
      const v = String(raw).trim();
      if (v.length > 500) return { ok: false, error: "El texto puede tener hasta 500 caracteres." };
      return { ok: true, value: v || null };
    }
    case "number": {
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
      if (!Number.isFinite(n) || Math.abs(n) > 1e15) return { ok: false, error: "Ingresá un número válido." };
      return { ok: true, value: n };
    }
    case "date": {
      const v = String(raw);
      if (!dateRe.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) return { ok: false, error: "Fecha inválida." };
      return { ok: true, value: v };
    }
    case "person": {
      const v = String(raw);
      if (!z.uuid().safeParse(v).success) return { ok: false, error: "Persona inválida." };
      if (memberIds && !memberIds.has(v)) return { ok: false, error: "La persona tiene que ser miembro del espacio." };
      return { ok: true, value: v };
    }
    case "list": {
      const v = String(raw);
      if (!column.options.some((o) => o.id === v)) return { ok: false, error: "Opción inválida." };
      return { ok: true, value: v };
    }
    case "checkbox":
      return { ok: true, value: raw === true || raw === "true" || raw === "on" ? true : null };
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
      label: z.string().trim().min(1, { message: "Cada opción necesita un nombre." }).max(40, { message: "Máximo 40 caracteres por opción." }),
      color: z.enum(COLOR_NAMES),
    }),
  )
  .max(50, { message: "Hasta 50 opciones." });

export const columnInputSchema = z.object({
  name: columnNameSchema,
  kind: z.enum(COLUMN_KINDS, { message: "Tipo de columna inválido." }),
  options: listOptionsSchema.default([]),
});

export function newOptionId() {
  return Math.random().toString(36).slice(2, 10);
}

/** Texto plano de un valor (para lectores de pantalla y resúmenes). */
export function valueLabel(
  column: BoardColumn,
  value: CellValue | undefined,
  members: { user_id: string; full_name: string | null; email: string | null }[],
): string {
  if (value === undefined || value === null || value === "") return "";
  switch (column.kind) {
    case "list":
      return column.options.find((o) => o.id === value)?.label ?? "";
    case "person": {
      const m = members.find((x) => x.user_id === value);
      return m ? m.full_name?.trim() || m.email || "" : "Ex miembro";
    }
    case "checkbox":
      return value ? "Sí" : "";
    case "number":
      return typeof value === "number" ? value.toLocaleString("es-AR") : String(value);
    default:
      return String(value);
  }
}
