"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, FormAlert, Input } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { IconChecklist, IconPlus } from "@/components/ui/icons";
import { ChecklistEditor, fromTemplate } from "@/components/board/checklist-editor";
import { createChecklistTemplateAction, deleteChecklistTemplateAction, updateChecklistTemplateAction } from "@/app/actions/checklists";
import type { CheckItem, ChecklistTemplate } from "@/lib/columns";

type Editing = { id?: string; name: string; items: CheckItem[] };

export function TemplatesManager({ workspaceId, templates, userId, isAdmin }: { workspaceId: string; templates: ChecklistTemplate[]; userId: string; isAdmin: boolean }) {
  const toast = useToast();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [removing, setRemoving] = useState<ChecklistTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const canEdit = (t: ChecklistTemplate) => isAdmin || t.created_by === userId;

  const submit = () =>
    start(async () => {
      if (!editing) return;
      setError(null);
      const input = { name: editing.name, items: editing.items.map((i) => ({ text: i.text, header: i.header, note: i.note })) };
      const res = editing.id ? await updateChecklistTemplateAction(editing.id, input) : await createChecklistTemplateAction(workspaceId, input);
      if (!res.ok) setError(res.error);
      else {
        toast.success("Plantilla guardada.");
        setEditing(null);
      }
    });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setEditing({ name: "", items: [] })}>
          <IconPlus size={16} /> Nueva plantilla
        </Button>
      </div>

      {templates.length === 0 ? (
        <EmptyState
          icon={<IconChecklist />}
          title="Todavía no hay plantillas"
          description="Creá una acá o, desde el checklist de cualquier elemento, usá “Guardar como plantilla” en el menú ⋯."
        />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {templates.map((t) => {
            const steps = t.items.filter((i) => !i.header).length;
            const sections = t.items.length - steps;
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{t.name}</p>
                  <p className="text-xs text-muted">
                    {steps} pasos{sections ? ` · ${sections} secciones` : ""}
                    {t.items.length > 0 && <span> · {t.items.filter((i) => !i.header).slice(0, 3).map((i) => i.text).join(", ")}{steps > 3 ? "…" : ""}</span>}
                  </p>
                </div>
                <Button size="sm" onClick={() => setEditing({ id: t.id, name: t.name, items: fromTemplate(t) })} disabled={!canEdit(t)} title={canEdit(t) ? undefined : "Solo quien la creó o un administrador"}>
                  Editar
                </Button>
                <Button size="sm" onClick={() => setEditing({ name: `${t.name} (copia)`.slice(0, 80), items: fromTemplate(t) })}>
                  Duplicar
                </Button>
                <Button size="sm" variant="outline-danger" onClick={() => setRemoving(t)} disabled={!canEdit(t)}>
                  Eliminar
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <Dialog open onClose={() => setEditing(null)} title={editing.id ? "Editar plantilla" : "Nueva plantilla"} description="Los cambios valen para los checklists que se creen de ahora en adelante." size="lg">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            {error && <FormAlert>{error}</FormAlert>}
            <Field id="tpl-name" label="Nombre">
              <Input id="tpl-name" value={editing.name} maxLength={80} required onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <ChecklistEditor template items={editing.items} members={[]} onChange={(items) => setEditing((x) => (x ? { ...x, items } : x))} />
            <div className="flex justify-end gap-2 border-t border-line pt-4">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" disabled={pending || !editing.name.trim() || editing.items.length === 0}>
                {pending ? "Guardando…" : "Guardar plantilla"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}

      {removing && (
        <ConfirmDialog
          open
          title={`Eliminar “${removing.name}”`}
          description="Los checklists que ya se crearon con ella no cambian. Las columnas que la usaban como automática dejan de cargarla."
          confirmLabel="Eliminar plantilla"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            const res = await deleteChecklistTemplateAction(removing.id);
            if (!res.ok) toast.error(res.error);
            else toast.success("Plantilla eliminada.");
            setRemoving(null);
          }}
        />
      )}
    </div>
  );
}
