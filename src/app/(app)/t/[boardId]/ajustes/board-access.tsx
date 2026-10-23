"use client";

import { useState, useTransition } from "react";
import { setBoardAccessAction, setBoardVisibilityAction } from "@/app/actions/members";
import { Avatar } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { ROLE_LABELS, VISIBILITY_LABELS } from "@/lib/constants";
import { displayName } from "@/lib/format";
import type { Member } from "@/lib/data";

export function BoardAccess({
  boardId,
  visibility: initialVisibility,
  createdBy,
  members,
  granted: initialGranted,
}: {
  boardId: string;
  visibility: "workspace" | "private";
  createdBy: string | null;
  members: Member[];
  granted: string[];
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [visibility, setVisibility] = useState(initialVisibility);
  const [granted, setGranted] = useState(initialGranted);

  const changeVisibility = (v: "workspace" | "private") =>
    startTransition(async () => {
      const prev = visibility;
      setVisibility(v);
      const res = await setBoardVisibilityAction(boardId, v);
      if (!res.ok) {
        setVisibility(prev);
        toast.error(res.error);
      } else if (res.message) toast.success(res.message);
    });

  const toggle = (userId: string, on: boolean) =>
    startTransition(async () => {
      setGranted((g) => (on ? [...g, userId] : g.filter((x) => x !== userId)));
      const res = await setBoardAccessAction(boardId, userId, on);
      if (!res.ok) {
        setGranted((g) => (on ? g.filter((x) => x !== userId) : [...g, userId]));
        toast.error(res.error);
      }
    });

  return (
    <div className="space-y-4">
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="sr-only">Quién ve este tablero</legend>
        {(["private", "workspace"] as const).map((v) => (
          <label
            key={v}
            className={cn(
              "flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 text-sm",
              visibility === v ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong",
            )}
          >
            <input
              type="radio"
              name="visibility"
              checked={visibility === v}
              disabled={pending}
              onChange={() => changeVisibility(v)}
              className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
            />
            <span>
              <span className="font-semibold">{VISIBILITY_LABELS[v]}</span>
              <span className="block text-xs text-muted">
                {v === "private" ? "Elegís una por una a las personas que pueden entrar." : "Todos los usuarios de la empresa lo ven."}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {visibility === "private" && (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {members.map((m) => {
            const name = displayName(m);
            const always = m.role === "owner" || m.role === "admin" || m.user_id === createdBy;
            const checked = always || granted.includes(m.user_id);
            return (
              <li key={m.user_id}>
                <label className={cn("flex items-center gap-3 px-3 py-2.5 text-sm", always ? "cursor-default" : "cursor-pointer")}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={always || pending}
                    onChange={(e) => toggle(m.user_id, e.target.checked)}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                  <Avatar name={name} size="sm" />
                  <span className="min-w-0 flex-1 truncate">
                    {name}
                    {m.deactivated_at && <span className="ml-2 text-xs text-danger">Desactivado</span>}
                  </span>
                  <span className="text-xs text-muted">
                    {m.role !== "member" ? ROLE_LABELS[m.role] : m.user_id === createdBy ? "Lo creó" : ""}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
