// Pruebas del motor de dashboards: npx tsx tests/dashboard-engine.test.ts
import { computeWidget, fieldCatalog, filterTasks, formatValue, optionsOf, type Dataset } from "@/lib/dashboard-engine";
import { blankWidget, templateWidgets, widgetSchema } from "@/lib/dashboards";
const st = (id: string, label: string, color: string, is_done = false, position = 0) => ({ id, label, color, is_done, position });
const col = (id: string, name: string, kind: string, options: unknown[] = []) => ({ id, board_id: "b", name, kind, options, settings: {}, position: 0, created_at: "", hidden: false } as never);
const ds: Dataset = {
  today: "2026-10-24",
  members: [{ user_id: "u1", full_name: "Ana", email: null }, { user_id: "u2", full_name: "Beto", email: null }],
  boards: [
    { id: "b1", name: "Ventas", statuses: [st("s1", "No iniciado", "gray", false, 0), st("s2", "En curso", "blue", false, 1), st("s3", "Listo", "green", true, 2)], groups: [{ id: "g1", name: "Q4", position: 0 }], columns: [col("c1", "Monto", "number"), col("c2", "Región", "list", [{ id: "o1", label: "Norte", color: "blue" }, { id: "o2", label: "Sur", color: "red" }])] },
    { id: "b2", name: "Compras", statuses: [st("t1", "No iniciado", "gray", false, 0), st("t3", "Listo", "green", true, 1)], groups: [{ id: "g2", name: "Q4", position: 0 }], columns: [col("d1", "monto ", "number")] },
  ],
  tasks: [],
};
const task = (id: string, board_id: string, status_id: string, extra: Partial<Dataset["tasks"][number]> = {}) => ({ id, board_id, group_id: board_id === "b1" ? "g1" : "g2", status_id, parent_id: null, title: id, priority: "medium", assignee_id: "u1", due_date: null, created_on: "2026-10-01", updated_on: "2026-10-20", done_on: null, values: {}, ...extra });
ds.tasks = [
  task("a", "b1", "s1", { values: { c1: 100, c2: "o1" }, due_date: "2026-10-20" }),
  task("b", "b1", "s2", { values: { c1: 50, c2: "o2" }, assignee_id: "u2", due_date: "2026-10-28" }),
  task("c", "b1", "s3", { values: { c1: 25 }, done_on: "2026-10-13" }),
  task("d", "b2", "t1", { values: { d1: 10 }, assignee_id: null }),
  task("e", "b2", "t3", { values: { d1: 5 }, done_on: "2026-10-22" }),
  task("f", "b2", "t1", { parent_id: "d" }),
];
const ok = (c: boolean, m: string) => { if (!c) { console.error("FALLÓ", m); process.exitCode = 1; } else console.log("ok", m); };
const W = (x: object) => widgetSchema.parse({ id: "x", ...x });

let r = computeWidget(ds, W({ type: "kpi" }));
ok(r.kind === "kpi" && r.value === 5, "KPI cuenta sin subelementos");
r = computeWidget(ds, W({ type: "kpi", filters: { subitems: true } }));
ok(r.kind === "kpi" && r.value === 6, "KPI con subelementos");
r = computeWidget(ds, W({ type: "kpi", metric: { op: "pct_done" } }));
ok(r.kind === "kpi" && r.value === 40, "% terminado = 40");
r = computeWidget(ds, W({ type: "kpi", metric: { op: "sum", field: "col:monto|number" } }));
ok(r.kind === "kpi" && r.value === 190, "suma une columnas de igual nombre en tableros distintos");
r = computeWidget(ds, W({ type: "kpi", filters: { state: "overdue" } }));
ok(r.kind === "kpi" && r.value === 1, "vencidos");
r = computeWidget(ds, W({ type: "kpi", filters: { state: "open", conditions: [{ field: "due", op: "next_days", values: ["7"] }] } }));
ok(r.kind === "kpi" && r.value === 1, "vencen en 7 días");

r = computeWidget(ds, W({ type: "bar", dim: { field: "status" } }));
ok(r.kind === "series" && r.categories.map((c) => c.label).join(",") === "No iniciado,En curso,Listo" && r.values[0].join(",") === "2,1,2", "estados se unen por nombre entre tableros");
r = computeWidget(ds, W({ type: "stacked", dim: { field: "board" }, split: { field: "status" } }));
ok(r.kind === "series" && r.series.length === 3 && r.totals.join(",") === "3,2", "apiladas tablero × estado");
r = computeWidget(ds, W({ type: "line", dim: { field: "done_at", period: "week" }, filters: { state: "done" } }));
ok(r.kind === "series" && r.categories.length === 2 && r.values[0].join(",") === "1,1", "por semana con huecos completos");
r = computeWidget(ds, W({ type: "line", dim: { field: "created", period: "day" }, options: { cumulative: true } }));
ok(r.kind === "series" && r.values[0][0] === 5, "acumulado");
r = computeWidget(ds, W({ type: "hbar", dim: { field: "assignee" }, options: { sort: "value_desc" } }));
ok(r.kind === "series" && r.categories[0].label === "Ana" && r.categories.some((c) => c.label === "Sin responsable"), "ranking por persona");
r = computeWidget(ds, W({ type: "pie", dim: { field: "col:region|list" } }));
ok(r.kind === "series" && r.categories.some((c) => c.label === "Norte" && c.fill.includes("chip-blue")), "color de la etiqueta");
r = computeWidget(ds, W({ type: "bar", dim: { field: "board" }, metric: { op: "avg", field: "col:monto|number" } }));
ok(r.kind === "series" && r.values[0][0]?.toFixed(2) === "58.33" && r.values[0][1] === 7.5, "promedio por tablero");
r = computeWidget(ds, W({ type: "list", filters: { state: "open" } }));
ok(r.kind === "list" && r.total === 3 && r.tasks[0].id === "a", "lista ordenada por vencimiento");
r = computeWidget(ds, W({ type: "bar", dim: { field: "status" }, filters: { conditions: [{ field: "board", op: "is", values: ["b2"] }] } }));
ok(r.kind === "series" && r.totals.reduce((a, b) => (a ?? 0) + (b ?? 0), 0) === 2, "filtro por tablero");
ok(filterTasks(ds, W({ type: "kpi" }), { boards: [], assignee: "__none", state: "all" }).length === 1, "filtro general sin responsable");
ok(fieldCatalog(ds).some((f) => f.key === "col:region|list"), "catálogo incluye columnas");
ok(optionsOf(ds, "status").length === 3, "opciones de estado unidas");
ok(formatValue(1234.5, W({ type: "kpi", options: { prefix: "$" } })) === "$1234,5" || formatValue(1234.5, W({ type: "kpi", options: { prefix: "$" } })) === "$1.234,5", "formato");
for (const w of templateWidgets("summary")) computeWidget(ds, w);
for (const t of ["kpi","bar","hbar","stacked","line","area","pie","donut","progress","pivot","list","text"] as const) computeWidget(ds, blankWidget(t));
ok(true, "plantilla y widgets por defecto calculan sin errores");
