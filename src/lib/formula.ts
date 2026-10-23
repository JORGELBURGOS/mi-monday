/*
 * Motor de fórmulas (estilo Monday / Excel), sin eval: tokenizador, parser
 * recursivo y evaluador. Las columnas se referencian por nombre entre llaves:
 *   {Precio} * {Cantidad}
 *   IF({Estado} = "Listo", "✔", "Pendiente")
 *   DAYS({Cronograma#Fin}, {Cronograma#Inicio})
 * Fechas: texto "AAAA-MM-DD" (o "AAAA-MM-DD HH:MM").
 */

export type FValue = number | string | boolean | null;

export class FormulaError extends Error {
  constructor(
    message: string,
    public pos?: number,
  ) {
    super(message);
  }
}

/* --------------------------------------------------------------- tokens */

type Tok =
  | { t: "num"; v: number; p: number }
  | { t: "str"; v: string; p: number }
  | { t: "ref"; v: string; p: number }
  | { t: "id"; v: string; p: number }
  | { t: "op"; v: string; p: number }
  | { t: "("; p: number }
  | { t: ")"; p: number }
  | { t: ","; p: number }
  | { t: "end"; p: number };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
      if (m) {
        out.push({ t: "num", v: Number(m[0]), p: i });
        i += m[0].length;
        continue;
      }
    }
    if (c === '"' || c === "“" || c === "”") {
      let j = i + 1;
      let s = "";
      while (j < src.length) {
        const ch = src[j];
        if (ch === '"' || ch === "”" || ch === "“") {
          if (src[j + 1] === '"') {
            s += '"';
            j += 2;
            continue;
          }
          break;
        }
        s += ch;
        j++;
      }
      if (j >= src.length) throw new FormulaError("Falta cerrar las comillas.", i);
      out.push({ t: "str", v: s, p: i });
      i = j + 1;
      continue;
    }
    if (c === "{") {
      const j = src.indexOf("}", i);
      if (j < 0) throw new FormulaError("Falta cerrar la llave } de una columna.", i);
      const name = src.slice(i + 1, j).trim();
      if (!name) throw new FormulaError("Hay una referencia vacía {}.", i);
      out.push({ t: "ref", v: name, p: i });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_ÁÉÍÓÚÑáéíóúñ]/.test(c)) {
      const m = /^[A-Za-z_ÁÉÍÓÚÑáéíóúñ][A-Za-z0-9_ÁÉÍÓÚÑáéíóúñ]*/.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0].toUpperCase(), p: i });
      i += m[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["<=", ">=", "<>", "!=", "=="].includes(two)) {
      out.push({ t: "op", v: two === "!=" ? "<>" : two === "==" ? "=" : two, p: i });
      i += 2;
      continue;
    }
    if ("+-*/^&=<>%".includes(c)) {
      out.push({ t: "op", v: c, p: i });
      i++;
      continue;
    }
    if (c === "(" || c === ")" || c === ",") {
      out.push({ t: c, p: i } as Tok);
      i++;
      continue;
    }
    if (c === ";") {
      // Separador de argumentos al estilo Excel en español.
      out.push({ t: ",", p: i });
      i++;
      continue;
    }
    throw new FormulaError(`Carácter no válido: “${c}”.`, i);
  }
  out.push({ t: "end", p: src.length });
  return out;
}

/* ------------------------------------------------------------------ AST */

export type Node =
  | { k: "lit"; v: FValue }
  | { k: "ref"; name: string; p: number }
  | { k: "call"; name: string; args: Node[]; p: number }
  | { k: "un"; op: string; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node; p: number };

const PREC: Record<string, number> = { "=": 1, "<>": 1, "<": 1, ">": 1, "<=": 1, ">=": 1, "&": 2, "+": 3, "-": 3, "*": 4, "/": 4, "^": 5 };

