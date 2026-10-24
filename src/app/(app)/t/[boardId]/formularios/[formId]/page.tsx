import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getWorkspace, getWorkspaceMembers } from "@/lib/data";
import { uuidSchema } from "@/lib/validation";
import { createClient } from "@/lib/supabase/server";
import { parseColumn } from "@/lib/columns";
import { readConfig } from "@/lib/forms";
import { FormBuilder, type Submission } from "@/components/forms/form-builder";

type Props = { params: Promise<{ boardId: string; formId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { formId } = await params;
  if (!uuidSchema.safeParse(formId).success) return { title: "Formulario" };
  const supabase = await createClient();
  const { data } = await supabase.from("board_forms").select("name").eq("id", formId).maybeSingle();
  return { title: data?.name ?? "Formulario" };
}

export default async function FormEditorPage({ params }: Props) {
  const { boardId, formId } = await params;
  if (!uuidSchema.safeParse(boardId).success || !uuidSchema.safeParse(formId).success) notFound();
  const user = await requireUser(`/t/${boardId}/formularios/${formId}`);
  const supabase = await createClient();
  const [{ data: form }, { data: board }] = await Promise.all([
    supabase.from("board_forms").select("*").eq("id", formId).eq("board_id", boardId).maybeSingle(),
    supabase.from("boards").select("id, name, workspace_id, created_by, is_archived").eq("id", boardId).maybeSingle(),
  ]);
  if (!form || !board) notFound();
  const workspace = await getWorkspace(board.workspace_id, user.id);
  if (!workspace) notFound();
  const canManage = !board.is_archived && (board.created_by === user.id || workspace.role === "owner" || workspace.role === "admin");

  const [cols, statuses, groups, members, hasPw, subs] = await Promise.all([
    supabase.from("board_columns").select("*").eq("board_id", boardId).order("position"),
    supabase.from("board_statuses").select("id, label, color, position").eq("board_id", boardId).order("position"),
    supabase.from("board_groups").select("id, name, position").eq("board_id", boardId).order("position"),
    getWorkspaceMembers(board.workspace_id),
    supabase.rpc("form_has_password", { p_form: formId }),
    supabase.from("form_submissions").select("id, task_id, submitted_by, answers, duration_ms, created_at").eq("form_id", formId).order("created_at", { ascending: false }).limit(1000),
  ]);
  const people = members.filter((m) => !m.is_platform_admin && !m.deactivated_at);
  const names = new Map(members.map((m) => [m.user_id, m.full_name?.trim() || m.email || "Usuario"]));

  return (
    <FormBuilder
      board={{ id: board.id, name: board.name }}
      form={{
        id: form.id,
        slug: form.slug,
        name: form.name,
        is_published: form.is_published,
        access: form.access === "members" || form.access === "password" ? form.access : "public",
        opens_at: form.opens_at,
        closes_at: form.closes_at,
        max_responses: form.max_responses,
        hasPassword: Boolean(hasPw.data),
        config: readConfig(form.config, form.name),
      }}
      data={{
        columns: (cols.data ?? []).map(parseColumn),
        statuses: statuses.data ?? [],
        groups: groups.data ?? [],
        members: people.map((m) => ({ user_id: m.user_id, full_name: m.full_name, email: m.email })),
      }}
      submissions={(subs.data ?? []).map(
        (s): Submission => ({
          id: s.id,
          task_id: s.task_id,
          by: s.submitted_by ? names.get(s.submitted_by) ?? "Ex usuario" : null,
          answers: (s.answers && typeof s.answers === "object" && !Array.isArray(s.answers) ? s.answers : {}) as Submission["answers"],
          duration_ms: s.duration_ms,
          created_at: s.created_at,
        }),
      )}
      canManage={canManage}
    />
  );
}
