"use client";

import { useActionState, useId, useState, useTransition } from "react";
import { changeRoleAction, removeMemberAction, setPersonBoardsAction } from "@/app/actions/members";
import {
  createPersonAction,
  resetPasswordAction,
  setPersonActiveAction,
  updatePersonAction,
  type CreatePersonState,
} from "@/app/actions/accounts";
import { leaveWorkspaceAction } from "@/app/actions/workspaces";
import { Avatar, Card } from "@/components/ui/misc";
import { Button, SubmitButton } from "@/components/ui/button";
import { Field, FormAlert, Input, Select } from "@/components/ui/form";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { IconCheck, IconCopy, IconEdit, IconLock, IconUsers } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { ROLE_LABELS, type WorkspaceRole } from "@/lib/constants";
import { displayName, formatDate } from "@/lib/format";
import type { AccessBoard, Member } from "@/lib/data";

const ROLE_HELP: Record<WorkspaceRole, string> = {
  owner: "Control total de la empresa: usuarios, administradores, tableros y reglas.",
  admin: "Da de alta y edita usuarios, decide a qué tableros accede cada uno y ve todos los tableros.",
  member: "Trabaja en los tableros a los que tiene acceso.",
};

type Credentials = { name: string; email: string; password: string; reason: "alta" | "reseteo" };
type Grant = { board_id: string; user_id: string };

