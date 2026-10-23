"use client";

import { useRef, useSyncExternalStore } from "react";
import { IconChevronLeft, IconChevronRight } from "@/components/ui/icons";
import { DEFAULT_ZOOM, SIDEBAR_DEFAULT, SIDEBAR_HIDDEN_KEY, SIDEBAR_KEY, SIDEBAR_MAX, SIDEBAR_MIN, setZoom, uiZoom } from "@/lib/ui-prefs";

function currentWidth() {
  const v = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sb"), 10);
  return v >= SIDEBAR_MIN && v <= SIDEBAR_MAX ? v : SIDEBAR_DEFAULT;
}
function applyWidth(w: number, save = false) {
  const clamped = Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)));
  document.documentElement.style.setProperty("--sb", `${clamped}px`);
  if (save) {
    try {
      localStorage.setItem(SIDEBAR_KEY, String(clamped));
    } catch {}
  }
  return clamped;
}
export function setSidebarHidden(hidden: boolean) {
  const d = document.documentElement;
  if (hidden) d.setAttribute("data-sb-hidden", "");
  else d.removeAttribute("data-sb-hidden");
  try {
    localStorage.setItem(SIDEBAR_HIDDEN_KEY, hidden ? "1" : "0");
  } catch {}
}

/** Borde arrastrable para cambiar el ancho del menú lateral (también con flechas). */
export function SidebarResizer() {
  const drag = useRef<{ x: number; w: number } | null>(null);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Ancho del menú lateral (arrastrá, o usá las flechas; doble clic vuelve al ancho normal)"
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      tabIndex={0}
      title="Arrastrá para cambiar el ancho · doble clic: ancho normal"
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as Element).setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, w: currentWidth() };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        applyWidth(drag.current.w + (e.clientX - drag.current.x) / uiZoom());
      }}
      onPointerUp={() => {
        if (!drag.current) return;
        drag.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        applyWidth(currentWidth(), true);
      }}
      onDoubleClick={() => applyWidth(SIDEBAR_DEFAULT, true)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") applyWidth(currentWidth() - 16, true);
        else if (e.key === "ArrowRight") applyWidth(currentWidth() + 16, true);
        else if (e.key === "Home") applyWidth(SIDEBAR_MIN, true);
        else if (e.key === "End") applyWidth(SIDEBAR_MAX, true);
        else return;
        e.preventDefault();
      }}
      className="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:bg-transparent hover:after:bg-accent focus-visible:after:bg-accent"
    />
  );
}

export function SidebarHideButton() {
  return (
    <button
      type="button"
      onClick={() => setSidebarHidden(true)}
      aria-label="Esconder el menú lateral"
      title="Esconder el menú"
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
    >
      <IconChevronLeft size={16} />
    </button>
  );
}

/** Aparece solo con el menú escondido (lo controla el CSS global). */
export function SidebarShowButton() {
  return (
    <button
      type="button"
      onClick={() => setSidebarHidden(false)}
      aria-label="Mostrar el menú lateral"
      title="Mostrar el menú"
      className="sb-show fixed bottom-4 left-2 z-40 hidden h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-muted shadow-card hover:text-fg"
    >
      <IconChevronRight size={16} />
    </button>
  );
}

const STEPS = [0.5, 0.55, 0.6, 0.67, 0.75, 0.8, 0.9, 1, 1.1];

function subscribeZoom(cb: () => void) {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
}

/** Achicar / agrandar toda la interfaz (como el zoom del navegador, pero solo para Vetta). */
export function ZoomControl() {
  const z = useSyncExternalStore(subscribeZoom, uiZoom, () => DEFAULT_ZOOM);
  const idx = STEPS.findIndex((s) => Math.abs(s - z) < 0.01);
  const go = (d: number) => {
    const i = idx >= 0 ? idx : STEPS.indexOf(DEFAULT_ZOOM);
    const next = STEPS[Math.min(STEPS.length - 1, Math.max(0, i + d))];
    setZoom(next);
  };
  return (
    <div className="flex items-center gap-1 px-2 py-1 text-sm text-muted" role="group" aria-label="Tamaño de la pantalla">
      <span className="flex-1">Tamaño</span>
      <button type="button" onClick={() => go(-1)} disabled={idx === 0} aria-label="Achicar la pantalla" className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line font-bold hover:bg-surface-2 disabled:opacity-40">
        −
      </button>
      <button type="button" onClick={() => setZoom(DEFAULT_ZOOM)} title="Volver al tamaño normal" className="w-12 rounded-md py-1 text-center text-xs font-semibold tabular-nums hover:bg-surface-2" aria-label={`Tamaño actual ${Math.round(z * 100)}%. Volver al normal`}>
        {Math.round(z * 100)}%
      </button>
      <button type="button" onClick={() => go(1)} disabled={idx === STEPS.length - 1} aria-label="Agrandar la pantalla" className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line font-bold hover:bg-surface-2 disabled:opacity-40">
        +
      </button>
    </div>
  );
}
