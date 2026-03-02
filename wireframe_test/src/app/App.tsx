import React, { useEffect } from "react";
import { RouterProvider } from "react-router";
import { router } from "./routes";
import { ThemeProvider } from "./theme-context";
import { Toaster } from "./components/ui/sonner";
import { requestDesktopNotificationPermission } from "./services/notifications";
import { runBootstrap, withPrefilledRepoIds } from "./services/bootstrap";
import { useLeStudioStore } from "./store";

export default function App() {
  const setConfig = useLeStudioStore((s) => s.setConfig);
  const setDevices = useLeStudioStore((s) => s.setDevices);
  const setSidebarSignals = useLeStudioStore((s) => s.setSidebarSignals);
  const setHfUsername = useLeStudioStore((s) => s.setHfUsername);
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

      const errorKeys = Object.keys(result.errors);
      if (errorKeys.length > 0) {
        addToast(`Bootstrap degraded (${errorKeys.join(", ")})`, "info");
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [addToast, setConfig, setDevices, setHfUsername, setSidebarSignals]);

  return (
    <ThemeProvider>
      <RouterProvider router={router} />
      <Toaster position="top-right" closeButton richColors />
    </ThemeProvider>
  );
}
