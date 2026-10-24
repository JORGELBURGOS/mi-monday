"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Menu } from "@/components/ui/menu";
import { IconChart, IconDots, IconEdit, IconLock, IconPlus, IconUsers } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { NONE, NO_GLOBAL_FILTERS, type Dataset, type GlobalFilters } from "@/lib/dashboard-engine";
import { WIDGET_LABELS, WIDGET_TYPES, blankWidget, newWidgetId, type StateFilter, type Widget, type WidgetType } from "@/lib/dashboards";
import { deleteDashboardAction, duplicateDashboardAction, saveDashboardWidgetsAction, updateDashboardMetaAction } from "@/app/actions/dashboards";
import { WidgetCard } from "./widget-card";
import { WidgetEditor } from "./widget-editor";

export type DashboardInfo = { id: string; workspaceId: string; name: string; description: string | null; visibility: "workspace" | "private"; widgets: Widget[] };

export function DashboardView({ dashboard, ds, canEdit }: { dashboard: DashboardInfo; ds: Dataset; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [widgets, setWidgets] = useState<Widget[]>(dashboard.widgets);
  const [dirty, setDirty] = useState(false);
  const [config, setConfig] = useState<{ widget: Widget; isNew: boolean } | null>(null);
  const [adding, setAdding] = useState(false);
  const [meta, setMeta] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [filters, setFilters] = useState<GlobalFilters>(NO_GLOBAL_FILTERS);
  const [dragId, setDragId] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  // Si cambia lo guardado (otra pestaña / después de guardar) y no hay cambios pendientes, se toma lo nuevo.
  const [prevSaved, setPrevSaved] = useState(dashboard.widgets);
  if (prevSaved !== dashboard.widgets) {
    setPrevSaved(dashboard.widgets);
    if (!dirty) setWidgets(dashboard.widgets);
  }

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const update = (next: Widget[]) => {
    setWidgets(next);
    setDirty(true);
  };
  const replace = (w: Widget) => update(widgets.map((x) => (x.id === w.id ? w : x)));
  const move = (id: string, dir: -1 | 1) => {
    const i = widgets.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= widgets.length) return;
    const next = [...widgets];
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  };
  const dropOn = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const from = widgets.findIndex((x) => x.id === dragId);
    const to = widgets.findIndex((x) => x.id === targetId);
    const next = [...widgets];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    update(next);
  };

  const save = () =>
    startSaving(async () => {
      const res = await saveDashboardWidgetsAction(dashboard.id, widgets);
      if (!res.ok) return toast.error(res.error);
      toast.success(res.message ?? "Guardado.");
      setDirty(false);
      setEditing(false);
    });

  const discard = () => {
    setWidgets(dashboard.widgets);
    setDirty(false);
    setEditing(false);
  };

  const activeFilters = filters.boards.length > 0 || filters.assignee !== "" || filters.state !== "all";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            {dashboard.name}
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">
              {dashboard.visibility === "private" ? <IconLock size={12} /> : <IconUsers size={12} />}
              {dashboard.visibility === "private" ? "Solo yo" : "Toda la empresa"}
            </span>
          </h1>
          {dashboard.description && <p className="mt-1 max-w-3xl text-sm text-muted">{dashboard.description}</p>}
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {editing ? (
              <>
                <Button size="sm" onClick={() => setAdding(true)}>
                  <IconPlus size={15} /> Agregar widget
                </Button>
                <Button size="sm" variant="ghost" onClick={discard} disabled={saving}>
                  {dirty ? "Descartar cambios" : "Salir de edición"}
                </Button>
                <Button size="sm" variant="primary" onClick={save} disabled={saving || !dirty}>
                  {saving ? "Guardando…" : "Guardar"}
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setEditing(true)}>
                <IconEdit size={15} /> Editar
              </Button>
            )}
            <Menu
              label="Opciones del dashboard"
              trigger={<IconDots size={16} />}
              triggerClassName="h-8 w-8 rounded-lg border border-line text-muted hover:bg-surface-2"
              items={[
                { label: "Nombre, descripción y visibilidad…", onSelect: () => setMeta(true) },
                {
                  label: "Duplicar",
                  onSelect: () =>
                    startSaving(async () => {
                      const res = await duplicateDashboardAction(dashboard.id);
                      if (!res.ok) return toast.error(res.error);
                      toast.success(res.message ?? "Duplicado.");
                      router.push(`/e/${dashboard.workspaceId}/dashboard/${res.data.id}`);
                    }),
                },
                { type: "separator" },
                { label: "Eliminar dashboard", danger: true, onSelect: () => setConfirmDelete(true) },
              ]}
            />
          </div>
        )}
      </div>

      {/* Filtros generales: solo cambian la vista, no se guardan. */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-subtle">Filtrar</span>
        <Select
          aria-label="Tablero"
          className="!h-8 w-auto max-w-56 text-xs"
          value={filters.boards[0] ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, boards: e.target.value ? [e.target.value] : [] }))}
        >
          <option value="">Todos los tableros</option>
          {ds.boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Responsable" className="!h-8 w-auto max-w-56 text-xs" value={filters.assignee} onChange={(e) => setFilters((f) => ({ ...f, assignee: e.target.value }))}>
          <option value="">Todas las personas</option>
          {ds.members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.full_name?.trim() || m.email}
            </option>
          ))}
          <option value={NONE}>Sin responsable</option>
        </Select>
        <Select aria-label="Situación" className="!h-8 w-auto text-xs" value={filters.state} onChange={(e) => setFilters((f) => ({ ...f, state: e.target.value as StateFilter }))}>
          <option value="all">Todos los elementos</option>
          <option value="open">Pendientes</option>
          <option value="done">Terminados</option>
          <option value="overdue">Vencidos</option>
        </Select>
        {activeFilters && (
          <button type="button" onClick={() => setFilters(NO_GLOBAL_FILTERS)} className="text-xs font-semibold text-accent hover:underline">
            Limpiar
          </button>
        )}
        {editing && <span className="ml-auto text-xs text-muted">Editando: arrastrá un widget para moverlo y su esquina inferior derecha para cambiarle el tamaño.</span>}
      </div>

      {widgets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong px-6 py-14 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
            <IconChart />
          </span>
          <p className="font-bold">Este dashboard está vacío</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">Agregá gráficos, KPI, tablas y listas con los datos de tus tableros.</p>
          {canEdit && (
            <Button
              variant="primary"
              className="mt-4"
              onClick={() => {
                setEditing(true);
                setAdding(true);
              }}
            >
              <IconPlus size={15} /> Agregar widget
            </Button>
          )}
        </div>
      ) : (
        <div className="dash-grid">
          {widgets.map((w) => (
            <WidgetCard
              key={w.id}
              w={w}
              ds={ds}
              filters={filters}
              editing={editing}
              onEdit={() => setConfig({ widget: w, isNew: false })}
              onChange={replace}
              onDuplicate={() => {
                const i = widgets.findIndex((x) => x.id === w.id);
                const next = [...widgets];
                next.splice(i + 1, 0, { ...w, id: newWidgetId(), title: `${w.title} (copia)`.slice(0, 80) });
                update(next);
              }}
              onRemove={() => update(widgets.filter((x) => x.id !== w.id))}
              onMove={(dir) => move(w.id, dir)}
              dragProps={{
                draggable: true,
                onDragStart: (e) => {
                  setDragId(w.id);
                  e.dataTransfer.effectAllowed = "move";
                },
                onDragOver: (e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                },
                onDrop: (e) => {
                  e.preventDefault();
                  dropOn(w.id);
                  setDragId(null);
                },
                onDragEnd: () => setDragId(null),
                className: cn(dragId === w.id && "opacity-50"),
              }}
            />
          ))}
        </div>
      )}

      {adding && (
        <Dialog open onClose={() => setAdding(false)} title="Agregar widget" description="Elegí el tipo. Después lo configurás con los datos que quieras." size="lg">
          <div className="grid gap-2 sm:grid-cols-2">
            {WIDGET_TYPES.map((t: WidgetType) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setAdding(false);
                  setConfig({ widget: blankWidget(t), isNew: true });
                }}
                className="rounded-xl border border-line px-3 py-2.5 text-left hover:border-accent hover:bg-accent-soft"
              >
                <span className="block text-sm font-semibold">{WIDGET_LABELS[t].label}</span>
                <span className="block text-xs text-muted">{WIDGET_LABELS[t].help}</span>
              </button>
            ))}
          </div>
        </Dialog>
      )}

      {config && (
        <WidgetEditor
          key={config.widget.id}
          ds={ds}
          initial={config.widget}
          onClose={() => setConfig(null)}
          onSave={(w) => {
            if (config.isNew) update([...widgets, w]);
            else replace(w);
            setConfig(null);
          }}
        />
      )}

      {meta && <MetaDialog dashboard={dashboard} onClose={() => setMeta(false)} />}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Eliminar dashboard"
        description={
          <>
            Se elimina <strong className="text-fg">“{dashboard.name}”</strong> con todos sus widgets. Los datos de los tableros no se tocan.
          </>
        }
        confirmLabel="Eliminar"
        onConfirm={async () => {
          setConfirmDelete(false);
          const res = await deleteDashboardAction(dashboard.id);
          if (!res.ok) return toast.error(res.error);
          toast.success(res.message ?? "Eliminado.");
          router.push(`/e/${dashboard.workspaceId}/dashboard`);
        }}
      />
    </div>
  );
}

