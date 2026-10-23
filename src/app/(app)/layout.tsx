import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getMyWorkspaces, getSidebarBoards } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, must_change_password")
    .eq("id", user.id)
    .maybeSingle();

  // Contraseña temporal pendiente: primero hay que elegir una propia.
  // (La base de datos además bloquea el acceso a los datos mientras tanto.)
  if (profile?.must_change_password) redirect("/cambiar-clave");

  const [workspaces, boards, unread] = await Promise.all([
    getMyWorkspaces(user.id),
    getSidebarBoards(),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("read_at", null),
  ]);

  return (
    <AppShell
      user={{ email: user.email, name: profile?.full_name ?? null }}
      workspaces={workspaces.map((w) => ({ id: w.id, name: w.name, role: w.role }))}
      boards={boards}
      unread={unread.count ?? 0}
    >
      {children}
    </AppShell>
  );
}
