import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getWorkspace, getWorkspaceMembers } from "@/lib/data";
import { PageHeader } from "@/components/ui/misc";
import { uuidSchema } from "@/lib/validation";
import { MembersPanel } from "./members-panel";

export const metadata: Metadata = { title: "Miembros" };

export default async function MembersPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  if (!uuidSchema.safeParse(workspaceId).success) notFound();
  const user = await requireUser(`/e/${workspaceId}/miembros`);
  const workspace = await getWorkspace(workspaceId, user.id);
  if (!workspace) notFound();

  const members = await getWorkspaceMembers(workspaceId);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8">
      <PageHeader
        eyebrow={workspace.name}
        title="Miembros"
        description="Quiénes tienen acceso a este espacio, con qué rol, y altas de personas nuevas."
      />
      <MembersPanel workspaceId={workspaceId} myId={user.id} myRole={workspace.role} members={members} />
    </div>
  );
}
