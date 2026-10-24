import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/database.types";
import type { WorkspaceRole } from "@/lib/constants";
import { displayName } from "@/lib/format";
import { NON_RULE_KINDS, parseColumn, type BoardColumn, type ChecklistTemplate } from "@/lib/columns";
import { isBoardRole, type BoardAccess, type Team } from "@/lib/teams";
export type { Team, BoardAccess } from "@/lib/teams";
export type { ChecklistTemplate } from "@/lib/columns";

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
  deactivated_at?: string | null;
  must_change_password?: boolean;
  /** Solo lo ve el propio superadministrador (para los demás no existe). */
  is_platform_admin?: boolean;
};

export type WorkspaceWithRole = Workspace & { role: WorkspaceRole };

export const getMyWorkspaces = cache(async (userId: string): Promise<WorkspaceWithRole[]> => {
  const supabase = await createClient();
  // El superadministrador ve todas las empresas y en cada una actúa como administrador principal.
  if (await isPlatformAdmin(userId)) {
    const { data, error } = await supabase.from("workspaces").select("*").order("name");
    if (error) throw new Error("No se pudieron cargar las empresas.");
    return (data ?? []).map((w) => ({ ...w, role: "owner" as const }));
  }
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role, workspaces!inner(*)")
    .eq("user_id", userId);
  if (error) throw new Error("No se pudieron cargar tus empresas.");
  return (data ?? [])
    .map((row) => ({ ...(row.workspaces as Workspace), role: row.role }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
});

export const getWorkspace = cache(async (workspaceId: string, userId: string): Promise<WorkspaceWithRole | null> => {
  const supabase = await createClient();
  if (await isPlatformAdmin(userId)) {
    const { data } = await supabase.from("workspaces").select("*").eq("id", workspaceId).maybeSingle();
    return data ? { ...data, role: "owner" } : null;
  }
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
    .select("user_id, role, created_at, profiles!inner(full_name, email, deactivated_at, must_change_password, is_platform_admin)")
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
      deactivated_at: m.profiles?.deactivated_at ?? null,
      must_change_password: m.profiles?.must_change_password ?? false,
      is_platform_admin: m.profiles?.is_platform_admin ?? false,
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
  /** Tableros de la empresa (para configurar "Conectar tableros"). */
  workspaceBoards: { id: string; name: string }[];
  /** Tableros conectados por columnas "Conectar tableros", con sus elementos. */
  linkedBoards: { id: string; name: string; statuses: Status[]; columns: BoardColumn[] }[];
  linkedItems: Pick<Task, "id" | "title" | "board_id" | "status_id" | "due_date" | "priority" | "assignee_id" | "custom_values">[];
  /** Plantillas de checklist de la empresa. */
  checklistTemplates: ChecklistTemplate[];
  /** Equipos de la empresa. */
  teams: Team[];
  /** Lo que la persona conectada puede hacer en el tablero. */
  access: BoardAccess;
};

/** Equipos de la empresa con sus integrantes. */
export async function getWorkspaceTeams(workspaceId: string): Promise<Team[]> {
  const supabase = await createClient();
  const { data: teams } = await supabase.from("workspace_teams").select("id, name, color, description").eq("workspace_id", workspaceId).order("name");
  if (!teams?.length) return [];
  const { data: members } = await supabase.from("team_members").select("team_id, user_id").in("team_id", teams.map((t) => t.id));
  return teams.map((t) => ({ ...t, member_ids: (members ?? []).filter((m) => m.team_id === t.id).map((m) => m.user_id) }));
}


export async function getChecklistTemplates(workspaceId: string): Promise<ChecklistTemplate[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("checklist_templates").select("id, name, items, created_by").eq("workspace_id", workspaceId).order("name");
  return (data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    created_by: t.created_by,
    items: (Array.isArray(t.items) ? t.items : [])
      .filter((i): i is { text: string; header?: boolean; note?: string } => Boolean(i) && typeof i === "object" && !Array.isArray(i) && typeof (i as { text?: unknown }).text === "string")
      .map((i) => ({ text: i.text, ...(i.header ? { header: true } : {}), ...(typeof i.note === "string" && i.note ? { note: i.note } : {}) })),
  }));
}

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

  const [{ data: role }, teams] = await Promise.all([supabase.rpc("my_board_role", { p_board: boardId }), getWorkspaceTeams(board.workspace_id)]);
  const access: BoardAccess = {
    userId,
    role: isBoardRole(role) ? role : null,
    teamIds: teams.filter((t) => t.member_ids.includes(userId)).map((t) => t.id),
  };
  const canManage = access.role === "admin";
  const parsedColumns = (columns.data ?? []).map(parseColumn);

  // Conectar tableros: se cargan los tableros vinculados que la persona puede ver (RLS).
  const linkedIds = [...new Set(parsedColumns.filter((c) => c.kind === "connect" && c.settings.boardId).map((c) => c.settings.boardId!))];
  const [wsBoards, lBoards, lStatuses, lColumns, lItems, templates] = await Promise.all([
    supabase.from("boards").select("id, name").eq("workspace_id", board.workspace_id).eq("is_archived", false).order("name"),
    linkedIds.length ? supabase.from("boards").select("id, name").in("id", linkedIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    linkedIds.length ? supabase.from("board_statuses").select("*").in("board_id", linkedIds).order("position") : Promise.resolve({ data: [] as Status[] }),
    linkedIds.length ? supabase.from("board_columns").select("*").in("board_id", linkedIds).order("position") : Promise.resolve({ data: [] }),
    linkedIds.length
      ? supabase.from("tasks").select("id, title, board_id, status_id, due_date, priority, assignee_id, custom_values").in("board_id", linkedIds).is("parent_id", null).order("position").limit(3000)
      : Promise.resolve({ data: [] }),
    parsedColumns.some((c) => c.kind === "checklist") ? getChecklistTemplates(board.workspace_id) : Promise.resolve([] as ChecklistTemplate[]),
  ]);

  return {
    board,
    workspace,
    canManage,
    statuses: statuses.data ?? [],
    groups: groups.data ?? [],
    tasks: tasks.data ?? [],
    members,
    columns: parsedColumns,
    workspaceBoards: wsBoards.data ?? [],
    linkedBoards: (lBoards.data ?? []).map((b) => ({
      ...b,
      statuses: (lStatuses.data ?? []).filter((x) => x.board_id === b.id),
      columns: ((lColumns.data ?? []) as Parameters<typeof parseColumn>[0][]).filter((x) => x.board_id === b.id).map(parseColumn),
    })),
    linkedItems: (lItems.data ?? []) as BoardData["linkedItems"],
    checklistTemplates: templates,
    teams,
    access,
  };
}

/* ----------------------------------------------------- flujo entre tableros */

export type FlowBoard = Pick<Board, "id" | "name" | "visibility" | "is_archived" | "created_by"> & {
  canManage: boolean;
  groups: Pick<Group, "id" | "name" | "color" | "position">[];
  statuses: Pick<Status, "id" | "label" | "color" | "position" | "is_done">[];
  columns: BoardColumn[];
  /** Columnas de checklist (para el disparador "se tilda un paso"). */
  checklists: { id: string; name: string }[];
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
      // Las reglas solo trabajan con columnas que guardan valores (no fórmulas ni registros).
      columns: (columns.data ?? [])
        .filter((c) => c.board_id === b.id)
        .map(parseColumn)
        .filter((c) => !NON_RULE_KINDS.includes(c.kind)),
      checklists: (columns.data ?? []).filter((c) => c.board_id === b.id && c.kind === "checklist").map((c) => ({ id: c.id, name: c.name })),
    })),
  };
}


