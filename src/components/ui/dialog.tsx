"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { IconX } from "@/components/ui/icons";
import { Input } from "@/components/ui/form";

/**
 * Diálogo modal basado en <dialog> nativo: atrapa el foco, cierra con Escape
 * y devuelve el foco al elemento que lo abrió.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      const previouslyFocused = document.activeElement as HTMLElement | null;
      dialog.showModal();
      return () => {
        if (dialog.open) dialog.close();
        previouslyFocused?.focus?.();
      };
    }
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Clic en el fondo (fuera del contenido) cierra el diálogo.
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto max-h-[calc(92dvh/var(--ui-zoom,1))] w-[calc(100%-1.5rem)] overflow-visible rounded-2xl border border-line bg-surface p-0 text-fg shadow-pop",
        size === "sm" && "max-w-md",
        size === "md" && "max-w-lg",
        size === "lg" && "max-w-3xl",
        size === "xl" && "max-w-5xl",
      )}
    >
      <div className="animate-in flex max-h-[calc(92dvh/var(--ui-zoom,1))] flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-bold leading-snug">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-sm text-muted">
                {description}
              </p>
            )}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Cerrar">
            <IconX />
          </Button>
        </header>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </dialog>
  );
}

/**
 * Confirmación para acciones destructivas. Opcionalmente exige escribir un
 * texto (por ejemplo, el nombre del tablero) antes de habilitar el botón.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirmar",
  danger = true,
  requireText,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  requireText?: string;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  const canConfirm = !requireText || typed.trim() === requireText.trim();

  const close = () => {
    if (busy) return;
    setTyped("");
    onClose();
  };

  return (
    <Dialog open={open} onClose={close} title={title} size="sm">
      <div className="space-y-4 text-sm">
        <div className="text-muted">{description}</div>
        {requireText && (
          <div>
            <label htmlFor={inputId} className="mb-1.5 block font-semibold">
              Escribí <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px]">{requireText}</span> para confirmar
            </label>
            <Input id={inputId} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus />
          </div>
        )}
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button onClick={close} disabled={busy} autoFocus={!requireText}>
            Cancelar
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            disabled={!canConfirm || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                setTyped("");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Procesando…" : confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
