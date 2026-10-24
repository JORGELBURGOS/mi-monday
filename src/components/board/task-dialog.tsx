"use client";

import { useEffect, useId, useMemo, useState, useTransition } from "react";
import {
  addCommentAction,
  deleteCommentAction,
  listCommentsAction,
  moveTaskAction,
  updateTaskAction,
  type CommentView,
} from "@/app/actions/tasks";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, FormAlert, Input, Select, Textarea } from "@/components/ui/form";
import { Avatar } from "@/components/ui/misc";
import { IconCopy, IconTrash } from "@/components/ui/icons";
import { asColor, type Priority } from "@/lib/constants";
import { displayName, formatDateTime, relativeTime } from "@/lib/format";
import { taskTitleSchema } from "@/lib/validation";
import { setCustomValuesAction } from "@/app/actions/columns";
import { COMPUTED_KINDS, checklistProgress, isChecklist, readValues, stringList, type BoardColumn, type CellValue, type CheckItem } from "@/lib/columns";
import { builtinLabel, type PriorityLabel } from "@/lib/board-settings";
import { formulaValue, itemCode, type RowEnv } from "@/lib/row-values";
import { LabelCell } from "./label-picker";
import type { LabelEditors } from "./group-section";
import { cn } from "@/lib/cn";
import { ComputedCell, CustomValueInput } from "./custom-cell";
import { MirrorCell } from "./rich-cells";
import { TaskTrace } from "./task-trace";
import { TaskHistory } from "./task-history";
import { ChecklistEditor } from "./checklist-editor";
import { useCellContext } from "./cell-context";
import type { Group, Member, Status, Task } from "./types";

