import type { RuntimeProcessName } from "./types";

export function parseCompactNumber(token: string): number | null {
  const raw = token.trim().toUpperCase();
  const match = raw.match(/^([0-9]+(?:\.[0-9]+)?)([KMBTQ]?)$/);
  if (!match) {
    const value = Number(raw.replace(/,/g, ""));
    return Number.isFinite(value) ? Math.floor(value) : null;
  }

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;

  const unit = match[2];
  const mult = unit === "K"
    ? 1_000
    : unit === "M"
      ? 1_000_000
      : unit === "B"
        ? 1_000_000_000
        : unit === "T"
          ? 1_000_000_000_000
          : unit === "Q"
            ? 1_000_000_000_000_000
            : 1;
  return Math.floor(value * mult);
}

export function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatEta(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.ceil(seconds)}s`;
}

export function isRuntimeProcessRunning(status: Record<string, boolean>, processName: RuntimeProcessName): boolean {
  if (processName === "train") return !!(status.train || status.train_install);
  return !!status[processName];
}

export function mapOutputLevelToKind(level: "info" | "warn" | "error"): "stdout" | "warn" | "error" {
  if (level === "warn") return "warn";
  if (level === "error") return "error";
  return "stdout";
}

export function logLineClass(kind: string): string {
  if (kind === "stderr" || kind === "error") return "text-red-600 dark:text-red-400";
  if (kind === "warn") return "text-amber-600 dark:text-amber-400";
  if (kind === "info") return "text-zinc-500 dark:text-zinc-300";
  return "text-zinc-500 dark:text-zinc-400";
}
