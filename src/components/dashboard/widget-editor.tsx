"use client";

import { useId, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormAlert, Input, Select, Textarea } from "@/components/ui/form";
import { IconPlus, IconX } from "@/components/ui/icons";
import { fieldCatalog, isTimeField, numberFields, optionsOf, type Dataset, type GlobalFilters } from "@/lib/dashboard-engine";
import {
  ALLOWS_SPLIT,
  COND_LABELS,
  DATE_OPS,
  METRIC_LABELS,
  METRIC_OPS,
  NEEDS_DIM,
  NEEDS_SPLIT,
  PERIOD_LABELS,
  PERIODS,
  STATE_LABELS,
  STATES,
  VALUE_OPS,
  WIDGET_LABELS,
  WIDGET_TYPES,
  widgetSchema,
  type Condition,
  type MetricOp,
  type Period,
  type StateFilter,
  type Widget,
  type WidgetType,
} from "@/lib/dashboards";
import { WidgetCard } from "./widget-card";

const NO_FILTERS: GlobalFilters = { boards: [], assignee: "", state: "all" };

/** Ícono simple por tipo de widget (para el selector). */
function TypeGlyph({ t }: { t: WidgetType }) {
  const c = "var(--series-1)";
  const c2 = "var(--series-2)";
  return (
    <svg width="34" height="22" viewBox="0 0 34 22" aria-hidden>
      {t === "kpi" && <text x="17" y="16" textAnchor="middle" fontSize="14" fontWeight="800" fill="currentColor">42</text>}
      {t === "bar" && [4, 12, 20, 28].map((x, i) => <rect key={x} x={x} y={[10, 4, 13, 7][i]} width="5" height={[12, 18, 9, 15][i]} rx="1.5" fill={c} />)}
      {t === "hbar" && [2, 8, 14].map((y, i) => <rect key={y} x="2" y={y} width={[28, 20, 12][i]} height="4.5" rx="1.5" fill={c} />)}
      {t === "stacked" && [5, 14, 23].map((x, i) => (
        <g key={x}>
          <rect x={x} y={[8, 4, 11][i]} width="6" height={[7, 9, 5][i]} fill={c} />
          <rect x={x} y={[15.5, 13.5, 16.5][i]} width="6" height={[6.5, 8.5, 5.5][i]} fill={c2} />
        </g>
      ))}
      {(t === "line" || t === "area") && (
        <>
          {t === "area" && <path d="M2,18 L10,10 L18,13 L26,5 L32,8 L32,21 L2,21Z" fill={c} opacity=".2" />}
          <path d="M2,18 L10,10 L18,13 L26,5 L32,8" fill="none" stroke={c} strokeWidth="2" />
        </>
      )}
      {(t === "pie" || t === "donut") && (
        <>
          <circle cx="17" cy="11" r="9" fill={c} />
          <path d="M17,11 L17,2 A9,9 0 0 1 25.5,14Z" fill={c2} />
          {t === "donut" && <circle cx="17" cy="11" r="4.5" fill="var(--surface)" />}
        </>
      )}
      {t === "progress" && [3, 10, 17].map((y) => (
        <g key={y}>
          <rect x="2" y={y} width="18" height="4" fill={c} />
          <rect x="21" y={y} width="11" height="4" fill={c2} />
        </g>
      ))}
      {(t === "pivot" || t === "list") && [2, 8, 14].map((y) => <rect key={y} x="2" y={y} width="30" height="4" rx="1" fill="currentColor" opacity={y === 2 ? 0.6 : 0.25} />)}
      {t === "text" && <text x="17" y="16" textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor">Aa</text>}
    </svg>
  );
}

export function WidgetEditor({ ds, initial, onClose, onSave }: { ds: Dataset; initial: Widget; onClose: () => void; onSave: (w: Widget) => void }) {
  const uid = useId();
  const [w, setW] = useState<Widget>(initial);
  const [error, setError] = useState<string | null>(null);
  const catalog = useMemo(() => fieldCatalog(ds), [ds]);
  const numFields = useMemo(() => numberFields(ds), [ds]);
  const groupable = catalog.filter((f) => f.type !== "number");
  const set = (patch: Partial<Widget>) => setW((x) => ({ ...x, ...patch }));
  const setOpt = (patch: Partial<Widget["options"]>) => setW((x) => ({ ...x, options: { ...x.options, ...patch } }));
  const setFilters = (patch: Partial<Widget["filters"]>) => setW((x) => ({ ...x, filters: { ...x.filters, ...patch } }));

  const needsDim = NEEDS_DIM.includes(w.type);
  const canSplit = ALLOWS_SPLIT.includes(w.type);
  const needsSplit = NEEDS_SPLIT.includes(w.type);
  const timeDim = isTimeField(w.dim?.field);
  const usesMetric = w.type !== "list" && w.type !== "text";
  const metricNeedsField = w.metric.op !== "count" && w.metric.op !== "pct_done";

  const changeType = (t: WidgetType) =>
    setW((x) => {
      const next: Widget = { ...x, type: t };
      if (NEEDS_DIM.includes(t) && !x.dim) next.dim = { field: t === "line" || t === "area" ? "created" : "status", ...(t === "line" || t === "area" ? { period: "week" as Period } : {}) };
      if (NEEDS_SPLIT.includes(t) && !x.split) next.split = { field: x.dim?.field === "status" ? "board" : "status" };
      if (!ALLOWS_SPLIT.includes(t)) next.split = undefined;
      if (t === "kpi") next.rows = 2;
      if (t === "kpi" && x.w > 4) next.w = 3;
      if (t !== "kpi" && x.type === "kpi") {
        next.rows = 4;
        next.w = 6;
      }
      if (t === "list" && !x.options.fields) next.options = { ...x.options, fields: ["board", "assignee", "due"], limit: 20 };
      return next;
    });

  const save = () => {
    const parsed = widgetSchema.safeParse(w);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Revisá la configuración.");
    if (metricNeedsField && usesMetric && !w.metric.field) return setError("Elegí la columna numérica a calcular.");
    if (needsSplit && !w.split?.field) return setError("Elegí la segunda categoría.");
    onSave(parsed.data);
  };

  return (
    <Dialog open onClose={onClose} title="Configurar widget" size="xl">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          {error && <FormAlert>{error}</FormAlert>}

          <fieldset>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">Tipo</legend>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
              {WIDGET_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={w.type === t}
                  title={WIDGET_LABELS[t].help}
                  onClick={() => changeType(t)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[11px] font-semibold",
                    w.type === t ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:border-line-strong hover:text-fg",
                  )}
                >
                  <TypeGlyph t={t} />
                  {WIDGET_LABELS[t].label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-muted">{WIDGET_LABELS[w.type].help}</p>
          </fieldset>

          <Field id={`${uid}-title`} label="Título">
            <Input id={`${uid}-title`} value={w.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} />
          </Field>

          {w.type === "text" && (
            <Field id={`${uid}-text`} label="Texto" hint="Opcional">
              <Textarea id={`${uid}-text`} rows={4} maxLength={2000} value={w.options.text ?? ""} onChange={(e) => setOpt({ text: e.target.value })} />
            </Field>
          )}

          {w.type !== "text" && (
            <fieldset className="space-y-3">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">Datos</legend>
              {needsDim && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id={`${uid}-dim`} label={w.type === "pie" || w.type === "donut" ? "Porciones por" : w.type === "progress" || w.type === "pivot" ? "Filas" : "Agrupar por (eje)"}>
                    <Select id={`${uid}-dim`} value={w.dim?.field ?? ""} onChange={(e) => set({ dim: { field: e.target.value, ...(isTimeField(e.target.value) ? { period: w.dim?.period ?? "month" } : {}) } })}>
                      {groupable.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {timeDim && (
                    <Field id={`${uid}-period`} label="Período">
                      <Select id={`${uid}-period`} value={w.dim?.period ?? "month"} onChange={(e) => set({ dim: { field: w.dim!.field, period: e.target.value as Period } })}>
                        {PERIODS.map((p) => (
                          <option key={p} value={p}>
                            {PERIOD_LABELS[p]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                  {canSplit && (
                    <Field id={`${uid}-split`} label={w.type === "pivot" ? "Columnas" : w.type === "progress" ? "Dividir cada barra por" : "Dividir en series por"} hint={needsSplit ? undefined : "Opcional"}>
                      <Select id={`${uid}-split`} value={w.split?.field ?? ""} onChange={(e) => set({ split: e.target.value ? { field: e.target.value, ...(isTimeField(e.target.value) ? { period: "month" as Period } : {}) } : undefined })}>
                        {!needsSplit && <option value="">— Una sola serie —</option>}
                        {groupable
                          .filter((f) => f.key !== w.dim?.field)
                          .map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.label}
                            </option>
                          ))}
                      </Select>
                    </Field>
                  )}
                </div>
              )}
              {usesMetric && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id={`${uid}-op`} label="Valor">
                    <Select id={`${uid}-op`} value={w.metric.op} onChange={(e) => set({ metric: { op: e.target.value as MetricOp, field: w.metric.field ?? numFields[0]?.key } })}>
                      {METRIC_OPS.filter((op) => numFields.length || op === "count" || op === "pct_done").map((op) => (
                        <option key={op} value={op}>
                          {METRIC_LABELS[op]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {metricNeedsField && (
                    <Field id={`${uid}-mf`} label="Columna">
                      <Select id={`${uid}-mf`} value={w.metric.field ?? ""} onChange={(e) => set({ metric: { ...w.metric, field: e.target.value } })}>
                        {numFields.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                </div>
              )}
              {w.type === "list" && (
                <div>
                  <p className="mb-1.5 text-sm font-semibold">Columnas a mostrar</p>
                  <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-line p-2">
                    {catalog.map((f) => {
                      const on = (w.options.fields ?? []).includes(f.key);
                      return (
                        <label key={f.key} className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 accent-[var(--accent)]"
                            checked={on}
                            disabled={!on && (w.options.fields ?? []).length >= 8}
                            onChange={(e) => setOpt({ fields: e.target.checked ? [...(w.options.fields ?? []), f.key] : (w.options.fields ?? []).filter((x) => x !== f.key) })}
                          />
                          <span className="truncate">{f.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </fieldset>
          )}

          {w.type !== "text" && <FiltersEditor uid={uid} ds={ds} w={w} setFilters={setFilters} />}

          {w.type !== "text" && (
            <fieldset className="space-y-3">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">Presentación</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                {needsDim && !timeDim && w.type !== "progress" && (
                  <Field id={`${uid}-sort`} label="Orden">
                    <Select id={`${uid}-sort`} value={w.options.sort ?? "label"} onChange={(e) => setOpt({ sort: e.target.value as Widget["options"]["sort"] })}>
                      <option value="label">Natural</option>
                      <option value="value_desc">Mayor a menor</option>
                      <option value="value_asc">Menor a mayor</option>
                    </Select>
                  </Field>
                )}
                {((needsDim && !timeDim) || w.type === "list") && (
                  <Field id={`${uid}-limit`} label={w.type === "list" ? "Máximo de filas" : "Máximo de categorías"} hint="Opcional">
                    <Input
                      id={`${uid}-limit`}
                      type="number"
                      min={1}
                      max={100}
                      value={w.options.limit ?? ""}
                      onChange={(e) => setOpt({ limit: e.target.value ? Math.min(100, Math.max(1, Number(e.target.value))) : undefined })}
                    />
                  </Field>
                )}
                {usesMetric && w.metric.op !== "pct_done" && (
                  <>
                    <Field id={`${uid}-pre`} label="Prefijo" hint="Ej.: $">
                      <Input id={`${uid}-pre`} maxLength={6} value={w.options.prefix ?? ""} onChange={(e) => setOpt({ prefix: e.target.value || undefined })} />
                    </Field>
                    <Field id={`${uid}-suf`} label="Sufijo" hint="Ej.: hs">
                      <Input id={`${uid}-suf`} maxLength={10} value={w.options.suffix ?? ""} onChange={(e) => setOpt({ suffix: e.target.value || undefined })} />
                    </Field>
                  </>
                )}
                {usesMetric && (
                  <Field id={`${uid}-dec`} label="Decimales">
                    <Select id={`${uid}-dec`} value={w.options.decimals ?? ""} onChange={(e) => setOpt({ decimals: e.target.value === "" ? undefined : Number(e.target.value) })}>
                      <option value="">Automático</option>
                      {[0, 1, 2, 3, 4].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {w.type === "kpi" && (
                  <Field id={`${uid}-goal`} label="Meta" hint="Opcional">
                    <Input id={`${uid}-goal`} type="number" value={w.options.goal ?? ""} onChange={(e) => setOpt({ goal: e.target.value === "" ? undefined : Number(e.target.value) })} />
                  </Field>
                )}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                {["bar", "hbar", "stacked"].includes(w.type) && (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={w.options.showValues ?? w.type === "hbar"} onChange={(e) => setOpt({ showValues: e.target.checked })} />
                    Mostrar valores
                  </label>
                )}
                {timeDim && ["bar", "line", "area"].includes(w.type) && (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={Boolean(w.options.cumulative)} onChange={(e) => setOpt({ cumulative: e.target.checked })} />
                    Acumulado
                  </label>
                )}
                {timeDim && (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={Boolean(w.options.emptyCategories)} onChange={(e) => setOpt({ emptyCategories: e.target.checked })} />
                    Incluir los que no tienen fecha
                  </label>
                )}
              </div>
            </fieldset>
          )}
        </div>

        <div className="lg:sticky lg:top-0 lg:self-start">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">Vista previa</p>
          <div className="dash-grid !grid-cols-1">
            <WidgetCard
              w={{ ...w, w: 12 }}
              ds={ds}
              filters={NO_FILTERS}
              editing={false}
              onEdit={() => {}}
              onChange={() => {}}
              onDuplicate={() => {}}
              onRemove={() => {}}
              onMove={() => {}}
            />
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 -mx-5 -mb-4 mt-6 flex flex-col-reverse gap-2 border-t border-line bg-surface px-5 py-3 sm:flex-row sm:justify-end">
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" onClick={save}>
          Aplicar
        </Button>
      </div>
    </Dialog>
  );
}

function FiltersEditor({ uid, ds, w, setFilters }: { uid: string; ds: Dataset; w: Widget; setFilters: (p: Partial<Widget["filters"]>) => void }) {
  const catalog = useMemo(() => fieldCatalog(ds).filter((f) => f.type !== "number"), [ds]);
  const f = w.filters;
  const setCond = (i: number, patch: Partial<Condition>) => setFilters({ conditions: f.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">Filtros</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${uid}-state`} label="Elementos">
          <Select id={`${uid}-state`} value={f.state} onChange={(e) => setFilters({ state: e.target.value as StateFilter })}>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {STATE_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={f.subitems} onChange={(e) => setFilters({ subitems: e.target.checked })} />
          Incluir subelementos
        </label>
      </div>
      <div>
        <p className="mb-1.5 text-sm font-semibold">Tableros</p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            aria-pressed={f.boards.length === 0}
            onClick={() => setFilters({ boards: [] })}
            className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", f.boards.length === 0 ? "border-accent bg-accent-soft text-accent" : "border-line text-muted")}
          >
            Todos
          </button>
          {ds.boards.map((b) => {
            const on = f.boards.includes(b.id);
            return (
              <button
                key={b.id}
                type="button"
                aria-pressed={on}
                onClick={() => setFilters({ boards: on ? f.boards.filter((x) => x !== b.id) : [...f.boards, b.id] })}
                className={cn("max-w-48 truncate rounded-full border px-2.5 py-1 text-xs font-semibold", on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg")}
              >
                {b.name}
              </button>
            );
          })}
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-semibold">Condiciones</p>
        {f.conditions.map((c, i) => {
          const isDate = isTimeField(c.field);
          const ops = isDate ? DATE_OPS : VALUE_OPS;
          return (
            <div key={i} className="rounded-lg border border-line p-2">
              <div className="flex flex-wrap items-center gap-2">
                <Select aria-label="Campo" className="!h-8 min-w-0 flex-1 text-xs" value={c.field} onChange={(e) => setCond(i, { field: e.target.value, op: isTimeField(e.target.value) ? "last_days" : "is", values: [] })}>
                  {catalog.map((x) => (
                    <option key={x.key} value={x.key}>
                      {x.label}
                    </option>
                  ))}
                </Select>
                <Select aria-label="Operador" className="!h-8 w-40 text-xs" value={c.op} onChange={(e) => setCond(i, { op: e.target.value as Condition["op"] })}>
                  {ops.map((o) => (
                    <option key={o} value={o}>
                      {COND_LABELS[o]}
                    </option>
                  ))}
                </Select>
                {(c.op === "last_days" || c.op === "next_days") && (
                  <Input aria-label="Días" type="number" min={0} max={3650} className="!h-8 w-20 text-xs" value={c.values[0] ?? "30"} onChange={(e) => setCond(i, { values: [e.target.value] })} />
                )}
                <button type="button" aria-label="Quitar condición" onClick={() => setFilters({ conditions: f.conditions.filter((_, j) => j !== i) })} className="rounded p-1 text-muted hover:text-danger">
                  <IconX size={14} />
                </button>
              </div>
              {(c.op === "is" || c.op === "is_not") && !isDate && (
                <div className="mt-2 flex max-h-28 flex-wrap gap-1 overflow-y-auto">
                  {optionsOf(ds, c.field).map((o) => {
                    const on = c.values.includes(o.key);
                    return (
                      <button
                        key={o.key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setCond(i, { values: on ? c.values.filter((v) => v !== o.key) : [...c.values, o.key] })}
                        className={cn("max-w-40 truncate rounded-full border px-2 py-0.5 text-[11px]", on ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line text-muted hover:text-fg")}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {f.conditions.length < 10 && (
          <Button size="sm" variant="ghost" onClick={() => setFilters({ conditions: [...f.conditions, { field: "status", op: "is", values: [] }] })}>
            <IconPlus size={14} /> Agregar condición
          </Button>
        )}
      </div>
    </fieldset>
  );
}
