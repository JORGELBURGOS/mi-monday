"use client";

import { useActionState, useId } from "react";
import { createWorkspaceAction, updateWorkspaceAction, type FormState } from "@/app/actions/workspaces";
import { Field, FormAlert, Input, Textarea } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/button";

export function WorkspaceForm({
  workspace,
}: {
  workspace?: { id: string; name: string; description: string | null };
}) {
  const action = workspace ? updateWorkspaceAction.bind(null, workspace.id) : createWorkspaceAction;
  const [state, formAction] = useActionState<FormState, FormData>(action, null);
  const uid = useId();
  const err = (k: string) => (state && !state.ok ? state.fieldErrors?.[k] : undefined);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state && !state.ok && <FormAlert>{state.error}</FormAlert>}
      {state?.ok && state.message && <FormAlert tone="success">{state.message}</FormAlert>}
      <Field id={`${uid}-name`} label="Nombre" error={err("name")}>
        <Input
          id={`${uid}-name`}
          name="name"
          required
          maxLength={80}
          defaultValue={workspace?.name}
          placeholder="Por ejemplo: Equipo de producto"
          aria-invalid={err("name") ? true : undefined}
          aria-describedby={err("name") ? `${uid}-name-error` : undefined}
        />
      </Field>
      <Field id={`${uid}-desc`} label="Descripción" hint="Opcional" error={err("description")}>
        <Textarea
          id={`${uid}-desc`}
          name="description"
          maxLength={500}
          defaultValue={workspace?.description ?? ""}
          placeholder="¿Para qué es este espacio?"
        />
      </Field>
      {!workspace && (
        <label className="flex items-start gap-3 rounded-xl border border-line bg-surface-2/60 p-3.5 text-sm">
          <input type="checkbox" name="withSample" className="mt-0.5 h-4 w-4 accent-[var(--accent)]" defaultChecked />
          <span>
            <span className="block font-semibold">Incluir un tablero de ejemplo</span>
            <span className="text-muted">
              Con tareas marcadas como “Ejemplo” para que veas cómo funciona. Lo podés borrar cuando quieras.
            </span>
          </span>
        </label>
      )}
      <SubmitButton pendingLabel={workspace ? "Guardando…" : "Creando…"}>
        {workspace ? "Guardar cambios" : "Crear espacio"}
      </SubmitButton>
    </form>
  );
}
