"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

/**
 * Botón que abre un panel flotante. El panel se monta en <body> con posición
 * fija, así no lo recortan las tablas con desplazamiento horizontal.
 * Escape o un clic afuera lo cierran y el foco vuelve al botón.
 */
export function PopoverButton({
  label,
  children,
  panel,
  className,
  panelClassName,
  width = 260,
  disabled,
  title,
  align = "start",
}: {
  label: string;
  children: React.ReactNode;
  panel: (close: () => void) => React.ReactNode;
  className?: string;
  panelClassName?: string;
  width?: number;
  disabled?: boolean;
  title?: string;
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [container, setContainer] = useState<Element | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const id = useId();
  const buttonId = `${id}-btn`;

  const close = useCallback(
    (restore = true) => {
      setOpen(false);
      if (restore) document.getElementById(buttonId)?.focus();
    },
    [buttonId],
  );

  const place = useCallback(() => {
    const r = buttonRef.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(width, vw - 16);
    let left = align === "end" ? r.right - w : align === "center" ? r.left + r.width / 2 - w / 2 : r.left;
    left = Math.max(8, Math.min(left, vw - w - 8));
    const below = vh - r.bottom - 8;
    const above = r.top - 8;
    const panelH = panelRef.current?.scrollHeight ?? 320;
    if (below >= Math.min(panelH, 320) || below >= above) {
      setPos({ top: r.bottom + 4, left, maxHeight: Math.max(160, below - 4) });
    } else {
      const h = Math.min(panelH, above - 4);
      setPos({ top: r.top - 4 - h, left, maxHeight: Math.max(160, above - 4) });
    }
  }, [width, align]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      // Diálogos abiertos desde el panel (por ejemplo, confirmaciones) no lo cierran.
      if ((t as Element).closest?.("[data-popover-keep]")) return;
      close(false);
    };
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      place();
    };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, close, place]);

  useEffect(() => {
    if (!open) return;
    const first = panelRef.current?.querySelector<HTMLElement>("[data-autofocus], button:not([disabled]), input, select, textarea");
    first?.focus();
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        aria-label={label}
        title={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => {
          if (open) return close();
          // Dentro de un <dialog> modal, el panel tiene que vivir en el diálogo para no quedar inerte.
          setContainer(buttonRef.current?.closest("dialog") ?? document.body);
          setOpen(true);
        }}
        className={className}
      >
        {children}
      </button>
      {open &&
        container &&
        createPortal(
          <div
            ref={panelRef}
            id={id}
            role="dialog"
            aria-label={label}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                close();
              }
            }}
            style={{ position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: Math.min(width, typeof window === "undefined" ? width : window.innerWidth - 16), maxHeight: pos?.maxHeight }}
            className={cn("animate-in z-[55] overflow-y-auto rounded-xl border border-line bg-surface p-2 text-fg shadow-pop", panelClassName)}
          >
            {panel(close)}
          </div>,
          container,
        )}
    </>
  );
}
