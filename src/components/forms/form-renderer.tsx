"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import {
  checkAnswer,
  initialValue,
  isInput,
  isVisible,
  pagesOf,
  MAX_FILE_BYTES,
  MAX_FILES_PER_QUESTION,
  type AnswerValue,
  type Answers,
  type FileAnswer,
  type FormDesign,
  type InputSpec,
  type Question,
} from "@/lib/form-logic";

export type PublicForm = {
  slug: string;
  title: string;
  description: string | null;
  design: FormDesign;
  questions: Question[];
  specs: Record<string, InputSpec>;
  after: { allowAnother: boolean; tracking: boolean; showSummary: boolean };
  open: boolean;
  closedReason: string | null;
};

export type SubmitResult = {
  tracking: string | null;
  message: string | null;
  redirectUrl?: string | null;
  summary: { label: string; text: string }[];
};

export type FormTransport = {
  /** Sube un archivo y devuelve la referencia para la respuesta. */
  upload: (questionId: string, file: File) => Promise<FileAnswer>;
  submit: (answers: Answers, meta: { startedAt: number; website: string }) => Promise<{ ok: true; data: SubmitResult } | { ok: false; error: string; errors?: Record<string, string> }>;
};

/** Estilos del formulario según su color (los colores de etiquetas de Vetta). */
export function FormCover({ design, title, description }: { design: FormDesign; title: string; description?: string | null }) {
  return (
    <header className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      {design.cover !== "none" && (
        <div
          aria-hidden
          className="h-24 sm:h-32"
          style={{
            background:
              design.cover === "solid"
                ? "var(--fa)"
                : "radial-gradient(120% 140% at 0% 0%, var(--fa-dot) 0%, transparent 55%), radial-gradient(120% 140% at 100% 100%, var(--fa) 0%, transparent 60%), var(--fa-soft)",
          }}
        />
      )}
      <div className={cn("px-5 pb-5 sm:px-7", design.cover !== "none" ? "pt-4" : "pt-6")}>
        {design.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={design.logoUrl} alt="" className={cn("mb-3 max-h-14 max-w-48 object-contain", design.cover !== "none" && "-mt-12 rounded-xl border-4 border-surface bg-surface p-1")} />
        )}
        <h1 className="text-2xl font-extrabold tracking-tight text-balance sm:text-3xl">{title}</h1>
        {description && <p className="mt-2 whitespace-pre-wrap text-[15px] text-muted">{description}</p>}
      </div>
    </header>
  );
}

const draftKey = (slug: string) => `vetta-form:${slug}`;
const NO_PARAMS: Record<string, string> = {};
const meaningful = (v: unknown) => v !== undefined && v !== null && v !== "" && v !== false && !(Array.isArray(v) && v.length === 0);

