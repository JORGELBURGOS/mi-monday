"use client";

import type { ChecklistTemplate } from "@/lib/columns";
import Link from "next/link";
import { useCallback, useMemo, useOptimistic, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { createTaskAction, deleteTaskAction, deleteTasksAction, duplicateTaskAction, duplicateTasksAction, moveTaskAction, moveTasksAction, updateTaskAction, updateTasksAction } from "@/app/actions/tasks";
import { createGroupAction, deleteGroupAction, saveStatusesAction, updateBoardSettingsAction, updateGroupAction } from "@/app/actions/boards";
import { createColumnAction, deleteColumnAction, duplicateColumnAction, setCustomValuesAction, updateColumnAction } from "@/app/actions/columns";
import { COLUMN_KIND_LABELS, LABEL_KINDS, defaultLabels, readValues, stringList, valueLabel, type BoardColumn, type ColumnKind, type ColumnSettings } from "@/lib/columns";
import { builtinLabel, orderedKeys, priorityLabels, type BoardSettings, type ColumnKey } from "@/lib/board-settings";
import type { BuiltinKey } from "@/lib/board-settings";
import { assigneeLabel as assigneeText, canCreateIn, canEditTask, lockedSections, readEditors, type BoardAccess, type Team } from "@/lib/teams";
import { formulaValue, sortableValue, type RowEnv } from "@/lib/row-values";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/cn";
import { asColor, type Priority } from "@/lib/constants";
import { displayName, todayIsoLocal } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/misc";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { IconCalendar, IconColumns, IconCopy, IconGantt, IconFilter, IconMove, IconPlus, IconSearch, IconTable, IconTrash, IconX } from "@/components/ui/icons";
import { GroupSection, type GroupHandlers, type LabelEditors } from "./group-section";
import { CalendarView } from "./calendar-view";
import { GanttView } from "./gantt-view";
import { KanbanView } from "./kanban-view";
import { TaskDialog } from "./task-dialog";
import { EditorsDialog } from "./editors-dialog";
import { setColumnEditorsAction, setGroupEditorsAction } from "@/app/actions/teams";
import { AddColumnButton, ColumnSettingsDialog, ColumnsVisibility, buildColumnDefs, type ColumnDef, type HeaderHandlers } from "./columns-ui";
import type { Label } from "./label-picker";
import { CellContext, type CellCtx, type LinkedBoard, type LinkedItem } from "./cell-context";
import { groupReducer, positionAt, taskReducer } from "./logic";
import type { Group, GroupChange, Member, Status, Task, TaskChange } from "./types";

const noopSubscribe = () => () => {};
const nowLocal = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

type View = "tabla" | "kanban" | "calendario" | "gantt";
type Filters = { search: string; status: string; priority: "all" | Priority; assignee: string; column: string };
const EMPTY_FILTERS: Filters = { search: "", status: "all", priority: "all", assignee: "all", column: "" };
type Sort = { key: string; dir: "asc" | "desc" } | null;

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function BoardView({
  boardId,
  workspaceId,
  workspaceBoards,
  linkedBoards,
  linkedItems,
  checklistTemplates,
  boardName,
  view,
  statuses,
  groups,
  tasks,
  members,
  columns,
  settings,
  canManage,
  serverToday,
  readOnly,
  initialTaskId,
  teams,
  access,
}: {
  boardId: string;
  workspaceId: string;
  workspaceBoards: { id: string; name: string }[];
  linkedBoards: LinkedBoard[];
  linkedItems: LinkedItem[];
  checklistTemplates: ChecklistTemplate[];
  boardName: string;
  view: View;
  statuses: Status[];
  groups: Group[];
  tasks: Task[];
  members: Member[];
  columns: BoardColumn[];
  settings: BoardSettings;
  canManage: boolean;
  serverToday: string;
  readOnly: boolean;
  /** Ítem a abrir al cargar (por ejemplo, desde el recorrido de otro tablero). */
  initialTaskId?: string;
  /** Equipos de la empresa. */
  teams: Team[];
  /** Lo que la persona conectada puede hacer en el tablero. */
  access: BoardAccess;
}) {
  const toast = useToast();
  const today = useSyncExternalStore(noopSubscribe, todayIsoLocal, () => serverToday);
  const now = useSyncExternalStore(noopSubscribe, nowLocal, () => `${serverToday} 00:00`);
  const [optimisticTasks, applyTask] = useOptimistic(tasks, taskReducer);
  const [optimisticGroups, applyGroup] = useOptimistic(groups, groupReducer);
  const [optSettings, applySettings] = useOptimistic(settings, (_s: BoardSettings, next: BoardSettings) => next);
  const [optColumns, applyColumn] = useOptimistic(columns, (state: BoardColumn[], change: { id: string; patch: Partial<BoardColumn> } | { remove: string }) =>
    "remove" in change ? state.filter((c) => c.id !== change.remove) : state.map((c) => (c.id === change.id ? { ...c, ...change.patch } : c)),
  );
  const [, startTransition] = useTransition();

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<Sort>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openTaskId, setOpenTaskId] = useState<string | null>(initialTaskId && tasks.some((t) => t.id === initialTaskId) ? initialTaskId : null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [deletingMany, setDeletingMany] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState<Group | null>(null);
  const [deletingColumn, setDeletingColumn] = useState<BoardColumn | null>(null);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [settingsKey, setSettingsKey] = useState<string | null>(null);
  const [editorsFor, setEditorsFor] = useState<{ kind: "group"; group: Group } | { kind: "column"; def: ColumnDef } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string, open?: boolean) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (open ?? !n.has(id)) n.add(id);
      else n.delete(id);
      return n;
    });
  const dragRef = useRef<string | null>(null);
  const editable = canManage && !readOnly;

  const doneIds = useMemo(() => new Set(statuses.filter((s) => s.is_done).map((s) => s.id)), [statuses]);
  const priorities = useMemo(() => priorityLabels(optSettings), [optSettings]);
  const env: RowEnv = useMemo(
    () => ({ columns: optColumns, statuses, groups: optimisticGroups, members, settings: optSettings, today, now }),
    [optColumns, statuses, optimisticGroups, members, optSettings, today, now],
  );
  const order = useMemo(() => orderedKeys(optSettings, optColumns.map((c) => c.id)), [optSettings, optColumns]);
  const allDefs = useMemo(() => buildColumnDefs(optSettings, optColumns, order), [optSettings, optColumns, order]);
  const defs = allDefs.filter((d) => !d.hidden);
  const titleLabel = builtinLabel(optSettings, "title");

  /** Ejecuta una mutación con actualización optimista y aviso de error. */
  const run = (fn: () => Promise<ActionResult<unknown>>, opts: { task?: TaskChange; group?: GroupChange; success?: boolean | string; before?: () => void } = {}) =>
    startTransition(async () => {
      if (opts.task) applyTask(opts.task);
      if (opts.group) applyGroup(opts.group);
      opts.before?.();
      const res = await fn();
      if (!res.ok) toast.error(res.error);
      else if (typeof opts.success === "string") toast.success(opts.success);
      else if (opts.success && res.message) toast.success(res.message);
    });

  const saveSettings = (next: BoardSettings) => run(() => updateBoardSettingsAction(boardId, next), { before: () => applySettings(next) });

  /* ------------------------------------------------------------- filtros */

  const matches = useCallback(
    (t: Task) => {
      const q = norm(filters.search.trim());
      if (q) {
        const values = readValues(t.custom_values);
        const haystack = [t.title, ...optColumns.map((c) => valueLabel(c, values[c.id], members))].join(" ");
        if (!norm(haystack).includes(q)) return false;
      }
      if (filters.status === "none" ? t.status_id !== null : filters.status !== "all" && t.status_id !== filters.status) return false;
      if (filters.priority !== "all" && t.priority !== filters.priority) return false;
      if (filters.assignee === "none") {
        if ((t.assignee_ids?.length ?? 0) + (t.team_ids?.length ?? 0) > 0) return false;
      } else if (filters.assignee === "me") {
        if (!t.assignee_ids?.includes(access.userId) && !t.team_ids?.some((id) => access.teamIds.includes(id))) return false;
      } else if (filters.assignee !== "all" && !t.assignee_ids?.includes(filters.assignee) && !t.team_ids?.includes(filters.assignee)) return false;
      if (filters.column) {
        const [colId, val] = filters.column.split("|");
        const v = readValues(t.custom_values)[colId];
        if (val === "__empty") {
          if (v !== undefined && !(Array.isArray(v) && v.length === 0)) return false;
        } else if (val === "__true") {
          if (v !== true) return false;
        } else if (Array.isArray(v) ? !stringList(v).includes(val) : v !== val) return false;
      }
      return true;
    },
    [filters, optColumns, members, access],
  );
  const active = Boolean(filters.search.trim()) || filters.status !== "all" || filters.priority !== "all" || filters.assignee !== "all" || Boolean(filters.column);

  /* --------------------------------------------------------------- orden */

  const sortList = useCallback(
    (list: Task[]) => {
      if (!sort) return [...list].sort((a, b) => a.position - b.position);
      const factor = sort.dir === "asc" ? 1 : -1;
      const statusPos = new Map(statuses.map((s, i) => [s.id, i]));
      const key = (t: Task): string | number | null => {
        switch (sort.key) {
          case "title":
            return t.title;
          case "status":
            return t.status_id ? (statusPos.get(t.status_id) ?? null) : null;
          case "priority":
            return priorities.find((p) => p.value === t.priority)?.rank ?? null;
          case "due":
            return t.due_date;
          case "assignee":
            return assigneeText(t, members, teams) || null;
          default: {
            const c = optColumns.find((x) => `c:${x.id}` === sort.key);
            return c ? sortableValue(t, c, env) : null;
          }
        }
      };
      return [...list].sort((a, b) => {
        const ka = key(a);
        const kb = key(b);
        if (ka === null && kb === null) return a.position - b.position;
        if (ka === null) return 1;
        if (kb === null) return -1;
        const c = typeof ka === "number" && typeof kb === "number" ? ka - kb : String(ka).localeCompare(String(kb), "es", { numeric: true, sensitivity: "base" });
        return factor * c || a.position - b.position;
      });
    },
    [sort, statuses, priorities, members, teams, optColumns, env],
  );
  const manual = !sort;

  // Subelementos: se muestran debajo de su elemento, no como filas sueltas.
  const childrenOf = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of optimisticTasks) {
      if (!t.parent_id) continue;
      const list = map.get(t.parent_id) ?? [];
      list.push(t);
      map.set(t.parent_id, list);
    }
    for (const [k, list] of map) map.set(k, list.sort((a, b) => a.position - b.position));
    return map;
  }, [optimisticTasks]);
  const topTasks = useMemo(() => optimisticTasks.filter((t) => !t.parent_id), [optimisticTasks]);

  const tasksByGroup = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const g of optimisticGroups) map.set(g.id, []);
    for (const t of topTasks) map.get(t.group_id)?.push(t);
    for (const [k, list] of map) map.set(k, list.sort((a, b) => a.position - b.position));
    return map;
  }, [topTasks, optimisticGroups]);

  // Un elemento se muestra si coincide él o alguno de sus subelementos.
  const matchesTree = (t: Task) => matches(t) || (childrenOf.get(t.id) ?? []).some(matches);
  const visibleTasks = topTasks.filter(matchesTree);

  /* ----------------------------------------------------------- mutaciones */

  const updateTask = (task: Task, patch: Partial<Task>) => run(() => updateTaskAction(task.id, patch), { task: { type: "update", id: task.id, patch } });

  const moveTask = (task: Task, groupId: string, index: number) => {
    const target = (tasksByGroup.get(groupId) ?? []).filter((t) => t.id !== task.id);
    const position = positionAt(target, Math.max(0, Math.min(index, target.length)));
    run(() => moveTaskAction({ taskId: task.id, groupId, position }), { task: { type: "update", id: task.id, patch: { group_id: groupId, position } } });
  };

  const uniqueName = (base: string) => {
    const names = new Set(optColumns.map((c) => c.name.toLowerCase()));
    if (!names.has(base.toLowerCase())) return base;
    for (let i = 2; ; i++) if (!names.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
  };

  const addColumn = (kind: ColumnKind, afterKey?: string) => {
    const short: Partial<Record<ColumnKind, string>> = { list: "Estado", tags: "Desplegable", number: "Números", checkbox: "Casilla", timeline: "Cronograma", long_text: "Notas", created_log: "Creado", updated_log: "Actualizado", item_id: "ID" };
    const name = uniqueName(short[kind] ?? COLUMN_KIND_LABELS[kind]);
    const settingsInit: ColumnSettings = kind === "number" ? { summary: "sum" } : {};
    startTransition(async () => {
      const res = await createColumnAction(boardId, { name, kind, options: defaultLabels(kind), settings: settingsInit }, afterKey);
      if (!res.ok) return toast.error(res.error);
      toast.success(`Columna “${name}” agregada.`);
      if (kind === "formula") setSettingsKey(`c:${res.data.id}`);
    });
  };

  const handlers: GroupHandlers = {
    onUpdateTask: updateTask,
    onSetValue: (task, columnId, value) => {
      const next = { ...readValues(task.custom_values) };
      if (value === null) delete next[columnId];
      else next[columnId] = value;
      run(() => setCustomValuesAction(task.id, { [columnId]: value }), { task: { type: "update", id: task.id, patch: { custom_values: next } } });
    },
    onOpenTask: (t) => setOpenTaskId(t.id),
    onDeleteTask: (t) => setDeleting(t),
    onDuplicateTask: (t) => run(() => duplicateTaskAction(t.id), { success: "Elemento duplicado." }),
    onMoveTask: moveTask,
    onMoveTaskById: (taskId, groupId, index) => {
      const task = optimisticTasks.find((t) => t.id === taskId);
      if (task) moveTask(task, groupId, index);
    },
    onCreateTask: (groupId, title, parentId) => {
      if (parentId) toggleExpand(parentId, true);
      const temp: Task = {
        id: `tmp-${crypto.randomUUID()}`,
        board_id: boardId,
        group_id: groupId,
        title,
        description: null,
        status_id: statuses[0]?.id ?? null,
        priority: "medium",
        assignee_id: null,
        assignee_ids: [],
        team_ids: [],
        due_date: null,
        custom_values: {},
        position: Number.MAX_SAFE_INTEGER,
        created_by: access.userId,
        parent_id: parentId ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      run(() => createTaskAction(boardId, groupId, title, parentId), { task: { type: "add", task: temp } });
    },
    onRenameGroup: (g, name) => run(() => updateGroupAction(g.id, { name }), { group: { type: "update", id: g.id, patch: { name } } }),
    onRecolorGroup: (g, color) => run(() => updateGroupAction(g.id, { color }), { group: { type: "update", id: g.id, patch: { color } } }),
    onMoveGroup: (g, dir) => {
      const idx = optimisticGroups.findIndex((x) => x.id === g.id);
      const others = optimisticGroups.filter((x) => x.id !== g.id);
      const newIndex = dir === "up" ? idx - 1 : idx + 1;
      if (newIndex < 0 || newIndex > others.length) return;
      const position = positionAt(others, newIndex);
      run(() => updateGroupAction(g.id, { position }), { group: { type: "update", id: g.id, patch: { position } } });
    },
    onDeleteGroup: (g) => setDeletingGroup(g),
    onGroupEditors: canManage ? (g) => setEditorsFor({ kind: "group", group: g }) : undefined,
    onAddColumn: (kind) => addColumn(kind),
  };

  const setBuiltin = (def: ColumnDef, patch: { label?: string; hidden?: boolean }) => {
    if (!def.builtin) return;
    const cols = { ...(optSettings.columns ?? {}) };
    cols[def.builtin] = { ...cols[def.builtin], ...patch };
    saveSettings({ ...optSettings, columns: cols });
  };
  const patchColumn = (c: BoardColumn, patch: { name?: string; settings?: ColumnSettings }) =>
    run(() => updateColumnAction(c.id, patch), { before: () => applyColumn({ id: c.id, patch }) });

  const setHidden = (def: ColumnDef, hidden: boolean) =>
    def.column ? patchColumn(def.column, { settings: { ...def.column.settings, hidden } }) : setBuiltin(def, { hidden });

  const headerHandlers: HeaderHandlers = {
    onEditors: editable ? (def) => setEditorsFor({ kind: "column", def }) : undefined,
    onRename: (def, name) => (def.column ? patchColumn(def.column, { name }) : setBuiltin(def, { label: name })),
    onSettings: (def) => setSettingsKey(def.key),
    onMove: (def, dir) => {
      const i = defs.findIndex((d) => d.key === def.key);
      const neighbor = defs[i + dir];
      if (!neighbor) return;
      const next = [...order];
      const a = next.indexOf(def.key);
      const b = next.indexOf(neighbor.key);
      [next[a], next[b]] = [next[b], next[a]];
      saveSettings({ ...optSettings, order: next });
    },
    onHide: (def) => setHidden(def, true),
    onSort: (def, dir) => setSort({ key: def.key, dir }),
    onDuplicate: (def, withValues) => def.column && run(() => duplicateColumnAction(def.column!.id, withValues), { success: true }),
    onDelete: (def) => def.column && setDeletingColumn(def.column),
    onAddAfter: (def, kind) => addColumn(kind, def.key),
  };

  /* --------------------------------------------------- edición de etiquetas */

  const usageOf = (get: (t: Task) => string | string[] | null | undefined) => {
    const out: Record<string, number> = {};
    for (const t of optimisticTasks) {
      const v = get(t);
      for (const id of Array.isArray(v) ? v : v ? [v] : []) out[id] = (out[id] ?? 0) + 1;
    }
    return out;
  };

  const labelEditors: LabelEditors = {
    status: editable
      ? {
          doneToggle: true,
          usage: usageOf((t) => t.status_id),
          onSave: async (labels: Label[]) => {
            const res = await saveStatusesAction(
              boardId,
              labels.map((l) => ({ id: l.id.startsWith("new-") ? undefined : l.id, label: l.label, color: l.color, isDone: Boolean(l.done) })),
            );
            return res.ok ? null : res.error;
          },
        }
      : undefined,
    priority: editable
      ? {
          fixed: true,
          onSave: async (labels: Label[]) => {
            const next = { ...optSettings, priority: Object.fromEntries(labels.map((l) => [l.id, { label: l.label, color: l.color }])) };
            const res = await updateBoardSettingsAction(boardId, next);
            return res.ok ? null : res.error;
          },
        }
      : undefined,
    column: (c) =>
      editable && LABEL_KINDS.includes(c.kind)
        ? {
            doneToggle: c.kind === "list",
            usage: usageOf((t) => {
              const v = readValues(t.custom_values)[c.id];
              return typeof v === "string" ? v : Array.isArray(v) ? stringList(v) : null;
            }),
            onSave: async (labels: Label[]) => {
              const res = await updateColumnAction(c.id, { options: labels.map((l) => ({ id: l.id, label: l.label, color: l.color, ...(l.done ? { done: true } : {}) })) });
              return res.ok ? null : res.error;
            },
          }
        : undefined,
  };

  /* -------------------------------------------------------------- selección */

  const selectedIds = [...selected].filter((id) => optimisticTasks.some((t) => t.id === id));
  const onSelect = (ids: string[], on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      for (const id of ids) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });
  const clearSelection = () => setSelected(new Set());

  const exportCsv = (base: Task[]) => {
    const list = base.flatMap((t) => (t.parent_id ? [t] : [t, ...(childrenOf.get(t.id) ?? []).filter((c) => !base.includes(c))]));
    const cols = [titleLabel, "Carpeta", ...defs.map((d) => d.label)];
    const rows = list.map((t) => {
      const values = readValues(t.custom_values);
      return [
        t.parent_id ? `↳ ${t.title}` : t.title,
        optimisticGroups.find((g) => g.id === t.group_id)?.name ?? "",
        ...defs.map((d) => {
          if (d.builtin === "status") return statuses.find((s) => s.id === t.status_id)?.label ?? "";
          if (d.builtin === "priority") return priorities.find((p) => p.value === t.priority)?.label ?? "";
          if (d.builtin === "due") return t.due_date ?? "";
          if (d.builtin === "assignee") return assigneeText(t, members, teams);
          const c = d.column!;
          if (c.kind === "formula") {
            const r = formulaValue(t, c, env);
            return r.ok ? String(r.value ?? "") : "#ERROR";
          }
          const v = sortableValue(t, c, env);
          if (c.kind === "number" || c.kind === "rating") return typeof values[c.id] === "number" ? String(values[c.id]).replace(".", ",") : "";
          if (c.kind === "list" || c.kind === "tags" || c.kind === "person" || c.kind === "checkbox" || c.kind === "timeline") return valueLabel(c, values[c.id], members);
          return v === null ? "" : String(v);
        }),
      ];
    });
    const esc = (s: string) => (/[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const csv = "﻿" + [cols, ...rows].map((r) => r.map((x) => esc(String(x))).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${boardName.replace(/[\\/:*?"<>|]+/g, "-")}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  /* ------------------------------------------------------------ columnas UI */

  const settingsDef = settingsKey ? allDefs.find((d) => d.key === settingsKey) : undefined;
  const preview = useCallback(
    (formula: string) => {
      const col = settingsDef?.column;
      if (!col) return [];
      const probe: BoardColumn = { ...col, settings: { ...col.settings, formula } };
      return optimisticTasks.slice(0, 4).map((t) => ({ title: t.title, result: formulaValue(t, probe, { ...env, columns: env.columns.map((c) => (c.id === col.id ? probe : c)) }) }));
    },
    [settingsDef, optimisticTasks, env],
  );

  const cellCtx: CellCtx = useMemo(
    () => ({
      workspaceId,
      boardId,
      tasks: optimisticTasks,
      doneIds,
      initialStatusId: statuses[0]?.id,
      linkedItems: new Map(linkedItems.map((i) => [i.id, i])),
      linkedBoards: new Map(linkedBoards.map((b) => [b.id, b])),
      templates: checklistTemplates,
      members,
      teams,
      access,
      groupEditors: new Map(optimisticGroups.map((g) => [g.id, readEditors(g.editors)])),
      columnEditors: new Map([
        ...allDefs.map((d) => [d.key, readEditors(d.column ? d.column.settings.editors : optSettings.columns?.[d.builtin as BuiltinKey]?.editors)] as const),
        ["title", readEditors(optSettings.columns?.title?.editors)] as const,
      ]),
      lockedSections: lockedSections(access, optimisticGroups),
    }),
    [workspaceId, boardId, optimisticTasks, doneIds, statuses, linkedItems, linkedBoards, checklistTemplates, members, teams, access, optimisticGroups, allDefs, optSettings],
  );

  const labelFilterOptions = optColumns.filter((c) => c.kind === "list" || c.kind === "tags" || c.kind === "checkbox" || c.kind === "person");
  const openTask = optimisticTasks.find((t) => t.id === openTaskId) ?? null;
  const statusLabel = builtinLabel(optSettings, "status");
  const priorityLabelText = builtinLabel(optSettings, "priority");
  const assigneeLabel = builtinLabel(optSettings, "assignee");

  return (
    <CellContext.Provider value={cellCtx}>
    <div className={cn(selectedIds.length > 0 && "pb-24")}>
      {/* Barra de herramientas */}
      <div className="sticky top-14 z-20 -mx-4 border-b border-line bg-bg/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8 lg:top-0">
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Vistas del tablero" className="flex rounded-lg border border-line bg-surface p-0.5">
            <ViewTab href={`/t/${boardId}`} active={view === "tabla"} icon={<IconTable size={16} />}>
              Tabla
            </ViewTab>
            <ViewTab href={`/t/${boardId}?vista=kanban`} active={view === "kanban"} icon={<IconColumns size={16} />}>
              Kanban
            </ViewTab>
            <ViewTab href={`/t/${boardId}?vista=calendario`} active={view === "calendario"} icon={<IconCalendar size={16} />}>
              Calendario
            </ViewTab>
            <ViewTab href={`/t/${boardId}?vista=gantt`} active={view === "gantt"} icon={<IconGantt size={16} />}>
              Gantt
            </ViewTab>
          </nav>

          <div className="relative min-w-0 flex-1 basis-48">
            <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
            <Input
              type="search"
              aria-label="Buscar en el tablero"
              placeholder="Buscar en el tablero…"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              className="h-9 pl-9"
            />
          </div>

          {!readOnly && view === "tabla" && (
            <>
              <Button size="sm" className="h-9" onClick={() => setNewGroupOpen(true)}>
                <IconPlus size={16} /> Carpeta
              </Button>
              {editable && <AddColumnButton onAdd={(k) => addColumn(k)} />}
            </>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Filtros y orden">
          <IconFilter size={15} className="text-subtle" />
          <Select
            aria-label={`Filtrar por ${statusLabel.toLowerCase()}`}
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            className={cn("h-8 w-auto text-[13px]", filters.status !== "all" && "border-accent")}
          >
            <option value="all">{statusLabel}: todos</option>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
            <option value="none">Sin {statusLabel.toLowerCase()}</option>
          </Select>
          <Select
            aria-label={`Filtrar por ${priorityLabelText.toLowerCase()}`}
            value={filters.priority}
            onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value as Filters["priority"] }))}
            className={cn("h-8 w-auto text-[13px]", filters.priority !== "all" && "border-accent")}
          >
            <option value="all">{priorityLabelText}: todas</option>
            {priorities.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
          <Select
            aria-label={`Filtrar por ${assigneeLabel.toLowerCase()}`}
            value={filters.assignee}
            onChange={(e) => setFilters((f) => ({ ...f, assignee: e.target.value }))}
            className={cn("h-8 w-auto max-w-48 text-[13px]", filters.assignee !== "all" && "border-accent")}
          >
            <option value="all">{assigneeLabel}: todos</option>
            <option value="me">Míos (yo o mi equipo)</option>
            <option value="none">Sin {assigneeLabel.toLowerCase()}</option>
            {teams.length > 0 && (
              <optgroup label="Equipos">
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Personas">
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {displayName(m)}
                </option>
              ))}
            </optgroup>
          </Select>
          {labelFilterOptions.length > 0 && (
            <Select
              aria-label="Filtrar por otra columna"
              value={filters.column}
              onChange={(e) => setFilters((f) => ({ ...f, column: e.target.value }))}
              className={cn("h-8 w-auto max-w-56 text-[13px]", filters.column && "border-accent")}
            >
              <option value="">Más filtros…</option>
              {labelFilterOptions.map((c) => (
                <optgroup key={c.id} label={c.name}>
                  {c.kind === "checkbox" ? (
                    <option value={`${c.id}|__true`}>{c.name}: marcada</option>
                  ) : c.kind === "person" ? (
                    members.map((m) => (
                      <option key={m.user_id} value={`${c.id}|${m.user_id}`}>
                        {c.name}: {displayName(m)}
                      </option>
                    ))
                  ) : (
                    c.options.map((o) => (
                      <option key={o.id} value={`${c.id}|${o.id}`}>
                        {c.name}: {o.label}
                      </option>
                    ))
                  )}
                  <option value={`${c.id}|__empty`}>{c.name}: vacía</option>
                </optgroup>
              ))}
            </Select>
          )}

          {view !== "calendario" && sort && (
            <Button size="sm" variant="ghost" onClick={() => setSort(null)}>
              <IconX size={14} /> Quitar orden ({allDefs.find((d) => d.key === sort.key)?.label ?? titleLabel} {sort.dir === "asc" ? "↑" : "↓"})
            </Button>
          )}
          {active && (
            <Button size="sm" variant="ghost" onClick={() => setFilters(EMPTY_FILTERS)}>
              <IconX size={14} /> Limpiar filtros
            </Button>
          )}
          <span className="ml-auto flex items-center gap-2">
            {view === "tabla" && <ColumnsVisibility defs={allDefs} canManage={editable} onToggle={(d, visible) => setHidden(d, !visible)} />}
            <Button size="sm" variant="ghost" onClick={() => exportCsv(visibleTasks)} title="Descargar como planilla (CSV)">
              Exportar
            </Button>
            <span className="text-xs text-muted" aria-live="polite">
              {active ? `${visibleTasks.length} de ${topTasks.length}` : `${topTasks.length} elementos`}
            </span>
          </span>
        </div>
      </div>

      {view === "gantt" ? (
        <GanttView
          tasks={optimisticTasks.filter((t) => matches(t) || (t.parent_id ? matches(optimisticTasks.find((p) => p.id === t.parent_id) ?? t) : (childrenOf.get(t.id) ?? []).some(matches)))}
          groups={optimisticGroups}
          columns={optColumns}
          statuses={statuses}
          today={today}
          readOnly={readOnly}
          onOpenTask={(t) => setOpenTaskId(t.id)}
          onChangeDates={(t, source, start, end) =>
            source === "due" ? updateTask(t, { due_date: end }) : handlers.onSetValue(t, source, `${start}/${end}`)
          }
        />
      ) : view === "calendario" ? (
        <CalendarView tasks={optimisticTasks.filter(matches)} statuses={statuses} today={today} onOpenTask={(t) => setOpenTaskId(t.id)} />
      ) : view === "kanban" ? (
        <KanbanView
          tasks={sortList(visibleTasks)}
          statuses={statuses}
          priorities={priorities}
          members={members}
          today={today}
          doneIds={doneIds}
          readOnly={readOnly}
          onOpenTask={(t) => setOpenTaskId(t.id)}
          onSetStatus={(t, status_id) => updateTask(t, { status_id })}
        />
      ) : (
        <div className="space-y-6 py-6">
          {!manual && (
            <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">Con un orden aplicado, arrastrar elementos está deshabilitado. Quitá el orden para reordenar a mano.</p>
          )}
          {optimisticGroups.map((g, i) => {
            const all = tasksByGroup.get(g.id) ?? [];
            const visible = sortList(all.filter(matchesTree));
            return (
              <GroupSection
                key={g.id}
                group={g}
                groups={optimisticGroups}
                isFirst={i === 0}
                isLast={i === optimisticGroups.length - 1}
                allTasks={all}
                visibleTasks={visible}
                filtered={active}
                manual={manual}
                statuses={statuses}
                priorities={priorities}
                members={members}
                defs={defs}
                titleLabel={titleLabel}
                env={env}
                doneIds={doneIds}
                today={today}
                readOnly={readOnly || !canCreateIn(access, readEditors(g.editors))}
                canManage={canManage}
                handlers={handlers}
                headerHandlers={headerHandlers}
                labelEditors={labelEditors}
                sort={sort}
                selected={selected}
                onSelect={onSelect}
                childrenOf={childrenOf}
                expanded={expanded}
                onToggleExpand={toggleExpand}
                dragRef={dragRef}
              />
            );
          })}
          {optimisticGroups.length === 0 && <EmptyState title="Este tablero no tiene carpetas" description="Creá una carpeta para empezar a cargar elementos." />}
          {active && visibleTasks.length === 0 && topTasks.length > 0 && (
            <EmptyState icon={<IconSearch />} title="Ningún elemento coincide con los filtros" action={<Button onClick={() => setFilters(EMPTY_FILTERS)}>Limpiar filtros</Button>} />
          )}
        </div>
      )}

      {/* Barra de acciones en lote */}
      {selectedIds.length > 0 && !readOnly && (
        <BulkBar
          count={selectedIds.length}
          statuses={statuses}
          priorities={priorities}
          groups={optimisticGroups}
          statusLabel={statusLabel}
          priorityLabel={priorityLabelText}
          onStatus={(status_id) => run(() => updateTasksAction(selectedIds, { status_id }), { success: true })}
          onPriority={(priority) => run(() => updateTasksAction(selectedIds, { priority }), { success: true })}
          onMove={(groupId) => run(() => moveTasksAction(selectedIds, groupId), { success: true, before: clearSelection })}
          onDuplicate={() => run(() => duplicateTasksAction(selectedIds), { success: true, before: clearSelection })}
          onExport={() => exportCsv(optimisticTasks.filter((t) => selected.has(t.id)))}
          onDelete={() => setDeletingMany(true)}
          onClear={clearSelection}
        />
      )}

      {openTask && (
        <TaskDialog
          key={openTask.id}
          task={openTask}
          statuses={statuses}
          priorities={priorities}
          groups={optimisticGroups}
          members={members}
          columns={optColumns}
          env={env}
          labelEditors={labelEditors}
          today={today}
          readOnly={
            readOnly ||
            openTask.id.startsWith("tmp-") ||
            !canEditTask(
              access,
              openTask,
              readEditors(optimisticGroups.find((g) => g.id === openTask.group_id)?.editors),
              openTask.parent_id ? optimisticTasks.find((t) => t.id === openTask.parent_id) : null,
            )
          }
          onClose={() => setOpenTaskId(null)}
          onOpenTask={(id) => setOpenTaskId(id)}
          subitems={childrenOf.get(openTask.id) ?? []}
          parent={openTask.parent_id ? (optimisticTasks.find((t) => t.id === openTask.parent_id) ?? null) : null}
          onCreateSubitem={(title) => handlers.onCreateTask(openTask.group_id, title, openTask.id)}
          onSaved={() => toast.success("Cambios guardados.")}
          onDelete={() => {
            setOpenTaskId(null);
            setDeleting(openTask);
          }}
          onDuplicate={() => handlers.onDuplicateTask(openTask)}
          onAddChecklist={
            editable
              ? async () => {
                  const res = await createColumnAction(boardId, { name: "Checklist", kind: "checklist", options: [], settings: {} });
                  if (!res.ok) return { ok: false as const, error: res.error };
                  toast.success("Se agregó la columna Checklist al tablero.");
                  return { ok: true as const, id: res.data.id };
                }
              : undefined
          }
          endPosition={(groupId) => {
            const list = (tasksByGroup.get(groupId) ?? []).filter((t) => t.id !== openTask.id);
            return positionAt(list, list.length);
          }}
        />
      )}

      {settingsDef && (
        <ColumnSettingsDialog
          key={settingsDef.key}
          def={settingsDef}
          settings={optSettings}
          allColumns={optColumns}
          workspaceBoards={workspaceBoards.filter((b) => b.id !== boardId)}
          linkedBoards={linkedBoards}
          templates={checklistTemplates}
          statuses={statuses}
          labelEditing={
            settingsDef.column && LABEL_KINDS.includes(settingsDef.column.kind)
              ? { ...labelEditors.column(settingsDef.column)!, labels: settingsDef.column.options }
              : settingsDef.builtin === "status" && labelEditors.status
                ? { ...labelEditors.status, labels: statuses.map((s) => ({ id: s.id, label: s.label, color: asColor(s.color), done: s.is_done })) }
                : settingsDef.builtin === "priority" && labelEditors.priority
                  ? { ...labelEditors.priority, labels: priorities.map((p) => ({ id: p.value, label: p.label, color: p.color })) }
                  : undefined
          }
          preview={preview}
          onClose={() => setSettingsKey(null)}
          onSaveColumn={async (patch) => {
            const res = await updateColumnAction(settingsDef.column!.id, patch);
            if (res.ok) toast.success("Columna actualizada.");
            return res.ok ? null : res.error;
          }}
          onSaveBuiltin={async ({ label, hidden }) => {
            const cols = { ...(optSettings.columns ?? {}) };
            cols[settingsDef.builtin!] = { ...cols[settingsDef.builtin!], label, hidden };
            const res = await updateBoardSettingsAction(boardId, { ...optSettings, columns: cols });
            return res.ok ? null : res.error;
          }}
        />
      )}

      {editorsFor && (
        <EditorsDialog
          title={editorsFor.kind === "group" ? `Quién edita la carpeta «${editorsFor.group.name}»` : `Quién puede cambiar «${editorsFor.def.label}»`}
          description={
            editorsFor.kind === "group"
              ? "Solo estas personas o equipos crean y editan los elementos de la carpeta (se pueden pasar elementos a ella desde otras). En el checklist, la sección con el mismo nombre que la carpeta también queda solo para ellos."
              : "Solo estas personas o equipos pueden cambiar el valor de esta columna en los elementos."
          }
          initial={editorsFor.kind === "group" ? readEditors(editorsFor.group.editors) : (cellCtx.columnEditors.get(editorsFor.def.key) ?? {})}
          people={members}
          teams={teams}
          onClose={() => setEditorsFor(null)}
          onSave={async (e) => {
            const res =
              editorsFor.kind === "group"
                ? await setGroupEditorsAction(editorsFor.group.id, e)
                : await setColumnEditorsAction(boardId, editorsFor.def.key, e);
            if (res.ok) toast.success(res.message ?? "Guardado.");
            return res;
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Eliminar elemento"
        description={
          <>
            Vas a eliminar <strong className="text-fg">“{deleting?.title}”</strong>
            {deleting && (childrenOf.get(deleting.id)?.length ?? 0) > 0 && (
              <>
                {" "}
                con sus <strong className="text-fg">{childrenOf.get(deleting.id)!.length} subelementos</strong>
              </>
            )}{" "}
            y sus comentarios. No se puede deshacer.
          </>
        }
        confirmLabel="Eliminar"
        onConfirm={() => {
          const t = deleting;
          setDeleting(null);
          if (t) run(() => deleteTaskAction(t.id), { task: { type: "remove", id: t.id }, success: "Elemento eliminado." });
        }}
      />

      <ConfirmDialog
        open={deletingMany}
        onClose={() => setDeletingMany(false)}
        title={`Eliminar ${selectedIds.length} ${selectedIds.length === 1 ? "elemento" : "elementos"}`}
        description="Se eliminan con sus comentarios. No se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={() => {
          const ids = selectedIds;
          setDeletingMany(false);
          clearSelection();
          run(() => deleteTasksAction(ids), { success: true });
        }}
      />

      <ConfirmDialog
        open={Boolean(deletingColumn)}
        onClose={() => setDeletingColumn(null)}
        title="Eliminar columna"
        description={
          <>
            Se elimina la columna <strong className="text-fg">“{deletingColumn?.name}”</strong> con todos sus valores. Las reglas que la usan dejan de copiarla. No se puede deshacer.
          </>
        }
        requireText={deletingColumn?.name}
        confirmLabel="Eliminar columna"
        onConfirm={() => {
          const c = deletingColumn;
          setDeletingColumn(null);
          if (c) run(() => deleteColumnAction(c.id), { success: true, before: () => applyColumn({ remove: c.id }) });
        }}
      />

      <ConfirmDialog
        open={Boolean(deletingGroup)}
        onClose={() => setDeletingGroup(null)}
        title="Eliminar carpeta"
        description={
          deletingGroup && (
            <>
              Se elimina la carpeta <strong className="text-fg">“{deletingGroup.name}”</strong>
              {(tasksByGroup.get(deletingGroup.id)?.length ?? 0) > 0 && (
                <>
                  {" "}
                  junto con sus <strong className="text-fg">{tasksByGroup.get(deletingGroup.id)?.length} elementos</strong>. Si querés conservarlos, movelos a otra carpeta antes
                </>
              )}
              . No se puede deshacer.
            </>
          )
        }
        requireText={(tasksByGroup.get(deletingGroup?.id ?? "")?.length ?? 0) > 0 ? deletingGroup?.name : undefined}
        confirmLabel="Eliminar carpeta"
        onConfirm={() => {
          const g = deletingGroup;
          setDeletingGroup(null);
          if (g) run(() => deleteGroupAction(g.id), { group: { type: "remove", id: g.id }, success: "Carpeta eliminada." });
        }}
      />

      <NewGroupDialog
        open={newGroupOpen}
        onClose={() => setNewGroupOpen(false)}
        onCreate={async (name) => {
          const res = await createGroupAction(boardId, name);
          if (!res.ok) {
            toast.error(res.error);
            return false;
          }
          return true;
        }}
      />
    </div>
    </CellContext.Provider>
  );
}

function BulkBar({
  count,
  statuses,
  priorities,
  groups,
  statusLabel,
  priorityLabel,
  onStatus,
  onPriority,
  onMove,
  onDuplicate,
  onExport,
  onDelete,
  onClear,
}: {
  count: number;
  statuses: Status[];
  priorities: { value: Priority; label: string }[];
  groups: Group[];
  statusLabel: string;
  priorityLabel: string;
  onStatus: (id: string | null) => void;
  onPriority: (p: Priority) => void;
  onMove: (groupId: string) => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const statusItems: MenuItem[] = [...statuses.map<MenuItem>((s) => ({ label: s.label, icon: <span className={cn(`solid-${asColor(s.color)}`, "block h-3 w-3 rounded-full")} />, onSelect: () => onStatus(s.id) })), { label: `Sin ${statusLabel.toLowerCase()}`, onSelect: () => onStatus(null) }];
  const priorityItems: MenuItem[] = priorities.map((p) => ({ label: p.label, onSelect: () => onPriority(p.value) }));
  const moveItems: MenuItem[] = groups.map((g) => ({ label: g.name, icon: <IconMove size={16} />, onSelect: () => onMove(g.id) }));
  const btn = "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold hover:bg-surface-2";
  return (
    <div role="region" aria-label="Acciones sobre los elementos seleccionados" className="animate-in fixed inset-x-3 bottom-4 z-40 mx-auto flex max-w-3xl flex-wrap items-center gap-1 rounded-2xl border border-line bg-surface p-2 shadow-pop">
      <span className="flex h-9 items-center gap-2 rounded-lg bg-accent px-3 text-sm font-bold text-accent-fg">{count}</span>
      <span className="mr-1 text-sm font-semibold">{count === 1 ? "seleccionado" : "seleccionados"}</span>
      <span className="flex flex-wrap items-center gap-0.5">
        <Menu label={`Cambiar ${statusLabel.toLowerCase()}`} trigger={<span className="text-[13px] font-semibold">{statusLabel}</span>} items={statusItems} align="start" triggerClassName={cn(btn, "w-auto")} />
        <Menu label={`Cambiar ${priorityLabel.toLowerCase()}`} trigger={<span className="text-[13px] font-semibold">{priorityLabel}</span>} items={priorityItems} align="start" triggerClassName={cn(btn, "w-auto")} />
        <Menu label="Mover a carpeta" trigger={<span className="text-[13px] font-semibold">Mover</span>} items={moveItems} align="start" triggerClassName={cn(btn, "w-auto")} />
        <button type="button" onClick={onDuplicate} className={btn}>
          <IconCopy size={15} /> Duplicar
        </button>
        <button type="button" onClick={onExport} className={btn}>
          Exportar
        </button>
        <button type="button" onClick={onDelete} className={cn(btn, "text-danger hover:bg-danger-soft")}>
          <IconTrash size={15} /> Eliminar
        </button>
      </span>
      <button type="button" onClick={onClear} aria-label="Quitar la selección" className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2">
        <IconX size={16} />
      </button>
    </div>
  );
}

function ViewTab({ href, active, icon, children }: { href: string; active: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      scroll={false}
      className={cn("inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold", active ? "bg-fg text-bg" : "text-muted hover:text-fg")}
    >
      {icon}
      {children}
    </Link>
  );
}

function NewGroupDialog({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (name: string) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const close = () => {
    setName("");
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} title="Nueva carpeta" size="sm">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setBusy(true);
          const ok = await onCreate(name.trim());
          setBusy(false);
          if (ok) close();
        }}
      >
        <div>
          <label htmlFor="new-group-name" className="mb-1.5 block text-sm font-semibold">
            Nombre de la carpeta
          </label>
          <Input id="new-group-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Por ejemplo: Próxima semana" autoFocus required />
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={close}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
            {busy ? "Creando…" : "Crear carpeta"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export type { ColumnKey };
