"use client";

import Link from "next/link";
import { useActionState, useId } from "react";
import { signInAction, type AuthFormState } from "@/app/actions/auth";
import { Field, FormAlert, Input } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/button";

function fieldError(state: AuthFormState, name: string) {
  return state && !state.ok ? state.fieldErrors?.[name] : undefined;
}

function aria(state: AuthFormState, name: string, id: string) {
  const err = fieldError(state, name);
  return { "aria-invalid": err ? true : undefined, "aria-describedby": err ? `${id}-error` : undefined };
}

export function SignInForm({ next }: { next?: string }) {
  const [state, action] = useActionState(signInAction, null);
  const uid = useId();

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next ?? ""} />
      {state && !state.ok && !state.fieldErrors && <FormAlert>{state.error}</FormAlert>}
      <Field id={`${uid}-email`} label="Email" error={fieldError(state, "email")}>
        <Input
          id={`${uid}-email`}
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={state?.email}
          {...aria(state, "email", `${uid}-email`)}
        />
      </Field>
      <Field id={`${uid}-password`} label="Contraseña" error={fieldError(state, "password")}>
        <Input
          id={`${uid}-password`}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          {...aria(state, "password", `${uid}-password`)}
        />
      </Field>
      <div className="flex justify-end">
        <Link href="/recuperar" className="text-sm font-semibold text-accent hover:underline">
          ¿Olvidaste tu contraseña?
        </Link>
      </div>
      <SubmitButton className="w-full" pendingLabel="Ingresando…">
        Iniciar sesión
      </SubmitButton>
    </form>
  );
}
