import { AlertCircle, Check, Circle, CornerDownLeft, Loader2, Play, RotateCcw } from "lucide-react";
import {
  BlockerCard,
  FieldRow,
  WireInput,
  WireSelect,
  WireToggle,
} from "../../../components/wireframe";
import { cn } from "../../../components/ui/utils";
import { SETUP_MOTORS } from "../constants";
import type { ArmDevice } from "../types";

type WizardMotorState = "pending" | "waiting" | "writing" | "done" | "error";

interface SetupTabPanelProps {
  wizardRunning: boolean;
  wizardAllDone: boolean;
  noPort: boolean;
  arms: ArmDevice[];
  hasConflict: boolean;
  setupArmType: string;
  armTypes: string[];
  setupPort: string;
  wizardStep: number;
  wizardMotorState: WizardMotorState[];
  wizardError: string | null;
  wizardDetectedId: string;
  wizardBaudRate: string;
  wizardConnectionConfirmed: boolean;
  onSetSetupArmType: (value: string) => void;
  onSetSetupPort: (value: string) => void;
  onHandleSetupStart: () => void;
  onSetWizardDetectedId: (value: string) => void;
  onSetWizardBaudRate: (value: string) => void;
  onSetWizardConnectionConfirmed: (value: boolean) => void;
  onWizardPressEnter: () => void;
  onWizardRetry: () => void;
  onWizardSimulateError: () => void;
  onStopWizard: () => void;
  onResetWizard: () => void;
  onSetMotorTab: (tab: string) => void;
}

export function SetupTabPanel({
  wizardRunning,
  wizardAllDone,
  noPort,
  arms,
  hasConflict,
  setupArmType,
  armTypes,
  setupPort,
  wizardStep,
  wizardMotorState,
  wizardError,
  wizardDetectedId,
  wizardBaudRate,
  wizardConnectionConfirmed,
  onSetSetupArmType,
  onSetSetupPort,
  onHandleSetupStart,
  onSetWizardDetectedId,
  onSetWizardBaudRate,
  onSetWizardConnectionConfirmed,
  onWizardPressEnter,
  onWizardRetry,
  onWizardSimulateError,
  onStopWizard,
  onResetWizard,
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
                options={noPort || arms.length === 0 ? [] : arms.map((a) => a.path ?? `/dev/${a.device}`)}
                onChange={onSetSetupPort}
              />
            </FieldRow>
            <div className="flex justify-end mt-2">
              <button
                onClick={onHandleSetupStart}
                disabled={noPort || hasConflict || arms.length === 0}
                className="px-4 py-2 rounded border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                <Play size={12} className="inline mr-1.5 fill-current" />
                Start Motor Setup
              </button>
            </div>
          </div>
        </div>
      )}

      {wizardRunning && (
        <div className="flex flex-col gap-4">
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

          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-800/50">
            {SETUP_MOTORS.map((motor, i) => {
              const state = wizardMotorState[i];
              const isCurrent = i === wizardStep && wizardRunning;
              return (
                <div
                  key={motor.name}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2.5 transition-colors",
                    isCurrent && "bg-emerald-500/5 dark:bg-emerald-500/10",
                    state === "done" && "opacity-60"
                  )}
                >
                  <div className="flex-none">
                    {state === "done" && <Check size={16} className="text-emerald-500" />}
                    {state === "writing" && <Loader2 size={16} className="text-emerald-400 animate-spin" />}
                    {state === "waiting" && <Circle size={16} className="text-emerald-400 fill-emerald-400/20" />}
                    {state === "error" && <AlertCircle size={16} className="text-red-500" />}
                    {state === "pending" && <Circle size={16} className="text-zinc-300 dark:text-zinc-600" />}
                  </div>
                  <span className={cn("text-sm font-mono flex-1", isCurrent ? "text-zinc-800 dark:text-zinc-100 font-medium" : "text-zinc-500")}>
                    {motor.name}
                  </span>
                  <span className="text-sm text-zinc-400 font-mono flex-none">ID {motor.id}</span>
                  {state === "done" && <span className="text-xs text-emerald-400 flex-none">Configured</span>}
                  {state === "writing" && <span className="text-xs text-emerald-400 flex-none">Writing EEPROM...</span>}
                  {state === "error" && <span className="text-xs text-red-500 flex-none">Failed</span>}
                </div>
              );
            })}
          </div>

          {!wizardError && wizardMotorState[wizardStep] === "waiting" && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-emerald-400 animate-pulse flex-none" />
                <p className="text-sm text-emerald-400">
                  <span className="font-medium">'{SETUP_MOTORS[wizardStep].name}'</span> motor only connected, then click below
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <FieldRow label="Detected ID">
                  <WireInput value={wizardDetectedId} onChange={onSetWizardDetectedId} placeholder="e.g., 1" />
                </FieldRow>
                <FieldRow label="Target ID">
                  <WireInput value={String(SETUP_MOTORS[wizardStep].id)} />
                </FieldRow>
                <FieldRow label="Baud Rate">
                  <WireSelect value={wizardBaudRate} options={["1000000", "2000000", "3000000"]} onChange={onSetWizardBaudRate} />
                </FieldRow>
              </div>
              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={() => onSetWizardDetectedId(String((wizardStep + 1) * 11))}
                  className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-500 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  Auto-fill detected value
                </button>
                <WireToggle label="Only current motor connected" checked={wizardConnectionConfirmed} onChange={onSetWizardConnectionConfirmed} />
              </div>
              <button
                onClick={onWizardPressEnter}
                disabled={!wizardConnectionConfirmed || !wizardDetectedId.trim()}
                className="w-full px-4 py-3 rounded-lg border border-emerald-500/50 bg-emerald-500/10 text-emerald-400 text-sm font-medium cursor-pointer hover:bg-emerald-500/20 transition-colors flex items-center justify-center gap-2"
              >
                <CornerDownLeft size={14} /> Connection Complete (Enter)
              </button>
            </div>
          )}

          {wizardMotorState[wizardStep] === "writing" && (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 flex items-center gap-3">
              <Loader2 size={16} className="text-zinc-400 animate-spin flex-none" />
              <p className="text-sm text-zinc-400">
                '{SETUP_MOTORS[wizardStep].name}' motor writing ID {SETUP_MOTORS[wizardStep].id} / Baud {wizardBaudRate}...
              </p>
            </div>
          )}

          {wizardError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2 flex items-center gap-3">
              <AlertCircle size={14} className="text-red-500 flex-none" />
              <p className="text-sm text-red-400 flex-1">{wizardError}</p>
              <button onClick={onWizardRetry} className="flex-none px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-2">
                <RotateCcw size={12} /> Retry
              </button>
            </div>
          )}

          {import.meta.env.DEV && (
            <div className="flex items-center gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
              <span className="text-xs text-zinc-400">Demo:</span>
              <button
                onClick={onWizardSimulateError}
                disabled={wizardMotorState[wizardStep] !== "waiting"}
                className="text-xs px-2 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Simulate Error
              </button>
              <button
                onClick={onStopWizard}
                className="text-xs px-2 py-0.5 rounded border border-red-500/30 text-red-500 cursor-pointer"
              >
                Stop
              </button>
            </div>
          )}
        </div>
      )}

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
              className="px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-500 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              Run Again
            </button>
            <button
              onClick={() => onSetMotorTab("monitor")}
              className="px-4 py-2 rounded-lg border border-emerald-500/50 bg-emerald-500/10 text-emerald-400 text-sm cursor-pointer"
            >
              Verify with Motor Monitor -&gt;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
