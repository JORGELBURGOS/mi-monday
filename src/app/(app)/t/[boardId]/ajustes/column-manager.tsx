"use client";

import { useState, useTransition } from "react";
import { createColumnAction, deleteColumnAction, moveColumnAction, updateColumnAction } from "@/app/actions/columns";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Chip } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash, IconX } from "@/components/ui/icons";
import { COLOR_LABELS, COLOR_NAMES, type ColorName } from "@/lib/constants";
import { COLUMN_KINDS, COLUMN_KIND_LABELS, newOptionId, type BoardColumn, type ColumnKind, type ListOption } from "@/lib/columns";

const OPTION_COLORS: ColorName[] = ["blue", "green", "amber", "violet", "teal", "pink", "orange", "red", "gray"];

export function ColumnManager({ boardId, columns, usage }: { boardId: string; columns: BoardColumn[]; usage: Record<string, number> }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [deleting, setDeleting] = useState<BoardColumn | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ColumnKind>("text");
  const [options, setOptions] = useState<ListOption[]>([]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error ?? "No se pudo guardar.");
      else {
        if (res.message) toast.success(res.message);
        after?.();
      }
    });

  const reset = () => {
    setName("");
    setKind("text");
    setOptions([]);
  };

  return (
    <div className="space-y-4">
      {columns.length > 0 ? (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {columns.map((c, i) => (
            <ColumnRow
              key={`${c.id}-${c.updated_at}`}
              column={c}
              first={i === 0}
              last={i === columns.length - 1}
              pending={pending}
              onSave={(n, opts) => run(() => updateColumnAction(c.id, { name: n, options: opts }))}
              onMove={(dir) => run(() => moveColumnAction(c.id, dir))}
              onDelete={() => setDeleting(c)}
            />
          ))}
        </ul>
      ) : (
        <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">
          Este tablero usa solo las columnas básicas (responsable, estado, prioridad y vencimiento). Agregá las que necesite tu proceso:
          cliente, monto, número de pedido, planta…
        </p>
      )}

      <form
        className="space-y-3 rounded-xl border border-dashed border-line-strong p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          run(() => createColumnAction(boardId, { name, kind, options }), reset);
        }}
      >
        <div className="grid gap-2 sm:grid-cols-[1fr_200px_auto] sm:items-center">
          <Input
            aria-label="Nombre de la nueva columna"
            placeholder="Nueva columna, por ejemplo: Cliente"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            className="h-9"
          />
          <Select
            aria-label="Tipo de la nueva columna"
            value={kind}
            onChange={(e) => {
              const k = e.target.value as ColumnKind;
              setKind(k);
              if (k === "list" && options.length === 0) {
                setOptions([
                  { id: newOptionId(), label: "Opción 1", color: "blue" },
                  { id: newOptionId(), label: "Opción 2", color: "green" },
                ]);
              }
            }}
            className="h-9"
          >
            {COLUMN_KINDS.map((k) => (
              <option key={k} value={k}>
                {COLUMN_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm" variant="primary" disabled={pending || !name.trim()}>
            <IconPlus size={15} /> Agregar
          </Button>
        </div>
        {kind === "list" && <OptionsEditor options={options} onChange={setOptions} />}
      </form>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Eliminar columna"
        description={
          deleting && (
            <>
              Se elimina la columna <strong className="text-fg">“{deleting.name}”</strong>
              {(usage[deleting.id] ?? 0) > 0 ? ` y los valores cargados en ${usage[deleting.id]} ítems` : ""}. Las reglas que la usaban
              dejan de copiar ese dato. No se puede deshacer.
            </>
          )
        }
        requireText={(usage[deleting?.id ?? ""] ?? 0) > 0 ? deleting?.name : undefined}
        confirmLabel="Eliminar columna"
        onConfirm={() => {
          const c = deleting;
          setDeleting(null);
          if (c) run(() => deleteColumnAction(c.id));
        }}
      />
    </div>
  );
}

function ColumnRow({
  column,
  first,
  last,
  pending,
  onSave,
  onMove,
  onDelete,
}: {
  column: BoardColumn;
  first: boolean;
  last: boolean;
  pending: boolean;
  onSave: (name: string, options: ListOption[]) => void;
  onMove: (dir: "up" | "down") => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(column.name);
  const [options, setOptions] = useState<ListOption[]>(column.options);
  const dirty = name.trim() !== column.name || JSON.stringify(options) !== JSON.stringify(column.options);

  return (
    <li className="space-y-2 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          aria-label={`Nombre de la columna ${column.name}`}
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          className="h-9 sm:flex-1"
        />
        <span className="shrink-0 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-muted">{COLUMN_KIND_LABELS[column.kind]}</span>
        <div className="flex items-center gap-1">
          {dirty && (
            <Button size="sm" variant="primary" disabled={pending || !name.trim()} onClick={() => onSave(name, options)}>
              Guardar
            </Button>
          )}
          <Button size="icon-sm" variant="ghost" aria-label={`Mover ${column.name} a la izquierda`} disabled={first || pending} onClick={() => onMove("up")}>
            <IconArrowUp size={15} />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label={`Mover ${column.name} a la derecha`} disabled={last || pending} onClick={() => onMove("down")}>
            <IconArrowDown size={15} />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label={`Eliminar ${column.name}`} disabled={pending} onClick={onDelete} className="hover:text-danger">
            <IconTrash size={15} />
          </Button>
        </div>
      </div>
      {column.kind === "list" && <OptionsEditor options={options} onChange={setOptions} />}
    </li>
  );
}

function OptionsEditor({ options, onChange }: { options: ListOption[]; onChange: (o: ListOption[]) => void }) {
  const update = (id: string, patch: Partial<ListOption>) => onChange(options.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  return (
    <fieldset className="rounded-lg bg-surface-2 p-2.5">
      <legend className="sr-only">Opciones de la lista</legend>
      <p className="mb-2 text-xs font-semibold text-muted">Opciones</p>
      <ul className="space-y-1.5">
        {options.map((o, i) => (
          <li key={o.id} className="flex items-center gap-2">
            <Chip color={o.color} className="hidden w-28 shrink-0 truncate sm:inline-flex">
              {o.label || "—"}
            </Chip>
            <Input
              aria-label={`Nombre de la opción ${i + 1}`}
              value={o.label}
              maxLength={40}
              onChange={(e) => update(o.id, { label: e.target.value })}
              className="h-8 flex-1 text-[13px]"
            />
            <Select
              aria-label={`Color de la opción ${o.label || i + 1}`}
              value={o.color}
              onChange={(e) => update(o.id, { color: e.target.value as ColorName })}
              className="h-8 w-28 text-[13px]"
            >
              {COLOR_NAMES.map((c) => (
                <option key={c} value={c}>
                  {COLOR_LABELS[c]}
                </option>
              ))}
            </Select>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Quitar la opción ${o.label || i + 1}`}
              disabled={options.length <= 1}
              onClick={() => onChange(options.filter((x) => x.id !== o.id))}
            >
              <IconX size={14} />
            </Button>
          </li>
        ))}
      </ul>
      <Button
        size="sm"
        variant="ghost"
        className="mt-1.5"
        disabled={options.length >= 50}
        onClick={() =>
          onChange([...options, { id: newOptionId(), label: "", color: OPTION_COLORS[options.length % OPTION_COLORS.length] }])
        }
      >
        <IconPlus size={14} /> Agregar opción
      </Button>
    </fieldset>
  );
}
