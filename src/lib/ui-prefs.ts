/**
 * Preferencias de pantalla de cada persona (en este navegador):
 *   * tamaño de la interfaz (zoom de toda la app, como el zoom del navegador)
 *   * ancho del menú lateral y si está escondido
 * Se aplican antes de pintar con un script en <head> para que no "salte".
 */
export const ZOOM_KEY = "vetta-zoom";
export const SIDEBAR_KEY = "vetta-sidebar";
export const SIDEBAR_HIDDEN_KEY = "vetta-sidebar-hidden";

export const DEFAULT_ZOOM = 0.75;
export const SIDEBAR_MIN = 170;
export const SIDEBAR_MAX = 520;
export const SIDEBAR_DEFAULT = 248;

/** Script que corre antes de pintar. Sin datos de la persona: solo lee localStorage. */
export const PREFS_SCRIPT = `(function(){try{var d=document.documentElement,s=localStorage;var z=parseFloat(s.getItem("${ZOOM_KEY}"));if(!(z>=0.5&&z<=1.25))z=${DEFAULT_ZOOM};d.style.setProperty("--ui-zoom",z);var w=parseInt(s.getItem("${SIDEBAR_KEY}"),10);if(!(w>=${SIDEBAR_MIN}&&w<=${SIDEBAR_MAX}))w=${SIDEBAR_DEFAULT};d.style.setProperty("--sb",w+"px");if(s.getItem("${SIDEBAR_HIDDEN_KEY}")==="1")d.setAttribute("data-sb-hidden","");}catch(e){}})();`;

/**
 * El zoom se aplica solo al contenedor de la app (#app-zoom), no a <html>:
 * así no afecta lo que agregan el navegador, extensiones o la barra de Vercel.
 */
export const APP_ZOOM_ID = "app-zoom";

/** Zoom aplicado a la app (1 si no hay). */
export function uiZoom(): number {
  if (typeof document === "undefined") return 1;
  const z = parseFloat(document.documentElement.style.getPropertyValue("--ui-zoom") || "1");
  return z > 0 ? z : 1;
}

/** Dónde montar paneles flotantes: dentro del diálogo abierto o del contenedor con zoom. */
export function floatingContainer(from: Element | null | undefined): Element {
  return from?.closest("dialog") ?? document.getElementById(APP_ZOOM_ID) ?? document.body;
}

/**
 * Medidas del viewport y de un elemento en píxeles CSS de la app (descontando
 * el zoom), para ubicar paneles flotantes con position: fixed.
 */
export function viewportCss() {
  const z = uiZoom();
  return { z, vw: window.innerWidth / z, vh: window.innerHeight / z };
}
export function rectCss(el: Element) {
  const z = uiZoom();
  const r = el.getBoundingClientRect();
  return { left: r.left / z, right: r.right / z, top: r.top / z, bottom: r.bottom / z, width: r.width / z, height: r.height / z };
}

export function setZoom(z: number) {
  const d = document.documentElement;
  d.style.setProperty("--ui-zoom", String(z));
  try {
    localStorage.setItem(ZOOM_KEY, String(z));
  } catch {}
  window.dispatchEvent(new Event("resize"));
}
