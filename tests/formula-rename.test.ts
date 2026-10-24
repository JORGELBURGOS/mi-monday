import assert from "node:assert/strict";
import { renameFormulaRef } from "../src/lib/formula";

assert.equal(renameFormulaRef("{Checklist}", "Checklist", "Pasos"), "{Pasos}");
assert.equal(renameFormulaRef("IF({ checklist } > 50, 1, 0) + {Otro}", "Checklist", "Pasos"), "IF({Pasos} > 50, 1, 0) + {Otro}");
assert.equal(renameFormulaRef("{Línea de tiempo#inicio}", "Linea de tiempo", "Plazo"), "{Plazo#inicio}");
assert.equal(renameFormulaRef("{Checklist 2}", "Checklist", "Pasos"), "{Checklist 2}");
assert.equal(renameFormulaRef('"{Checklist}" & {Checklist}', "Checklist", "X"), '"{X}" & {X}');
console.log("formula-rename: 5 checks ok");
