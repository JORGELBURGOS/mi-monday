"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { displayName } from "@/lib/format";
import { Avatar } from "@/components/ui/misc";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { PopoverButton } from "@/components/ui/popover";
import { useToast } from "@/components/ui/toast";
import { IconCalendar, IconCheck, IconChevronDown, IconChevronRight, IconComment, IconDots, IconGrip, IconPlus, IconUser, IconX } from "@/components/ui/icons";
import {
  CHECK_STATUSES,
  CHECK_STATUS_LABELS,
  checklistProgress,
  cleanCheckItem,
  newOptionId,
  type CheckItem,
  type CheckStatus,
  type ChecklistTemplate,
} from "@/lib/columns";
import { createChecklistTemplateAction } from "@/app/actions/checklists";
import type { Member } from "./types";

const MAX_ITEMS = 300;

/** Fecha de hoy en Argentina (los vencimientos de los pasos no tienen hora). */
const todayAR = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
const shortDay = (v: string) => {
  const [y, m, d] = v.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-AR", { day: "numeric", month: "short", timeZone: "UTC" });
};

/**
 * Convierte texto pegado en pasos: una línea por paso; "## Título" o "Título:"
 * crea una sección; "[x]" / "- [x]" marca el paso como hecho.
 */
export function parseChecklistText(text: string): CheckItem[] {
  const out: CheckItem[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    if (/^#{1,6}\s+/.test(line)) {
      out.push(cleanCheckItem({ text: line.replace(/^#{1,6}\s+/, ""), header: true }));
      continue;
    }
    line = line.replace(/^([-*•]|\d+[.)])\s+/, "");
    let done = false;
    const m = line.match(/^\[([ xX✓])\]\s*/);
    if (m) {
      done = m[1] !== " ";
      line = line.slice(m[0].length);
    }
    if (!line) continue;
    if (/:$/.test(line) && !m && line.length <= 80) {
      out.push(cleanCheckItem({ text: line.slice(0, -1), header: true }));
      continue;
    }
    out.push(cleanCheckItem({ text: line, done }));
  }
  return out;
}

/** Texto plano del checklist (para copiar o compartir). */
export function checklistToText(items: CheckItem[], members: Member[] = []): string {
  return items
    .map((i) => {
      if (i.header) return `\n## ${i.text}`;
      const who = i.assignee ? members.find((m) => m.user_id === i.assignee) : undefined;
      const extra = [
        i.status && i.status !== "todo" ? CHECK_STATUS_LABELS[i.status].label : "",
        who ? `@${displayName(who)}` : "",
        i.due ? `vence ${i.due}` : "",
      ].filter(Boolean);
      return `[${i.done ? "x" : " "}] ${i.text}${extra.length ? ` (${extra.join(" · ")})` : ""}${i.note ? `\n    ${i.note}` : ""}`;
    })
    .join("\n")
    .trim();
}

export function fromTemplate(t: Pick<ChecklistTemplate, "items">): CheckItem[] {
  return t.items.map((i) => cleanCheckItem({ text: i.text, header: i.header, note: i.note }));
}

/**
 * Editor completo de checklist:
 * secciones, responsables, vencimientos, estados por paso, notas,
 * arrastrar para ordenar, plantillas, pegar listas y copiar como texto.
 */
export function ChecklistEditor({
  items,
  members,
  templates = [],
  workspaceId,
  disabled,
  template,
  onChange,
}: {
  items: CheckItem[];
  members: Member[];
  templates?: ChecklistTemplate[];
  workspaceId?: string;
  disabled?: boolean;
  /** Editando una plantilla: sin tildar, responsables, vencimientos ni estados. */
  template?: boolean;
  onChange: (next: CheckItem[]) => void;
}) {
  const toast = useToast();
  const [list, setList] = useState(items);
  const [text, setText] = useState("");
  const [hideDone, setHideDone] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [notesOpen, setNotesOpen] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<string | null>(null);
  const [saveAs, setSaveAs] = useState<string | null>(null);
  const [savingTpl, setSavingTpl] = useState(false);
  const dragId = useRef<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [today] = useState(todayAR);

  const save = (next: CheckItem[]) => {
    const capped = next.slice(0, MAX_ITEMS);
    setList(capped);
    onChange(capped);
  };
  const patch = (id: string, p: Partial<CheckItem>) => save(list.map((x) => (x.id === id ? cleanCheckItem({ ...x, ...p }) : x)));
  const remove = (id: string) => save(list.filter((x) => x.id !== id));
  const move = (id: string, delta: number) => {
    const i = list.findIndex((x) => x.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    save(next);
  };
  const add = (raw: string) => {
    const lines = raw.includes("\n") ? parseChecklistText(raw) : parseChecklistText(raw.trim());
    if (!lines.length) return;
    if (list.length + lines.length > MAX_ITEMS) toast.error(`Hasta ${MAX_ITEMS} pasos por checklist.`);
    save([...list, ...lines]);
  };

  const { done, total } = checklistProgress(list);
  const pct = total ? Math.round((done / total) * 100) : 0;

  // Secciones: cada paso pertenece al último encabezado anterior.
  const sectionOf = new Map<string, string>();
  const sectionStats = new Map<string, { done: number; total: number }>();
  let current: string | null = null;
  for (const i of list) {
    if (i.header) {
      current = i.id;
      sectionStats.set(i.id, { done: 0, total: 0 });
      continue;
    }
    if (current) {
      sectionOf.set(i.id, current);
      if (i.status !== "na") {
        const st = sectionStats.get(current)!;
        st.total++;
        if (i.done) st.done++;
      }
    }
  }
  const visible = list.filter((i) => {
    if (i.header) return true;
    const sec = sectionOf.get(i.id);
    if (sec && collapsed.has(sec)) return false;
    return !(hideDone && i.done);
  });

  const allDone = total > 0 && done === total;
  const toolsMenu: MenuItem[] = (template ? [] : [{ label: allDone ? "Destildar todos los pasos" : "Tildar todos los pasos", onSelect: () => save(list.map((x) => (x.header || x.status === "na" ? x : cleanCheckItem({ ...x, done: !allDone, status: !allDone ? undefined : x.status })))) , disabled: disabled || total === 0 }] as MenuItem[]).concat([
    { label: hideDone ? "Mostrar pasos hechos" : "Ocultar pasos hechos", onSelect: () => setHideDone((v) => !v) },
    { label: "Agregar sección", onSelect: () => save([...list, cleanCheckItem({ text: "Nueva sección", header: true })]), disabled },
    { label: "Pegar lista de pasos…", onSelect: () => setBulk(""), disabled },
    { type: "separator" },
    ...(templates.length
      ? ([
          { type: "label", label: "Agregar desde plantilla" },
          ...templates.map((t) => ({ label: t.name, onSelect: () => save([...list, ...fromTemplate(t)]), disabled })),
          { type: "separator" },
        ] as MenuItem[])
      : []),
    ...(template ? [] : [{ label: "Guardar como plantilla…", onSelect: () => setSaveAs(""), disabled: !workspaceId || list.length === 0 }]),
    {
      label: "Copiar como texto",
      onSelect: async () => {
        try {
          await navigator.clipboard.writeText(checklistToText(list, members));
          toast.success("Checklist copiado.");
        } catch {
          toast.error("No se pudo copiar.");
        }
      },
      disabled: list.length === 0,
    },
    { label: "Vaciar checklist", onSelect: () => save([]), danger: true, disabled: disabled || list.length === 0 },
  ]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-semibold text-muted">
              {total === 0 ? "Sin pasos" : template ? `${total} pasos` : `${done} de ${total} pasos`}
              {hideDone && done > 0 && <span className="ml-1 font-normal">· {done} ocultos</span>}
            </span>
            {!template && <span className={cn("font-bold tabular-nums", pct === 100 ? "text-success" : "text-fg")}>{pct}%</span>}
          </div>
          <div className={cn("mt-1 h-2 overflow-hidden rounded-full bg-surface-3", template && "hidden")} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Avance del checklist">
            <div className={cn("h-full rounded-full transition-[width]", pct === 100 ? "bg-success" : "bg-accent")} style={{ width: `${pct}%` }} />
          </div>
        </div>
        <Menu label="Opciones del checklist" trigger={<IconDots size={16} />} items={toolsMenu} triggerClassName="h-8 w-8 rounded-md border border-line hover:bg-surface-2" />
      </div>

      {saveAs !== null && (
        <form
          className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2 p-2.5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!workspaceId || !saveAs.trim()) return;
            setSavingTpl(true);
            const res = await createChecklistTemplateAction(workspaceId, {
              name: saveAs,
              items: list.map((i) => ({ text: i.text, header: i.header, note: i.note })),
            });
            setSavingTpl(false);
            if (!res.ok) toast.error(res.error);
            else {
              toast.success("Plantilla guardada.");
              setSaveAs(null);
            }
          }}
        >
          <input data-autofocus value={saveAs} onChange={(e) => setSaveAs(e.target.value)} maxLength={80} placeholder="Nombre de la plantilla" aria-label="Nombre de la plantilla" className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-sm" />
          <button type="submit" disabled={!saveAs.trim() || savingTpl} className="h-8 rounded-md bg-accent px-3 text-xs font-semibold text-accent-fg disabled:opacity-50">
            Guardar plantilla
          </button>
          <button type="button" onClick={() => setSaveAs(null)} className="h-8 rounded-md px-2 text-xs text-muted hover:bg-surface-3">
            Cancelar
          </button>
        </form>
      )}

      {bulk !== null && (
        <div className="space-y-2 rounded-xl border border-line bg-surface-2 p-2.5">
          <label htmlFor="ck-bulk" className="block text-xs text-muted">
            Un paso por línea. <code>## Título</code> crea una sección y <code>[x]</code> marca el paso como hecho.
          </label>
          <textarea id="ck-bulk" data-autofocus rows={6} value={bulk} onChange={(e) => setBulk(e.target.value)} className="w-full rounded-md border border-line bg-surface p-2 text-sm" placeholder={"## Antes de salir\nRevisar herramientas\n[x] Cargar combustible"} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setBulk(null)} className="h-8 rounded-md px-2 text-xs text-muted hover:bg-surface-3">
              Cancelar
            </button>
            <button
              type="button"
              disabled={!bulk.trim()}
              onClick={() => {
                add(bulk);
                setBulk(null);
              }}
              className="h-8 rounded-md bg-accent px-3 text-xs font-semibold text-accent-fg disabled:opacity-50"
            >
              Agregar {parseChecklistText(bulk).length || ""} pasos
            </button>
          </div>
        </div>
      )}

      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-3 py-5 text-center text-sm text-muted">
          Agregá los pasos de este elemento{templates.length ? ", o arrancá desde una plantilla en el menú ⋯" : ""}.
        </p>
      ) : (
        <ul className="space-y-0.5" aria-label="Pasos">
          {visible.map((i) => {
            const sec = i.header ? sectionStats.get(i.id) : undefined;
            const who = i.assignee ? members.find((m) => m.user_id === i.assignee) : undefined;
            const overdue = Boolean(i.due && !i.done && i.due < today);
            const idx = list.findIndex((x) => x.id === i.id);
            const itemMenu: MenuItem[] = [
              ...(!i.header && !template
                ? ([
                    { type: "label", label: "Estado del paso" },
                    ...CHECK_STATUSES.map((st) => ({
                      label: `${(i.status ?? "todo") === st ? "✓ " : ""}${CHECK_STATUS_LABELS[st].label}`,
                      onSelect: () => patch(i.id, { status: st, done: st === "na" ? false : i.done }),
                    })),
                    { type: "separator" },
                    { label: notesOpen.has(i.id) ? "Ocultar nota" : i.note ? "Ver nota" : "Agregar nota", onSelect: () => setNotesOpen((s) => toggle(s, i.id)) },
                  ] as MenuItem[])
                : []),
              { label: i.header ? "Convertir en paso" : "Convertir en sección", onSelect: () => patch(i.id, { header: !i.header }) },
              { label: "Duplicar", onSelect: () => save([...list.slice(0, idx + 1), cleanCheckItem({ ...i, id: newOptionId(), done: false }), ...list.slice(idx + 1)]) },
              { label: "Subir", onSelect: () => move(i.id, -1), disabled: idx === 0 },
              { label: "Bajar", onSelect: () => move(i.id, 1), disabled: idx === list.length - 1 },
              { type: "separator" },
              { label: i.header ? "Eliminar sección (deja los pasos)" : "Eliminar paso", onSelect: () => remove(i.id), danger: true },
            ];
            return (
              <li
                key={i.id}
                draggable={!disabled}
                onDragStart={(e) => {
                  dragId.current = i.id;
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  if (!dragId.current || dragId.current === i.id) return;
                  e.preventDefault();
                  setDragOver(i.id);
                }}
                onDragLeave={() => setDragOver((v) => (v === i.id ? null : v))}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = dragId.current;
                  dragId.current = null;
                  setDragOver(null);
                  if (!from || from === i.id) return;
                  const moving = list.find((x) => x.id === from)!;
                  const rest = list.filter((x) => x.id !== from);
                  const at = rest.findIndex((x) => x.id === i.id);
                  save([...rest.slice(0, at), moving, ...rest.slice(at)]);
                }}
                onDragEnd={() => {
                  dragId.current = null;
                  setDragOver(null);
                }}
                className={cn("group/i rounded-lg", dragOver === i.id && "ring-2 ring-accent", i.header ? "mt-2 bg-surface-2" : "hover:bg-surface-2")}
              >
                <div className="flex items-center gap-1.5 px-1 py-1">
                  {!disabled && (
                    <span className="cursor-grab text-subtle opacity-0 group-hover/i:opacity-100" aria-hidden>
                      <IconGrip size={14} />
                    </span>
                  )}
                  {i.header ? (
                    <button
                      type="button"
                      onClick={() => setCollapsed((s) => toggle(s, i.id))}
                      aria-expanded={!collapsed.has(i.id)}
                      aria-label={`${collapsed.has(i.id) ? "Expandir" : "Contraer"} sección ${i.text}`}
                      className="rounded p-0.5 text-muted hover:bg-surface-3"
                    >
                      {collapsed.has(i.id) ? <IconChevronRight size={14} /> : <IconChevronDown size={14} />}
                    </button>
                  ) : template ? (
                    <span className="mx-1 h-1.5 w-1.5 shrink-0 rounded-full bg-line-strong" aria-hidden />
                  ) : (
                    <input
                      type="checkbox"
                      checked={i.done}
                      disabled={disabled || i.status === "na"}
                      aria-label={`Hecho: ${i.text}`}
                      onChange={(e) => patch(i.id, { done: e.target.checked, status: e.target.checked ? undefined : i.status })}
                      className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                    />
                  )}
                  <ItemText
                    item={i}
                    disabled={disabled}
                    onCommit={(t) => (t ? patch(i.id, { text: t }) : remove(i.id))}
                  />
                  {sec && sec.total > 0 && (
                    <span className={cn("shrink-0 text-xs font-semibold tabular-nums", sec.done === sec.total ? "text-success" : "text-muted")}>
                      {sec.done}/{sec.total}
                    </span>
                  )}
                  {!i.header && i.status && i.status !== "todo" && (
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", `chip-${CHECK_STATUS_LABELS[i.status].color}`)}>{CHECK_STATUS_LABELS[i.status].label}</span>
                  )}
                  {!i.header && i.note && !notesOpen.has(i.id) && (
                    <button type="button" onClick={() => setNotesOpen((s) => toggle(s, i.id))} aria-label={`Ver nota de ${i.text}`} title={i.note} className="shrink-0 rounded p-0.5 text-muted hover:bg-surface-3">
                      <IconComment size={13} />
                    </button>
                  )}
                  {!i.header && !template && (
                    <DuePicker value={i.due} overdue={overdue} disabled={disabled} label={i.text} onChange={(due) => patch(i.id, { due })} />
                  )}
                  {!i.header && !template && (
                    <AssigneePicker who={who} members={members} disabled={disabled} label={i.text} onChange={(assignee) => patch(i.id, { assignee })} />
                  )}
                  {!disabled && (
                    <Menu
                      label={`Opciones de ${i.text}`}
                      trigger={<IconDots size={14} />}
                      items={itemMenu}
                      triggerClassName="h-6 w-6 shrink-0 rounded text-subtle opacity-0 hover:bg-surface-3 focus-visible:opacity-100 group-hover/i:opacity-100"
                    />
                  )}
                </div>
                {!i.header && notesOpen.has(i.id) && (
                  <div className="pb-1.5 pl-9 pr-2">
                    <textarea
                      defaultValue={i.note ?? ""}
                      disabled={disabled}
                      rows={2}
                      maxLength={1000}
                      aria-label={`Nota de ${i.text}`}
                      placeholder="Nota, instrucción o resultado del paso"
                      onBlur={(e) => {
                        if ((e.target.value.trim() || undefined) !== i.note) patch(i.id, { note: e.target.value });
                      }}
                      className="w-full rounded-md border border-line bg-surface p-2 text-xs"
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!disabled && list.length < MAX_ITEMS && (
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            add(text);
            setText("");
          }}
        >
          <input
            data-autofocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData("text");
              if (pasted.includes("\n")) {
                e.preventDefault();
                add(pasted);
              }
            }}
            maxLength={300}
            placeholder="Nuevo paso y Enter · “## ” para una sección · pegá una lista"
            aria-label="Nuevo paso"
            className="h-9 min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 text-sm"
          />
          <button type="submit" disabled={!text.trim()} aria-label="Agregar paso" className="flex h-9 items-center gap-1 rounded-md bg-accent px-3 text-xs font-semibold text-accent-fg disabled:opacity-50">
            <IconPlus size={14} /> Agregar
          </button>
        </form>
      )}
    </div>
  );
}

