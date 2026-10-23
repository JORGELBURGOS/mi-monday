"use client";

import Link from "next/link";
import { useMemo, useOptimistic, useRef, useState, useSyncExternalStore, useTransition } from "react";
import {
  createTaskAction,
  deleteTaskAction,
  duplicateTaskAction,
  moveTaskAction,
  updateTaskAction,
} from "@/app/actions/tasks";
import { createGroupAction, deleteGroupAction, updateGroupAction } from "@/app/actions/boards";
import { setCustomValuesAction } from "@/app/actions/columns";
import { readValues, type BoardColumn } from "@/lib/columns";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/cn";
import { PRIORITIES } from "@/lib/constants";
import { displayName, todayIsoLocal } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/misc";
import { IconCalendar, IconFilter, IconPlus, IconSearch, IconSort, IconTable, IconX } from "@/components/ui/icons";
import { GroupSection, type GroupHandlers } from "./group-section";
import { CalendarView } from "./calendar-view";
import { TaskDialog } from "./task-dialog";
import { filtersActive, groupReducer, matchesFilters, positionAt, sortTasks, taskReducer } from "./logic";
import {
  EMPTY_FILTERS,
  type Filters,
  type Group,
  type GroupChange,
  type Member,
  type SortDir,
  type SortKey,
  type Status,
  type Task,
  type TaskChange,
} from "./types";

const noopSubscribe = () => () => {};

