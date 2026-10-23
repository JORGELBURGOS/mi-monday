import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getWorkspace, isPlatformAdmin } from "@/lib/data";
import { Card, PageHeader } from "@/components/ui/misc";
import { WorkspaceForm } from "@/components/workspace-form";
import { uuidSchema } from "@/lib/validation";
import { DeleteWorkspace } from "./delete-workspace";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Ajustes de la empresa" };

export default async function WorkspaceSettingsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  if (!uuidSchema.safeParse(workspaceId).success) notFound();
  const user = await requireUser(`/e/${workspaceId}/ajustes`);
  const workspace = await getWorkspace(workspaceId, user.id);
  if (!workspace) notFound();

  const canEdit = workspace.role === "owner" || workspace.role === "admin";
  const superadmin = await isPlatformAdmin(user.id);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-8">
      <PageHeader eyebrow={workspace.name} title="Ajustes de la empresa" description={`Creado el ${formatDate(workspace.created_at)}.`} />
      {canEdit ? (
        <div className="space-y-6">
          <Card>
            <WorkspaceForm workspace={workspace} />
          </Card>
          {superadmin && (
            <Card className="border-danger/30">
              <h2 className="font-bold text-danger">Zona de peligro</h2>
              <p className="mt-1 text-sm text-muted">
                Solo el superadministrador puede eliminar una empresa. Se borran para siempre todos sus tableros, tareas y comentarios.
              </p>
              <DeleteWorkspace workspaceId={workspace.id} name={workspace.name} />
            </Card>
          )}
        </div>
      ) : (
        <Card>
          <p className="text-sm text-muted">Solo los administradores pueden cambiar los ajustes de esta empresa.</p>
        </Card>
      )}
    </div>
  );
}
