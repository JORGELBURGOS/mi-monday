export function displayName(p: { full_name: string | null; email: string | null }) {
  return p.full_name?.trim() || p.email || "Usuario";
}

export function initials(name: string) {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? "");
  return letters.toUpperCase() || "?";
}

const dateFmt = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "UTC" });
const dateFmtYear = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** Formatea una fecha "YYYY-MM-DD" sin desplazamientos por zona horaria. */
export function formatDueDate(value: string, todayIso: string) {
  const d = new Date(`${value}T00:00:00Z`);
  return value.slice(0, 4) === todayIso.slice(0, 4) ? dateFmt.format(d) : dateFmtYear.format(d);
}

export function formatDateTime(value: string) {
  return dateTimeFmt.format(new Date(value));
}

export function formatDate(value: string) {
  return dateFmtYear.format(new Date(value));
}

/** Fecha local de hoy en formato YYYY-MM-DD. */
export function todayIsoLocal() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export type DueState = "overdue" | "today" | "soon" | "later" | "none";

export function dueState(due: string | null, todayIso: string, done: boolean): DueState {
  if (!due) return "none";
  if (done) return "later";
  if (due < todayIso) return "overdue";
  if (due === todayIso) return "today";
  const diff = (Date.parse(`${due}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)) / 86_400_000;
  return diff <= 3 ? "soon" : "later";
}

export function relativeTime(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `hace ${d} ${d === 1 ? "día" : "días"}`;
  return formatDate(value);
}
