import { useCallback, useEffect, useRef, useState } from "react";
import { X, Zap } from "lucide-react";
import { createPortal } from "react-dom";
import { WireSelect } from "../../../components/wireframe";
import { apiGet, apiPost } from "../../../services/apiClient";
import { useLeStudioStore } from "../../../store";
import type { ActionResponse, ArmDevice, DeviceResponse, RulesResponse } from "../types";
import { toArmSymlink } from "../constants";

type IdentifyStep = "waiting" | "found" | "conflict";

const ARM_ROLE_OPTIONS = ["(none)", "Follower Arm 1", "Follower Arm 2", "Leader Arm 1", "Leader Arm 2"];

interface IdentifyArmModalProps {
  open: boolean;
  arms: ArmDevice[];
  onClose: () => void;
  onComplete: () => void;
}

export function IdentifyArmModal({ open, arms, onClose, onComplete }: IdentifyArmModalProps) {
  const addToast = useLeStudioStore((s) => s.addToast);

  const [step, setStep] = useState<IdentifyStep>("waiting");
  const [identifyRole, setIdentifyRole] = useState("(none)");
  const [identifySerial, setIdentifySerial] = useState("");
  const [missingSerial, setMissingSerial] = useState("");
  const [assigning, setAssigning] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const baselineSerialsRef = useRef<string[]>([]);
  const missingSerialRef = useRef("");

  // ── Cleanup polling ──────────────────────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const resetState = useCallback(() => {
    stopPolling();
    baselineSerialsRef.current = [];
    missingSerialRef.current = "";
    setStep("waiting");
    setIdentifyRole("(none)");
    setIdentifySerial("");
    setMissingSerial("");
    setAssigning(false);
  }, [stopPolling]);

  // Stable refs for callbacks used inside polling (avoids re-triggering the effect)
  const armsRef = useRef(arms);
  armsRef.current = arms;
  const addToastRef = useRef(addToast);
  addToastRef.current = addToast;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // ── Start polling on open (arms snapshot taken once at open time) ───────
  useEffect(() => {
    if (!open) {
      resetState();
      return;
    }

    // Take baseline snapshot of current arm serials at open time only
    const baselineSerials = armsRef.current
      .map((arm) => arm.serial?.trim() ?? "")
      .filter(Boolean);

    if (baselineSerials.length === 0) {
      addToastRef.current("No arm serial numbers detected. Refresh devices and try again.", "error");
      onCloseRef.current();
      return;
    }

    baselineSerialsRef.current = baselineSerials;
    missingSerialRef.current = "";
    setStep("waiting");
    setIdentifyRole("(none)");
    setIdentifySerial("");
    setMissingSerial("");

    // Start polling
    const pollIdentifyDevices = async () => {
      try {
        const res = await apiGet<DeviceResponse>("/api/devices");
        const nextArms = Array.isArray(res.arms) ? res.arms : [];
        const baseline = baselineSerialsRef.current;
        const missing = missingSerialRef.current;
        const currentSerials = nextArms
          .map((arm) => arm.serial?.trim() ?? "")
          .filter(Boolean);
        const currentSerialSet = new Set(currentSerials);
        const removedSerials = baseline.filter((s) => !currentSerialSet.has(s));
        const addedSerials = currentSerials.filter((s) => !baseline.includes(s));

        // Phase 1: detect disconnected arm
        if (!missing && removedSerials.length === 1 && addedSerials.length === 0) {
          missingSerialRef.current = removedSerials[0];
          setMissingSerial(removedSerials[0]);
          return;
        }

        // Phase 2: detect reconnection of the same arm
        if (missing && currentSerialSet.has(missing)) {
          stopPolling();
          setIdentifySerial(missing);
          setMissingSerial("");
          setStep("found");
          return;
        }

        // Conflict: multiple changes
        if (
          removedSerials.length > 1 ||
          addedSerials.length > 1 ||
          (removedSerials.length > 0 && addedSerials.length > 0)
        ) {
          stopPolling();
          missingSerialRef.current = "";
          setMissingSerial("");
          setStep("conflict");
        }
      } catch {
        // ignore transient errors
      }
    };

    void pollIdentifyDevices();
    pollRef.current = setInterval(() => {
      void pollIdentifyDevices();
    }, 1500);

    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resetState, stopPolling]);

  // ── ESC key handler ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // ── Assign handler ───────────────────────────────────────────────────────
  const handleAssign = useCallback(async () => {
    if (!identifySerial) {
      addToast("No identified arm serial is available yet.", "error");
      return;
    }

    const symlink = toArmSymlink(identifyRole);
    if (symlink === "(none)") {
      addToast("Choose a role before assigning the identified arm.", "error");
      return;
    }

    setAssigning(true);

    try {
      const currentRules = await apiGet<RulesResponse>("/api/udev/rules")
        .catch(() => apiGet<RulesResponse>("/api/rules/current"));

      // Preserve camera assignments
      const cameraAssignments: Record<string, string> = {};
      for (const rule of Array.isArray(currentRules.camera_rules) ? currentRules.camera_rules : []) {
        const kernels = (rule.kernel ?? "").trim();
        const role = (rule.symlink ?? "").trim();
        if (kernels && role && role !== "(none)") {
          cameraAssignments[kernels] = role;
        }
      }

      // Preserve existing arm rules and add/update the identified arm
      const armAssignments: Record<string, string> = {};
      for (const rule of Array.isArray(currentRules.arm_rules) ? currentRules.arm_rules : []) {
        const serial = String(rule.serial ?? "").trim();
        const role = String(rule.symlink ?? "").trim();
        if (serial && role && role !== "(none)") {
          armAssignments[serial] = role;
        }
      }
      // Clear the target role from any other arm to prevent duplicate SYMLINK
      for (const [serial, role] of Object.entries(armAssignments)) {
        if (role === symlink && serial !== identifySerial) {
          armAssignments[serial] = "(none)";
        }
      }
      armAssignments[identifySerial] = symlink;

      const result = await apiPost<ActionResponse>("/api/rules/apply", {
        assignments: cameraAssignments,
        arm_assignments: armAssignments,
      });

      if (!result.ok) {
        addToast(result.error ?? "Failed to apply identified arm mapping.", "error");
        return;
      }

      addToast(`Mapped identified arm (${identifySerial}) to ${identifyRole}.`, "success");
      onComplete();
    } catch {
      addToast("Failed to apply identified arm mapping.", "error");
    } finally {
      setAssigning(false);
    }
  }, [addToast, identifyRole, identifySerial, onComplete]);

  // ── Retry (from conflict) ────────────────────────────────────────────────
  const handleRetry = useCallback(() => {
    resetState();
    const baselineSerials = armsRef.current
      .map((arm) => arm.serial?.trim() ?? "")
      .filter(Boolean);
    baselineSerialsRef.current = baselineSerials;
    setStep("waiting");

    const pollIdentifyDevices = async () => {
      try {
        const res = await apiGet<DeviceResponse>("/api/devices");
        const nextArms = Array.isArray(res.arms) ? res.arms : [];
        const baseline = baselineSerialsRef.current;
        const missing = missingSerialRef.current;
        const currentSerials = nextArms
          .map((arm) => arm.serial?.trim() ?? "")
          .filter(Boolean);
        const currentSerialSet = new Set(currentSerials);
        const removedSerials = baseline.filter((s) => !currentSerialSet.has(s));
        const addedSerials = currentSerials.filter((s) => !baseline.includes(s));

        if (!missing && removedSerials.length === 1 && addedSerials.length === 0) {
          missingSerialRef.current = removedSerials[0];
          setMissingSerial(removedSerials[0]);
          return;
        }

        if (missing && currentSerialSet.has(missing)) {
          stopPolling();
          setIdentifySerial(missing);
          setMissingSerial("");
          setStep("found");
          return;
        }

        if (
          removedSerials.length > 1 ||
          addedSerials.length > 1 ||
          (removedSerials.length > 0 && addedSerials.length > 0)
        ) {
          stopPolling();
          missingSerialRef.current = "";
          setMissingSerial("");
          setStep("conflict");
        }
      } catch {
        // ignore
      }
    };

    void pollIdentifyDevices();
    pollRef.current = setInterval(() => {
      void pollIdentifyDevices();
    }, 1500);
  }, [resetState, stopPolling]);

  // ── Simulate (dev only) ──────────────────────────────────────────────────
  const handleSimulate = useCallback(() => {
    const simulatedSerial = armsRef.current.find((arm) => arm.serial?.trim())?.serial?.trim() ?? "";
    if (!simulatedSerial) {
      addToast("No arm serial is available to simulate identification.", "error");
      return;
    }
    stopPolling();
    setIdentifySerial(simulatedSerial);
    setStep("found");
  }, [addToast, stopPolling]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Identify Arm"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal panel */}
      <div className="relative w-full max-w-md mx-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Zap size={16} className="text-zinc-500" />
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Identify Arm</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all cursor-pointer"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5">
          {step === "waiting" && (
            <div className="flex flex-col gap-4">
              <div className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border ${missingSerial ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
                <span className={`size-2 rounded-full animate-pulse ${missingSerial ? "bg-emerald-400" : "bg-amber-400"}`} />
                <span className={`text-sm ${missingSerial ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                  {missingSerial
                    ? `Disconnected arm (${missingSerial}) detected. Reconnect it now.`
                    : "Disconnect one arm from USB, then reconnect it to identify."}
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Polling every 1.5s for device changes. Only disconnect/reconnect one arm at a time.
              </p>
            </div>
          )}

          {step === "found" && (
            <div className="flex flex-col gap-4">
              <div className="px-3 py-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
                <p className="text-sm text-emerald-600 dark:text-emerald-400 mb-1">Arm detected successfully.</p>
                {identifySerial && (
                  <p className="text-xs text-emerald-500/80 font-mono">Serial: {identifySerial}</p>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Assign Role</label>
                <WireSelect
                  value={identifyRole}
                  options={ARM_ROLE_OPTIONS}
                  onChange={setIdentifyRole}
                />
              </div>
            </div>
          )}

          {step === "conflict" && (
            <div className="flex flex-col gap-4">
              <div className="px-3 py-2.5 rounded-lg border border-red-500/30 bg-red-500/5">
                <p className="text-sm text-red-600 dark:text-red-400 mb-1">Multiple arm changes detected.</p>
                <p className="text-xs text-red-500/80">Reconnect all arms, then retry with only one arm disconnected.</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/30 rounded-b-xl">
          <div className="flex items-center gap-2">
            {import.meta.env.DEV && step === "waiting" && (
              <button
                onClick={handleSimulate}
                className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 cursor-pointer underline"
              >
                (Dev: simulate)
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step === "conflict" && (
              <button
                onClick={handleRetry}
                className="px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                Retry
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            >
              Cancel
            </button>
            {step === "found" && (
              <button
                onClick={() => { void handleAssign(); }}
                disabled={identifyRole === "(none)" || assigning}
                className="px-4 py-2 rounded-lg border border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-500/20 transition-colors"
              >
                {assigning ? "Assigning…" : "Assign"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
