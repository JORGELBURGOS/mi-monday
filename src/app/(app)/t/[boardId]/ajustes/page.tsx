import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getBoardData } from "@/lib/data";
import { uuidSchema } from "@/lib/validation";
import { Card, PageHeader } from "@/components/ui/misc";
import { BoardForm } from "@/components/board-form";
import { StatusManager } from "./status-manager";
import { ColumnManager } from "./column-manager";
import { readValues } from "@/lib/columns";
import { BoardHeaderActions } from "@/components/board/board-header-actions";

export const metadata: Metadata = { title: "Ajustes del tablero" };

export default async function BoardSettingsPage({ params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params;
  if (!uuidSchema.safeParse(boardId).success) notFound();
  const user = await requireUser(`/t/${boardId}/ajustes`);
  const data = await getBoardData(boardId, user.id);
  if (!data) notFound();
  const { board, canManage, statuses, tasks, columns } = data;

  const usage = Object.fromEntries(statuses.map((s) => [s.id, tasks.filter((t) => t.status_id === s.id).length]));
  const values = tasks.map((t) => readValues(t.custom_values));
  const columnUsage = Object.fromEntries(columns.map((c) => [c.id, values.filter((v) => c.id in v).length]));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8">
      <PageHeader
        eyebrow={
          <Link href={`/t/${board.id}`} className="hover:text-fg hover:underline">
            ← Volver a {board.name}
          </Link>
        }
        title="Ajustes del tablero"
      />
      {!canManage ? (
        <Card>
          <p className="text-sm text-muted">
            Solo quien creó el tablero o un administrador del espacio puede cambiar sus ajustes.
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card>
            <h2 className="mb-4 font-bold">General</h2>
            <BoardForm board={{ id: board.id, name: board.name, description: board.description, visibility: board.visibility }} />
          </Card>
          <Card>
            <h2 className="font-bold">Estados</h2>
            <p className="mb-4 mt-1 text-sm text-muted">
              Definí las etapas de las tareas. Los marcados como “cuenta como hecho” suman al progreso del tablero.
            </p>
            <StatusManager boardId={board.id} statuses={statuses} usage={usage} />
          </Card>
          <Card>
            <h2 className="font-bold">Columnas</h2>
            <p className="mb-4 mt-1 text-sm text-muted">
              Los datos propios de esta etapa. Cuando una regla copia o mueve un ítem a otro tablero, podés elegir qué columnas viajan.
            </p>
            <ColumnManager boardId={board.id} columns={columns} usage={columnUsage} />
          </Card>
          <Card>
            <h2 className="font-bold">Reglas entre tableros</h2>
            <p className="mt-1 text-sm text-muted">
              Mové o copiá ítems a otros tableros automáticamente según su estado o carpeta.{" "}
              <Link href={`/t/${board.id}/reglas`} className="font-semibold text-accent hover:underline">
                Configurar reglas →
              </Link>
            </p>
          </Card>
          <Card>
            <h2 className="font-bold">Archivar o eliminar</h2>
            <p className="mb-4 mt-1 text-sm text-muted">
              Para evitar borrados accidentales, primero hay que archivar el tablero; recién ahí se puede eliminar.
            </p>
            <BoardHeaderActions
              board={{ id: board.id, name: board.name, isArchived: board.is_archived }}
              canManage={canManage}
              showSettingsLink={false}
            />
          </Card>
        </div>
      )}
    </div>
  );
}
