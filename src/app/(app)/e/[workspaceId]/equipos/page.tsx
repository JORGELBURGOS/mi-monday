import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getWorkspace, getWorkspaceMembers, getWorkspaceTeams, isPlatformAdmin } from "@/lib/data";
import { uuidSchema } from "@/lib/validation";
import { PageHeader } from "@/components/ui/misc";
import { TeamsManager } from "./teams-manager";

export const metadata: Metadata = { title: "Equipos" };

export default async function TeamsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  if (!uuidSchema.safeParse(workspaceId).success) notFound();
  const user = await requireUser(`/e/${workspaceId}/equipos`);
  const workspace = await getWorkspace(workspaceId, user.id);
  if (!workspace) notFound();
  const [teams, members, superadmin] = await Promise.all([getWorkspaceTeams(workspaceId), getWorkspaceMembers(workspaceId), isPlatformAdmin(user.id)]);
  const isAdmin = superadmin || workspace.role === "owner" || workspace.role === "admin";

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8">
      <PageHeader
        eyebrow={workspace.name}
        title="Equipos"
        description="Grupos de personas que trabajan juntas. Un equipo puede ser responsable de elementos, recibir permisos sobre tableros y ser el único que edita una carpeta, una columna o su parte del checklist."
      />
      <TeamsManager workspaceId={workspaceId} teams={teams} members={members.filter((m) => !m.is_platform_admin)} isAdmin={isAdmin} />
    </div>
  );
}
