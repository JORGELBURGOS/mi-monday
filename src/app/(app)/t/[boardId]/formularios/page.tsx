import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getWorkspace } from "@/lib/data";
import { uuidSchema } from "@/lib/validation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/misc";
import { FormsList } from "@/components/forms/forms-list";

export const metadata: Metadata = { title: "Formularios" };

export default async function BoardFormsPage({ params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params;
  if (!uuidSchema.safeParse(boardId).success) notFound();
  const user = await requireUser(`/t/${boardId}/formularios`);
  const supabase = await createClient();
  const { data: board } = await supabase.from("boards").select("id, name, workspace_id, created_by, is_archived").eq("id", boardId).maybeSingle();
  if (!board) notFound();
  const workspace = await getWorkspace(board.workspace_id, user.id);
  if (!workspace) notFound();
  const canManage = !board.is_archived && (board.created_by === user.id || workspace.role === "owner" || workspace.role === "admin");

  const { data: forms } = await supabase.from("board_forms").select("id, name, slug, is_published, access, closes_at, updated_at").eq("board_id", boardId).order("created_at");
  const ids = (forms ?? []).map((f) => f.id);
  const { data: subs } = ids.length
    ? await supabase.from("form_submissions").select("form_id, created_at").in("form_id", ids).order("created_at", { ascending: false }).limit(5000)
    : { data: [] as { form_id: string; created_at: string }[] };
  const stats: Record<string, { count: number; last: string | null }> = {};
  for (const s of subs ?? []) {
    const st = (stats[s.form_id] ??= { count: 0, last: null });
    st.count += 1;
    st.last ??= s.created_at;
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8">
      <PageHeader
        eyebrow={
          <Link href={`/t/${board.id}`} className="hover:text-fg hover:underline">
            ← Volver a {board.name}
          </Link>
        }
        title="Formularios"
        description="Cada respuesta crea un elemento en este tablero, con sus columnas completas, y dispara las reglas automáticas. Quien responde puede seguir el estado de su pedido."
      />
      <FormsList boardId={board.id} forms={forms ?? []} stats={stats} canManage={canManage} />
    </div>
  );
}