export function MembersPanel({
  workspaceId,
  myId,
  myRole,
  members,
  boards,
  grants,
}: {
  workspaceId: string;
  myId: string;
  myRole: WorkspaceRole;
  members: Member[];
  boards: AccessBoard[];
  grants: Grant[];
}) {
  const [editing, setEditing] = useState<Member | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [leaving, setLeaving] = useState(false);
  const toast = useToast();
  const canManage = myRole === "owner" || myRole === "admin";
  const privateBoards = boards.filter((b) => b.visibility === "private");
  const sharedBoards = boards.filter((b) => b.visibility === "workspace");

  const canEdit = (m: Member) => canManage && m.user_id !== myId && (myRole === "owner" || m.role !== "owner");
  const accessSummary = (m: Member) => {
    if (m.role === "owner" || m.role === "admin") return "Ve todos los tableros";
    const own = grants.filter((g) => g.user_id === m.user_id && privateBoards.some((b) => b.id === g.board_id)).length;
    const total = sharedBoards.length + own;
    return `${total} de ${boards.length} ${boards.length === 1 ? "tablero" : "tableros"}`;
  };

  return (
    <div className="space-y-6">
      {canManage && (
        <AddPersonForm
          workspaceId={workspaceId}
          myRole={myRole}
          privateBoards={privateBoards}
          sharedBoards={sharedBoards}
          onCreated={setCredentials}
        />
      )}

      <Card className="p-0">
        <h2 className="border-b border-line px-5 py-3.5 text-sm font-bold">
          {members.length} {members.length === 1 ? "usuario" : "usuarios"}
        </h2>
        <ul className="divide-y divide-line">
          {members.map((m) => {
            const name = displayName(m);
            const inactive = Boolean(m.deactivated_at);
            return (
              <li key={m.user_id} className={cn("flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center", inactive && "opacity-60")}>
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={name} />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
                      <span className="truncate">{name}</span>
                      {m.user_id === myId && <span className="font-normal text-muted">(vos)</span>}
                      {inactive && <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-semibold text-danger">Desactivado</span>}
                      {!inactive && m.must_change_password && (
                        <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning">Contraseña temporal</span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {m.email} · desde {formatDate(m.created_at)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold" title={ROLE_HELP[m.role]}>
                    {ROLE_LABELS[m.role]}
                  </span>
                  <span className="text-xs text-muted">{accessSummary(m)}</span>
                  {canEdit(m) && (
                    <Button size="sm" onClick={() => setEditing(m)}>
                      <IconEdit size={14} /> Editar<span className="sr-only"> a {name}</span>
                    </Button>
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
            Salir de esta empresa
          </Button>
        </div>
      </Card>

      {editing && (
        <PersonDialog
          key={editing.user_id}
          workspaceId={workspaceId}
          member={editing}
          myRole={myRole}
          privateBoards={privateBoards}
          sharedBoards={sharedBoards}
          granted={grants.filter((g) => g.user_id === editing.user_id).map((g) => g.board_id)}
          onClose={() => setEditing(null)}
          onCredentials={setCredentials}
        />
      )}

      <ConfirmDialog
        open={leaving}
        onClose={() => setLeaving(false)}
        title="Salir de la empresa"
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

/* -------------------------------------------------------------------------- */
/*  Edición completa de una persona                                           */
/* -------------------------------------------------------------------------- */

function PersonDialog({
  workspaceId,
  member,
  myRole,
  privateBoards,
  sharedBoards,
  granted,
  onClose,
  onCredentials,
}: {
  workspaceId: string;
  member: Member;
  myRole: WorkspaceRole;
  privateBoards: AccessBoard[];
  sharedBoards: AccessBoard[];
  granted: string[];
  onClose: () => void;
  onCredentials: (c: Credentials) => void;
}) {
  const uid = useId();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [fullName, setFullName] = useState(member.full_name ?? "");
  const [email, setEmail] = useState(member.email ?? "");
  const [role, setRole] = useState<WorkspaceRole>(member.role);
  const [boards, setBoards] = useState<string[]>(granted.filter((id) => privateBoards.some((b) => b.id === id)));
  const [confirm, setConfirm] = useState<"reset" | "deactivate" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = displayName(member);
  const inactive = Boolean(member.deactivated_at);
  const seesAll = role === "owner" || role === "admin";

  const dataDirty = fullName.trim() !== (member.full_name ?? "") || email.trim().toLowerCase() !== (member.email ?? "").toLowerCase();
  const boardsDirty = [...boards].sort().join() !== granted.filter((id) => privateBoards.some((b) => b.id === id)).sort().join();
  const roleDirty = role !== member.role;
  const dirty = dataDirty || boardsDirty || roleDirty;
  const roleOptions: WorkspaceRole[] = myRole === "owner" ? ["owner", "admin", "member"] : ["admin", "member"];

  const save = () =>
    startTransition(async () => {
      setError(null);
      if (dataDirty) {
        const res = await updatePersonAction(workspaceId, member.user_id, { fullName, email });
        if (!res.ok) return setError(res.error);
      }
      if (roleDirty) {
        const res = await changeRoleAction(workspaceId, member.user_id, role);
        if (!res.ok) return setError(res.error);
      }
      if (boardsDirty) {
        const res = await setPersonBoardsAction(workspaceId, member.user_id, boards);
        if (!res.ok) return setError(res.error);
      }
      toast.success("Cambios guardados.");
      onClose();
    });

  return (
    <Dialog open onClose={onClose} title={`Editar a ${name}`} size="lg">
      <div className="space-y-6">
        {error && <FormAlert>{error}</FormAlert>}

        <section className="grid gap-4 sm:grid-cols-2">
          <Field id={`${uid}-name`} label="Nombre y apellido">
            <Input id={`${uid}-name`} value={fullName} maxLength={120} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field id={`${uid}-email`} label="Email (usuario para entrar)">
            <Input id={`${uid}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field id={`${uid}-role`} label="Rol">
            <Select id={`${uid}-role`} value={role} onChange={(e) => setRole(e.target.value as WorkspaceRole)}>
              {roleOptions.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          <p className="self-end pb-2 text-xs text-muted">{ROLE_HELP[role]}</p>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-bold">Acceso a tableros</h3>
          {seesAll ? (
            <p className="rounded-xl bg-surface-2 px-3 py-2.5 text-sm text-muted">Los administradores ven y administran todos los tableros de la empresa.</p>
          ) : (
            <BoardChecklist privateBoards={privateBoards} sharedBoards={sharedBoards} value={boards} onChange={setBoards} />
          )}
        </section>

        <section className="space-y-2 border-t border-line pt-4">
          <h3 className="text-sm font-bold">Cuenta</h3>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setConfirm("reset")} disabled={pending}>
              <IconLock size={14} /> Restablecer contraseña
            </Button>
            {inactive ? (
              <Button
                size="sm"
                onClick={() =>
                  startTransition(async () => {
                    const res = await setPersonActiveAction(workspaceId, member.user_id, true);
                    if (!res.ok) setError(res.error);
                    else {
                      toast.success(res.message ?? "Cuenta reactivada.");
                      onClose();
                    }
                  })
                }
                disabled={pending}
              >
                Reactivar cuenta
              </Button>
            ) : (
              <Button size="sm" variant="outline-danger" onClick={() => setConfirm("deactivate")} disabled={pending}>
                Desactivar cuenta
              </Button>
            )}
            <Button size="sm" variant="outline-danger" onClick={() => setConfirm("remove")} disabled={pending}>
              Quitar de la empresa
            </Button>
          </div>
          {inactive && <p className="text-xs text-danger">Esta cuenta está desactivada: no puede entrar a Vetta.</p>}
        </section>
      </div>

      <div className="sticky bottom-0 -mx-5 -mb-4 mt-6 flex flex-col-reverse gap-2 border-t border-line bg-surface px-5 py-3 sm:flex-row sm:justify-end">
        <Button onClick={onClose} disabled={pending}>
          {dirty ? "Descartar" : "Cerrar"}
        </Button>
        <Button variant="primary" onClick={save} disabled={!dirty || pending || !fullName.trim() || !email.trim()}>
          {pending ? "Guardando…" : "Guardar cambios"}
        </Button>
      </div>

      <ConfirmDialog
        open={confirm === "reset"}
        onClose={() => setConfirm(null)}
        title="Restablecer contraseña"
        danger={false}
        description={
          <>
            Se le asigna una <strong className="text-fg">contraseña temporal</strong> a <strong className="text-fg">{name}</strong>. La actual
            deja de funcionar y, hasta que elija una nueva, no va a poder ver ningún dato.
          </>
        }
        confirmLabel="Generar contraseña temporal"
        onConfirm={async () => {
          const res = await resetPasswordAction(workspaceId, member.user_id);
          setConfirm(null);
          if (!res.ok) return setError(res.error);
          onClose();
          onCredentials({ name, email: res.data.email, password: res.data.tempPassword, reason: "reseteo" });
        }}
      />
      <ConfirmDialog
        open={confirm === "deactivate"}
        onClose={() => setConfirm(null)}
        title="Desactivar cuenta"
        description={
          <>
            <strong className="text-fg">{name}</strong> no va a poder entrar a Vetta ni ver ningún dato. Sus tareas y su historial se conservan
            y podés reactivarla cuando quieras.
          </>
        }
        confirmLabel="Desactivar"
        onConfirm={async () => {
          const res = await setPersonActiveAction(workspaceId, member.user_id, false);
          setConfirm(null);
          if (!res.ok) return setError(res.error);
          toast.success(res.message ?? "Cuenta desactivada.");
          onClose();
        }}
      />
      <ConfirmDialog
        open={confirm === "remove"}
        onClose={() => setConfirm(null)}
        title="Quitar de la empresa"
        description={
          <>
            <strong className="text-fg">{name}</strong> pierde el acceso a esta empresa. Sus tareas asignadas quedan sin responsable.
          </>
        }
        confirmLabel="Quitar"
        onConfirm={async () => {
          const res = await removeMemberAction(workspaceId, member.user_id);
          setConfirm(null);
          if (!res.ok) return setError(res.error);
          toast.success(res.message ?? "Listo.");
          onClose();
        }}
      />
    </Dialog>
  );
}

function BoardChecklist({
  privateBoards,
  sharedBoards,
  value,
  onChange,
  name,
}: {
  privateBoards: AccessBoard[];
  sharedBoards: AccessBoard[];
  value: string[];
  onChange?: (v: string[]) => void;
  /** Si se indica, los checkboxes se envían en un formulario con ese nombre. */
  name?: string;
}) {
  if (privateBoards.length === 0 && sharedBoards.length === 0) {
    return <p className="text-sm text-muted">La empresa todavía no tiene tableros.</p>;
  }
  return (
    <div className="space-y-2">
      {privateBoards.length > 0 ? (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {privateBoards.map((b) => (
            <li key={b.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm hover:border-line-strong">
                <input
                  type="checkbox"
                  name={name}
                  value={b.id}
                  checked={onChange ? value.includes(b.id) : undefined}
                  defaultChecked={onChange ? undefined : value.includes(b.id)}
                  onChange={onChange ? (e) => onChange(e.target.checked ? [...value, b.id] : value.filter((x) => x !== b.id)) : undefined}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                <IconLock size={13} className="text-subtle" />
                <span className="truncate">{b.name}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No hay tableros restringidos: todos son para el equipo completo.</p>
      )}
      {sharedBoards.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-muted">
          <IconUsers size={13} className="mt-0.5 shrink-0" />
          Además ve los tableros para todo el equipo: {sharedBoards.map((b) => b.name).join(", ")}.
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Alta                                                                       */
/* -------------------------------------------------------------------------- */

function AddPersonForm({
  workspaceId,
  myRole,
  privateBoards,
  sharedBoards,
  onCreated,
}: {
  workspaceId: string;
  myRole: WorkspaceRole;
  privateBoards: AccessBoard[];
  sharedBoards: AccessBoard[];
  onCreated: (c: Credentials) => void;
}) {
  const [formKey, setFormKey] = useState(0);
  const [manualPassword, setManualPassword] = useState(false);
  const [role, setRole] = useState<WorkspaceRole>("member");
  const [state, formAction] = useActionState<CreatePersonState, FormData>(async (prev, formData) => {
    const res = await createPersonAction(workspaceId, prev, formData);
    if (res?.ok) {
      if (res.data.tempPassword) {
        onCreated({ name: res.data.fullName, email: res.data.email, password: res.data.tempPassword, reason: "alta" });
      }
      setFormKey((k) => k + 1);
      setManualPassword(false);
      setRole("member");
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
      <h2 className="text-base font-bold">Dar de alta un usuario</h2>
      <p className="mt-1 text-sm text-muted">
        Se crea su cuenta al instante, sin emails. Le pasás el email y la contraseña temporal, y al entrar elige la suya.
      </p>
      <form key={formKey} action={formAction} className="mt-4 space-y-4" noValidate>
        {state && !state.ok && !state.fieldErrors && <FormAlert>{state.error}</FormAlert>}
        {state?.ok && state.data.existing && (
          <FormAlert tone="success">
            <strong>{state.data.email}</strong> ya tenía cuenta en Vetta: se sumó a esta empresa y sigue entrando con su contraseña de siempre.
          </FormAlert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${uid}-name`} label="Nombre y apellido" error={err("fullName")}>
            <Input id={`${uid}-name`} name="fullName" required maxLength={120} autoComplete="off" {...aria("fullName", `${uid}-name`)} />
          </Field>
          <Field id={`${uid}-email`} label="Email (será su usuario)" error={err("email")}>
            <Input id={`${uid}-email`} name="email" type="email" required autoComplete="off" placeholder="nombre@empresa.com" {...aria("email", `${uid}-email`)} />
          </Field>
          <Field id={`${uid}-role`} label="Rol">
            <Select id={`${uid}-role`} name="role" value={role} onChange={(e) => setRole(e.target.value as WorkspaceRole)}>
              <option value="member">{ROLE_LABELS.member}</option>
              <option value="admin">{ROLE_LABELS.admin}</option>
              {myRole === "owner" && <option value="owner">{ROLE_LABELS.owner}</option>}
            </Select>
          </Field>
          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold">Contraseña temporal</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!manualPassword} onChange={(e) => setManualPassword(!e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
              Generarla automáticamente
            </label>
            {manualPassword && (
              <div className="mt-2">
                <label htmlFor={`${uid}-pass`} className="sr-only">
                  Contraseña temporal
                </label>
                <Input id={`${uid}-pass`} name="password" type="text" autoComplete="off" minLength={8} placeholder="Mínimo 8 caracteres" {...aria("password", `${uid}-pass`)} />
                {err("password") && (
                  <p id={`${uid}-pass-error`} className="mt-1.5 text-[13px] font-medium text-danger">
                    {err("password")}
                  </p>
                )}
              </div>
            )}
          </fieldset>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Tableros a los que accede</legend>
          {role === "member" ? (
            <BoardChecklist
              privateBoards={privateBoards}
              sharedBoards={sharedBoards}
              value={[]}
              name="boards"
            />
          ) : (
            <p className="text-sm text-muted">Los administradores ven todos los tableros.</p>
          )}
        </fieldset>
        <SubmitButton pendingLabel="Creando cuenta…">Dar de alta</SubmitButton>
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
        <FormAlert tone="info">Esta contraseña no se vuelve a mostrar. Si se pierde, podés generar otra con “Restablecer contraseña”.</FormAlert>
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

export { CredentialsDialog };
