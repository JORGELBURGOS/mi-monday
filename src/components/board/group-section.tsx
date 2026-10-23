"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { COLOR_LABELS, COLOR_NAMES, asColor, type ColorName, type Priority } from "@/lib/constants";
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
import { AssigneeSelect, DueBadge, DueDateInput } from "./task-fields";
import { ComputedCell, CustomValueInput } from "./custom-cell";
import { LabelCell, type LabelEditing } from "./label-picker";
import { AddColumnButton, ColumnHeader, type ColumnDef, type HeaderHandlers } from "./columns-ui";
import { GroupSummaryRow } from "./summary";
import { COMPUTED_KINDS, readValues, type BoardColumn, type CellValue } from "@/lib/columns";
import { formulaValue, itemCode, type RowEnv } from "@/lib/row-values";
import type { PriorityLabel } from "@/lib/board-settings";
import { displayName } from "@/lib/format";
import type { ColumnKind } from "@/lib/columns";
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
  onAddColumn: (kind: ColumnKind) => void;
};

/** Cómo se editan las etiquetas desde las celdas. */
export type LabelEditors = {
  status?: LabelEditing;
  priority?: LabelEditing;
  column: (c: BoardColumn) => LabelEditing | undefined;
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
  priorities: PriorityLabel[];
  members: Member[];
  defs: ColumnDef[];
  titleLabel: string;
  env: RowEnv;
  doneIds: Set<string>;
  today: string;
  readOnly: boolean;
  canManage: boolean;
  handlers: GroupHandlers;
  headerHandlers: HeaderHandlers;
  labelEditors: LabelEditors;
  sort: { key: string; dir: "asc" | "desc" } | null;
  selected: Set<string>;
  onSelect: (ids: string[], on: boolean) => void;
  /** Tarea que se está arrastrando (compartida entre grupos). */
  dragRef: React.RefObject<string | null>;
};

