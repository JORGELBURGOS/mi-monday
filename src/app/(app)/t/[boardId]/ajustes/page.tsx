import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getBoardData, getBoardGrants } from "@/lib/data";
import { uuidSchema } from "@/lib/validation";
import { Card, PageHeader } from "@/components/ui/misc";
import { BoardForm } from "@/components/board-form";
import { BoardAccess } from "./board-access";
import { BoardHeaderActions } from "@/components/board/board-header-actions";

export const metadata: Metadata = { title: "Ajustes del tablero" };

export default async function BoardSettingsPage({ params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params;
  if (!uuidSchema.safeParse(boardId).success) notFound();
  const user = await requireUser(`/t/${boardId}/ajustes`);
  const data = await getBoardData(boardId, user.id);
  if (!data) notFound();
  const { board, canManage, members } = data;
  const granted = canManage ? await getBoardGrants(board.id) : [];


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
            Solo quien creó el tablero o un administrador de la empresa puede cambiar sus ajustes.
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card>
            <h2 className="mb-4 font-bold">General</h2>
            <BoardForm board={{ id: board.id, name: board.name, description: board.description, visibility: board.visibility }} />
          </Card>
          <Card>
            <h2 className="font-bold">Acceso</h2>
            <p className="mb-4 mt-1 text-sm text-muted">
              Quién puede ver y trabajar en este tablero. Los administradores de la empresa siempre tienen acceso.
            </p>
            <BoardAccess
              boardId={board.id}
              visibility={board.visibility}
              createdBy={board.created_by}
              members={members.filter((m) => !m.deactivated_at || granted.includes(m.user_id))}
              granted={granted}
            />
          </Card>
          <Card>
            <h2 className="font-bold">Columnas, estados y etiquetas</h2>
            <p className="mt-1 text-sm text-muted">
              Se editan directamente en el tablero, como en Monday: con el <strong className="text-fg">+</strong> al final de los
              encabezados agregás columnas (estado, números, fórmula, fecha, cronograma y más); con el menú de cada encabezado la
              renombrás, configurás, movés u ocultás; y desde cualquier celda de estado, “Editar etiquetas” crea, renombra y colorea
              las etiquetas.{" "}
              <Link href={`/t/${board.id}`} className="font-semibold text-accent hover:underline">
                Ir al tablero →
              </Link>
            </p>
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
