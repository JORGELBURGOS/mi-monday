"use client";

import { useId, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { asColor } from "@/lib/constants";
import { displayName } from "@/lib/format";
import { Avatar } from "@/components/ui/misc";
import { PopoverButton } from "@/components/ui/popover";
import type { Team } from "@/lib/teams";

type Person = { user_id: string; full_name: string | null; email: string | null; deactivated_at?: string | null };
export type PeopleValue = { users: string[]; teams: string[] };

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Punto de color de un equipo. */
export function TeamDot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", className)} style={{ background: `var(--chip-${asColor(color)}-dot)` }} />;
}

/**
 * Lista con búsqueda para elegir personas y/o equipos (casillas).
 * La usan los responsables, los equipos y los permisos.
 */
export function PeoplePicker({
  people,
  teams = [],
  value,
  onChange,
  showTeams = true,
  disabled,
  max,
}: {
  people: Person[];
  teams?: Team[];
  value: PeopleValue;
  onChange: (v: PeopleValue) => void;
  showTeams?: boolean;
  disabled?: boolean;
  max?: number;
}) {
  const uid = useId();
  const [q, setQ] = useState("");
  const query = norm(q.trim());
  const shownTeams = useMemo(() => (showTeams ? teams.filter((t) => !query || norm(t.name).includes(query)) : []), [teams, showTeams, query]);
  const shownPeople = useMemo(
    () => people.filter((p) => (!p.deactivated_at || value.users.includes(p.user_id)) && (!query || norm(`${p.full_name ?? ""} ${p.email ?? ""}`).includes(query))),
    [people, query, value.users],
  );
  const toggle = (kind: "users" | "teams", id: string) => {
    const list = value[kind];
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    if (max && next.length > max) return;
    onChange({ ...value, [kind]: next });
  };
  const row = "flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2";

  return (
    <div className="space-y-2">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={showTeams ? "Buscar personas o equipos…" : "Buscar personas…"}
        aria-label="Buscar"
        className="h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-accent"
      />
      <div className="max-h-72 space-y-2 overflow-y-auto">
        {shownTeams.length > 0 && (
          <div role="group" aria-labelledby={`${uid}-t`}>
            <p id={`${uid}-t`} className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">
              Equipos
            </p>
            {shownTeams.map((t) => (
              <label key={t.id} className={row}>
                <input type="checkbox" disabled={disabled} checked={value.teams.includes(t.id)} onChange={() => toggle("teams", t.id)} className="h-4 w-4 accent-[var(--accent)]" />
                <TeamDot color={t.color} />
                <span className="min-w-0 flex-1 truncate font-semibold">{t.name}</span>
                <span className="text-xs text-muted">{t.member_ids.length}</span>
              </label>
            ))}
          </div>
        )}
        <div role="group" aria-labelledby={`${uid}-p`}>
          {showTeams && (
            <p id={`${uid}-p`} className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">
              Personas
            </p>
          )}
          {shownPeople.length === 0 && <p className="px-2 py-1 text-sm text-muted">Nadie coincide con la búsqueda.</p>}
          {shownPeople.map((p) => {
            const name = displayName(p);
            return (
              <label key={p.user_id} className={row}>
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={value.users.includes(p.user_id)}
                  onChange={() => toggle("users", p.user_id)}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                <Avatar name={name} size="sm" />
                <span className="min-w-0 flex-1 truncate">{name}</span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Resumen compacto: avatares de personas + chips de equipos. */
export function PeopleSummary({
  value,
  people,
  teams = [],
  empty = "Sin responsable",
  max = 3,
}: {
  value: PeopleValue;
  people: Person[];
  teams?: Team[];
  empty?: string;
  max?: number;
}) {
  const ps = value.users.map((id) => people.find((p) => p.user_id === id)).filter(Boolean) as Person[];
  const ts = value.teams.map((id) => teams.find((t) => t.id === id)).filter(Boolean) as Team[];
  if (ps.length === 0 && ts.length === 0) return <span className="truncate text-subtle">{empty}</span>;
  const names = [...ps.map((p) => displayName(p)), ...ts.map((t) => `Equipo ${t.name}`)].join(", ");
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={names}>
      {ts.slice(0, 2).map((t) => (
        <span key={t.id} className="inline-flex max-w-28 items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold">
          <TeamDot color={t.color} className="h-2 w-2" />
          <span className="truncate">{t.name}</span>
        </span>
      ))}
      {ps.length > 0 && (
        <span className="flex -space-x-1.5">
          {ps.slice(0, max).map((p) => (
            <Avatar key={p.user_id} name={displayName(p)} size="sm" className="ring-2 ring-surface" />
          ))}
        </span>
      )}
      {ps.length === 1 && ts.length === 0 && <span className="truncate">{displayName(ps[0])}</span>}
      {ps.length + ts.length > Math.min(ts.length, 2) + Math.min(ps.length, max) && (
        <span className="text-xs font-semibold text-muted">+{ps.length + ts.length - Math.min(ts.length, 2) - Math.min(ps.length, max)}</span>
      )}
    </span>
  );
}

/** Celda / campo de responsables: muestra el resumen y abre el selector. */
export function AssigneesPicker({
  value,
  people,
  teams,
  onChange,
  label,
  disabled,
  className,
}: {
  value: PeopleValue;
  people: Person[];
  teams: Team[];
  onChange: (v: PeopleValue) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <PopoverButton
      label={label}
      width={300}
      disabled={disabled}
      className={cn("flex h-8 w-full min-w-0 items-center rounded-lg border border-transparent px-2 text-left text-[13px] hover:border-line hover:bg-surface disabled:hover:border-transparent disabled:hover:bg-transparent", className)}
      panel={(close) => (
        <div className="space-y-2 p-2">
          <PeoplePicker people={people} teams={teams} value={value} onChange={onChange} />
          <div className="flex items-center justify-between gap-2 border-t border-line pt-2">
            <button type="button" className="text-xs font-semibold text-muted hover:text-fg disabled:opacity-50" disabled={!value.users.length && !value.teams.length} onClick={() => onChange({ users: [], teams: [] })}>
              Quitar todos
            </button>
            <button type="button" className="h-8 rounded-lg bg-accent px-3 text-xs font-semibold text-accent-fg" onClick={() => close()}>
              Listo
            </button>
          </div>
        </div>
      )}
    >
      <PeopleSummary value={value} people={people} teams={teams} />
    </PopoverButton>
  );
}