export function GroupSection(props: Props) {
  const { group, allTasks, visibleTasks, filtered, readOnly, handlers, doneIds, dragRef, defs, selected } = props;
  const [collapsed, setCollapsed] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const color = asColor(group.color);
  const bodyId = `grupo-${group.id}`;
  const doneCount = allTasks.filter((t) => t.status_id && doneIds.has(t.status_id)).length;
  const dnd = !readOnly && props.manual;
  const visibleIds = visibleTasks.filter((t) => !t.id.startsWith("tmp-")).map((t) => t.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someSelected = visibleIds.some((id) => selected.has(id));

  const groupMenu: MenuItem[] = [
    { label: "Renombrar", icon: <IconEdit size={16} />, onSelect: () => setRenaming(true) },
    { label: "Seleccionar todos", icon: <IconCopy size={16} />, onSelect: () => props.onSelect(visibleIds, true) },
    { label: "Subir carpeta", icon: <IconArrowUp size={16} />, onSelect: () => handlers.onMoveGroup(group, "up"), disabled: props.isFirst },
    { label: "Bajar carpeta", icon: <IconArrowDown size={16} />, onSelect: () => handlers.onMoveGroup(group, "down"), disabled: props.isLast },
    { type: "label", label: "Color" },
    ...COLOR_NAMES.map<MenuItem>((c) => ({
      label: `${COLOR_LABELS[c]}${c === color ? " (actual)" : ""}`,
      icon: <span className={cn(`solid-${c}`, "block h-3 w-3 rounded-full")} />,
      onSelect: () => handlers.onRecolorGroup(group, c),
    })),
    { type: "separator" },
    { label: "Eliminar carpeta", icon: <IconTrash size={16} />, danger: true, onSelect: () => handlers.onDeleteGroup(group), disabled: props.groups.length <= 1 },
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
    handlers.onMoveTaskById(id, group.id, indexInGroup(beforeTask));
  };

  const tableWidth = 36 + 32 + 340 + defs.reduce((n, d) => n + d.width, 0) + 48;

  return (
    <section aria-labelledby={`${bodyId}-title`} className={cn(`solid-${color}`, "rounded-2xl border border-line bg-surface text-fg shadow-card")} style={{ backgroundColor: "var(--surface)", color: "var(--fg)" }}>
      <header className="flex items-center gap-2 rounded-t-2xl border-b border-line py-2 pl-2 pr-3" style={{ boxShadow: "inset 4px 0 0 var(--dot)" }}>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          aria-label={collapsed ? `Expandir carpeta ${group.name}` : `Contraer carpeta ${group.name}`}
          className="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-surface-2"
          style={{ color: "var(--dot)" }}
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
          <h2 id={`${bodyId}-title`} className="min-w-0 flex-1 truncate text-[15px] font-bold" style={{ color: "var(--dot)" }} onDoubleClick={() => !readOnly && setRenaming(true)}>
            {group.name}
          </h2>
        )}
        <span className="shrink-0 text-xs text-muted">
          {filtered ? `${visibleTasks.length} de ${allTasks.length}` : allTasks.length} {allTasks.length === 1 ? "elemento" : "elementos"}
          {allTasks.length > 0 && <span className="hidden sm:inline"> · {doneCount} terminados</span>}
        </span>
        {!readOnly && <Menu label={`Acciones de la carpeta ${group.name}`} trigger={<IconDots />} items={groupMenu} />}
      </header>

      {!collapsed && (
        <div id={bodyId}>
          {/* Escritorio y tablet: tabla con desplazamiento horizontal */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full table-fixed border-collapse text-sm" style={{ minWidth: tableWidth }}>
              <caption className="sr-only">Elementos de la carpeta {group.name}</caption>
              <colgroup>
                <col style={{ width: 36 }} />
                <col style={{ width: 32 }} />
                <col style={{ minWidth: 260 }} />
                {defs.map((d) => (
                  <col key={d.key} style={{ width: d.width }} />
                ))}
                <col style={{ width: 48 }} />
              </colgroup>
              <thead>
                <tr className="text-xs font-semibold text-muted">
                  <th scope="col" className="px-1 py-2 text-center">
                    {!readOnly && (
                      <input
                        type="checkbox"
                        aria-label={`Seleccionar todos los elementos de ${group.name}`}
                        checked={allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = !allSelected && someSelected;
                        }}
                        onChange={(e) => props.onSelect(visibleIds, e.target.checked)}
                        className="h-4 w-4 cursor-pointer accent-[var(--accent)]"
                      />
                    )}
                  </th>
                  <th scope="col" className="px-1 py-2">
                    <span className="sr-only">Mover</span>
                  </th>
                  <th scope="col" className="px-2 py-2 text-left">
                    {props.titleLabel}
                  </th>
                  {defs.map((d, i) => (
                    <th key={d.key} scope="col" className="border-l border-line/60 px-1 py-1.5">
                      <ColumnHeader
                        def={d}
                        first={i === 0}
                        last={i === defs.length - 1}
                        canManage={props.canManage && !readOnly}
                        sorted={props.sort?.key === d.key ? props.sort.dir : null}
                        handlers={props.headerHandlers}
                      />
                    </th>
                  ))}
                  <th scope="col" className="border-l border-line/60 px-1 py-1.5 text-center">
                    {props.canManage && !readOnly ? <AddColumnButton compact onAdd={handlers.onAddColumn} /> : <span className="sr-only">Acciones</span>}
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
                    <td colSpan={4 + defs.length} className={cn("px-4 py-5 text-center text-sm text-muted", dropIndex !== null && "bg-accent-soft")}>
                      {filtered ? "Ningún elemento de esta carpeta coincide con los filtros." : "Esta carpeta está vacía. Agregá el primer elemento abajo."}
                    </td>
                  </tr>
                )}
              </tbody>
              {!readOnly && (
                <tbody>
                  <tr className="border-t border-line">
                    <td />
                    <td />
                    <td colSpan={2 + defs.length} className="p-0">
                      <AddTaskRow groupName={group.name} onCreate={(title) => handlers.onCreateTask(group.id, title)} />
                    </td>
                  </tr>
                </tbody>
              )}
              {allTasks.length > 0 && (
                <tfoot>
                  <GroupSummaryRow defs={defs} tasks={visibleTasks} env={props.env} statuses={props.statuses} priorities={props.priorities} members={props.members} />
                </tfoot>
              )}
            </table>
          </div>

          {/* Celular: tarjetas */}
          <ul className="divide-y divide-line md:hidden">
            {visibleTasks.map((task) => (
              <TaskCard key={task.id} task={task} {...props} />
            ))}
            {visibleTasks.length === 0 && (
              <li className="px-4 py-5 text-center text-sm text-muted">{filtered ? "Ningún elemento coincide con los filtros." : "Esta carpeta está vacía."}</li>
            )}
          </ul>
          {!readOnly && (
            <div className="border-t border-line md:hidden">
              <AddTaskRow groupName={group.name} onCreate={(title) => handlers.onCreateTask(group.id, title)} />
            </div>
          )}
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
    { label: "Subir", icon: <IconArrowUp size={16} />, disabled: !manual || posInGroup <= 0, onSelect: () => handlers.onMoveTask(task, group.id, posInGroup - 1) },
    { label: "Bajar", icon: <IconArrowDown size={16} />, disabled: !manual || posInGroup >= allTasks.length - 1, onSelect: () => handlers.onMoveTask(task, group.id, posInGroup + 1) },
    ...(groups.length > 1
      ? [
          { type: "label", label: "Mover a" } as MenuItem,
          ...groups
            .filter((g) => g.id !== group.id)
            .map<MenuItem>((g) => ({ label: g.name, icon: <IconMove size={16} />, onSelect: () => handlers.onMoveTask(task, g.id, Number.MAX_SAFE_INTEGER) })),
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
      aria-label="Nombre del elemento"
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
      className={cn("h-8 w-full min-w-0 truncate rounded-lg border border-transparent bg-transparent px-2 font-medium hover:border-line focus:bg-surface disabled:opacity-60", className)}
    />
  );
}

/** Celda de una columna (fija o propia) para un elemento. */
export function Cell({ def, task, props, disabled, variant = "cell" }: { def: ColumnDef; task: Task; props: Pick<Props, "statuses" | "priorities" | "members" | "today" | "doneIds" | "handlers" | "labelEditors" | "env">; disabled: boolean; variant?: "cell" | "field" }) {
  const { statuses, members, handlers, labelEditors } = props;
  const name = `${def.label} de ${task.title}`;
  if (def.builtin === "assignee")
    return <AssigneeSelect value={task.assignee_id} members={members} disabled={disabled} label={name} onChange={(assignee_id) => handlers.onUpdateTask(task, { assignee_id })} />;
  if (def.builtin === "status")
    return (
      <LabelCell
        labels={statuses.map((s) => ({ id: s.id, label: s.label, color: asColor(s.color), done: s.is_done }))}
        value={task.status_id}
        onChange={(v) => handlers.onUpdateTask(task, { status_id: typeof v === "string" ? v : null })}
        label={name}
        disabled={disabled}
        editing={labelEditors.status}
        variant={variant}
      />
    );
  if (def.builtin === "priority")
    return (
      <LabelCell
        labels={props.priorities.map((p) => ({ id: p.value, label: p.label, color: p.color }))}
        value={task.priority}
        onChange={(v) => typeof v === "string" && handlers.onUpdateTask(task, { priority: v as Priority })}
        label={name}
        disabled={disabled}
        editing={labelEditors.priority}
        allowEmpty={false}
        variant={variant}
      />
    );
  if (def.builtin === "due") {
    const done = Boolean(task.status_id && props.doneIds.has(task.status_id));
    return <DueDateInput value={task.due_date} today={props.today} done={done} disabled={disabled} label={name} onChange={(due_date) => handlers.onUpdateTask(task, { due_date })} />;
  }
  const c = def.column!;
  if (COMPUTED_KINDS.includes(c.kind)) {
    const creator = members.find((m) => m.user_id === task.created_by);
    return (
      <ComputedCell
        column={c}
        result={c.kind === "formula" ? formulaValue(task, c, props.env) : undefined}
        createdAt={task.created_at}
        updatedAt={task.updated_at}
        creator={creator ? displayName(creator) : undefined}
        code={itemCode(task.id)}
        variant={variant}
      />
    );
  }
  return (
    <CustomValueInput
      column={c}
      value={readValues(task.custom_values)[c.id]}
      members={members}
      disabled={disabled}
      label={name}
      variant={variant}
      labelEditing={labelEditors.column(c)}
      onChange={(v) => handlers.onSetValue(task, c.id, v)}
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
  const { doneIds, readOnly, handlers, dragRef, defs, selected } = props;
  const pending = task.id.startsWith("tmp-");
  const disabled = readOnly || pending;
  const done = Boolean(task.status_id && doneIds.has(task.status_id));
  const isSelected = selected.has(task.id);

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
        isSelected && "bg-accent-soft/60 hover:bg-accent-soft/80",
        showDropLine && "shadow-[inset_0_2px_0_var(--accent)]",
      )}
    >
      <td className="px-1 text-center align-middle" style={{ boxShadow: "inset 4px 0 0 var(--dot)" }}>
        {!readOnly && !pending && (
          <input
            type="checkbox"
            checked={isSelected}
            aria-label={`Seleccionar ${task.title}`}
            onChange={(e) => props.onSelect([task.id], e.target.checked)}
            className="h-4 w-4 cursor-pointer accent-[var(--accent)]"
          />
        )}
      </td>
      <td className="px-0.5 text-center align-middle">
        {dnd && !pending && (
          <span className="inline-flex cursor-grab text-subtle opacity-0 group-hover/row:opacity-100" aria-hidden title="Arrastrar para mover">
            <IconGrip size={16} />
          </span>
        )}
      </td>
      <td className="px-1.5 py-1">
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
      {defs.map((d) => (
        <td key={d.key} className="border-l border-line/60 px-1 py-1">
          <Cell def={d} task={task} props={props} disabled={disabled} />
        </td>
      ))}
      <td className="border-l border-line/60 px-1 text-center">
        {!disabled && <Menu label={`Acciones de ${task.title}`} trigger={<IconDots />} items={taskMenu(task, props)} />}
      </td>
    </tr>
  );
}

