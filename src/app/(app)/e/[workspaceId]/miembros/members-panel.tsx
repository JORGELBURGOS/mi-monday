"use client";

import { useActionState, useId, useState, useTransition } from "react";
import { changeRoleAction, removeMemberAction } from "@/app/actions/members";
import { createPersonAction, resetPasswordAction, type CreatePersonState } from "@/app/actions/accounts";
import { leaveWorkspaceAction } from "@/app/actions/workspaces";
import { Avatar, Card } from "@/components/ui/misc";
import { Button, SubmitButton } from "@/components/ui/button";
import { Field, FormAlert, Input, Select } from "@/components/ui/form";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { IconCheck, IconCopy } from "@/components/ui/icons";
import { ROLE_LABELS, type WorkspaceRole } from "@/lib/constants";
import { displayName, formatDate } from "@/lib/format";
import type { Member } from "@/lib/data";

const ROLE_HELP: Record<WorkspaceRole, string> = {
  owner: "Control total, incluido eliminar el espacio.",
  admin: "Da de alta personas, resetea contraseñas y gestiona los tableros compartidos.",
  member: "Crea tableros y trabaja en las tareas.",
};

type Credentials = { name: string; email: string; password: string; reason: "alta" | "reseteo" };

export function MembersPanel({
  workspaceId,
  myId,
  myRole,
  members,
}: {
  workspaceId: string;
  myId: string;
  myRole: WorkspaceRole;
  members: Member[];
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [removing, setRemoving] = useState<Member | null>(null);
  const [resetting, setResetting] = useState<Member | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
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
      {canManage && (
        <AddPersonForm workspaceId={workspaceId} canAddAdmins={myRole === "owner"} onCreated={setCredentials} />
      )}

      <Card className="p-0">
        <h2 className="border-b border-line px-5 py-3.5 text-sm font-bold">
          {members.length} {members.length === 1 ? "miembro" : "miembros"}
        </h2>
        <ul className="divide-y divide-line">
          {members.map((m) => {
            const name = displayName(m);
            return (
              <li key={m.user_id} className="flex flex-col gap-3 px-5 py-3.5 lg:flex-row lg:items-center">
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
                <div className="flex flex-wrap items-center gap-2">
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
                      <Button size="sm" onClick={() => setResetting(m)} disabled={pending}>
                        Restablecer contraseña<span className="sr-only"> de {name}</span>
                      </Button>
                      <Button size="sm" variant="outline-danger" onClick={() => setRemoving(m)} disabled={pending}>
                        Quitar<span className="sr-only"> a {name}</span>
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
        open={Boolean(resetting)}
        onClose={() => setResetting(null)}
        title="Restablecer contraseña"
        danger={false}
        description={
          resetting && (
            <>
              Se le asigna una <strong className="text-fg">contraseña temporal</strong> a{" "}
              <strong className="text-fg">{displayName(resetting)}</strong>. Su contraseña actual deja de funcionar y,
              hasta que elija una nueva, no va a poder ver ningún dato.
            </>
          )
        }
        confirmLabel="Generar contraseña temporal"
        onConfirm={async () => {
          const target = resetting;
          if (!target) return;
          const res = await resetPasswordAction(workspaceId, target.user_id);
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          setResetting(null);
          setCredentials({ name: displayName(target), email: res.data.email, password: res.data.tempPassword, reason: "reseteo" });
        }}
      />

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
        description="Vas a dejar de ver sus tableros. Para volver, un administrador tiene que sumarte de nuevo."
        confirmLabel="Salir"
        onConfirm={async () => {
          const res = await leaveWorkspaceAction(workspaceId);
          if (res && !res.ok) toast.error(res.error);
        }}
      />

      <CredentialsDialog credentials={credentials} onClose={() => setCredentials(null)} />
    </div>
  );
}

function AddPersonForm({
  workspaceId,
  canAddAdmins,
  onCreated,
}: {
  workspaceId: string;
  canAddAdmins: boolean;
  onCreated: (c: Credentials) => void;
}) {
  const [formKey, setFormKey] = useState(0);
  const [manualPassword, setManualPassword] = useState(false);
  const [state, formAction] = useActionState<CreatePersonState, FormData>(async (prev, formData) => {
    const res = await createPersonAction(workspaceId, prev, formData);
    if (res?.ok) {
      if (res.data.tempPassword) {
        onCreated({ name: res.data.fullName, email: res.data.email, password: res.data.tempPassword, reason: "alta" });
      }
      setFormKey((k) => k + 1);
      setManualPassword(false);
    }
    return res;
  }, null);
  const uid = useId();
  const err = (k: string) => (state && !state.ok ? state.fieldErrors?.[k] : undefined);
  const aria = (k: string, id: string) => ({
    "aria-invalid": err(k) ? true : undefined,
    "aria-describedby": err(k) ? `${id}-error` : undefined,
  });

  return (
    <Card>
      <h2 className="text-base font-bold">Agregar una persona</h2>
      <p className="mt-1 text-sm text-muted">
        Se crea su cuenta al instante, sin emails. Le pasás el email y la contraseña temporal, y al entrar elige la suya.
      </p>
      <form key={formKey} action={formAction} className="mt-4 space-y-4" noValidate>
        {state && !state.ok && !state.fieldErrors && <FormAlert>{state.error}</FormAlert>}
        {state?.ok && state.data.existing && (
          <FormAlert tone="success">
            <strong>{state.data.email}</strong> ya tenía cuenta en Vetta: se sumó a este espacio y sigue entrando con su
            contraseña de siempre.
          </FormAlert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${uid}-name`} label="Nombre y apellido" error={err("fullName")}>
            <Input id={`${uid}-name`} name="fullName" required maxLength={120} autoComplete="off" {...aria("fullName", `${uid}-name`)} />
          </Field>
          <Field id={`${uid}-email`} label="Email (será su usuario)" error={err("email")}>
            <Input
              id={`${uid}-email`}
              name="email"
              type="email"
              required
              autoComplete="off"
              placeholder="nombre@empresa.com"
              {...aria("email", `${uid}-email`)}
            />
          </Field>
          <Field id={`${uid}-role`} label="Rol">
            <Select id={`${uid}-role`} name="role" defaultValue="member">
              <option value="member">Miembro</option>
              {canAddAdmins && <option value="admin">Administrador</option>}
            </Select>
          </Field>
          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold">Contraseña temporal</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!manualPassword}
                onChange={(e) => setManualPassword(!e.target.checked)}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              Generarla automáticamente
            </label>
            {manualPassword && (
              <div className="mt-2">
                <label htmlFor={`${uid}-pass`} className="sr-only">
                  Contraseña temporal
                </label>
                <Input
                  id={`${uid}-pass`}
                  name="password"
                  type="text"
                  autoComplete="off"
                  minLength={8}
                  placeholder="Mínimo 8 caracteres"
                  {...aria("password", `${uid}-pass`)}
                />
                {err("password") && (
                  <p id={`${uid}-pass-error`} className="mt-1.5 text-[13px] font-medium text-danger">
                    {err("password")}
                  </p>
                )}
              </div>
            )}
          </fieldset>
        </div>
        <SubmitButton pendingLabel="Creando cuenta…">Agregar persona</SubmitButton>
      </form>
    </Card>
  );
}

function CredentialsDialog({ credentials, onClose }: { credentials: Credentials | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  if (!credentials) return null;
  const text = `Vetta\nUsuario: ${credentials.email}\nContraseña temporal: ${credentials.password}\nAl entrar te va a pedir que elijas una contraseña nueva.`;

  return (
    <Dialog
      open
      onClose={() => {
        setCopied(false);
        onClose();
      }}
      title={credentials.reason === "alta" ? "Cuenta creada" : "Contraseña restablecida"}
      description={`Pasale estos datos a ${credentials.name} por un canal privado.`}
      size="sm"
    >
      <div className="space-y-4">
        <dl className="space-y-3 rounded-xl border border-line bg-surface-2 p-4 text-sm">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Usuario</dt>
            <dd className="mt-0.5 break-all font-mono">{credentials.email}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Contraseña temporal</dt>
            <dd className="mt-0.5 font-mono text-lg font-bold tracking-wide">{credentials.password}</dd>
          </div>
        </dl>
        <FormAlert tone="info">
          Esta contraseña no se vuelve a mostrar. Si se pierde, podés generar otra con “Restablecer contraseña”.
        </FormAlert>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            onClick={() => {
              setCopied(false);
              onClose();
            }}
          >
            Listo
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
            {copied ? "Copiado" : "Copiar datos"}
          </Button>
        </div>
        <p className="sr-only" aria-live="polite">
          {copied ? "Datos copiados al portapapeles." : ""}
        </p>
      </div>
    </Dialog>
  );
}