/* -------------------------------------------------------- accesos a tableros */

export type AccessBoard = Pick<Board, "id" | "name" | "visibility" | "is_archived">;

/** Tableros de la empresa y quién tiene acceso explícito a cada uno. */
export async function getWorkspaceAccess(workspaceId: string): Promise<{ boards: AccessBoard[]; grants: { board_id: string; user_id: string }[] }> {
  const supabase = await createClient();
  const { data: boards, error } = await supabase
    .from("boards")
    .select("id, name, visibility, is_archived")
    .eq("workspace_id", workspaceId)
    .order("name");
  if (error) throw new Error("No se pudieron cargar los tableros.");
  const ids = (boards ?? []).map((b) => b.id);
  if (ids.length === 0) return { boards: [], grants: [] };
  const { data: grants } = await supabase.from("board_members").select("board_id, user_id").in("board_id", ids);
  return { boards: boards ?? [], grants: grants ?? [] };
}

/** ¿El usuario es superadministrador? */
export const isPlatformAdmin = cache(async (userId: string): Promise<boolean> => {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("is_platform_admin").eq("id", userId).maybeSingle();
  return Boolean(data?.is_platform_admin);
});

/** Personas con acceso explícito a un tablero. */
export async function getBoardGrants(boardId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("board_members").select("user_id").eq("board_id", boardId);
  return (data ?? []).map((g) => g.user_id);
}

/** Permisos de un tablero: por persona y por equipo, con su rol. */
export async function getBoardPermissions(boardId: string): Promise<{ users: Record<string, string>; teams: Record<string, string> }> {
  const supabase = await createClient();
  const [{ data: users }, { data: teams }] = await Promise.all([
    supabase.from("board_members").select("user_id, role").eq("board_id", boardId),
    supabase.from("board_teams").select("team_id, role").eq("board_id", boardId),
  ]);
  return {
    users: Object.fromEntries((users ?? []).map((u) => [u.user_id, u.role])),
    teams: Object.fromEntries((teams ?? []).map((t) => [t.team_id, t.role])),
  };
}
