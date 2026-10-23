import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getWorkspace, getWorkspaceMembers } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation";
import { cn } from "@/lib/cn";
import { asColor } from "@/lib/constants";
import { displayName } from "@/lib/format";
import { Avatar, Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { IconChart } from "@/components/ui/icons";

export const metadata: Metadata = { title: "Dashboard" };

const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Fecha de hoy en Argentina (las fechas de vencimiento no tienen hora). */
function todayAR() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

const shortDate = (v: string) => {
  const [y, m, d] = v.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-AR", { day: "numeric", month: "short", timeZone: "UTC" });
};

export default async function DashboardPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  if (!uuidSchema.safeParse(workspaceId).success) notFound();
  const user = await requireUser(`/e/${workspaceId}/dashboard`);
  const workspace = await getWorkspace(workspaceId, user.id);
  if (!workspace) notFound();

  const supabase = await createClient();
  const { data: boards } = await supabase.from("boards").select("id, name").eq("workspace_id", workspaceId).eq("is_archived", false).order("name");
  const ids = (boards ?? []).map((b) => b.id);
  const [{ data: statuses }, { data: tasks }, members] = await Promise.all([
    ids.length ? supabase.from("board_statuses").select("id, board_id, label, color, is_done, position").in("board_id", ids).order("position") : Promise.resolve({ data: [] }),
    ids.length
      ? supabase.from("tasks").select("id, title, board_id, status_id, due_date, assignee_id, parent_id").in("board_id", ids).is("parent_id", null).limit(10000)
      : Promise.resolve({ data: [] }),
    getWorkspaceMembers(workspaceId),
  ]);

  const st = statuses ?? [];
  const all = tasks ?? [];
  const doneIds = new Set(st.filter((s) => s.is_done).map((s) => s.id));
  const isDone = (t: { status_id: string | null }) => Boolean(t.status_id && doneIds.has(t.status_id));
  const today = todayAR();
  const in7 = iso(new Date(Date.parse(`${today}T00:00:00Z`) + 7 * DAY));
  const in14 = iso(new Date(Date.parse(`${today}T00:00:00Z`) + 14 * DAY));

  const open = all.filter((t) => !isDone(t));
  const overdue = open.filter((t) => t.due_date && t.due_date < today).sort((a, b) => a.due_date!.localeCompare(b.due_date!));
  const thisWeek = open.filter((t) => t.due_date && t.due_date >= today && t.due_date <= in7);
  const upcoming = open.filter((t) => t.due_date && t.due_date >= today && t.due_date <= in14).sort((a, b) => a.due_date!.localeCompare(b.due_date!));
  const doneCount = all.length - open.length;
  const boardName = new Map((boards ?? []).map((b) => [b.id, b.name]));

  const perBoard = (boards ?? []).map((b) => {
    const list = all.filter((t) => t.board_id === b.id);
    const bs = st.filter((s) => s.board_id === b.id);
    return {
      ...b,
      total: list.length,
      done: list.filter(isDone).length,
      overdue: list.filter((t) => !isDone(t) && t.due_date && t.due_date < today).length,
      parts: [
        ...bs.map((s) => ({ label: s.label, color: asColor(s.color), n: list.filter((t) => t.status_id === s.id).length })),
        { label: "Sin estado", color: null, n: list.filter((t) => !t.status_id).length },
      ].filter((p) => p.n > 0),
    };
  });

  const perPerson = members
    .map((m) => {
      const mine = open.filter((t) => t.assignee_id === m.user_id);
      return { m, open: mine.length, overdue: mine.filter((t) => t.due_date && t.due_date < today).length };
    })
    .filter((p) => p.open > 0)
    .sort((a, b) => b.open - a.open);
  const unassigned = open.filter((t) => !t.assignee_id).length;
  const maxLoad = Math.max(1, ...perPerson.map((p) => p.open), unassigned);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8">
      <PageHeader eyebrow={workspace.name} title="Dashboard" description="Cómo viene el trabajo en todos los tableros que ves de la empresa." />

      {all.length === 0 ? (
        <EmptyState icon={<IconChart />} title="Todavía no hay elementos" description="Cuando los tableros tengan elementos, acá vas a ver el avance, lo vencido y la carga de cada persona." />
      ) : (
        <div className="space-y-6">
          <section aria-label="Indicadores" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Elementos" value={all.length} hint={`${boards?.length ?? 0} tableros`} />
            <Kpi label="Terminados" value={`${Math.round((doneCount / all.length) * 100)}%`} hint={`${doneCount} de ${all.length}`} tone="success" />
            <Kpi label="Vencidos" value={overdue.length} hint="sin terminar" tone={overdue.length ? "danger" : undefined} />
            <Kpi label="Vencen esta semana" value={thisWeek.length} hint="próximos 7 días" tone={thisWeek.length ? "warning" : undefined} />
          </section>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Card className="p-0">
              <h2 className="border-b border-line px-5 py-3.5 text-sm font-bold">Avance por tablero</h2>
              <ul className="divide-y divide-line">
                {perBoard.map((b) => {
                  const pct = b.total ? Math.round((b.done / b.total) * 100) : 0;
                  const summary = b.parts.map((p) => `${p.label}: ${p.n}`).join(", ");
                  return (
                    <li key={b.id} className="px-5 py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <Link href={`/t/${b.id}`} className="truncate font-semibold hover:underline">
                          {b.name}
                        </Link>
                        <span className="shrink-0 text-xs text-muted">
                          {b.done}/{b.total} · <strong className="text-fg">{pct}%</strong>
                          {b.overdue > 0 && <span className="ml-2 font-semibold text-danger">{b.overdue} vencidos</span>}
                        </span>
                      </div>
                      <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`Distribución por estado: ${summary || "sin elementos"}`} title={summary}>
                        {b.parts.map((p, i) => (
                          <span key={i} className={cn(p.color ? `solid-${p.color}` : "bg-surface-3", "h-full")} style={{ width: `${(p.n / Math.max(1, b.total)) * 100}%` }} />
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>

            <Card className="p-0">
              <h2 className="border-b border-line px-5 py-3.5 text-sm font-bold">Carga por persona (pendientes)</h2>
              {perPerson.length === 0 && unassigned === 0 ? (
                <p className="px-5 py-4 text-sm text-muted">No hay pendientes asignados.</p>
              ) : (
                <ul className="space-y-3 px-5 py-4">
                  {perPerson.map((p) => (
                    <li key={p.m.user_id} className="flex items-center gap-3 text-sm">
                      <Avatar name={displayName(p.m)} size="sm" />
                      <span className="w-32 shrink-0 truncate">{displayName(p.m)}</span>
                      <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                        <span className="block h-full rounded-full bg-accent" style={{ width: `${(p.open / maxLoad) * 100}%` }} />
                      </span>
                      <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted">
                        {p.open}
                        {p.overdue > 0 && <span className="ml-1 font-semibold text-danger">({p.overdue} venc.)</span>}
                      </span>
                    </li>
                  ))}
                  {unassigned > 0 && (
                    <li className="flex items-center gap-3 text-sm text-muted">
                      <span className="h-7 w-7 shrink-0 rounded-full border border-dashed border-line-strong" aria-hidden />
                      <span className="w-32 shrink-0 truncate">Sin responsable</span>
                      <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                        <span className="block h-full rounded-full bg-line-strong" style={{ width: `${(unassigned / maxLoad) * 100}%` }} />
                      </span>
                      <span className="w-20 shrink-0 text-right text-xs tabular-nums">{unassigned}</span>
                    </li>
                  )}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <TaskList title="Vencidos" empty="No hay elementos vencidos. ¡Bien!" tasks={overdue.slice(0, 12)} boardName={boardName} members={members} tone="danger" total={overdue.length} />
            <TaskList title="Próximos 14 días" empty="No hay vencimientos en las próximas dos semanas." tasks={upcoming.slice(0, 12)} boardName={boardName} members={members} total={upcoming.length} />
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: number | string; hint: string; tone?: "success" | "danger" | "warning" }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={cn("mt-1 text-3xl font-extrabold tabular-nums", tone === "success" && "text-success", tone === "danger" && "text-danger", tone === "warning" && "text-warning")}>{value}</p>
      <p className="text-xs text-muted">{hint}</p>
    </div>
  );
}

function TaskList({
  title,
  empty,
  tasks,
  boardName,
  members,
  tone,
  total,
}: {
  title: string;
  empty: string;
  tasks: { id: string; title: string; board_id: string; due_date: string | null; assignee_id: string | null }[];
  boardName: Map<string, string>;
  members: { user_id: string; full_name: string | null; email: string | null }[];
  tone?: "danger";
  total: number;
}) {
  return (
    <Card className="p-0">
      <h2 className="flex items-center justify-between border-b border-line px-5 py-3.5 text-sm font-bold">
        {title}
        {total > tasks.length && <span className="text-xs font-normal text-muted">mostrando {tasks.length} de {total}</span>}
      </h2>
      {tasks.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {tasks.map((t) => {
            const m = members.find((x) => x.user_id === t.assignee_id);
            return (
              <li key={t.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <span className={cn("w-14 shrink-0 text-xs font-semibold tabular-nums", tone === "danger" ? "text-danger" : "text-muted")}>{t.due_date ? shortDate(t.due_date) : ""}</span>
                <Link href={`/t/${t.board_id}?item=${t.id}`} className="min-w-0 flex-1 truncate hover:underline">
                  {t.title}
                </Link>
                <span className="hidden max-w-32 shrink-0 truncate text-xs text-muted sm:block">{boardName.get(t.board_id)}</span>
                {m && <Avatar name={displayName(m)} size="sm" />}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
