"use client";

import { cn } from "@/lib/cn";
import { PRIORITIES, PRIORITY_BY_VALUE, asColor, type Priority } from "@/lib/constants";
import { displayName, dueState, formatDueDate } from "@/lib/format";
import type { Member, Status } from "./types";

const chipSelect =
  "select-chip h-8 w-full max-w-full cursor-pointer truncate rounded-full border-0 pl-3 text-[13px] font-semibold disabled:cursor-not-allowed";

export function StatusSelect({
  value,
  statuses,
  onChange,
  label,
  disabled,
  className,
}: {
  value: string | null;
  statuses: Status[];
  onChange: (id: string | null) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const current = statuses.find((s) => s.id === value);
  return (
    <select
      aria-label={label}
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
      className={cn(chipSelect, `chip-${asColor(current?.color)}`, !current && "text-muted", className)}
    >
      <option value="">Sin estado</option>
      {statuses.map((s) => (
        <option key={s.id} value={s.id}>
          {s.label}
        </option>
      ))}
    </select>
  );
}

export function PrioritySelect({
  value,
  onChange,
  label,
  disabled,
  className,
}: {
  value: Priority;
  onChange: (p: Priority) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const p = PRIORITY_BY_VALUE[value];
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as Priority)}
      className={cn(chipSelect, `chip-${p.color}`, className)}
    >
      {PRIORITIES.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {"▮".repeat(opt.rank)} {opt.label}
        </option>
      ))}
    </select>
  );
}

export function AssigneeSelect({
  value,
  members,
  onChange,
  label,
  disabled,
  className,
}: {
  value: string | null;
  members: Member[];
  onChange: (id: string | null) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const known = !value || members.some((m) => m.user_id === value);
  return (
    <select
      aria-label={label}
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
      className={cn(
        "select-chip h-8 w-full cursor-pointer truncate rounded-lg border border-transparent bg-transparent pl-2 text-[13px] hover:border-line hover:bg-surface",
        !value && "text-subtle",
        className,
      )}
    >
      <option value="">Sin responsable</option>
      {!known && <option value={value!}>Ex miembro</option>}
      {members.map((m) => (
        <option key={m.user_id} value={m.user_id}>
          {displayName(m)}
        </option>
      ))}
    </select>
  );
}

export function DueDateInput({
  value,
  onChange,
  label,
  today,
  done,
  disabled,
  className,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  label: string;
  today: string;
  done: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const state = dueState(value, today, done);
  const hint =
    state === "overdue" ? "Vencida" : state === "today" ? "Vence hoy" : state === "soon" ? "Vence pronto" : undefined;
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {(state === "overdue" || state === "today") && (
        <span
          aria-hidden
          title={hint}
          className={cn("h-2 w-2 shrink-0 rounded-full", state === "overdue" ? "bg-danger" : "bg-warning")}
        />
      )}
      <input
        type="date"
        title={hint}
        aria-label={hint ? `${label} (${hint.toLowerCase()})` : label}
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
        className={cn(
          "h-8 w-full min-w-0 rounded-lg border border-transparent bg-transparent px-2 text-[13px] tabular-nums hover:border-line hover:bg-surface",
          !value && "text-subtle",
          state === "overdue" && "font-semibold text-danger",
          state === "today" && "font-semibold text-warning",
        )}
      />
    </div>
  );
}

export function DueBadge({ value, today, done }: { value: string | null; today: string; done: boolean }) {
  if (!value) return <span className="text-subtle">Sin fecha</span>;
  const state = dueState(value, today, done);
  return (
    <span
      className={cn(
        "tabular-nums",
        state === "overdue" && "font-semibold text-danger",
        state === "today" && "font-semibold text-warning",
      )}
    >
      {formatDueDate(value, today)}
      {state === "overdue" && " · vencida"}
      {state === "today" && " · hoy"}
    </span>
  );
}
