"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { displayName } from "@/lib/format";
import type { BoardColumn, CellValue } from "@/lib/columns";
import type { Member } from "./types";

/**
 * Editor de un valor de columna personalizada. "cell" es compacto para la
 * tabla; "field" ocupa todo el ancho (detalle del ítem y editor de reglas).
 */
export function CustomValueInput({
  column,
  value,
  members,
  onChange,
  label,
  disabled,
  variant = "cell",
  id,
}: {
  column: BoardColumn;
  value: CellValue | undefined;
  members: Member[];
  onChange: (value: CellValue | null) => void;
  label: string;
  disabled?: boolean;
  variant?: "cell" | "field";
  id?: string;
}) {
  const cell = variant === "cell";
  const base = cell
    ? "h-8 w-full min-w-0 rounded-lg border border-transparent bg-transparent px-2 text-[13px] hover:border-line hover:bg-surface focus:bg-surface disabled:opacity-60"
    : "h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg hover:border-line-strong disabled:opacity-60";

  switch (column.kind) {
    case "text":
    case "number":
      if (!cell) {
        // En formularios con botón Guardar, el valor se actualiza al tipear.
        return (
          <input
            id={id}
            type={column.kind === "number" ? "number" : "text"}
            inputMode={column.kind === "number" ? "decimal" : undefined}
            step="any"
            value={value === undefined || value === null ? "" : String(value)}
            aria-label={label}
            disabled={disabled}
            maxLength={column.kind === "text" ? 500 : undefined}
            onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
            className={cn(base, column.kind === "number" && "tabular-nums")}
          />
        );
      }
      if (column.kind === "number") {
        return <NumberCell id={id} value={value} label={label} disabled={disabled} onChange={onChange} className={base} />;
      }
      return (
        <input
          id={id}
          key={String(value ?? "")}
          type="text"
          defaultValue={value === undefined ? "" : String(value)}
          aria-label={label}
          disabled={disabled}
          maxLength={500}
          placeholder={cell ? "—" : undefined}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.currentTarget.value = value === undefined ? "" : String(value);
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => {
            const raw = e.currentTarget.value.trim();
            const current = value === undefined ? "" : String(value);
            if (raw === current) return;
            onChange(raw || null);
          }}
          className={cn(base, "placeholder:text-subtle")}
        />
      );
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
          {!known && <option value={String(value)}>Ex miembro</option>}
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {displayName(m)}
            </option>
          ))}
        </select>
      );
    }
    case "list": {
      const current = column.options.find((o) => o.id === value);
      return (
        <select
          id={id}
          value={current ? current.id : ""}
          aria-label={label}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || null)}
          className={cn(
            "select-chip cursor-pointer truncate",
            cell
              ? cn("h-8 w-full rounded-full border-0 pl-3 text-[13px] font-semibold", current ? `chip-${current.color}` : "bg-transparent text-subtle hover:bg-surface")
              : base,
          )}
        >
          <option value="">{cell ? "—" : "Sin elegir"}</option>
          {column.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
  }
}

/** Número con formato local cuando no se está editando (1.500.000,5). */
function NumberCell({
  id,
  value,
  label,
  disabled,
  onChange,
  className,
}: {
  id?: string;
  value: CellValue | undefined;
  label: string;
  disabled?: boolean;
  onChange: (value: CellValue | null) => void;
  className: string;
}) {
  const [editing, setEditing] = useState(false);
  const raw = typeof value === "number" ? String(value) : "";
  const shown = typeof value === "number" ? value.toLocaleString("es-AR", { maximumFractionDigits: 6 }) : "";
  return (
    <input
      id={id}
      key={editing ? "edit" : `view-${raw}`}
      type="text"
      inputMode="decimal"
      defaultValue={editing ? raw.replace(".", ",") : shown}
      aria-label={label}
      disabled={disabled}
      placeholder="—"
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
        const normalized = /,/.test(text) ? text.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(text) ? text.replace(/\./g, "") : text;
        const n = Number(normalized);
        if (!Number.isFinite(n) || String(n) === raw) return;
        onChange(n);
      }}
      className={cn(className, "text-right tabular-nums placeholder:text-subtle")}
    />
  );
}
