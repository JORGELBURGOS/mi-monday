"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { displayName, relativeTime, formatDateTime } from "@/lib/format";
import { PopoverButton } from "@/components/ui/popover";
import { IconAlert, IconEdit } from "@/components/ui/icons";
import { formatNumber, parseTimeline, shortDate, stringList, type BoardColumn, type CellValue } from "@/lib/columns";
import { ChecklistCell, FilesCell, LinkItemsCell, PeopleCell } from "./rich-cells";
import type { FormulaResult } from "@/lib/formula";
import { LabelCell, type LabelEditing } from "./label-picker";
import type { Member } from "./types";

type Props = {
  column: BoardColumn;
  value: CellValue | undefined;
  members: Member[];
  onChange: (value: CellValue | null) => void;
  label: string;
  disabled?: boolean;
  variant?: "cell" | "field";
  id?: string;
  /** Si se indica, las etiquetas de la columna se pueden editar desde la celda. */
  labelEditing?: LabelEditing;
  /** Elemento al que pertenece el valor (archivos y dependencias). */
  taskId?: string;
};

/**
 * Editor de un valor de columna propia. "cell" es compacto para la tabla;
 * "field" ocupa todo el ancho (detalle del ítem y editor de reglas).
 */
export function CustomValueInput({ column, value, members, onChange, label, disabled, variant = "cell", id, labelEditing, taskId = "" }: Props) {
  const cell = variant === "cell";
  const base = cell
    ? "h-8 w-full min-w-0 rounded-lg border border-transparent bg-transparent px-2 text-[13px] hover:border-line hover:bg-surface focus:bg-surface disabled:opacity-60"
    : "h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg hover:border-line-strong disabled:opacity-60";

  switch (column.kind) {
    case "list":
    case "tags":
      return (
        <LabelCell
          labels={column.options}
          value={column.kind === "tags" ? stringList(value) : typeof value === "string" ? value : null}
          multi={column.kind === "tags"}
          onChange={(v) => onChange(v)}
          label={label}
          disabled={disabled}
          editing={labelEditing}
          variant={variant}
          emptyText={cell ? "" : "Sin elegir"}
        />
      );
    case "text":
      if (!cell) return <FieldText id={id} value={value} label={label} disabled={disabled} onChange={onChange} className={base} maxLength={500} />;
      return <TextCell id={id} value={value} label={label} disabled={disabled} onChange={onChange} className={base} />;
    case "number":
      if (!cell)
        return (
          <input
            id={id}
            type="number"
            inputMode="decimal"
            step="any"
            value={typeof value === "number" || typeof value === "string" ? String(value) : ""}
            aria-label={label}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
            className={cn(base, "tabular-nums")}
          />
        );
      return <NumberCell id={id} column={column} value={value} label={label} disabled={disabled} onChange={onChange} className={base} />;
    case "long_text":
      return <LongTextCell id={id} value={value} label={label} disabled={disabled} onChange={onChange} cell={cell} className={base} />;
    case "date":
      return (
        <input
          id={id}
          type="date"
          value={typeof value === "string" ? value : ""}
          aria-label={label}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || null)}
          className={cn(base, "tabular-nums", !value && "text-subtle")}
        />
      );
    case "hour":
      return (
        <input
          id={id}
          type="time"
          value={typeof value === "string" ? value : ""}
          aria-label={label}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || null)}
          className={cn(base, "tabular-nums", !value && "text-subtle")}
        />
      );
    case "timeline":
      return <TimelineCell id={id} value={value} label={label} disabled={disabled} onChange={onChange} cell={cell} />;
    case "rating":
      return <RatingCell value={value} max={column.settings.max ?? 5} label={label} disabled={disabled} onChange={onChange} cell={cell} />;
    case "checkbox":
      return (
        <span className={cn("flex items-center", cell ? "h-8 justify-center" : "h-10")}>
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            aria-label={label}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked ? true : null)}
            className="h-4 w-4 cursor-pointer accent-[var(--accent)] disabled:cursor-not-allowed"
          />
          {!cell && (
            <label htmlFor={id} className="ml-2 text-sm">
              Sí
            </label>
          )}
        </span>
      );
    case "person": {
      const known = !value || members.some((m) => m.user_id === value);
      return (
        <select
          id={id}
          value={typeof value === "string" ? value : ""}
          aria-label={label}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || null)}
          className={cn("select-chip cursor-pointer truncate", base, !value && "text-subtle")}
        >
          <option value="">{cell ? "—" : "Sin asignar"}</option>
          {!known && <option value={String(value)}>Ex usuario</option>}
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {displayName(m)}
            </option>
          ))}
        </select>
      );
    }
    case "files":
      return <FilesCell value={value} taskId={taskId} label={label} disabled={disabled} cell={cell} onChange={onChange} />;
    case "people":
      return <PeopleCell value={value} members={members} label={label} disabled={disabled} cell={cell} onChange={onChange} />;
    case "checklist":
      return <ChecklistCell value={value} members={members} taskId={taskId} label={label} disabled={disabled} cell={cell} onChange={onChange} />;
    case "dependency":
    case "connect":
      return <LinkItemsCell column={column} value={value} taskId={taskId} label={label} disabled={disabled} cell={cell} onChange={onChange} />;
    case "link":
    case "email":
    case "phone":
      return <ContactCell id={id} kind={column.kind} value={value} label={label} disabled={disabled} onChange={onChange} cell={cell} className={base} />;
    default:
      return null;
  }
}

