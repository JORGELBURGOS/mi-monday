"use client";

import { useEffect, useId, useState, useTransition } from "react";
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
import { PRIORITIES, type Priority } from "@/lib/constants";
import { displayName, formatDateTime, relativeTime } from "@/lib/format";
import { taskTitleSchema } from "@/lib/validation";
import type { Group, Member, Status, Task } from "./types";

export function TaskDialog({
  task,
  statuses,
  groups,
  members,
  readOnly,
  onClose,
  onSaved,
  onDelete,
  onDuplicate,
  endPosition,
}: {
  task: Task;
  statuses: Status[];
  groups: Group[];
  members: Member[];
  today: string;
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  /** Posición para ubicar la tarea al final de un grupo. */
  endPosition: (groupId: string) => number;
}) {
  const uid = useId();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [statusId, setStatusId] = useState(task.status_id ?? "");
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [assigneeId, setAssigneeId] = useState(task.assignee_id ?? "");
  const [dueDate, setDueDate] = useState(task.due_date ?? "");
  const [groupId, setGroupId] = useState(task.group_id);
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
    groupId !== task.group_id;

  const save = () => {
    const parsedTitle = taskTitleSchema.safeParse(title);
    if (!parsedTitle.success) {
      setTitleError(parsedTitle.error.issues[0]?.message ?? "Título inválido.");
      return;
    }
    setTitleError(null);
    setError(null);
    startSaving(async () => {
      const res = await updateTaskAction(task.id, {
        title: parsedTitle.data,
        description: description.trim() ? description : null,
        status_id: statusId || null,
        priority,
        assignee_id: assigneeId || null,
        due_date: dueDate || null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
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
    <Dialog open onClose={onClose} title={readOnly ? task.title : "Detalle de la tarea"} size="lg">
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="space-y-4">
          {error && <FormAlert>{error}</FormAlert>}
          <Field id={`${uid}-title`} label="Título" error={titleError ?? undefined}>
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
          <Comments taskId={task.id} disabled={task.id.startsWith("tmp-")} />
        </div>

        <aside className="space-y-3 md:border-l md:border-line md:pl-6">
          <Field id={`${uid}-status`} label="Estado">
            <Select id={`${uid}-status`} value={statusId} onChange={(e) => setStatusId(e.target.value)} disabled={readOnly}>
              <option value="">Sin estado</option>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={`${uid}-prio`} label="Prioridad">
            <Select id={`${uid}-prio`} value={priority} onChange={(e) => setPriority(e.target.value as Priority)} disabled={readOnly}>
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={`${uid}-assignee`} label="Responsable">
            <Select id={`${uid}-assignee`} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} disabled={readOnly}>
              <option value="">Sin responsable</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {displayName(m)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={`${uid}-due`} label="Vencimiento">
            <Input id={`${uid}-due`} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={readOnly} />
          </Field>
          <Field id={`${uid}-group`} label="Grupo">
            <Select id={`${uid}-group`} value={groupId} onChange={(e) => setGroupId(e.target.value)} disabled={readOnly}>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
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

function Comments({ taskId, disabled }: { taskId: string; disabled: boolean }) {
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
      setLoadError(null);
    } else setLoadError(res.error);
  };

  useEffect(() => {
    if (disabled) return;
    let cancelled = false;
    listCommentsAction(taskId).then((res) => {
      if (cancelled) return;
      if (res.ok) setComments(res.data);
      else setLoadError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [taskId, disabled]);

  return (
    <section aria-labelledby={`${uid}-ct`} className="border-t border-line pt-4">
      <h3 id={`${uid}-ct`} className="mb-3 text-sm font-bold">
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
      {!comments && !loadError && !disabled && <p className="text-sm text-muted">Cargando comentarios…</p>}
      {comments && comments.length === 0 && <p className="text-sm text-muted">Todavía no hay comentarios.</p>}
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
            placeholder="Escribí un comentario…"
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
