"use client";

import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { markNotificationsReadAction } from "@/app/actions/notifications";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { IconBell, IconCheck } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { formatDateTime, relativeTime } from "@/lib/format";

type Item = {
  id: number;
  title: string;
  body: string | null;
  board_id: string | null;
  task_id: string | null;
  automation_name: string | null;
  read_at: string | null;
  created_at: string;
};

export function NotificationList({ items }: { items: Item[] }) {
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [list, markLocal] = useOptimistic(items, (state: Item[], ids: number[] | "all") =>
    state.map((n) => (ids === "all" || ids.includes(n.id) ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)),
  );
  const unread = list.filter((n) => !n.read_at).length;

  const mark = (ids: number[] | "all") =>
    startTransition(async () => {
      markLocal(ids);
      const res = await markNotificationsReadAction(ids);
      if (!res.ok) toast.error(res.error);
    });

  if (list.length === 0) {
    return (
      <EmptyState
        icon={<IconBell />}
        title="No tenés avisos"
        description="Cuando una regla te avise de algo (por ejemplo, que un ítem vence pronto), lo vas a ver acá."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted" aria-live="polite">
          {unread ? `${unread} sin leer` : "Todo leído"}
        </p>
        {unread > 0 && (
          <Button size="sm" onClick={() => mark("all")}>
            <IconCheck size={15} /> Marcar todo como leído
          </Button>
        )}
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
        {list.map((n) => {
          const href = n.board_id ? `/t/${n.board_id}${n.task_id ? `?item=${n.task_id}` : ""}` : null;
          const content = (
            <>
              <p className={cn("break-words text-sm", !n.read_at && "font-semibold")}>{n.title}</p>
              {n.body && <p className="mt-0.5 text-xs text-muted">{n.body}</p>}
              <p className="mt-1 text-xs text-subtle">
                {n.automation_name && <>Regla «{n.automation_name}» · </>}
                <time dateTime={n.created_at} title={formatDateTime(n.created_at)} suppressHydrationWarning>
                  {relativeTime(n.created_at)}
                </time>
              </p>
            </>
          );
          return (
            <li key={n.id} className={cn("flex items-start gap-3 px-4 py-3", !n.read_at && "bg-accent-soft/40")}>
              <span aria-hidden className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-accent")} />
              <div className="min-w-0 flex-1">
                {href ? (
                  <Link href={href} onClick={() => !n.read_at && mark([n.id])} className="block hover:underline">
                    {content}
                  </Link>
                ) : (
                  content
                )}
              </div>
              {!n.read_at && (
                <Button size="icon-sm" variant="ghost" aria-label={`Marcar como leído: ${n.title}`} onClick={() => mark([n.id])}>
                  <IconCheck size={15} />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
