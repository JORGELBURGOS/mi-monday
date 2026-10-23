import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getWorkspace, getWorkspaceAccess, getWorkspaceMembers, isPlatformAdmin } from "@/lib/data";
import { PageHeader } from "@/components/ui/misc";
import { uuidSchema } from "@/lib/validation";
import { MembersPanel } from "./members-panel";

export const metadata: Metadata = { title: "Usuarios" };

export default async function MembersPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  if (!uuidSchema.safeParse(workspaceId).success) notFound();
  const user = await requireUser(`/e/${workspaceId}/miembros`);
  const workspace = await getWorkspace(workspaceId, user.id);
  if (!workspace) notFound();

  const [members, access, superadmin] = await Promise.all([
    getWorkspaceMembers(workspaceId),
    getWorkspaceAccess(workspaceId),
    isPlatformAdmin(user.id),
  ]);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8">
      <PageHeader
        eyebrow={workspace.name}
        title="Usuarios"
        description="Quiénes trabajan en esta empresa, con qué rol y a qué tableros acceden. Los administradores pueden dar de alta, editar, desactivar y restablecer contraseñas."
      />
      <MembersPanel
        workspaceId={workspaceId}
        myId={user.id}
        myRole={superadmin ? "owner" : workspace.role}
        members={members}
        boards={access.boards.filter((b) => !b.is_archived)}
        grants={access.grants}
      />
    </div>
  );
}