export function TaskDialog({
  task,
  statuses,
  priorities,
  groups,
  members,
  columns,
  env,
  labelEditors,
  readOnly,
  subitems,
  parent,
  onCreateSubitem,
  onClose,
  onOpenTask,
  onSaved,
  onDelete,
  onDuplicate,
  endPosition,
}: {
  task: Task;
  statuses: Status[];
  priorities: PriorityLabel[];
  groups: Group[];
  members: Member[];
  columns: BoardColumn[];
  env: RowEnv;
  labelEditors: LabelEditors;
  today: string;
  readOnly: boolean;
  subitems: Task[];
  parent: Task | null;
  onCreateSubitem: (title: string) => void;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
  onSaved: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  /** Posición para ubicar la tarea al final de una carpeta. */
  endPosition: (groupId: string) => number;
}) {
  const uid = useId();
  // Solo se guardan los campos que la persona tocó: si mientras tanto una regla
  // cambió el estado (por ejemplo, al tildar un paso del checklist), no se pisa.
  type Edits = Partial<{ title: string; description: string; status_id: string; priority: Priority; assignee_id: string; due_date: string; group_id: string }>;
  const [edits, setEdits] = useState<Edits>({});
  const edit = <K extends keyof Edits>(key: K) => (v: NonNullable<Edits[K]>) => setEdits((e) => ({ ...e, [key]: v }));
  const title = edits.title ?? task.title;
  const description = edits.description ?? task.description ?? "";
  const statusId = edits.status_id ?? task.status_id ?? "";
  const priority = edits.priority ?? task.priority;
  const assigneeId = edits.assignee_id ?? task.assignee_id ?? "";
  const dueDate = edits.due_date ?? task.due_date ?? "";
  const groupId = edits.group_id ?? task.group_id;
  const setTitle = edit("title");
  const setDescription = edit("description");
  const setStatusId = edit("status_id");
  const setPriority = edit("priority");
  const setAssigneeId = edit("assignee_id");
  const setDueDate = edit("due_date");
  const setGroupId = edit("group_id");
  const initialValues = readValues(task.custom_values);
  const [values, setValues] = useState<Record<string, CellValue | null>>(initialValues);
  const [tab, setTab] = useState<string>("comments");
  const ctx = useCellContext();
  const checklistCols = columns.filter((c) => c.kind === "checklist");
  const historyLookup = useMemo(() => ({ columns, members }), [columns, members]);
  const [commentCount, setCommentCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const dirty =
    title.trim() !== task.title ||
    (description.trim() || null) !== (task.description?.trim() || null) ||
    (statusId || null) !== task.status_id ||
    priority !== task.priority ||
    (assigneeId || null) !== task.assignee_id ||
    (dueDate || null) !== task.due_date ||
    groupId !== task.group_id ||
    changedValues().length > 0;

  function changedValues() {
    return columns
      .filter((c) => !COMPUTED_KINDS.includes(c.kind) && c.kind !== "checklist")
      .filter((c) => JSON.stringify(values[c.id] ?? null) !== JSON.stringify(initialValues[c.id] ?? null))
      .map((c) => c.id);
  }

  const save = () => {
    const parsedTitle = taskTitleSchema.safeParse(title);
    if (!parsedTitle.success) {
      setTitleError(parsedTitle.error.issues[0]?.message ?? "Título inválido.");
      return;
    }
    setTitleError(null);
    setError(null);
    startSaving(async () => {
      const patch: Parameters<typeof updateTaskAction>[1] = {};
      if (edits.title !== undefined && parsedTitle.data !== task.title) patch.title = parsedTitle.data;
      if (edits.description !== undefined && (description.trim() || null) !== (task.description?.trim() || null)) patch.description = description.trim() ? description : null;
      if (edits.status_id !== undefined && (statusId || null) !== task.status_id) patch.status_id = statusId || null;
      if (edits.priority !== undefined && priority !== task.priority) patch.priority = priority;
      if (edits.assignee_id !== undefined && (assigneeId || null) !== task.assignee_id) patch.assignee_id = assigneeId || null;
      if (edits.due_date !== undefined && (dueDate || null) !== task.due_date) patch.due_date = dueDate || null;
      if (Object.keys(patch).length > 0) {
        const res = await updateTaskAction(task.id, patch);
        if (!res.ok) {
          setError(res.error);
          return;
        }
      }
      const changed = changedValues();
      if (changed.length > 0) {
        const saved = await setCustomValuesAction(task.id, Object.fromEntries(changed.map((id) => [id, values[id] ?? null])));
        if (!saved.ok) {
          setError(saved.error);
          return;
        }
      }
      if (groupId !== task.group_id) {
        // Se agrega al final del grupo destino.
        const moved = await moveTaskAction({ taskId: task.id, groupId, position: endPosition(groupId) });
        if (!moved.ok) {
          setError(moved.error);
          return;
        }
      }
      onSaved();
      onClose();
    });
  };

  return (
    <Dialog open onClose={onClose} title={readOnly ? task.title : parent ? "Detalle del subelemento" : "Detalle del elemento"} size="xl">
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-4">
          {error && <FormAlert>{error}</FormAlert>}
          {parent && (
            <p className="text-sm text-muted">
              Subelemento de{" "}
              <button type="button" onClick={() => onOpenTask(parent.id)} className="font-semibold text-accent hover:underline">
                {parent.title}
              </button>
            </p>
          )}
          <Field id={`${uid}-title`} label={builtinLabel(env.settings, "title")} error={titleError ?? undefined}>
            <Input
              id={`${uid}-title`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={500}
              disabled={readOnly}
              aria-invalid={titleError ? true : undefined}
              aria-describedby={titleError ? `${uid}-title-error` : undefined}
            />
          </Field>
          <Field id={`${uid}-desc`} label="Descripción" hint="Opcional">
            <Textarea
              id={`${uid}-desc`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={10000}
              disabled={readOnly}
              className="min-h-32"
              placeholder="Detalles, criterios, enlaces…"
            />
          </Field>
          {!parent && (
            <Subitems
              items={subitems}
              statuses={statuses}
              readOnly={readOnly || task.id.startsWith("tmp-")}
              onOpen={onOpenTask}
              onCreate={onCreateSubitem}
            />
          )}
          <div className="border-t border-line pt-4">
            <div role="tablist" aria-label="Actividad del ítem" className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-surface-2 p-0.5">
              {(
                [
                  ["comments", `Actualizaciones${commentCount ? ` (${commentCount})` : ""}`],
                  ...checklistCols.map((c) => {
                    const p = checklistProgress(values[c.id] ?? undefined);
                    return [`ck:${c.id}`, `${c.name}${p.total ? ` ${p.done}/${p.total}` : ""}`] as [string, string];
                  }),
                  ["history", "Historial"],
                  ["trace", "Recorrido"],
                ] as [string, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  id={`${uid}-tab-${key}`}
                  aria-selected={tab === key}
                  aria-controls={`${uid}-panel`}
                  onClick={() => setTab(key)}
                  className={cn(
                    "h-8 min-w-24 flex-1 whitespace-nowrap rounded-md px-3 text-[13px] font-semibold",
                    tab === key ? "bg-surface text-fg shadow-card" : "text-muted hover:text-fg",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${tab}`}>
              {tab === "comments" ? (
                <Comments taskId={task.id} disabled={task.id.startsWith("tmp-")} onCount={setCommentCount} />
              ) : tab.startsWith("ck:") ? (
                (() => {
                  const col = checklistCols.find((c) => `ck:${c.id}` === tab);
                  if (!col) return null;
                  const items: CheckItem[] = isChecklist(values[col.id] ?? undefined) ? (values[col.id] as CheckItem[]) : [];
                  return (
                    <ChecklistEditor
                      key={col.id}
                      items={items}
                      members={members}
                      templates={ctx?.templates ?? []}
                      workspaceId={ctx?.workspaceId}
                      disabled={readOnly || task.id.startsWith("tmp-")}
                      onChange={(next) => {
                        setValues((prev) => ({ ...prev, [col.id]: next.length ? next : null }));
                        // El checklist se guarda en el momento, como en Monday.
                        void setCustomValuesAction(task.id, { [col.id]: next.length ? next : null }).then((r) => {
                          if (!r.ok) setError(r.error);
                        });
                      }}
                    />
                  );
                })()
              ) : task.id.startsWith("tmp-") ? (
                <p className="text-sm text-muted">Guardando el ítem…</p>
              ) : tab === "history" ? (
                <TaskHistory taskId={task.id} lookup={historyLookup} reloadKey={`${task.updated_at}|${commentCount}`} />
              ) : (
                <TaskTrace taskId={task.id} boardId={task.board_id} onOpenTask={onOpenTask} />
              )}
            </div>
          </div>
        </div>

        <aside className="space-y-3 md:border-l md:border-line md:pl-6">
          <Field id={`${uid}-status`} label={builtinLabel(env.settings, "status")}>
            <LabelCell
              variant="field"
              labels={statuses.map((st) => ({ id: st.id, label: st.label, color: asColor(st.color), done: st.is_done }))}
              value={statusId || null}
              onChange={(v) => setStatusId(typeof v === "string" ? v : "")}
              label={builtinLabel(env.settings, "status")}
              disabled={readOnly}
              editing={labelEditors.status}
              emptyText="Sin estado"
            />
          </Field>
          <Field id={`${uid}-prio`} label={builtinLabel(env.settings, "priority")}>
            <LabelCell
              variant="field"
              labels={priorities.map((p) => ({ id: p.value, label: p.label, color: p.color }))}
              value={priority}
              onChange={(v) => typeof v === "string" && setPriority(v as Priority)}
              label={builtinLabel(env.settings, "priority")}
              disabled={readOnly}
              editing={labelEditors.priority}
              allowEmpty={false}
            />
          </Field>
          <Field id={`${uid}-assignee`} label={builtinLabel(env.settings, "assignee")}>
            <Select id={`${uid}-assignee`} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} disabled={readOnly}>
              <option value="">Sin responsable</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {displayName(m)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={`${uid}-due`} label={builtinLabel(env.settings, "due")}>
            <Input id={`${uid}-due`} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={readOnly} />
          </Field>
          <Field id={`${uid}-group`} label="Carpeta" hint={parent ? "La de su elemento" : undefined}>
            <Select id={`${uid}-group`} value={groupId} onChange={(e) => setGroupId(e.target.value)} disabled={readOnly || Boolean(parent)}>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
          {columns.filter((c) => c.kind !== "checklist").map((c) =>
            c.kind === "mirror" ? (
              <div key={c.id}>
                <p className="mb-1.5 text-sm font-semibold">{c.name}</p>
                <MirrorCell column={c} task={task} columns={columns} members={members} cell={false} />
              </div>
            ) : COMPUTED_KINDS.includes(c.kind) ? (
              <div key={c.id}>
                <p className="mb-1.5 text-sm font-semibold">{c.name}</p>
                <ComputedCell
                  column={c}
                  variant="field"
                  result={c.kind === "formula" ? formulaValue(task, c, env) : undefined}
                  createdAt={task.created_at}
                  updatedAt={task.updated_at}
                  creator={(() => {
                    const m = members.find((x) => x.user_id === task.created_by);
                    return m ? displayName(m) : undefined;
                  })()}
                  code={itemCode(task.id)}
                />
              </div>
            ) : (
              <Field key={c.id} id={`${uid}-col-${c.id}`} label={c.name}>
                <CustomValueInput
                  id={`${uid}-col-${c.id}`}
                  variant="field"
                  column={c}
                  value={values[c.id] ?? undefined}
                  members={members}
                  disabled={readOnly}
                  label={c.name}
                  labelEditing={labelEditors.column(c)}
                  taskId={task.id}
                  onChange={(v) => {
                    setValues((prev) => ({ ...prev, [c.id]: v }));
                    // Los archivos ya están subidos: se guardan en el momento para no perderlos.
                    if (c.kind === "files") void setCustomValuesAction(task.id, { [c.id]: v });
                  }}
                />
              </Field>
            ),
          )}
          {columns
            .filter((c) => c.kind === "dependency")
            .map((c) => {
              const blocks = (ctx?.tasks ?? []).filter((t) => stringList(readValues(t.custom_values)[c.id]).includes(task.id));
              if (!blocks.length) return null;
              return (
                <div key={`blocks-${c.id}`}>
                  <p className="mb-1.5 text-sm font-semibold">Bloquea a</p>
                  <p className="mb-1.5 text-xs text-muted">Elementos que dependen de este ({c.name}).</p>
                  <ul className="space-y-1">
                    {blocks.map((t) => (
                      <li key={t.id}>
                        <button type="button" onClick={() => onOpenTask(t.id)} className="w-full truncate rounded-md bg-surface-2 px-2 py-1 text-left text-xs hover:underline" title={t.title}>
                          {t.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          <dl className="space-y-1 border-t border-line pt-3 text-xs text-muted">
            <div>
              <dt className="inline">Creada: </dt>
              <dd className="inline">{formatDateTime(task.created_at)}</dd>
            </div>
            <div>
              <dt className="inline">Última modificación: </dt>
              <dd className="inline">{formatDateTime(task.updated_at)}</dd>
            </div>
          </dl>
          {!readOnly && (
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              <Button size="sm" onClick={onDuplicate}>
                <IconCopy size={14} /> Duplicar
              </Button>
              <Button size="sm" variant="outline-danger" onClick={onDelete}>
                <IconTrash size={14} /> Eliminar
              </Button>
            </div>
          )}
        </aside>
      </div>

      {!readOnly && (
        <div className="sticky bottom-0 -mx-5 -mb-4 mt-6 flex flex-col-reverse gap-2 border-t border-line bg-surface px-5 py-3 sm:flex-row sm:justify-end">
          <Button onClick={onClose} disabled={saving}>
            {dirty ? "Descartar" : "Cerrar"}
          </Button>
          <Button variant="primary" onClick={save} disabled={!dirty || saving}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </Button>
        </div>
      )}
    </Dialog>
  );
}

function Comments({ taskId, disabled, onCount }: { taskId: string; disabled: boolean; onCount?: (n: number) => void }) {
  const [comments, setComments] = useState<CommentView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  const uid = useId();

  const load = async () => {
    const res = await listCommentsAction(taskId);
    if (res.ok) {
      setComments(res.data);
      onCount?.(res.data.length);
      setLoadError(null);
    } else setLoadError(res.error);
  };

  useEffect(() => {
    if (disabled) return;
    let cancelled = false;
    listCommentsAction(taskId).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setComments(res.data);
        onCount?.(res.data.length);
      } else setLoadError(res.error);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, disabled]);

  return (
    <section aria-labelledby={`${uid}-ct`}>
      <h3 id={`${uid}-ct`} className="sr-only">
        Comentarios {comments && comments.length > 0 && <span className="font-normal text-muted">({comments.length})</span>}
      </h3>
      {loadError && (
        <FormAlert>
          {loadError}{" "}
          <button type="button" className="font-semibold underline" onClick={() => startBusy(load)}>
            Reintentar
          </button>
        </FormAlert>
      )}
      {!comments && !loadError && !disabled && <p className="text-sm text-muted">Cargando actualizaciones…</p>}
      {comments && comments.length === 0 && <p className="text-sm text-muted">Todavía no hay actualizaciones.</p>}
      {comments && comments.length > 0 && (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              <Avatar name={c.author_name} size="sm" className="mt-0.5" />
              <div className="min-w-0 flex-1 rounded-xl bg-surface-2 px-3 py-2">
                <div className="flex items-baseline gap-2 text-xs">
                  <span className="font-semibold text-fg">{c.author_name}</span>
                  <time dateTime={c.created_at} className="text-muted" title={formatDateTime(c.created_at)}>
                    {relativeTime(c.created_at)}
                  </time>
                  {c.is_mine && (
                    <button
                      type="button"
                      className="ml-auto text-muted hover:text-danger"
                      disabled={busy}
                      onClick={() =>
                        startBusy(async () => {
                          const res = await deleteCommentAction(c.id);
                          if (!res.ok) setError(res.error);
                          else await load();
                        })
                      }
                    >
                      Eliminar<span className="sr-only"> comentario</span>
                    </button>
                  )}
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">{c.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!body.trim()) return;
            startBusy(async () => {
              const res = await addCommentAction(taskId, body);
              if (!res.ok) {
                setError(res.error);
                return;
              }
              setBody("");
              setError(null);
              await load();
            });
          }}
        >
          <label htmlFor={`${uid}-new`} className="sr-only">
            Escribir un comentario
          </label>
          <Textarea
            id={`${uid}-new`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Escribí una actualización…"
            maxLength={5000}
            className="min-h-16"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
            }}
          />
          {error && <FormAlert>{error}</FormAlert>}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={busy || !body.trim()}>
              {busy ? "Publicando…" : "Comentar"}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function Subitems({
  items,
  statuses,
  readOnly,
  onOpen,
  onCreate,
}: {
  items: Task[];
  statuses: Status[];
  readOnly: boolean;
  onOpen: (id: string) => void;
  onCreate: (title: string) => void;
}) {
  const [title, setTitle] = useState("");
  const uid = useId();
  const done = items.filter((t) => statuses.find((s) => s.id === t.status_id)?.is_done).length;
  return (
    <section aria-labelledby={`${uid}-h`} className="rounded-xl border border-line">
      <h3 id={`${uid}-h`} className="flex items-center justify-between border-b border-line px-3 py-2 text-sm font-bold">
        Subelementos
        {items.length > 0 && (
          <span className="text-xs font-semibold text-muted">
            {done} de {items.length} terminados
          </span>
        )}
      </h3>
      {items.length > 0 && (
        <ul className="divide-y divide-line">
          {items.map((t) => {
            const st = statuses.find((s) => s.id === t.status_id);
            return (
              <li key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <button type="button" onClick={() => onOpen(t.id)} disabled={t.id.startsWith("tmp-")} className={cn("min-w-0 flex-1 truncate text-left hover:underline", st?.is_done && "text-muted line-through")}>
                  {t.title}
                </button>
                {st && <span className={cn(`solid-${asColor(st.color)}`, "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold")}>{st.label}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {!readOnly && (
        <form
          className="flex gap-2 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            onCreate(title.trim());
            setTitle("");
          }}
        >
          <label htmlFor={`${uid}-new`} className="sr-only">
            Nuevo subelemento
          </label>
          <Input id={`${uid}-new`} value={title} maxLength={500} onChange={(e) => setTitle(e.target.value)} placeholder="Agregar un subelemento y presionar Enter" className="h-9" />
          <Button type="submit" size="sm" className="h-9" disabled={!title.trim()}>
            Agregar
          </Button>
        </form>
      )}
      {readOnly && items.length === 0 && <p className="px-3 py-2 text-sm text-muted">Sin subelementos.</p>}
    </section>
  );
}
