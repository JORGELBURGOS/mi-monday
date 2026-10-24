"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState, useTransition } from "react";
import QRCode from "qrcode";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Menu } from "@/components/ui/menu";
import { IconDots } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { COLOR_NAMES, COLOR_LABELS, PRIORITIES } from "@/lib/constants";
import { formatDateTime, relativeTime } from "@/lib/format";
import { previewSpecs, type BoardForForm } from "@/lib/forms";
import { isInput, type FormConfig } from "@/lib/form-logic";
import { deleteFormAction, duplicateFormAction, saveFormAction, setFormPasswordAction, setFormPublishedAction } from "@/app/actions/forms";
import { FormCover, FormRenderer, formTheme } from "./form-renderer";
import { QuestionsEditor } from "./question-editor";

/** Hora actual (fuera del render para la regla de pureza). */
function nowMs() {
  return Date.now();
}

export type Submission = {
  id: string;
  task_id: string | null;
  by: string | null;
  answers: Record<string, { label: string; text: string }>;
  duration_ms: number | null;
  created_at: string;
};

type FormInfo = {
  id: string;
  slug: string;
  name: string;
  is_published: boolean;
  access: "public" | "members" | "password";
  opens_at: string | null;
  closes_at: string | null;
  max_responses: number | null;
  hasPassword: boolean;
  config: FormConfig;
};

const TABS = [
  ["questions", "Preguntas"],
  ["design", "Diseño"],
  ["access", "Acceso"],
  ["after", "Al enviar"],
  ["share", "Compartir"],
  ["responses", "Respuestas"],
] as const;
type Tab = (typeof TABS)[number][0];