export function parseFormula(src: string): Node {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];

  function primary(): Node {
    const tk = next();
    switch (tk.t) {
      case "num":
        return postfix({ k: "lit", v: tk.v });
      case "str":
        return { k: "lit", v: tk.v };
      case "ref":
        return postfix({ k: "ref", name: tk.v, p: tk.p });
      case "id": {
        if (tk.v === "TRUE" || tk.v === "VERDADERO") return { k: "lit", v: true };
        if (tk.v === "FALSE" || tk.v === "FALSO") return { k: "lit", v: false };
        if (peek().t !== "(") throw new FormulaError(`“${tk.v}” no es una función. Para usar una columna escribila entre llaves: {${tk.v}}.`, tk.p);
        next();
        const args: Node[] = [];
        if (peek().t !== ")") {
          for (;;) {
            args.push(expr(0));
            if (peek().t === ",") {
              next();
              continue;
            }
            break;
          }
        }
        const close = next();
        if (close.t !== ")") throw new FormulaError(`Falta cerrar el paréntesis de ${tk.v}.`, close.p);
        if (!(tk.v in FUNCTIONS)) throw new FormulaError(`La función ${tk.v} no existe.`, tk.p);
        return postfix({ k: "call", name: tk.v, args, p: tk.p });
      }
      case "(": {
        const e = expr(0);
        const close = next();
        if (close.t !== ")") throw new FormulaError("Falta cerrar un paréntesis.", close.p);
        return postfix(e);
      }
      case "op":
        if (tk.v === "-" || tk.v === "+") return { k: "un", op: tk.v, a: primaryWithPower() };
        throw new FormulaError(`Operador “${tk.v}” fuera de lugar.`, tk.p);
      case "end":
        throw new FormulaError("La fórmula está incompleta.", tk.p);
      default:
        throw new FormulaError("Hay un símbolo fuera de lugar.", tk.p);
    }
  }
  // 50% → 0.5
  function postfix(n: Node): Node {
    const tk = peek();
    if (tk.t === "op" && tk.v === "%") {
      next();
      return { k: "bin", op: "/", a: n, b: { k: "lit", v: 100 }, p: tk.p };
    }
    return n;
  }
  function primaryWithPower(): Node {
    const base = primary();
    const tk = peek();
    if (tk.t === "op" && tk.v === "^") {
      next();
      return { k: "bin", op: "^", a: base, b: primaryWithPower(), p: tk.p };
    }
    return base;
  }
  function expr(min: number): Node {
    let left = primaryWithPower();
    for (;;) {
      const tk = peek();
      if (tk.t !== "op" || !(tk.v in PREC) || tk.v === "^") break;
      const prec = PREC[tk.v];
      if (prec < min) break;
      next();
      const right = expr(prec + 1);
      left = { k: "bin", op: tk.v, a: left, b: right, p: tk.p };
    }
    return left;
  }

  if (!src.trim()) throw new FormulaError("Escribí una fórmula.", 0);
  const tree = expr(0);
  const rest = peek();
  if (rest.t !== "end") throw new FormulaError("Sobra algo al final de la fórmula (¿falta un operador o una coma?).", rest.p);
  return tree;
}

/** Nombres de columnas usados en una fórmula. */
export function formulaRefs(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(/\{([^}]+)\}/g)) out.add(m[1].trim());
  return [...out];
}

/* ------------------------------------------------------------ coerción */

function num(v: FValue): number {
  if (v === null || v === "") return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  if (Number.isFinite(n)) return n;
  const d = toDate(v);
  if (d) return d.getTime() / 86400000;
  throw new FormulaError(`“${v}” no es un número.`);
}
function str(v: FValue): string {
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10);
  return v;
}
function bool(v: FValue): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (v === null) return false;
  const s = v.trim().toLowerCase();
  return !(s === "" || s === "false" || s === "falso" || s === "0" || s === "no");
}

/** Fecha en UTC desde "AAAA-MM-DD[ HH:MM[:SS]]" o ISO. */
function toDate(v: FValue): Date | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(v.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)));
  return Number.isNaN(d.getTime()) ? null : d;
}
/** Una fecha vacía deja vacío el resultado (como en Monday), no es un error. */
class EmptyResult extends Error {}

function date(v: FValue, fn: string): Date {
  if (v === null || v === "") throw new EmptyResult();
  const d = toDate(v);
  if (!d) throw new FormulaError(`${fn} necesita una fecha (AAAA-MM-DD).`);
  return d;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const pad = (n: number) => String(n).padStart(2, "0");

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function formatDate(d: Date, fmt: string): string {
  // Texto entre corchetes se copia tal cual: "D [de] MMMM".
  return fmt
    .split(/(\[[^\]]*\])/)
    .map((part) => (part.startsWith("[") && part.endsWith("]") ? part.slice(1, -1) : formatDateTokens(d, part)))
    .join("");
}

