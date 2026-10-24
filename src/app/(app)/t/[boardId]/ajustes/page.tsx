import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getBoardData, getBoardPermissions } from "@/lib/data";
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
  const permissions = canManage ? await getBoardPermissions(board.id) : { users: {}, teams: {} };


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
            <h2 className="font-bold">Acceso y permisos</h2>
            <p className="mb-4 mt-1 text-sm text-muted">
              Quién ve este tablero y qué puede hacer cada persona o equipo. Los administradores de la empresa y quien lo creó siempre lo administran.
              Para restringir una carpeta o una columna, usá el menú de la carpeta o del encabezado de la columna en el tablero.
            </p>
            <BoardAccess
              boardId={board.id}
              visibility={board.visibility}
              defaultRole={board.default_role}
              createdBy={board.created_by}
              members={members.filter((m) => !m.is_platform_admin && (!m.deactivated_at || m.user_id in permissions.users))}
              teams={data.teams}
              userRoles={permissions.users}
              teamRoles={permissions.teams}
            />
          </Card>
          <Card>
            <h2 className="font-bold">Columnas, estados y etiquetas</h2>
            <p className="mt-1 text-sm text-muted">
              Se editan directamente en el tablero: con el <strong className="text-fg">+</strong> al final de los
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
              Para evitar borrados accidentales, primero hay que archivar el tablero; recién ahí se puede eliminar. Solo un administrador de la
              empresa puede archivar, restaurar o eliminar tableros.
            </p>
            {data.workspace.role === "owner" || data.workspace.role === "admin" ? (
              <BoardHeaderActions
                board={{ id: board.id, name: board.name, isArchived: board.is_archived }}
                canManage={canManage}
                canArchive
                showSettingsLink={false}
              />
            ) : (
              <p className="text-sm font-semibold text-muted">Pedile a un administrador de la empresa que lo haga.</p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
