"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { rectCss, viewportCss } from "@/lib/ui-prefs";

export type MenuItem =
  | {
      type?: "item";
      label: string;
      onSelect: () => void;
      icon?: React.ReactNode;
      danger?: boolean;
      disabled?: boolean;
    }
  | { type: "separator" }
  | { type: "label"; label: string };

/**
 * Menú de acciones accesible: botón con aria-haspopup, navegación con
 * flechas/Home/End, Escape para cerrar y foco que vuelve al botón.
 */
export function Menu({
  label,
  trigger,
  items,
  align = "end",
  triggerClassName,
}: {
  label: string;
  trigger: React.ReactNode;
  items: MenuItem[];
  align?: "start" | "end";
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [container, setContainer] = useState<Element | null>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left?: number; right?: number; maxHeight: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const focusables = useCallback(
    () => Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []),
    [],
  );

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  // El menú flota sobre la página (portal) para que no lo recorten tablas con scroll.
  const place = useCallback(() => {
    if (!buttonRef.current) return;
    // En píxeles CSS de la app (la interfaz puede tener zoom).
    const r = rectCss(buttonRef.current);
    const { vw, vh } = viewportCss();
    const up = vh - r.bottom < 280 && r.top > vh - r.bottom;
    const horizontal = align === "end" ? { right: Math.max(8, vw - r.right) } : { left: Math.max(8, Math.min(r.left, vw - 216)) };
    setPos(
      up
        ? { bottom: vh - r.top + 4, ...horizontal, maxHeight: r.top - 12 }
        : { top: r.bottom + 4, ...horizontal, maxHeight: vh - r.bottom - 12 },
    );
  }, [align]);

  const openMenu = () => {
    setContainer(buttonRef.current?.closest("dialog") ?? document.body);
    place();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    focusables()[0]?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!listRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) {
        close(false);
      }
    };
    const onScroll = (e: Event) => {
      // Al desplazar la página o la tabla, el menú acompaña a su botón.
      if (!listRef.current?.contains(e.target as Node)) place();
    };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open, close, focusables, place]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const els = focusables();
    const idx = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      els[(idx + 1) % els.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      els[(idx - 1 + els.length) % els.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      els[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      els[els.length - 1]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  return (
    <div className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            openMenu();
          }
        }}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg aria-expanded:bg-surface-2 aria-expanded:text-fg",
          triggerClassName,
        )}
      >
        {trigger}
      </button>
      {open && pos && container && createPortal(
        <div
          ref={listRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          style={{ position: "fixed", ...pos }}
          className="animate-in z-[55] min-w-52 max-w-[calc(100vw/var(--ui-zoom,1)-16px)] overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-pop"
        >
          {items.map((item, i) => {
            if (item.type === "separator") return <div key={i} role="separator" className="my-1 h-px bg-line" />;
            if (item.type === "label")
              return (
                <div key={i} className="px-2.5 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-subtle">
                  {item.label}
                </div>
              );
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                tabIndex={-1}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none",
                  "focus-visible:bg-surface-2 hover:bg-surface-2 disabled:opacity-45",
                  item.danger ? "text-danger" : "text-fg",
                )}
              >
                {item.icon && <span className="text-muted [&>svg]:block">{item.icon}</span>}
                {item.label}
              </button>
            );
          })}
        </div>,
        container,
      )}
    </div>
  );
}
