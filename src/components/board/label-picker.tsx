"use client";

import { useState } from "react";
import { PopoverButton } from "@/components/ui/popover";
import { IconArrowDown, IconArrowUp, IconCheck, IconEdit, IconPlus, IconTrash, IconX } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { COLOR_LABELS, COLOR_NAMES, type ColorName } from "@/lib/constants";

export type Label = { id: string; label: string; color: ColorName; done?: boolean };

export type LabelEditing = {
  /** Guarda la lista completa de etiquetas. Devuelve un error o null. */
  onSave: (labels: Label[]) => Promise<string | null>;
  /** Etiquetas fijas: solo se renombran y recolorean (prioridad). */
  fixed?: boolean;
  /** Permite marcar etiquetas como "cuenta como terminado". */
  doneToggle?: boolean;
  /** Cuántos ítems usan cada etiqueta (para avisar antes de borrar). */
  usage?: Record<string, number>;
};

const newId = () => `new-${Math.random().toString(36).slice(2, 9)}`;

/**
 * Celda de etiquetas al estilo Monday: un bloque de color que al tocarlo
 * muestra las etiquetas para elegir y, abajo, “Editar etiquetas”.
 */
export function LabelCell({
  labels,
  value,
  onChange,
  multi = false,
  label,
  disabled,
  editing,
  allowEmpty = true,
  emptyText = "",
  variant = "cell",
}: {
  labels: Label[];
  value: string | string[] | null;
  onChange: (next: string | string[] | null) => void;
  multi?: boolean;
  label: string;
  disabled?: boolean;
  editing?: LabelEditing;
  allowEmpty?: boolean;
  emptyText?: string;
  variant?: "cell" | "field";
}) {
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const current = labels.filter((l) => selected.includes(l.id));
  const single = !multi ? current[0] : undefined;
  const cell = variant === "cell";

  const face = multi ? (
    <span className={cn("flex min-w-0 flex-1 items-center gap-1 overflow-hidden", cell ? "justify-center" : "")}>
      {current.length === 0 ? (
        <span className="text-subtle">{emptyText || (cell ? "" : "Sin elegir")}</span>
      ) : (
        current.map((l) => (
          <span key={l.id} className={cn(`chip-${l.color}`, "truncate rounded-full px-2 py-0.5 text-[12px] font-semibold")}>
            {l.label}
          </span>
        ))
      )}
    </span>
  ) : (
    <span className="truncate">{single?.label ?? emptyText}</span>
  );

  return (
    <PopoverButton
      label={`${label}: ${current.map((l) => l.label).join(", ") || "vacío"}. Cambiar`}
      disabled={disabled}
      width={280}
      align="center"
      className={cn(
        "flex w-full min-w-0 items-center text-[13px] font-semibold transition-[filter] disabled:cursor-not-allowed",
        cell ? "h-9 justify-center rounded-md px-2" : "min-h-10 rounded-lg px-3",
        !multi && single ? `solid-${single.color} hover:brightness-95` : multi && cell ? "hover:bg-surface-2" : cell ? "bg-surface-3/70 text-subtle hover:bg-surface-3" : "border border-line bg-surface hover:border-line-strong",
        !cell && multi && "border border-line bg-surface",
      )}
      panel={(close) => (
        <LabelPanel
          labels={labels}
          selected={selected}
          multi={multi}
          allowEmpty={allowEmpty}
          editing={editing}
          onPick={(id) => {
            if (multi) {
              const next = id === null ? [] : selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
              onChange(next.length ? next : null);
            } else {
              onChange(id);
              close();
            }
          }}
        />
      )}
    >
      {face}
    </PopoverButton>
  );
}

function LabelPanel({
  labels,
  selected,
  multi,
  allowEmpty,
  editing,
  onPick,
}: {
  labels: Label[];
  selected: string[];
  multi: boolean;
  allowEmpty: boolean;
  editing?: LabelEditing;
  onPick: (id: string | null) => void;
}) {
  const [mode, setMode] = useState<"pick" | "edit">("pick");
  if (mode === "edit" && editing) return <LabelEditor labels={labels} editing={editing} onDone={() => setMode("pick")} />;

  return (
    <div className="space-y-1.5">
      <ul className="space-y-1" role="listbox" aria-multiselectable={multi || undefined} aria-label="Etiquetas">
        {labels.map((l) => {
          const on = selected.includes(l.id);
          return (
            <li key={l.id}>
              <button
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => onPick(l.id)}
                className={cn(
                  `solid-${l.color}`,
                  "relative flex h-9 w-full items-center justify-center rounded-md px-8 text-[13px] font-semibold hover:brightness-95 focus-visible:outline-offset-2",
                  on && "ring-2 ring-fg ring-offset-2 ring-offset-surface",
                )}
              >
                <span className="truncate">{l.label}</span>
                {on && <IconCheck size={15} className="absolute right-2.5" aria-hidden />}
              </button>
            </li>
          );
        })}
      </ul>
      {allowEmpty && selected.length > 0 && (
        <button
          type="button"
          onClick={() => onPick(null)}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-line-strong text-[13px] text-muted hover:bg-surface-2"
        >
          <IconX size={14} /> {multi ? "Quitar todas" : "Dejar vacío"}
        </button>
      )}
      {editing && (
        <button
          type="button"
          onClick={() => setMode("edit")}
          className="flex h-9 w-full items-center justify-center gap-2 rounded-md border-t border-line pt-1 text-[13px] font-semibold text-muted hover:text-fg"
        >
          <IconEdit size={14} /> Editar etiquetas
        </button>
      )}
    </div>
  );
}

