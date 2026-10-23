import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getWorkspaceFlow, getWorkspaceMembers } from "@/lib/data";
import { uuidSchema } from "@/lib/validation";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader } from "@/components/ui/misc";
import { describeAutomation } from "@/lib/automations";
import { AutomationManager } from "./automation-manager";

export const metadata: Metadata = { title: "Reglas del tablero" };

export default async function BoardRulesPage({ params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params;
  if (!uuidSchema.safeParse(boardId).success) notFound();
  const user = await requireUser(`/t/${boardId}/reglas`);
  const supabase = await createClient();
  const { data: board } = await supabase.from("boards").select("id, name, workspace_id, is_archived").eq("id", boardId).maybeSingle();
  if (!board) notFound();
  const [flow, members] = await Promise.all([getWorkspaceFlow(board.workspace_id, user.id), getWorkspaceMembers(board.workspace_id)]);
  if (!flow) notFound();
  const current = flow.boards.find((b) => b.id === boardId);
  if (!current) notFound();

  const rules = flow.automations.filter((a) => a.board_id === boardId);
  const incoming = flow.automations.filter((a) => a.target_board_id === boardId && a.board_id !== boardId && a.action_type !== "update_linked");

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8">
      <PageHeader
        eyebrow={
          <Link href={`/t/${board.id}`} className="hover:text-fg hover:underline">
            ← Volver a {board.name}
          </Link>
        }
        title="Reglas entre tableros"
        description="Cuando pasa algo con un ítem en este tablero, Vetta lo mueve, lo copia o avisa al resto de la cadena. Cada paso queda registrado en el recorrido del ítem."
        actions={
          <Link href={`/e/${board.workspace_id}/flujo`} className="text-sm font-semibold text-accent hover:underline">
            Ver el flujo completo del espacio →
          </Link>
        }
      />

      {board.is_archived && (
        <div role="status" className="mb-4 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          Este tablero está archivado: sus reglas no se ejecutan hasta restaurarlo.
        </div>
      )}

      <AutomationManager
        boardId={boardId}
        boards={flow.boards}
        rules={rules}
        members={members}
        canManage={current.canManage && !board.is_archived}
      />

      {incoming.length > 0 && (
        <Card className="mt-6">
          <h2 className="font-bold">Ítems que llegan desde otros tableros</h2>
          <p className="mb-3 mt-1 text-sm text-muted">Estas reglas de otros tableros traen ítems a este.</p>
          <ul className="space-y-2">
            {incoming.map((a) => {
              const d = describeAutomation(a, flow.boards);
              return (
                <li key={a.id} className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
                  <span className="font-semibold">{d.source?.name ?? "Otro tablero"}</span>
                  <span className="text-muted">
                    {" "}
                    · {d.when.charAt(0).toLowerCase() + d.when.slice(1)}, {d.then}
                    {!a.is_active && " · pausada"}
                  </span>
                  {d.source && (
                    <>
                      {" "}
                      <Link href={`/t/${d.source.id}/reglas`} className="font-semibold text-accent hover:underline">
                        Ver
                      </Link>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
