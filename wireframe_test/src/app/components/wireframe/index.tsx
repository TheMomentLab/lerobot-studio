import React from "react";
import { Link } from "react-router";
import { Play, Square, Lock } from "lucide-react";
import { cn } from "../ui/utils";

// ─── Status Badge ─────────────────────────────────────────────────────────────
type StatusType = "running" | "ready" | "warning" | "error" | "idle" | "blocked" | "missing";
export function StatusBadge({
  status,
  label,
  pulse,
}: {
  status: StatusType;
  label?: string;
  pulse?: boolean;
}) {
  const map: Record<StatusType, string> = {
    running: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    ready: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    warning: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
    error: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
    idle: "bg-zinc-500/15 text-zinc-400 border-zinc-600/30",
    blocked: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
    missing: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  };
  const dotMap: Record<StatusType, string> = {
    running: "bg-emerald-400",
    ready: "bg-emerald-400",
    warning: "bg-amber-400",
    error: "bg-red-400",
    idle: "bg-zinc-500",
    blocked: "bg-red-400",
    missing: "bg-amber-400",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-sm font-mono",
        map[status]
      )}
    >
      <span className="relative flex size-1.5">
        <span className={cn("rounded-full size-1.5", dotMap[status])} />
        {pulse && status === "running" && (
          <span
            className={cn(
              "absolute inset-0 rounded-full animate-ping opacity-75",
              dotMap[status]
            )}
          />
        )}
      </span>
      {label ?? status.toUpperCase()}
    </span>
  );
}

// ─── Wire Box (gray placeholder) ──────────────────────────────────────────────
export function WireBox({
  className,
  label,
  children,
  aspectRatio,
}: {
  className?: string;
  label?: string;
  children?: React.ReactNode;
  aspectRatio?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded border border-dashed",
        "border-zinc-600 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800/40",
        "text-zinc-400 text-sm font-mono select-none",
        className
      )}
      style={aspectRatio ? { aspectRatio } : undefined}
    >
      {label && <span className="px-2 text-center">{label}</span>}
      {children}
    </div>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────
export function Card({
  step,
  title,
  titleSub,
  action,
  className,
  children,
  badge,
}: {
  step?: string | number;
  title?: string;
  titleSub?: string;
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900",
        "flex flex-col",
        className
      )}
    >
      {title && (
        <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            {step !== undefined && (
              <span className="flex-none size-5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 text-sm flex items-center justify-center font-mono">
                {step}
              </span>
            )}
            <div className="flex items-center gap-2">
              {title?.includes("—") ? (
                <>
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    {title.split("—")[0].trim()}
                  </span>
                  <span className="text-sm text-zinc-400">
                    {title.split("—")[1].trim()}
                  </span>
                </>
              ) : (
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{title}</span>
              )}
              {badge}
            </div>
            {titleSub && (
              <span className="text-sm text-zinc-400">{titleSub}</span>
            )}
          </div>
          {action && <div className="ml-4 flex-none">{action}</div>}
        </div>
      )}
      {!!children && <div className="p-4 flex-1">{children}</div>}
    </div>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────
