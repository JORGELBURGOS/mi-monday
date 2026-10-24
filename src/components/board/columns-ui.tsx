"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { PopoverButton } from "@/components/ui/popover";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, FormAlert, Input, Select, Textarea } from "@/components/ui/form";
import {
  IconArrowDown,
  IconArrowUp,
  IconCalendar,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconEdit,
  IconPlus,
  IconSearch,
  IconSettings,
  IconTrash,
  IconLink,
  IconPaperclip,
  IconUser,
  IconUsers,
  IconX,
} from "@/components/ui/icons";
import {
  COLUMN_KIND_HELP,
  COLUMN_KIND_LABELS,
  KIND_CHANGES,
  NUMBER_SUMMARIES,
  NUMBER_SUMMARY_LABELS,
  formatNumber,
  type BoardColumn,
  type ColumnKind,
  type ColumnSettings,
} from "@/lib/columns";
import { BUILTIN_DEFAULT_LABELS, builtinLabel, type BoardSettings, type BuiltinKey, type ColumnKey } from "@/lib/board-settings";
import { FUNCTIONS, FUNCTION_GROUPS, formulaRefs, type FormulaResult } from "@/lib/formula";
import { LabelEditor, type Label, type LabelEditing } from "./label-picker";
import { applyChecklistTemplateAction } from "@/app/actions/columns";

/* ------------------------------------------------------------ definiciones */

export type ColumnDef = {
  key: ColumnKey;
  builtin?: BuiltinKey;
  column?: BoardColumn;
  label: string;
  width: number;
  hidden: boolean;
};

const BUILTIN_WIDTH: Record<BuiltinKey, number> = { assignee: 150, status: 150, priority: 130, due: 140 };
const KIND_WIDTH: Record<ColumnKind, number> = {
  list: 150,
  text: 160,
  long_text: 180,
  number: 130,
  date: 140,
  timeline: 170,
  person: 150,
  tags: 180,
  checkbox: 90,
  rating: 130,
  link: 170,
  email: 180,
  phone: 140,
  hour: 100,
  formula: 150,
  item_id: 110,
  created_log: 160,
  updated_log: 130,
  files: 150,
  people: 160,
  checklist: 140,
  dependency: 170,
  connect: 190,
  mirror: 160,
};

export function buildColumnDefs(settings: BoardSettings, columns: BoardColumn[], order: ColumnKey[]): ColumnDef[] {
  return order.flatMap<ColumnDef>((key) => {
    if (key.startsWith("c:")) {
      const column = columns.find((c) => `c:${c.id}` === key);
      if (!column) return [];
      return [{ key, column, label: column.name, width: KIND_WIDTH[column.kind], hidden: Boolean(column.settings.hidden) }];
    }
    const builtin = key as BuiltinKey;
    return [{ key, builtin, label: builtinLabel(settings, builtin), width: BUILTIN_WIDTH[builtin], hidden: Boolean(settings.columns?.[builtin]?.hidden) }];
  });
}

/* --------------------------------------------------------------- tipos */

const KIND_GLYPH: Partial<Record<ColumnKind, string>> = {
  list: "●",
  text: "T",
  long_text: "¶",
  number: "#",
  timeline: "↔",
  tags: "≡",
  checkbox: "✓",
  rating: "★",
  link: "↗",
  email: "@",
  phone: "☏",
  hour: "◷",
  formula: "ƒx",
  item_id: "ID",
  created_log: "+",
  updated_log: "↻",
  files: "",
  people: "",
  checklist: "☑",
  dependency: "⇢",
  connect: "⇄",
  mirror: "◐",
};
const KIND_COLOR: Record<ColumnKind, string> = {
  list: "solid-green",
  text: "solid-blue",
  long_text: "solid-blue",
  number: "solid-amber",
  date: "solid-violet",
  timeline: "solid-violet",
  person: "solid-sky",
  tags: "solid-teal",
  checkbox: "solid-green",
  rating: "solid-yellow",
  link: "solid-indigo",
  email: "solid-indigo",
  phone: "solid-indigo",
  hour: "solid-violet",
  formula: "solid-navy",
  item_id: "solid-gray",
  created_log: "solid-gray",
  updated_log: "solid-gray",
  files: "solid-rose",
  people: "solid-sky",
  checklist: "solid-lime",
  dependency: "solid-purple",
  connect: "solid-indigo",
  mirror: "solid-indigo",
};