function MetaDialog({ dashboard, onClose }: { dashboard: DashboardInfo; onClose: () => void }) {
  const uid = useId();
  const toast = useToast();
  const [name, setName] = useState(dashboard.name);
  const [description, setDescription] = useState(dashboard.description ?? "");
  const [visibility, setVisibility] = useState(dashboard.visibility);
  const [pending, start] = useTransition();
  return (
    <Dialog open onClose={onClose} title="Dashboard">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await updateDashboardMetaAction(dashboard.id, { name, description, visibility });
            if (!res.ok) return toast.error(res.error);
            toast.success(res.message ?? "Guardado.");
            onClose();
          });
        }}
      >
        <Field id={`${uid}-n`} label="Nombre">
          <Input id={`${uid}-n`} value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id={`${uid}-d`} label="Descripción" hint="Opcional">
          <Textarea id={`${uid}-d`} rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <VisibilityPicker value={visibility} onChange={setVisibility} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={pending}>
            Guardar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function VisibilityPicker({ value, onChange }: { value: "workspace" | "private"; onChange: (v: "workspace" | "private") => void }) {
  const opts = useMemo(
    () =>
      [
        { v: "workspace", title: "Toda la empresa", help: "Lo ve cualquier persona de la empresa (cada uno con los datos de los tableros a los que tiene acceso)." },
        { v: "private", title: "Solo yo", help: "Solo lo ves vos (y los administradores)." },
      ] as const,
    [],
  );
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-semibold">Quién lo ve</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {opts.map((o) => (
          <label key={o.v} className={cn("flex cursor-pointer gap-2 rounded-xl border p-3", value === o.v ? "border-accent bg-accent-soft" : "border-line")}>
            <input type="radio" name="dash-visibility" className="mt-0.5 accent-[var(--accent)]" checked={value === o.v} onChange={() => onChange(o.v)} />
            <span>
              <span className="block text-sm font-semibold">{o.title}</span>
              <span className="block text-xs text-muted">{o.help}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
