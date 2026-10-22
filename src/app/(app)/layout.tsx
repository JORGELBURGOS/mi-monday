import { requireUser } from "@/lib/auth";
import { getMyWorkspaces, getSidebarBoards } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const supabase = await createClient();
  const [workspaces, boards, profile] = await Promise.all([
    getMyWorkspaces(user.id),
    getSidebarBoards(),
    supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle(),
  ]);

  return (
    <AppShell
      user={{ email: user.email, name: profile.data?.full_name ?? null }}
      workspaces={workspaces.map((w) => ({ id: w.id, name: w.name, role: w.role }))}
      boards={boards}
    >
      {children}
    </AppShell>
  );
}
