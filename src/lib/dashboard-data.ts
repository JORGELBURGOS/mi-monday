import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceMembers } from "@/lib/data";
import { parseColumn, readValues } from "@/lib/columns";
import { widgetsSchema, type Widget } from "@/lib/dashboards";
import type { Dataset, DsTask } from "@/lib/dashboard-engine";

const AR = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
const arDate = (ts: string | null | undefined) => (ts ? AR.format(new Date(ts)) : null);

/**
 * Datos para los dashboards de una empresa. Todo se lee con la sesión de la
 * persona: RLS deja afuera los tableros (y elementos) a los que no tiene acceso.
 */
export async function getDashboardDataset(workspaceId: string): Promise<Dataset> {
  const supabase = await createClient();
  const { data: boards } = await supabase.from("boards").select("id, name").eq("workspace_id", workspaceId).eq("is_archived", false).order("name");
  const ids = (boards ?? []).map((b) => b.id);
  const today = AR.format(new Date());
  if (!ids.length) return { boards: [], tasks: [], members: [], today };

  const [statuses, groups, columns, tasks, done, members] = await Promise.all([
    supabase.from("board_statuses").select("id, board_id, label, color, is_done, position").in("board_id", ids).order("position"),
    supabase.from("board_groups").select("id, board_id, name, position").in("board_id", ids).order("position"),
    supabase.from("board_columns").select("*").in("board_id", ids).order("position"),
    supabase
      .from("tasks")
      .select("id, board_id, group_id, status_id, parent_id, title, priority, assignee_id, due_date, created_at, updated_at, custom_values")
      .in("board_id", ids)
      .order("created_at")
      .limit(20000),
    // Cuándo se terminó cada elemento: el último paso a un estado "terminado".
    supabase
      .from("task_events")
      .select("task_id, created_at")
      .in("board_id", ids)
      .eq("kind", "status_changed")
      .eq("detail->>done", "true")
      .order("created_at", { ascending: false })
      .limit(20000),
    getWorkspaceMembers(workspaceId),
  ]);

  const doneAt = new Map<string, string>();
  for (const e of done.data ?? []) if (!doneAt.has(e.task_id)) doneAt.set(e.task_id, e.created_at);
  const doneStatus = new Set((statuses.data ?? []).filter((s) => s.is_done).map((s) => s.id));

  return {
    today,
    members: members.filter((m) => !m.is_platform_admin).map((m) => ({ user_id: m.user_id, full_name: m.full_name, email: m.email })),
    boards: (boards ?? []).map((b) => ({
      id: b.id,
      name: b.name,
      statuses: (statuses.data ?? []).filter((s) => s.board_id === b.id),
      groups: (groups.data ?? []).filter((g) => g.board_id === b.id),
      columns: (columns.data ?? []).filter((c) => c.board_id === b.id).map(parseColumn),
    })),
    tasks: (tasks.data ?? []).map(
      (t): DsTask => ({
        id: t.id,
        board_id: t.board_id,
        group_id: t.group_id,
        status_id: t.status_id,
        parent_id: t.parent_id,
        title: t.title,
        priority: t.priority,
        assignee_id: t.assignee_id,
        due_date: t.due_date,
        created_on: arDate(t.created_at)!,
        updated_on: arDate(t.updated_at)!,
        // Solo si hoy está terminado (si se reabrió, ya no cuenta).
        done_on: t.status_id && doneStatus.has(t.status_id) ? arDate(doneAt.get(t.id) ?? t.updated_at) : null,
        values: readValues(t.custom_values),
      }),
    ),
  };
}

export type DashboardRow = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  visibility: "workspace" | "private";
  widgets: Widget[];
  created_by: string | null;
  updated_at: string;
};

/** Widgets guardados, validados (los que no cumplen el formato se descartan). */
export function parseWidgets(raw: unknown): Widget[] {
  if (!Array.isArray(raw)) return [];
  const out: Widget[] = [];
  for (const item of raw.slice(0, 60)) {
    const r = widgetsSchema.element.safeParse(item);
    if (r.success) out.push(r.data);
  }
  return out;
}

export async function listDashboards(workspaceId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("dashboards")
    .select("id, name, visibility, created_by, position, updated_at")
    .eq("workspace_id", workspaceId)
    .order("position")
    .order("created_at");
  return data ?? [];
}

export async function getDashboard(id: string): Promise<DashboardRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("dashboards").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    workspace_id: data.workspace_id,
    name: data.name,
    description: data.description,
    visibility: data.visibility === "private" ? "private" : "workspace",
    widgets: parseWidgets(data.widgets),
    created_by: data.created_by,
    updated_at: data.updated_at,
  };
}
