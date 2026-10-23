import Link from "next/link";
import { siteConfig } from "@/config/site";
import { LogoMark, Wordmark, IconBoard, IconUsers, IconCalendar } from "@/components/ui/icons";
import { buttonClasses } from "@/components/ui/button-classes";

export default function LandingPage() {
  const features = [
    {
      icon: <IconBoard />,
      title: "Tableros por grupos",
      text: "Agrupá tareas por etapa o área y reordenalas cuando cambian las prioridades.",
    },
    {
      icon: <IconUsers />,
      title: "Espacios con roles",
      text: "Propietarios, administradores y miembros. Cada espacio ve solo lo suyo.",
    },
    {
      icon: <IconCalendar />,
      title: "Fechas a la vista",
      text: "Filtrá por estado, prioridad o responsable y mirá los vencimientos en el calendario.",
    },
  ];

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <span className="flex items-center gap-2.5 whitespace-nowrap text-lg font-extrabold">
          <LogoMark />
          <Wordmark name={siteConfig.name} />
        </span>
        <nav className="flex items-center gap-2" aria-label="Cuenta">
          <Link href="/login" className={buttonClasses("ghost", "md", "hidden sm:inline-flex")}>
            Iniciar sesión
          </Link>
          <Link href="/registro" className={buttonClasses("primary", "md")}>
            Crear cuenta
          </Link>
        </nav>
      </header>

      <main id="contenido" className="mx-auto max-w-6xl px-5 pb-20 pt-12 sm:pt-20">
        <div className="max-w-3xl">
          <p className="mb-4 inline-flex rounded-full bg-accent-soft px-3 py-1 text-sm font-semibold text-accent">
            Gestión de proyectos para equipos
          </p>
          <h1 className="text-4xl font-extrabold leading-[1.08] tracking-tight text-balance sm:text-6xl">
            {siteConfig.tagline}
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">{siteConfig.description}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/registro" className={buttonClasses("primary", "md", "h-12 px-6 text-base")}>
              Empezar ahora
            </Link>
            <Link href="/login" className={buttonClasses("secondary", "md", "h-12 px-6 text-base")}>
              Ya tengo cuenta
            </Link>
          </div>
        </div>

        <ul className="mt-20 grid gap-4 sm:grid-cols-3">
          {features.map((f) => (
            <li key={f.title} className="rounded-2xl border border-line bg-surface p-6 shadow-card">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
                {f.icon}
              </div>
              <h2 className="font-bold">{f.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.text}</p>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
