/**
 * Lógica compartida de los formularios de Vetta: tipos, condiciones ("mostrar
 * si…"), validación y normalización de respuestas.
 *
 * IMPORTANTE: este archivo no importa nada. Se usa igual en el navegador (para
 * validar al instante) y en la función de servidor "vetta-formularios" (que
 * valida de nuevo, sin confiar en el navegador). Al cambiarlo, copiarlo a
 * supabase/functions/vetta-formularios/form-logic.ts (hay una prueba que
 * verifica que sean idénticos).
 */

export type InputType =
  | "short"
  | "long"
  | "number"
  | "date"
  | "daterange"
  | "email"
  | "phone"
  | "url"
  | "hour"
  | "choice"
  | "multi"
  | "checkbox"
  | "yesno"
  | "rating"
  | "files";

export const FREE_TYPES = ["short", "long", "number", "date", "email", "phone", "url", "choice", "multi", "yesno", "checkbox", "rating"] as const;
export type FreeType = (typeof FREE_TYPES)[number];

export type RuleOp = "is" | "is_not" | "filled" | "empty" | "contains" | "gt" | "lt";
export type Rule = { q: string; op: RuleOp; value?: string };

export type Question = {
  id: string;
  /** field = completa un dato del elemento; free = pregunta libre (va a la actualización); text = bloque de texto; page = salto de página. */
  kind: "field" | "free" | "text" | "page";
  /** Para kind "field": title, description, priority, assignee, due_date, status, group o col:<id de columna>. */
  target?: string;
  freeType?: FreeType;
  /** Opciones de una pregunta libre de selección. */
  options?: string[];
  label: string;
  help?: string;
  placeholder?: string;
  required?: boolean;
  /** Oculta: no se muestra; se completa con el valor por defecto o desde el enlace. */
  hidden?: boolean;
  defaultValue?: string;
  /** Opciones permitidas (ids) para etiquetas, estados, prioridades o personas. */
  allowed?: string[];
  /** Mínimo / máximo (número, largo del texto o cantidad de opciones). */
  min?: number;
  max?: number;
  /** Nombre del parámetro del enlace para precompletarla (?param=valor). */
  param?: string;
  showIf?: { mode: "all" | "any"; rules: Rule[] };
};

export type FormDesign = {
  accent: string;
  cover: string;
  logoUrl?: string;
  layout: "classic" | "steps" | "focus";
  submitLabel?: string;
  theme: "auto" | "light" | "dark";
};

export type FormConfig = {
  title: string;
  description?: string;
  questions: Question[];
  design: FormDesign;
  destination: { groupId?: string; statusId?: string; assigneeId?: string; priority?: string; titleTemplate?: string };
  after: { message?: string; redirectUrl?: string; allowAnother: boolean; tracking: boolean; showSummary: boolean };
  notify: string[];
};

export type Option = { value: string; label: string; color?: string };
/** Cómo se muestra y valida cada pregunta (lo arma el servidor según el tablero). */
export type InputSpec = { type: InputType; options?: Option[]; max?: number };

export type FileAnswer = { upload: string; name: string; size: number; type: string };
export type AnswerValue = string | number | boolean | string[] | FileAnswer[] | null;
export type Answers = Record<string, AnswerValue | undefined>;

export const MAX_FILES_PER_QUESTION = 10;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** Preguntas con valor (no los bloques de texto ni los saltos de página). */
export const isInput = (q: Question) => q.kind === "field" || q.kind === "free";

/** Evalúa "mostrar si…". Solo cuentan reglas sobre preguntas anteriores (evita ciclos). */
export function isVisible(q: Question, answers: Answers, questions: Question[]): boolean {
  if (q.hidden) return false;
  const rules = q.showIf?.rules ?? [];
  if (!rules.length) return true;
  const index = questions.findIndex((x) => x.id === q.id);
  const results = rules.map((r) => {
    const ref = questions.findIndex((x) => x.id === r.q);
    if (ref < 0 || ref >= index) return true;
    const refQ = questions[ref];
    const visible = isVisible(refQ, answers, questions);
    const v = visible ? answers[r.q] : undefined;
    return matchRule(r, v);
  });
  return q.showIf?.mode === "any" ? results.some(Boolean) : results.every(Boolean);
}

