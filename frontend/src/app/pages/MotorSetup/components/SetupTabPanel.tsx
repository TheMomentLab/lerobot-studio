import { AlertCircle, Check, CornerDownLeft, Loader2, Play, RotateCcw, Square } from "lucide-react";
import {
  BlockerCard,
  FieldRow,
  WireSelect,
} from "../../../components/wireframe";
import { buttonStyles } from "../../../components/ui/button";
import { cn } from "../../../components/ui/utils";
import { SETUP_MOTORS } from "../constants";
import type { ArmDevice } from "../types";

type WizardMotorState = "pending" | "waiting" | "writing" | "done" | "error";

interface SetupTabPanelProps {
  wizardRunning: boolean;
  wizardProcessActive: boolean;
  wizardAllDone: boolean;
  noPort: boolean;
  arms: ArmDevice[];
  hasConflict: boolean;
  setupArmType: string;
  armTypes: string[];
  setupPort: string;
  portOptions: { value: string; label: string }[];
  wizardStep: number;
  wizardMotorState: WizardMotorState[];
  wizardError: string | null;
  onSetSetupArmType: (value: string) => void;
  onSetSetupPort: (value: string) => void;
  onHandleSetupStart: () => void;
  onWizardPressEnter: () => void;
  onWizardRetry: () => void;
  onWizardRestart: () => void;
  onWizardSimulateError: () => void;
  onStopWizard: () => void;
  onResetWizard: () => void;
  onExitWizard: () => void;
  onSetMotorTab: (tab: string) => void;
}