export function FormRenderer({
  form,
  mode,
  transport,
  params = {},
  onReset,
}: {
  form: PublicForm;
  mode: "live" | "preview";
  transport?: FormTransport;
  /** Parámetros del enlace para precompletar (?param=valor). */
  params?: Record<string, string>;
  onReset?: () => void;
}) {
  const uid = useId();
  const startedAt = useRef(0);
  const topRef = useRef<HTMLDivElement>(null);
  const initial = useMemo(() => {
    const a: Answers = {};
    for (const q of form.questions) {
      if (!isInput(q) || !form.specs[q.id]) continue;
      const v = initialValue(q, form.specs[q.id], params);
      if (v !== undefined) a[q.id] = v;
    }
    return a;
  }, [form, params]);
  const [answers, setAnswers] = useState<Answers>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [focusIdx, setFocusIdx] = useState(0);
  const [restored, setRestored] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<SubmitResult | null>(null);
  const [website, setWebsite] = useState("");

  // En la vista previa, las respuestas se reinician cuando cambian las preguntas.
  const initialKey = JSON.stringify(initial);
  const [prevInitial, setPrevInitial] = useState(initialKey);
  if (mode === "preview" && prevInitial !== initialKey) {
    setPrevInitial(initialKey);
    setAnswers((a) => ({ ...initial, ...a }));
  }

  // Borrador: se recupera al volver y se guarda en cada cambio (solo en el formulario real).
  useEffect(() => {
    startedAt.current = Date.now();
    if (mode !== "live") return;
    try {
      const raw = localStorage.getItem(draftKey(form.slug));
      if (!raw) return;
      const d = JSON.parse(raw) as { answers: Answers; savedAt: number };
      if (Date.now() - d.savedAt > 14 * 86400000) return;
      if (!Object.values(d.answers ?? {}).some(meaningful)) return;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAnswers((a) => ({ ...a, ...d.answers }));
      setRestored(true);
    } catch {
      // sin borrador
    }
  }, [form.slug, mode]);

  useEffect(() => {
    if (mode !== "live" || done) return;
    try {
      const clean = Object.fromEntries(Object.entries(answers).filter(([k]) => form.specs[k]?.type !== "files"));
      // Sin respuestas propias no hay borrador que guardar.
      if (!Object.entries(clean).some(([k, v]) => meaningful(v) && JSON.stringify(v) !== JSON.stringify(initial[k]))) return;
      localStorage.setItem(draftKey(form.slug), JSON.stringify({ answers: clean, savedAt: Date.now() }));
    } catch {
      // almacenamiento no disponible
    }
  }, [answers, form, mode, done, initial]);

  const visible = (q: Question) => (isInput(q) ? Boolean(form.specs[q.id]) && isVisible(q, answers, form.questions) : !q.hidden && isVisible(q, answers, form.questions));
  const pages = useMemo(() => pagesOf(form.questions), [form.questions]);
  const focus = form.design.layout === "focus";
  const focusList = form.questions.filter((q) => q.kind !== "page" && visible(q));
  const current: Question[] = focus ? (focusList[focusIdx] ? [focusList[focusIdx]] : []) : (pages[page] ?? []).filter(visible);
  const isLast = focus ? focusIdx >= focusList.length - 1 : page >= pages.length - 1;
  const steps = focus ? focusList.length : pages.length;
  const stepIdx = focus ? focusIdx : page;

  const set = (id: string, v: AnswerValue | undefined) => {
    setAnswers((a) => ({ ...a, [id]: v }));
    setErrors((e) => {
      if (!e[id]) return e;
      const next = { ...e };
      delete next[id];
      return next;
    });
  };

  const validate = (qs: Question[]) => {
    const errs: Record<string, string> = {};
    for (const q of qs) {
      if (!isInput(q) || !form.specs[q.id]) continue;
      const r = checkAnswer(q, form.specs[q.id], answers[q.id]);
      if (!r.ok) errs[q.id] = r.error;
    }
    setErrors((e) => ({ ...e, ...errs }));
    const first = Object.keys(errs)[0];
    if (first) document.getElementById(`${uid}-${first}`)?.focus();
    return !first;
  };

  const go = (dir: 1 | -1) => {
    if (dir === 1 && !validate(current)) return;
    if (focus) setFocusIdx((i) => Math.max(0, Math.min(focusList.length - 1, i + dir)));
    else {
      // Saltea páginas que quedaron vacías por las condiciones.
      let p = page + dir;
      while (p > 0 && p < pages.length - 1 && !(pages[p] ?? []).some(visible)) p += dir;
      setPage(Math.max(0, Math.min(pages.length - 1, p)));
    }
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const submit = async () => {
    setFormError(null);
    const all = form.questions.filter((q) => q.kind !== "page" && visible(q));
    if (!validate(all)) {
      // Lleva a la primera página / pregunta con error.
      const firstBad = all.find((q) => isInput(q) && form.specs[q.id] && !checkAnswer(q, form.specs[q.id], answers[q.id]).ok);
      if (firstBad) {
        if (focus) setFocusIdx(focusList.findIndex((q) => q.id === firstBad.id));
        else setPage(pages.findIndex((p) => p.some((q) => q.id === firstBad.id)));
      }
      return;
    }
    if (mode === "preview" || !transport) {
      setDone({ tracking: null, message: "Así se vería la confirmación. (Vista previa: no se creó nada.)", summary: [] });
      return;
    }
    setSending(true);
    const res = await transport.submit(answers, { startedAt: startedAt.current, website });
    setSending(false);
    if (!res.ok) {
      setFormError(res.error);
      if (res.errors) {
        setErrors(res.errors);
        const firstBad = form.questions.find((q) => res.errors?.[q.id]);
        if (firstBad && !focus) setPage(Math.max(0, pages.findIndex((p) => p.some((q) => q.id === firstBad.id))));
      }
      return;
    }
    try {
      localStorage.removeItem(draftKey(form.slug));
    } catch {
      // nada
    }
    setDone(res.data);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (res.data.redirectUrl) setTimeout(() => window.location.assign(res.data.redirectUrl!), 4000);
  };

  const restart = () => {
    setAnswers(initial);
    setErrors({});
    setPage(0);
    setFocusIdx(0);
    setDone(null);
    setRestored(false);
    startedAt.current = Date.now();
    try {
      localStorage.removeItem(draftKey(form.slug));
    } catch {
      // nada
    }
    onReset?.();
  };

  if (done) return <Done result={done} form={form} onAnother={form.after.allowAnother ? restart : undefined} />;

  if (!form.open) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-6 text-center shadow-card">
        <p className="text-lg font-bold">Formulario cerrado</p>
        <p className="mt-1 text-muted">{form.closedReason ?? "Este formulario no está recibiendo respuestas."}</p>
      </div>
    );
  }

  return (
    <div ref={topRef} className="scroll-mt-4 space-y-4">
      {restored && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm">
          <span>Recuperamos lo que habías completado.</span>
          <button type="button" onClick={restart} className="font-semibold text-[var(--fa)] hover:underline">
            Empezar de nuevo
          </button>
        </div>
      )}
      {steps > 1 && (
        <div className="flex items-center gap-3" aria-label={`Paso ${stepIdx + 1} de ${steps}`}>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-[var(--fa)] transition-[width] duration-300" style={{ width: `${((stepIdx + 1) / steps) * 100}%` }} />
          </div>
          <span className="text-xs tabular-nums text-muted">
            {stepIdx + 1} / {steps}
          </span>
        </div>
      )}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (isLast) void submit();
          else go(1);
        }}
        className="space-y-4"
        onKeyDown={(e) => {
          // En el modo "una pregunta por pantalla", Enter avanza (salvo en textos largos).
          if (focus && e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) {
            e.preventDefault();
            if (isLast) void submit();
            else go(1);
          }
        }}
      >
        {/* Campo trampa para robots (invisible para personas). */}
        <div aria-hidden className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
          <label>
            No completar
            <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} name="website" />
          </label>
        </div>

        {current.map((q) =>
          q.kind === "text" ? (
            <div key={q.id} className={cn("rounded-2xl border border-line bg-surface px-5 py-4 shadow-card sm:px-7", focus && "py-8")}>
              {q.label && <h2 className="text-lg font-bold">{q.label}</h2>}
              {q.help && <p className="mt-1 whitespace-pre-wrap text-[15px] text-muted">{q.help}</p>}
            </div>
          ) : (
            <QuestionCard
              key={q.id}
              id={`${uid}-${q.id}`}
              q={q}
              spec={form.specs[q.id]}
              value={answers[q.id]}
              error={errors[q.id]}
              big={focus}
              onChange={(v) => set(q.id, v)}
              uploading={(n) => setUploading((u) => u + n)}
              upload={mode === "live" && transport ? (file) => transport.upload(q.id, file) : undefined}
            />
          ),
        )}

        {formError && (
          <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
            {formError}
          </p>
        )}

        <div className="flex items-center justify-between gap-3 pt-1">
          {stepIdx > 0 ? (
            <button type="button" onClick={() => go(-1)} className="h-11 rounded-xl px-4 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-fg">
              ← Atrás
            </button>
          ) : (
            <span />
          )}
          <button
            type="submit"
            disabled={sending || uploading > 0}
            className="h-11 min-w-32 rounded-xl bg-[var(--fa)] px-6 text-[15px] font-bold text-[var(--fa-fg)] shadow-card transition hover:brightness-110 disabled:opacity-60"
          >
            {sending ? "Enviando…" : uploading > 0 ? "Subiendo archivos…" : isLast ? form.design.submitLabel || "Enviar" : "Siguiente →"}
          </button>
        </div>
        {focus && !isLast && <p className="text-center text-xs text-subtle">También podés apretar Enter para seguir.</p>}
      </form>
    </div>
  );
}

