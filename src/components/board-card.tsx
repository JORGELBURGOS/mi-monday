import Link from "next/link";
import type { BoardOverview } from "@/lib/data";
import { relativeTime } from "@/lib/format";
import { IconBoard, IconLock } from "@/components/ui/icons";

export function BoardCard({ board, workspaceName }: { board: BoardOverview; workspaceName?: string }) {
  const total = board.task_count ?? 0;
  const done = board.done_count ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <Link
      href={`/t/${board.id}`}
      className="group flex flex-col rounded-2xl border border-line bg-surface p-4 shadow-card transition-colors hover:border-line-strong"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          {board.visibility === "private" ? <IconLock size={17} /> : <IconBoard size={17} />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-bold group-hover:underline">{board.name}</h3>
          <p className="truncate text-xs text-muted">
            {workspaceName ? `${workspaceName} · ` : ""}
            {board.visibility === "private" ? "Privado" : "Compartido"}
            {board.is_archived ? " · Archivado" : ""}
          </p>
        </div>
      </div>
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-muted">
          <span>
            {done} de {total} {total === 1 ? "tarea hecha" : "tareas hechas"}
          </span>
          {board.last_activity_at && <span>{relativeTime(board.last_activity_at)}</span>}
        </div>
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3"
          role="progressbar"
          aria-label="Progreso del tablero"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div className="h-full rounded-full bg-[var(--chip-green-dot)]" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </Link>
  );
}
