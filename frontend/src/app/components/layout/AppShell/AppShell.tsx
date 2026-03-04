import { useState, useRef, useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { HfAuthProvider } from "../../../hf-auth-context";
import { StepperNav } from "../../wireframe";
import { mapActiveTabToPath, mapPathnameToActiveTab, useLeStudioStore } from "../../../store";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { RuntimeConsoleDrawer } from "./RuntimeConsoleDrawer";

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const activeTab = useLeStudioStore((s) => s.activeTab);
  const setActiveTab = useLeStudioStore((s) => s.setActiveTab);
  const mobileSidebarOpen = useLeStudioStore((s) => s.mobileSidebarOpen);
  const setMobileSidebarOpen = useLeStudioStore((s) => s.setMobileSidebarOpen);
  const didRestoreActiveTabRef = useRef(false);

  useEffect(() => {
    const next = mapPathnameToActiveTab(location.pathname);
    setActiveTab(next);
  }, [location.pathname, setActiveTab]);

  useEffect(() => {
    if (didRestoreActiveTabRef.current) return;
    didRestoreActiveTabRef.current = true;

    const restoredPath = mapActiveTabToPath(activeTab);
    if (location.pathname === "/" && restoredPath !== "/") {
      navigate(restoredPath, { replace: true });
    }
  }, [activeTab, location.pathname, navigate]);

  return (
    <HfAuthProvider>
      <div className="h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950 overflow-hidden">
        <Header
          onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
          onMobileToggle={() => setMobileSidebarOpen(true)}
        />

        <div className="flex flex-1 overflow-hidden">
          <div className="hidden md:flex">
            <Sidebar collapsed={sidebarCollapsed} />
          </div>

          {mobileSidebarOpen && (
            <div className="md:hidden fixed inset-0 z-50 flex" data-testid="mobile-sidebar-overlay">
              <div className="absolute inset-0 bg-black/50 animate-in fade-in duration-200" onClick={() => setMobileSidebarOpen(false)} />
              <div className="relative z-10 h-full animate-in slide-in-from-left duration-200">
                <Sidebar collapsed={false} onClose={() => setMobileSidebarOpen(false)} />
              </div>
            </div>
          )}

          <main className="flex-1 overflow-y-auto">
            <StepperNav currentPath={location.pathname} />
            <Outlet />
          </main>
        </div>

        <RuntimeConsoleDrawer />
      </div>
    </HfAuthProvider>
  );
}
