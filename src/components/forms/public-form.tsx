"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { browserClient } from "@/lib/supabase/browser";
import { callForms } from "@/lib/forms-api";
import type { Answers, FileAnswer, FormDesign } from "@/lib/form-logic";
import { FormCover, FormRenderer, formTheme, type FormTransport, type PublicForm, type SubmitResult } from "./form-renderer";

export type FormEnvelope =
  | ({ locked: false; id: string; access: string } & PublicForm)
  | { locked: true; id: string; slug: string; title: string; design: FormDesign; access: string; needsPassword?: boolean; needsLogin?: boolean; wrongPassword?: boolean; message: string };

async function userToken() {
  try {
    const { data } = await browserClient().auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export function PublicFormClient({
  slug,
  initial,
  initialError,
  prefill,
  embed,
}: {
  slug: string;
  initial: FormEnvelope | null;
  initialError: string | null;
  prefill: Record<string, string>;
  embed: boolean;
}) {
  const [envelope, setEnvelope] = useState(initial);
  const [password, setPassword] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const transport: FormTransport = useMemo(
    () => ({
      upload: async (questionId: string, file: File): Promise<FileAnswer> => {
        const res = await callForms<{ upload: string; path: string; token: string }>({ action: "upload", slug, password, question: questionId, name: file.name, size: file.size, type: file.type }, await userToken());
        if (!res.ok) throw new Error(res.error);
        const { error } = await browserClient().storage.from("vetta-files").uploadToSignedUrl(res.data.path, res.data.token, file, { contentType: file.type || "application/octet-stream" });
        if (error) throw new Error(`No se pudo subir «${file.name}».`);
        return { upload: res.data.upload, name: file.name, size: file.size, type: file.type };
      },
      submit: async (answers: Answers, meta: { startedAt: number; website: string }) => {
        const res = await callForms<SubmitResult>({ action: "submit", slug, password, answers, startedAt: meta.startedAt, website: meta.website }, await userToken());
        if (res.ok) return { ok: true as const, data: res.data };
        return { ok: false as const, error: res.error, errors: (res.errors as Record<string, string> | undefined) ?? undefined };
      },
    }),
    [slug, password],
  );

  const unlock = async () => {
    setChecking(true);
    setPwError(null);
    const res = await callForms<FormEnvelope>({ action: "get", slug, password }, await userToken());
    setChecking(false);
    if (!res.ok) return setPwError(res.error);
    if (res.data.locked) return setPwError(res.data.wrongPassword ? "La contraseña no es correcta." : res.data.message);
    setEnvelope(res.data);
  };

  const design: FormDesign = envelope?.design ?? { accent: "blue", cover: "none", layout: "classic", theme: "auto" };

  return (
    <div style={formTheme(design)} className={cn("min-h-dvh bg-bg", embed ? "px-3 py-4" : "px-4 py-8 sm:py-12")}>
      <main className="mx-auto w-full max-w-2xl space-y-4">
        {!envelope ? (
          <div className="rounded-2xl border border-line bg-surface p-8 text-center shadow-card">
            <p className="text-lg font-bold">Formulario no disponible</p>
            <p className="mt-1 text-muted">{initialError ?? "Revisá el enlace."}</p>
          </div>
        ) : envelope.locked ? (
          <>
            <FormCover design={design} title={envelope.title} />
            <div className="rounded-2xl border border-line bg-surface px-5 py-5 shadow-card sm:px-7">
              {envelope.needsLogin ? (
                <>
                  <p className="font-bold">Solo para usuarios de la empresa</p>
                  <p className="mt-1 text-sm text-muted">Iniciá sesión con tu cuenta para responder.</p>
                  <Link href={`/login?next=${encodeURIComponent(`/f/${slug}`)}`} className="mt-4 inline-flex h-11 items-center rounded-xl bg-[var(--fa)] px-5 font-bold text-[var(--fa-fg)]">
                    Iniciar sesión
                  </Link>
                </>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void unlock();
                  }}
                >
                  <label htmlFor="form-pw" className="font-bold">
                    Este formulario tiene contraseña
                  </label>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input
                      id="form-pw"
                      type="password"
                      autoComplete="off"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      aria-invalid={Boolean(pwError) || undefined}
                      aria-describedby={pwError ? "form-pw-err" : undefined}
                      className="h-11 w-full min-w-0 rounded-xl border sm:flex-1 border-line-strong/60 bg-surface px-3.5 outline-none focus:border-[var(--fa)]"
                    />
                    <button type="submit" disabled={!password || checking} className="h-11 rounded-xl bg-[var(--fa)] px-5 font-bold text-[var(--fa-fg)] disabled:opacity-60">
                      {checking ? "Verificando…" : "Entrar"}
                    </button>
                  </div>
                  {pwError && (
                    <p id="form-pw-err" role="alert" className="mt-2 text-sm text-danger">
                      {pwError}
                    </p>
                  )}
                </form>
              )}
            </div>
          </>
        ) : (
          <>
            <FormCover design={design} title={envelope.title} description={envelope.description} />
            <FormRenderer form={envelope} mode="live" transport={transport} params={prefill} />
          </>
        )}
        {!embed && <p className="pt-4 text-center text-xs text-subtle">Formulario hecho con Vetta</p>}
      </main>
    </div>
  );
}
