import { AlertTriangle, Play, Ruler, Square, Trash2 } from "lucide-react";
import {
  Card,
  EmptyState,
  FieldRow,
  ModeToggle,
  WireInput,
  WireSelect,
} from "../../../components/wireframe";
import type { ArmDevice, CalibrationFileItem } from "../types";

interface CalibrationTabPanelProps {
  arms: ArmDevice[];
  calibrateRunning: boolean;
  calibMode: string;
  calibTypeMismatch: boolean;
  calibArmType: string;
  armTypes: string[];
  calibPortOptions: string[];
  calibPort: string;
  calibArmIdOptions: string[];
  calibArmId: string;
  calibBiType: string;
  calibBiLeftPort: string;
  calibBiRightPort: string;
  calibBiId: string;
  calibFiles: CalibrationFileItem[];
  onSetCalibMode: (value: string) => void;
  onSetCalibArmType: (value: string) => void;
  onSetCalibPort: (value: string) => void;
  onSetCalibArmId: (value: string) => void;
  onSetCalibBiType: (value: string) => void;
  onSetCalibBiLeftPort: (value: string) => void;
  onSetCalibBiRightPort: (value: string) => void;
  onSetCalibBiId: (value: string) => void;
  onHandleCalibrationStart: () => void;
  onHandleCalibrationStop: () => void;
  onHandleCalibrationDelete: (file: CalibrationFileItem) => void;
}

export function CalibrationTabPanel({
  arms,
  calibrateRunning,
  calibMode,
  calibTypeMismatch,
  calibArmType,
  armTypes,
  calibPortOptions,
  calibPort,
  calibArmIdOptions,
  calibArmId,
  calibBiType,
  calibBiLeftPort,
  calibBiRightPort,
  calibBiId,
  calibFiles,
  onSetCalibMode,
  onSetCalibArmType,
  onSetCalibPort,
  onSetCalibArmId,
  onSetCalibBiType,
  onSetCalibBiLeftPort,
  onSetCalibBiRightPort,
  onSetCalibBiId,
  onHandleCalibrationStart,
  onHandleCalibrationStop,
  onHandleCalibrationDelete,
}: CalibrationTabPanelProps) {
  return (
    <div className="flex flex-col gap-6">
      {arms.length === 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/5">
          <AlertTriangle size={13} className="text-amber-600 dark:text-amber-400 flex-none" />
          <span className="text-sm text-amber-600 dark:text-amber-400 flex-1">No connected devices. Connect USB and refresh.</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <ModeToggle options={["Single Arm", "Bi-Arm"]} value={calibMode} onChange={onSetCalibMode} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Existing Calibration Files" className="min-h-[300px]">
          {calibFiles.length === 0 ? (
            <div className="flex min-h-[220px] items-center justify-center">
              <EmptyState icon={<Ruler size={28} />} message="No calibration files." />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {calibFiles.map((file) => (
                <div key={`${file.id}-${file.guessed_type ?? "unknown"}`} className="group flex items-center gap-2 p-2 rounded border border-zinc-200 dark:border-zinc-700">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-zinc-700 dark:text-zinc-300 font-mono truncate">{file.id}</div>
                    <div className="text-xs text-zinc-400 truncate">
                      {(file.guessed_type ?? "unknown")} - {(file.modified ?? "-")}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); onHandleCalibrationDelete(file); }}
                    className="p-1 text-zinc-300 dark:text-zinc-600 hover:text-red-400 cursor-pointer"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title={calibMode === "Single Arm" ? "Single Arm Setup" : "Bi-Arm Setup"}>
          <div className="flex flex-col gap-3">
            {calibMode === "Single Arm" ? (
              <>
                {calibTypeMismatch && (
                  <div className="flex items-center gap-1.5 text-sm text-amber-400 px-1">
                    <AlertTriangle size={12} className="flex-none" />
                    Type and port do not match
                  </div>
                )}
                <FieldRow label="Arm Role Type">
                  <WireSelect value={calibArmType} options={armTypes} onChange={onSetCalibArmType} disabled={arms.length === 0} />
                </FieldRow>
                <FieldRow label="Arm Port">
                  <WireSelect
                    placeholder={calibPortOptions.length === 0 ? "No port detected" : undefined}
                    value={calibPort}
                    options={calibPortOptions}
                    onChange={onSetCalibPort}
                    disabled={arms.length === 0}
                  />
                </FieldRow>
                <FieldRow label="Arm ID">
                  <WireSelect
                    placeholder={calibArmIdOptions.length === 0 ? "No calibration files" : undefined}
                    value={calibArmId}
                    options={calibArmIdOptions}
                    onChange={onSetCalibArmId}
                    disabled={arms.length === 0}
                  />
                </FieldRow>
              </>
            ) : (
              <>
                <FieldRow label="Arm Role Type">
                  <WireSelect value={calibBiType} options={["bi_so_follower", "bi_so_leader"]} onChange={onSetCalibBiType} disabled={arms.length === 0} />
                </FieldRow>
                <FieldRow label="Left Arm Port">
                  <WireSelect
                    placeholder={calibPortOptions.length === 0 ? "No port detected" : undefined}
                    value={calibBiLeftPort}
                    options={calibPortOptions}
                    onChange={onSetCalibBiLeftPort}
                    disabled={arms.length === 0}
                  />
                </FieldRow>
                <FieldRow label="Right Arm Port">
                  <WireSelect
                    placeholder={calibPortOptions.length === 0 ? "No port detected" : undefined}
                    value={calibBiRightPort}
                    options={calibPortOptions}
                    onChange={onSetCalibBiRightPort}
                    disabled={arms.length === 0}
                  />
                </FieldRow>
                <FieldRow label="Arm ID">
                  <WireInput value={calibBiId} onChange={onSetCalibBiId} disabled={arms.length === 0} />
                </FieldRow>
              </>
            )}
          </div>
        </Card>
      </div>

      <div className="flex justify-end">
        {!calibrateRunning ? (
          <button
            type="button"
            onClick={onHandleCalibrationStart}
            disabled={calibTypeMismatch || arms.length === 0}
            className={`px-4 py-1 rounded border text-sm cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${calibTypeMismatch || arms.length === 0 ? "border-zinc-600 text-zinc-500 cursor-not-allowed" : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"}`}
          >
            <Play size={13} className="fill-current" /> Start Calibration
          </button>
        ) : (
          <button
            type="button"
            onClick={onHandleCalibrationStop}
            className="px-4 py-1 rounded border border-red-500/30 text-sm text-red-500 hover:bg-red-500/10 cursor-pointer whitespace-nowrap flex items-center gap-1.5"
          >
            <Square size={11} className="fill-current" /> Stop
          </button>
        )}
      </div>
    </div>
  );
}
