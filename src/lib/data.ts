import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/database.types";
import type { WorkspaceRole } from "@/lib/constants";
import { displayName } from "@/lib/format";

/*
 * Capa de acceso a datos. Todas las consultas usan la sesión del usuario, así
 * que la base de datos (RLS) decide qué filas devuelve: no hay filtros de
 * seguridad del lado del cliente.
 */

export type Workspace = Tables<"workspaces">;
export type Board = Tables<"boards">;
export type BoardOverview = Tables<"board_overview">;
export type Group = Tables<"board_groups">;
export type Status = Tables<"board_statuses">;
export type Task = Tables<"tasks">;
export type Invitation = Tables<"workspace_invitations">;

export type Member = {
  user_id: string;
  role: WorkspaceRole;
  created_at: string;
  full_name: string | null;
  email: string | null;
};

export type WorkspaceWithRole = Workspace & { role: WorkspaceRole };

export const getMyWorkspaces = cache(async (userId: string): Promise<WorkspaceWithRole[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role, workspaces!inner(*)")
    .eq("user_id", userId);
  if (error) throw new Error("No se pudieron cargar tus espacios.");
  return (data ?? [])
    .map((row) => ({ ...(row.workspaces as Workspace), role: row.role }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
});

export const getWorkspace = cache(async (workspaceId: string, userId: string): Promise<WorkspaceWithRole | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role, workspaces!inner(*)")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error || !data) return null;
  return { ...(data.workspaces as Workspace), role: data.role };
});

export const getSidebarBoards = cache(async (): Promise<Pick<Board, "id" | "name" | "workspace_id" | "visibility">[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("boards")
    .select("id, name, workspace_id, visibility")
    .eq("is_archived", false)
    .order("name");
  if (error) return [];
  return data ?? [];
});

export async function getWorkspaceBoards(workspaceId: string): Promise<BoardOverview[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("board_overview")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("last_activity_at", { ascending: false });
  if (error) throw new Error("No se pudieron cargar los tableros.");
  return data ?? [];
}

export async function getRecentBoards(limit = 8): Promise<BoardOverview[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("board_overview")
    .select("*")
    .eq("is_archived", false)
    .order("last_activity_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error("No se pudieron cargar los tableros recientes.");
  return data ?? [];
}

export async function getPendingInvitationsForMe(email: string): Promise<Invitation[]> {
  if (!email) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("workspace_invitations")
    .select("*")
    .eq("status", "pending")
    .eq("email", email.toLowerCase())
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function getWorkspaceMembers(workspaceId: string): Promise<Member[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("user_id, role, created_at, profiles!inner(full_name, email)")
    .eq("workspace_id", workspaceId);
  if (error) throw new Error("No se pudieron cargar los miembros.");
  const order: Record<WorkspaceRole, number> = { owner: 0, admin: 1, member: 2 };
  return (data ?? [])
    .map((m) => ({
      user_id: m.user_id,
      role: m.role,
      created_at: m.created_at,
      full_name: m.profiles?.full_name ?? null,
      email: m.profiles?.email ?? null,
    }))
    .sort((a, b) => order[a.role] - order[b.role] || displayName(a).localeCompare(displayName(b), "es"));
}

export async function getWorkspaceInvitations(workspaceId: string): Promise<Invitation[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("workspace_invitations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  return data ?? [];
}

export type BoardData = {
  board: Board;
  workspace: WorkspaceWithRole;
  canManage: boolean;
  statuses: Status[];
  groups: Group[];
  tasks: Task[];
  members: Member[];
};

export async function getBoardData(boardId: string, userId: string): Promise<BoardData | null> {
  const supabase = await createClient();
  const { data: board } = await supabase.from("boards").select("*").eq("id", boardId).maybeSingle();
  if (!board) return null;

  const [workspace, statuses, groups, tasks, members] = await Promise.all([
    getWorkspace(board.workspace_id, userId),
    supabase.from("board_statuses").select("*").eq("board_id", boardId).order("position"),
    supabase.from("board_groups").select("*").eq("board_id", boardId).order("position"),
    supabase.from("tasks").select("*").eq("board_id", boardId).order("position"),
    getWorkspaceMembers(board.workspace_id),
  ]);
  if (!workspace) return null;
  if (statuses.error || groups.error || tasks.error) throw new Error("No se pudo cargar el tablero.");

  const canManage = board.created_by === userId || workspace.role === "owner" || workspace.role === "admin";
  return {
    board,
    workspace,
    canManage,
    statuses: statuses.data ?? [],
    groups: groups.data ?? [],
    tasks: tasks.data ?? [],
    members,
  };
}

