import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getBoardData } from "@/lib/data";
import { uuidSchema } from "@/lib/validation";
import { createClient } from "@/lib/supabase/server";
import { BoardView } from "@/components/board/board-view";
import { BoardHeaderActions } from "@/components/board/board-header-actions";
import { IconLock, IconUsers } from "@/components/ui/icons";

type Props = {
  params: Promise<{ boardId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { boardId } = await params;
  if (!uuidSchema.safeParse(boardId).success) return { title: "Tablero" };
  const supabase = await createClient();
  const { data } = await supabase.from("boards").select("name").eq("id", boardId).maybeSingle();
  return { title: data?.name ?? "Tablero" };
}

export default async function BoardPage({ params, searchParams }: Props) {
  const { boardId } = await params;
  const sp = await searchParams;
  if (!uuidSchema.safeParse(boardId).success) notFound();
  const user = await requireUser(`/t/${boardId}`);
  const data = await getBoardData(boardId, user.id);
  if (!data) notFound();

  const { board, workspace, canManage } = data;
  const view = sp.vista === "calendario" ? "calendario" : "tabla";

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pt-6 sm:px-8">
      <nav aria-label="Ruta" className="mb-2 text-sm text-muted">
        <Link href={`/e/${workspace.id}`} className="hover:text-fg hover:underline">
          {workspace.name}
        </Link>
        <span aria-hidden> / </span>
        <span aria-current="page">{board.name}</span>
      </nav>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-balance sm:text-[28px]">{board.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span className="inline-flex items-center gap-1">
              {board.visibility === "private" ? <IconLock size={14} /> : <IconUsers size={14} />}
              {board.visibility === "private" ? "Privado" : "Compartido con el espacio"}
            </span>
            {board.description && <span className="max-w-2xl">{board.description}</span>}
          </p>
        </div>
        <BoardHeaderActions
          board={{ id: board.id, name: board.name, isArchived: board.is_archived }}
          canManage={canManage}
        />
      </div>

      {board.is_archived && (
        <div role="status" className="mb-4 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          Este tablero está archivado: se puede consultar pero no editar. {canManage ? "Restauralo para seguir trabajando." : ""}
        </div>
      )}

      <BoardView
        boardId={board.id}
        view={view}
        statuses={data.statuses}
        groups={data.groups}
        tasks={data.tasks}
        members={data.members}
        serverToday={new Date().toISOString().slice(0, 10)}
        readOnly={board.is_archived}
      />
    </div>
  );
}
