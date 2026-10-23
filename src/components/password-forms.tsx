"use client";

import { useActionState, useId } from "react";
import {
  changePasswordAction,
  completePasswordChangeAction,
  type PasswordFormState,
} from "@/app/actions/accounts";
import { Field, FormAlert, Input } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/button";

function PasswordField({
  id,
  name,
  label,
  hint,
  error,
  autoComplete,
}: {
  id: string;
  name: string;
  label: string;
  hint?: string;
  error?: string;
  autoComplete: string;
}) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <Input
        id={id}
        name={name}
        type="password"
        autoComplete={autoComplete}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
    </Field>
  );
}

const errOf = (state: PasswordFormState, k: string) => (state && !state.ok ? state.fieldErrors?.[k] : undefined);

/** Primer ingreso o después de un reseteo: reemplaza la contraseña temporal. */
export function ForcedPasswordForm() {
  const [state, action] = useActionState(completePasswordChangeAction, null);
  const uid = useId();
  return (
    <form action={action} className="space-y-4" noValidate>
      {state && !state.ok && !state.fieldErrors && <FormAlert>{state.error}</FormAlert>}
      <PasswordField id={`${uid}-t`} name="temp" label="Contraseña temporal" hint="La que te dio el administrador" error={errOf(state, "temp")} autoComplete="current-password" />
      <PasswordField id={`${uid}-p`} name="password" label="Contraseña nueva" hint="Mínimo 8 caracteres" error={errOf(state, "password")} autoComplete="new-password" />
      <PasswordField id={`${uid}-c`} name="confirm" label="Repetí la contraseña nueva" error={errOf(state, "confirm")} autoComplete="new-password" />
      <SubmitButton className="w-full" pendingLabel="Guardando…">
        Guardar y entrar
      </SubmitButton>
    </form>
  );
}

/** Cambio voluntario desde Mi cuenta: pide la contraseña actual. */
export function ChangePasswordForm() {
  const [state, action] = useActionState(changePasswordAction, null);
  const uid = useId();
  return (
    <form action={action} className="space-y-4" noValidate key={state?.ok ? "ok" : "form"}>
      {state && !state.ok && !state.fieldErrors && <FormAlert>{state.error}</FormAlert>}
      {state?.ok && <FormAlert tone="success">{state.message}</FormAlert>}
      <PasswordField id={`${uid}-a`} name="current" label="Contraseña actual" error={errOf(state, "current")} autoComplete="current-password" />
      <PasswordField id={`${uid}-p`} name="password" label="Contraseña nueva" hint="Mínimo 8 caracteres" error={errOf(state, "password")} autoComplete="new-password" />
      <PasswordField id={`${uid}-c`} name="confirm" label="Repetí la contraseña nueva" error={errOf(state, "confirm")} autoComplete="new-password" />
      <SubmitButton pendingLabel="Guardando…">Cambiar contraseña</SubmitButton>
    </form>
  );
}
