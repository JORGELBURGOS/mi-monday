"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { deleteBoardAction, setBoardArchivedAction } from "@/app/actions/boards";
import { Button } from "@/components/ui/button";
import { buttonClasses } from "@/components/ui/button-classes";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { IconArchive, IconSettings, IconTrash } from "@/components/ui/icons";

export function BoardHeaderActions({
  board,
  canManage,
  showSettingsLink = true,
}: {
  board: { id: string; name: string; isArchived: boolean };
  canManage: boolean;
  showSettingsLink?: boolean;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!canManage) return null;

  const setArchived = (archived: boolean) =>
    startTransition(async () => {
      const res = await setBoardArchivedAction(board.id, archived);
      if (!res.ok) toast.error(res.error);
      else toast.success(res.message ?? "Listo.");
    });

  return (
    <div className="flex shrink-0 flex-wrap gap-2">
      {showSettingsLink && !board.isArchived && (
        <Link href={`/t/${board.id}/ajustes`} className={buttonClasses("secondary", "sm")}>
          <IconSettings size={15} /> Ajustes
        </Link>
      )}
      {board.isArchived ? (
        <>
          <Button size="sm" variant="primary" onClick={() => setArchived(false)} disabled={pending}>
            Restaurar
          </Button>
          <Button size="sm" variant="outline-danger" onClick={() => setConfirmDelete(true)} disabled={pending}>
            <IconTrash size={15} /> Eliminar
          </Button>
        </>
      ) : (
        <Button size="sm" onClick={() => setConfirmArchive(true)} disabled={pending}>
          <IconArchive size={15} /> Archivar
        </Button>
      )}

      <ConfirmDialog
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        title="Archivar tablero"
        description="El tablero deja de aparecer en la navegación y queda en solo lectura. Podés restaurarlo cuando quieras desde la página del espacio."
        confirmLabel="Archivar"
        danger={false}
        onConfirm={() => {
          setConfirmArchive(false);
          setArchived(true);
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Eliminar tablero definitivamente"
        description="Se borran todos sus grupos, tareas y comentarios. Esta acción no se puede deshacer."
        requireText={board.name}
        confirmLabel="Eliminar para siempre"
        onConfirm={async () => {
          const res = await deleteBoardAction(board.id);
          if (res && !res.ok) toast.error(res.error);
        }}
      />
    </div>
  );
}
