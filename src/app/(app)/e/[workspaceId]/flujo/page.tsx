import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getWorkspaceFlow, getWorkspaceMembers, type FlowBoard } from "@/lib/data";
import { uuidSchema } from "@/lib/validation";
import { describeAutomation } from "@/lib/automations";
import { cn } from "@/lib/cn";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { IconFlow, IconLock } from "@/components/ui/icons";

export const metadata: Metadata = { title: "Flujo entre tableros" };

const ACTION_BADGE: Record<string, { label: string; className: string }> = {
  copy: { label: "Copia", className: "chip-blue" },
  move: { label: "Mueve", className: "chip-violet" },
  update_linked: { label: "Actualiza", className: "chip-amber" },
  create_item: { label: "Crea", className: "chip-teal" },
  notify: { label: "Avisa", className: "chip-pink" },
};
const SAME_ITEM_BADGE = { label: "Automatiza", className: "chip-gray" };

/** Ordena los tableros siguiendo el sentido de las reglas (primero los que inician la cadena). */
function flowOrder(boards: FlowBoard[], edges: { from: string; to: string }[]) {
  const ids = new Set(boards.map((b) => b.id));
  const indeg = new Map(boards.map((b) => [b.id, 0]));
  const out = new Map<string, string[]>();
  for (const e of edges) {
    if (e.from === e.to || !ids.has(e.from) || !ids.has(e.to)) continue;
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  }
  const connected = new Set(edges.flatMap((e) => [e.from, e.to]));
  const queue = boards.filter((b) => indeg.get(b.id) === 0 && connected.has(b.id)).map((b) => b.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    if (order.includes(id)) continue;
    order.push(id);
    for (const n of out.get(id) ?? []) {
      indeg.set(n, (indeg.get(n) ?? 1) - 1);
      if (indeg.get(n) === 0) queue.push(n);
    }
  }
  // Ciclos: se agregan en orden alfabético.
  for (const b of boards) if (connected.has(b.id) && !order.includes(b.id)) order.push(b.id);
  return {
    chain: order.map((id) => boards.find((b) => b.id === id)!),
    loose: boards.filter((b) => !connected.has(b.id)),
  };
}

export default async function WorkspaceFlowPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  if (!uuidSchema.safeParse(workspaceId).success) notFound();
  const user = await requireUser(`/e/${workspaceId}/flujo`);
  const flow = await getWorkspaceFlow(workspaceId, user.id);
  if (!flow) notFound();
  const members = await getWorkspaceMembers(workspaceId);

  const boards = flow.boards.filter((b) => !b.is_archived);
  const edges = flow.automations
    .filter((a) => ["copy", "move", "create_item"].includes(a.action_type) && a.target_board_id !== a.board_id)
    .map((a) => ({ from: a.board_id, to: a.target_board_id }));
  const ordered = flowOrder(boards, edges);
  // Los tableros con reglas propias (sin conexión con otros) también se muestran.
  const hasRules = (id: string) => flow.automations.some((x) => x.board_id === id);
  const chain = [...ordered.chain, ...ordered.loose.filter((b) => hasRules(b.id))];
  const loose = ordered.loose.filter((b) => !hasRules(b.id));

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8">
      <PageHeader
        eyebrow={
          <Link href={`/e/${workspaceId}`} className="hover:text-fg hover:underline">
            ← {flow.workspace.name}
          </Link>
        }
        title="Flujo entre tableros"
        description="Cómo viajan los ítems de una etapa a otra dentro de la empresa. Cada tablero es una etapa; las reglas los conectan."
      />

      {flow.automations.length === 0 ? (
        <EmptyState
          icon={<IconFlow />}
          title="Todavía no hay reglas que conecten tableros"
          description="Entrá a un tablero y usá “Reglas” para definir, por ejemplo, que un pedido aprobado en Ventas se copie a Producción."
        />
      ) : (
        <ol className="space-y-0">
          {chain.map((b, i) => {
            const outgoing = flow.automations.filter((a) => a.board_id === b.id);
            return (
              <li key={b.id} className="relative pb-8 last:pb-0">
                {i < chain.length - 1 && <span aria-hidden className="absolute bottom-0 left-5 top-12 w-0.5 bg-line" />}
                <div className="flex items-start gap-4">
                  <span
                    aria-hidden
                    className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-fg text-sm font-bold text-bg"
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1 rounded-2xl border border-line bg-surface p-4 shadow-card">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="flex items-center gap-1.5 text-base font-bold">
                        <Link href={`/t/${b.id}`} className="hover:underline">
                          {b.name}
                        </Link>
                        {b.visibility === "private" && (
                          <>
                            <IconLock size={14} className="text-subtle" />
                            <span className="sr-only">(privado)</span>
                          </>
                        )}
                      </h2>
                      <Link href={`/t/${b.id}/reglas`} className="text-xs font-semibold text-accent hover:underline">
                        {b.canManage ? "Editar reglas" : "Ver reglas"}
                      </Link>
                    </div>
                    {outgoing.length === 0 ? (
                      <p className="mt-1 text-sm text-muted">Este tablero no tiene reglas.</p>
                    ) : (
                      <ul className="mt-3 space-y-2">
                        {outgoing.map((a) => {
                          const d = describeAutomation(a, flow.boards, members);
                          const badge = ACTION_BADGE[a.action_type] ?? SAME_ITEM_BADGE;
                          return (
                            <li key={a.id} className={cn("flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm", !a.is_active && "opacity-60")}>
                              <span className={cn(badge.className, "rounded-full px-2 py-0.5 text-xs font-semibold")}>{badge.label}</span>
                              <span>
                                <span className="text-muted">{d.when},</span> {d.then}
                                {!a.is_active && <span className="text-muted"> · pausada</span>}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {loose.length > 0 && (
        <section className="mt-10" aria-labelledby="loose-title">
          <h2 id="loose-title" className="mb-3 text-sm font-bold uppercase tracking-wide text-muted">
            Tableros sin conexiones
          </h2>
          <ul className="flex flex-wrap gap-2">
            {loose.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/t/${b.id}/reglas`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-sm hover:border-line-strong"
                >
                  {b.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
