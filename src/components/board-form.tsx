"use client";

import { useActionState, useId, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { createBoardAction, updateBoardAction, type BoardFormState } from "@/app/actions/boards";
import { Field, FormAlert, Input, Textarea } from "@/components/ui/form";
import { Button, SubmitButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { IconPlus } from "@/components/ui/icons";
import type { Visibility } from "@/lib/constants";

type BoardValues = { id: string; name: string; description: string | null; visibility: Visibility };

export function BoardForm({
  workspaceId,
  board,
  onCancel,
}: {
  workspaceId?: string;
  board?: BoardValues;
  onCancel?: () => void;
}) {
  const action = board ? updateBoardAction.bind(null, board.id) : createBoardAction.bind(null, workspaceId!);
  const [state, formAction] = useActionState<BoardFormState, FormData>(action, null);
  const uid = useId();
  const err = (k: string) => (state && !state.ok ? state.fieldErrors?.[k] : undefined);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state && !state.ok && <FormAlert>{state.error}</FormAlert>}
      {state?.ok && state.message && <FormAlert tone="success">{state.message}</FormAlert>}
      <Field id={`${uid}-name`} label="Nombre del tablero" error={err("name")}>
        <Input
          id={`${uid}-name`}
          name="name"
          required
          maxLength={80}
          defaultValue={board?.name}
          placeholder="Por ejemplo: Plan de marketing"
          autoFocus={!board}
          aria-invalid={err("name") ? true : undefined}
          aria-describedby={err("name") ? `${uid}-name-error` : undefined}
        />
      </Field>
      <Field id={`${uid}-desc`} label="Descripción" hint="Opcional" error={err("description")}>
        <Textarea id={`${uid}-desc`} name="description" maxLength={1000} defaultValue={board?.description ?? ""} className="min-h-20" />
      </Field>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Quién puede verlo</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["workspace", "Compartido", "Todos los miembros del espacio."],
              ["private", "Privado", "Solo vos (y el propietario del espacio)."],
            ] as const
          ).map(([value, label, hint]) => (
            <label
              key={value}
              className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line p-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft/50"
            >
              <input
                type="radio"
                name="visibility"
                value={value}
                defaultChecked={(board?.visibility ?? "workspace") === value}
                className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
              />
              <span>
                <span className="block font-semibold">{label}</span>
                <span className="text-muted">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && <Button onClick={onCancel}>Cancelar</Button>}
        <SubmitButton pendingLabel={board ? "Guardando…" : "Creando…"}>{board ? "Guardar cambios" : "Crear tablero"}</SubmitButton>
      </div>
    </form>
  );
}

/** Botón + diálogo para crear un tablero. Se abre solo con ?nuevo=1. */
export function NewBoardButton({ workspaceId }: { workspaceId: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [manualOpen, setManualOpen] = useState(false);
  const open = manualOpen || searchParams.get("nuevo") === "1";

  const close = () => {
    setManualOpen(false);
    if (searchParams.get("nuevo")) router.replace(pathname, { scroll: false });
  };

  return (
    <>
      <Button variant="primary" onClick={() => setManualOpen(true)}>
        <IconPlus size={16} /> Nuevo tablero
      </Button>
      <Dialog open={open} onClose={close} title="Nuevo tablero" description="Arranca con los estados básicos y una carpeta; después lo adaptás.">
        <BoardForm workspaceId={workspaceId} onCancel={close} />
      </Dialog>
    </>
  );
}
