"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { IconDots, IconGrip, IconPlus, IconX } from "@/components/ui/icons";
import { COLUMN_KIND_LABELS } from "@/lib/columns";
import { CORE_TARGETS, FORM_COLUMN_KINDS, FREE_TYPE_LABELS, newQuestionId, targetLabel, targetOptions, type BoardForForm } from "@/lib/forms";
import { FREE_TYPES, isInput, type FormConfig, type InputSpec, type Question, type Rule, type RuleOp } from "@/lib/form-logic";

const RULE_OPS: { v: RuleOp; label: string; needsValue: boolean }[] = [
  { v: "is", label: "es", needsValue: true },
  { v: "is_not", label: "no es", needsValue: true },
  { v: "contains", label: "contiene", needsValue: true },
  { v: "gt", label: "es mayor a", needsValue: true },
  { v: "lt", label: "es menor a", needsValue: true },
  { v: "filled", label: "está respondida", needsValue: false },
  { v: "empty", label: "no está respondida", needsValue: false },
];

const field = "w-full rounded-lg border border-line bg-surface px-2.5 text-sm outline-none focus:border-accent";

/** Tipo legible de una pregunta. */
function typeLabel(q: Question, b: BoardForForm) {
  if (q.kind === "text") return "Texto";
  if (q.kind === "page") return "Salto de página";
  if (q.kind === "free") return `${FREE_TYPE_LABELS[q.freeType ?? "short"]} · va a la actualización`;
  const col = b.columns.find((c) => `col:${c.id}` === q.target);
  return col ? `Columna «${col.name}» (${COLUMN_KIND_LABELS[col.kind]})` : targetLabel(q.target, b);
}

