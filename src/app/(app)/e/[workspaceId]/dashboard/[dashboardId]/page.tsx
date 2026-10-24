import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getWorkspace } from "@/lib/data";
import { uuidSchema } from "@/lib/validation";
import { getDashboard, getDashboardDataset, listDashboards } from "@/lib/dashboard-data";
import { DashboardTabs } from "@/components/dashboard/dashboard-tabs";
import { DashboardView } from "@/components/dashboard/dashboard-view";

type Props = { params: Promise<{ workspaceId: string; dashboardId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { dashboardId } = await params;
  if (!uuidSchema.safeParse(dashboardId).success) return { title: "Dashboard" };
  const d = await getDashboard(dashboardId);
  return { title: d?.name ?? "Dashboard" };
}

export default async function CustomDashboardPage({ params }: Props) {
  const { workspaceId, dashboardId } = await params;
  if (!uuidSchema.safeParse(workspaceId).success || !uuidSchema.safeParse(dashboardId).success) notFound();
  const user = await requireUser(`/e/${workspaceId}/dashboard/${dashboardId}`);
  const workspace = await getWorkspace(workspaceId, user.id);
  if (!workspace) notFound();
  const [dashboard, ds, dashboards] = await Promise.all([getDashboard(dashboardId), getDashboardDataset(workspaceId), listDashboards(workspaceId)]);
  if (!dashboard || dashboard.workspace_id !== workspaceId) notFound();
  const canEdit = dashboard.created_by === user.id || workspace.role === "owner" || workspace.role === "admin";

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-8">
      <p className="mb-2 text-sm text-muted">{workspace.name}</p>
      <DashboardTabs workspaceId={workspaceId} current={dashboard.id} dashboards={dashboards} />
      <DashboardView
        key={dashboard.id}
        dashboard={{ id: dashboard.id, workspaceId, name: dashboard.name, description: dashboard.description, visibility: dashboard.visibility, widgets: dashboard.widgets }}
        ds={ds}
        canEdit={canEdit}
      />
    </div>
  );
}