function formatDateTokens(d: Date, fmt: string): string {
  return fmt.replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|mm|ss|AAAA|AA/g, (tok) => {
    switch (tok) {
      case "YYYY":
      case "AAAA":
        return String(d.getUTCFullYear());
      case "YY":
      case "AA":
        return String(d.getUTCFullYear()).slice(2);
      case "MMMM":
        return MONTHS[d.getUTCMonth()];
      case "MMM":
        return MONTHS[d.getUTCMonth()].slice(0, 3);
      case "MM":
        return pad(d.getUTCMonth() + 1);
      case "M":
        return String(d.getUTCMonth() + 1);
      case "DD":
        return pad(d.getUTCDate());
      case "D":
        return String(d.getUTCDate());
      case "dddd":
        return DAYS[d.getUTCDay()];
      case "ddd":
        return DAYS[d.getUTCDay()].slice(0, 3);
      case "HH":
        return pad(d.getUTCHours());
      case "H":
        return String(d.getUTCHours());
      case "mm":
        return pad(d.getUTCMinutes());
      case "ss":
        return pad(d.getUTCSeconds());
      default:
        return tok;
    }
  });
}

/** TEXT(1234.5, "$#,##0.00") → "$1.234,50" (separadores de Argentina). */
function formatNumberPattern(n: number, fmt: string): string {
  const m = /[#0][#0,.]*/.exec(fmt);
  if (!m) return fmt;
  const pattern = m[0];
  const percent = fmt.includes("%");
  const value = percent ? n * 100 : n;
  const dot = pattern.indexOf(".");
  const decimals = dot >= 0 ? pattern.length - dot - 1 : 0;
  const grouping = pattern.includes(",");
  const text = value.toLocaleString("es-AR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouping });
  return fmt.slice(0, m.index) + text + fmt.slice(m.index + pattern.length);
}

function weekNum(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const firstDow = new Date(start).getUTCDay();
  return Math.floor(((d.getTime() - start) / 86400000 + firstDow) / 7) + 1;
}
function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - yearStart) / 86400000 + 1) / 7);
}
function workdays(a: Date, b: Date): number {
  const [s, e, sign] = a <= b ? [a, b, 1] : [b, a, -1];
  let count = 0;
  for (let t = s.getTime(); t <= e.getTime(); t += 86400000) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
    if (count > 100000) break;
  }
  return count * sign;
}
function hoursOf(v: FValue): number {
  const m = /^(-?\d{1,4}):(\d{2})/.exec(str(v).trim().split(" ").pop() ?? "");
  if (!m) throw new FormulaError("Se esperaba una hora (HH:MM).");
  return Number(m[1]) + Math.sign(Number(m[1]) || 1) * (Number(m[2]) / 60);
}

/* ------------------------------------------------------------ funciones */

type Fn = { args: [number, number]; run: (a: FValue[], ctx: EvalContext) => FValue; help: string; example: string; group: string };

const flatNums = (a: FValue[]) => a.filter((v) => v !== null && v !== "").map(num);