export function QuestionsEditor({
  config,
  setConfig,
  board,
  specs,
  access,
  disabled,
}: {
  config: FormConfig;
  setConfig: (fn: (c: FormConfig) => FormConfig) => void;
  board: BoardForForm;
  specs: Record<string, InputSpec>;
  access: "public" | "members" | "password";
  disabled: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const qs = config.questions;
  const setQs = (next: Question[]) => setConfig((c) => ({ ...c, questions: next }));
  const update = (id: string, patch: Partial<Question>) => setQs(qs.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= qs.length || from === to) return;
    const next = [...qs];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    setQs(next);
  };
  const add = (q: Omit<Question, "id">) => {
    const nq = { ...q, id: newQuestionId() } as Question;
    setQs([...qs, nq]);
    setOpen(nq.id);
  };

  const used = new Set(qs.filter((q) => q.kind === "field").map((q) => q.target));
  const addItems: MenuItem[] = [
    { type: "label", label: "Completan un dato del elemento" },
    ...CORE_TARGETS.filter((t) => !used.has(t.target)).map((t) => ({ label: t.label, onSelect: () => add({ kind: "field", target: t.target, label: t.label }) })),
    ...board.columns
      .filter((c) => FORM_COLUMN_KINDS.includes(c.kind) && !used.has(`col:${c.id}`))
      .map((c) => ({ label: `${c.name} · ${COLUMN_KIND_LABELS[c.kind]}`, onSelect: () => add({ kind: "field", target: `col:${c.id}`, label: c.name }) })),
    { type: "separator" },
    { type: "label", label: "Preguntas libres (quedan en la actualización)" },
    ...FREE_TYPES.map((t) => ({
      label: FREE_TYPE_LABELS[t],
      onSelect: () => add({ kind: "free", freeType: t, label: "", ...(t === "choice" || t === "multi" ? { options: ["Opción 1", "Opción 2"] } : {}) }),
    })),
    { type: "separator" },
    { type: "label", label: "Contenido" },
    { label: "Bloque de texto", onSelect: () => add({ kind: "text", label: "Título de la sección", help: "" }) },
    { label: "Salto de página", onSelect: () => add({ kind: "page", label: "" }) },
  ];

  return (
    <div className="space-y-2">
      <ol className="space-y-2">
        {qs.map((q, i) => {
          const isOpen = open === q.id;
          const noSpec = isInput(q) && !specs[q.id];
          const items: MenuItem[] = [
            { label: "Subir", onSelect: () => move(i, i - 1), disabled: i === 0 },
            { label: "Bajar", onSelect: () => move(i, i + 1), disabled: i === qs.length - 1 },
            { label: "Duplicar", onSelect: () => setQs([...qs.slice(0, i + 1), { ...q, id: newQuestionId(), ...(q.kind === "field" ? { kind: "free" as const, freeType: "short" as const, target: undefined } : {}) }, ...qs.slice(i + 1)]) },
            { type: "separator" },
            { label: "Eliminar", danger: true, onSelect: () => setQs(qs.filter((x) => x.id !== q.id)) },
          ];
          if (q.kind === "page")
            return (
              <li
                key={q.id}
                draggable={!disabled}
                onDragStart={() => setDrag(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (drag !== null) move(drag, i);
                  setDrag(null);
                }}
                className="flex items-center gap-2 py-1 text-xs font-semibold uppercase tracking-wide text-subtle"
              >
                <span className="cursor-grab" aria-hidden>
                  <IconGrip size={14} />
                </span>
                <span className="h-px flex-1 bg-line-strong" />
                Página nueva
                <span className="h-px flex-1 bg-line-strong" />
                {!disabled && <Menu label="Opciones del salto de página" items={items} trigger={<IconDots size={14} />} triggerClassName="h-6 w-6 rounded text-muted hover:bg-surface-2" />}
              </li>
            );
          return (
            <li
              key={q.id}
              draggable={!disabled && !isOpen}
              onDragStart={() => setDrag(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (drag !== null) move(drag, i);
                setDrag(null);
              }}
              onDragEnd={() => setDrag(null)}
              className={cn("rounded-xl border bg-surface", isOpen ? "border-accent shadow-card" : "border-line", drag === i && "opacity-50")}
            >
              <div className="flex items-center gap-2 px-3 py-2">
                {!disabled && (
                  <span className="cursor-grab text-subtle" aria-hidden>
                    <IconGrip size={14} />
                  </span>
                )}
                <button type="button" onClick={() => setOpen(isOpen ? null : q.id)} aria-expanded={isOpen} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm font-semibold">
                    {q.label || <span className="text-muted">(sin texto)</span>}
                    {q.required && <span className="ml-1 text-accent">*</span>}
                  </span>
                  <span className="block truncate text-[11px] text-muted">
                    {typeLabel(q, board)}
                    {q.hidden && " · oculta"}
                    {q.showIf?.rules.length ? " · con condición" : ""}
                  </span>
                </button>
                {noSpec && (
                  <span className="shrink-0 rounded bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-warning" title="No se va a mostrar: revisá la configuración">
                    No se muestra
                  </span>
                )}
                {!disabled && <Menu label={`Opciones de ${q.label || "la pregunta"}`} items={items} trigger={<IconDots size={15} />} triggerClassName="h-7 w-7 rounded-md text-muted hover:bg-surface-2" />}
              </div>
              {isOpen && (
                <div className="space-y-3 border-t border-line px-3 py-3">
                  <QuestionDetails q={q} index={i} all={qs} board={board} specs={specs} access={access} update={(p) => update(q.id, p)} disabled={disabled} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {!disabled && (
        <Menu
          label="Agregar pregunta"
          align="start"
          className="flex w-full"
          items={addItems}
          trigger={
            <span className="flex items-center gap-1.5">
              <IconPlus size={15} /> Agregar pregunta o contenido
            </span>
          }
          triggerClassName="h-10 w-full justify-center rounded-xl border-2 border-dashed border-line-strong text-sm font-semibold text-accent hover:border-accent hover:bg-accent-soft"
        />
      )}
    </div>
  );
}

function QuestionDetails({
  q,
  index,
  all,
  board,
  specs,
  access,
  update,
  disabled,
}: {
  q: Question;
  index: number;
  all: Question[];
  board: BoardForForm;
  specs: Record<string, InputSpec>;
  access: "public" | "members" | "password";
  update: (p: Partial<Question>) => void;
  disabled: boolean;
}) {
  const spec = specs[q.id];
  const type = spec?.type ?? (q.kind === "free" ? q.freeType : undefined);
  const opts = q.kind === "field" && q.target ? targetOptions(q.target, board) : [];
  const isPeople = q.target === "assignee" || board.columns.some((c) => `col:${c.id}` === q.target && (c.kind === "person" || c.kind === "people"));

  if (q.kind === "text")
    return (
      <fieldset disabled={disabled} className="space-y-2">
        <label className="block text-xs font-semibold text-muted">
          Título
          <input className={cn(field, "mt-1 h-9")} value={q.label} maxLength={500} onChange={(e) => update({ label: e.target.value })} />
        </label>
        <label className="block text-xs font-semibold text-muted">
          Texto
          <textarea className={cn(field, "mt-1 py-2")} rows={3} maxLength={2000} value={q.help ?? ""} onChange={(e) => update({ help: e.target.value })} />
        </label>
        <ConditionEditor q={q} index={index} all={all} specs={specs} update={update} />
      </fieldset>
    );

  return (
    <fieldset disabled={disabled} className="space-y-3">
      <label className="block text-xs font-semibold text-muted">
        Pregunta
        <input className={cn(field, "mt-1 h-9 font-semibold text-fg")} value={q.label} maxLength={500} placeholder="Escribí la pregunta" onChange={(e) => update({ label: e.target.value })} />
      </label>
      <label className="block text-xs font-semibold text-muted">
        Ayuda (opcional)
        <input className={cn(field, "mt-1 h-9")} value={q.help ?? ""} maxLength={2000} placeholder="Un detalle para responder mejor" onChange={(e) => update({ help: e.target.value || undefined })} />
      </label>
      {type && ["short", "long", "number", "email", "phone", "url", "checkbox"].includes(type) && (
        <label className="block text-xs font-semibold text-muted">
          {type === "checkbox" ? "Texto junto a la casilla" : "Texto de ejemplo"}
          <input className={cn(field, "mt-1 h-9")} value={q.placeholder ?? ""} maxLength={200} onChange={(e) => update({ placeholder: e.target.value || undefined })} />
        </label>
      )}

      {q.kind === "free" && (q.freeType === "choice" || q.freeType === "multi") && (
        <label className="block text-xs font-semibold text-muted">
          Opciones (una por línea)
          <textarea
            className={cn(field, "mt-1 py-2")}
            rows={Math.min(8, Math.max(3, (q.options?.length ?? 0) + 1))}
            value={(q.options ?? []).join("\n")}
            onChange={(e) => update({ options: e.target.value.split("\n").map((s) => s.slice(0, 200)).slice(0, 100) })}
            onBlur={(e) => update({ options: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
          />
        </label>
      )}

      {opts.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted">
            Opciones que se muestran <span className="font-normal">({q.allowed?.length ? `${q.allowed.length} de ${opts.length}` : "todas"})</span>
          </p>
          {isPeople && access === "public" && !q.allowed?.length && (
            <p className="mt-1 rounded-md bg-warning-soft px-2 py-1 text-[11px] text-warning">En un formulario público hay que elegir qué personas se muestran (no se publica la lista completa del equipo).</p>
          )}
          <div className="mt-1 flex max-h-32 flex-wrap gap-1 overflow-y-auto">
            {opts.map((o) => {
              const on = q.allowed?.includes(o.value) ?? false;
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    const next = on ? (q.allowed ?? []).filter((x) => x !== o.value) : [...(q.allowed ?? []), o.value];
                    update({ allowed: next.length ? next : undefined });
                  }}
                  className={cn("flex max-w-48 items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[11px]", on ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line text-muted hover:text-fg")}
                >
                  {o.color && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: `var(--chip-${o.color}-dot)` }} />}
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={Boolean(q.required)} disabled={q.hidden} onChange={(e) => update({ required: e.target.checked || undefined })} />
          Obligatoria
        </label>
        <label className="flex items-center gap-2" title="No se muestra: toma el valor por defecto o el del enlace">
          <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={Boolean(q.hidden)} onChange={(e) => update({ hidden: e.target.checked || undefined, required: e.target.checked ? undefined : q.required })} />
          Oculta
        </label>
      </div>

      {type && ["short", "long", "number", "multi", "rating"].includes(type) && (
        <div className="grid grid-cols-2 gap-2">
          {type !== "rating" && (
            <label className="block text-xs font-semibold text-muted">
              {type === "number" ? "Mínimo" : type === "multi" ? "Elegir al menos" : "Mínimo de caracteres"}
              <input type="number" className={cn(field, "mt-1 h-9")} value={q.min ?? ""} onChange={(e) => update({ min: e.target.value === "" ? undefined : Number(e.target.value) })} />
            </label>
          )}
          <label className="block text-xs font-semibold text-muted">
            {type === "number" ? "Máximo" : type === "multi" ? "Elegir como máximo" : type === "rating" ? "Cantidad de estrellas" : "Máximo de caracteres"}
            <input type="number" min={type === "rating" ? 3 : undefined} max={type === "rating" ? 10 : undefined} className={cn(field, "mt-1 h-9")} value={q.max ?? ""} onChange={(e) => update({ max: e.target.value === "" ? undefined : Number(e.target.value) })} />
          </label>
        </div>
      )}

      <details className="rounded-lg bg-surface-2 px-2.5 py-2" open={Boolean(q.defaultValue || q.param)}>
        <summary className="cursor-pointer text-xs font-semibold">Valor por defecto y precarga desde el enlace</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-muted">
            Valor por defecto
            <input className={cn(field, "mt-1 h-9")} value={q.defaultValue ?? ""} maxLength={500} placeholder={spec?.options ? "Texto de la opción" : ""} onChange={(e) => update({ defaultValue: e.target.value || undefined })} />
          </label>
          <label className="block text-xs font-semibold text-muted">
            Parámetro del enlace
            <input
              className={cn(field, "mt-1 h-9 font-mono")}
              value={q.param ?? ""}
              maxLength={40}
              placeholder="ej.: origen"
              onChange={(e) => update({ param: e.target.value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || undefined })}
            />
          </label>
        </div>
        <p className="mt-1 text-[11px] text-subtle">Con «?{q.param || "parametro"}=valor» en el enlace, la respuesta llega completa. Ideal para saber de dónde viene cada pedido.</p>
      </details>

      <ConditionEditor q={q} index={index} all={all} specs={specs} update={update} />
    </fieldset>
  );
}

function ConditionEditor({ q, index, all, specs, update }: { q: Question; index: number; all: Question[]; specs: Record<string, InputSpec>; update: (p: Partial<Question>) => void }) {
  const earlier = all.slice(0, index).filter((x) => isInput(x) && specs[x.id]);
  const rules = q.showIf?.rules ?? [];
  const setRules = (next: Rule[]) => update({ showIf: next.length ? { mode: q.showIf?.mode ?? "all", rules: next } : undefined });
  if (!earlier.length) return <p className="text-[11px] text-subtle">Para mostrarla según otras respuestas, poné preguntas antes que esta.</p>;
  return (
    <div className="rounded-lg border border-dashed border-line-strong px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold">Mostrar solo si</span>
        {rules.length > 1 && (
          <select className={cn(field, "h-7 w-auto text-xs")} value={q.showIf?.mode ?? "all"} onChange={(e) => update({ showIf: { mode: e.target.value as "all" | "any", rules } })}>
            <option value="all">se cumplen todas</option>
            <option value="any">se cumple alguna</option>
          </select>
        )}
        {rules.length === 0 && <span className="text-muted">(siempre se muestra)</span>}
      </div>
      <ul className="mt-2 space-y-1.5">
        {rules.map((r, i) => {
          const ref = all.find((x) => x.id === r.q);
          const refSpec = ref ? specs[ref.id] : undefined;
          const op = RULE_OPS.find((o) => o.v === r.op);
          const set = (p: Partial<Rule>) => setRules(rules.map((x, j) => (j === i ? { ...x, ...p } : x)));
          return (
            <li key={i} className="flex flex-wrap items-center gap-1.5">
              <select className={cn(field, "h-8 min-w-0 flex-1 text-xs")} value={r.q} onChange={(e) => set({ q: e.target.value, value: undefined })} aria-label="Pregunta">
                {earlier.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label || "(sin texto)"}
                  </option>
                ))}
              </select>
              <select className={cn(field, "h-8 w-auto text-xs")} value={r.op} onChange={(e) => set({ op: e.target.value as RuleOp })} aria-label="Condición">
                {RULE_OPS.filter((o) => (o.v === "gt" || o.v === "lt" ? refSpec?.type === "number" || refSpec?.type === "rating" : true)).map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.label}
                  </option>
                ))}
              </select>
              {op?.needsValue &&
                (refSpec?.options?.length ? (
                  <select className={cn(field, "h-8 w-auto max-w-40 text-xs")} value={(r.value ?? "").toLowerCase()} onChange={(e) => set({ value: e.target.value })} aria-label="Valor">
                    <option value="">Elegí…</option>
                    {refSpec.options.map((o) => (
                      <option key={o.value} value={o.value.toLowerCase()}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : refSpec?.type === "yesno" || refSpec?.type === "checkbox" ? (
                  <select className={cn(field, "h-8 w-auto text-xs")} value={r.value ?? ""} onChange={(e) => set({ value: e.target.value })} aria-label="Valor">
                    <option value="">Elegí…</option>
                    <option value="true">Sí</option>
                    <option value="false">No</option>
                  </select>
                ) : (
                  <input className={cn(field, "h-8 w-28 text-xs")} value={r.value ?? ""} maxLength={200} onChange={(e) => set({ value: e.target.value })} aria-label="Valor" />
                ))}
              <button type="button" aria-label="Quitar condición" onClick={() => setRules(rules.filter((_, j) => j !== i))} className="rounded p-1 text-muted hover:text-danger">
                <IconX size={12} />
              </button>
            </li>
          );
        })}
      </ul>
      {rules.length < 10 && (
        <button type="button" onClick={() => setRules([...rules, { q: earlier[earlier.length - 1].id, op: "is" }])} className="mt-1.5 text-xs font-semibold text-accent hover:underline">
          + Agregar condición
        </button>
      )}
    </div>
  );
}