/* ------------------------------------------------------------ calculadas */

export function ComputedCell({
  column,
  result,
  createdAt,
  updatedAt,
  creator,
  code,
  variant = "cell",
}: {
  column: BoardColumn;
  result?: FormulaResult;
  createdAt: string;
  updatedAt: string;
  creator?: string;
  code: string;
  variant?: "cell" | "field";
}) {
  const cls = cn("flex min-w-0 items-center gap-1.5 text-[13px]", variant === "cell" ? "h-8 justify-center px-2" : "min-h-10 px-1");
  switch (column.kind) {
    case "formula": {
      if (!result) return <span className={cls} />;
      if (!result.ok)
        return (
          <span className={cn(cls, "text-danger")} title={result.error}>
            <IconAlert size={14} aria-hidden />
            <span className={variant === "cell" ? "sr-only" : "text-xs"}>{result.error}</span>
          </span>
        );
      const v = result.value;
      const text = v === null || v === "" ? "" : typeof v === "number" ? formatNumber(v, column.settings) : typeof v === "boolean" ? (v ? "Sí" : "No") : v;
      return (
        <span className={cn(cls, typeof v === "number" && "justify-end tabular-nums")} title={text}>
          <span className="truncate">{text}</span>
        </span>
      );
    }
    case "item_id":
      return <span className={cn(cls, "font-mono text-xs text-muted")}>{code}</span>;
    case "created_log":
      return (
        <span className={cls} title={formatDateTime(createdAt)}>
          <span className="truncate">
            {creator ? `${creator} · ` : ""}
            <time dateTime={createdAt} suppressHydrationWarning>
              {relativeTime(createdAt)}
            </time>
          </span>
        </span>
      );
    case "updated_log":
      return (
        <span className={cn(cls, "text-muted")} title={formatDateTime(updatedAt)}>
          <time dateTime={updatedAt} suppressHydrationWarning className="truncate">
            {relativeTime(updatedAt)}
          </time>
        </span>
      );
    default:
      return null;
  }
}

/* ---------------------------------------------------------------- celdas */

function TextCell({ id, value, label, disabled, onChange, className }: { id?: string; value: CellValue | undefined; label: string; disabled?: boolean; onChange: (v: CellValue | null) => void; className: string }) {
  const current = typeof value === "string" ? value : "";
  return (
    <input
      id={id}
      key={current}
      type="text"
      defaultValue={current}
      aria-label={label}
      disabled={disabled}
      maxLength={500}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = current;
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        const raw = e.currentTarget.value.trim();
        if (raw !== current) onChange(raw || null);
      }}
      className={cn(className, "placeholder:text-subtle")}
    />
  );
}

function FieldText({ id, value, label, disabled, onChange, className, maxLength }: { id?: string; value: CellValue | undefined; label: string; disabled?: boolean; onChange: (v: CellValue | null) => void; className: string; maxLength: number }) {
  return (
    <input
      id={id}
      type="text"
      value={typeof value === "string" ? value : ""}
      aria-label={label}
      disabled={disabled}
      maxLength={maxLength}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      className={className}
    />
  );
}

