"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { COLOR_LABELS, COLOR_NAMES, asColor, type ColorName } from "@/lib/constants";
import { Menu, type MenuItem } from "@/components/ui/menu";
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconDots,
  IconEdit,
  IconGrip,
  IconMove,
  IconPlus,
  IconTrash,
} from "@/components/ui/icons";
import { AssigneeSelect, DueBadge, DueDateInput, PrioritySelect, StatusSelect } from "./task-fields";
import { CustomValueInput } from "./custom-cell";
import { readValues, type BoardColumn, type CellValue } from "@/lib/columns";
import type { Group, Member, Status, Task } from "./types";

export type GroupHandlers = {
  onUpdateTask: (t: Task, patch: Partial<Task>) => void;
  onSetValue: (t: Task, columnId: string, value: CellValue | null) => void;
  onOpenTask: (t: Task) => void;
  onDeleteTask: (t: Task) => void;
  onDuplicateTask: (t: Task) => void;
  onMoveTask: (t: Task, groupId: string, index: number) => void;
  onMoveTaskById: (taskId: string, groupId: string, index: number) => void;
  onCreateTask: (groupId: string, title: string) => void;
  onRenameGroup: (g: Group, name: string) => void;
  onRecolorGroup: (g: Group, color: ColorName) => void;
  onMoveGroup: (g: Group, dir: "up" | "down") => void;
  onDeleteGroup: (g: Group) => void;
};

type Props = {
  group: Group;
  groups: Group[];
  isFirst: boolean;
  isLast: boolean;
  allTasks: Task[];
  visibleTasks: Task[];
  filtered: boolean;
  manual: boolean;
  statuses: Status[];
  members: Member[];
  columns: BoardColumn[];
  doneIds: Set<string>;
  today: string;
  readOnly: boolean;
  handlers: GroupHandlers;
  /** Tarea que se está arrastrando (compartida entre grupos). */
  dragRef: React.RefObject<string | null>;
};