function matchRule(r: Rule, v: AnswerValue | undefined): boolean {
  const target = (r.value ?? "").trim().toLowerCase();
  const list = Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : (x as FileAnswer).name).toLowerCase()) : v === undefined || v === null ? [] : [String(v).toLowerCase()];
  switch (r.op) {
    case "filled":
      return !isEmpty(v) && v !== false;
    case "empty":
      return isEmpty(v) || v === false;
    case "is":
      return list.includes(target);
    case "is_not":
      return !list.includes(target);
    case "contains":
      return list.some((x) => x.includes(target));
    case "gt":
      return typeof v === "number" ? v > Number(r.value) : list.length > 0 && Number(list[0]) > Number(r.value);
    case "lt":
      return typeof v === "number" ? v < Number(r.value) : list.length > 0 && Number(list[0]) < Number(r.value);
  }
  return true;
}

/** Divide las preguntas en páginas según los saltos de página. */
export function pagesOf(questions: Question[]): Question[][] {
  const pages: Question[][] = [[]];
  for (const q of questions) {
    if (q.kind === "page") {
      if (pages[pages.length - 1].length) pages.push([]);
      continue;
    }
    pages[pages.length - 1].push(q);
  }
  return pages.filter((p, i) => p.length || i === 0);
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string) => DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export type Check = { ok: true; value: AnswerValue } | { ok: false; error: string };

/** Valida y normaliza una respuesta. `value` ausente/vacío se acepta si no es obligatoria. */
export function checkAnswer(q: Question, spec: InputSpec, raw: unknown): Check {
  const required = Boolean(q.required);
  if (isEmpty(raw) || (spec.type === "checkbox" && raw === false && required)) {
    if (required) return { ok: false, error: spec.type === "checkbox" ? "Tenés que marcar esta casilla." : "Esta pregunta es obligatoria." };
    return { ok: true, value: null };
  }
  const text = (max: number) => {
    if (typeof raw !== "string" && typeof raw !== "number") return null;
    const s = String(raw).trim();
    return s.length > max ? null : s;
  };
  switch (spec.type) {
    case "short":
    case "long": {
      const limit = spec.type === "short" ? 500 : 5000;
      const s = text(Math.min(limit, q.max ?? limit));
      if (s === null) return { ok: false, error: `Máximo ${Math.min(limit, q.max ?? limit)} caracteres.` };
      if (q.min && s.length < q.min) return { ok: false, error: `Mínimo ${q.min} caracteres.` };
      if (required && !s) return { ok: false, error: "Esta pregunta es obligatoria." };
      return { ok: true, value: s || null };
    }
    case "number": {
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
      if (!Number.isFinite(n)) return { ok: false, error: "Ingresá un número." };
      if (q.min !== undefined && n < q.min) return { ok: false, error: `El mínimo es ${q.min}.` };
      if (q.max !== undefined && n > q.max) return { ok: false, error: `El máximo es ${q.max}.` };
      return { ok: true, value: n };
    }
    case "date": {
      const s = String(raw).slice(0, 10);
      return validDate(s) ? { ok: true, value: s } : { ok: false, error: "Ingresá una fecha válida." };
    }
    case "daterange": {
      const [a, b] = String(raw).split("/");
      if (!a || !b || !validDate(a) || !validDate(b)) return { ok: false, error: "Ingresá las dos fechas." };
      if (b < a) return { ok: false, error: "La fecha de fin tiene que ser posterior al inicio." };
      return { ok: true, value: `${a}/${b}` };
    }
    case "email": {
      const s = text(254);
      return s && EMAIL_RE.test(s) ? { ok: true, value: s.toLowerCase() } : { ok: false, error: "Ingresá un email válido." };
    }
    case "phone": {
      const s = text(30);
      return s && /^[+()\d\s.-]{6,30}$/.test(s) && (s.match(/\d/g)?.length ?? 0) >= 6 ? { ok: true, value: s } : { ok: false, error: "Ingresá un teléfono válido." };
    }
    case "url": {
      const s = text(1000);
      if (!s) return { ok: false, error: "Ingresá un enlace." };
      const url = /^https?:\/\//i.test(s) ? s : `https://${s}`;
      try {
        const u = new URL(url);
        return u.hostname.includes(".") ? { ok: true, value: u.toString() } : { ok: false, error: "Ingresá un enlace válido." };
      } catch {
        return { ok: false, error: "Ingresá un enlace válido." };
      }
    }
    case "hour": {
      const s = text(5);
      return s && /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? { ok: true, value: s } : { ok: false, error: "Ingresá una hora (HH:MM)." };
    }
    case "choice": {
      const s = String(raw);
      return (spec.options ?? []).some((o) => o.value === s) ? { ok: true, value: s } : { ok: false, error: "Elegí una opción válida." };
    }
    case "multi": {
      const list = Array.isArray(raw) ? [...new Set(raw.map(String))] : [String(raw)];
      if (!list.every((v) => (spec.options ?? []).some((o) => o.value === v))) return { ok: false, error: "Alguna opción no es válida." };
      if (q.min && list.length < q.min) return { ok: false, error: `Elegí al menos ${q.min}.` };
      if (q.max && list.length > q.max) return { ok: false, error: `Elegí como máximo ${q.max}.` };
      return { ok: true, value: list };
    }
    case "checkbox":
    case "yesno":
      if (typeof raw === "boolean") return { ok: true, value: raw };
      if (raw === "true" || raw === "false") return { ok: true, value: raw === "true" };
      return { ok: false, error: "Respuesta inválida." };
    case "rating": {
      const n = Number(raw);
      const max = spec.max ?? 5;
      return Number.isInteger(n) && n >= 1 && n <= max ? { ok: true, value: n } : { ok: false, error: `Elegí de 1 a ${max}.` };
    }
    case "files": {
      if (!Array.isArray(raw)) return { ok: false, error: "Archivos inválidos." };
      const files = raw.filter((f): f is FileAnswer => Boolean(f && typeof f === "object" && typeof (f as FileAnswer).upload === "string"));
      if (files.length !== raw.length) return { ok: false, error: "Archivos inválidos." };
      if (files.length > MAX_FILES_PER_QUESTION) return { ok: false, error: `Hasta ${MAX_FILES_PER_QUESTION} archivos.` };
      return { ok: true, value: files.map((f) => ({ upload: f.upload, name: String(f.name).slice(0, 200), size: Number(f.size) || 0, type: String(f.type).slice(0, 100) })) };
    }
  }
  return { ok: false, error: "Tipo de pregunta desconocido." };
}

