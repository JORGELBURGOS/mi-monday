import type { CSSProperties } from "react";
import type { FormDesign } from "@/lib/form-logic";

/** Variables de color del formulario (sirve en el servidor y en el navegador). */
export function formTheme(design: FormDesign): CSSProperties {
  const c = design.accent || "blue";
  return {
    ["--fa" as string]: `var(--solid-${c})`,
    ["--fa-fg" as string]: `var(--solid-${c}-fg)`,
    ["--fa-soft" as string]: `var(--chip-${c}-bg)`,
    ["--fa-dot" as string]: `var(--chip-${c}-dot)`,
  };
}