export function SectionHeader({
  step,
  title,
  subtitle,
  badge,
  action,
}: {
  step?: string | number;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between mb-3">
      <div className="flex items-start gap-2">
        {step !== undefined && (
          <span className="mt-0.5 flex-none size-5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 text-sm flex items-center justify-center font-mono">
            {step}
          </span>
        )}
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</span>
            {badge}
          </div>
          {subtitle && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
      {action}
    </div>
  );
}

// ─── Blocker Card ─────────────────────────────────────────────────────────────
export function BlockerCard({
  reasons,
  title = "Start 불가",
  severity = "warning",
}: {
  reasons: (string | { text: string; to?: string })[];
  title?: string;
  severity?: "warning" | "error";
}) {
  const tone =
    severity === "error"
      ? {
          shell: "border-red-500/30 bg-red-500/5",
          title: "text-red-500",
          chip: "border-red-500/30 text-red-500 bg-red-500/10",
        }
      : {
          shell: "border-amber-500/30 bg-amber-500/5",
          title: "text-amber-400",
          chip: "border-amber-500/30 text-amber-400 bg-amber-500/10",
        };

  return (
    <div className={cn("rounded-lg border px-3 py-2", tone.shell)}>
      <div className="flex items-center gap-2 mb-2">
        <span className={cn("text-sm", tone.title)}>⚠ {title}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {reasons.map((r, i) => {
          const text = typeof r === "string" ? r : r.text;
          const to = typeof r === "string" ? undefined : r.to;
          return to ? (
            <Link
              key={i}
              to={to}
              className={cn("px-2 py-0.5 rounded text-sm border transition-colors", tone.chip)}
            >
              {text} →
            </Link>
          ) : (
            <span
              key={i}
              className={cn("px-2 py-0.5 rounded text-sm border", tone.chip)}
            >
              {text}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ─── Error Banner ─────────────────────────────────────────────────────────────
export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return <BlockerCard title="실행 차단" severity="error" reasons={[message]} />;
}

// ─── Process Buttons ──────────────────────────────────────────────────────────
export function ProcessButtons({
  running,
  onStart,
  onStop,
  startLabel,
  disabled,
  fullWidth = true,
  compact = false,
  className,
}: {
  running: boolean;
  onStart?: () => void;
  onStop?: () => void;
  startLabel?: React.ReactNode;
  disabled?: boolean;
  fullWidth?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const btnBase = compact ? "px-4 py-1.5 rounded-lg text-sm font-medium border flex items-center justify-center gap-1.5 leading-none transition-all" : "px-5 py-2 rounded-lg text-sm font-medium border flex items-center justify-center gap-1.5 transition-all shadow-sm";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {!running ? (
        <button
          onClick={onStart}
          disabled={disabled}
          className={cn(
            btnBase,
            fullWidth && "w-full",
            disabled
              ? "border-zinc-600 text-zinc-500 cursor-not-allowed"
              : "border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 cursor-pointer"
          )}
        >
          {startLabel ?? <><Play size={13} className="fill-current" /> Start</>}
        </button>
      ) : (
        <button
          onClick={onStop}
          className={cn(
            btnBase,
            "border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 cursor-pointer",
            fullWidth && "w-full"
          )}
        >
          <Square size={11} className="fill-current" /> Stop
        </button>
      )}
    </div>
  );
}

// ─── Field Row ────────────────────────────────────────────────────────────────
export function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 min-h-9">
      <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300 whitespace-nowrap flex-none w-[120px]">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

// ─── WireSelect ───────────────────────────────────────────────────────────────
export function WireSelect({ placeholder, value, options, onChange }: { placeholder?: string; value?: string; options?: string[]; onChange?: (v: string) => void }) {
  return (
    <select
      value={value ?? ""}
      onChange={onChange ? (e) => onChange(e.target.value) : () => {}}
      className="w-full h-9 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-800 dark:text-zinc-200 text-sm outline-none cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 transition-all"
    >
      {placeholder && <option value="" disabled>{placeholder}</option>}
      {options?.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

// ─── WireInput ────────────────────────────────────────────────────────────────
export function WireInput({ placeholder, value, onChange }: { placeholder?: string; value?: string; onChange?: (v: string) => void }) {
  return (
    <input
      type="text"
      value={value ?? ""}
      readOnly={!onChange}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      placeholder={placeholder}
      className="w-full h-9 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-800 dark:text-zinc-200 text-sm outline-none placeholder:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 transition-all"
    />
  );
}

// ─── Resource Bar ─────────────────────────────────────────────────────────────
export function ResourceBar({
  label,
  value,
  max,
  unit,
}: {
  label: string;
  value: number;
  max: number;
  unit?: string;
}) {
  const pct = Math.round((value / max) * 100);
  const color =
    pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-zinc-400 w-24 flex-none truncate">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm text-zinc-400 w-28 text-right flex-none whitespace-nowrap">
        {unit ? `${value} / ${max} ${unit}` : `${pct}%`}
      </span>
    </div>
  );
}

// ─── Page Header ──────────────────────────────────────────────────────────────
export function PageHeader({
  title,
  subtitle,
  status,
  statusLabel,
  action,
}: {
  title: string;
  subtitle?: string;
  status?: StatusType;
  statusLabel?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 tracking-tight">{title}</h1>
          {status && <StatusBadge status={status} label={statusLabel} />}
        </div>
        {subtitle && <p className="text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

// ─── Chip Tag ─────────────────────────────────────────────────────────────────
export function Chip({
  label,
  color = "default",
  icon,
}: {
  label: string;
  color?: "default" | "green" | "amber" | "blue" | "red";
  icon?: string;
}) {
  const map = {
    default: "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700",
    green: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
    amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40",
    blue: "bg-blue-500/10 text-blue-400 border-blue-500/30",
    red: "bg-red-500/10 text-red-400 border-red-500/30",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded border text-sm", map[color])}>
      {icon && <span>{icon}</span>}
      {label}
    </span>
  );
}

// ─── Sticky Control Bar ───────────────────────────────────────────────────────
export function StickyControlBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 mt-auto border-t border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 backdrop-blur px-6 py-2 flex items-center justify-between gap-4">
      {children}
    </div>
  );
}

// ─── Toggle Switch ────────────────────────────────────────────────────────────
export function WireToggle({
  label,
  checked,
  onChange,
}: {
  label?: string;
  checked?: boolean;
  onChange?: (v: boolean) => void;
}) {
  const [on, setOn] = React.useState(checked ?? false);
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <div
        className={cn(
          "w-8 h-4 rounded-full relative transition-colors",
          on ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"
        )}
        onClick={() => { setOn(!on); onChange?.(!on); }}
      >
        <div
          className={cn(
            "absolute top-0.5 size-3 rounded-full bg-white transition-transform",
            on ? "translate-x-4" : "translate-x-0.5"
          )}
        />
      </div>
      {label && <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300 select-none">{label}</span>}
    </label>
  );
}

// ─── Mode Toggle ──────────────────────────────────────────────────────────────
export function ModeToggle({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange?: (v: string) => void;
}) {
  const [active, setActive] = React.useState(value);
  return (
    <div className="inline-flex rounded border border-zinc-200 dark:border-zinc-700 p-0.5 gap-0.5">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => { setActive(o); onChange?.(o); }}
          className={cn(
            "px-4 py-1.5 rounded-md text-sm font-medium transition-all cursor-pointer",
            active === o
              ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
              : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────
export function EmptyState({ icon, message, action }: { icon?: React.ReactNode; message: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
      {icon && <div className="text-3xl opacity-30">{icon}</div>}
      <p className="text-sm text-zinc-400 max-w-xs">{message}</p>
      {action}
    </div>
  );
}

// ─── HF Gate Banner ──────────────────────────────────────────────────────────
import type { HfAuthState } from "../../hf-auth-context";

const HF_GATE_MSG: Record<Exclude<HfAuthState, "ready">, string> = {
  missing_token: "HF token\uc774 \uc5c6\uc2b5\ub2c8\ub2e4. Settings\uc5d0\uc11c \ud1a0\ud070\uc744 \ub4f1\ub85d\ud558\uc138\uc694.",
  invalid_token: "\ud1a0\ud070\uc774 \uc720\ud6a8\ud558\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4. \ub2e4\uc2dc \ub85c\uadf8\uc778/\uc7ac\ub4f1\ub85d\ud558\uc138\uc694.",
};

export function HfGateBanner({
  authState,
  level,
}: {
  authState: HfAuthState;
  level: "hf_read" | "hf_write";
}) {
  if (authState === "ready") return null;
  const msg = HF_GATE_MSG[authState];
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/5">
      <Lock size={13} className="text-amber-600 dark:text-amber-400 flex-none" />
      <span className="text-sm text-amber-600 dark:text-amber-400 flex-1">{msg}</span>
      <button className="ml-auto px-2 py-1 rounded border border-amber-500/30 bg-amber-500/10 text-sm text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors cursor-pointer whitespace-nowrap">
        Token Settings &rarr;
      </button>
    </div>
  );
}
