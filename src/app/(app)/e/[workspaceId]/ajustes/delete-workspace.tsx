"use client";

import { useState } from "react";
import { deleteWorkspaceAction } from "@/app/actions/workspaces";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

export function DeleteWorkspace({ workspaceId, name }: { workspaceId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  return (
    <>
      <Button variant="outline-danger" className="mt-4" onClick={() => setOpen(true)}>
        Eliminar empresa
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Eliminar empresa"
        description="Esta acción no se puede deshacer. Se eliminan todos los tableros, tareas, comentarios e usuarios de la empresa."
        requireText={name}
        confirmLabel="Eliminar definitivamente"
        onConfirm={async () => {
          const res = await deleteWorkspaceAction(workspaceId);
          if (res && !res.ok) toast.error(res.error);
        }}
      />
    </>
  );
}