function Done({ result, form, onAnother }: { result: SubmitResult; form: PublicForm; onAnother?: () => void }) {
  const [copied, setCopied] = useState(false);
  const trackUrl = result.tracking && typeof window !== "undefined" ? `${window.location.origin}/seguimiento/${result.tracking}` : null;
  return (
    <div className="space-y-4" role="status">
      <div className="rounded-2xl border border-line bg-surface px-6 py-8 text-center shadow-card">
        <span aria-hidden className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--fa-soft)] text-2xl text-[var(--fa)]">
          ✓
        </span>
        <p className="text-xl font-extrabold">{result.message || "¡Gracias! Recibimos tu respuesta."}</p>
        {result.redirectUrl && <p className="mt-2 text-sm text-muted">Te llevamos a la página siguiente en unos segundos…</p>}
      </div>
      {trackUrl && (
        <div className="rounded-2xl border border-line bg-surface px-5 py-4 shadow-card">
          <p className="font-bold">Seguí tu pedido</p>
          <p className="mt-0.5 text-sm text-muted">Guardá este enlace: muestra en qué estado está y se actualiza solo.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input readOnly value={trackUrl} aria-label="Enlace de seguimiento" className="h-10 w-full min-w-0 rounded-lg sm:flex-1 border border-line bg-surface-2 px-3 text-sm" onFocus={(e) => e.target.select()} />
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(trackUrl);
                setCopied(true);
              }}
              className="h-10 rounded-lg bg-[var(--fa)] px-4 text-sm font-semibold text-[var(--fa-fg)]"
            >
              {copied ? "¡Copiado!" : "Copiar enlace"}
            </button>
            <a href={trackUrl} className="flex h-10 items-center justify-center rounded-lg border border-line px-4 text-sm font-semibold hover:bg-surface-2">
              Ver estado
            </a>
          </div>
        </div>
      )}
      {result.summary.length > 0 && (
        <details className="rounded-2xl border border-line bg-surface px-5 py-4 shadow-card">
          <summary className="cursor-pointer font-bold">Lo que enviaste</summary>
          <dl className="mt-3 space-y-2 text-sm">
            {result.summary.map((s, i) => (
              <div key={i}>
                <dt className="text-muted">{s.label}</dt>
                <dd className="whitespace-pre-wrap font-medium">{s.text || "—"}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {onAnother && (
        <p className="text-center">
          <button type="button" onClick={onAnother} className="text-sm font-semibold text-[var(--fa)] hover:underline">
            Enviar otra respuesta
          </button>
        </p>
      )}
      <span className="sr-only">{form.title}</span>
    </div>
  );
}

/* ----------------------------------------------------------------- preguntas */

function QuestionCard({
  id,
  q,
  spec,
  value,
  error,
  big,
  onChange,
  upload,
  uploading,
}: {
  id: string;
  q: Question;
  spec: InputSpec;
  value: AnswerValue | undefined;
  error?: string;
  big?: boolean;
  onChange: (v: AnswerValue | undefined) => void;
  upload?: (file: File) => Promise<FileAnswer>;
  uploading: (delta: number) => void;
}) {
  const helpId = `${id}-help`;
  const errId = `${id}-err`;
  const describedBy = [q.help ? helpId : "", error ? errId : ""].filter(Boolean).join(" ") || undefined;
  const group = ["choice", "multi", "rating", "yesno", "daterange", "files"].includes(spec.type);
  const labelId = `${id}-label`;
  const Label = group ? "p" : "label";
  const body = (
    <>
      <Label id={labelId} {...(group ? {} : { htmlFor: id })} className={cn("block font-bold", big ? "text-xl" : "text-[15px]")}>
        {q.label}
        {q.required && (
          <span className="ml-1 text-[var(--fa)]" aria-hidden>
            *
          </span>
        )}
        {q.required && <span className="sr-only"> (obligatoria)</span>}
      </Label>
      {q.help && (
        <p id={helpId} className="mt-0.5 whitespace-pre-wrap text-sm text-muted">
          {q.help}
        </p>
      )}
      <div className="mt-3">
        <Input id={id} q={q} spec={spec} value={value} onChange={onChange} describedBy={describedBy} invalid={Boolean(error)} upload={upload} uploading={uploading} />
      </div>
      {error && (
        <p id={errId} role="alert" className="mt-2 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </>
  );
  const cls = cn("rounded-2xl border bg-surface px-5 py-4 shadow-card sm:px-7", error ? "border-danger/50" : "border-line", big && "py-8");
  // Grupos de opciones: role="group" con su título (evita el diseño especial de <legend>).
  return group ? (
    <div role="group" aria-labelledby={labelId} aria-describedby={describedBy} className={cls}>
      {body}
    </div>
  ) : (
    <div className={cls}>{body}</div>
  );
}

const inputCls = (invalid: boolean) =>
  cn(
    "w-full rounded-xl border bg-surface px-3.5 text-[15px] outline-none transition focus:border-[var(--fa)] focus:ring-2 focus:ring-[var(--fa-soft)]",
    invalid ? "border-danger" : "border-line-strong/60",
  );

function Input({
  id,
  q,
  spec,
  value,
  onChange,
  describedBy,
  invalid,
  upload,
  uploading,
}: {
  id: string;
  q: Question;
  spec: InputSpec;
  value: AnswerValue | undefined;
  onChange: (v: AnswerValue | undefined) => void;
  describedBy?: string;
  invalid: boolean;
  upload?: (file: File) => Promise<FileAnswer>;
  uploading: (delta: number) => void;
}) {
  const common = { id, "aria-describedby": describedBy, "aria-invalid": invalid || undefined, "aria-required": q.required || undefined };
  const str = typeof value === "string" || typeof value === "number" ? String(value) : "";
  switch (spec.type) {
    case "long":
      return <textarea {...common} rows={4} value={str} placeholder={q.placeholder} maxLength={q.max ?? 5000} onChange={(e) => onChange(e.target.value)} className={cn(inputCls(invalid), "py-2.5")} />;
    case "number":
      return <input {...common} type="number" inputMode="decimal" value={str} placeholder={q.placeholder} min={q.min} max={q.max} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} className={cn(inputCls(invalid), "h-11 max-w-60")} />;
    case "date":
      return <input {...common} type="date" value={str} onChange={(e) => onChange(e.target.value || undefined)} className={cn(inputCls(invalid), "h-11 max-w-60")} />;
    case "hour":
      return <input {...common} type="time" value={str} onChange={(e) => onChange(e.target.value || undefined)} className={cn(inputCls(invalid), "h-11 max-w-40")} />;
    case "daterange": {
      const [a = "", b = ""] = str.split("/");
      const upd = (x: string, y: string) => onChange(x || y ? `${x}/${y}` : undefined);
      return (
        <div className="flex flex-wrap items-center gap-2" aria-describedby={describedBy}>
          <input id={id} aria-label="Desde" type="date" value={a} onChange={(e) => upd(e.target.value, b)} className={cn(inputCls(invalid), "h-11 max-w-48")} />
          <span className="text-muted">a</span>
          <input aria-label="Hasta" type="date" value={b} min={a || undefined} onChange={(e) => upd(a, e.target.value)} className={cn(inputCls(invalid), "h-11 max-w-48")} />
        </div>
      );
    }
    case "choice": {
      const opts = spec.options ?? [];
      if (opts.length > 7)
        return (
          <select {...common} value={str} onChange={(e) => onChange(e.target.value || undefined)} className={cn(inputCls(invalid), "h-11")}>
            <option value="">Elegí una opción…</option>
            {opts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
      return (
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-describedby={describedBy}>
          {opts.map((o, i) => (
            <label key={o.value} className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2 text-[15px] transition", str === o.value ? "border-[var(--fa)] bg-[var(--fa-soft)] font-semibold" : "border-line hover:border-line-strong")}>
              <input id={i === 0 ? id : undefined} type="radio" name={id} checked={str === o.value} onChange={() => onChange(o.value)} className="h-4 w-4 accent-[var(--fa)]" />
              {o.color && <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: `var(--chip-${o.color}-dot)` }} />}
              <span className="min-w-0 flex-1">{o.label}</span>
            </label>
          ))}
          {!q.required && str && (
            <button type="button" onClick={() => onChange(undefined)} className="justify-self-start text-xs font-semibold text-muted hover:underline">
              Borrar selección
            </button>
          )}
        </div>
      );
    }
    case "multi": {
      const list = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-2" aria-describedby={describedBy}>
          {(spec.options ?? []).map((o, i) => {
            const on = list.includes(o.value);
            return (
              <label key={o.value} className={cn("flex min-h-10 cursor-pointer items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition", on ? "border-[var(--fa)] bg-[var(--fa-soft)] font-semibold" : "border-line hover:border-line-strong")}>
                <input id={i === 0 ? id : undefined} type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked ? [...list, o.value] : list.filter((x) => x !== o.value))} className="h-4 w-4 accent-[var(--fa)]" />
                {o.color && <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: `var(--chip-${o.color}-dot)` }} />}
                {o.label}
              </label>
            );
          })}
        </div>
      );
    }
    case "checkbox":
      return (
        <label className="flex cursor-pointer items-start gap-3 text-[15px]">
          <input {...common} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[var(--fa)]" />
          <span>{q.placeholder || "Sí, acepto"}</span>
        </label>
      );
    case "yesno":
      return (
        <div className="flex gap-2" role="radiogroup" aria-describedby={describedBy}>
          {[
            [true, "Sí"],
            [false, "No"],
          ].map(([v, l], i) => (
            <label key={String(v)} className={cn("flex h-11 min-w-24 cursor-pointer items-center justify-center gap-2 rounded-xl border px-4 text-[15px] font-semibold transition", value === v ? "border-[var(--fa)] bg-[var(--fa-soft)]" : "border-line hover:border-line-strong")}>
              <input id={i === 0 ? id : undefined} type="radio" name={id} className="sr-only" checked={value === v} onChange={() => onChange(v as boolean)} />
              {l as string}
            </label>
          ))}
        </div>
      );
    case "rating": {
      const max = spec.max ?? 5;
      const n = typeof value === "number" ? value : 0;
      return (
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-describedby={describedBy}>
          {Array.from({ length: max }, (_, i) => i + 1).map((k) => (
            <label key={k} className="cursor-pointer" title={`${k} de ${max}`}>
              <input id={k === 1 ? id : undefined} type="radio" name={id} className="peer sr-only" checked={n === k} onChange={() => onChange(k)} />
              <span aria-hidden className={cn("block text-3xl leading-none transition peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--fa)]", k <= n ? "text-[var(--fa)]" : "text-line-strong hover:text-[var(--fa-dot)]")}>
                ★
              </span>
              <span className="sr-only">{`${k} de ${max}`}</span>
            </label>
          ))}
        </div>
      );
    }
    case "files":
      return <FilesInput id={id} value={Array.isArray(value) ? (value as FileAnswer[]) : []} onChange={onChange} upload={upload} uploading={uploading} describedBy={describedBy} />;
    default: {
      const type = spec.type === "email" ? "email" : spec.type === "phone" ? "tel" : spec.type === "url" ? "url" : "text";
      const auto = spec.type === "email" ? "email" : spec.type === "phone" ? "tel" : spec.type === "url" ? "url" : undefined;
      return <input {...common} type={type} autoComplete={auto} inputMode={spec.type === "phone" ? "tel" : undefined} value={str} placeholder={q.placeholder} maxLength={q.max ?? 500} onChange={(e) => onChange(e.target.value)} className={cn(inputCls(invalid), "h-11")} />;
    }
  }
}

