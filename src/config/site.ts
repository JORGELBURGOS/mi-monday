/**
 * Identidad de la app centralizada. Cambiá el nombre acá (o con la variable
 * NEXT_PUBLIC_APP_NAME) y se actualiza en toda la interfaz.
 */
export const siteConfig = {
  name: process.env.NEXT_PUBLIC_APP_NAME?.trim() || "Mi Monday",
  tagline: "Proyectos y tareas de tu equipo, en un solo lugar.",
  description:
    "Organizá espacios de trabajo, tableros y tareas con tu equipo: estados, prioridades, responsables y fechas.",
} as const;
