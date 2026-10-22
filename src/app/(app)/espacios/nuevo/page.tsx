import type { Metadata } from "next";
import { WorkspaceForm } from "@/components/workspace-form";
import { Card, PageHeader } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Nuevo espacio" };

export default function NewWorkspacePage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-8">
      <PageHeader
        title="Nuevo espacio de trabajo"
        description="Vas a ser el propietario. Después podés invitar a tu equipo y crear tableros."
      />
      <Card>
        <WorkspaceForm />
      </Card>
    </div>
  );
}
