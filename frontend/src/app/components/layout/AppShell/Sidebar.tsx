import { useState } from "react";
import { NavLink } from "react-router";
import { X, ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "../../ui/utils";
import { NAV_GROUPS } from "./constants";

export function Sidebar({ collapsed, onClose }: { collapsed: boolean; onClose?: () => void }) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    hardware: true, operate: true, data: true, ml: true,
  });

  const toggle = (id: string) =>
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <nav
      className={cn(
        "h-full flex flex-col bg-zinc-50 dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800 overflow-y-auto flex-none transition-all duration-200",
        collapsed ? "w-12" : "w-52"
      )}
    >
      {onClose && (
        <div className="flex justify-end p-2 md:hidden">
          <button onClick={onClose} className="p-1 text-zinc-400 hover:text-zinc-600">
            <X size={16} />
          </button>
        </div>
      )}

      <div className="p-2 flex flex-col gap-0.5 flex-1">
        {NAV_GROUPS.map((group, idx) => (
          <div key={group.id} className={cn("mb-1", idx > 0 && "mt-1 pt-1 border-t border-zinc-200/60 dark:border-zinc-800/60")}>
            {!collapsed && (
              <button
                onClick={() => toggle(group.id)}
                className="w-full flex items-center justify-between px-2 py-1 text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded cursor-pointer"
              >
                <span className="uppercase tracking-wider" style={{ fontSize: "10px" }}>
                  {group.label}
                </span>
                {openGroups[group.id] ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              </button>
            )}

            {(collapsed || openGroups[group.id]) && (
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      end={item.path === "/"}
                      onClick={onClose}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors",
                          collapsed ? "justify-center" : "",
                          isActive
                            ? "bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                            : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 hover:text-zinc-700 dark:hover:text-zinc-300"
                        )
                      }
                      title={collapsed ? item.label : undefined}
                    >
                      <Icon size={14} className="flex-none" />
                      {!collapsed && (
                        <span className="flex-1 truncate">{item.label}</span>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </nav>
  );
}
