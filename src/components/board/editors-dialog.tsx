"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormAlert } from "@/components/ui/form";
import { PeoplePicker } from "@/components/ui/people-picker";
import type { ActionResult } from "@/lib/action-result";
import type { Editors, Team } from "@/lib/teams";
import type { Member } from "./types";

/**
 * Elegir quién edita una carpeta o cambia una columna. Vacío = todos los que
 * pueden editar el tablero. Los administradores del tablero siempre pueden.
 */
export function EditorsDialog({
  title,
  description,
  initial,
  people,
  teams,
  onSave,
  onClose,
}: {
  title: string;
  description: string;
  initial: Editors;
  people: Member[];
  teams: Team[];
  onSave: (e: Editors) => Promise<ActionResult<unknown>>;
  onClose: () => void;
}) {
  const [value, setValue] = useState({ users: initial.users ?? [], teams: initial.teams ?? [] });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const empty = value.users.length + value.teams.length === 0;

  return (
    <Dialog open onClose={onClose} title={title} description={description} size="md">
      <div className="space-y-4">
        {error && <FormAlert>{error}</FormAlert>}
        <div className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
          {empty ? (
            <span>
              <strong>Sin restricción:</strong> la edita cualquiera que pueda editar el tablero.
            </span>
          ) : (
            <span>
              <strong>Restringida:</strong> solo la editan las {value.teams.length ? "personas y equipos" : "personas"} marcados y quienes administran el tablero.
            </span>
          )}
        </div>
        <PeoplePicker people={people.filter((p) => !p.is_platform_admin)} teams={teams} value={value} onChange={setValue} />
        <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" disabled={empty || pending} onClick={() => setValue({ users: [], teams: [] })}>
            Quitar restricción
          </Button>
          <div className="flex gap-2">
            <Button type="button" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const res = await onSave({ users: value.users, teams: value.teams });
                  if (!res.ok) setError(res.error);
                  else onClose();
                })
              }
            >
              {pending ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
