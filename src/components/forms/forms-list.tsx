"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/misc";
import { Field, Input } from "@/components/ui/form";
import { IconPlus } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { relativeTime } from "@/lib/format";
import { createFormAction } from "@/app/actions/forms";
import type { FormTemplate } from "@/lib/forms";

/** Hora actual (fuera del render para la regla de pureza). */
function nowMs() {
  return Date.now();
}

const TEMPLATES: { v: FormTemplate; title: string; help: string }[] = [
  { v: "request", title: "Pedido o solicitud", help: "Qué necesita, detalle, urgencia, fecha, email y adjuntos." },
  { v: "support", title: "Soporte o reclamo", help: "Tipo de consulta con preguntas que aparecen según la respuesta." },
  { v: "contact", title: "Contacto", help: "Nombre, email, teléfono y mensaje." },
  { v: "blank", title: "En blanco", help: "Solo el título: lo armás vos." },
];

const ACCESS_LABEL: Record<string, string> = { public: "Público", members: "Solo la empresa", password: "Con contraseña" };

export function FormsList({
  boardId,
  forms,
  stats,
  canManage,
}: {
  boardId: string;
  forms: { id: string; name: string; slug: string; is_published: boolean; access: string; closes_at: string | null; updated_at: string }[];
  stats: Record<string, { count: number; last: string | null }>;
  canManage: boolean;
}) {
  const [creating, setCreating] = useState(false);
  return (
    <div className="space-y-4">
      {canManage && forms.length > 0 && (
        <div className="flex justify-end">
          <Button variant="primary" onClick={() => setCreating(true)}>
            <IconPlus size={16} /> Nuevo formulario
          </Button>
        </div>
      )}
      {forms.length === 0 ? (
        <EmptyState
          title="Todavía no hay formularios"
          description="Armá un formulario y compartí el enlace: cada respuesta llega como un elemento nuevo del tablero, con archivos, columnas completas y aviso al equipo."
          action={
            canManage ? (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <IconPlus size={16} /> Crear formulario
              </Button>
            ) : (
              <p className="text-sm text-muted">Solo quien administra el tablero puede crear formularios.</p>
            )
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {forms.map((f) => {
            const st = stats[f.id];
            const closed = f.closes_at && Date.parse(f.closes_at) < nowMs();
            return (
              <li key={f.id}>
                <Link href={`/t/${boardId}/formularios/${f.id}`} className="block rounded-2xl border border-line bg-surface p-4 shadow-card transition hover:border-line-strong">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate font-bold">{f.name}</p>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold",
                        f.is_published && !closed ? "bg-success-soft text-success" : "bg-surface-3 text-muted",
                      )}
                    >
                      {closed ? "Cerrado" : f.is_published ? "Publicado" : "Borrador"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {ACCESS_LABEL[f.access] ?? f.access} · {st?.count ?? 0} {st?.count === 1 ? "respuesta" : "respuestas"}
                    {st?.last && ` · última ${relativeTime(st.last)}`}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {creating && <NewFormDialog boardId={boardId} onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewFormDialog({ boardId, onClose }: { boardId: string; onClose: () => void }) {
  const uid = useId();
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<FormTemplate>("request");
  const [pending, start] = useTransition();
  return (
    <Dialog open onClose={onClose} title="Nuevo formulario">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await createFormAction(boardId, { name, template });
            if (!res.ok) return toast.error(res.error);
            router.push(`/t/${boardId}/formularios/${res.data.id}`);
          });
        }}
      >
        <Field id={`${uid}-n`} label="Nombre">
          <Input id={`${uid}-n`} data-autofocus required maxLength={120} value={name} placeholder="Ej.: Pedidos de compra" onChange={(e) => setName(e.target.value)} />
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold">Empezar con</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {TEMPLATES.map((t) => (
              <label key={t.v} className={cn("flex cursor-pointer gap-2 rounded-xl border p-3", template === t.v ? "border-accent bg-accent-soft" : "border-line")}>
                <input type="radio" name="form-template" className="mt-0.5 accent-[var(--accent)]" checked={template === t.v} onChange={() => setTemplate(t.v)} />
                <span>
                  <span className="block text-sm font-semibold">{t.title}</span>
                  <span className="block text-xs text-muted">{t.help}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={pending || !name.trim()}>
            {pending ? "Creando…" : "Crear y editar"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
