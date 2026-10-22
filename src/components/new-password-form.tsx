"use client";

import Link from "next/link";
import { useActionState, useId } from "react";
import { updatePasswordAction } from "@/app/actions/auth";
import { Field, FormAlert, Input } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/button";
import { buttonClasses } from "@/components/ui/button-classes";

export function NewPasswordForm({ redirectHome = true }: { redirectHome?: boolean }) {
  const [state, action] = useActionState(updatePasswordAction, null);
  const uid = useId();
  const err = (k: string) => (state && !state.ok ? state.fieldErrors?.[k] : undefined);

  if (state?.ok) {
    return (
      <div className="space-y-4">
        <FormAlert tone="success">{state.message}</FormAlert>
        {redirectHome && (
          <Link href="/inicio" className={buttonClasses("primary", "md", "w-full")}>
            Ir al inicio
          </Link>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      {state && !state.ok && !state.fieldErrors && <FormAlert>{state.error}</FormAlert>}
      <Field id={`${uid}-p`} label="Nueva contraseña" hint="Mínimo 8 caracteres" error={err("password")}>
        <Input
          id={`${uid}-p`}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          aria-invalid={err("password") ? true : undefined}
          aria-describedby={err("password") ? `${uid}-p-error` : undefined}
        />
      </Field>
      <Field id={`${uid}-c`} label="Repetí la contraseña" error={err("confirm")}>
        <Input
          id={`${uid}-c`}
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={err("confirm") ? true : undefined}
          aria-describedby={err("confirm") ? `${uid}-c-error` : undefined}
        />
      </Field>
      <SubmitButton className="w-full" pendingLabel="Guardando…">
        Guardar contraseña
      </SubmitButton>
    </form>
  );
}
