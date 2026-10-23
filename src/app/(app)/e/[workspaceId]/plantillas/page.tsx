import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getChecklistTemplates, getWorkspace } from "@/lib/data";
import { uuidSchema } from "@/lib/validation";
import { PageHeader } from "@/components/ui/misc";
import { TemplatesManager } from "./templates-manager";

export const metadata: Metadata = { title: "Plantillas de checklist" };

export default async function TemplatesPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  if (!uuidSchema.safeParse(workspaceId).success) notFound();
  const user = await requireUser(`/e/${workspaceId}/plantillas`);
  const workspace = await getWorkspace(workspaceId, user.id);
  if (!workspace) notFound();
  const templates = await getChecklistTemplates(workspaceId);
  const isAdmin = workspace.role === "owner" || workspace.role === "admin";

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8">
      <PageHeader
        eyebrow={workspace.name}
        title="Plantillas de checklist"
        description="Listas de pasos que se repiten (una inspección, un alta, un servicio). Se aplican a cualquier elemento o se cargan solas en los elementos nuevos de un tablero, desde la configuración de la columna Checklist."
      />
      <TemplatesManager workspaceId={workspaceId} templates={templates} userId={user.id} isAdmin={isAdmin} />
    </div>
  );
}