export function KindIcon({ kind, className }: { kind: ColumnKind; className?: string }) {
  return (
    <span aria-hidden className={cn(KIND_COLOR[kind], "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold", className)}>
      {kind === "date" ? (
        <IconCalendar size={13} />
      ) : kind === "person" ? (
        <IconUser size={13} />
      ) : kind === "people" ? (
        <IconUsers size={13} />
      ) : kind === "files" ? (
        <IconPaperclip size={13} />
      ) : kind === "connect" ? (
        <IconLink size={13} />
      ) : (
        KIND_GLYPH[kind]
      )}
    </span>
  );
}

const ESSENTIAL: ColumnKind[] = ["list", "text", "person", "date", "number", "tags", "timeline", "checkbox", "formula"];
const MORE: ColumnKind[] = ["files", "people", "checklist", "dependency", "connect", "mirror", "long_text", "rating", "link", "email", "phone", "hour", "item_id", "created_log", "updated_log"];

/** El "+" al final de los encabezados: elegir el tipo de la columna nueva. */
export function AddColumnButton({ onAdd, compact }: { onAdd: (kind: ColumnKind) => void; compact?: boolean }) {
  return (
    <PopoverButton
      label="Agregar columna"
      title="Agregar columna"
      width={320}
      align="end"
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg text-muted hover:bg-surface-2 hover:text-fg",
        compact ? "h-7 w-7" : "h-9 px-3 text-[13px] font-semibold",
      )}
      panel={(close) => (
        <KindPicker
          onPick={(k) => {
            close();
            onAdd(k);
          }}
        />
      )}
    >
      <IconPlus size={16} />
      {!compact && "Columna"}
    </PopoverButton>
  );
}

