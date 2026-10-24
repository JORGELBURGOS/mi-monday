import type { Metadata } from "next";
import { callForms } from "@/lib/forms-api";
import { cn } from "@/lib/cn";
import type { FormDesign } from "@/lib/form-logic";
import { FormCover, formTheme } from "@/components/forms/form-renderer";

export const metadata: Metadata = { title: "Seguimiento de tu pedido", robots: { index: false, follow: false } };

type Tracking = {
  found: boolean;
  deleted: boolean;
  form: string;
  design: FormDesign;
  title?: string;
  created_at: string;
  updated_at?: string;
  status?: { label: string; color: string | null; done: boolean } | null;
  timeline?: { at: string; to: string | null; color: string | null; done: boolean }[];
};

const fmt = (iso: string) => new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "medium", timeStyle: "short" });

/**
 * Página de seguimiento: quien envió un formulario ve en qué estado está su
 * pedido (sin cuenta, con el enlace secreto que recibió al enviarlo).
 */
export default async function TrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const res = await callForms<Tracking>({ action: "track", token });
  const t = res.ok ? res.data : null;
  const design: FormDesign = t?.design ?? { accent: "blue", cover: "none", layout: "classic", theme: "auto" };

  return (
    <div style={formTheme(design)} className="min-h-dvh bg-bg px-4 py-8 sm:py-12">
      <main className="mx-auto w-full max-w-2xl space-y-4">
        {!t ? (
          <div className="rounded-2xl border border-line bg-surface p-8 text-center shadow-card">
            <p className="text-lg font-bold">No encontramos ese pedido</p>
            <p className="mt-1 text-muted">Revisá que el enlace esté completo.</p>
          </div>
        ) : (
          <>
            <FormCover design={design} title={t.form} />
            <section className="rounded-2xl border border-line bg-surface px-5 py-5 shadow-card sm:px-7" aria-labelledby="track-title">
              <p className="text-xs font-semibold uppercase tracking-wide text-subtle">Tu pedido</p>
              {t.deleted ? (
                <p className="mt-2 text-muted">Este pedido ya no está disponible.</p>
              ) : (
                <>
                  <h2 id="track-title" className="mt-1 text-xl font-extrabold">
                    {t.title}
                  </h2>
                  <p className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted">Estado actual:</span>
                    <span
                      className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold", t.status ? `solid-${t.status.color ?? "gray"}` : "bg-surface-3")}
                    >
                      {t.status?.done && <span aria-hidden>✓</span>}
                      {t.status?.label ?? "Recibido"}
                    </span>
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    Enviado el {fmt(t.created_at)}
                    {t.updated_at && ` · última novedad ${fmt(t.updated_at)}`}
                  </p>
                </>
              )}
            </section>
            {!t.deleted && (
              <section className="rounded-2xl border border-line bg-surface px-5 py-5 shadow-card sm:px-7" aria-labelledby="track-steps">
                <h2 id="track-steps" className="font-bold">
                  Recorrido
                </h2>
                <ol className="mt-3 space-y-3 border-l-2 border-line pl-4">
                  <li className="relative text-sm">
                    <span aria-hidden className="absolute -left-[23px] top-1 h-3 w-3 rounded-full border-2 border-surface bg-[var(--fa)]" />
                    <span className="font-semibold">Recibimos tu pedido</span>
                    <span className="block text-xs text-muted">{fmt(t.created_at)}</span>
                  </li>
                  {(t.timeline ?? []).map((s, i) => (
                    <li key={i} className="relative text-sm">
                      <span aria-hidden className="absolute -left-[23px] top-1 h-3 w-3 rounded-full border-2 border-surface" style={{ background: `var(--chip-${s.color ?? "gray"}-dot)` }} />
                      <span className="font-semibold">
                        {s.done ? "Terminado: " : "Pasó a "}
                        {s.to ?? "sin estado"}
                      </span>
                      <span className="block text-xs text-muted">{fmt(s.at)}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )}
        <p className="pt-4 text-center text-xs text-subtle">Seguimiento con Vetta · esta página se actualiza cada vez que la abrís</p>
      </main>
    </div>
  );
}
