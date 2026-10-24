"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, FormAlert, Input, Textarea } from "@/components/ui/form";
import { Avatar, EmptyState } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { IconPlus, IconUsers } from "@/components/ui/icons";
import { PeoplePicker, TeamDot } from "@/components/ui/people-picker";
import { createTeamAction, deleteTeamAction, updateTeamAction } from "@/app/actions/teams";
import { COLOR_LABELS, COLOR_NAMES } from "@/lib/constants";
import { cn } from "@/lib/cn";
import { displayName } from "@/lib/format";
import type { Member } from "@/lib/data";
import type { Team } from "@/lib/teams";

type Editing = { id?: string; name: string; color: string; description: string; memberIds: string[] };

export function TeamsManager({ workspaceId, teams, members, isAdmin }: { workspaceId: string; teams: Team[]; members: Member[]; isAdmin: boolean }) {
  const toast = useToast();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [removing, setRemoving] = useState<Team | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      if (!editing) return;
      setError(null);
      const input = { name: editing.name, color: editing.color as (typeof COLOR_NAMES)[number], description: editing.description, memberIds: editing.memberIds };
      const res = editing.id ? await updateTeamAction(editing.id, input) : await createTeamAction(workspaceId, input);
      if (!res.ok) setError(res.error);
      else {
        toast.success(res.message ?? "Equipo guardado.");
        setEditing(null);
      }
    });

  const person = (id: string) => members.find((m) => m.user_id === id);

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex justify-end">
          <Button variant="primary" onClick={() => setEditing({ name: "", color: "blue", description: "", memberIds: [] })}>
            <IconPlus size={16} /> Nuevo equipo
          </Button>
        </div>
      )}

      {teams.length === 0 ? (
        <EmptyState
          icon={<IconUsers />}
          title="Todavía no hay equipos"
          description={isAdmin ? "Armá el primero: por ejemplo Comercial, Logística o Administración." : "Los arman los administradores de la empresa."}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {teams.map((t) => (
            <li key={t.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
              <div className="flex items-start gap-2.5">
                <TeamDot color={t.color} className="mt-1.5 h-3 w-3" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{t.name}</p>
                  {t.description && <p className="text-xs text-muted">{t.description}</p>}
                </div>
                <span className="text-xs font-semibold text-muted">
                  {t.member_ids.length} {t.member_ids.length === 1 ? "persona" : "personas"}
                </span>
              </div>
              {t.member_ids.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {t.member_ids.map((id) => {
                    const m = person(id);
                    if (!m) return null;
                    return (
                      <li key={id} className="flex items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pl-0.5 pr-2.5 text-xs">
                        <Avatar name={displayName(m)} size="sm" />
                        {displayName(m)}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-xs text-muted">Sin integrantes todavía.</p>
              )}
              {isAdmin && (
                <div className="mt-auto flex gap-2">
                  <Button size="sm" onClick={() => setEditing({ id: t.id, name: t.name, color: t.color, description: t.description ?? "", memberIds: t.member_ids })}>
                    Editar
                  </Button>
                  <Button size="sm" variant="outline-danger" onClick={() => setRemoving(t)}>
                    Eliminar
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <Dialog open onClose={() => setEditing(null)} title={editing.id ? "Editar equipo" : "Nuevo equipo"} size="lg">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            {error && <FormAlert>{error}</FormAlert>}
            <Field id="team-name" label="Nombre">
              <Input id="team-name" data-autofocus value={editing.name} maxLength={60} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Por ejemplo: Logística" />
            </Field>
            <fieldset>
              <legend className="mb-1.5 text-sm font-semibold">Color</legend>
              <div className="flex flex-wrap gap-1.5">
                {COLOR_NAMES.map((c) => (
                  <label key={c} className="cursor-pointer" title={COLOR_LABELS[c]}>
                    <input type="radio" name="team-color" value={c} checked={editing.color === c} onChange={() => setEditing({ ...editing, color: c })} className="peer sr-only" />
                    <span
                      className={cn("block h-7 w-7 rounded-full border-2 border-transparent peer-checked:border-fg peer-focus-visible:ring-2 peer-focus-visible:ring-accent")}
                      style={{ background: `var(--chip-${c}-dot)` }}
                    />
                    <span className="sr-only">{COLOR_LABELS[c]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Field id="team-desc" label="Descripción (opcional)">
              <Textarea id="team-desc" value={editing.description} maxLength={300} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className="min-h-16" />
            </Field>
            <div>
              <p className="mb-1.5 text-sm font-semibold">Integrantes ({editing.memberIds.length})</p>
              <PeoplePicker
                people={members}
                showTeams={false}
                value={{ users: editing.memberIds, teams: [] }}
                onChange={(v) => setEditing({ ...editing, memberIds: v.users })}
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-line pt-4">
              <Button type="button" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" disabled={pending || !editing.name.trim()}>
                {pending ? "Guardando…" : "Guardar equipo"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}

      {removing && (
        <ConfirmDialog
          open
          title={`¿Eliminar el equipo «${removing.name}»?`}
          description="Se quita de los elementos donde es responsable y de los permisos de tableros, carpetas y columnas donde aparece. Las personas no se borran."
          confirmLabel="Eliminar equipo"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            const res = await deleteTeamAction(removing.id);
            if (!res.ok) toast.error(res.error);
            else toast.success("Equipo eliminado.");
            setRemoving(null);
          }}
        />
      )}
    </div>
  );
}