/** Número con formato local y unidad cuando no se está editando (1.500.000,5 $). */
function NumberCell({ id, column, value, label, disabled, onChange, className }: { id?: string; column: BoardColumn; value: CellValue | undefined; label: string; disabled?: boolean; onChange: (value: CellValue | null) => void; className: string }) {
  const [editing, setEditing] = useState(false);
  const raw = typeof value === "number" ? String(value) : "";
  const shown = typeof value === "number" ? formatNumber(value, column.settings) : "";
  return (
    <input
      id={id}
      key={editing ? "edit" : `view-${raw}-${shown}`}
      type="text"
      inputMode="decimal"
      defaultValue={editing ? raw.replace(".", ",") : shown}
      aria-label={label}
      disabled={disabled}
      onFocus={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = raw.replace(".", ",");
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        const text = e.currentTarget.value.trim();
        setEditing(false);
        if (text === "") {
          if (raw !== "") onChange(null);
          return;
        }
        // Acepta 1500000, 1.500.000 o 1500000,5.
        const normalized = /,/.test(text) ? text.replace(/\./g, "").replace(",", ".") : /^-?\d{1,3}(\.\d{3})+$/.test(text) ? text.replace(/\./g, "") : text;
        const n = Number(normalized.replace(/[^\d.-]/g, ""));
        if (!Number.isFinite(n) || String(n) === raw) return;
        onChange(n);
      }}
      className={cn(className, "text-right tabular-nums")}
    />
  );
}

function LongTextCell({ id, value, label, disabled, onChange, cell, className }: { id?: string; value: CellValue | undefined; label: string; disabled?: boolean; onChange: (v: CellValue | null) => void; cell: boolean; className: string }) {
  const current = typeof value === "string" ? value : "";
  if (!cell) {
    return (
      <textarea
        id={id}
        value={current}
        aria-label={label}
        disabled={disabled}
        maxLength={5000}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        className="min-h-24 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm hover:border-line-strong"
      />
    );
  }
  return (
    <PopoverButton
      label={`${label}. Editar`}
      disabled={disabled}
      width={340}
      className={cn(className, "flex items-center text-left")}
      panel={(close) => <LongTextEditor initial={current} label={label} onSave={(v) => { onChange(v || null); close(); }} onCancel={close} />}
    >
      <span className={cn("truncate", !current && "text-subtle")}>{current || ""}</span>
    </PopoverButton>
  );
}

