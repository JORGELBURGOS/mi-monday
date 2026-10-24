"use client";

import { useState, useTransition } from "react";
import { setBoardVisibilityAction } from "@/app/actions/members";
import { setBoardDefaultRoleAction, setBoardMemberRoleAction, setBoardTeamRoleAction } from "@/app/actions/teams";
import { Avatar } from "@/components/ui/misc";
import { TeamDot } from "@/components/ui/people-picker";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { ROLE_LABELS, VISIBILITY_LABELS } from "@/lib/constants";
import { displayName } from "@/lib/format";
import { BOARD_ROLES, BOARD_ROLE_LABELS, roleRank, type BoardRole, type Team } from "@/lib/teams";
import type { Member } from "@/lib/data";

const selectCls = "h-8 rounded-lg border border-line bg-surface px-2 text-[13px] disabled:opacity-60";

function RoleSelect({
  value,
  emptyLabel,
  onChange,
  disabled,
  label,
  roles = BOARD_ROLES,
}: {
  value: string | null;
  emptyLabel?: string;
  onChange: (v: string | null) => void;
  disabled?: boolean;
  label: string;
  roles?: readonly BoardRole[];
}) {
  return (
    <select aria-label={label} className={selectCls} value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {roles.map((r) => (
        <option key={r} value={r} title={BOARD_ROLE_LABELS[r].help}>
          {BOARD_ROLE_LABELS[r].label}
        </option>
      ))}
    </select>
  );
}

export function BoardAccess({
  boardId,
  visibility: initialVisibility,
  defaultRole: initialDefault,
  createdBy,
  members,
  teams,
  userRoles: initialUsers,
  teamRoles: initialTeams,
}: {
  boardId: string;
  visibility: "workspace" | "private";
  defaultRole: string;
  createdBy: string | null;
  members: Member[];
  teams: Team[];
  userRoles: Record<string, string>;
  teamRoles: Record<string, string>;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [visibility, setVisibility] = useState(initialVisibility);
  const [defaultRole, setDefaultRole] = useState(initialDefault);
  const [users, setUsers] = useState(initialUsers);
  const [teamRoles, setTeamRoles] = useState(initialTeams);

  const changeVisibility = (v: "workspace" | "private") =>
    startTransition(async () => {
      const prev = visibility;
      setVisibility(v);
      const res = await setBoardVisibilityAction(boardId, v);
      if (!res.ok) {
        setVisibility(prev);
        toast.error(res.error);
      } else if (res.message) toast.success(res.message);
    });

  const changeDefault = (r: string) =>
    startTransition(async () => {
      const prev = defaultRole;
      setDefaultRole(r);
      const res = await setBoardDefaultRoleAction(boardId, r);
      if (!res.ok) {
        setDefaultRole(prev);
        toast.error(res.error);
      }
    });

  const changeUser = (userId: string, role: string | null) =>
    startTransition(async () => {
      const prev = users;
      setUsers((u) => {
        const n = { ...u };
        if (role) n[userId] = role;
        else delete n[userId];
        return n;
      });
      const res = await setBoardMemberRoleAction(boardId, userId, role);
      if (!res.ok) {
        setUsers(prev);
        toast.error(res.error);
      }
    });

  const changeTeam = (teamId: string, role: string | null) =>
    startTransition(async () => {
      const prev = teamRoles;
      setTeamRoles((t) => {
        const n = { ...t };
        if (role) n[teamId] = role;
        else delete n[teamId];
        return n;
      });
      const res = await setBoardTeamRoleAction(boardId, teamId, role);
      if (!res.ok) {
        setTeamRoles(prev);
        toast.error(res.error);
      }
    });

  // Si no tiene permiso propio pero sí por un equipo, vale el (mejor) de sus equipos.
  const viaTeam = (userId: string) => {
    const roles = teams.filter((t) => t.member_ids.includes(userId) && teamRoles[t.id]).map((t) => teamRoles[t.id] as BoardRole);
    if (!roles.length) return null;
    const best = [...roles].sort((a, b) => roleRank(b) - roleRank(a))[0];
    return `Por su equipo (${BOARD_ROLE_LABELS[best].label})`;
  };
  const fallback = visibility === "workspace" ? `Como el resto (${BOARD_ROLE_LABELS[defaultRole as BoardRole]?.label ?? "Editor"})` : "Sin acceso";

  return (
    <div className="space-y-5">
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="sr-only">Quién ve este tablero</legend>
        {(["private", "workspace"] as const).map((v) => (
          <label
            key={v}
            className={cn(
              "flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 text-sm",
              visibility === v ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong",
            )}
          >
            <input
              type="radio"
              name="visibility"
              checked={visibility === v}
              disabled={pending}
              onChange={() => changeVisibility(v)}
              className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
            />
            <span>
              <span className="font-semibold">{VISIBILITY_LABELS[v]}</span>
              <span className="block text-xs text-muted">
                {v === "private" ? "Solo entran las personas y equipos que elijas abajo." : "Todos los usuarios de la empresa lo ven."}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {visibility === "workspace" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2.5">
          <span className="text-sm">
            <span className="font-semibold">El resto de la empresa</span>
            <span className="block text-xs text-muted">{BOARD_ROLE_LABELS[defaultRole as BoardRole]?.help}</span>
          </span>
          <RoleSelect label="Permiso del resto de la empresa" value={defaultRole} roles={["editor", "own", "commenter", "viewer"]} onChange={(v) => v && changeDefault(v)} disabled={pending} />
        </div>
      )}

      <section aria-labelledby="perm-teams">
        <h3 id="perm-teams" className="mb-2 text-sm font-bold">
          Equipos
        </h3>
        {teams.length === 0 ? (
          <p className="text-sm text-muted">La empresa todavía no tiene equipos. Se arman en la sección Equipos.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {teams.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <TeamDot color={t.color} />
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {t.name}
                  <span className="ml-2 text-xs font-normal text-muted">
                    {t.member_ids.length} {t.member_ids.length === 1 ? "persona" : "personas"}
                  </span>
                </span>
                <RoleSelect label={`Permiso del equipo ${t.name}`} value={teamRoles[t.id] ?? null} emptyLabel={visibility === "workspace" ? "Como el resto" : "Sin acceso"} onChange={(v) => changeTeam(t.id, v)} disabled={pending} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="perm-people">
        <h3 id="perm-people" className="mb-2 text-sm font-bold">
          Personas
        </h3>
        <ul className="divide-y divide-line rounded-xl border border-line">
          {members.map((m) => {
            const name = displayName(m);
            const always = m.role === "owner" || m.role === "admin" || m.user_id === createdBy;
            return (
              <li key={m.user_id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <Avatar name={name} size="sm" />
                <span className="min-w-0 flex-1 truncate">
                  {name}
                  {m.deactivated_at && <span className="ml-2 text-xs text-danger">Desactivado</span>}
                  {always && <span className="ml-2 text-xs text-muted">{m.role !== "member" ? ROLE_LABELS[m.role] : "Lo creó"}</span>}
                </span>
                {always ? (
                  <span className="text-xs font-semibold text-muted">Administrador (siempre)</span>
                ) : (
                  <RoleSelect label={`Permiso de ${name}`} value={users[m.user_id] ?? null} emptyLabel={viaTeam(m.user_id) ?? fallback} onChange={(v) => changeUser(m.user_id, v)} disabled={pending} />
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-muted">Si una persona tiene permiso propio y también por un equipo, vale el más amplio. El permiso propio reemplaza al del resto de la empresa.</p>
      </section>
    </div>
  );
}
