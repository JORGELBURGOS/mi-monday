"use client";

import { useState, useTransition } from "react";
import {
  createStatusAction,
  deleteStatusAction,
  moveStatusAction,
  updateStatusAction,
} from "@/app/actions/boards";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Chip } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from "@/components/ui/icons";
import { COLOR_LABELS, COLOR_NAMES, asColor, type ColorName } from "@/lib/constants";
import type { Status } from "@/lib/data";

type Draft = { label: string; color: ColorName; isDone: boolean };

export function StatusManager({ boardId, statuses, usage }: { boardId: string; statuses: Status[]; usage: Record<string, number> }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [deleting, setDeleting] = useState<Status | null>(null);
  const [draft, setDraft] = useState<Draft>({ label: "", color: "violet", isDone: false });

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error ?? "No se pudo guardar.");
      else {
        if (res.message) toast.success(res.message);
        after?.();
      }
    });

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line rounded-xl border border-line">
        {statuses.map((s, i) => (
          <StatusRow
            key={`${s.id}-${s.updated_at}`}
            status={s}
            used={usage[s.id] ?? 0}
            first={i === 0}
            last={i === statuses.length - 1}
            pending={pending}
            onSave={(d) => run(() => updateStatusAction(s.id, d))}
            onMove={(dir) => run(() => moveStatusAction(s.id, dir))}
            onDelete={() => setDeleting(s)}
            canDelete={statuses.length > 1}
          />
        ))}
      </ul>

      <form
        className="grid gap-2 rounded-xl border border-dashed border-line-strong p-3 sm:grid-cols-[1fr_140px_auto_auto] sm:items-center"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.label.trim()) return;
          run(() => createStatusAction(boardId, draft), () => setDraft({ label: "", color: "violet", isDone: false }));
        }}
      >
        <Input
          aria-label="Nombre del nuevo estado"
          placeholder="Nuevo estado, por ejemplo: Bloqueado"
          value={draft.label}
          maxLength={40}
          onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
          className="h-9"
        />
        <Select
          aria-label="Color del nuevo estado"
          value={draft.color}
          onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value as ColorName }))}
          className="h-9"
        >
          {COLOR_NAMES.map((c) => (
            <option key={c} value={c}>
              {COLOR_LABELS[c]}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.isDone}
            onChange={(e) => setDraft((d) => ({ ...d, isDone: e.target.checked }))}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Cuenta como hecho
        </label>
        <Button type="submit" size="sm" variant="primary" disabled={pending || !draft.label.trim()}>
          <IconPlus size={15} /> Agregar
        </Button>
      </form>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Eliminar estado"
        description={
          deleting && (
            <>
              Se elimina el estado <strong className="text-fg">“{deleting.label}”</strong>.
              {(usage[deleting.id] ?? 0) > 0 && ` ${usage[deleting.id]} tareas quedarán sin estado.`}
            </>
          )
        }
        confirmLabel="Eliminar estado"
        onConfirm={() => {
          const s = deleting;
          setDeleting(null);
          if (s) run(() => deleteStatusAction(s.id));
        }}
      />
    </div>
  );
}

function StatusRow({
  status,
  used,
  first,
  last,
  pending,
  canDelete,
  onSave,
  onMove,
  onDelete,
}: {
  status: Status;
  used: number;
  first: boolean;
  last: boolean;
  pending: boolean;
  canDelete: boolean;
  onSave: (d: Draft) => void;
  onMove: (dir: "up" | "down") => void;
  onDelete: () => void;
}) {
  const [d, setD] = useState<Draft>({ label: status.label, color: asColor(status.color), isDone: status.is_done });
  const dirty = d.label.trim() !== status.label || d.color !== status.color || d.isDone !== status.is_done;

  return (
    <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
      <div className="w-36 shrink-0">
        <Chip color={d.color}>{d.label || "—"}</Chip>
      </div>
      <Input
        aria-label={`Nombre del estado ${status.label}`}
        value={d.label}
        maxLength={40}
        onChange={(e) => setD((x) => ({ ...x, label: e.target.value }))}
        className="h-9 sm:flex-1"
      />
      <Select
        aria-label={`Color del estado ${status.label}`}
        value={d.color}
        onChange={(e) => setD((x) => ({ ...x, color: e.target.value as ColorName }))}
        className="h-9 sm:w-32"
      >
        {COLOR_NAMES.map((c) => (
          <option key={c} value={c}>
            {COLOR_LABELS[c]}
          </option>
        ))}
      </Select>
      <label className="flex items-center gap-2 whitespace-nowrap text-sm">
        <input
          type="checkbox"
          checked={d.isDone}
          onChange={(e) => setD((x) => ({ ...x, isDone: e.target.checked }))}
          className="h-4 w-4 accent-[var(--accent)]"
        />
        Hecho
      </label>
      <div className="flex items-center gap-1">
        {dirty && (
          <Button size="sm" variant="primary" disabled={pending || !d.label.trim()} onClick={() => onSave(d)}>
            Guardar
          </Button>
        )}
        <Button size="icon-sm" variant="ghost" aria-label={`Subir ${status.label}`} disabled={first || pending} onClick={() => onMove("up")}>
          <IconArrowUp size={15} />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label={`Bajar ${status.label}`} disabled={last || pending} onClick={() => onMove("down")}>
          <IconArrowDown size={15} />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Eliminar ${status.label}${used ? ` (lo usan ${used} tareas)` : ""}`}
          disabled={!canDelete || pending}
          onClick={onDelete}
          className="hover:text-danger"
        >
          <IconTrash size={15} />
        </Button>
      </div>
    </li>
  );
}
