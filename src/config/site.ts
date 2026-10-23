/**
 * Identidad de la app centralizada. Cambiá el nombre acá (o con la variable
 * NEXT_PUBLIC_APP_NAME) y se actualiza en toda la interfaz.
 */
export const siteConfig = {
  name: process.env.NEXT_PUBLIC_APP_NAME?.trim() || "Vetta",
  tagline: "Seguí el trabajo de tu equipo de punta a punta.",
  description:
    "Organizá el trabajo en tableros con etapas, responsables, prioridades y fechas, y seguí cada tarea desde que empieza hasta que termina.",
} as const;