/** ISO → valor de <input type="datetime-local"> en hora local. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

export function FormBuilder({
  board,
  form,
  data,
  submissions,
  canManage,
}: {
  board: { id: string; name: string };
  form: FormInfo;
  data: BoardForForm;
  submissions: Submission[];
  canManage: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const uid = useId();
  const [tab, setTab] = useState<Tab>(canManage ? "questions" : "responses");
  const [config, setConfigState] = useState<FormConfig>(form.config);
  const [name, setName] = useState(form.name);
  const [access, setAccess] = useState(form.access);
  const [opensAt, setOpensAt] = useState(toLocalInput(form.opens_at));
  const [closesAt, setClosesAt] = useState(toLocalInput(form.closes_at));
  const [maxResponses, setMaxResponses] = useState(form.max_responses ? String(form.max_responses) : "");
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [origin, setOrigin] = useState("https://vettaapp.vercel.app");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const setConfig = (fn: (c: FormConfig) => FormConfig) => {
    setConfigState(fn);
    setDirty(true);
  };
  const touch = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setDirty(true);
  };

  const specs = useMemo(() => previewSpecs(config, data, access), [config, data, access]);
  const url = `${origin}/f/${form.slug}`;
  const disabled = !canManage;

  const save = (after?: () => void) =>
    start(async () => {
      const res = await saveFormAction(form.id, {
        config,
        settings: { name, access, opens_at: fromLocalInput(opensAt), closes_at: fromLocalInput(closesAt), max_responses: maxResponses ? Number(maxResponses) : null },
      });
      if (!res.ok) return toast.error(res.error);
      setDirty(false);
      toast.success(res.message ?? "Guardado.");
      after?.();
    });

  const publish = (on: boolean) => {
    const run = () =>
      start(async () => {
        const res = await setFormPublishedAction(form.id, on);
        if (!res.ok) return toast.error(res.error);
        toast.success(res.message ?? "Listo.");
      });
    if (dirty) save(run);
    else run();
  };

  // Ctrl/Cmd + S guarda.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && canManage) {
        e.preventDefault();
        if (dirty && !pending) save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-8">
      <nav aria-label="Ruta" className="mb-2 text-sm text-muted">
        <Link href={`/t/${board.id}`} className="hover:text-fg hover:underline">
          {board.name}
        </Link>
        <span aria-hidden> / </span>
        <Link href={`/t/${board.id}/formularios`} className="hover:text-fg hover:underline">
          Formularios
        </Link>
      </nav>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          aria-label="Nombre del formulario"
          value={name}
          disabled={disabled}
          maxLength={120}
          onChange={(e) => touch(setName)(e.target.value)}
          className="min-w-0 flex-1 rounded-lg bg-transparent px-1 text-2xl font-extrabold tracking-tight outline-none hover:bg-surface-2 focus:bg-surface-2"
        />
        <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", form.is_published ? "bg-success-soft text-success" : "bg-surface-3 text-muted")}>
          {form.is_published ? "Publicado" : "Borrador"}
        </span>
        {form.is_published && (
          <a href={url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-accent hover:underline">
            Abrir ↗
          </a>
        )}
        {canManage && (
          <>
            <Button size="sm" variant={dirty ? "primary" : "secondary"} onClick={() => save()} disabled={!dirty || pending}>
              {pending ? "Guardando…" : dirty ? "Guardar" : "Guardado"}
            </Button>
            <Button size="sm" variant={form.is_published ? "secondary" : "primary"} onClick={() => publish(!form.is_published)} disabled={pending}>
              {form.is_published ? "Despublicar" : "Publicar"}
            </Button>
            <Menu
              label="Más opciones"
              trigger={<IconDots size={16} />}
              triggerClassName="h-8 w-8 rounded-lg border border-line text-muted hover:bg-surface-2"
              items={[
                {
                  label: "Duplicar",
                  onSelect: () =>
                    start(async () => {
                      const res = await duplicateFormAction(form.id);
                      if (!res.ok) return toast.error(res.error);
                      router.push(`/t/${board.id}/formularios/${res.data.id}`);
                    }),
                },
                { type: "separator" },
                { label: "Eliminar formulario", danger: true, onSelect: () => setConfirmDelete(true) },
              ]}
            />
          </>
        )}
      </div>

      <div role="tablist" aria-label="Secciones del formulario" className="mb-5 flex gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1">
        {TABS.filter(([k]) => canManage || k === "responses" || k === "share").map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn("h-9 shrink-0 rounded-lg px-4 text-sm font-semibold", tab === k ? "bg-surface text-fg shadow-card" : "text-muted hover:text-fg")}
          >
            {label}
            {k === "responses" && <span className="ml-1.5 text-xs font-normal opacity-70">{submissions.length}</span>}
          </button>
        ))}
      </div>

      {tab === "questions" && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="space-y-4">
            <div className="space-y-2 rounded-xl border border-line bg-surface p-3">
              <label className="block text-xs font-semibold text-muted">
                Título que ve la persona
                <input className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-base font-bold outline-none focus:border-accent" value={config.title} maxLength={200} disabled={disabled} onChange={(e) => setConfig((c) => ({ ...c, title: e.target.value }))} />
              </label>
              <label className="block text-xs font-semibold text-muted">
                Introducción
                <textarea className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" rows={2} maxLength={5000} disabled={disabled} value={config.description ?? ""} onChange={(e) => setConfig((c) => ({ ...c, description: e.target.value }))} />
              </label>
            </div>
            <QuestionsEditor config={config} setConfig={setConfig} board={data} specs={specs} access={access} disabled={disabled} />
            {!config.questions.some((q) => q.kind === "field" && q.target === "title") && (
              <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
                No hay una pregunta para el nombre del elemento: se arma con la plantilla de la pestaña <button type="button" className="font-semibold text-accent hover:underline" onClick={() => setTab("after")}>Al enviar</button>.
              </p>
            )}
          </div>
          <Preview config={config} specs={specs} device={device} setDevice={setDevice} />
        </div>
      )}

      {tab === "design" && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <fieldset disabled={disabled} className="space-y-5">
            <div>
              <p className="mb-2 text-sm font-semibold">Color</p>
              <div className="flex flex-wrap gap-2">
                {COLOR_NAMES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={COLOR_LABELS[c]}
                    aria-pressed={config.design.accent === c}
                    onClick={() => setConfig((x) => ({ ...x, design: { ...x.design, accent: c } }))}
                    className={cn("h-8 w-8 rounded-full border-2", config.design.accent === c ? "border-fg" : "border-transparent")}
                    style={{ background: `var(--solid-${c})` }}
                  />
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-semibold">Portada</p>
              <div className="flex gap-2">
                {(
                  [
                    ["gradient", "Degradé"],
                    ["solid", "Color lleno"],
                    ["none", "Sin portada"],
                  ] as const
                ).map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={config.design.cover === v} onClick={() => setConfig((x) => ({ ...x, design: { ...x.design, cover: v } }))} className={cn("rounded-lg border px-3 py-1.5 text-sm font-semibold", config.design.cover === v ? "border-accent bg-accent-soft text-accent" : "border-line")}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <Field id={`${uid}-logo`} label="Logo" hint="Enlace https a una imagen (opcional)">
              <Input id={`${uid}-logo`} value={config.design.logoUrl ?? ""} placeholder="https://…/logo.png" onChange={(e) => setConfig((x) => ({ ...x, design: { ...x.design, logoUrl: e.target.value } }))} />
            </Field>
            <div>
              <p className="mb-2 text-sm font-semibold">Cómo se responde</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["classic", "Por páginas", "Varias preguntas por pantalla; los saltos de página arman los pasos."],
                    ["focus", "Una pregunta por pantalla", "Una a la vez, grande y sin distracciones. Enter para avanzar."],
                  ] as const
                ).map(([v, t, h]) => (
                  <label key={v} className={cn("flex cursor-pointer gap-2 rounded-xl border p-3", (config.design.layout === v || (v === "classic" && config.design.layout === "steps")) ? "border-accent bg-accent-soft" : "border-line")}>
                    <input type="radio" name="form-layout" className="mt-0.5 accent-[var(--accent)]" checked={config.design.layout === v || (v === "classic" && config.design.layout === "steps")} onChange={() => setConfig((x) => ({ ...x, design: { ...x.design, layout: v } }))} />
                    <span>
                      <span className="block text-sm font-semibold">{t}</span>
                      <span className="block text-xs text-muted">{h}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <Field id={`${uid}-btn`} label="Texto del botón de envío">
              <Input id={`${uid}-btn`} maxLength={40} value={config.design.submitLabel ?? ""} placeholder="Enviar" onChange={(e) => setConfig((x) => ({ ...x, design: { ...x.design, submitLabel: e.target.value || undefined } }))} />
            </Field>
          </fieldset>
          <Preview config={config} specs={specs} device={device} setDevice={setDevice} />
        </div>
      )}

      {tab === "access" && (
        <fieldset disabled={disabled} className="max-w-2xl space-y-5">
          <div className="grid gap-2">
            {(
              [
                ["public", "Público", "Cualquier persona con el enlace (clientes, proveedores, candidatos…)."],
                ["members", "Solo usuarios de la empresa", "Hay que iniciar sesión. La respuesta queda a nombre de quien la envía, aunque no tenga acceso al tablero."],
                ["password", "Con contraseña", "Para compartir con un grupo puntual sin que tengan cuenta."],
              ] as const
            ).map(([v, t, h]) => (
              <label key={v} className={cn("flex cursor-pointer gap-2 rounded-xl border p-3", access === v ? "border-accent bg-accent-soft" : "border-line")}>
                <input type="radio" name="form-access" className="mt-0.5 accent-[var(--accent)]" checked={access === v} onChange={() => touch(setAccess)(v)} />
                <span>
                  <span className="block text-sm font-semibold">{t}</span>
                  <span className="block text-xs text-muted">{h}</span>
                </span>
              </label>
            ))}
          </div>
          {access === "password" && <PasswordBox formId={form.id} has={form.hasPassword} />}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id={`${uid}-open`} label="Abre" hint="Opcional">
              <Input id={`${uid}-open`} type="datetime-local" value={opensAt} onChange={(e) => touch(setOpensAt)(e.target.value)} />
            </Field>
            <Field id={`${uid}-close`} label="Cierra" hint="Opcional">
              <Input id={`${uid}-close`} type="datetime-local" value={closesAt} onChange={(e) => touch(setClosesAt)(e.target.value)} />
            </Field>
            <Field id={`${uid}-max`} label="Máximo de respuestas" hint="Opcional">
              <Input id={`${uid}-max`} type="number" min={1} value={maxResponses} onChange={(e) => touch(setMaxResponses)(e.target.value)} />
            </Field>
          </div>
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
            Protección incluida: sin captchas molestos, Vetta frena los robots (campo trampa, tiempo mínimo de respuesta y límite de envíos por conexión) y valida cada respuesta en el servidor.
          </p>
        </fieldset>
      )}

      {tab === "after" && (
        <fieldset disabled={disabled} className="grid max-w-4xl gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <h2 className="font-bold">Dónde llega cada respuesta</h2>
            <Field id={`${uid}-g`} label="Carpeta">
              <Select id={`${uid}-g`} value={config.destination.groupId ?? ""} onChange={(e) => setConfig((c) => ({ ...c, destination: { ...c.destination, groupId: e.target.value || undefined } }))}>
                <option value="">La primera ({data.groups[0]?.name ?? "—"})</option>
                {data.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id={`${uid}-s`} label="Estado inicial">
              <Select id={`${uid}-s`} value={config.destination.statusId ?? ""} onChange={(e) => setConfig((c) => ({ ...c, destination: { ...c.destination, statusId: e.target.value || undefined } }))}>
                <option value="">El primero ({data.statuses[0]?.label ?? "—"})</option>
                {data.statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id={`${uid}-a`} label="Responsable">
              <Select id={`${uid}-a`} value={config.destination.assigneeId ?? ""} onChange={(e) => setConfig((c) => ({ ...c, destination: { ...c.destination, assigneeId: e.target.value || undefined } }))}>
                <option value="">Sin asignar</option>
                {data.members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name?.trim() || m.email}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id={`${uid}-p`} label="Prioridad">
              <Select id={`${uid}-p`} value={config.destination.priority ?? ""} onChange={(e) => setConfig((c) => ({ ...c, destination: { ...c.destination, priority: e.target.value || undefined } }))}>
                <option value="">Media (la de siempre)</option>
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            {!config.questions.some((q) => q.kind === "field" && q.target === "title") && (
              <div>
                <Field id={`${uid}-tt`} label="Nombre del elemento" hint="Plantilla">
                  <Input id={`${uid}-tt`} maxLength={300} value={config.destination.titleTemplate ?? ""} placeholder={`${config.title} · {fecha}`} onChange={(e) => setConfig((c) => ({ ...c, destination: { ...c.destination, titleTemplate: e.target.value || undefined } }))} />
                </Field>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {[{ id: "fecha", label: "Fecha" }, ...config.questions.filter((q) => isInput(q) && q.label).map((q) => ({ id: q.id, label: q.label }))].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setConfig((c) => ({ ...c, destination: { ...c.destination, titleTemplate: `${c.destination.titleTemplate ?? ""}{${t.id}}`.slice(0, 300) } }))}
                      className="max-w-40 truncate rounded-full border border-line px-2 py-0.5 text-[11px] text-muted hover:border-accent hover:text-accent"
                    >
                      + {t.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="mb-1.5 text-sm font-semibold">Avisar en Vetta a</p>
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
                {data.members.map((m) => (
                  <label key={m.user_id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--accent)]"
                      checked={config.notify.includes(m.user_id)}
                      onChange={(e) => setConfig((c) => ({ ...c, notify: e.target.checked ? [...c.notify, m.user_id] : c.notify.filter((x) => x !== m.user_id) }))}
                    />
                    {m.full_name?.trim() || m.email}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-subtle">Además, el elemento nuevo dispara las reglas del tablero («cuando llega un elemento…»).</p>
            </div>
          </div>
          <div className="space-y-3">
            <h2 className="font-bold">Qué ve la persona al enviar</h2>
            <Field id={`${uid}-msg`} label="Mensaje">
              <Textarea id={`${uid}-msg`} rows={3} maxLength={3000} value={config.after.message ?? ""} onChange={(e) => setConfig((c) => ({ ...c, after: { ...c.after, message: e.target.value } }))} />
            </Field>
            <div className="space-y-2 text-sm">
              {(
                [
                  ["tracking", "Enlace de seguimiento", "Recibe un enlace para ver en qué estado está su pedido, sin cuenta."],
                  ["showSummary", "Resumen de lo que envió", "Puede revisar sus respuestas."],
                  ["allowAnother", "Botón «Enviar otra respuesta»", ""],
                ] as const
              ).map(([k, t, h]) => (
                <label key={k} className="flex items-start gap-2">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--accent)]" checked={config.after[k]} onChange={(e) => setConfig((c) => ({ ...c, after: { ...c.after, [k]: e.target.checked } }))} />
                  <span>
                    <span className="font-semibold">{t}</span>
                    {h && <span className="block text-xs text-muted">{h}</span>}
                  </span>
                </label>
              ))}
            </div>
            <Field id={`${uid}-redir`} label="Redirigir a otra página" hint="Opcional">
              <Input id={`${uid}-redir`} value={config.after.redirectUrl ?? ""} placeholder="https://tuempresa.com/gracias" onChange={(e) => setConfig((c) => ({ ...c, after: { ...c.after, redirectUrl: e.target.value } }))} />
            </Field>
          </div>
        </fieldset>
      )}

      {tab === "share" && <SharePanel url={url} published={form.is_published} config={config} />}

      {tab === "responses" && <Responses boardId={board.id} submissions={submissions} config={config} />}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Eliminar formulario"
        description="El enlace deja de funcionar. Los elementos que ya creó siguen en el tablero."
        confirmLabel="Eliminar"
        onConfirm={async () => {
          setConfirmDelete(false);
          const res = await deleteFormAction(form.id);
          if (!res.ok) return toast.error(res.error);
          setDirty(false);
          router.push(`/t/${board.id}/formularios`);
        }}
      />
    </div>
  );
}

function Preview({ config, specs, device, setDevice }: { config: FormConfig; specs: ReturnType<typeof previewSpecs>; device: "desktop" | "mobile"; setDevice: (d: "desktop" | "mobile") => void }) {
  const [key, setKey] = useState(0);
  return (
    <div className="lg:sticky lg:top-4 lg:self-start">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-subtle">Vista previa · se puede responder</p>
        <div className="flex items-center gap-1 text-xs">
          {(
            [
              ["desktop", "Compu"],
              ["mobile", "Celular"],
            ] as const
          ).map(([d, l]) => (
            <button key={d} type="button" aria-pressed={device === d} onClick={() => setDevice(d)} className={cn("rounded-md px-2 py-1 font-semibold", device === d ? "bg-surface-3 text-fg" : "text-muted")}>
              {l}
            </button>
          ))}
          <button type="button" onClick={() => setKey((k) => k + 1)} className="rounded-md px-2 py-1 font-semibold text-muted hover:text-fg">
            Reiniciar
          </button>
        </div>
      </div>
      <div style={formTheme(config.design)} className={cn("max-h-[calc(100dvh/var(--ui-zoom,1)-9rem)] overflow-y-auto rounded-2xl border border-line bg-bg p-4", device === "mobile" && "mx-auto max-w-[390px]")}>
        <div className="space-y-4">
          <FormCover design={config.design} title={config.title || "Sin título"} description={config.description} />
          <FormRenderer
            key={key}
            mode="preview"
            form={{ slug: "preview", title: config.title, description: config.description ?? null, design: config.design, questions: config.questions, specs, after: config.after, open: true, closedReason: null }}
            onReset={() => setKey((k) => k + 1)}
          />
        </div>
      </div>
    </div>
  );
}

function PasswordBox({ formId, has }: { formId: string; has: boolean }) {
  const toast = useToast();
  const [pw, setPw] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="rounded-xl border border-line p-3">
      <p className="text-sm font-semibold">
        Contraseña {has && <span className="ml-1 rounded-full bg-success-soft px-2 py-0.5 text-xs text-success">configurada</span>}
      </p>
      <p className="text-xs text-muted">Se guarda cifrada: nadie la puede ver, ni siquiera en Vetta. Para cambiarla, escribí una nueva.</p>
      <div className="mt-2 flex gap-2">
        <Input type="password" aria-label="Nueva contraseña" autoComplete="new-password" value={pw} maxLength={100} onChange={(e) => setPw(e.target.value)} placeholder={has ? "Nueva contraseña" : "Contraseña"} />
        <Button
          variant="primary"
          disabled={pw.length < 4 || pending}
          onClick={() =>
            start(async () => {
              const res = await setFormPasswordAction(formId, pw);
              if (!res.ok) return toast.error(res.error);
              setPw("");
              toast.success(res.message ?? "Guardada.");
            })
          }
        >
          Guardar
        </Button>
      </div>
    </div>
  );
}

function SharePanel({ url, published, config }: { url: string; published: boolean; config: FormConfig }) {
  const [qr, setQr] = useState<string>("");
  const [copied, setCopied] = useState<string | null>(null);
  const params = config.questions.filter((q) => q.param);
  const [values, setValues] = useState<Record<string, string>>({});
  const link = useMemo(() => {
    const qs = new URLSearchParams(Object.entries(values).filter(([, v]) => v));
    return qs.toString() ? `${url}?${qs}` : url;
  }, [url, values]);
  const embed = `<iframe src="${url}?embed=1" title="${config.title.replace(/"/g, "&quot;")}" width="100%" height="900" style="border:0;max-width:720px" loading="lazy"></iframe>`;

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(link, { width: 480, margin: 1, errorCorrectionLevel: "M" }).then((d) => alive && setQr(d)).catch(() => alive && setQr(""));
    return () => {
      alive = false;
    };
  }, [link]);

  const copy = (text: string, what: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="space-y-5">
        {!published && <p className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">El formulario está en borrador: publicalo para que el enlace funcione.</p>}
        <div>
          <p className="mb-1.5 text-sm font-semibold">Enlace</p>
          <div className="flex gap-2">
            <Input readOnly value={link} aria-label="Enlace del formulario" onFocus={(e) => e.target.select()} />
            <Button onClick={() => copy(link, "link")}>{copied === "link" ? "¡Copiado!" : "Copiar"}</Button>
          </div>
        </div>
        {params.length > 0 && (
          <div>
            <p className="mb-1.5 text-sm font-semibold">Enlace con respuestas precargadas</p>
            <p className="mb-2 text-xs text-muted">Por ejemplo, un enlace distinto para cada canal (web, Instagram, mail) y así saber de dónde llega cada pedido.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {params.map((q) => (
                <label key={q.id} className="block text-xs font-semibold text-muted">
                  {q.label || q.param} <span className="font-mono font-normal">({q.param})</span>
                  <Input className="mt-1 !h-9" value={values[q.param!] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [q.param!]: e.target.value }))} />
                </label>
              ))}
            </div>
          </div>
        )}
        <div>
          <p className="mb-1.5 text-sm font-semibold">Insertar en tu web</p>
          <textarea readOnly rows={3} value={embed} aria-label="Código para insertar" className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-xs" onFocus={(e) => e.target.select()} />
          <Button size="sm" className="mt-1.5" onClick={() => copy(embed, "embed")}>
            {copied === "embed" ? "¡Copiado!" : "Copiar código"}
          </Button>
        </div>
      </div>
      <div className="rounded-2xl border border-line bg-surface p-4 text-center">
        <p className="mb-2 text-sm font-semibold">Código QR</p>
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt={`Código QR para abrir ${config.title}`} className="mx-auto aspect-square w-full max-w-64 rounded-lg bg-white p-2" />
        ) : (
          <div className="mx-auto aspect-square w-full max-w-64 rounded-lg bg-surface-2" />
        )}
        <p className="mt-2 text-xs text-muted">Para imprimir en carteles, mostradores o facturas.</p>
        {qr && (
          <a href={qr} download={`qr-${config.title.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40) || "formulario"}.png`} className="mt-2 inline-block text-sm font-semibold text-accent hover:underline">
            Descargar PNG
          </a>
        )}
      </div>
    </div>
  );
}

function Responses({ boardId, submissions, config }: { boardId: string; submissions: Submission[]; config: FormConfig }) {
  const [q, setQ] = useState("");
  const cols = config.questions.filter((x) => isInput(x));
  // También columnas de preguntas que ya no están (respuestas viejas).
  const extra = [...new Set(submissions.flatMap((s) => Object.keys(s.answers)))].filter((id) => !cols.some((c) => c.id === id));
  const columns = [...cols.map((c) => ({ id: c.id, label: c.label || "(sin texto)" })), ...extra.map((id) => ({ id, label: submissions.find((s) => s.answers[id])?.answers[id]?.label ?? id }))];
  const rows = submissions.filter((s) => !q || JSON.stringify(s.answers).toLowerCase().includes(q.toLowerCase()) || (s.by ?? "").toLowerCase().includes(q.toLowerCase()));
  const week = submissions.filter((s) => nowMs() - Date.parse(s.created_at) < 7 * 86400000).length;
  const durations = submissions.map((s) => s.duration_ms).filter((d): d is number => typeof d === "number" && d > 0 && d < 3_600_000);
  const avg = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 1000) : null;

  const csv = () => {
    const cell = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      ["Fecha", "Enviado por", ...columns.map((c) => c.label)],
      ...rows.map((s) => [formatDateTime(s.created_at), s.by ?? "Anónimo", ...columns.map((c) => s.answers[c.id]?.text ?? "")]),
    ];
    const blob = new Blob(["﻿" + lines.map((l) => l.map(cell).join(";")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `respuestas-${config.title.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["Respuestas", String(submissions.length)],
          ["Últimos 7 días", String(week)],
          ["Tiempo promedio", avg === null ? "—" : avg < 60 ? `${avg} s` : `${Math.floor(avg / 60)} min ${avg % 60} s`],
        ].map(([l, v]) => (
          <div key={l} className="rounded-2xl border border-line bg-surface p-4 shadow-card">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{l}</p>
            <p className="mt-1 text-3xl font-extrabold tabular-nums">{v}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="!h-9 max-w-xs" placeholder="Buscar en las respuestas…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar en las respuestas" />
        <Button size="sm" onClick={csv} disabled={!rows.length}>
          Descargar CSV
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-strong px-6 py-10 text-center text-sm text-muted">{submissions.length ? "Nada coincide con la búsqueda." : "Todavía no hay respuestas."}</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr>
                <th scope="col" className="border-b border-line px-3 py-2 text-left text-xs font-semibold text-muted">
                  Fecha
                </th>
                <th scope="col" className="border-b border-line px-3 py-2 text-left text-xs font-semibold text-muted">
                  Elemento
                </th>
                {columns.map((c) => (
                  <th key={c.id} scope="col" className="max-w-56 truncate border-b border-line px-3 py-2 text-left text-xs font-semibold text-muted">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="hover:bg-surface-2">
                  <td className="whitespace-nowrap border-b border-line px-3 py-2 text-muted" title={formatDateTime(s.created_at)}>
                    {relativeTime(s.created_at)}
                    {s.by && <span className="block text-[11px]">{s.by}</span>}
                  </td>
                  <td className="border-b border-line px-3 py-2">
                    {s.task_id ? (
                      <Link href={`/t/${boardId}?item=${s.task_id}`} className="font-semibold text-accent hover:underline">
                        Abrir
                      </Link>
                    ) : (
                      <span className="text-subtle">Eliminado</span>
                    )}
                  </td>
                  {columns.map((c) => (
                    <td key={c.id} className="max-w-56 truncate border-b border-line px-3 py-2" title={s.answers[c.id]?.text}>
                      {s.answers[c.id]?.text ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
