"use client";

import { createContext, useContext } from "react";
import type { Json } from "@/lib/database.types";
import type { BoardColumn } from "@/lib/columns";
import type { Priority } from "@/lib/constants";
import type { ChecklistTemplate } from "@/lib/columns";
import type { Member, Status, Task } from "./types";

/** Elemento de otro tablero vinculado con "Conectar tableros". */
export type LinkedItem = {
  id: string;
  title: string;
  board_id: string;
  status_id: string | null;
  due_date: string | null;
  priority: Priority;
  assignee_id: string | null;
  custom_values: Json;
};

export type LinkedBoard = { id: string; name: string; statuses: Status[]; columns: BoardColumn[] };

/** Datos que necesitan las celdas de archivos, dependencias y conexiones. */
export type CellCtx = {
  workspaceId: string;
  boardId: string;
  /** Elementos de este tablero (para "Depende de"). */
  tasks: Task[];
  doneIds: Set<string>;
  /** Primer estado del tablero ("sin arrancar"). */
  initialStatusId?: string;
  /** Elementos de otros tableros que se pueden conectar, por id. */
  linkedItems: Map<string, LinkedItem>;
  linkedBoards: Map<string, LinkedBoard>;
  /** Plantillas de checklist de la empresa. */
  templates: ChecklistTemplate[];
  members: Member[];
};

export const CellContext = createContext<CellCtx | null>(null);

export function useCellContext() {
  return useContext(CellContext);
}
