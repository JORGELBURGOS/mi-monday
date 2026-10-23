import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getMyWorkspaces, getRecentBoards } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { BoardCard } from "@/components/board-card";
import { EmptyState, PageHeader, SectionTitle } from "@/components/ui/misc";
import { buttonClasses } from "@/components/ui/button-classes";
import { IconBoard, IconPlus, IconUsers } from "@/components/ui/icons";
import { ROLE_LABELS } from "@/lib/constants";

export const metadata: Metadata = { title: "Inicio" };

export default async function HomePage() {
  const user = await requireUser("/inicio");
  const supabase = await createClient();
  const [workspaces, recent, profile] = await Promise.all([
    getMyWorkspaces(user.id),
    getRecentBoards(9),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);
  const wsName = new Map(workspaces.map((w) => [w.id, w.name]));
  const firstName = profile.data?.full_name?.split(" ")[0];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8">
      <PageHeader
        title={firstName ? `Hola, ${firstName}` : "Inicio"}
        description="Tus tableros recientes y espacios de trabajo."
        actions={
          workspaces.length > 0 && (
            <Link href="/espacios/nuevo" className={buttonClasses("secondary")}>
              <IconPlus size={16} /> Nuevo espacio
            </Link>
          )
        }
      />

      {workspaces.length === 0 ? (
        <EmptyState
          icon={<IconUsers />}
          title="Creá tu primer espacio de trabajo"
          description="Un espacio agrupa los tableros de un equipo o un proyecto. Después podés sumar a otras personas desde Miembros."
          action={
            <Link href="/espacios/nuevo" className={buttonClasses("primary")}>
              <IconPlus size={16} /> Crear espacio
            </Link>
          }
        />
      ) : (
        <>
          <section className="mb-10" aria-labelledby="recent-title">
            <SectionTitle>
              <span id="recent-title">Tableros recientes</span>
            </SectionTitle>
            {recent.length === 0 ? (
              <EmptyState
                icon={<IconBoard />}
                title="Todavía no hay tableros"
                description="Creá un tablero dentro de uno de tus espacios para empezar a organizar tareas."
                action={
                  <Link href={`/e/${workspaces[0].id}?nuevo=1`} className={buttonClasses("primary")}>
                    <IconPlus size={16} /> Crear tablero
                  </Link>
                }
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {recent.map((b) => (
                  <BoardCard key={b.id} board={b} workspaceName={wsName.get(b.workspace_id ?? "")} />
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="ws-title">
            <SectionTitle>
              <span id="ws-title">Tus espacios</span>
            </SectionTitle>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {workspaces.map((w) => (
                <li key={w.id}>
                  <Link
                    href={`/e/${w.id}`}
                    className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card hover:border-line-strong"
                  >
                    <span
                      aria-hidden
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-fg text-sm font-bold text-bg"
                    >
                      {w.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-bold">{w.name}</span>
                      <span className="block text-xs text-muted">Tu rol: {ROLE_LABELS[w.role]}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
