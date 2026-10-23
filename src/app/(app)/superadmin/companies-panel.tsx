"use client";

import Link from "next/link";
import { useActionState, useId, useState, useTransition } from "react";
import { createCompanyAction, joinCompanyAction, renameCompanyAction, type Company, type CreateCompanyState } from "@/app/actions/companies";
import { Card, EmptyState } from "@/components/ui/misc";
import { Button, SubmitButton } from "@/components/ui/button";
import { buttonClasses } from "@/components/ui/button-classes";
import { Field, FormAlert, Input } from "@/components/ui/form";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { IconBoard, IconCheck, IconCopy, IconEdit, IconPlus, IconUsers } from "@/components/ui/icons";
import { ROLE_LABELS, type WorkspaceRole } from "@/lib/constants";
import { formatDate } from "@/lib/format";

type Created = { company: string; name: string; email: string; existing: boolean; tempPassword?: string };

export function CompaniesPanel({ companies }: { companies: Company[] }) {
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [renaming, setRenaming] = useState<Company | null>(null);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {companies.length} {companies.length === 1 ? "empresa" : "empresas"}
        </p>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <IconPlus size={16} /> Nueva empresa
        </Button>
      </div>

      {companies.length === 0 ? (
        <EmptyState icon={<IconBoard />} title="Todavía no hay empresas" description="Dá de alta la primera con su administrador." />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {companies.map((c) => (
            <li key={c.id}>
              <Card className="flex h-full flex-col gap-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-base font-bold">{c.name}</h2>
                    <p className="text-xs text-muted">Alta: {formatDate(c.created_at)}</p>
                  </div>
                  <Button size="icon-sm" variant="ghost" aria-label={`Renombrar ${c.name}`} onClick={() => setRenaming(c)}>
                    <IconEdit size={15} />
                  </Button>
                </div>
                <p className="flex gap-4 text-sm">
                  <span className="flex items-center gap-1.5">
                    <IconUsers size={15} className="text-subtle" /> {c.users} {c.users === 1 ? "usuario" : "usuarios"}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <IconBoard size={15} className="text-subtle" /> {c.boards} {c.boards === 1 ? "tablero" : "tableros"}
                  </span>
                </p>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Administradores</p>
                  {c.admins.length === 0 ? (
                    <p className="mt-1 text-sm text-warning">Sin administrador</p>
                  ) : (
                    <ul className="mt-1 space-y-0.5 text-sm">
                      {c.admins.map((a) => (
                        <li key={a.user_id} className="truncate">
                          {a.full_name || a.email}
                          <span className="text-muted">
                            {" "}
                            · {ROLE_LABELS[a.role as WorkspaceRole] ?? a.role}
                            {a.full_name && a.email ? ` · ${a.email}` : ""}
                            {!a.active && " · desactivado"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="mt-auto flex flex-wrap gap-2 border-t border-line pt-3">
                  {c.is_member ? (
                    <>
                      <Link href={`/e/${c.id}`} className={buttonClasses("secondary", "sm")}>
                        Entrar
                      </Link>
                      <Link href={`/e/${c.id}/miembros`} className={buttonClasses("ghost", "sm")}>
                        Usuarios
                      </Link>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const res = await joinCompanyAction(c.id);
                          if (!res.ok) toast.error(res.error);
                          else toast.success(res.message ?? "Listo.");
                        })
                      }
                    >
                      Sumarme para administrarla
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <NewCompanyDialog
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            setCreating(false);
            setCreated(c);
          }}
        />
      )}
      {renaming && <RenameDialog company={renaming} onClose={() => setRenaming(null)} />}
      {created && <CreatedDialog created={created} onClose={() => setCreated(null)} />}
    </div>
  );
}

function NewCompanyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (c: Created) => void }) {
  const uid = useId();
  const [manualPassword, setManualPassword] = useState(false);
  const [state, formAction] = useActionState<CreateCompanyState, FormData>(async (prev, formData) => {
    const res = await createCompanyAction(prev, formData);
    if (res?.ok) onCreated(res.data);
    return res;
  }, null);
  const err = (k: string) => (state && !state.ok ? state.fieldErrors?.[k] : undefined);
  const aria = (k: string, id: string) => ({
    "aria-invalid": err(k) ? true : undefined,
    "aria-describedby": err(k) ? `${id}-error` : undefined,
  });

  return (
    <Dialog open onClose={onClose} title="Nueva empresa" description="La empresa y su administrador se crean juntos.">
      <form action={formAction} className="space-y-5" noValidate>
        {state && !state.ok && !state.fieldErrors && <FormAlert>{state.error}</FormAlert>}
        <Field id={`${uid}-name`} label="Nombre de la empresa" error={err("name")}>
          <Input id={`${uid}-name`} name="name" required maxLength={80} autoFocus placeholder="Por ejemplo: Alfa Service" {...aria("name", `${uid}-name`)} />
        </Field>
        <fieldset className="space-y-4 rounded-xl border border-line p-4">
          <legend className="px-1 text-sm font-semibold">Administrador de la empresa</legend>
          <Field id={`${uid}-admin`} label="Nombre y apellido" error={err("adminName")}>
            <Input id={`${uid}-admin`} name="adminName" required maxLength={120} autoComplete="off" {...aria("adminName", `${uid}-admin`)} />
          </Field>
          <Field
            id={`${uid}-email`}
            label="Email (será su usuario)"
            hint="Si ya tiene cuenta en Vetta, se lo suma con su contraseña de siempre."
            error={err("adminEmail")}
          >
            <Input id={`${uid}-email`} name="adminEmail" type="email" required autoComplete="off" {...aria("adminEmail", `${uid}-email`)} />
          </Field>
          <div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!manualPassword} onChange={(e) => setManualPassword(!e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
              Generar la contraseña temporal automáticamente
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
          </div>
        </fieldset>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={onClose}>Cancelar</Button>
          <SubmitButton pendingLabel="Creando empresa…">Crear empresa y administrador</SubmitButton>
        </div>
      </form>
    </Dialog>
  );
}

function RenameDialog({ company, onClose }: { company: Company; onClose: () => void }) {
  const uid = useId();
  const toast = useToast();
  const [name, setName] = useState(company.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open onClose={onClose} title="Renombrar empresa" size="sm">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const res = await renameCompanyAction(company.id, name);
            if (!res.ok) return setError(res.error);
            toast.success(res.message ?? "Listo.");
            onClose();
          });
        }}
      >
        {error && <FormAlert>{error}</FormAlert>}
        <Field id={`${uid}-n`} label="Nombre">
          <Input id={`${uid}-n`} value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={pending || !name.trim()}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function CreatedDialog({ created, onClose }: { created: Created; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `Vetta · ${created.company}\nUsuario: ${created.email}\nContraseña temporal: ${created.tempPassword}\nAl entrar te va a pedir que elijas una contraseña nueva.`;
  return (
    <Dialog open onClose={onClose} title={`${created.company} ya está lista`} size="sm">
      <div className="space-y-4">
        {created.existing || !created.tempPassword ? (
          <FormAlert tone="success">
            <strong>{created.email}</strong> ya tenía cuenta en Vetta: quedó como administrador principal de {created.company} y entra con su
            contraseña de siempre.
          </FormAlert>
        ) : (
          <>
            <p className="text-sm text-muted">Pasale estos datos a {created.name} por un canal privado.</p>
            <dl className="space-y-3 rounded-xl border border-line bg-surface-2 p-4 text-sm">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Usuario</dt>
                <dd className="mt-0.5 break-all font-mono">{created.email}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Contraseña temporal</dt>
                <dd className="mt-0.5 font-mono text-lg font-bold tracking-wide">{created.tempPassword}</dd>
              </div>
            </dl>
            <FormAlert tone="info">Esta contraseña no se vuelve a mostrar.</FormAlert>
          </>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={onClose}>Listo</Button>
          {created.tempPassword && !created.existing && (
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
          )}
        </div>
      </div>
    </Dialog>
  );
}
