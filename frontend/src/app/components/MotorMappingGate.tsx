import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Loader2, RefreshCw, Unplug } from "lucide-react";
import { apiGet } from "../services/apiClient";
import { buttonStyles } from "./ui/button";

type ArmDevice = {
  device: string;
  path: string;
  symlink?: string | null;
};

type DevicesResponse = {
  arms?: ArmDevice[];
};

const ARM_SYMLINK_RE = /^(follower|leader)_arm_\d+$/i;

interface MotorMappingGateProps {
  children: React.ReactNode;
  skip?: boolean;
  onSkip?: () => void;
  skipLabel?: string;
}

export function MotorMappingGate({ children, skip, onSkip, skipLabel }: MotorMappingGateProps) {
  const [hasMappedArms, setHasMappedArms] = useState<boolean | null>(null);
  const [skippedByUser, setSkippedByUser] = useState(false);
  const [loading, setLoading] = useState(true);

  const checkMapping = useCallback(async () => {
    setLoading(true);
    try {
      const devices = await apiGet<DevicesResponse>("/api/devices");
      const arms = Array.isArray(devices.arms) ? devices.arms : [];
      const mapped = arms.some(
        (arm) => arm.symlink && ARM_SYMLINK_RE.test(arm.symlink),
      );
      setHasMappedArms(mapped);
    } catch {
      setHasMappedArms(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkMapping();
  }, [checkMapping]);

  if (skip || skippedByUser) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-zinc-400">
        <Loader2 size={20} className="animate-spin mr-2" />
        Checking arm mapping…
      </div>
    );
  }

  if (hasMappedArms) {
    return <>{children}</>;
  }

  return (
    <div className="flex flex-col items-center gap-6 py-16 px-4 max-w-lg mx-auto text-center">
      <div className="size-14 rounded-full bg-amber-500/10 flex items-center justify-center">
        <Unplug size={28} className="text-amber-500" />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200">
          Arm Mapping Required
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
          At least one follower and leader arm must be mapped before using this page.
          Go to Motor Setup to assign arm roles.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Link
          to="/motor-setup"
          className={buttonStyles({ variant: "primary", tone: "neutral" })}
        >
          Go to Motor Setup
        </Link>
        {onSkip && (
          <button
            onClick={() => { setSkippedByUser(true); onSkip(); }}
            className={buttonStyles({ variant: "secondary", tone: "neutral" })}
          >
            {skipLabel ?? "Use Simulation"}
          </button>
        )}
      </div>

      <button
        onClick={() => { void checkMapping(); }}
        disabled={loading}
        className={buttonStyles({ variant: "ghost", tone: "neutral", size: "sm" })}
      >
        <RefreshCw size={14} />
        Refresh Status
      </button>
    </div>
  );
}
