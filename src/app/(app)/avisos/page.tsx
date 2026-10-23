import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/misc";
import { NotificationList } from "./notification-list";

export const metadata: Metadata = { title: "Avisos" };

export default async function NotificationsPage() {
  const user = await requireUser("/avisos");
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("id, title, body, board_id, task_id, automation_name, read_at, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(150);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8">
      <PageHeader
        title="Avisos"
        description="Lo que te avisaron las reglas de tus tableros: vencimientos, asignaciones, ítems trabados y más. Vetta no envía emails; todo llega acá."
      />
      <NotificationList items={data ?? []} />
    </div>
  );
}
