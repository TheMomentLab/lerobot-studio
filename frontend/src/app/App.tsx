import { useEffect } from "react";
import { RouterProvider } from "react-router";
import { router } from "./routes";
import { ThemeProvider } from "./theme-context";
import { Toaster } from "./components/ui/sonner";
import { requestDesktopNotificationPermission } from "./services/notifications";
import { runBootstrap, withPrefilledRepoIds } from "./services/bootstrap";
import { apiGet } from "./services/apiClient";
import { useLeStudioStore } from "./store";

export default function App() {
  const setConfig = useLeStudioStore((s) => s.setConfig);
  const setDevices = useLeStudioStore((s) => s.setDevices);
  const setSidebarSignals = useLeStudioStore((s) => s.setSidebarSignals);
  const setHfUsername = useLeStudioStore((s) => s.setHfUsername);
  const setProcStatus = useLeStudioStore((s) => s.setProcStatus);
  const addToast = useLeStudioStore((s) => s.addToast);

  useEffect(() => {
    requestDesktopNotificationPermission();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      const result = await runBootstrap();
      if (cancelled) return;

      setConfig(withPrefilledRepoIds(result.config, result.hfUsername));
      setDevices(result.devices);
      setSidebarSignals(result.sidebarSignals);
      setHfUsername(result.hfUsername);

      const processNames = ["teleop", "record", "calibrate", "motor_setup", "train", "train_install", "eval"] as const;
      const statuses = await Promise.all(
        processNames.map(async (name) => {
          try {
            const res = await apiGet<{ running?: boolean }>(`/api/process/${name}/status`);
            return [name, Boolean(res.running)] as const;
          } catch {
            return [name, false] as const;
          }
        }),
      );
      setProcStatus(Object.fromEntries(statuses));

      const errorKeys = Object.keys(result.errors);
      if (errorKeys.length > 0) {
        addToast(`Bootstrap degraded (${errorKeys.join(", ")})`, "info");
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [addToast, setConfig, setDevices, setHfUsername, setProcStatus, setSidebarSignals]);

  return (
    <ThemeProvider>
      <RouterProvider router={router} />
      <Toaster position="top-right" closeButton richColors />
    </ThemeProvider>
  );
}