/** Edición de las etiquetas: nombre, color, orden, "terminado", agregar y quitar. */
export function LabelEditor({ labels, editing, onDone }: { labels: Label[]; editing: LabelEditing; onDone: () => void }) {
  const [draft, setDraft] = useState<Label[]>(labels.map((l) => ({ ...l })));
  const [paletteFor, setPaletteFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (id: string, patch: Partial<Label>) => setDraft((d) => d.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const move = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      const n = [...d];
      const j = i + dir;
      if (j < 0 || j >= n.length) return d;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const used = new Set(draft.map((l) => l.color));

  return (
    <div className="space-y-2">
      <p className="px-1 text-xs font-bold uppercase tracking-wide text-subtle">Editar etiquetas</p>
      <ul className="space-y-1.5">
        {draft.map((l, i) => (
          <li key={l.id} className="space-y-1">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPaletteFor((p) => (p === l.id ? null : l.id))}
                aria-label={`Color de ${l.label || "la etiqueta"}: ${COLOR_LABELS[l.color]}. Cambiar`}
                aria-expanded={paletteFor === l.id}
                className={cn(`solid-${l.color}`, "h-8 w-8 shrink-0 rounded-md")}
              />
              <input
                value={l.label}
                maxLength={40}
                aria-label={`Nombre de la etiqueta ${i + 1}`}
                onChange={(e) => update(l.id, { label: e.target.value })}
                className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-[13px]"
              />
              {editing.doneToggle && (
                <button
                  type="button"
                  onClick={() => update(l.id, { done: !l.done })}
                  aria-pressed={Boolean(l.done)}
                  title="Cuenta como terminado"
                  aria-label={`${l.label}: cuenta como terminado`}
                  className={cn("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border", l.done ? "border-success bg-success-soft text-success" : "border-line text-subtle hover:text-fg")}
                >
                  <IconCheck size={14} />
                </button>
              )}
              <span className="flex shrink-0 flex-col">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Subir ${l.label}`} className="h-4 text-subtle hover:text-fg disabled:opacity-30">
                  <IconArrowUp size={12} />
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === draft.length - 1} aria-label={`Bajar ${l.label}`} className="h-4 text-subtle hover:text-fg disabled:opacity-30">
                  <IconArrowDown size={12} />
                </button>
              </span>
              {!editing.fixed && (
                <button
                  type="button"
                  onClick={() => setDraft((d) => d.filter((x) => x.id !== l.id))}
                  disabled={draft.length <= 1}
                  aria-label={`Eliminar la etiqueta ${l.label}`}
                  title={editing.usage?.[l.id] ? `La usan ${editing.usage[l.id]} elementos: quedarán vacíos` : "Eliminar"}
                  className="inline-flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-danger-soft hover:text-danger disabled:opacity-30"
                >
                  <IconTrash size={14} />
                </button>
              )}
            </div>
            {paletteFor === l.id && (
              <div className="grid grid-cols-9 gap-1 rounded-md bg-surface-2 p-1.5" role="group" aria-label={`Colores para ${l.label}`}>
                {COLOR_NAMES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      update(l.id, { color: c });
                      setPaletteFor(null);
                    }}
                    aria-label={COLOR_LABELS[c]}
                    aria-pressed={l.color === c}
                    title={COLOR_LABELS[c]}
                    className={cn(`solid-${c}`, "h-6 rounded", l.color === c && "ring-2 ring-fg ring-offset-1 ring-offset-surface-2")}
                  />
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      {!editing.fixed && (
        <button
          type="button"
          onClick={() => {
            const color = COLOR_NAMES.find((c) => !used.has(c)) ?? "gray";
            const id = newId();
            setDraft((d) => [...d, { id, label: "", color }]);
            setTimeout(() => document.querySelector<HTMLInputElement>(`[aria-label="Nombre de la etiqueta ${draft.length + 1}"]`)?.focus(), 0);
          }}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-line-strong text-[13px] font-semibold text-muted hover:bg-surface-2 hover:text-fg"
        >
          <IconPlus size={14} /> Nueva etiqueta
        </button>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-2 py-1.5 text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2 border-t border-line pt-2">
        <button type="button" onClick={onDone} className="h-8 flex-1 rounded-md border border-line text-[13px] font-semibold hover:bg-surface-2">
          Cancelar
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={async () => {
            const clean = draft.map((l) => ({ ...l, label: l.label.trim() }));
            if (clean.some((l) => !l.label)) return setError("Cada etiqueta necesita un nombre.");
            const names = clean.map((l) => l.label.toLowerCase());
            if (new Set(names).size !== names.length) return setError("Hay dos etiquetas con el mismo nombre.");
            setSaving(true);
            setError(null);
            const err = await editing.onSave(clean);
            setSaving(false);
            if (err) setError(err);
            else onDone();
          }}
          className="h-8 flex-1 rounded-md bg-accent text-[13px] font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-60"
        >
          {saving ? "Guardando…" : "Aplicar"}
        </button>
      </div>
    </div>
  );
}
