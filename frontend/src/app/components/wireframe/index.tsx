import React from "react";
import { Link } from "react-router";
import { Play, Square, AlertTriangle, RefreshCw, CheckCircle, AlertCircle, Circle } from "lucide-react";
import { cn } from "../ui/utils";

// ─── Status Badge ─────────────────────────────────────────────────────────────
type StatusType = "running" | "ready" | "warning" | "error" | "idle" | "blocked";
export function StatusBadge({
  status,
  label,
  pulse,
}: {
  status: StatusType;
  label?: string;
  pulse?: boolean;
}) {
  const colorMap: Record<StatusType, string> = {
    running: "text-emerald-500",
    ready: "text-emerald-500",
    warning: "text-amber-500",
    error: "text-red-500",
    idle: "text-zinc-400",
    blocked: "text-amber-500",
  };
  const iconMap: Record<StatusType, React.ReactNode> = {
    running: <span className="relative flex size-3.5 items-center justify-center"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" /><span className="relative inline-flex size-2 rounded-full bg-emerald-500" /></span>,
    ready: <CheckCircle size={14} />,
    warning: <AlertTriangle size={14} />,
    error: <AlertCircle size={14} />,
    idle: <Circle size={14} />,
    blocked: <AlertTriangle size={14} />,
  };
  return (
    <span
      className={cn("inline-flex items-center", colorMap[status])}
      title={label ?? status.toUpperCase()}
    >
      {iconMap[status]}
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
  title = "Cannot Start",
  severity = "warning",
}: {
  reasons: (string | { text: string; to?: string })[];
  title?: string;
  severity?: "warning" | "error";
}) {
  const textReasons = reasons
    .map((r) => (typeof r === "string" ? r : r.text))
    .filter((text) => text && !text.includes("→"));
  const linkReasons = reasons.filter(
    (r): r is { text: string; to?: string } => typeof r !== "string" && Boolean(r.to)
  );

  const tone =
    severity === "error"
      ? {
          shell: "border-red-500/30 bg-red-500/5",
          text: "text-red-600 dark:text-red-400",
          action: "border-red-500/30 text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20",
        }
      : {
          shell: "border-amber-500/30 bg-amber-500/5",
          text: "text-amber-600 dark:text-amber-400",
          action: "border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/10 hover:bg-amber-500/20",
        };

  const message = textReasons.length > 0 ? textReasons.join(" · ") : title;

  return (
    <div className={cn("flex items-center gap-2 px-3 py-2 rounded-lg border", tone.shell)}>
      <AlertTriangle size={13} className={cn("flex-none", tone.text)} />
      <span className={cn("text-sm flex-1", tone.text)}>
        {message}
      </span>
      {linkReasons.length > 0 && (
        <div className="ml-auto flex items-center gap-2">
          {linkReasons.map((r, i) => (
            <Link
              key={`${r.text}-${i}`}
              to={r.to!}
              className={cn(
                "px-2 py-1 rounded border text-sm transition-colors cursor-pointer whitespace-nowrap",
                tone.action
              )}
            >
              {r.text} →
            </Link>
          ))}
        </div>
      )}
    </div>
  );
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
  buttonClassName,
}: {
  running: boolean;
  onStart?: () => void;
  onStop?: () => void;
  startLabel?: React.ReactNode;
  disabled?: boolean;
  fullWidth?: boolean;
  compact?: boolean;
  className?: string;
  buttonClassName?: string;
}) {
  const btnBase = compact ? `px-4 py-2 rounded border text-sm font-medium flex items-center justify-center gap-1.5 transition-all` : `px-5 py-2 rounded border text-sm font-medium flex items-center justify-center gap-1.5 transition-all shadow-sm`;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {!running ? (
        <button
          type="button"
          onClick={onStart}
          disabled={disabled}
          aria-label={typeof startLabel === "string" ? startLabel : "Start process"}
          className={cn(
            btnBase,
            fullWidth && "w-full",
            disabled
              ? "border-zinc-600 text-zinc-500 cursor-not-allowed"
              : "border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 cursor-pointer",
            buttonClassName
          )}
        >
          {startLabel ?? <><Play size={13} className="fill-current" /> Start</>}
        </button>
      ) : (
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop process"
          className={cn(
            btnBase,
            "border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 cursor-pointer",
            fullWidth && "w-full",
            buttonClassName
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
  align = "center",
  children,
}: {
  label: string;
  align?: "center" | "start";
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex gap-3 min-h-9", align === "start" ? "items-start" : "items-center")}>
      <span className={cn("text-sm font-medium text-zinc-600 dark:text-zinc-300 whitespace-nowrap flex-none w-[160px]", align === "start" && "pt-2")}>{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

// ─── WireSelect ───────────────────────────────────────────────────────────────
export function WireSelect({ placeholder, value, options, onChange, disabled, className }: { placeholder?: string; value?: string; options?: (string | { value: string; label: string })[]; onChange?: (v: string) => void; disabled?: boolean; className?: string }) {
  return (
    <select
      aria-label={placeholder ?? "Select option"}
      value={value ?? ""}
      onChange={onChange ? (e) => onChange(e.target.value) : () => {}}
      disabled={disabled}
      className={cn("w-full h-9 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-800 dark:text-zinc-200 text-sm outline-none cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 transition-all", disabled && "opacity-50 cursor-not-allowed", className)}
    >
      {placeholder && <option value="" disabled>{placeholder}</option>}
      {options?.map((o) => {
        const val = typeof o === "string" ? o : o.value;
        const label = typeof o === "string" ? o : o.label;
        return <option key={val} value={val}>{label}</option>;
      })}
    </select>
  );
}

// ─── WireInput ────────────────────────────────────────────────────────────────
export function WireInput({ placeholder, value, onChange, disabled }: { placeholder?: string; value?: string; onChange?: (v: string) => void; disabled?: boolean }) {
  const readOnly = !onChange;
  return (
    <input
      type="text"
      aria-label={placeholder ?? "Input value"}
      value={value ?? ""}
      readOnly={readOnly}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      placeholder={placeholder}
      disabled={disabled}
      className={cn("w-full h-9 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-800 dark:text-zinc-200 text-sm outline-none placeholder:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 transition-all", disabled && "opacity-50 cursor-not-allowed", readOnly && !disabled && "bg-zinc-100 dark:bg-zinc-800/80 text-zinc-500 dark:text-zinc-400 cursor-default border-transparent dark:border-transparent")}
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
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 tracking-tight">{title}</h1>
        </div>
        {subtitle && <p className="text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}


// ─── Sticky Control Bar ───────────────────────────────────────────────────────
export function StickyControlBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 mt-auto border-t border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 backdrop-blur px-6 h-12 flex items-center justify-between gap-4">
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
      <button
        type="button"
        role="switch"
        aria-label={label ?? "Toggle"}
        aria-checked={on}
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
      </button>
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
  return (
    <div className="inline-flex gap-1 bg-zinc-100 dark:bg-zinc-800/50 p-1 rounded-lg">
      {options.map((o) => (
        <button
          type="button"
          key={o}
          aria-pressed={value === o}
          aria-label={`${o} mode`}
          onClick={() => { onChange?.(o); }}
          className={cn(
            "px-3.5 py-1.5 rounded-md text-sm font-medium transition-all cursor-pointer",
            value === o
              ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
              : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

// ─── Sub Tabs ────────────────────────────────────────────────────────────────
export type SubTabItem = {
  key: string;
  label: string;
  icon?: React.ReactNode;
};

export function SubTabs({
  tabs,
  activeKey,
  onChange,
  className,
}: {
  tabs: readonly SubTabItem[];
  activeKey: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-1 bg-zinc-100 dark:bg-zinc-800/50 p-1 rounded-lg w-fit", className)}>
      {tabs.map((tab) => (
        <button
          type="button"
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            "flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-sm font-medium transition-all cursor-pointer",
            activeKey === tab.key
              ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
              : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          )}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────
export function EmptyState({
  icon,
  message,
  action,
  messageClassName,
}: {
  icon?: React.ReactNode;
  message: React.ReactNode;
  action?: React.ReactNode;
  messageClassName?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
      {icon && <div className="text-3xl opacity-30">{icon}</div>}
      <p className={cn("text-sm text-zinc-400 max-w-xs", messageClassName)}>{message}</p>
      {action}
    </div>
  );
}


// ─── Refresh Button ────────────────────────────────────────────────────────────
export function RefreshButton({
  onClick,
  title = "Refresh",
}: {
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="p-1.5 rounded-md text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all cursor-pointer"
    >
      <RefreshCw size={15} />
    </button>
  );
}

// ─── Stepper Nav ──────────────────────────────────────────────────────────────
const PIPELINE_STEPS = [
  { path: "/", label: "Status" },
  { path: "/motor-setup", label: "Motor Setup" },
  { path: "/camera-setup", label: "Camera Setup" },
  { path: "/teleop", label: "Teleop" },
  { path: "/record", label: "Record" },
  { path: "/dataset", label: "Dataset" },
  { path: "/train", label: "Train" },
  { path: "/eval", label: "Eval" },
] as const;

export function StepperNav({ currentPath }: { currentPath: string }) {
  const idx = PIPELINE_STEPS.findIndex((s) => s.path === currentPath);
  const prev = idx > 0 ? PIPELINE_STEPS[idx - 1] : null;
  const next = idx < PIPELINE_STEPS.length - 1 ? PIPELINE_STEPS[idx + 1] : null;

  const progress = 5 + (idx / (PIPELINE_STEPS.length - 1)) * 95;

  return (
    <div className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center px-6 py-2 text-sm text-zinc-400">
        {prev ? (
          <Link to={prev.path} className="inline-flex items-center gap-1 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
            ← {prev.label}
          </Link>
        ) : <div aria-hidden="true" />}

        <div className="flex items-center gap-1.5">
          {PIPELINE_STEPS.map((step, i) => {
            const isCurrent = i === idx;
            const isNeighbor = i === idx - 1 || i === idx + 1;
            return (
              <React.Fragment key={step.path}>
                {isNeighbor && i === idx - 1 && (
                  <Link to={step.path} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">{step.label}</Link>
                )}
                {isNeighbor && i === idx - 1 && <span className="text-zinc-300 dark:text-zinc-600">›</span>}
                {isCurrent && (
                  <span className="text-zinc-700 dark:text-zinc-200 font-medium">{step.label}</span>
                )}
                {isNeighbor && i === idx + 1 && <span className="text-zinc-300 dark:text-zinc-600">›</span>}
                {isNeighbor && i === idx + 1 && (
                  <Link to={step.path} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">{step.label}</Link>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {next ? (
          <Link to={next.path} className="justify-self-end inline-flex items-center gap-1 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
            {next.label} →
          </Link>
        ) : <div aria-hidden="true" />}
      </div>

      {/* 2px green progress bar */}
      <div className="h-0.5 w-full bg-zinc-200 dark:bg-zinc-800">
        <div
          className="h-full bg-emerald-500 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