function TaskCard({ task, ...props }: Props & { task: Task }) {
  const { today, doneIds, readOnly, handlers, members, defs } = props;
  const pending = task.id.startsWith("tmp-");
  const disabled = readOnly || pending;
  const done = Boolean(task.status_id && doneIds.has(task.status_id));
  const assignee = members.find((m) => m.user_id === task.assignee_id);
  const quick = defs.filter((d) => d.builtin === "status" || d.builtin === "priority" || d.column?.kind === "list").slice(0, 4);

  return (
    <li className={cn("px-3 py-3", pending && "opacity-60")}>
      <div className="flex items-start gap-2">
        {!readOnly && !pending && (
          <input
            type="checkbox"
            checked={props.selected.has(task.id)}
            aria-label={`Seleccionar ${task.title}`}
            onChange={(e) => props.onSelect([task.id], e.target.checked)}
            className="mt-1 h-4 w-4 accent-[var(--accent)]"
          />
        )}
        <button type="button" onClick={() => handlers.onOpenTask(task)} disabled={pending} className={cn("min-w-0 flex-1 text-left font-semibold leading-snug", done && "text-muted line-through decoration-1")}>
          {task.title}
        </button>
        {!disabled && <Menu label={`Acciones de ${task.title}`} trigger={<IconDots />} items={taskMenu(task, props)} />}
      </div>
      {quick.length > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {quick.map((d) => (
            <Cell key={d.key} def={d} task={task} props={props} disabled={disabled} />
          ))}
        </div>
      )}
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
      className="flex items-center gap-2 px-3 py-1.5"
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
        placeholder="+ Agregar elemento"
        aria-label={`Nuevo elemento en ${groupName}`}
        className="h-8 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 text-sm placeholder:text-subtle hover:border-line focus:bg-surface"
      />
      {value.trim() && (
        <button type="submit" className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg">
          Agregar
        </button>
      )}
    </form>
  );
}