export function GroupSection(props: Props) {
  const { group, allTasks, visibleTasks, filtered, readOnly, handlers, statuses, doneIds, dragRef } = props;
  const [collapsed, setCollapsed] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const color = asColor(group.color);
  const bodyId = `grupo-${group.id}`;
  const doneCount = allTasks.filter((t) => t.status_id && doneIds.has(t.status_id)).length;
  const dnd = !readOnly && props.manual;

  const groupMenu: MenuItem[] = [
    { label: "Renombrar", icon: <IconEdit size={16} />, onSelect: () => setRenaming(true) },
    { label: "Subir carpeta", icon: <IconArrowUp size={16} />, onSelect: () => handlers.onMoveGroup(group, "up"), disabled: props.isFirst },
    { label: "Bajar carpeta", icon: <IconArrowDown size={16} />, onSelect: () => handlers.onMoveGroup(group, "down"), disabled: props.isLast },
    { type: "label", label: "Color" },
    ...COLOR_NAMES.map<MenuItem>((c) => ({
      label: `${COLOR_LABELS[c]}${c === color ? " (actual)" : ""}`,
      icon: <span className={cn(`dot-${c}`, "block h-3 w-3 rounded-full bg-[var(--dot)]")} />,
      onSelect: () => handlers.onRecolorGroup(group, c),
    })),
    { type: "separator" },
    {
      label: "Eliminar carpeta",
      icon: <IconTrash size={16} />,
      danger: true,
      onSelect: () => handlers.onDeleteGroup(group),
      disabled: props.groups.length <= 1,
    },
  ];

  // Índice en la lista completa (ordenada por posición) para soltar antes de `beforeTask`.
  const indexInGroup = (beforeTask: Task | null) => {
    const list = allTasks.filter((t) => t.id !== dragRef.current);
    if (!beforeTask) return list.length;
    const i = list.findIndex((t) => t.id === beforeTask.id);
    return i < 0 ? list.length : i;
  };

  const dropOn = (beforeTask: Task | null) => {
    const id = dragRef.current;
    dragRef.current = null;
    setDropIndex(null);
    if (!id) return;
    // La tarea arrastrada puede venir de otro grupo.
    handlers.onMoveTaskById(id, group.id, indexInGroup(beforeTask));
  };

  return (
    <section aria-labelledby={`${bodyId}-title`} className={cn(`dot-${color}`, "rounded-2xl border border-line bg-surface shadow-card")}>
      <header className="flex items-center gap-2 rounded-t-2xl border-b border-line py-2 pl-2 pr-3" style={{ boxShadow: "inset 4px 0 0 var(--dot)" }}>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          aria-label={collapsed ? `Expandir carpeta ${group.name}` : `Contraer carpeta ${group.name}`}
          className="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
        >
          {collapsed ? <IconChevronRight size={16} /> : <IconChevronDown size={16} />}
        </button>
        {renaming ? (
          <form
            className="flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              const value = String(new FormData(e.currentTarget).get("name") ?? "").trim();
              if (value && value !== group.name) handlers.onRenameGroup(group, value);
              setRenaming(false);
            }}
          >
            <input
              name="name"
              defaultValue={group.name}
              maxLength={80}
              autoFocus
              aria-label="Nombre de la carpeta"
              onBlur={(e) => e.currentTarget.form?.requestSubmit()}
              onKeyDown={(e) => e.key === "Escape" && setRenaming(false)}
              className="h-8 w-full max-w-sm rounded-lg border border-line bg-surface px-2 text-[15px] font-bold"
            />
          </form>
        ) : (
          <h2 id={`${bodyId}-title`} className="min-w-0 flex-1 truncate text-[15px] font-bold" style={{ color: "var(--dot)" }}>
            <span className="text-fg">{group.name}</span>
          </h2>
        )}
        <span className="shrink-0 text-xs text-muted">
          {filtered ? `${visibleTasks.length} de ${allTasks.length}` : allTasks.length}{" "}
          {allTasks.length === 1 ? "tarea" : "tareas"}
          {allTasks.length > 0 && <span className="hidden sm:inline"> · {doneCount} hechas</span>}
        </span>
        {!readOnly && <Menu label={`Acciones de la carpeta ${group.name}`} trigger={<IconDots />} items={groupMenu} />}
      </header>

      {!collapsed && (
        <div id={bodyId}>
          {/* Escritorio y tablet: tabla con desplazamiento horizontal si hace falta */}
          <div className="hidden overflow-x-auto md:block">
            <table
              className="w-full table-fixed border-collapse text-sm"
              style={{ minWidth: 690 + (props.columns.length ? 260 : 190) + props.columns.length * 140 }}
            >
              <caption className="sr-only">Tareas de la carpeta {group.name}</caption>
              <colgroup>
                <col className="w-8" />
                <col />
                <col className="w-[170px]" />
                <col className="w-[150px]" />
                <col className="w-[140px]" />
                <col className="w-[150px]" />
                {props.columns.map((c) => (
                  <col key={c.id} className="w-[140px]" />
                ))}
                <col className="w-12" />
              </colgroup>
              <thead>
                <tr className="text-left text-xs font-semibold text-muted">
                  <th scope="col" className="px-1 py-2">
                    <span className="sr-only">Mover</span>
                  </th>
                  <th scope="col" className="px-2 py-2">Tarea</th>
                  <th scope="col" className="px-2 py-2">Responsable</th>
                  <th scope="col" className="px-2 py-2">Estado</th>
                  <th scope="col" className="px-2 py-2">Prioridad</th>
                  <th scope="col" className="px-2 py-2">Vencimiento</th>
                  {props.columns.map((c) => (
                    <th key={c.id} scope="col" className="truncate px-2 py-2" title={c.name}>
                      {c.name}
                    </th>
                  ))}
                  <th scope="col" className="px-2 py-2">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody
                onDragOver={(e) => {
                  if (!dnd || !dragRef.current) return;
                  e.preventDefault();
                }}
                onDrop={(e) => {
                  if (!dnd) return;
                  e.preventDefault();
                  dropOn(null);
                }}
              >
                {visibleTasks.map((task, i) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    {...props}
                    dnd={dnd}
                    showDropLine={dropIndex === i}
                    onDragOverRow={() => setDropIndex(i)}
                    onDropRow={() => dropOn(task)}
                    onDragEnd={() => setDropIndex(null)}
                  />
                ))}
                {visibleTasks.length === 0 && (
                  <tr>
                    <td colSpan={7 + props.columns.length} className={cn("px-4 py-5 text-center text-sm text-muted", dropIndex !== null && "bg-accent-soft")}>
                      {filtered ? "Ninguna tarea de esta carpeta coincide con los filtros." : "Esta carpeta está vacía. Agregá la primera tarea abajo."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Celular: tarjetas */}
          <ul className="divide-y divide-line md:hidden">
            {visibleTasks.map((task) => (
              <TaskCard key={task.id} task={task} {...props} />
            ))}
            {visibleTasks.length === 0 && (
              <li className="px-4 py-5 text-center text-sm text-muted">
                {filtered ? "Ninguna tarea coincide con los filtros." : "Esta carpeta está vacía."}
              </li>
            )}
          </ul>

          {!readOnly && <AddTaskRow groupName={group.name} onCreate={(title) => handlers.onCreateTask(group.id, title)} />}
          {statuses.length > 0 && allTasks.length > 0 && <StatusBar tasks={allTasks} statuses={statuses} />}
        </div>
      )}
    </section>
  );
}