function toggle(s: Set<string>, id: string) {
  const n = new Set(s);
  if (n.has(id)) n.delete(id);
  else n.add(id);
  return n;
}

function ItemText({ item, disabled, onCommit }: { item: CheckItem; disabled?: boolean; onCommit: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const cls = cn("min-w-0 flex-1 text-sm", item.header && "font-bold", !item.header && item.done && "text-muted line-through", item.status === "na" && "text-subtle line-through");
  if (!editing || disabled)
    return (
      <span
        className={cn(cls, !disabled && "cursor-text rounded px-1 hover:bg-surface-3")}
        onClick={() => !disabled && setEditing(true)}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === "F2")) setEditing(true);
        }}
        tabIndex={disabled ? undefined : 0}
        role={disabled ? undefined : "button"}
        aria-label={disabled ? undefined : `Editar: ${item.text}`}
      >
        {item.text}
      </span>
    );
  return (
    <input
      autoFocus
      defaultValue={item.text}
      maxLength={300}
      aria-label="Texto del paso"
      onBlur={(e) => {
        setEditing(false);
        if (e.target.value.trim() !== item.text) onCommit(e.target.value.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          e.stopPropagation();
          (e.target as HTMLInputElement).value = item.text;
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={cn(cls, "h-7 rounded border border-line bg-surface px-1")}
    />
  );
}

function DuePicker({ value, overdue, disabled, label, onChange }: { value?: string; overdue: boolean; disabled?: boolean; label: string; onChange: (v: string | undefined) => void }) {
  return (
    <PopoverButton
      label={value ? `Vence ${value}: ${label}. Cambiar` : `Poner vencimiento a ${label}`}
      disabled={disabled}
      width={220}
      align="end"
      className={cn(
        "flex h-6 shrink-0 items-center gap-1 rounded px-1 text-[11px] font-semibold",
        value ? (overdue ? "text-danger" : "text-muted") : "text-subtle opacity-0 focus-visible:opacity-100 group-hover/i:opacity-100",
        !disabled && "hover:bg-surface-3",
      )}
      panel={(close) => (
        <div className="space-y-2">
          <input
            type="date"
            data-autofocus
            defaultValue={value ?? ""}
            aria-label="Fecha de vencimiento del paso"
            onChange={(e) => {
              if (e.target.value) {
                onChange(e.target.value);
                close();
              }
            }}
            className="h-9 w-full rounded-md border border-line bg-surface px-2 text-sm"
          />
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange(undefined);
                close();
              }}
              className="w-full rounded-md px-2 py-1.5 text-left text-xs text-muted hover:bg-surface-2"
            >
              Quitar vencimiento
            </button>
          )}
        </div>
      )}
    >
      <IconCalendar size={12} />
      {value && shortDay(value)}
    </PopoverButton>
  );
}

