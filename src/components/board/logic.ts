import { PRIORITY_BY_VALUE, POSITION_STEP } from "@/lib/constants";
import type { Filters, Group, GroupChange, SortDir, SortKey, Status, Task, TaskChange } from "./types";

export function taskReducer(state: Task[], change: TaskChange): Task[] {
  switch (change.type) {
    case "update":
      return state.map((t) => (t.id === change.id ? { ...t, ...change.patch } : t));
    case "remove":
      return state.filter((t) => t.id !== change.id);
    case "add":
      return [...state, change.task];
  }
}

export function groupReducer(state: Group[], change: GroupChange): Group[] {
  switch (change.type) {
    case "update":
      return state.map((g) => (g.id === change.id ? { ...g, ...change.patch } : g)).sort((a, b) => a.position - b.position);
    case "remove":
      return state.filter((g) => g.id !== change.id);
  }
}

export function filtersActive(f: Filters) {
  return Boolean(f.search.trim()) || f.status !== "all" || f.priority !== "all" || f.assignee !== "all";
}

function normalize(s: string) {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function matchesFilters(t: Task, f: Filters) {
  if (f.search.trim() && !normalize(t.title).includes(normalize(f.search.trim()))) return false;
  if (f.status === "none" ? t.status_id !== null : f.status !== "all" && t.status_id !== f.status) return false;
  if (f.priority !== "all" && t.priority !== f.priority) return false;
  if (f.assignee === "none" ? t.assignee_id !== null : f.assignee !== "all" && t.assignee_id !== f.assignee) return false;
  return true;
}

export function sortTasks(list: Task[], key: SortKey, dir: SortDir, statuses: Status[]) {
  const statusPos = new Map(statuses.map((s) => [s.id, s.position]));
  const factor = dir === "asc" ? 1 : -1;
  const sorted = [...list];
  sorted.sort((a, b) => {
    switch (key) {
      case "title":
        return factor * a.title.localeCompare(b.title, "es", { sensitivity: "base" });
      case "priority":
        return factor * (PRIORITY_BY_VALUE[a.priority].rank - PRIORITY_BY_VALUE[b.priority].rank) || a.position - b.position;
      case "due": {
        // Las tareas sin fecha van siempre al final.
        if (!a.due_date && !b.due_date) return a.position - b.position;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return factor * a.due_date.localeCompare(b.due_date) || a.position - b.position;
      }
      case "status": {
        const pa = a.status_id ? statusPos.get(a.status_id) ?? 999 : 999;
        const pb = b.status_id ? statusPos.get(b.status_id) ?? 999 : 999;
        if (pa === 999 && pb !== 999) return 1;
        if (pb === 999 && pa !== 999) return -1;
        return factor * (pa - pb) || a.position - b.position;
      }
      default:
        return a.position - b.position;
    }
  });
  return sorted;
}

/** Posición para insertar en `index` dentro de una lista ordenada por posición. */
export function positionAt(ordered: { position: number }[], index: number) {
  const prev = ordered[index - 1]?.position;
  const next = ordered[index]?.position;
  if (prev !== undefined && next !== undefined) return (prev + next) / 2;
  if (prev !== undefined) return prev + POSITION_STEP;
  if (next !== undefined) return next - POSITION_STEP;
  return POSITION_STEP;
}