export const FUNCTIONS: Record<string, Fn> = {
  // Números
  SUM: { group: "Números", args: [1, 255], run: (a) => flatNums(a).reduce((x, y) => x + y, 0), help: "Suma los valores.", example: "SUM({Precio}, {Envío})" },
  AVERAGE: { group: "Números", args: [1, 255], run: (a) => { const n = flatNums(a); return n.length ? n.reduce((x, y) => x + y, 0) / n.length : 0; }, help: "Promedio de los valores.", example: "AVERAGE({Nota 1}, {Nota 2})" },
  COUNT: { group: "Números", args: [1, 255], run: (a) => a.filter((v) => v !== null && v !== "" && Number.isFinite(Number(v))).length, help: "Cuenta los valores numéricos.", example: "COUNT({A}, {B}, {C})" },
  MIN: { group: "Números", args: [1, 255], run: (a) => { const n = flatNums(a); return n.length ? Math.min(...n) : 0; }, help: "El menor valor.", example: "MIN({Oferta 1}, {Oferta 2})" },
  MAX: { group: "Números", args: [1, 255], run: (a) => { const n = flatNums(a); return n.length ? Math.max(...n) : 0; }, help: "El mayor valor.", example: "MAX({Stock}, 0)" },
  MINUS: { group: "Números", args: [2, 2], run: (a) => num(a[0]) - num(a[1]), help: "Resta el segundo al primero.", example: "MINUS({Total}, {Pagado})" },
  MULTIPLY: { group: "Números", args: [2, 255], run: (a) => flatNums(a).reduce((x, y) => x * y, 1), help: "Multiplica los valores.", example: "MULTIPLY({Precio}, {Cantidad})" },
  DIVIDE: { group: "Números", args: [2, 2], run: (a) => { const d = num(a[1]); if (d === 0) throw new FormulaError("División por cero."); return num(a[0]) / d; }, help: "Divide el primero por el segundo.", example: "DIVIDE({Total}, {Cuotas})" },
  MOD: { group: "Números", args: [2, 2], run: (a) => { const d = num(a[1]); if (d === 0) throw new FormulaError("División por cero."); const n = num(a[0]); return n - d * Math.floor(n / d); }, help: "Resto de la división.", example: "MOD({Número}, 2)" },
  ROUND: { group: "Números", args: [1, 2], run: (a) => { const f = 10 ** num(a[1] ?? 0); return Math.round(num(a[0]) * f) / f; }, help: "Redondea a N decimales.", example: "ROUND({Precio} * 1.21, 2)" },
  ROUNDUP: { group: "Números", args: [1, 2], run: (a) => { const f = 10 ** num(a[1] ?? 0); const n = num(a[0]); return (Math.sign(n) * Math.ceil(Math.abs(n) * f)) / f; }, help: "Redondea hacia arriba.", example: "ROUNDUP({Horas}, 0)" },
  ROUNDDOWN: { group: "Números", args: [1, 2], run: (a) => { const f = 10 ** num(a[1] ?? 0); const n = num(a[0]); return (Math.sign(n) * Math.floor(Math.abs(n) * f)) / f; }, help: "Redondea hacia abajo.", example: "ROUNDDOWN({Horas}, 0)" },
  ABS: { group: "Números", args: [1, 1], run: (a) => Math.abs(num(a[0])), help: "Valor absoluto.", example: "ABS({Diferencia})" },
  POWER: { group: "Números", args: [2, 2], run: (a) => num(a[0]) ** num(a[1]), help: "Potencia.", example: "POWER({Lado}, 2)" },
  SQRT: { group: "Números", args: [1, 1], run: (a) => { const n = num(a[0]); if (n < 0) throw new FormulaError("Raíz de un número negativo."); return Math.sqrt(n); }, help: "Raíz cuadrada.", example: "SQRT({Área})" },
  LOG: { group: "Números", args: [1, 2], run: (a) => { const n = num(a[0]); const b = a.length > 1 ? num(a[1]) : 10; if (n <= 0 || b <= 0 || b === 1) throw new FormulaError("Logaritmo inválido."); return Math.log(n) / Math.log(b); }, help: "Logaritmo (base 10 por defecto).", example: "LOG({Valor}, 2)" },
  PI: { group: "Números", args: [0, 0], run: () => Math.PI, help: "El número π.", example: "PI() * POWER({Radio}, 2)" },
  VALUE: { group: "Números", args: [1, 1], run: (a) => num(a[0]), help: "Convierte un texto en número.", example: 'VALUE("1250")' },

  // Texto
  CONCATENATE: { group: "Texto", args: [1, 255], run: (a) => a.map(str).join(""), help: "Une textos (también podés usar &).", example: 'CONCATENATE({Nombre}, " - ", {Estado})' },
  LEFT: { group: "Texto", args: [1, 2], run: (a) => str(a[0]).slice(0, Math.max(0, num(a[1] ?? 1))), help: "Primeros N caracteres.", example: "LEFT({Código}, 3)" },
  RIGHT: { group: "Texto", args: [1, 2], run: (a) => { const s = str(a[0]); const n = Math.max(0, num(a[1] ?? 1)); return n ? s.slice(-n) : ""; }, help: "Últimos N caracteres.", example: "RIGHT({Teléfono}, 4)" },
  MID: { group: "Texto", args: [3, 3], run: (a) => str(a[0]).substr(Math.max(0, num(a[1]) - 1), Math.max(0, num(a[2]))), help: "N caracteres desde una posición.", example: "MID({Código}, 2, 3)" },
  LEN: { group: "Texto", args: [1, 1], run: (a) => str(a[0]).length, help: "Cantidad de caracteres.", example: "LEN({Descripción})" },
  LOWER: { group: "Texto", args: [1, 1], run: (a) => str(a[0]).toLowerCase(), help: "En minúsculas.", example: "LOWER({Email})" },
  UPPER: { group: "Texto", args: [1, 1], run: (a) => str(a[0]).toUpperCase(), help: "En mayúsculas.", example: "UPPER({Código})" },
  TRIM: { group: "Texto", args: [1, 1], run: (a) => str(a[0]).trim().replace(/\s+/g, " "), help: "Quita espacios de más.", example: "TRIM({Nombre})" },
  REPLACE: { group: "Texto", args: [4, 4], run: (a) => { const s = str(a[0]); const start = Math.max(0, num(a[1]) - 1); return s.slice(0, start) + str(a[3]) + s.slice(start + Math.max(0, num(a[2]))); }, help: "Reemplaza N caracteres desde una posición.", example: 'REPLACE({Código}, 1, 2, "AR")' },
  SUBSTITUTE: { group: "Texto", args: [3, 3], run: (a) => { const find = str(a[1]); return find ? str(a[0]).split(find).join(str(a[2])) : str(a[0]); }, help: "Reemplaza un texto por otro.", example: 'SUBSTITUTE({Nombre}, "SA", "S.A.")' },
  SEARCH: { group: "Texto", args: [2, 3], run: (a) => { const i = str(a[1]).toLowerCase().indexOf(str(a[0]).toLowerCase(), Math.max(0, num(a[2] ?? 1) - 1)); return i >= 0 ? i + 1 : 0; }, help: "Posición de un texto dentro de otro (0 si no está).", example: 'SEARCH("urgente", {Notas})' },
  REPT: { group: "Texto", args: [2, 2], run: (a) => str(a[0]).repeat(Math.max(0, Math.min(500, num(a[1])))), help: "Repite un texto N veces.", example: 'REPT("★", {Calificación})' },
  TEXT: { group: "Texto", args: [2, 2], run: (a) => { const f = str(a[1]); const d = toDate(a[0]); if (d && typeof a[0] === "string") return formatDate(d, f); return formatNumberPattern(num(a[0]), f); }, help: "Da formato a un número o una fecha.", example: 'TEXT({Monto}, "$#,##0.00")' },

  // Lógica
  IF: { group: "Lógica", args: [2, 3], run: () => null, help: "Si se cumple la condición, el primer valor; si no, el segundo.", example: 'IF({Monto} > 1000, "Alto", "Bajo")' },
  AND: { group: "Lógica", args: [1, 255], run: (a) => a.every(bool), help: "Verdadero si todas se cumplen.", example: "AND({Cantidad} > 0, {Pagado})" },
  OR: { group: "Lógica", args: [1, 255], run: (a) => a.some(bool), help: "Verdadero si alguna se cumple.", example: 'OR({Estado} = "Listo", {Pagado})' },
  XOR: { group: "Lógica", args: [1, 255], run: (a) => a.filter(bool).length % 2 === 1, help: "Verdadero si se cumple una cantidad impar.", example: "XOR({A}, {B})" },
  NOT: { group: "Lógica", args: [1, 1], run: (a) => !bool(a[0]), help: "Invierte verdadero y falso.", example: "NOT({Pagado})" },
  EXACT: { group: "Lógica", args: [2, 2], run: (a) => str(a[0]) === str(a[1]), help: "¿Los textos son idénticos?", example: "EXACT({Código}, {Código anterior})" },
  SWITCH: { group: "Lógica", args: [3, 255], run: () => null, help: "Compara un valor con varios casos.", example: 'SWITCH({Estado}, "Listo", 1, "En curso", 0.5, 0)' },
  ISBLANK: { group: "Lógica", args: [1, 1], run: (a) => a[0] === null || a[0] === "", help: "¿Está vacío?", example: 'IF(ISBLANK({Fecha}), "Sin fecha", {Fecha})' },

  // Fechas
  TODAY: { group: "Fechas", args: [0, 0], run: (_a, ctx) => ctx.today, help: "La fecha de hoy.", example: "DAYS({Vencimiento}, TODAY())" },
  NOW: { group: "Fechas", args: [0, 0], run: (_a, ctx) => ctx.now, help: "Fecha y hora actuales.", example: "HOURS_DIFF(NOW(), {Hora})" },
  DATE: { group: "Fechas", args: [3, 3], run: (a) => iso(new Date(Date.UTC(num(a[0]), num(a[1]) - 1, num(a[2])))), help: "Arma una fecha (año, mes, día).", example: "DATE(2026, 12, 31)" },
  DAYS: { group: "Fechas", args: [2, 2], run: (a) => Math.round((date(a[0], "DAYS").getTime() - date(a[1], "DAYS").getTime()) / 86400000), help: "Días entre dos fechas (fin, inicio).", example: "DAYS({Vencimiento}, TODAY())" },
  WORKDAYS: { group: "Fechas", args: [2, 2], run: (a) => workdays(date(a[1], "WORKDAYS"), date(a[0], "WORKDAYS")), help: "Días hábiles entre dos fechas (fin, inicio).", example: "WORKDAYS({Cronograma#Fin}, {Cronograma#Inicio})" },
  ADD_DAYS: { group: "Fechas", args: [2, 2], run: (a) => { const d = date(a[0], "ADD_DAYS"); return iso(new Date(d.getTime() + Math.round(num(a[1])) * 86400000)); }, help: "Suma días a una fecha.", example: "ADD_DAYS({Inicio}, 30)" },
  SUBTRACT_DAYS: { group: "Fechas", args: [2, 2], run: (a) => { const d = date(a[0], "SUBTRACT_DAYS"); return iso(new Date(d.getTime() - Math.round(num(a[1])) * 86400000)); }, help: "Resta días a una fecha.", example: "SUBTRACT_DAYS({Vencimiento}, 7)" },
  FORMAT_DATE: { group: "Fechas", args: [1, 2], run: (a) => formatDate(date(a[0], "FORMAT_DATE"), a.length > 1 ? str(a[1]) : "D MMM YYYY"), help: "Muestra una fecha con formato.", example: 'FORMAT_DATE({Fecha}, "DD/MM/YYYY")' },
  YEAR: { group: "Fechas", args: [1, 1], run: (a) => date(a[0], "YEAR").getUTCFullYear(), help: "El año de una fecha.", example: "YEAR({Fecha})" },
  MONTH: { group: "Fechas", args: [1, 1], run: (a) => date(a[0], "MONTH").getUTCMonth() + 1, help: "El mes (1 a 12).", example: "MONTH({Fecha})" },
  DAY: { group: "Fechas", args: [1, 1], run: (a) => date(a[0], "DAY").getUTCDate(), help: "El día del mes.", example: "DAY({Fecha})" },
  WEEKDAY: { group: "Fechas", args: [1, 1], run: (a) => date(a[0], "WEEKDAY").getUTCDay() + 1, help: "Día de la semana (1 = domingo … 7 = sábado).", example: "WEEKDAY({Fecha})" },
  WEEKNUM: { group: "Fechas", args: [1, 1], run: (a) => weekNum(date(a[0], "WEEKNUM")), help: "Número de semana del año.", example: "WEEKNUM({Fecha})" },
  ISOWEEKNUM: { group: "Fechas", args: [1, 1], run: (a) => isoWeek(date(a[0], "ISOWEEKNUM")), help: "Número de semana ISO.", example: "ISOWEEKNUM({Fecha})" },
  HOUR: { group: "Fechas", args: [1, 1], run: (a) => Math.trunc(hoursOf(a[0])), help: "La hora de una fecha u hora.", example: "HOUR({Registro de creación})" },
  MINUTE: { group: "Fechas", args: [1, 1], run: (a) => { const m = /(\d{1,2}):(\d{2})/.exec(str(a[0])); return m ? Number(m[2]) : 0; }, help: "Los minutos.", example: "MINUTE({Hora})" },
  SECOND: { group: "Fechas", args: [1, 1], run: (a) => { const m = /\d{1,2}:\d{2}:(\d{2})/.exec(str(a[0])); return m ? Number(m[1]) : 0; }, help: "Los segundos.", example: "SECOND({Hora})" },
  HOURS_DIFF: { group: "Fechas", args: [2, 2], run: (a) => { const diff = hoursOf(a[0]) - hoursOf(a[1]); const sign = diff < 0 ? "-" : ""; const total = Math.round(Math.abs(diff) * 60); return `${sign}${Math.floor(total / 60)}:${pad(total % 60)}`; }, help: "Diferencia entre dos horas (H:MM).", example: "HOURS_DIFF({Salida}, {Entrada})" },
};

