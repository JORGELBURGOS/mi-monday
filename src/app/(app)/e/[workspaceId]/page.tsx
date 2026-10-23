import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { getWorkspace, getWorkspaceBoards } from "@/lib/data";
import { BoardCard } from "@/components/board-card";
import { NewBoardButton } from "@/components/board-form";
import { EmptyState, PageHeader, SectionTitle } from "@/components/ui/misc";
import { buttonClasses } from "@/components/ui/button-classes";
import { IconBoard, IconFlow, IconUsers } from "@/components/ui/icons";
import { uuidSchema } from "@/lib/validation";
import { ROLE_LABELS } from "@/lib/constants";

type Props = { params: Promise<{ workspaceId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { workspaceId } = await params;
  const user = await requireUser();
  const ws = uuidSchema.safeParse(workspaceId).success ? await getWorkspace(workspaceId, user.id) : null;
  return { title: ws?.name ?? "Espacio" };
}

export default async function WorkspacePage({ params }: Props) {
  const { workspaceId } = await params;
  if (!uuidSchema.safeParse(workspaceId).success) notFound();
  const user = await requireUser(`/e/${workspaceId}`);
  const workspace = await getWorkspace(workspaceId, user.id);
  if (!workspace) notFound();

  const boards = await getWorkspaceBoards(workspaceId);
  const active = boards.filter((b) => !b.is_archived);
  const archived = boards.filter((b) => b.is_archived);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8">
      <PageHeader
        eyebrow={<span>Espacio de trabajo · Tu rol: {ROLE_LABELS[workspace.role]}</span>}
        title={workspace.name}
        description={workspace.description}
        actions={
          <>
            <Link href={`/e/${workspaceId}/flujo`} className={buttonClasses("secondary")}>
              <IconFlow size={16} /> Flujo
            </Link>
            <Link href={`/e/${workspaceId}/miembros`} className={buttonClasses("secondary")}>
              <IconUsers size={16} /> Miembros
            </Link>
            <Suspense>
              <NewBoardButton workspaceId={workspaceId} />
            </Suspense>
          </>
        }
      />

      <section aria-labelledby="boards-title">
        <SectionTitle>
          <span id="boards-title">Tableros</span>
        </SectionTitle>
        {active.length === 0 ? (
          <EmptyState
            icon={<IconBoard />}
            title="Este espacio todavía no tiene tableros"
            description="Usá “Nuevo tablero” para crear el primero. Arranca con estados y una carpeta lista para cargar tareas."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {active.map((b) => (
              <BoardCard key={b.id} board={b} />
            ))}
          </div>
        )}
      </section>

      {archived.length > 0 && (
        <details className="group mt-10">
          <summary className="cursor-pointer list-none text-sm font-bold uppercase tracking-wide text-muted marker:hidden hover:text-fg">
            <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>
              ›
            </span>{" "}
            Archivados ({archived.length})
          </summary>
          <p className="mb-3 mt-2 text-sm text-muted">
            Los tableros archivados no aparecen en la navegación. Entrá a uno para restaurarlo o eliminarlo definitivamente.
          </p>
          <div className="grid gap-3 opacity-80 sm:grid-cols-2 xl:grid-cols-3">
            {archived.map((b) => (
              <BoardCard key={b.id} board={b} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
