import type { MotorData } from "../types";
import { LOAD_WARN, LOAD_DANGER, CURRENT_WARN, CURRENT_DANGER } from "../constants";

export function MotorCard({
  motor,
  freewheel,
  onMove,
  onClearCollision,
  onTargetChange,
}: {
  motor: MotorData;
  freewheel: boolean;
  onMove: (id: number, target: number) => void;
  onClearCollision: (id: number) => void;
  onTargetChange: (id: number, target: number) => void;
}) {
  const loadColor =
    motor.load === null ? "text-zinc-400" :
    motor.load >= LOAD_DANGER ? "text-red-400" :
    motor.load >= LOAD_WARN ? "text-amber-400" :
    "text-zinc-400";

  const currentColor =
    motor.current === null ? "text-zinc-400" :
    motor.current >= CURRENT_DANGER ? "text-red-400" :
    motor.current >= CURRENT_WARN ? "text-amber-400" :
    "text-zinc-400";

  return (
    <div className={`rounded-lg border bg-white dark:bg-zinc-900 p-3 flex flex-col gap-2 ${motor.collision ? "border-red-500/40" : "border-zinc-200 dark:border-zinc-800"}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-zinc-500">Motor #{motor.id}</span>
        {motor.collision && (
          <span className="px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            Collision
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="text-center">
          <div className="text-sm text-zinc-400 mb-0.5">POS</div>
          <div className="text-sm font-mono text-zinc-700 dark:text-zinc-300">
            {motor.pos !== null ? motor.pos : <span className="text-red-400">err</span>}
          </div>
        </div>
        <div className="text-center">
          <div className="text-sm text-zinc-400 mb-0.5">LOAD</div>
          <div className={`text-sm font-mono ${loadColor}`}>
            {motor.load !== null ? motor.load : "—"}
          </div>
        </div>
        <div className="text-center">
          <div className="text-sm text-zinc-400 mb-0.5">CURR</div>
          <div className={`text-sm font-mono ${currentColor}`}>
            {motor.current !== null ? `${motor.current}mA` : "—"}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 mt-1">
        <button
          onClick={() => onTargetChange(motor.id, Math.max(0, motor.target - 10))}
          className="size-7 flex items-center justify-center rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer text-sm"
        >
          ▼
        </button>
        <input
          type="number"
          value={motor.target}
          onChange={(e) => onTargetChange(motor.id, Math.max(0, Math.min(4095, Number(e.target.value))))}
          min={0}
          max={4095}
          className="flex-1 h-7 px-1.5 text-center text-sm font-mono rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300 outline-none focus:border-zinc-400 dark:focus:border-zinc-500"
        />
        <button
          onClick={() => onTargetChange(motor.id, Math.min(4095, motor.target + 10))}
          className="size-7 flex items-center justify-center rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer text-sm"
        >
          ▲
        </button>
        <button
          onClick={() => onMove(motor.id, motor.target)}
          disabled={freewheel || motor.collision}
          className="px-2 h-7 rounded border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          Move
        </button>
      </div>

      {motor.collision && (
        <button
          onClick={() => onClearCollision(motor.id)}
          className="text-sm text-red-400 hover:text-red-500 underline cursor-pointer"
        >
          Clear Collision
        </button>
      )}
    </div>
  );
}