/* ------------------------------------------------------------ evaluador */

export type EvalContext = {
  /** Valor de una columna por nombre (ya normalizado). undefined = no existe. */
  resolve: (name: string) => FValue | undefined;
  today: string;
  now: string;
};

function compare(op: string, a: FValue, b: FValue): boolean {
  // Números con números; si no, texto sin distinguir mayúsculas.
  const bothNum =
    (typeof a === "number" || typeof a === "boolean" || a === null || (typeof a === "string" && a.trim() !== "" && Number.isFinite(Number(a)))) &&
    (typeof b === "number" || typeof b === "boolean" || b === null || (typeof b === "string" && b.trim() !== "" && Number.isFinite(Number(b))));
  let c: number;
  if (typeof a === "boolean" || typeof b === "boolean") c = Number(bool(a)) - Number(bool(b));
  else if (bothNum && a !== null && b !== null) c = num(a) - num(b);
  else c = str(a).toLowerCase().localeCompare(str(b).toLowerCase(), "es");
  switch (op) {
    case "=":
      return c === 0;
    case "<>":
      return c !== 0;
    case "<":
      return c < 0;
    case ">":
      return c > 0;
    case "<=":
      return c <= 0;
    default:
      return c >= 0;
  }
}

export function evaluate(node: Node, ctx: EvalContext): FValue {
  switch (node.k) {
    case "lit":
      return node.v;
    case "ref": {
      const v = ctx.resolve(node.name);
      if (v === undefined) throw new FormulaError(`No existe la columna {${node.name}}.`, node.p);
      return v;
    }
    case "un": {
      const v = num(evaluate(node.a, ctx));
      return node.op === "-" ? -v : v;
    }
    case "bin": {
      const a = evaluate(node.a, ctx);
      const b = evaluate(node.b, ctx);
      switch (node.op) {
        case "+":
          return num(a) + num(b);
        case "-":
          return num(a) - num(b);
        case "*":
          return num(a) * num(b);
        case "/": {
          const d = num(b);
          if (d === 0) throw new FormulaError("División por cero.", node.p);
          return num(a) / d;
        }
        case "^":
          return num(a) ** num(b);
        case "&":
          return str(a) + str(b);
        default:
          return compare(node.op, a, b);
      }
    }
    case "call": {
      const fn = FUNCTIONS[node.name];
      const [min, max] = fn.args;
      if (node.args.length < min || node.args.length > max) {
        throw new FormulaError(
          min === max ? `${node.name} lleva ${min} ${min === 1 ? "argumento" : "argumentos"}.` : `${node.name} lleva entre ${min} y ${max} argumentos.`,
          node.p,
        );
      }
      if (node.name === "IF") {
        return bool(evaluate(node.args[0], ctx)) ? evaluate(node.args[1], ctx) : node.args[2] ? evaluate(node.args[2], ctx) : "";
      }
      if (node.name === "SWITCH") {
        const v = evaluate(node.args[0], ctx);
        const rest = node.args.slice(1);
        for (let i = 0; i + 1 < rest.length; i += 2) {
          if (compare("=", v, evaluate(rest[i], ctx))) return evaluate(rest[i + 1], ctx);
        }
        return rest.length % 2 === 1 ? evaluate(rest[rest.length - 1], ctx) : "";
      }
      return fn.run(
        node.args.map((a) => evaluate(a, ctx)),
        ctx,
      );
    }
  }
}

export type FormulaResult = { ok: true; value: FValue } | { ok: false; error: string };

const cache = new Map<string, Node | FormulaError>();

export function compile(src: string): Node | FormulaError {
  const hit = cache.get(src);
  if (hit) return hit;
  let out: Node | FormulaError;
  try {
    out = parseFormula(src);
  } catch (e) {
    out = e instanceof FormulaError ? e : new FormulaError("Fórmula inválida.");
  }
  if (cache.size > 500) cache.clear();
  cache.set(src, out);
  return out;
}

export function runFormula(src: string, ctx: EvalContext): FormulaResult {
  const tree = compile(src);
  if (tree instanceof FormulaError) return { ok: false, error: tree.message };
  try {
    const v = evaluate(tree, ctx);
    if (typeof v === "number" && !Number.isFinite(v)) return { ok: false, error: "El resultado no es un número válido." };
    return { ok: true, value: v };
  } catch (e) {
    if (e instanceof EmptyResult) return { ok: true, value: "" };
    return { ok: false, error: e instanceof FormulaError ? e.message : "No se pudo calcular." };
  }
}

export const FUNCTION_GROUPS = ["Números", "Texto", "Lógica", "Fechas"] as const;
