/* -------------------------------------------------------------------------- */
/*  Equipos y permisos: tipos y reglas compartidas (navegador y servidor)      */
/*  La base de datos es la que manda (private.guard_task): esto solo replica    */
/*  las reglas para mostrar deshabilitado lo que no se puede tocar.             */
/* -------------------------------------------------------------------------- */

export type Team = {
  id: string;
  name: string;
  color: string;
  description: string | null;
  member_ids: string[];
};

export const BOARD_ROLES = ["admin", "editor", "own", "commenter", "viewer"] as const;
export type BoardRole = (typeof BOARD_ROLES)[number];

export const BOARD_ROLE_LABELS: Record<BoardRole, { label: string; help: string }> = {
  admin: { label: "Administrador", help: "Configura el tablero, sus permisos, reglas y formularios." },
  editor: { label: "Editor", help: "Crea y edita todos los elementos." },
  own: { label: "Solo lo suyo", help: "Ve todo y edita solo donde es responsable (o su equipo)." },
  commenter: { label: "Comentarista", help: "Ve todo y solo escribe actualizaciones." },
  viewer: { label: "Solo lectura", help: "Ve el tablero sin cambiar nada." },
};

const RANK: Record<BoardRole, number> = { admin: 5, editor: 4, own: 3, commenter: 2, viewer: 1 };
export const roleRank = (r: string | null | undefined) => (r && r in RANK ? RANK[r as BoardRole] : 0);
export const isBoardRole = (r: unknown): r is BoardRole => typeof r === "string" && (BOARD_ROLES as readonly string[]).includes(r);

/** Personas y equipos que pueden editar algo (carpeta, columna). Vacío = todos. */
export type Editors = { users?: string[]; teams?: string[] };

export function readEditors(raw: unknown): Editors {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const users = list(o.users);
  const teams = list(o.teams);
  return { ...(users.length ? { users } : {}), ...(teams.length ? { teams } : {}) };
}

export const isRestricted = (e: Editors | undefined) => Boolean(e && ((e.users?.length ?? 0) + (e.teams?.length ?? 0) > 0));

export function inEditors(e: Editors | undefined, userId: string, teamIds: string[]) {
  if (!isRestricted(e)) return true;
  return Boolean(e!.users?.includes(userId) || e!.teams?.some((t) => teamIds.includes(t)));
}

/** Lo que la persona conectada puede hacer en un tablero. */
export type BoardAccess = {
  userId: string;
  role: BoardRole | null;
  teamIds: string[];
};

export const canWrite = (a: BoardAccess) => roleRank(a.role) >= 3;
export const canComment = (a: BoardAccess) => roleRank(a.role) >= 2;
export const isAdmin = (a: BoardAccess) => a.role === "admin";

type TaskLike = { assignee_ids?: string[] | null; team_ids?: string[] | null; created_by?: string | null; group_id: string };

/** ¿Es "suyo"? (responsable, su equipo o lo creó). */
export function isMine(a: BoardAccess, t: TaskLike, parent?: TaskLike | null): boolean {
  const own = (x: TaskLike) => Boolean(x.assignee_ids?.includes(a.userId) || x.team_ids?.some((id) => a.teamIds.includes(id)) || x.created_by === a.userId);
  return own(t) || Boolean(parent && own(parent));
}

/** ¿Puede editar este elemento? (rol, "solo lo suyo" y carpeta restringida). */
export function canEditTask(a: BoardAccess, t: TaskLike, groupEditors: Editors | undefined, parent?: TaskLike | null): boolean {
  if (isAdmin(a)) return true;
  if (!canWrite(a)) return false;
  if (a.role === "own" && !isMine(a, t, parent)) return false;
  return inEditors(groupEditors, a.userId, a.teamIds);
}

/** ¿Puede crear elementos en esta carpeta? */
export function canCreateIn(a: BoardAccess, groupEditors: Editors | undefined): boolean {
  if (isAdmin(a)) return true;
  return canWrite(a) && inEditors(groupEditors, a.userId, a.teamIds);
}

/** ¿Puede cambiar esta columna? */
export function canEditColumn(a: BoardAccess, editors: Editors | undefined): boolean {
  return isAdmin(a) || inEditors(editors, a.userId, a.teamIds);
}

/** Nombres de carpetas cuyas secciones de checklist la persona no puede tocar. */
export function lockedSections(a: BoardAccess, groups: { name: string; editors?: unknown }[]): Set<string> {
  const out = new Set<string>();
  if (isAdmin(a)) return out;
  for (const g of groups) {
    const e = readEditors(g.editors);
    if (isRestricted(e) && !inEditors(e, a.userId, a.teamIds)) out.add(g.name.trim().toLowerCase());
  }
  return out;
}

/** Sección (encabezado anterior) de cada paso, en minúsculas. */
export function sectionOfSteps(items: { id: string; header?: boolean; text: string }[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  let current: string | null = null;
  for (const i of items) {
    if (i.header) current = i.text.trim().toLowerCase();
    out.set(i.id, current);
  }
  return out;
}

/** Responsables legibles: personas y equipos. */
export function assigneeLabel(
  t: { assignee_ids?: string[] | null; team_ids?: string[] | null },
  people: { user_id: string; full_name: string | null; email: string | null }[],
  teams: Pick<Team, "id" | "name">[],
): string {
  const names = (t.assignee_ids ?? []).map((id) => {
    const p = people.find((m) => m.user_id === id);
    return p ? p.full_name?.trim() || p.email || "Sin nombre" : null;
  });
  const tn = (t.team_ids ?? []).map((id) => teams.find((x) => x.id === id)?.name ?? null);
  return [...names, ...tn.map((n) => (n ? `Equipo ${n}` : null))].filter(Boolean).join(", ");
}
