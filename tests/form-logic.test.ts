// Pruebas de la lógica de formularios: npx tsx tests/form-logic.test.ts
import fs from "node:fs";
import { answerText, checkAll, checkAnswer, initialValue, isVisible, pagesOf, type InputSpec, type Question } from "@/lib/form-logic";

const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error("FALLÓ", m);
    process.exitCode = 1;
  } else console.log("ok", m);
};

ok(
  fs.readFileSync("src/lib/form-logic.ts", "utf8") === fs.readFileSync("supabase/functions/vetta-formularios/form-logic.ts", "utf8"),
  "la copia de la función de servidor es idéntica",
);

const q = (x: Partial<Question> & { id: string }): Question => ({ kind: "free", label: x.id, ...x });
const questions: Question[] = [
  q({ id: "tipo", freeType: "choice", options: ["Compra", "Reclamo"], required: true }),
  q({ id: "monto", freeType: "number", required: true, min: 1, showIf: { mode: "all", rules: [{ q: "tipo", op: "is", value: "Compra" }] } }),
  q({ id: "detalle", freeType: "long", showIf: { mode: "any", rules: [{ q: "monto", op: "gt", value: "1000" }, { q: "tipo", op: "is", value: "Reclamo" }] } }),
  { id: "p2", kind: "page", label: "" },
  q({ id: "mail", freeType: "email", required: true }),
  q({ id: "origen", freeType: "short", hidden: true, param: "utm" }),
  q({ id: "acepto", freeType: "checkbox", required: true }),
];
const specs: Record<string, InputSpec> = {
  tipo: { type: "choice", options: [{ value: "Compra", label: "Compra" }, { value: "Reclamo", label: "Reclamo" }] },
  monto: { type: "number" },
  detalle: { type: "long" },
  mail: { type: "email" },
  origen: { type: "short" },
  acepto: { type: "checkbox" },
};

ok(!isVisible(questions[1], {}, questions), "condición: sin tipo, no se muestra el monto");
ok(isVisible(questions[1], { tipo: "Compra" }, questions), "condición: compra muestra el monto");
ok(isVisible(questions[2], { tipo: "Compra", monto: 5000 }, questions), "condición 'cualquiera': monto alto");
ok(!isVisible(questions[2], { tipo: "Compra", monto: 10 }, questions), "condición 'cualquiera': monto bajo no");
ok(isVisible(questions[2], { tipo: "Reclamo", monto: 5000 }, questions), "una pregunta oculta por condición no cuenta (monto de un reclamo)");
ok(!isVisible(questions[5], {}, questions), "las ocultas no se muestran");
ok(pagesOf(questions).length === 2 && pagesOf(questions)[1][0].id === "mail", "saltos de página");

let r = checkAll({ questions }, specs, { tipo: "Compra", mail: "x" });
ok(Boolean(r.errors.monto && r.errors.mail && r.errors.acepto), "obligatorias y formato");
r = checkAll({ questions }, specs, { tipo: "Reclamo", monto: 99999, mail: "Ana@Mail.com ", acepto: true, origen: "instagram", detalle: "  hola " });
ok(Object.keys(r.errors).length === 0, "respuesta válida");
ok(!("monto" in r.values), "no guarda respuestas de preguntas que no se mostraban");
ok(r.values.mail === "ana@mail.com" && r.values.detalle === "hola" && r.values.origen === "instagram", "normaliza los valores y acepta ocultas");
ok(!checkAnswer(q({ id: "x" }), { type: "choice", options: [{ value: "a", label: "A" }] }, "zzz").ok, "rechaza opciones inexistentes");
ok(!checkAnswer(q({ id: "x" }), { type: "daterange" }, "2026-10-10/2026-10-01").ok, "rango de fechas al revés");
ok(checkAnswer(q({ id: "x" }), { type: "url" }, "vetta.com.ar").ok, "completa https en enlaces");
ok(!checkAnswer(q({ id: "x" }), { type: "date" }, "2026-02-30").ok, "rechaza fechas imposibles");
ok(!checkAnswer(q({ id: "x", max: 2 }), { type: "multi", options: ["a", "b", "c"].map((v) => ({ value: v, label: v })) }, ["a", "b", "c"]).ok, "máximo de opciones");
ok(!checkAnswer(q({ id: "x" }), { type: "rating", max: 5 }, 6).ok, "calificación fuera de rango");
ok(initialValue(q({ id: "x", param: "area" }), { type: "choice", options: [{ value: "id1", label: "Ventas" }] }, { area: "ventas" }) === "id1", "precarga desde el enlace por texto de la opción");
ok(answerText({ type: "multi", options: [{ value: "a", label: "Alfa" }] }, ["a"]) === "Alfa", "texto legible");
