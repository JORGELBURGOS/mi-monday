import Link from "next/link";
import { siteConfig } from "@/config/site";
import { LogoMark, Wordmark } from "@/components/ui/icons";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-[calc(100dvh/var(--ui-zoom,1))] lg:grid-cols-[1fr_minmax(0,560px)]">
      <aside className="relative hidden overflow-hidden bg-[#1d1b18] p-12 text-[#f3efe8] lg:flex lg:flex-col lg:justify-between">
        <Link href="/" className="flex items-center gap-2.5 text-lg font-extrabold">
          <LogoMark size={32} />
          <Wordmark name={siteConfig.name} />
        </Link>
        <div className="max-w-md">
          <p className="text-3xl font-extrabold leading-tight tracking-tight text-balance">
            Cada tarea con dueño, fecha y estado claro.
          </p>
          <p className="mt-4 text-[15px] leading-relaxed text-[#bdb6aa]">
            Tableros compartidos para tu equipo, con acceso por tablero y roles. Todo queda ordenado y a la vista.
          </p>
        </div>
        <BoardSketch />
      </aside>
      <main id="contenido" className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <Link href="/" className="mb-8 flex items-center gap-2.5 text-lg font-extrabold lg:hidden">
            <LogoMark />
            <Wordmark name={siteConfig.name} />
          </Link>
          {children}
        </div>
      </main>
    </div>
  );
}

/** Ilustración abstracta propia: filas de un tablero con chips de estado. */
function BoardSketch() {
  const rows = [
    { w: "62%", c: "var(--chip-green-dot)" },
    { w: "48%", c: "var(--chip-amber-dot)" },
    { w: "70%", c: "var(--chip-blue-dot)" },
    { w: "40%", c: "#8b877f" },
  ];
  return (
    <div aria-hidden className="space-y-2.5 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="h-3 w-3 rounded-[4px] border border-white/25" />
          <span className="h-2.5 rounded-full bg-white/20" style={{ width: r.w }} />
          <span className="ml-auto h-5 w-16 rounded-full" style={{ background: r.c, opacity: 0.85 }} />
        </div>
      ))}
    </div>
  );
}
