"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/cn";
import { signOutAction } from "@/app/actions/auth";
import {
  IconBoard,
  IconChevronDown,
  IconChevronRight,
  IconHome,
  IconLock,
  IconLogout,
  IconMenu,
  IconPlus,
  IconSettings,
  IconUsers,
  IconX,
  LogoMark,
} from "@/components/ui/icons";
import { Avatar } from "@/components/ui/misc";
import type { WorkspaceRole } from "@/lib/constants";

type SidebarWorkspace = { id: string; name: string; role: WorkspaceRole };
type SidebarBoard = { id: string; name: string; workspace_id: string; visibility: "workspace" | "private" };

export function AppShell({
  user,
  workspaces,
  boards,
  children,
}: {
  user: { email: string; name: string | null };
  workspaces: SidebarWorkspace[];
  boards: SidebarBoard[];
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);

  // Cerrar el menú móvil al navegar.
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMobileOpen(false);
  }

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const sidebar = <SidebarContent user={user} workspaces={workspaces} boards={boards} pathname={pathname} />;

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      {/* Barra superior en pantallas chicas */}
      <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-3 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Abrir navegación"
          aria-expanded={mobileOpen}
          aria-controls="nav-movil"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg hover:bg-surface-2"
        >
          <IconMenu />
        </button>
        <Link href="/inicio" className="flex items-center gap-2 font-extrabold">
          <LogoMark size={24} />
          {siteConfig.name}
        </Link>
      </div>

      {/* Lateral fijo en escritorio */}
      <aside className="sticky top-0 hidden h-dvh border-r border-line bg-surface lg:block">{sidebar}</aside>

      {/* Drawer móvil */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navegación" id="nav-movil">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Cerrar navegación"
            tabIndex={-1}
            onClick={() => setMobileOpen(false)}
          />
          <div className="animate-in absolute inset-y-0 left-0 w-[86%] max-w-xs border-r border-line bg-surface shadow-pop">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Cerrar navegación"
              className="absolute right-3 top-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-surface-2"
              autoFocus
            >
              <IconX />
            </button>
            {sidebar}
          </div>
        </div>
      )}

      <main id="contenido" className="min-w-0">
        {children}
      </main>
    </div>
  );
}

function SidebarContent({
  user,
  workspaces,
  boards,
  pathname,
}: {
  user: { email: string; name: string | null };
  workspaces: SidebarWorkspace[];
  boards: SidebarBoard[];
  pathname: string;
}) {
  const displayName = user.name?.trim() || user.email;
  return (
    <nav aria-label="Principal" className="flex h-full flex-col">
      <div className="px-4 pb-2 pt-4">
        <Link href="/inicio" className="flex items-center gap-2.5 rounded-lg px-1 py-1 text-[17px] font-extrabold">
          <LogoMark />
          <span className="truncate">{siteConfig.name}</span>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        <NavLink href="/inicio" active={pathname === "/inicio"} icon={<IconHome size={17} />}>
          Inicio
        </NavLink>

        <div className="mb-1 mt-5 flex items-center justify-between px-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-subtle">Espacios</span>
          <Link
            href="/espacios/nuevo"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
            aria-label="Crear espacio de trabajo"
            title="Crear espacio"
          >
            <IconPlus size={16} />
          </Link>
        </div>

        {workspaces.length === 0 ? (
          <p className="px-2 py-2 text-sm text-muted">Todavía no tenés espacios.</p>
        ) : (
          <ul className="space-y-0.5">
            {workspaces.map((ws) => (
              <WorkspaceNode
                key={ws.id}
                workspace={ws}
                boards={boards.filter((b) => b.workspace_id === ws.id)}
                pathname={pathname}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-line p-3">
        <Link
          href="/cuenta"
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-surface-2",
            pathname === "/cuenta" && "bg-surface-2",
          )}
          aria-current={pathname === "/cuenta" ? "page" : undefined}
        >
          <Avatar name={displayName} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{displayName}</span>
            <span className="block truncate text-xs text-muted">Mi cuenta</span>
          </span>
        </Link>
        <form action={signOutAction}>
          <button
            type="submit"
            className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-muted hover:bg-surface-2 hover:text-fg"
          >
            <IconLogout size={17} />
            Cerrar sesión
          </button>
        </form>
      </div>
    </nav>
  );
}

function NavLink({
  href,
  active,
  icon,
  children,
  className,
}: {
  href: string;
  active: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm",
        active ? "bg-accent-soft font-semibold text-accent" : "text-fg hover:bg-surface-2",
        className,
      )}
    >
      {icon && <span className={cn("shrink-0", active ? "text-accent" : "text-muted")}>{icon}</span>}
      <span className="truncate">{children}</span>
    </Link>
  );
}

function WorkspaceNode({
  workspace,
  boards,
  pathname,
}: {
  workspace: SidebarWorkspace;
  boards: SidebarBoard[];
  pathname: string;
}) {
  const inside = pathname.startsWith(`/e/${workspace.id}`) || boards.some((b) => pathname.startsWith(`/t/${b.id}`));
  const [open, setOpen] = useState(true);
  const listId = `ws-${workspace.id}`;

  return (
    <li>
      <div className="group flex items-center">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={listId}
          aria-label={open ? `Contraer ${workspace.name}` : `Expandir ${workspace.name}`}
          className="inline-flex h-7 w-6 shrink-0 items-center justify-center rounded-md text-subtle hover:text-fg"
        >
          {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        </button>
        <Link
          href={`/e/${workspace.id}`}
          aria-current={pathname === `/e/${workspace.id}` ? "page" : undefined}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm font-semibold hover:bg-surface-2",
            inside && "text-fg",
            pathname === `/e/${workspace.id}` && "bg-surface-2",
          )}
        >
          <span
            aria-hidden
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-fg text-[10px] font-bold text-bg"
          >
            {workspace.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="truncate">{workspace.name}</span>
        </Link>
      </div>
      {open && (
        <ul id={listId} className="mb-2 ml-[18px] space-y-0.5 border-l border-line pl-2">
          {boards.map((b) => (
            <li key={b.id}>
              <NavLink
                href={`/t/${b.id}`}
                active={pathname.startsWith(`/t/${b.id}`)}
                icon={b.visibility === "private" ? <IconLock size={15} /> : <IconBoard size={15} />}
              >
                {b.name}
                {b.visibility === "private" && <span className="sr-only"> (privado)</span>}
              </NavLink>
            </li>
          ))}
          <li className="flex gap-0.5">
            <NavLink
              href={`/e/${workspace.id}?nuevo=1`}
              active={false}
              icon={<IconPlus size={15} />}
              className="flex-1 text-muted"
            >
              Nuevo tablero
            </NavLink>
          </li>
          <li>
            <NavLink
              href={`/e/${workspace.id}/miembros`}
              active={pathname === `/e/${workspace.id}/miembros`}
              icon={<IconUsers size={15} />}
              className="text-muted"
            >
              Miembros
            </NavLink>
          </li>
          {(workspace.role === "owner" || workspace.role === "admin") && (
            <li>
              <NavLink
                href={`/e/${workspace.id}/ajustes`}
                active={pathname === `/e/${workspace.id}/ajustes`}
                icon={<IconSettings size={15} />}
                className="text-muted"
              >
                Ajustes del espacio
              </NavLink>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}