function taskMenu(task: Task, props: Props): MenuItem[] {
  const { handlers, groups, group, manual, allTasks } = props;
  const posInGroup = allTasks.findIndex((t) => t.id === task.id);
  return [
    { label: "Abrir detalle", icon: <IconEdit size={16} />, onSelect: () => handlers.onOpenTask(task) },
    { label: "Duplicar", icon: <IconCopy size={16} />, onSelect: () => handlers.onDuplicateTask(task) },
    {
      label: "Subir",
      icon: <IconArrowUp size={16} />,
      disabled: !manual || posInGroup <= 0,
      onSelect: () => handlers.onMoveTask(task, group.id, posInGroup - 1),
    },
    {
      label: "Bajar",
      icon: <IconArrowDown size={16} />,
      disabled: !manual || posInGroup >= allTasks.length - 1,
      onSelect: () => handlers.onMoveTask(task, group.id, posInGroup + 1),
    },
    ...(groups.length > 1
      ? [
          { type: "label", label: "Mover a" } as MenuItem,
          ...groups
            .filter((g) => g.id !== group.id)
            .map<MenuItem>((g) => ({
              label: g.name,
              icon: <IconMove size={16} />,
              onSelect: () => handlers.onMoveTask(task, g.id, Number.MAX_SAFE_INTEGER),
            })),
        ]
      : []),
    { type: "separator" },
    { label: "Eliminar", icon: <IconTrash size={16} />, danger: true, onSelect: () => handlers.onDeleteTask(task) },
  ];
}

function TitleInput({ task, onSave, disabled, className }: { task: Task; onSave: (title: string) => void; disabled: boolean; className?: string }) {
  return (
    <input
      key={task.title}
      defaultValue={task.title}
      aria-label="Título de la tarea"
      disabled={disabled}
      maxLength={500}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = task.title;
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        const value = e.currentTarget.value.trim();
        if (!value) {
          e.currentTarget.value = task.title;
          return;
        }
        if (value !== task.title) onSave(value);
      }}
      className={cn(
        "h-8 w-full min-w-0 truncate rounded-lg border border-transparent bg-transparent px-2 font-medium hover:border-line focus:bg-surface disabled:opacity-60",
        className,
      )}
    />
  );
}