export function BoardView({
  boardId,
  view,
  statuses,
  groups,
  tasks,
  members,
  columns,
  serverToday,
  readOnly,
  initialTaskId,
}: {
  boardId: string;
  view: "tabla" | "calendario";
  statuses: Status[];
  groups: Group[];
  tasks: Task[];
  members: Member[];
  columns: BoardColumn[];
  serverToday: string;
  readOnly: boolean;
  /** Ítem a abrir al cargar (por ejemplo, desde el recorrido de otro tablero). */
  initialTaskId?: string;
}) {
  const toast = useToast();
  const today = useSyncExternalStore(noopSubscribe, todayIsoLocal, () => serverToday);
  const [optimisticTasks, applyTask] = useOptimistic(tasks, taskReducer);
  const [optimisticGroups, applyGroup] = useOptimistic(groups, groupReducer);
  const [, startTransition] = useTransition();

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>("manual");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [openTaskId, setOpenTaskId] = useState<string | null>(
    initialTaskId && tasks.some((t) => t.id === initialTaskId) ? initialTaskId : null,
  );
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<Group | null>(null);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const dragRef = useRef<string | null>(null);

  const doneIds = useMemo(() => new Set(statuses.filter((s) => s.is_done).map((s) => s.id)), [statuses]);
  const active = filtersActive(filters);
  const manual = sortKey === "manual";

  /** Ejecuta una mutación con actualización optimista y aviso de error. */
  const run = (
    fn: () => Promise<ActionResult<unknown>>,
    opts: { task?: TaskChange; group?: GroupChange; success?: string } = {},
  ) =>
    startTransition(async () => {
      if (opts.task) applyTask(opts.task);
      if (opts.group) applyGroup(opts.group);
      const res = await fn();
      if (!res.ok) toast.error(res.error);
      else if (opts.success) toast.success(opts.success);
    });

  const tasksByGroup = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const g of optimisticGroups) map.set(g.id, []);
    for (const t of optimisticTasks) map.get(t.group_id)?.push(t);
    for (const [k, list] of map) map.set(k, list.sort((a, b) => a.position - b.position));
    return map;
  }, [optimisticTasks, optimisticGroups]);

  const visibleCount = optimisticTasks.filter((t) => matchesFilters(t, filters)).length;

  const updateTask = (task: Task, patch: Partial<Task>) => {
    run(() => updateTaskAction(task.id, patch), { task: { type: "update", id: task.id, patch } });
  };

  const moveTask = (task: Task, groupId: string, index: number) => {
    const target = (tasksByGroup.get(groupId) ?? []).filter((t) => t.id !== task.id);
    const position = positionAt(target, Math.max(0, Math.min(index, target.length)));
    run(() => moveTaskAction({ taskId: task.id, groupId, position }), {
      task: { type: "update", id: task.id, patch: { group_id: groupId, position } },
    });
  };

  const handlers: GroupHandlers = {
    onUpdateTask: updateTask,
    onSetValue: (task, columnId, value) => {
      const next = { ...readValues(task.custom_values) };
      if (value === null) delete next[columnId];
      else next[columnId] = value;
      run(() => setCustomValuesAction(task.id, { [columnId]: value }), {
        task: { type: "update", id: task.id, patch: { custom_values: next } },
      });
    },
    onOpenTask: (t) => setOpenTaskId(t.id),
    onDeleteTask: (t) => setDeleting(t),
    onDuplicateTask: (t) => run(() => duplicateTaskAction(t.id), { success: "Tarea duplicada." }),
    onMoveTask: moveTask,
    onMoveTaskById: (taskId, groupId, index) => {
      const task = optimisticTasks.find((t) => t.id === taskId);
      if (task) moveTask(task, groupId, index);
    },
    onCreateTask: (groupId, title) => {
      const temp: Task = {
        id: `tmp-${crypto.randomUUID()}`,
        board_id: boardId,
        group_id: groupId,
        title,
        description: null,
        status_id: statuses[0]?.id ?? null,
        priority: "medium",
        assignee_id: null,
        due_date: null,
        custom_values: {},
        position: Number.MAX_SAFE_INTEGER,
        created_by: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      run(() => createTaskAction(boardId, groupId, title), { task: { type: "add", task: temp } });
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
  };

  const openTask = optimisticTasks.find((t) => t.id === openTaskId) ?? null;
  const assigneeOptions = members;

  return (
    <div>
      {/* Barra de herramientas */}
      <div className="sticky top-14 z-20 -mx-4 border-b border-line bg-bg/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8 lg:top-0">
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Vistas del tablero" className="flex rounded-lg border border-line bg-surface p-0.5">
            <ViewTab href={`/t/${boardId}`} active={view === "tabla"} icon={<IconTable size={16} />}>
              Tabla
            </ViewTab>
            <ViewTab href={`/t/${boardId}?vista=calendario`} active={view === "calendario"} icon={<IconCalendar size={16} />}>
              Calendario
            </ViewTab>
          </nav>

          <div className="relative min-w-0 flex-1 basis-48">
            <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
            <Input
              type="search"
              aria-label="Buscar tareas por título"
              placeholder="Buscar por título…"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              className="h-9 pl-9"
            />
          </div>

          {!readOnly && view === "tabla" && (
            <Button variant="primary" size="sm" className="h-9" onClick={() => setNewGroupOpen(true)}>
              <IconPlus size={16} /> Carpeta
            </Button>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Filtros y orden">
          <IconFilter size={15} className="text-subtle" />
          <Select
            aria-label="Filtrar por estado"
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            className={cn("h-8 w-auto text-[13px]", filters.status !== "all" && "border-accent")}
          >
            <option value="all">Todos los estados</option>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
            <option value="none">Sin estado</option>
          </Select>
          <Select
            aria-label="Filtrar por prioridad"
            value={filters.priority}
            onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value as Filters["priority"] }))}
            className={cn("h-8 w-auto text-[13px]", filters.priority !== "all" && "border-accent")}
          >
            <option value="all">Todas las prioridades</option>
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filtrar por responsable"
            value={filters.assignee}
            onChange={(e) => setFilters((f) => ({ ...f, assignee: e.target.value }))}
            className={cn("h-8 w-auto max-w-48 text-[13px]", filters.assignee !== "all" && "border-accent")}
          >
            <option value="all">Todos los responsables</option>
            <option value="none">Sin responsable</option>
            {assigneeOptions.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {displayName(m)}
              </option>
            ))}
          </Select>

          {view === "tabla" && (
            <>
              <span className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden />
              <IconSort size={15} className="text-subtle" />
              <Select
                aria-label="Ordenar tareas por"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="h-8 w-auto text-[13px]"
              >
                <option value="manual">Orden manual</option>
                <option value="title">Nombre</option>
                <option value="priority">Prioridad</option>
                <option value="due">Vencimiento</option>
                <option value="status">Estado</option>
              </Select>
              {!manual && (
                <Button
                  size="sm"
                  onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                  aria-label={`Dirección del orden: ${sortDir === "asc" ? "ascendente" : "descendente"}. Cambiar.`}
                >
                  {sortDir === "asc" ? "Ascendente ↑" : "Descendente ↓"}
                </Button>
              )}
            </>
          )}

          {active && (
            <Button size="sm" variant="ghost" onClick={() => setFilters(EMPTY_FILTERS)}>
              <IconX size={14} /> Limpiar filtros
            </Button>
          )}
          <p className="ml-auto text-xs text-muted" aria-live="polite">
            {active ? `${visibleCount} de ${optimisticTasks.length} tareas` : `${optimisticTasks.length} tareas`}
          </p>
        </div>
      </div>

      {view === "calendario" ? (
        <CalendarView
          tasks={optimisticTasks.filter((t) => matchesFilters(t, filters))}
          statuses={statuses}
          today={today}
          onOpenTask={(t) => setOpenTaskId(t.id)}
        />
      ) : (
        <div className="space-y-6 py-6">
          {!manual && (
            <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
              Con un orden aplicado, mover tareas arriba o abajo está deshabilitado. Elegí “Orden manual” para reordenar.
            </p>
          )}
          {optimisticGroups.map((g, i) => {
            const all = tasksByGroup.get(g.id) ?? [];
            const visible = sortTasks(all.filter((t) => matchesFilters(t, filters)), sortKey, sortDir, statuses);
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
                members={members}
                columns={columns}
                doneIds={doneIds}
                today={today}
                readOnly={readOnly}
                handlers={handlers}
                dragRef={dragRef}
              />
            );
          })}
          {optimisticGroups.length === 0 && (
            <EmptyState title="Este tablero no tiene carpetas" description="Creá una carpeta para empezar a cargar tareas." />
          )}
          {active && visibleCount === 0 && optimisticTasks.length > 0 && (
            <EmptyState
              icon={<IconSearch />}
              title="Ninguna tarea coincide con los filtros"
              action={<Button onClick={() => setFilters(EMPTY_FILTERS)}>Limpiar filtros</Button>}
            />
          )}
        </div>
      )}

      {openTask && (
        <TaskDialog
          key={openTask.id}
          task={openTask}
          statuses={statuses}
          groups={optimisticGroups}
          members={members}
          columns={columns}
          today={today}
          readOnly={readOnly || openTask.id.startsWith("tmp-")}
          onClose={() => setOpenTaskId(null)}
          onOpenTask={(id) => setOpenTaskId(id)}
          onSaved={() => toast.success("Cambios guardados.")}
          onDelete={() => {
            setOpenTaskId(null);
            setDeleting(openTask);
          }}
          onDuplicate={() => handlers.onDuplicateTask(openTask)}
          endPosition={(groupId) => {
            const list = (tasksByGroup.get(groupId) ?? []).filter((t) => t.id !== openTask.id);
            return positionAt(list, list.length);
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Eliminar tarea"
        description={
          <>
            Vas a eliminar <strong className="text-fg">“{deleting?.title}”</strong> y sus comentarios. No se puede deshacer.
          </>
        }
        confirmLabel="Eliminar tarea"
        onConfirm={() => {
          const t = deleting;
          setDeleting(null);
          if (t) run(() => deleteTaskAction(t.id), { task: { type: "remove", id: t.id }, success: "Tarea eliminada." });
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
                  junto con sus <strong className="text-fg">{tasksByGroup.get(deletingGroup.id)?.length} tareas</strong>. Si
                  querés conservarlas, movelas a otra carpeta antes
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
  );
}

function ViewTab({ href, active, icon, children }: { href: string; active: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      scroll={false}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold",
        active ? "bg-fg text-bg" : "text-muted hover:text-fg",
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

function NewGroupDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<boolean>;
}) {
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
          <Input
            id="new-group-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="Por ejemplo: Próxima semana"
            autoFocus
            required
          />
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
