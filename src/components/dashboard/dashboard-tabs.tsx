"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { IconLock, IconPlus } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { createDashboardAction } from "@/app/actions/dashboards";
import { VisibilityPicker } from "./dashboard-view";

export function DashboardTabs({
  workspaceId,
  current,
  dashboards,
}: {
  workspaceId: string;
  /** "summary" = el resumen fijo; si no, el id del dashboard abierto. */
  current: string;
  dashboards: { id: string; name: string; visibility: string }[];
}) {
  const [creating, setCreating] = useState(false);
  const tab = (active: boolean) =>
    cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold", active ? "bg-surface text-fg shadow-card" : "text-muted hover:text-fg");
  return (
    <nav aria-label="Dashboards" className="mb-6 flex items-center gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1">
      <Link href={`/e/${workspaceId}/dashboard`} className={tab(current === "summary")} aria-current={current === "summary" ? "page" : undefined}>
        Resumen
      </Link>
      {dashboards.map((d) => (
        <Link key={d.id} href={`/e/${workspaceId}/dashboard/${d.id}`} className={tab(current === d.id)} aria-current={current === d.id ? "page" : undefined}>
          {d.visibility === "private" && <IconLock size={12} aria-label="Privado" />}
          <span className="max-w-48 truncate">{d.name}</span>
        </Link>
      ))}
      <button type="button" onClick={() => setCreating(true)} className="ml-1 inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-3 text-sm font-semibold text-accent hover:bg-surface">
        <IconPlus size={15} /> Nuevo dashboard
      </button>
      {creating && <NewDashboardDialog workspaceId={workspaceId} onClose={() => setCreating(false)} />}
    </nav>
  );
}

function NewDashboardDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const uid = useId();
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"workspace" | "private">("workspace");
  const [template, setTemplate] = useState<"summary" | "blank">("summary");
  const [pending, start] = useTransition();
  return (
    <Dialog open onClose={onClose} title="Nuevo dashboard" description="Después agregás y configurás los gráficos, KPI y tablas que quieras.">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await createDashboardAction(workspaceId, { name, visibility, template });
            if (!res.ok) return toast.error(res.error);
            toast.success(res.message ?? "Creado.");
            onClose();
            router.push(`/e/${workspaceId}/dashboard/${res.data.id}`);
          });
        }}
      >
        <Field id={`${uid}-n`} label="Nombre">
          <Input id={`${uid}-n`} data-autofocus value={name} maxLength={80} required placeholder="Ej.: Seguimiento comercial" onChange={(e) => setName(e.target.value)} />
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold">Empezar con</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                { v: "summary", title: "Un resumen armado", help: "KPI, avance por tablero, prioridades, carga por persona, evolución y vencidos. Después lo cambiás." },
                { v: "blank", title: "En blanco", help: "Sin widgets: lo armás desde cero." },
              ] as const
            ).map((o) => (
              <label key={o.v} className={cn("flex cursor-pointer gap-2 rounded-xl border p-3", template === o.v ? "border-accent bg-accent-soft" : "border-line")}>
                <input type="radio" name="dash-template" className="mt-0.5 accent-[var(--accent)]" checked={template === o.v} onChange={() => setTemplate(o.v)} />
                <span>
                  <span className="block text-sm font-semibold">{o.title}</span>
                  <span className="block text-xs text-muted">{o.help}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <VisibilityPicker value={visibility} onChange={setVisibility} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={pending || !name.trim()}>
            {pending ? "Creando…" : "Crear dashboard"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
