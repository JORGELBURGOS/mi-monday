"use client";

import { useActionState, useId, useState, useTransition } from "react";
import {
  changeRoleAction,
  inviteMemberAction,
  removeMemberAction,
  revokeInvitationAction,
  type InviteState,
} from "@/app/actions/members";
import { leaveWorkspaceAction } from "@/app/actions/workspaces";
import { Avatar, Card } from "@/components/ui/misc";
import { Button, SubmitButton } from "@/components/ui/button";
import { Field, FormAlert, Input, Select } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { ROLE_LABELS, type WorkspaceRole } from "@/lib/constants";
import { displayName, formatDate } from "@/lib/format";
import type { Invitation, Member } from "@/lib/data";

const ROLE_HELP: Record<WorkspaceRole, string> = {
  owner: "Control total, incluido eliminar el espacio.",
  admin: "Gestiona miembros, invitaciones y todos los tableros compartidos.",
  member: "Crea tableros y trabaja en las tareas.",
};

export function MembersPanel({
  workspaceId,
  myId,
  myRole,
  members,
  invitations,
}: {
  workspaceId: string;
  myId: string;
  myRole: WorkspaceRole;
  members: Member[];
  invitations: Invitation[];
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [removing, setRemoving] = useState<Member | null>(null);
  const [leaving, setLeaving] = useState(false);
  const canManage = myRole === "owner" || myRole === "admin";

  const canEdit = (m: Member) =>
    m.user_id !== myId && (myRole === "owner" || (myRole === "admin" && m.role !== "owner"));
  const roleOptions = (m: Member): WorkspaceRole[] =>
    myRole === "owner" ? ["owner", "admin", "member"] : m.role === "owner" ? ["owner"] : ["admin", "member"];

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string } | undefined>) =>
    startTransition(async () => {
      const res = await fn();
      if (res && !res.ok && res.error) toast.error(res.error);
      else if (res?.message) toast.success(res.message);
    });

  return (
    <div className="space-y-6">
      {canManage && <InviteForm workspaceId={workspaceId} canInviteAdmins={myRole === "owner"} />}

      <Card className="p-0">
        <h2 className="border-b border-line px-5 py-3.5 text-sm font-bold">
          {members.length} {members.length === 1 ? "miembro" : "miembros"}
        </h2>
        <ul className="divide-y divide-line">
          {members.map((m) => {
            const name = displayName(m);
            return (
              <li key={m.user_id} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={name} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {name} {m.user_id === myId && <span className="font-normal text-muted">(vos)</span>}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {m.email} · desde {formatDate(m.created_at)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {canEdit(m) ? (
                    <>
                      <label className="sr-only" htmlFor={`role-${m.user_id}`}>
                        Rol de {name}
                      </label>
                      <Select
                        id={`role-${m.user_id}`}
                        value={m.role}
                        disabled={pending}
                        className="h-9 w-40"
                        onChange={(e) => run(() => changeRoleAction(workspaceId, m.user_id, e.target.value))}
                      >
                        {roleOptions(m).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </Select>
                      <Button size="sm" variant="outline-danger" onClick={() => setRemoving(m)} disabled={pending}>
                        Quitar
                      </Button>
                    </>
                  ) : (
                    <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold" title={ROLE_HELP[m.role]}>
                      {ROLE_LABELS[m.role]}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {canManage && invitations.length > 0 && (
        <Card className="p-0">
          <h2 className="border-b border-line px-5 py-3.5 text-sm font-bold">Invitaciones pendientes</h2>
          <ul className="divide-y divide-line">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{inv.email}</p>
                  <p className="text-xs text-muted">
                    {ROLE_LABELS[inv.role]} · vence el {formatDate(inv.expires_at)}
                  </p>
                </div>
                <Button size="sm" onClick={() => run(() => revokeInvitationAction(inv.id))} disabled={pending}>
                  Revocar
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <h2 className="text-sm font-bold">Roles</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          {(Object.keys(ROLE_HELP) as WorkspaceRole[]).map((r) => (
            <div key={r}>
              <dt className="font-semibold">{ROLE_LABELS[r]}</dt>
              <dd className="text-muted">{ROLE_HELP[r]}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-5 border-t border-line pt-4">
          <Button variant="outline-danger" size="sm" onClick={() => setLeaving(true)}>
            Salir de este espacio
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title="Quitar miembro"
        description={
          removing && (
            <>
              <strong className="text-fg">{displayName(removing)}</strong> va a perder el acceso a este espacio. Sus tareas
              asignadas quedan sin responsable.
            </>
          )
        }
        confirmLabel="Quitar"
        onConfirm={async () => {
          if (!removing) return;
          const res = await removeMemberAction(workspaceId, removing.user_id);
          if (!res.ok) toast.error(res.error);
          else {
            toast.success(res.message ?? "Listo.");
            setRemoving(null);
          }
        }}
      />
      <ConfirmDialog
        open={leaving}
        onClose={() => setLeaving(false)}
        title="Salir del espacio"
        description="Vas a dejar de ver sus tableros. Para volver, alguien tiene que invitarte de nuevo."
        confirmLabel="Salir"
        onConfirm={async () => {
          const res = await leaveWorkspaceAction(workspaceId);
          if (res && !res.ok) toast.error(res.error);
        }}
      />
    </div>
  );
}

function InviteForm({ workspaceId, canInviteAdmins }: { workspaceId: string; canInviteAdmins: boolean }) {
  const [state, formAction] = useActionState<InviteState, FormData>(inviteMemberAction.bind(null, workspaceId), null);
  const uid = useId();
  const err = (k: string) => (state && !state.ok ? state.fieldErrors?.[k] : undefined);

  return (
    <Card>
      <h2 className="text-base font-bold">Invitar a alguien</h2>
      <p className="mt-1 text-sm text-muted">
        La persona ve la invitación en su Inicio al entrar con ese email (si no tiene cuenta, primero se registra).
      </p>
      <form action={formAction} className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end" noValidate key={state?.ok ? state.data.email : "form"}>
        <Field id={`${uid}-email`} label="Email" error={err("email")}>
          <Input
            id={`${uid}-email`}
            name="email"
            type="email"
            required
            autoComplete="off"
            placeholder="nombre@empresa.com"
            aria-invalid={err("email") ? true : undefined}
            aria-describedby={err("email") ? `${uid}-email-error` : undefined}
          />
        </Field>
        <Field id={`${uid}-role`} label="Rol">
          <Select id={`${uid}-role`} name="role" defaultValue="member">
            <option value="member">Miembro</option>
            {canInviteAdmins && <option value="admin">Administrador</option>}
          </Select>
        </Field>
        <SubmitButton pendingLabel="Invitando…">Invitar</SubmitButton>
      </form>
      <div className="mt-3" aria-live="polite">
        {state && !state.ok && !state.fieldErrors && <FormAlert>{state.error}</FormAlert>}
        {state?.ok && (
          <FormAlert tone="success">
            Invitación creada para <strong>{state.data.email}</strong>. Avisale que entre a la app con ese email para
            aceptarla.
          </FormAlert>
        )}
      </div>
    </Card>
  );
}