function AssigneePicker({ who, members, disabled, label, onChange }: { who?: Member; members: Member[]; disabled?: boolean; label: string; onChange: (v: string | undefined) => void }) {
  const [q, setQ] = useState("");
  const shown = members.filter((m) => displayName(m).toLowerCase().includes(q.toLowerCase())).slice(0, 50);
  return (
    <PopoverButton
      label={who ? `Responsable: ${displayName(who)}. Cambiar` : `Asignar responsable a ${label}`}
      disabled={disabled}
      width={240}
      align="end"
      className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full", !who && "text-subtle opacity-0 hover:bg-surface-3 focus-visible:opacity-100 group-hover/i:opacity-100")}
      panel={(close) => (
        <div className="space-y-1">
          <input data-autofocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar persona" aria-label="Buscar persona" className="mb-1 h-8 w-full rounded-md border border-line bg-surface px-2 text-sm" />
          <ul className="max-h-56 overflow-y-auto">
            {who && (
              <li>
                <button
                  type="button"
                  onClick={() => {
                    onChange(undefined);
                    close();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted hover:bg-surface-2"
                >
                  <IconX size={14} /> Sin responsable
                </button>
              </li>
            )}
            {shown.map((m) => (
              <li key={m.user_id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(m.user_id);
                    close();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                >
                  <Avatar name={displayName(m)} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{displayName(m)}</span>
                  {who?.user_id === m.user_id && <IconCheck size={14} />}
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="px-2 py-1.5 text-sm text-muted">Sin resultados</li>}
          </ul>
        </div>
      )}
    >
      {who ? <Avatar name={displayName(who)} size="sm" className="!h-6 !w-6 !text-[10px]" /> : <IconUser size={14} />}
    </PopoverButton>
  );
}

export type { CheckStatus };