/** Valor de partida: por defecto, o desde el enlace (?param=valor). */
export function initialValue(q: Question, spec: InputSpec, params: Record<string, string>): AnswerValue | undefined {
  const fromLink = q.param ? params[q.param] : undefined;
  const raw = fromLink ?? q.defaultValue;
  if (raw === undefined || raw === "") return undefined;
  if (spec.type === "multi") return raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (spec.type === "number" || spec.type === "rating") return Number(raw);
  if (spec.type === "checkbox" || spec.type === "yesno") return raw === "true" || raw === "1" || raw.toLowerCase() === "si" || raw.toLowerCase() === "sí";
  if (spec.type === "choice" && spec.options) {
    // Por id o por texto de la opción.
    const byLabel = spec.options.find((o) => o.value === raw || o.label.toLowerCase() === raw.toLowerCase());
    return byLabel?.value;
  }
  return raw;
}

/** Valida todas las respuestas visibles. Devuelve los valores limpios o los errores por pregunta. */
export function checkAll(config: Pick<FormConfig, "questions">, specs: Record<string, InputSpec>, answers: Answers): { values: Record<string, AnswerValue>; errors: Record<string, string> } {
  const values: Record<string, AnswerValue> = {};
  const errors: Record<string, string> = {};
  for (const q of config.questions) {
    if (!isInput(q)) continue;
    const spec = specs[q.id];
    if (!spec) continue;
    // Las ocultas se aceptan (vienen del enlace o del valor por defecto); las que no se muestran por condición, no.
    if (!q.hidden && !isVisible(q, answers, config.questions)) continue;
    const res = checkAnswer(q.hidden ? { ...q, required: false } : q, spec, answers[q.id]);
    if (res.ok) {
      if (res.value !== null) values[q.id] = res.value;
    } else errors[q.id] = res.error;
  }
  return { values, errors };
}

/** Texto legible de una respuesta (para la actualización del elemento y el resumen). */
export function answerText(spec: InputSpec | undefined, v: AnswerValue | undefined): string {
  if (v === undefined || v === null || v === "") return "";
  const label = (x: string) => spec?.options?.find((o) => o.value === x)?.label ?? x;
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? label(x) : x.name)).join(", ");
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (spec?.type === "rating") return `${v}/${spec.max ?? 5}`;
  if (spec?.type === "date" && typeof v === "string") {
    const [y, m, d] = v.split("-");
    return `${d}/${m}/${y}`;
  }
  return label(String(v));
}
