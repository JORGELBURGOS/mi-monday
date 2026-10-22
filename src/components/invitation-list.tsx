"use client";

import { useTransition } from "react";
import { respondInvitationAction } from "@/app/actions/workspaces";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { IconMail } from "@/components/ui/icons";
import { ROLE_LABELS } from "@/lib/constants";
import type { Invitation } from "@/lib/data";

export function InvitationList({ invitations }: { invitations: Invitation[] }) {
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const respond = (id: string, accept: boolean) =>
    startTransition(async () => {
      const res = await respondInvitationAction(id, accept);
      if (res && !res.ok) toast.error(res.error);
      else if (res?.message) toast.success(res.message);
    });

  return (
    <ul className="space-y-2">
      {invitations.map((inv) => (
        <li
          key={inv.id}
          className="flex flex-col gap-3 rounded-2xl border border-accent/30 bg-accent-soft/60 p-4 sm:flex-row sm:items-center"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface text-accent">
            <IconMail size={17} />
          </span>
          <div className="min-w-0 flex-1 text-sm">
            <p>
              Te invitaron a <strong>{inv.workspace_name || "un espacio"}</strong> como {ROLE_LABELS[inv.role].toLowerCase()}.
            </p>
            <p className="text-xs text-muted">Vence el {new Date(inv.expires_at).toLocaleDateString("es-AR")}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => respond(inv.id, false)} disabled={pending}>
              Rechazar
            </Button>
            <Button size="sm" variant="primary" onClick={() => respond(inv.id, true)} disabled={pending}>
              Aceptar
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
