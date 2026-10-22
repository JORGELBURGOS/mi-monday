export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8" role="status" aria-live="polite">
      <span className="sr-only">Cargando…</span>
      <div className="h-7 w-56 animate-pulse rounded-lg bg-surface-3" />
      <div className="mt-3 h-4 w-80 max-w-full animate-pulse rounded bg-surface-2" />
      <div className="mt-8 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-xl bg-surface-2" style={{ opacity: 1 - i * 0.15 }} />
        ))}
      </div>
    </div>
  );
}