function TaskRow({
  task,
  dnd,
  showDropLine,
  onDragOverRow,
  onDropRow,
  onDragEnd,
  ...props
}: Props & {
  task: Task;
  dnd: boolean;
  showDropLine: boolean;
  onDragOverRow: () => void;
  onDropRow: () => void;
  onDragEnd: () => void;
}) {
  const { statuses, members, today, doneIds, readOnly, handlers, dragRef } = props;
  const pending = task.id.startsWith("tmp-");
  const disabled = readOnly || pending;
  const done = Boolean(task.status_id && doneIds.has(task.status_id));
  const values = readValues(task.custom_values);

  return (
    <tr
      draggable={dnd && !pending}
      onDragStart={(e) => {
        dragRef.current = task.id;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", task.id);
      }}
      onDragEnd={() => {
        dragRef.current = null;
        onDragEnd();
      }}
      onDragOver={(e) => {
        if (!dnd || !dragRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        onDragOverRow();
      }}
      onDrop={(e) => {
        if (!dnd) return;
        e.preventDefault();
        e.stopPropagation();
        onDropRow();
      }}
      className={cn(
        "group/row border-t border-line transition-colors hover:bg-surface-2/60",
        pending && "opacity-60",
        showDropLine && "shadow-[inset_0_2px_0_var(--accent)]",
      )}
    >
      <td className="px-1 text-center align-middle">
        {dnd && !pending && (
          <span className="inline-flex cursor-grab text-subtle opacity-0 group-hover/row:opacity-100" aria-hidden title="Arrastrar para mover">
            <IconGrip size={16} />
          </span>
        )}
      </td>
      <td className="px-1.5 py-1.5">
        <div className="flex items-center gap-1">
          <TitleInput task={task} disabled={disabled} onSave={(title) => handlers.onUpdateTask(task, { title })} className={cn(done && "text-muted line-through decoration-1")} />
          <button
            type="button"
            onClick={() => handlers.onOpenTask(task)}
            disabled={pending}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-accent opacity-70 hover:bg-accent-soft hover:opacity-100 focus-visible:opacity-100 group-hover/row:opacity-100"
          >
            Abrir<span className="sr-only"> detalle de {task.title}</span>
          </button>
        </div>
      </td>
      <td className="px-1.5">
        <AssigneeSelect
          value={task.assignee_id}
          members={members}
          disabled={disabled}
          label={`Responsable de ${task.title}`}
          onChange={(assignee_id) => handlers.onUpdateTask(task, { assignee_id })}
        />
      </td>
      <td className="px-1.5">
        <StatusSelect
          value={task.status_id}
          statuses={statuses}
          disabled={disabled}
          label={`Estado de ${task.title}`}
          onChange={(status_id) => handlers.onUpdateTask(task, { status_id })}
        />
      </td>
      <td className="px-1.5">
        <PrioritySelect
          value={task.priority}
          disabled={disabled}
          label={`Prioridad de ${task.title}`}
          onChange={(priority) => handlers.onUpdateTask(task, { priority })}
        />
      </td>
      <td className="px-1.5 py-1.5">
        <DueDateInput
          value={task.due_date}
          today={today}
          done={done}
          disabled={disabled}
          label={`Vencimiento de ${task.title}`}
          onChange={(due_date) => handlers.onUpdateTask(task, { due_date })}
        />
      </td>
      {props.columns.map((c) => (
        <td key={c.id} className="px-1.5 py-1.5">
          <CustomValueInput
            column={c}
            value={values[c.id]}
            members={members}
            disabled={disabled}
            label={`${c.name} de ${task.title}`}
            onChange={(v) => handlers.onSetValue(task, c.id, v)}
          />
        </td>
      ))}
      <td className="px-1 text-center">
        {!disabled && <Menu label={`Acciones de ${task.title}`} trigger={<IconDots />} items={taskMenu(task, props)} />}
      </td>
    </tr>
  );
}

function TaskCard({ task, ...props }: Props & { task: Task }) {
  const { statuses, today, doneIds, readOnly, handlers, members } = props;
  const pending = task.id.startsWith("tmp-");
  const disabled = readOnly || pending;
  const done = Boolean(task.status_id && doneIds.has(task.status_id));
  const assignee = members.find((m) => m.user_id === task.assignee_id);

  return (
    <li className={cn("px-3 py-3", pending && "opacity-60")}>
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => handlers.onOpenTask(task)}
          disabled={pending}
          className={cn("min-w-0 flex-1 text-left font-semibold leading-snug", done && "text-muted line-through decoration-1")}
        >
          {task.title}
        </button>
        {!disabled && <Menu label={`Acciones de ${task.title}`} trigger={<IconDots />} items={taskMenu(task, props)} />}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <StatusSelect
          value={task.status_id}
          statuses={statuses}
          disabled={disabled}
          label={`Estado de ${task.title}`}
          onChange={(status_id) => handlers.onUpdateTask(task, { status_id })}
        />
        <PrioritySelect
          value={task.priority}
          disabled={disabled}
          label={`Prioridad de ${task.title}`}
          onChange={(priority) => handlers.onUpdateTask(task, { priority })}
        />
      </div>
      <p className="mt-2 flex flex-wrap gap-x-3 text-xs text-muted">
        <span>{assignee ? assignee.full_name || assignee.email : "Sin responsable"}</span>
        <DueBadge value={task.due_date} today={today} done={done} />
      </p>
    </li>
  );
}

function AddTaskRow({ groupName, onCreate }: { groupName: string; onCreate: (title: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="flex items-center gap-2 border-t border-line px-3 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        const title = value.trim();
        if (!title) return;
        onCreate(title);
        setValue("");
      }}
    >
      <IconPlus size={16} className="shrink-0 text-subtle" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={500}
        placeholder="Agregar tarea y presionar Enter"
        aria-label={`Nueva tarea en ${groupName}`}
        className="h-9 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 text-sm placeholder:text-subtle hover:border-line focus:bg-surface"
      />
      {value.trim() && (
        <button type="submit" className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg">
          Agregar
        </button>
      )}
    </form>
  );
}

function StatusBar({ tasks, statuses }: { tasks: Task[]; statuses: Status[] }) {
  const counts = statuses
    .map((s) => ({ s, n: tasks.filter((t) => t.status_id === s.id).length }))
    .filter((x) => x.n > 0);
  const none = tasks.filter((t) => !t.status_id).length;
  const summary = [...counts.map((c) => `${c.s.label}: ${c.n}`), ...(none ? [`Sin estado: ${none}`] : [])].join(", ");
  return (
    <div className="flex items-center gap-3 rounded-b-2xl border-t border-line px-4 py-2">
      <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`Distribución por estado. ${summary}`}>
        {counts.map(({ s, n }) => (
          <span key={s.id} className={cn(`dot-${asColor(s.color)}`, "h-full bg-[var(--dot)]")} style={{ width: `${(n / tasks.length) * 100}%` }} />
        ))}
      </div>
      <span className="hidden text-xs text-muted sm:block" aria-hidden>
        {summary}
      </span>
    </div>
  );
}