function LongTextEditor({ initial, label, onSave, onCancel }: { initial: string; label: string; onSave: (v: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  return (
    <div className="space-y-2">
      <textarea
        data-autofocus
        value={text}
        maxLength={5000}
        aria-label={label}
        onChange={(e) => setText(e.target.value)}
        className="min-h-32 w-full rounded-md border border-line bg-surface px-2.5 py-2 text-sm"
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-8 rounded-md border border-line px-3 text-[13px] font-semibold hover:bg-surface-2">
          Cancelar
        </button>
        <button type="button" onClick={() => onSave(text.trim())} className="h-8 rounded-md bg-accent px-3 text-[13px] font-semibold text-accent-fg hover:bg-accent-hover">
          Guardar
        </button>
      </div>
    </div>
  );
}

function TimelineCell({ id, value, label, disabled, onChange, cell }: { id?: string; value: CellValue | undefined; label: string; disabled?: boolean; onChange: (v: CellValue | null) => void; cell: boolean }) {
  const t = parseTimeline(value);
  const text = t ? (t.start === t.end ? shortDate(t.start) : `${shortDate(t.start)} – ${shortDate(t.end)}`) : "";
  return (
    <PopoverButton
      label={`${label}: ${text || "sin fechas"}. Cambiar`}
      disabled={disabled}
      width={300}
      align="center"
      className={cn(
        "flex w-full items-center justify-center rounded-full text-[12px] font-semibold tabular-nums disabled:opacity-60",
        cell ? "h-7" : "h-10 rounded-lg border border-line",
        t ? "bg-[var(--accent)] text-[var(--accent-fg)]" : cn("text-subtle hover:bg-surface-2", !cell && "bg-surface"),
      )}
      panel={(close) => <TimelineEditor id={id} initial={t} onSave={(v) => { onChange(v); close(); }} onCancel={close} />}
    >
      {text || (cell ? "" : "Elegir fechas")}
    </PopoverButton>
  );
}

function TimelineEditor({ id, initial, onSave, onCancel }: { id?: string; initial: { start: string; end: string } | null; onSave: (v: string | null) => void; onCancel: () => void }) {
  const [start, setStart] = useState(initial?.start ?? "");
  const [end, setEnd] = useState(initial?.end ?? "");
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs font-semibold">
          Inicio
          <input id={id} data-autofocus type="date" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-line bg-surface px-2 text-sm" />
        </label>
        <label className="text-xs font-semibold">
          Fin
          <input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-line bg-surface px-2 text-sm" />
        </label>
      </div>
      <div className="flex justify-between gap-2">
        <button type="button" onClick={() => onSave(null)} className="h-8 rounded-md px-2 text-[13px] text-muted hover:text-danger">
          Vaciar
        </button>
        <span className="flex gap-2">
          <button type="button" onClick={onCancel} className="h-8 rounded-md border border-line px-3 text-[13px] font-semibold hover:bg-surface-2">
            Cancelar
          </button>
          <button
            type="button"
            disabled={!start}
            onClick={() => onSave(`${start}/${end || start}`)}
            className="h-8 rounded-md bg-accent px-3 text-[13px] font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-50"
          >
            Guardar
          </button>
        </span>
      </div>
    </div>
  );
}

function RatingCell({ value, max, label, disabled, onChange, cell }: { value: CellValue | undefined; max: number; label: string; disabled?: boolean; onChange: (v: CellValue | null) => void; cell: boolean }) {
  const current = typeof value === "number" ? value : 0;
  return (
    <span className={cn("flex items-center", cell ? "h-8 justify-center" : "h-10")} role="radiogroup" aria-label={label}>
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={current === n}
          aria-label={`${n} de ${max}`}
          disabled={disabled}
          onClick={() => onChange(current === n ? null : n)}
          className={cn("px-px text-[17px] leading-none disabled:cursor-not-allowed", n <= current ? "text-[var(--solid-yellow)]" : "text-line-strong hover:text-[var(--solid-yellow)]")}
        >
          ★
        </button>
      ))}
    </span>
  );
}

function ContactCell({ id, kind, value, label, disabled, onChange, cell, className }: { id?: string; kind: "link" | "email" | "phone"; value: CellValue | undefined; label: string; disabled?: boolean; onChange: (v: CellValue | null) => void; cell: boolean; className: string }) {
  const current = typeof value === "string" ? value : "";
  const [editing, setEditing] = useState(false);
  const type = kind === "email" ? "email" : kind === "phone" ? "tel" : "url";
  if (!cell) {
    return <input id={id} type={type} value={current} aria-label={label} disabled={disabled} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)} className={className} />;
  }
  if (!current || editing) {
    return (
      <input
        id={id}
        type={type}
        defaultValue={current}
        autoFocus={editing}
        aria-label={label}
        disabled={disabled}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.currentTarget.value = current;
            e.currentTarget.blur();
          }
        }}
        onBlur={(e) => {
          setEditing(false);
          const raw = e.currentTarget.value.trim();
          if (raw !== current) onChange(raw || null);
        }}
        className={className}
      />
    );
  }
  const href = kind === "email" ? `mailto:${current}` : kind === "phone" ? `tel:${current.replace(/[^\d+]/g, "")}` : current;
  let text = current;
  if (kind === "link") {
    try {
      const u = new URL(current);
      text = u.hostname.replace(/^www\./, "") + (u.pathname !== "/" ? u.pathname : "");
    } catch {
      text = current;
    }
  }
  return (
    <span className="group/c flex h-8 min-w-0 items-center gap-1 px-2 text-[13px]">
      <a href={href} target={kind === "link" ? "_blank" : undefined} rel={kind === "link" ? "noopener noreferrer" : undefined} className="min-w-0 truncate text-accent underline-offset-2 hover:underline" title={current}>
        {text}
      </a>
      {!disabled && (
        <button type="button" onClick={() => setEditing(true)} aria-label={`Editar ${label}`} className="shrink-0 rounded p-0.5 text-subtle opacity-0 hover:text-fg focus-visible:opacity-100 group-hover/c:opacity-100">
          <IconEdit size={13} />
        </button>
      )}
    </span>
  );
}
