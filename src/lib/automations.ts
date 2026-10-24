import type { Automation, FlowBoard } from "@/lib/data";
import { PRIORITY_BY_VALUE, type Priority } from "@/lib/constants";

/* -------------------------------------------------------------------------- */
/*  Catálogo de reglas                                                         */
/* -------------------------------------------------------------------------- */

export const COPY_FIELDS = ["description", "priority", "assignee", "due_date", "status"] as const;
export type CopyField = (typeof COPY_FIELDS)[number];

export const COPY_FIELD_LABELS: Record<CopyField, string> = {
  description: "Descripción",
  priority: "Prioridad",
  assignee: "Responsable",
  due_date: "Vencimiento",
  status: "Estado (si existe uno con el mismo nombre)",
};

export const TRIGGER_TYPES = [
  "status_changed",
  "group_changed",
  "item_arrived",
  "assignee_changed",
  "priority_changed",
  "column_changed",
  "checklist_changed",
  "date_arrives",
  "stale",
  "schedule",
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const TRIGGER_GROUPS: { label: string; items: { value: TriggerType; label: string }[] }[] = [
  {
    label: "Cuando cambia algo",
    items: [
      { value: "status_changed", label: "Un ítem cambia de estado" },
      { value: "group_changed", label: "Un ítem entra a una carpeta" },
      { value: "item_arrived", label: "Llega un ítem nuevo al tablero" },
      { value: "assignee_changed", label: "Se asigna un responsable" },
      { value: "priority_changed", label: "Cambia la prioridad" },
      { value: "column_changed", label: "Cambia el valor de una columna" },
      { value: "checklist_changed", label: "Se tilda un paso del checklist" },
    ],
  },
  {
    label: "Por fechas y tiempos",
    items: [
      { value: "date_arrives", label: "Se acerca, llega o pasa una fecha" },
      { value: "stale", label: "Un ítem lleva días sin avanzar" },
    ],
  },
  {
    label: "Programadas",
    items: [{ value: "schedule", label: "Todos los días, semanas o meses" }],
  },
];

export const TIME_TRIGGERS: TriggerType[] = ["date_arrives", "stale", "schedule"];

export const ACTION_TYPES = [
  "copy",
  "move",
  "update_linked",
  "create_item",
  "set_status",
  "set_group",
  "set_priority",
  "set_assignee",
  "set_due_date",
  "set_column",
  "add_comment",
  "add_checklist",
  "notify",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** En el editor, "actualizar vinculados" se separa en original y copias. */
export type ActionMode = Exclude<ActionType, "update_linked"> | "origin" | "copies";

export const ACTION_GROUPS: { label: string; items: { value: ActionMode; label: string; help: string }[] }[] = [
  {
    label: "En el mismo ítem",
    items: [
      { value: "set_status", label: "Cambiar el estado", help: "Pasa el ítem a otro estado." },
      { value: "set_group", label: "Mover a otra carpeta", help: "Lo ubica en otra carpeta de este tablero." },
      { value: "set_priority", label: "Cambiar la prioridad", help: "Por ejemplo, subirla a Urgente." },
      { value: "set_assignee", label: "Asignar un responsable", help: "A una persona, a quien lo creó, o quitarlo." },
      { value: "set_due_date", label: "Poner un vencimiento", help: "Hoy más los días que elijas, o quitarlo." },
      { value: "set_column", label: "Completar una columna", help: "Con un valor fijo o una fecha relativa." },
      { value: "add_checklist", label: "Agregar pasos al checklist", help: "Suma los pasos de una plantilla debajo de lo que ya hay. Ideal al entrar a la carpeta de cada equipo." },
      { value: "add_comment", label: "Dejar un comentario", help: "Queda en el ítem firmado por Vetta." },
    ],
  },
  {
    label: "Avisar",
    items: [{ value: "notify", label: "Enviar un aviso", help: "Aparece en la campana de Vetta. No se envían emails." }],
  },
  {
    label: "En la cadena de valor",
    items: [
      { value: "copy", label: "Copiar a otro tablero", help: "Crea una copia vinculada. El original sigue acá." },
      { value: "move", label: "Mover a otro tablero", help: "El ítem sale de este tablero y continúa en otro." },
      { value: "create_item", label: "Crear un ítem nuevo", help: "En este u otro tablero, con el título que quieras." },
      { value: "origin", label: "Actualizar el ítem original", help: "Cambia estado o carpeta del ítem del que vino esta copia." },
      { value: "copies", label: "Actualizar las copias", help: "Cambia estado o carpeta de las copias que salieron de acá." },
    ],
  },
];

export const ACTION_LABELS: Record<ActionMode, string> = Object.fromEntries(
  ACTION_GROUPS.flatMap((g) => g.items.map((i) => [i.value, i.label])),
) as Record<ActionMode, string>;

/** Acciones que se aplican sobre el mismo tablero de la regla. */
export const SAME_BOARD_ACTIONS: ActionType[] = [
  "set_status",
  "set_group",
  "set_priority",
  "set_assignee",
  "set_due_date",
  "set_column",
  "notify",
  "add_comment",
  "add_checklist",
];

/** Acciones que cambian un campo del propio ítem y por eso se pueden deshacer. */
export const REVERTIBLE_ACTIONS: ActionType[] = ["set_status", "set_group", "set_priority", "set_assignee", "set_due_date", "set_column"];

/**
 * Si la regla admite "deshacer al revertirse", describe cuándo se deshace
 * (por ejemplo "si se destildan todos los pasos"). null = no se puede.
 */
export function revertWhen(r: {
  trigger_type: string;
  trigger_status_id?: string | null;
  trigger_group_id?: string | null;
  tc: TriggerConfig;
  action_type: string;
}): string | null {
  if (!(REVERTIBLE_ACTIONS as string[]).includes(r.action_type)) return null;
  const tc = r.tc;
  switch (r.trigger_type) {
    case "checklist_changed":
      switch (tc.event) {
        case "step_checked":
          return "si se destilda ese paso";
        case "completed":
          return "si el checklist deja de estar completo";
        case "percent":
          return `si el avance baja del ${tc.percent ?? 50}%`;
        default:
          return "si se destildan todos los pasos";
      }
    case "status_changed":
      return r.trigger_status_id ? "si el ítem sale de ese estado" : null;
    case "group_changed":
      return r.trigger_group_id ? "si el ítem sale de esa carpeta" : null;
    case "assignee_changed":
      return tc.user_id ? "si deja de estar asignado a esa persona" : null;
    case "priority_changed":
      return tc.priority ? "si la prioridad cambia a otra" : null;
    case "column_changed":
      return tc.value ? "si la columna deja de tener ese valor" : null;
    default:
      return null;
  }
}

export type TriggerConfig = {
  from_status_id?: string;
  user_id?: string;
  priority?: Priority;
  column_id?: string;
  value?: string;
  date_field?: string;
  offset_days?: number;
  hour?: number;
  days?: number;
  status_id?: string;
  freq?: "daily" | "weekdays" | "weekly" | "monthly";
  weekday?: number;
  monthday?: number;
  /** Checklist: qué tiene que pasar. */
  event?: ChecklistEvent;
  step?: string;
  step_index?: number;
  percent?: number;
};

export const CHECKLIST_EVENTS = ["started", "any_checked", "step_checked", "percent", "completed"] as const;
export type ChecklistEvent = (typeof CHECKLIST_EVENTS)[number];
export const CHECKLIST_EVENT_LABELS: Record<ChecklistEvent, string> = {
  started: "Se tilda el primer paso (arranca el checklist)",
  any_checked: "Se tilda cualquier paso",
  step_checked: "Se tilda un paso puntual",
  percent: "El avance llega a un porcentaje",
  completed: "Se completan todos los pasos",
};

export type ActionConfig = {
  status_id?: string;
  group_id?: string;
  priority?: Priority;
  mode?: "user" | "creator" | "clear" | "offset" | "value" | "team";
  user_id?: string;
  days?: number;
  column_id?: string;
  value?: string | number | boolean | string[];
  to?: "assignee" | "creator" | "user" | "admins" | "team";
  team_id?: string;
  team_name?: string;
  message?: string;
  text?: string;
  title?: string;
  due_days?: number;
  assignee_id?: string;
  /** add_checklist: plantilla, su nombre (para mostrar), sección y a quién asignar los pasos. */
  template_id?: string;
  template_name?: string;
  section?: string;
  assign?: "user" | "assignee";
};

export const CONDITION_FIELDS = ["status", "group", "priority", "assignee", "done", "due_date", "column"] as const;
export type ConditionField = (typeof CONDITION_FIELDS)[number];
export const CONDITION_OPS = ["is", "is_not", "empty", "not_empty", "overdue", "within_days", "contains", "gt", "lt"] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];
export type Condition = { field: ConditionField; op: ConditionOp; value?: string; column_id?: string };

export const WEEKDAYS = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

export const PLACEHOLDERS_HELP = "Podés usar {titulo}, {tablero}, {carpeta}, {estado}, {vencimiento}, {responsable} y {hoy}.";

/* -------------------------------------------------------------------------- */
/*  Lectura segura de la configuración guardada                                */
/* -------------------------------------------------------------------------- */

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function readTriggerConfig(a: Pick<Automation, "trigger_config">): TriggerConfig {
  return asObject(a.trigger_config) as TriggerConfig;
}

export function readActionConfig(a: Pick<Automation, "action_config">): ActionConfig {
  return asObject(a.action_config) as ActionConfig;
}

export function readConditions(a: Pick<Automation, "conditions">): Condition[] {
  return Array.isArray(a.conditions)
    ? (a.conditions.filter((c) => c && typeof c === "object" && !Array.isArray(c)) as unknown as Condition[])
    : [];
}

export function actionModeOf(a: Pick<Automation, "action_type" | "link_direction">): ActionMode {
  if (a.action_type === "update_linked") return a.link_direction === "copies" ? "copies" : "origin";
  return a.action_type as ActionMode;
}

/* -------------------------------------------------------------------------- */
/*  Descripción en lenguaje natural                                            */
/* -------------------------------------------------------------------------- */

type BoardLookup = Pick<FlowBoard, "id" | "name" | "groups" | "statuses" | "columns"> & { checklists?: { id: string; name: string }[] };
type PersonLookup = { user_id: string; full_name: string | null; email: string | null };

function days(n: number) {
  return `${n} ${Math.abs(n) === 1 ? "día" : "días"}`;
}

function hourText(h: number | undefined) {
  return `${String(h ?? 8).padStart(2, "0")}:00`;
}

/** Describe una regla en lenguaje natural: «Cuando …» y «entonces …». */
export function describeAutomation<B extends BoardLookup>(a: Automation, boards: B[], people: PersonLookup[] = []) {
  const source = boards.find((b) => b.id === a.board_id);
  const target = boards.find((b) => b.id === a.target_board_id);
  const tc = readTriggerConfig(a);
  const ac = readActionConfig(a);
  const statusName = (b: B | undefined, id: string | null | undefined) => b?.statuses.find((s) => s.id === id)?.label;
  const groupName = (b: B | undefined, id: string | null | undefined) => b?.groups.find((g) => g.id === id)?.name;
  const columnName = (b: B | undefined, id: string | null | undefined) => b?.columns.find((c) => c.id === id)?.name;
  const personName = (id: string | undefined) => {
    const p = people.find((x) => x.user_id === id);
    return p ? p.full_name?.trim() || p.email || "una persona" : "una persona";
  };

  let when: string;
  switch (a.trigger_type as TriggerType) {
    case "status_changed": {
      const s = statusName(source, a.trigger_status_id);
      const from = statusName(source, tc.from_status_id);
      when = s ? `Cuando un ítem pasa ${from ? `de «${from}» ` : ""}a «${s}»` : from ? `Cuando un ítem sale de «${from}»` : "Cuando un ítem cambia de estado";
      break;
    }
    case "group_changed": {
      const g = groupName(source, a.trigger_group_id);
      when = g ? `Cuando un ítem entra a la carpeta «${g}»` : "Cuando un ítem cambia de carpeta";
      break;
    }
    case "item_arrived": {
      const g = groupName(source, a.trigger_group_id);
      when = g ? `Cuando llega un ítem a la carpeta «${g}»` : "Cuando llega un ítem al tablero";
      break;
    }
    case "assignee_changed":
      when = tc.user_id ? `Cuando se asigna un ítem a ${personName(tc.user_id)}` : "Cuando se asigna un responsable";
      break;
    case "priority_changed":
      when = tc.priority ? `Cuando la prioridad pasa a ${PRIORITY_BY_VALUE[tc.priority]?.label ?? tc.priority}` : "Cuando cambia la prioridad";
      break;
    case "column_changed": {
      const col = source?.columns.find((c) => c.id === tc.column_id);
      const val = col?.kind === "list" ? col.options.find((o) => o.id === tc.value)?.label : tc.value;
      when = `Cuando cambia «${col?.name ?? "una columna"}»${val ? ` a «${val === "true" ? "Sí" : val}»` : ""}`;
      break;
    }
    case "checklist_changed": {
      const col = tc.column_id ? source?.checklists?.find((c) => c.id === tc.column_id)?.name : null;
      const where = col ? `«${col}»` : "un checklist";
      when =
        tc.event === "started"
          ? `Cuando se tilda el primer paso de ${where}`
          : tc.event === "completed"
            ? `Cuando se completa ${where}`
            : tc.event === "percent"
              ? `Cuando ${where} llega al ${tc.percent ?? 50}%`
              : tc.event === "step_checked"
                ? `Cuando se tilda ${tc.step ? `el paso «${tc.step}»` : `el paso ${tc.step_index ?? 1}`} de ${where}`
                : `Cuando se tilda un paso de ${where}`;
      break;
    }
    case "date_arrives": {
      const field = !tc.date_field || tc.date_field === "due_date" ? "del vencimiento" : `de «${columnName(source, tc.date_field) ?? "una fecha"}»`;
      const off = tc.offset_days ?? 0;
      when = off === 0 ? `El día ${field}` : off < 0 ? `${days(-off)} antes ${field}` : `${days(off)} después ${field}`;
      when += ` (desde las ${hourText(tc.hour)})`;
      break;
    }
    case "stale": {
      const s = statusName(source, tc.status_id);
      when = `Cuando un ítem lleva ${days(tc.days ?? 3)} sin cambiar de estado${s ? ` en «${s}»` : ""}`;
      break;
    }
    case "schedule": {
      const at = ` a las ${hourText(tc.hour)}`;
      when =
        tc.freq === "weekly"
          ? `Todos los ${WEEKDAYS[tc.weekday ?? 1]}${at}`
          : tc.freq === "monthly"
            ? `El día ${tc.monthday ?? 1} de cada mes${at}`
            : tc.freq === "weekdays"
              ? `De lunes a viernes${at}`
              : `Todos los días${at}`;
      if (a.action_type !== "create_item") when += ", para cada ítem";
      break;
    }
    default:
      when = "Cuando se cumple el disparador";
  }

  const targetName = target ? `«${target.name}»` : "un tablero sin acceso";
  const tGroup = groupName(target, a.target_group_id);
  const tStatus = statusName(target, a.target_status_id);
  let then: string;
  switch (actionModeOf(a)) {
    case "copy":
    case "move": {
      const verb = a.action_type === "move" ? "mover el ítem completo" : "copiar el ítem";
      const place =
        a.target_board_id === a.board_id
          ? `a la carpeta «${tGroup ?? "primera carpeta"}»`
          : `a ${targetName} › ${tGroup ? `«${tGroup}»` : "primera carpeta"}`;
      then = `${verb} ${place}${tStatus ? ` con estado «${tStatus}»` : ""}`;
      break;
    }
    case "origin":
    case "copies": {
      const who = a.link_direction === "copies" ? "las copias" : "el original";
      const changes = [tStatus && `pasar a «${tStatus}»`, tGroup && `ir a la carpeta «${tGroup}»`].filter(Boolean).join(" e ");
      then = `${who} en ${targetName} ${changes ? `debe ${changes}` : "no cambia"}`;
      break;
    }
    case "create_item":
      then = `crear «${ac.title || "Nuevo ítem"}» en ${a.target_board_id === a.board_id ? "este tablero" : targetName}${
        groupName(target, ac.group_id) ? ` › «${groupName(target, ac.group_id)}»` : ""
      }`;
      break;
    case "set_status":
      then = `pasarlo a «${statusName(source, ac.status_id) ?? "otro estado"}»`;
      break;
    case "set_group":
      then = `moverlo a la carpeta «${groupName(source, ac.group_id) ?? "otra carpeta"}»`;
      break;
    case "set_priority":
      then = `poner prioridad ${ac.priority ? PRIORITY_BY_VALUE[ac.priority]?.label : ""}`.trim();
      break;
    case "set_assignee":
      then =
        ac.mode === "clear"
          ? "quitar el responsable"
          : ac.mode === "creator"
            ? "asignarlo a quien lo creó"
            : ac.mode === "team"
              ? `pasarlo al equipo «${ac.team_name ?? "elegido"}»`
              : `asignarlo a ${personName(ac.user_id)}`;
      break;
    case "set_due_date":
      then = ac.mode === "clear" ? "quitar el vencimiento" : ac.days ? `vencimiento en ${days(ac.days)}` : "vencimiento hoy";
      break;
    case "set_column": {
      const col = source?.columns.find((c) => c.id === ac.column_id);
      const val =
        ac.mode === "clear"
          ? "vacía"
          : col?.kind === "date" && ac.days !== undefined
            ? `hoy + ${days(ac.days)}`
            : col?.kind === "list"
              ? col.options.find((o) => o.id === ac.value)?.label
              : col?.kind === "checkbox"
                ? ac.value
                  ? "Sí"
                  : "No"
                : String(ac.value ?? "");
      then = `completar «${col?.name ?? "una columna"}» con ${val ? `«${val}»` : "un valor"}`;
      break;
    }
    case "add_checklist": {
      const col = source?.checklists?.find((c) => c.id === ac.column_id)?.name ?? columnName(source, ac.column_id);
      const sec = (ac.section ?? "").trim();
      then = `sumar los pasos de «${ac.template_name ?? "una plantilla"}» al checklist${col ? ` «${col}»` : ""}${sec ? ` en la sección «${sec === "{carpeta}" ? "nombre de la carpeta" : sec}»` : ""}${ac.assign === "assignee" ? ", asignados al responsable" : ac.assign === "user" ? `, asignados a ${personName(ac.user_id)}` : ""}`;
      break;
    }
    case "add_comment":
      then = `comentar «${(ac.text ?? "").slice(0, 60)}${(ac.text ?? "").length > 60 ? "…" : ""}»`;
      break;
    case "notify": {
      const to =
        ac.to === "creator"
          ? "a quien lo creó"
          : ac.to === "user"
            ? `a ${personName(ac.user_id)}`
            : ac.to === "admins"
              ? "a los administradores"
              : ac.to === "team"
                ? `al equipo «${ac.team_name ?? "elegido"}»`
                : "a los responsables";
      then = `avisar ${to}`;
      break;
    }
    default:
      then = "ejecutar la acción";
  }
  return { when, then, source, target };
}
