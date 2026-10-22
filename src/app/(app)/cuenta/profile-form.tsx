"use client";

import { useActionState, useId } from "react";
import { updateProfileAction, type ProfileState } from "@/app/actions/profile";
import { Field, FormAlert, Input } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/button";

export function ProfileForm({ fullName }: { fullName: string }) {
  const [state, action] = useActionState<ProfileState, FormData>(updateProfileAction, null);
  const uid = useId();
  const error = state && !state.ok ? state.fieldErrors?.fullName : undefined;
  return (
    <form action={action} className="space-y-4" noValidate>
      {state && !state.ok && !state.fieldErrors && <FormAlert>{state.error}</FormAlert>}
      {state?.ok && <FormAlert tone="success">{state.message}</FormAlert>}
      <Field id={`${uid}-n`} label="Nombre visible" hint="Lo ven los miembros de tus espacios" error={error}>
        <Input
          id={`${uid}-n`}
          name="fullName"
          defaultValue={fullName}
          maxLength={120}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${uid}-n-error` : undefined}
        />
      </Field>
      <SubmitButton>Guardar</SubmitButton>
    </form>
  );
}
