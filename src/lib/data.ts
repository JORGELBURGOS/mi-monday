import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/database.types";
import type { WorkspaceRole } from "@/lib/constants";
import { displayName } from "@/lib/format";
import { parseColumn, type BoardColumn } from "@/lib/columns";

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
export type Automation = Tables<"board_automations">;

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

export type BoardData = {
  board: Board;
  workspace: WorkspaceWithRole;
  canManage: boolean;
  statuses: Status[];
  groups: Group[];
  tasks: Task[];
  members: Member[];
  columns: BoardColumn[];
};

export async function getBoardData(boardId: string, userId: string): Promise<BoardData | null> {
  const supabase = await createClient();
  const { data: board } = await supabase.from("boards").select("*").eq("id", boardId).maybeSingle();
  if (!board) return null;

  const [workspace, statuses, groups, tasks, members, columns] = await Promise.all([
    getWorkspace(board.workspace_id, userId),
    supabase.from("board_statuses").select("*").eq("board_id", boardId).order("position"),
    supabase.from("board_groups").select("*").eq("board_id", boardId).order("position"),
    supabase.from("tasks").select("*").eq("board_id", boardId).order("position"),
    getWorkspaceMembers(board.workspace_id),
    supabase.from("board_columns").select("*").eq("board_id", boardId).order("position"),
  ]);
  if (!workspace) return null;
  if (statuses.error || groups.error || tasks.error || columns.error) throw new Error("No se pudo cargar el tablero.");

  const canManage = board.created_by === userId || workspace.role === "owner" || workspace.role === "admin";
  return {
    board,
    workspace,
    canManage,
    statuses: statuses.data ?? [],
    groups: groups.data ?? [],
    tasks: tasks.data ?? [],
    members,
    columns: (columns.data ?? []).map(parseColumn),
  };
}

/* ----------------------------------------------------- flujo entre tableros */

export type FlowBoard = Pick<Board, "id" | "name" | "visibility" | "is_archived" | "created_by"> & {
  canManage: boolean;
  groups: Pick<Group, "id" | "name" | "color" | "position">[];
  statuses: Pick<Status, "id" | "label" | "color" | "position" | "is_done">[];
  columns: BoardColumn[];
};

export type WorkspaceFlow = {
  workspace: WorkspaceWithRole;
  boards: FlowBoard[];
  automations: Automation[];
};

/**
 * Tableros del espacio (los que el usuario ve) con sus carpetas, estados y
 * columnas, más las reglas configuradas. Lo usan el editor de reglas y el mapa
 * del flujo.
 */
export async function getWorkspaceFlow(workspaceId: string, userId: string): Promise<WorkspaceFlow | null> {
  const workspace = await getWorkspace(workspaceId, userId);
  if (!workspace) return null;
  const supabase = await createClient();
  const { data: boards, error } = await supabase
    .from("boards")
    .select("id, name, visibility, is_archived, created_by")
    .eq("workspace_id", workspaceId)
    .order("name");
  if (error) throw new Error("No se pudieron cargar los tableros.");
  const ids = (boards ?? []).map((b) => b.id);
  if (ids.length === 0) return { workspace, boards: [], automations: [] };

  const [groups, statuses, columns, automations] = await Promise.all([
    supabase.from("board_groups").select("id, board_id, name, color, position").in("board_id", ids).order("position"),
    supabase.from("board_statuses").select("id, board_id, label, color, position, is_done").in("board_id", ids).order("position"),
    supabase.from("board_columns").select("*").in("board_id", ids).order("position"),
    supabase.from("board_automations").select("*").eq("workspace_id", workspaceId).order("position").order("created_at"),
  ]);
  if (groups.error || statuses.error || columns.error || automations.error) throw new Error("No se pudo cargar el flujo.");

  const admin = workspace.role === "owner" || workspace.role === "admin";
  return {
    workspace,
    automations: automations.data ?? [],
    boards: (boards ?? []).map((b) => ({
      ...b,
      canManage: admin || b.created_by === userId,
      groups: (groups.data ?? []).filter((g) => g.board_id === b.id),
      statuses: (statuses.data ?? []).filter((s) => s.board_id === b.id),
      columns: (columns.data ?? []).filter((c) => c.board_id === b.id).map(parseColumn),
    })),
  };
}

