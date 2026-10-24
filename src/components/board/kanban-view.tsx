"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { asColor } from "@/lib/constants";
import { PeopleSummary } from "@/components/ui/people-picker";
import { useCellContext } from "./cell-context";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { IconDots, IconMove } from "@/components/ui/icons";
import type { PriorityLabel } from "@/lib/board-settings";
import { DueBadge } from "./task-fields";
import type { Member, Status, Task } from "./types";

/** Vista Kanban: una columna por estado; arrastrar una tarjeta cambia su estado. */
export function KanbanView({
  tasks,
  statuses,
  priorities,
  members,
  today,
  doneIds,
  readOnly,
  onOpenTask,
  onSetStatus,
}: {
  tasks: Task[];
  statuses: Status[];
  priorities: PriorityLabel[];
  members: Member[];
  today: string;
  doneIds: Set<string>;
  readOnly: boolean;
  onOpenTask: (t: Task) => void;
  onSetStatus: (t: Task, statusId: string | null) => void;
}) {
  const ctx = useCellContext();
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const lanes = [...statuses.map((s) => ({ id: s.id as string | null, label: s.label, color: asColor(s.color) })), { id: null, label: "Sin estado", color: "gray" as const }];
  const visibleLanes = lanes.filter((l) => l.id !== null || tasks.some((t) => !t.status_id));

  return (
    <div className="-mx-4 overflow-x-auto px-4 py-6 sm:-mx-8 sm:px-8">
      <div className="flex min-h-[calc(60vh/var(--ui-zoom,1))] gap-3">
        {visibleLanes.map((lane) => {
          const laneTasks = tasks.filter((t) => t.status_id === lane.id);
          const key = lane.id ?? "none";
          return (
            <section
              key={key}
              aria-label={`${lane.label}: ${laneTasks.length} elementos`}
              onDragOver={(e) => {
                if (readOnly || !dragId) return;
                e.preventDefault();
                setOver(key);
              }}
              onDragLeave={() => setOver((o) => (o === key ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                const t = tasks.find((x) => x.id === dragId);
                setDragId(null);
                setOver(null);
                if (t && t.status_id !== lane.id) onSetStatus(t, lane.id);
              }}
              className={cn("flex w-72 shrink-0 flex-col rounded-2xl bg-surface-2/70 transition-colors", over === key && "bg-accent-soft")}
            >
              <header className={cn(`solid-${lane.color}`, "flex items-center justify-between rounded-t-2xl px-3 py-2 text-sm font-bold")}>
                <span className="truncate">{lane.label}</span>
                <span className="rounded-full bg-black/15 px-2 text-xs">{laneTasks.length}</span>
              </header>
              <ul className="flex-1 space-y-2 p-2">
                {laneTasks.map((t) => {
                  const p = priorities.find((x) => x.value === t.priority)!;
                  const done = Boolean(t.status_id && doneIds.has(t.status_id));
                  const menu: MenuItem[] = [
                    { type: "label", label: "Mover a" },
                    ...lanes
                      .filter((l) => l.id !== t.status_id)
                      .map<MenuItem>((l) => ({ label: l.label, icon: <IconMove size={16} />, onSelect: () => onSetStatus(t, l.id) })),
                  ];
                  return (
                    <li
                      key={t.id}
                      draggable={!readOnly && !t.id.startsWith("tmp-")}
                      onDragStart={(e) => {
                        setDragId(t.id);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", t.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setOver(null);
                      }}
                      className={cn("rounded-xl border border-line bg-surface p-3 shadow-card", !readOnly && "cursor-grab", dragId === t.id && "opacity-50")}
                    >
                      <div className="flex items-start gap-1">
                        <button type="button" onClick={() => onOpenTask(t)} className={cn("min-w-0 flex-1 text-left text-sm font-semibold leading-snug hover:underline", done && "text-muted line-through")}>
                          {t.title}
                        </button>
                        {!readOnly && <Menu label={`Mover ${t.title}`} trigger={<IconDots size={16} />} items={menu} triggerClassName="h-6 w-6" />}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <span className={cn(`solid-${p.color}`, "rounded-full px-2 py-0.5 font-semibold")}>{p.label}</span>
                        <DueBadge value={t.due_date} today={today} done={done} />
                        {((t.assignee_ids?.length ?? 0) > 0 || (t.team_ids?.length ?? 0) > 0) && (
                          <span className="ml-auto flex min-w-0 items-center text-muted">
                            <PeopleSummary value={{ users: t.assignee_ids ?? [], teams: t.team_ids ?? [] }} people={members} teams={ctx?.teams ?? []} />
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
                {laneTasks.length === 0 && <li className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-subtle">Arrastrá elementos acá</li>}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
