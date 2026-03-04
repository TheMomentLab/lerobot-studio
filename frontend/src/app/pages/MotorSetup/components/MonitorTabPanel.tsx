import type { ComponentType } from "react";
import { AlertTriangle, Zap } from "lucide-react";
import { Card, WireSelect, WireToggle } from "../../../components/wireframe";
import type { ArmDevice, MotorData } from "../types";

interface MonitorCardProps {
  motor: MotorData;
  freewheel: boolean;
  onMove: (id: number, target: number) => void;
  onClearCollision: (id: number) => void;
  onTargetChange: (id: number, target: number) => void;
}

interface MonitorTabPanelProps {
  freewheel: boolean;
  monConnected: boolean;
  monConnecting: boolean;
  monPort: string;
  arms: ArmDevice[];
  setupRunning: boolean;
  monPortLabel: string;
  monMotors: MotorData[];
  monError: string;
  MotorCardComponent: ComponentType<MonitorCardProps>;
  onHandleFreewheelToggle: () => void;
  onHandleMonConnect: () => void;
  onHandleEmergencyStop: () => void;
  onHandleMonDisconnect: () => void;
  onSetMonPort: (port: string) => void;
  onHandleMoveMotor: (id: number, target: number) => void;
  onHandleClearCollision: (id: number) => void;
  onHandleTargetChange: (id: number, target: number) => void;
}

export function MonitorTabPanel({
  freewheel,
  monConnected,
  monConnecting,
  monPort,
  arms,
  setupRunning,
  monPortLabel,
  monMotors,
  monError,
  MotorCardComponent,
  onHandleFreewheelToggle,
  onHandleMonConnect,
  onHandleEmergencyStop,
  onHandleMonDisconnect,
  onSetMonPort,
  onHandleMoveMotor,
  onHandleClearCollision,
  onHandleTargetChange,
}: MonitorTabPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30">
          <WireToggle label="Freewheel" checked={freewheel} onChange={onHandleFreewheelToggle} />
          <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 flex-none" />
          <span className="text-sm text-zinc-500 flex-none">Port</span>
          <div className="flex-1 min-w-0">
            <WireSelect
              value={monPort}
              options={arms.length > 0 ? arms.map((a) => a.path ?? `/dev/${a.device}`) : [monPort]}
              onChange={(v) => { if (!monConnected) onSetMonPort(v); }}
            />
          </div>
          {!monConnected ? (
            <button
              onClick={onHandleMonConnect}
              disabled={monConnecting || !monPort || setupRunning}
              title={setupRunning ? "Motor Setup is running - stop it first" : ""}
              className="px-4 py-2 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 text-sm cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {monConnecting ? "Connecting..." : <><Zap size={12} className="inline mr-1" />Connect</>}
            </button>
          ) : (
            <>
              <button
                onClick={onHandleEmergencyStop}
                className="px-3 py-2 rounded-lg border border-red-500/50 bg-red-500/10 text-red-400 text-sm cursor-pointer whitespace-nowrap"
              >
                ⛔ E-Stop
              </button>
              <button
                onClick={onHandleMonDisconnect}
                className="px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 text-sm cursor-pointer whitespace-nowrap"
              >
                Disconnect
              </button>
            </>
          )}
        </div>

        {monConnected && (
          <div className="px-3 py-2 border-t border-zinc-100 dark:border-zinc-800/50 flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-sm text-zinc-400">{monPortLabel} · {monMotors.length} motors · polling 100ms</span>
          </div>
        )}
      </div>

      {monError && (
        <div className="px-3 py-2 rounded border border-red-500/30 bg-red-500/5 text-sm text-red-400">
          <AlertTriangle size={14} className="inline mr-1 shrink-0" />{monError}
        </div>
      )}

      {monConnected && freewheel && (
        <div className="px-3 py-2 rounded border border-amber-500/30 bg-amber-500/5 text-sm text-amber-400">
          <span className="block flex items-center gap-1"><AlertTriangle size={14} className="shrink-0" />Freewheel enabled</span>
          <span className="text-sm text-amber-400/60 block mt-0.5">Motor lock released. Move button disabled.</span>
        </div>
      )}

      {monConnected && monMotors.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {monMotors.map((m) => (
            <MotorCardComponent
              key={m.id}
              motor={m}
              freewheel={freewheel}
              onMove={onHandleMoveMotor}
              onClearCollision={onHandleClearCollision}
              onTargetChange={onHandleTargetChange}
            />
          ))}
        </div>
      )}

      {!monConnected && !monConnecting && (
        <Card title="Real-time Motor Status">
          <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
            <div className="text-3xl opacity-30">
              <Zap size={28} />
            </div>
            <p className="text-sm text-zinc-400">
              {setupRunning
                ? "Motor Setup is running. Stop it first."
                : "Connect to port to see motor status (100ms polling)"}
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
