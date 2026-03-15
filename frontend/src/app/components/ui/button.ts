import { cn } from "./utils";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonTone = "brand" | "neutral" | "success" | "warning" | "danger";
export type ButtonSize = "sm" | "md";

type ButtonStyleOptions = {
  variant?: ButtonVariant;
  tone?: ButtonTone;
  size?: ButtonSize;
  className?: string;
};

const BASE_STYLES = [
  "inline-flex items-center justify-center gap-2 rounded-lg",
  "text-sm font-medium whitespace-nowrap",
  "transition-colors duration-150",
  "cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
  "focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-950",
].join(" ");

const SIZE_STYLES: Record<ButtonSize, string> = {
  sm: "h-8 px-3",
  md: "h-10 px-5",
};

const VARIANT_STYLES: Record<ButtonVariant, Record<ButtonTone, string>> = {
  primary: {
    brand: "bg-blue-600 text-white shadow-sm hover:bg-blue-700",
    neutral: "bg-zinc-900 text-zinc-50 shadow-sm hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200",
    success: "bg-emerald-700 text-white shadow-sm hover:bg-emerald-800",
    warning: "bg-amber-500 text-zinc-950 shadow-sm hover:bg-amber-400",
    danger: "bg-red-600 text-white shadow-sm hover:bg-red-700",
  },
  secondary: {
    brand: "border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-500/15",
    neutral: "border border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200 dark:hover:bg-zinc-800",
    success: "border border-emerald-500/30 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/15",
    warning: "border border-amber-500/30 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/15",
    danger: "border border-red-500/30 bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/15",
  },
  ghost: {
    brand: "text-blue-700 hover:bg-blue-50 hover:text-blue-800 dark:text-blue-300 dark:hover:bg-blue-500/10 dark:hover:text-blue-200",
    neutral: "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200",
    success: "text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-200",
    warning: "text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:text-amber-300 dark:hover:bg-amber-500/10 dark:hover:text-amber-200",
    danger: "text-red-700 hover:bg-red-50 hover:text-red-800 dark:text-red-300 dark:hover:bg-red-500/10 dark:hover:text-red-200",
  },
};

export function buttonStyles({
  variant = "secondary",
  tone = "neutral",
  size = "md",
  className,
}: ButtonStyleOptions = {}): string {
  return cn(BASE_STYLES, SIZE_STYLES[size], VARIANT_STYLES[variant][tone], className);
}
