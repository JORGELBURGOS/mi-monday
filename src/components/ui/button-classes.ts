import { cn } from "@/lib/cn";

export type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline-danger";
export type Size = "sm" | "md" | "icon" | "icon-sm";

export function buttonClasses(variant: Variant = "secondary", size: Size = "md", extra?: string) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap transition-colors",
    "disabled:cursor-not-allowed disabled:opacity-55",
    size === "md" && "h-10 px-4 text-sm",
    size === "sm" && "h-8 px-3 text-[13px]",
    size === "icon" && "h-10 w-10",
    size === "icon-sm" && "h-8 w-8",
    variant === "primary" && "bg-accent text-accent-fg hover:bg-accent-hover",
    variant === "secondary" && "border border-line bg-surface text-fg hover:bg-surface-2",
    variant === "ghost" && "text-muted hover:bg-surface-2 hover:text-fg",
    variant === "danger" && "bg-danger text-white hover:opacity-90 dark:text-[#1d1b18]",
    variant === "outline-danger" && "border border-line bg-surface text-danger hover:bg-danger-soft",
    extra,
  );
}