function KindPicker({ onPick }: { onPick: (k: ColumnKind) => void }) {
  const [q, setQ] = useState("");
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const match = (k: ColumnKind) => !q.trim() || norm(`${COLUMN_KIND_LABELS[k]} ${COLUMN_KIND_HELP[k]}`).includes(norm(q.trim()));
  const section = (title: string, kinds: ColumnKind[]) => {
    const list = kinds.filter(match);
    if (!list.length) return null;
    return (
      <div>
        <p className="px-1.5 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-subtle">{title}</p>
        <ul className="grid grid-cols-1 gap-0.5">
          {list.map((k) => (
            <li key={k}>
              <button type="button" onClick={() => onPick(k)} className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-surface-2">
                <KindIcon kind={k} />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold">{COLUMN_KIND_LABELS[k]}</span>
                  <span className="block truncate text-xs text-muted">{COLUMN_KIND_HELP[k]}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  };
  return (
    <div>
      <div className="relative">
        <IconSearch size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle" />
        <input
          data-autofocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar tipo de columna"
          aria-label="Buscar tipo de columna"
          className="h-9 w-full rounded-lg border border-line bg-surface pl-8 pr-2 text-sm"
        />
      </div>
      {section("Esenciales", ESSENTIAL)}
      {section("Más columnas", MORE)}
    </div>
  );
}

/* -------------------------------------------------------- encabezado */

export type HeaderHandlers = {
  onRename: (def: ColumnDef, name: string) => void;
  onSettings: (def: ColumnDef) => void;
  onMove: (def: ColumnDef, dir: -1 | 1) => void;
  onHide: (def: ColumnDef) => void;
  onSort: (def: ColumnDef, dir: "asc" | "desc") => void;
  onDuplicate: (def: ColumnDef, withValues: boolean) => void;
  onDelete: (def: ColumnDef) => void;
  onAddAfter: (def: ColumnDef, kind: ColumnKind) => void;
};

export function ColumnHeader({
  def,
  first,
  last,
  canManage,
  sorted,
  handlers,
}: {
  def: ColumnDef;
  first: boolean;
  last: boolean;
  canManage: boolean;
  sorted: "asc" | "desc" | null;
  handlers: HeaderHandlers;
}) {
  const [renaming, setRenaming] = useState(false);
  const description = def.column?.settings.description;
  const items: MenuItem[] = [
    ...(canManage
      ? ([
          { label: "Configurar columna", icon: <IconSettings size={16} />, onSelect: () => handlers.onSettings(def) },
          { label: "Renombrar", icon: <IconEdit size={16} />, onSelect: () => setRenaming(true) },
        ] as MenuItem[])
      : []),
    { type: "label", label: "Ordenar" },
    { label: "De menor a mayor (A → Z)", icon: <IconArrowUp size={16} />, onSelect: () => handlers.onSort(def, "asc") },
    { label: "De mayor a menor (Z → A)", icon: <IconArrowDown size={16} />, onSelect: () => handlers.onSort(def, "desc") },
    ...(canManage
      ? ([
          { type: "separator" },
          { label: "Mover a la izquierda", icon: <IconChevronLeft size={16} />, onSelect: () => handlers.onMove(def, -1), disabled: first },
          { label: "Mover a la derecha", icon: <IconChevronRight size={16} />, onSelect: () => handlers.onMove(def, 1), disabled: last },
          { label: "Ocultar columna", icon: <IconX size={16} />, onSelect: () => handlers.onHide(def) },
          ...(def.column
            ? ([
                { label: "Duplicar (solo estructura)", icon: <IconCopy size={16} />, onSelect: () => handlers.onDuplicate(def, false) },
                { label: "Duplicar con valores", icon: <IconCopy size={16} />, onSelect: () => handlers.onDuplicate(def, true) },
                { type: "separator" },
                { label: "Eliminar columna", icon: <IconTrash size={16} />, danger: true, onSelect: () => handlers.onDelete(def) },
              ] as MenuItem[])
            : []),
        ] as MenuItem[])
      : []),
  ];

  return (
    <div className="group/h flex min-w-0 items-center gap-0.5">
      {renaming ? (
        <form
          className="min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            const v = String(new FormData(e.currentTarget).get("n") ?? "").trim();
            if (v && v !== def.label) handlers.onRename(def, v);
            setRenaming(false);
          }}
        >
          <input
            name="n"
            defaultValue={def.label}
            maxLength={def.column ? 60 : 40}
            autoFocus
            aria-label="Nombre de la columna"
            onBlur={(e) => e.currentTarget.form?.requestSubmit()}
            onKeyDown={(e) => e.key === "Escape" && setRenaming(false)}
            className="h-7 w-full rounded-md border border-line bg-surface px-1.5 text-xs font-semibold text-fg"
          />
        </form>
      ) : (
        <span
          className={cn("min-w-0 flex-1 truncate", def.column?.kind === "number" || def.column?.kind === "formula" ? "text-right" : "text-center")}
          title={description ? `${def.label}: ${description}` : def.label}
          onDoubleClick={() => canManage && setRenaming(true)}
        >
          {def.label}
          {description && <span className="ml-1 text-subtle" aria-hidden>ⓘ</span>}
          {sorted && <span className="ml-1 text-accent">{sorted === "asc" ? "↑" : "↓"}</span>}
        </span>
      )}
      <Menu
        label={`Opciones de la columna ${def.label}`}
        trigger={<IconChevronDown size={14} />}
        items={items}
        triggerClassName="h-6 w-6 shrink-0 opacity-0 group-hover/h:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
      />
      {canManage && (
        <span className="opacity-0 group-hover/h:opacity-100 focus-within:opacity-100">
          <AddColumnButton compact onAdd={(k) => handlers.onAddAfter(def, k)} />
        </span>
      )}
    </div>
  );
}

/* ----------------------------------------------- mostrar/ocultar columnas */

export function ColumnsVisibility({ defs, onToggle, canManage }: { defs: ColumnDef[]; onToggle: (def: ColumnDef, visible: boolean) => void; canManage: boolean }) {
  const hidden = defs.filter((d) => d.hidden).length;
  return (
    <PopoverButton
      label="Mostrar u ocultar columnas"
      width={260}
      className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-semibold", hidden ? "border-accent text-fg" : "border-line text-muted hover:text-fg")}
      panel={() => (
        <div>
          <p className="px-1 pb-1.5 text-xs text-muted">{canManage ? "Las columnas ocultas se ven igual en el detalle de cada elemento." : "Solo quien administra el tablero puede ocultar columnas."}</p>
          <ul className="space-y-0.5">
            {defs.map((d) => (
              <li key={d.key}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-surface-2">
                  <input type="checkbox" checked={!d.hidden} disabled={!canManage} onChange={(e) => onToggle(d, e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
                  {d.column ? <KindIcon kind={d.column.kind} className="h-5 w-5 text-[10px]" /> : <span className="h-5 w-5" />}
                  <span className="truncate">{d.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    >
      <IconSettings size={14} /> Columnas{hidden ? ` (${hidden} ocultas)` : ""}
    </PopoverButton>
  );
}

/* ------------------------------------------------------ configuración */

const UNIT_PRESETS = ["", "$", "US$", "€", "%", "hs", "u."];

export function ColumnSettingsDialog({
  def,
  settings,
  allColumns,
  workspaceBoards = [],
  linkedBoards = [],
  templates = [],
  statuses = [],
  labelEditing,
  preview,
  onClose,
  onSaveColumn,
  onSaveBuiltin,
}: {
  def: ColumnDef;
  settings: BoardSettings;
  allColumns: BoardColumn[];
  workspaceBoards?: { id: string; name: string }[];
  linkedBoards?: { id: string; name: string; columns: BoardColumn[] }[];
  templates?: { id: string; name: string }[];
  statuses?: { id: string; label: string }[];
  labelEditing?: LabelEditing & { labels: Label[] };
  /** Evalúa una fórmula sobre algunos elementos del tablero. */
  preview: (formula: string) => { title: string; result: FormulaResult }[];
  onClose: () => void;
  onSaveColumn: (patch: { name: string; settings: ColumnSettings; kind?: ColumnKind }) => Promise<string | null>;
  onSaveBuiltin: (patch: { label: string; hidden: boolean }) => Promise<string | null>;
}) {
  const col = def.column;
  const [name, setName] = useState(def.label);
  const [s, setS] = useState<ColumnSettings>(col?.settings ?? {});
  const [kind, setKind] = useState<ColumnKind | undefined>(col?.kind);
  const [hidden, setHidden] = useState(def.hidden);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<ColumnSettings>) => setS((x) => ({ ...x, ...patch }));
  const numeric = col && (col.kind === "number" || col.kind === "formula");
  const customUnit = s.unit !== undefined && !UNIT_PRESETS.includes(s.unit);

  return (
    <Dialog open onClose={onClose} title={`Configurar “${def.label}”`} description={col ? COLUMN_KIND_LABELS[col.kind] : "Columna fija del tablero"} size={col?.kind === "formula" ? "lg" : "md"}>
      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError(null);
          const err = col
            ? await onSaveColumn({ name, settings: { ...s, hidden }, kind: kind !== col.kind ? kind : undefined })
            : await onSaveBuiltin({ label: name, hidden });
          setSaving(false);
          if (err) setError(err);
          else onClose();
        }}
      >
        {error && <FormAlert>{error}</FormAlert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="col-name" label="Nombre de la columna">
            <Input id="col-name" value={name} maxLength={col ? 60 : 40} required onChange={(e) => setName(e.target.value)} />
          </Field>
          {col && KIND_CHANGES[col.kind] && (
            <Field id="col-kind" label="Tipo">
              <Select id="col-kind" value={kind} onChange={(e) => setKind(e.target.value as ColumnKind)}>
                {[col.kind, ...(KIND_CHANGES[col.kind] ?? [])].map((k) => (
                  <option key={k} value={k}>
                    {COLUMN_KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        {col && (
          <Field id="col-desc" label="Descripción" hint="Opcional · se ve al pasar por el encabezado">
            <Input id="col-desc" value={s.description ?? ""} maxLength={300} onChange={(e) => set({ description: e.target.value || undefined })} />
          </Field>
        )}

        {col?.kind === "formula" && (
          <FormulaEditor format={s} value={s.formula ?? ""} onChange={(formula) => set({ formula })} columns={allColumns.filter((c) => c.id !== col.id)} settings={settings} preview={preview} />
        )}

        {numeric && (
          <fieldset className="grid gap-4 rounded-xl border border-line p-4 sm:grid-cols-2">
            <legend className="px-1 text-sm font-semibold">Formato del número</legend>
            <Field id="col-unit" label="Unidad">
              <Select
                id="col-unit"
                value={customUnit ? "__custom" : (s.unit ?? "")}
                onChange={(e) => set({ unit: e.target.value === "__custom" ? "u" : e.target.value || undefined })}
              >
                <option value="">Sin unidad</option>
                <option value="$">$ (pesos)</option>
                <option value="US$">US$ (dólares)</option>
                <option value="€">€ (euros)</option>
                <option value="%">% (porcentaje)</option>
                <option value="hs">hs (horas)</option>
                <option value="u.">u. (unidades)</option>
                <option value="__custom">Otra…</option>
              </Select>
            </Field>
            {customUnit ? (
              <Field id="col-unit-custom" label="Unidad personalizada">
                <Input id="col-unit-custom" value={s.unit ?? ""} maxLength={12} onChange={(e) => set({ unit: e.target.value })} />
              </Field>
            ) : (
              <Field id="col-unit-pos" label="Posición de la unidad">
                <Select id="col-unit-pos" value={s.unitPosition ?? "right"} onChange={(e) => set({ unitPosition: e.target.value as "left" | "right" })} disabled={!s.unit}>
                  <option value="left">A la izquierda ($ 100)</option>
                  <option value="right">A la derecha (100 %)</option>
                </Select>
              </Field>
            )}
            <Field id="col-dec" label="Decimales">
              <Select id="col-dec" value={String(s.decimals ?? -1)} onChange={(e) => set({ decimals: Number(e.target.value) })}>
                <option value="-1">Automático</option>
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="col-sum" label="Resumen al pie de cada carpeta">
              <Select id="col-sum" value={s.summary ?? (col.kind === "number" ? "sum" : "none")} onChange={(e) => set({ summary: e.target.value as ColumnSettings["summary"] })}>
                {NUMBER_SUMMARIES.map((k) => (
                  <option key={k} value={k}>
                    {NUMBER_SUMMARY_LABELS[k]}
                  </option>
                ))}
              </Select>
            </Field>
          </fieldset>
        )}

        {col?.kind === "checklist" && (
          <fieldset className="space-y-4 rounded-xl border border-line p-4">
            <legend className="px-1 text-sm font-semibold">Automatismos del checklist</legend>
            <Field id="col-tpl" label="Plantilla automática" hint="Cada elemento nuevo del tablero arranca con estos pasos (también los que crean las reglas)">
              <Select id="col-tpl" value={s.templateId ?? ""} onChange={(e) => set({ templateId: e.target.value || undefined })}>
                <option value="">Sin plantilla</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            {col && s.templateId && <ApplyTemplateNow columnId={col.id} templateId={s.templateId} templateName={templates.find((t) => t.id === s.templateId)?.name ?? "la plantilla"} />}
            {templates.length === 0 && <p className="text-xs text-muted">Todavía no hay plantillas. Guardá un checklist como plantilla desde cualquier elemento o desde Plantillas de la empresa.</p>}
            <Field id="col-oncomplete" label="Al completar todos los pasos, pasar el elemento a" hint="Corre igual que un cambio de estado manual: dispara las reglas y queda en el recorrido">
              <Select id="col-oncomplete" value={s.onCompleteStatusId ?? ""} onChange={(e) => set({ onCompleteStatusId: e.target.value || undefined })}>
                <option value="">No cambiar el estado</option>
                {statuses.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.label}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" checked={Boolean(s.completeOnDone)} onChange={(e) => set({ completeOnDone: e.target.checked || undefined })} className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
              <span>
                <span className="font-medium">Al terminar el elemento, tildar todos los pasos</span>
                <span className="block text-xs text-muted">Cuando el estado pasa a uno “terminado”, los pasos pendientes quedan hechos (menos los “No aplica”).</span>
              </span>
            </label>
          </fieldset>
        )}

        {col?.kind === "connect" && (
          <Field id="col-board" label="Tablero a conectar" hint="Elementos de ese tablero se van a poder vincular desde esta columna">
            <Select id="col-board" value={s.boardId ?? ""} onChange={(e) => set({ boardId: e.target.value || undefined })}>
              <option value="">Elegí un tablero…</option>
              {workspaceBoards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {col?.kind === "mirror" && (
          <MirrorSettings
            value={s}
            onChange={set}
            connectColumns={allColumns.filter((c) => c.kind === "connect")}
            linkedBoards={linkedBoards}
            workspaceBoards={workspaceBoards}
          />
        )}

        {col?.kind === "rating" && (
          <Field id="col-max" label="Cantidad de estrellas">
            <Select id="col-max" value={String(s.max ?? 5)} onChange={(e) => set({ max: Number(e.target.value) })}>
              {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {labelEditing && (
          <section className="rounded-xl border border-line p-3">
            <p className="mb-2 text-sm font-semibold">Etiquetas</p>
            <p className="mb-2 text-xs text-muted">Los cambios de etiquetas se guardan con su propio botón “Aplicar”.</p>
            <LabelEditor labels={labelEditing.labels} editing={labelEditing} onDone={() => {}} />
          </section>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
          Ocultar esta columna en la tabla
        </label>

        <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={saving || !name.trim()}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------- editor de fórmulas */

function FormulaEditor({
  format,
  value,
  onChange,
  columns,
  settings,
  preview,
}: {
  format: ColumnSettings;
  value: string;
  onChange: (v: string) => void;
  columns: BoardColumn[];
  settings: BoardSettings;
  preview: (formula: string) => { title: string; result: FormulaResult }[];
}) {
  const [group, setGroup] = useState<(typeof FUNCTION_GROUPS)[number]>("Números");
  const [textarea, setTextarea] = useState<HTMLTextAreaElement | null>(null);
  const insert = (text: string) => {
    const el = textarea;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + text.length - (text.endsWith("()") ? 1 : 0);
      el?.setSelectionRange(pos, pos);
    });
  };
  const builtins = (["title", "status", "priority", "assignee", "due"] as const).map((k) => (k === "title" ? builtinLabel(settings, "title") : builtinLabel(settings, k)));
  const refNames = [...builtins, "Carpeta", ...columns.map((c) => c.name)];
  const unknown = formulaRefs(value).filter((r) => {
    const base = r.split("#")[0].trim().toLowerCase();
    return !refNames.some((n) => n.toLowerCase() === base) && !Object.values(BUILTIN_DEFAULT_LABELS).some((n) => n.toLowerCase() === base);
  });
  const results = useMemo(() => (value.trim() ? preview(value) : []), [value, preview]);
  const firstError = results.find((r) => !r.result.ok);

  return (
    <section className="space-y-3">
      <Field id="col-formula" label="Fórmula" hint="Escribí los nombres de las columnas entre llaves, por ejemplo {Precio}">
        <Textarea
          id="col-formula"
          ref={setTextarea}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          placeholder='Ej.: {Precio} * {Cantidad}   ·   IF({Estado} = "Listo", "✔", "")'
          className="min-h-24 font-mono text-[13px]"
        />
      </Field>
      {unknown.length > 0 && <p className="text-xs font-semibold text-danger">No existen las columnas: {unknown.map((u) => `{${u}}`).join(", ")}</p>}

      <div>
        <p className="mb-1 text-xs font-semibold text-muted">Columnas (clic para insertar)</p>
        <div className="flex flex-wrap gap-1">
          {refNames.map((n) => (
            <button key={n} type="button" onClick={() => insert(`{${n}}`)} className="rounded-md border border-line bg-surface-2 px-2 py-1 font-mono text-[12px] hover:border-accent">
              {`{${n}}`}
            </button>
          ))}
          {columns
            .filter((c) => c.kind === "timeline")
            .flatMap((c) => [`${c.name}#Inicio`, `${c.name}#Fin`])
            .map((n) => (
              <button key={n} type="button" onClick={() => insert(`{${n}}`)} className="rounded-md border border-line bg-surface-2 px-2 py-1 font-mono text-[12px] hover:border-accent">
                {`{${n}}`}
              </button>
            ))}
        </div>
      </div>

      <div>
        <div className="mb-1 flex flex-wrap items-center gap-1" role="tablist" aria-label="Funciones">
          <span className="mr-1 text-xs font-semibold text-muted">Funciones:</span>
          {FUNCTION_GROUPS.map((g) => (
            <button
              key={g}
              type="button"
              role="tab"
              aria-selected={group === g}
              onClick={() => setGroup(g)}
              className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", group === g ? "bg-fg text-bg" : "text-muted hover:bg-surface-2")}
            >
              {g}
            </button>
          ))}
        </div>
        <ul className="grid max-h-44 gap-1 overflow-y-auto rounded-lg border border-line p-1.5 sm:grid-cols-2" role="tabpanel">
          {Object.entries(FUNCTIONS)
            .filter(([, f]) => f.group === group)
            .map(([nameFn, f]) => (
              <li key={nameFn}>
                <button type="button" onClick={() => insert(`${nameFn}()`)} className="w-full rounded-md px-2 py-1 text-left hover:bg-surface-2" title={f.example}>
                  <span className="font-mono text-[12px] font-bold">{nameFn}</span>
                  <span className="block text-[11px] leading-snug text-muted">{f.help}</span>
                </button>
              </li>
            ))}
        </ul>
      </div>

      <div className="rounded-lg bg-surface-2 p-3">
        <p className="mb-1.5 text-xs font-semibold text-muted">Vista previa</p>
        {!value.trim() ? (
          <p className="text-sm text-muted">Escribí una fórmula para ver el resultado.</p>
        ) : firstError ? (
          <p className="text-sm font-semibold text-danger">{firstError.result.ok ? "" : firstError.result.error}</p>
        ) : results.length === 0 ? (
          <p className="text-sm text-muted">La fórmula es válida. Cargá elementos para ver resultados.</p>
        ) : (
          <ul className="space-y-0.5 text-sm">
            {results.map((r, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="truncate text-muted">{r.title}</span>
                <span className="shrink-0 font-semibold tabular-nums">{r.result.ok ? (typeof r.result.value === "number" ? formatNumber(r.result.value, format) : typeof r.result.value === "boolean" ? (r.result.value ? "Sí" : "No") : String(r.result.value ?? "")) : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function MirrorSettings({
  value,
  onChange,
  connectColumns,
  linkedBoards,
  workspaceBoards,
}: {
  value: ColumnSettings;
  onChange: (p: Partial<ColumnSettings>) => void;
  connectColumns: BoardColumn[];
  linkedBoards: { id: string; name: string; columns: BoardColumn[] }[];
  workspaceBoards: { id: string; name: string }[];
}) {
  const connect = connectColumns.find((c) => c.id === value.connectColumnId);
  const board = linkedBoards.find((b) => b.id === connect?.settings.boardId);
  if (connectColumns.length === 0) {
    return <FormAlert tone="info">Primero agregá una columna “Conectar tableros”: el espejo muestra datos de los elementos que vincula.</FormAlert>;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id="mir-conn" label="Columna de conexión">
        <Select id="mir-conn" value={value.connectColumnId ?? ""} onChange={(e) => onChange({ connectColumnId: e.target.value || undefined })}>
          <option value="">Elegí…</option>
          {connectColumns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({workspaceBoards.find((b) => b.id === c.settings.boardId)?.name ?? "sin tablero"})
            </option>
          ))}
        </Select>
      </Field>
      <Field id="mir-key" label="Dato a mostrar">
        <Select id="mir-key" value={value.mirrorKey ?? "status"} onChange={(e) => onChange({ mirrorKey: e.target.value })}>
          <option value="status">Estado</option>
          <option value="title">Nombre del elemento</option>
          <option value="due">Vencimiento</option>
          <option value="assignee">Responsable</option>
          {(board?.columns ?? [])
            .filter((c) => !["mirror", "files", "checklist", "connect", "dependency"].includes(c.kind))
            .map((c) => (
              <option key={c.id} value={`c:${c.id}`}>
                {c.name}
              </option>
            ))}
        </Select>
      </Field>
      {connect && !board && <p className="text-xs text-muted sm:col-span-2">Guardá y volvé a abrir para ver también las columnas propias del tablero conectado.</p>}
    </div>
  );
}

/** Cargar la plantilla ahora en los elementos que todavía no tienen checklist. */
function ApplyTemplateNow({ columnId, templateId, templateName }: { columnId: string; templateId: string; templateName: string }) {
  const [step, setStep] = useState<"idle" | "confirm" | "running">("idle");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async () => {
    setStep("running");
    const res = await applyChecklistTemplateAction(columnId, templateId);
    setStep("idle");
    setResult(
      res.ok
        ? { ok: true, text: res.data.count ? `Listo: «${templateName}» se cargó en ${res.data.count} ${res.data.count === 1 ? "elemento" : "elementos"}.` : "Todos los elementos ya tenían checklist." }
        : { ok: false, text: res.error },
    );
  };
  return (
    <div className="rounded-lg bg-surface-2 p-3 text-sm">
      <p className="text-muted">La plantilla automática vale para los elementos nuevos. Para los que ya existen y no tienen pasos:</p>
      {step === "confirm" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-semibold">¿Cargar «{templateName}» en todos los elementos sin checklist?</span>
          <Button type="button" size="sm" onClick={run}>
            Sí, cargar
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setStep("idle")}>
            Cancelar
          </Button>
        </div>
      ) : (
        <Button type="button" size="sm" variant="secondary" className="mt-2" disabled={step === "running"} onClick={() => (setResult(null), setStep("confirm"))}>
          {step === "running" ? "Cargando…" : "Cargar en los elementos que no tienen checklist"}
        </Button>
      )}
      {result && (
        <p role="status" className={cn("mt-2 text-xs", result.ok ? "text-success" : "text-danger")}>
          {result.text}
        </p>
      )}
      <p className="mt-2 text-xs text-subtle">No cambia los elementos que ya tienen pasos ni los subelementos.</p>
    </div>
  );
}
