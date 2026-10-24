import { z } from "zod";
import type { Json } from "@/lib/database.types";
import { COLOR_NAMES, PRIORITIES, PRIORITY_BY_VALUE, type ColorName, type Priority } from "@/lib/constants";

/*
 * Ajustes visuales de un tablero (boards.settings):
 *   columns: nombre visible y ocultamiento de las columnas fijas
 *   priority: nombre y color de cada nivel de prioridad
 *   order: orden de las columnas (fijas y propias) en la tabla
 */

export const BUILTIN_KEYS = ["assignee", "status", "priority", "due"] as const;
export type BuiltinKey = (typeof BUILTIN_KEYS)[number];

export const BUILTIN_DEFAULT_LABELS: Record<BuiltinKey | "title", string> = {
  title: "Elemento",
  assignee: "Responsable",
  status: "Estado",
  priority: "Prioridad",
  due: "Vencimiento",
};

const labelSchema = z.string().trim().min(1, { message: "El nombre no puede quedar vacío." }).max(40, { message: "Máximo 40 caracteres." });

export const boardSettingsSchema = z
  .object({
    columns: z
      .partialRecord(z.enum(["title", ...BUILTIN_KEYS]), z
          .object({
            label: labelSchema.optional(),
            hidden: z.boolean().optional(),
            editors: z.object({ users: z.array(z.uuid()).max(200).optional(), teams: z.array(z.uuid()).max(50).optional() }).strip().optional(),
          })
          .strip(),
      )
      .optional(),
    priority: z
      .partialRecord(z.enum(["low", "medium", "high", "urgent"]), z.object({ label: labelSchema.optional(), color: z.enum(COLOR_NAMES).optional() }).strip())
      .optional(),
    order: z.array(z.string().max(40)).max(200).optional(),
  })
  .strip();

export type BoardSettings = z.infer<typeof boardSettingsSchema>;

export function parseBoardSettings(json: Json | null | undefined): BoardSettings {
  const res = boardSettingsSchema.safeParse(json ?? {});
  return res.success ? res.data : {};
}

export function builtinLabel(s: BoardSettings, key: BuiltinKey | "title"): string {
  return s.columns?.[key]?.label || BUILTIN_DEFAULT_LABELS[key];
}

export function builtinHidden(s: BoardSettings, key: BuiltinKey): boolean {
  return Boolean(s.columns?.[key]?.hidden);
}

export type PriorityLabel = { value: Priority; label: string; color: ColorName; rank: number };

export function priorityLabels(s: BoardSettings): PriorityLabel[] {
  return PRIORITIES.map((p) => ({
    value: p.value,
    rank: p.rank,
    label: s.priority?.[p.value]?.label || p.label,
    color: s.priority?.[p.value]?.color || p.color,
  }));
}

export function priorityLabel(s: BoardSettings, p: Priority): PriorityLabel {
  const base = PRIORITY_BY_VALUE[p];
  return { value: p, rank: base.rank, label: s.priority?.[p]?.label || base.label, color: s.priority?.[p]?.color || base.color };
}

/** Clave de orden de una columna: las fijas por nombre, las propias por id. */
export type ColumnKey = BuiltinKey | `c:${string}`;

/** Orden final de las columnas de la tabla (fijas y propias). */
export function orderedKeys(s: BoardSettings, customIds: string[]): ColumnKey[] {
  const all: ColumnKey[] = [...BUILTIN_KEYS, ...customIds.map((id) => `c:${id}` as const)];
  const saved = (s.order ?? []).filter((k): k is ColumnKey => all.includes(k as ColumnKey));
  return [...saved, ...all.filter((k) => !saved.includes(k))];
}
