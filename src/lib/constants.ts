import type { Enums } from "@/lib/database.types";

export type Priority = Enums<"task_priority">;
export type WorkspaceRole = Enums<"workspace_role">;
export type Visibility = Enums<"board_visibility">;

export const PRIORITIES: { value: Priority; label: string; rank: number; color: ColorName }[] = [
  { value: "low", label: "Baja", rank: 1, color: "gray" },
  { value: "medium", label: "Media", rank: 2, color: "blue" },
  { value: "high", label: "Alta", rank: 3, color: "orange" },
  { value: "urgent", label: "Urgente", rank: 4, color: "red" },
];

export const PRIORITY_BY_VALUE = Object.fromEntries(PRIORITIES.map((p) => [p.value, p])) as Record<
  Priority,
  (typeof PRIORITIES)[number]
>;

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: "Administrador principal",
  admin: "Administrador",
  member: "Usuario",
};

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  workspace: "Todo el equipo de la empresa",
  private: "Solo las personas con acceso",
};

export const COLOR_NAMES = ["gray", "amber", "blue", "green", "red", "violet", "teal", "pink", "orange"] as const;
export type ColorName = (typeof COLOR_NAMES)[number];

export const COLOR_LABELS: Record<ColorName, string> = {
  gray: "Gris",
  amber: "Ámbar",
  blue: "Azul",
  green: "Verde",
  red: "Rojo",
  violet: "Violeta",
  teal: "Turquesa",
  pink: "Rosa",
  orange: "Naranja",
};

export function asColor(value: string | null | undefined): ColorName {
  return (COLOR_NAMES as readonly string[]).includes(value ?? "") ? (value as ColorName) : "gray";
}

/** Separación entre posiciones al insertar al final de una lista. */
export const POSITION_STEP = 1000;
