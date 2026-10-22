"use client";

import Link from "next/link";
import { useActionState, useId } from "react";
import {
  requestPasswordResetAction,
  resendConfirmationAction,
  signInAction,
  signUpAction,
  type AuthFormState,
} from "@/app/actions/auth";
import { Field, FormAlert, Input } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/button";

function fieldError(state: AuthFormState, name: string) {
  return state && !state.ok ? state.fieldErrors?.[name] : undefined;
}

function aria(state: AuthFormState, name: string, id: string) {
  const err = fieldError(state, name);
  return { "aria-invalid": err ? true : undefined, "aria-describedby": err ? `${id}-error` : undefined };
}

export function SignInForm({ next, linkError }: { next?: string; linkError?: boolean }) {
  const [state, action] = useActionState(signInAction, null);
  const uid = useId();
  const notConfirmed = state && !state.ok && state.error.includes("confirmaste");

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4" noValidate>
        <input type="hidden" name="next" value={next ?? ""} />
        {linkError && !state && (
          <FormAlert>El enlace no es válido o ya venció. Iniciá sesión o pedí uno nuevo.</FormAlert>
        )}
        {state && !state.ok && !state.fieldErrors && <FormAlert>{state.error}</FormAlert>}
        <Field id={`${uid}-email`} label="Email" error={fieldError(state, "email")}>
          <Input
            id={`${uid}-email`}
            name="email"
            type="email"
            autoComplete="email"
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
      {notConfirmed && state?.email && <ResendConfirmation email={state.email} />}
    </div>
  );
}

function ResendConfirmation({ email }: { email: string }) {
  const [state, action] = useActionState(resendConfirmationAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="email" value={email} />
      {state && (state.ok ? <FormAlert tone="success">{state.message}</FormAlert> : <FormAlert>{state.error}</FormAlert>)}
      <SubmitButton variant="secondary" className="w-full" pendingLabel="Enviando…">
        Reenviar email de confirmación
      </SubmitButton>
    </form>
  );
}

export function SignUpForm() {
  const [state, action] = useActionState(signUpAction, null);
  const uid = useId();

  if (state?.ok) {
    return (
      <div className="space-y-4">
        <FormAlert tone="success">{state.message}</FormAlert>
        <p className="text-sm text-muted">
          ¿Ya confirmaste?{" "}
          <Link href="/login" className="font-semibold text-accent hover:underline">
            Iniciá sesión
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      {state && !state.ok && !state.fieldErrors && <FormAlert>{state.error}</FormAlert>}
      <Field id={`${uid}-name`} label="Nombre" error={fieldError(state, "fullName")}>
        <Input id={`${uid}-name`} name="fullName" autoComplete="name" required maxLength={120} {...aria(state, "fullName", `${uid}-name`)} />
      </Field>
      <Field id={`${uid}-email`} label="Email" error={fieldError(state, "email")}>
        <Input
          id={`${uid}-email`}
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state?.email}
          {...aria(state, "email", `${uid}-email`)}
        />
      </Field>
      <Field id={`${uid}-password`} label="Contraseña" hint="Mínimo 8 caracteres" error={fieldError(state, "password")}>
        <Input
          id={`${uid}-password`}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          {...aria(state, "password", `${uid}-password`)}
        />
      </Field>
      <Field id={`${uid}-confirm`} label="Repetí la contraseña" error={fieldError(state, "confirm")}>
        <Input
          id={`${uid}-confirm`}
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          {...aria(state, "confirm", `${uid}-confirm`)}
        />
      </Field>
      <SubmitButton className="w-full" pendingLabel="Creando cuenta…">
        Crear cuenta
      </SubmitButton>
    </form>
  );
}

export function RecoverForm() {
  const [state, action] = useActionState(requestPasswordResetAction, null);
  const uid = useId();
  return (
    <form action={action} className="space-y-4" noValidate>
      {state && (state.ok ? <FormAlert tone="success">{state.message}</FormAlert> : !state.fieldErrors && <FormAlert>{state.error}</FormAlert>)}
      <Field id={`${uid}-email`} label="Email de tu cuenta" error={fieldError(state, "email")}>
        <Input id={`${uid}-email`} name="email" type="email" autoComplete="email" required {...aria(state, "email", `${uid}-email`)} />
      </Field>
      <SubmitButton className="w-full" pendingLabel="Enviando…">
        Enviar enlace
      </SubmitButton>
    </form>
  );
}
