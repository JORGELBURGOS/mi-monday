import type { Automation, FlowBoard } from "@/lib/data";

export const COPY_FIELDS = ["description", "priority", "assignee", "due_date", "status"] as const;
export type CopyField = (typeof COPY_FIELDS)[number];

export const COPY_FIELD_LABELS: Record<CopyField, string> = {
  description: "Descripción",
  priority: "Prioridad",
  assignee: "Responsable",
  due_date: "Vencimiento",
  status: "Estado (si existe uno con el mismo nombre)",
};

export type TriggerType = "item_arrived" | "status_changed" | "group_changed";
export type ActionType = "move" | "copy" | "update_linked";

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  status_changed: "Un ítem cambia de estado",
  group_changed: "Un ítem entra a una carpeta",
  item_arrived: "Llega un ítem nuevo al tablero",
};

export const ACTION_LABELS: Record<"move" | "copy" | "origin" | "copies", string> = {
  copy: "Copiar el ítem a otro tablero",
  move: "Mover el ítem completo",
  origin: "Actualizar el ítem original",
  copies: "Actualizar las copias",
};

type BoardLookup = Pick<FlowBoard, "id" | "name" | "groups" | "statuses">;

/** Describe una regla en lenguaje natural: «Cuando …» y «entonces …». */
export function describeAutomation<B extends BoardLookup>(a: Automation, boards: B[]) {
  const source = boards.find((b) => b.id === a.board_id);
  const target = boards.find((b) => b.id === a.target_board_id);
  const statusName = (b: B | undefined, id: string | null) => b?.statuses.find((s) => s.id === id)?.label;
  const groupName = (b: B | undefined, id: string | null) => b?.groups.find((g) => g.id === id)?.name;

  let when: string;
  if (a.trigger_type === "status_changed") {
    const s = statusName(source, a.trigger_status_id);
    when = s ? `Cuando un ítem pasa a «${s}»` : "Cuando un ítem cambia de estado";
  } else if (a.trigger_type === "group_changed") {
    const g = groupName(source, a.trigger_group_id);
    when = g ? `Cuando un ítem entra a la carpeta «${g}»` : "Cuando un ítem cambia de carpeta";
  } else {
    const g = groupName(source, a.trigger_group_id);
    when = g ? `Cuando llega un ítem a la carpeta «${g}»` : "Cuando llega un ítem al tablero";
  }

  const targetName = target ? `«${target.name}»` : "un tablero sin acceso";
  const tGroup = groupName(target, a.target_group_id);
  const tStatus = statusName(target, a.target_status_id);
  let then: string;
  if (a.action_type === "update_linked") {
    const who = a.link_direction === "copies" ? "las copias" : "el original";
    const changes = [tStatus && `pasar a «${tStatus}»`, tGroup && `ir a la carpeta «${tGroup}»`].filter(Boolean).join(" e ");
    then = `${who} en ${targetName} ${changes ? `debe ${changes}` : "no cambia"}`;
  } else {
    const verb = a.action_type === "move" ? "mover el ítem completo" : "copiar el ítem";
    const place = a.target_board_id === a.board_id ? `a la carpeta «${tGroup ?? "primera carpeta"}»` : `a ${targetName} › ${tGroup ? `«${tGroup}»` : "primera carpeta"}`;
    then = `${verb} ${place}${tStatus ? ` con estado «${tStatus}»` : ""}`;
  }
  return { when, then, source, target };
}