export function SetupTabPanel({
  wizardRunning,
  wizardProcessActive,
  wizardAllDone,
  noPort,
  arms,
  hasConflict,
  setupArmType,
  armTypes,
  setupPort,
  portOptions,
  wizardStep,
  wizardMotorState,
  wizardError,
  onSetSetupArmType,
  onSetSetupPort,
  onHandleSetupStart,
  onWizardPressEnter,
  onWizardRetry,
  onWizardRestart,
  onWizardSimulateError,
  onStopWizard,
  onResetWizard,
  onExitWizard,
  onSetMotorTab,
}: SetupTabPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      {!wizardRunning && !wizardAllDone && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Setup Configuration</span>
          </div>
          <div className="px-4 py-4 flex flex-col gap-3">
            {(noPort || arms.length === 0) && <BlockerCard title="Setup Blocked" reasons={["Cannot detect port. Check USB connection."]} />}
            {hasConflict && !noPort && (
              <BlockerCard
                title="Setup Blocked"
                severity="error"
                reasons={[{ text: "Teleop process is running", to: "/teleop" }]}
              />
            )}
            <FieldRow label="Arm Role Type">
              <WireSelect
                value={setupArmType}
                options={armTypes}
                onChange={onSetSetupArmType}
              />
            </FieldRow>
            <FieldRow label="Arm Port">
              <WireSelect
                placeholder={noPort || arms.length === 0 ? "No port detected" : undefined}
                value={noPort || arms.length === 0 ? "" : setupPort}
                options={noPort || arms.length === 0 ? [] : portOptions}
                onChange={onSetSetupPort}
              />
            </FieldRow>
          </div>
        </div>
      )}

      {!wizardRunning && !wizardAllDone && (
        <div className="flex justify-end">
          <button
            onClick={onHandleSetupStart}
            disabled={noPort || hasConflict || arms.length === 0}
            className={buttonStyles({
              variant: "primary",
              tone: "neutral",
              className: "h-10 px-5 whitespace-nowrap",
            })}
          >
            <Play size={12} className="inline mr-1.5 fill-current" />
            Start Motor Setup
          </button>
        </div>
      )}

      {wizardRunning && (
        <div className="flex flex-col gap-4">
          {/* ── Progress bar ── */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-500 flex-none">Progress</span>
            <div className="flex-1 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${(wizardMotorState.filter((s) => s === "done").length / SETUP_MOTORS.length) * 100}%` }}
              />
            </div>
            <span className="text-sm text-zinc-400 flex-none font-mono">
              {wizardMotorState.filter((s) => s === "done").length} / {SETUP_MOTORS.length}
            </span>
          </div>

          {/* ── Motor pills ── */}
          <div className="flex flex-wrap gap-1.5">
            {SETUP_MOTORS.map((motor, i) => {
              const state = wizardMotorState[i];
              const isCurrent = i === wizardStep && wizardRunning;
              return (
                <div
                  key={motor.name}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono border transition-colors",
                    state === "done" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
                    state === "writing" && "border-emerald-500/30 bg-emerald-500/5 text-emerald-400",
                    state === "waiting" && isCurrent && "border-emerald-400 bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-400/30",
                    state === "error" && "border-red-500/30 bg-red-500/10 text-red-400",
                    state === "pending" && "border-zinc-200 dark:border-zinc-700 text-zinc-400"
                  )}
                >
                  {state === "done" && <Check size={12} />}
                  {state === "writing" && <Loader2 size={12} className="animate-spin" />}
                  {state === "waiting" && isCurrent && <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />}
                  {state === "error" && <AlertCircle size={12} />}
                  {motor.name}
                </div>
              );
            })}
          </div>

          {/* ── Waiting: instruction + ENTER button ── */}
          {!wizardError && wizardMotorState[wizardStep] === "waiting" && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-5 flex flex-col items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-emerald-400 animate-pulse flex-none" />
                <p className="text-base text-emerald-300 font-medium">
                  Connect only <span className="text-emerald-100 font-semibold">'{SETUP_MOTORS[wizardStep].name}'</span> motor
                </p>
              </div>
              <button
                onClick={onWizardPressEnter}
                className={buttonStyles({
                  variant: "primary",
                  tone: "neutral",
                  className: "w-full max-w-xs h-12 px-5 text-sm font-semibold gap-2",
                })}
              >
                <CornerDownLeft size={18} /> Next Motor ↵
              </button>
              {!wizardProcessActive && (
                <p className="text-xs text-amber-400">
                  The motor setup process is no longer running. Check the console logs before continuing.
                </p>
              )}
            </div>
          )}

          {/* ── Writing state ── */}
          {wizardMotorState[wizardStep] === "writing" && (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 flex items-center gap-3">
              <Loader2 size={16} className="text-zinc-400 animate-spin flex-none" />
              <p className="text-sm text-zinc-400">
                '{SETUP_MOTORS[wizardStep].name}' motor write in progress. Waiting for the real process output...
              </p>
            </div>
          )}

          {/* ── Error state ── */}
          {wizardError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 flex items-start gap-3">
              <AlertCircle size={14} className="text-red-500 flex-none mt-0.5" />
              <div className="flex-1 flex flex-col gap-3">
                <p className="text-sm text-red-400">{wizardError}</p>
                {!wizardProcessActive && (
                  <p className="text-xs text-red-300/80">
                    Recovery: reconnect only the highlighted motor, then either run the setup again or go back and choose a different port/type.
                  </p>
                )}
              </div>
              <div className="flex flex-none items-center gap-2 self-center">
                {wizardProcessActive ? (
                  <button onClick={onWizardRetry} className={buttonStyles({ variant: "secondary", tone: "neutral", className: "h-auto px-3 py-1.5 text-xs gap-2" })}>
                    <RotateCcw size={12} /> Retry Step
                  </button>
                ) : (
                  <>
                    <button onClick={onExitWizard} className={buttonStyles({ variant: "secondary", tone: "neutral", className: "h-auto px-3 py-1.5 text-xs" })}>
                      Back to Setup
                    </button>
                    <button onClick={onWizardRestart} className={buttonStyles({ variant: "secondary", tone: "danger", className: "h-auto px-3 py-1.5 text-xs gap-2" })}>
                      <RotateCcw size={12} /> Run Again
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── Footer: stop / demo ── */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
            {import.meta.env.DEV && (
              <>
                <span className="mr-auto text-xs text-zinc-400">Demo:</span>
                <button
                  onClick={onWizardSimulateError}
                  disabled={wizardMotorState[wizardStep] !== "waiting"}
                  className="mr-auto text-xs px-2 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Simulate Error
                </button>
              </>
            )}
            {wizardProcessActive && (
              <button
                onClick={onStopWizard}
                className={buttonStyles({ variant: "secondary", tone: "danger", className: "h-10 px-5 whitespace-nowrap gap-1.5" })}
              >
                <Square size={11} className="fill-current" /> Stop Process
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── All done ── */}
      {!wizardRunning && wizardAllDone && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Check size={16} className="text-emerald-500" />
            <p className="text-sm text-emerald-400 font-medium">
              Motor setup complete - 6 motor IDs written to EEPROM
            </p>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {SETUP_MOTORS.map((m) => (
              <div key={m.name} className="text-center px-2 py-1.5 rounded bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
                <div className="text-xs text-zinc-400 truncate">{m.name}</div>
                <div className="text-sm font-mono text-zinc-700 dark:text-zinc-300">ID {m.id}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={onResetWizard}
              className={buttonStyles({
                variant: "secondary",
                tone: "neutral",
                className: "h-auto px-4 py-2",
              })}
            >
              Run Again
            </button>
            <button
              onClick={() => onSetMotorTab("monitor")}
              className={buttonStyles({
                variant: "primary",
                tone: "neutral",
                className: "h-10 px-5",
              })}
            >
              Verify with Motor Monitor -&gt;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
