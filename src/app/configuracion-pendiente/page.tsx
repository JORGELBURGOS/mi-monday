import { siteConfig } from "@/config/site";
import { LogoMark, Wordmark } from "@/components/ui/icons";

export const metadata = { title: "Configuración pendiente" };

export default function SetupPendingPage() {
  return (
    <main id="contenido" className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-5 py-12">
      <div className="mb-6 flex items-center gap-2.5 text-lg font-extrabold">
        <LogoMark /> <Wordmark name={siteConfig.name} />
      </div>
      <h1 className="text-2xl font-extrabold tracking-tight">Falta conectar la base de datos</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        La aplicación no encuentra las variables de entorno de Supabase. Cargá estas variables en el proyecto de Vercel
        (o en <code className="rounded bg-surface-2 px-1">.env.local</code> si la corrés en tu computadora) y volvé a desplegar:
      </p>
      <ul className="mt-4 space-y-2 rounded-xl border border-line bg-surface p-4 font-mono text-[13px]">
        <li>NEXT_PUBLIC_SUPABASE_URL</li>
        <li>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</li>
      </ul>
    </main>
  );
}