function FilesInput({
  id,
  value,
  onChange,
  upload,
  uploading,
  describedBy,
}: {
  id: string;
  value: FileAnswer[];
  onChange: (v: AnswerValue | undefined) => void;
  upload?: (file: File) => Promise<FileAnswer>;
  uploading: (delta: number) => void;
  describedBy?: string;
}) {
  const [busy, setBusy] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);

  const add = async (files: FileList | File[]) => {
    setErr(null);
    const list = [...files].slice(0, Math.max(0, MAX_FILES_PER_QUESTION - value.length));
    for (const file of list) {
      if (file.size > MAX_FILE_BYTES) {
        setErr(`«${file.name}» supera los 25 MB.`);
        continue;
      }
      if (!upload) {
        // Vista previa: no se sube nada.
        latest.current = [...latest.current, { upload: crypto.randomUUID(), name: file.name, size: file.size, type: file.type }];
        onChange(latest.current);
        continue;
      }
      setBusy((b) => [...b, file.name]);
      uploading(1);
      try {
        const ref = await upload(file);
        latest.current = [...latest.current, ref];
        onChange(latest.current);
      } catch (e) {
        setErr(e instanceof Error ? e.message : `No se pudo subir «${file.name}».`);
      } finally {
        setBusy((b) => b.filter((x) => x !== file.name));
        uploading(-1);
      }
    }
  };

  return (
    <div aria-describedby={describedBy}>
      <label
        htmlFor={id}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void add(e.dataTransfer.files);
        }}
        className={cn("flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm transition", over ? "border-[var(--fa)] bg-[var(--fa-soft)]" : "border-line hover:border-line-strong")}
      >
        <span className="font-semibold text-[var(--fa)]">Elegí archivos o arrastralos acá</span>
        <span className="text-xs text-muted">Hasta {MAX_FILES_PER_QUESTION} archivos de 25 MB</span>
        <input id={id} type="file" multiple className="sr-only" onChange={(e) => e.target.files && void add(e.target.files)} />
      </label>
      {(value.length > 0 || busy.length > 0) && (
        <ul className="mt-2 space-y-1 text-sm">
          {value.map((f) => (
            <li key={f.upload} className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="text-xs text-muted">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
              <button type="button" aria-label={`Quitar ${f.name}`} onClick={() => onChange(value.filter((x) => x.upload !== f.upload))} className="text-muted hover:text-danger">
                ✕
              </button>
            </li>
          ))}
          {busy.map((n) => (
            <li key={n} className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-1.5 text-muted">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
              Subiendo {n}…
            </li>
          ))}
        </ul>
      )}
      {err && (
        <p role="alert" className="mt-1 text-sm text-danger">
          {err}
        </p>
      )}
    </div>
  );
}
