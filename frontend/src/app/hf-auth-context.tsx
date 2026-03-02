import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { apiGet } from "./services/apiClient";
import { useLeStudioStore } from "./store";

export type HfAuthState = "ready" | "missing_token" | "expired_token" | "invalid_token";

type HfAuthCtx = {
  hfAuth: HfAuthState;
  refreshHfAuth: () => Promise<void>;
};

const Ctx = createContext<HfAuthCtx>({ hfAuth: "missing_token", refreshHfAuth: async () => {} });

type HfWhoamiResponse = {
  ok?: boolean;
  username?: string | null;
  error?: "no_token" | "no_username" | "huggingface_hub_not_installed" | "expired_token" | "invalid_token" | "network_error" | "auth_failed" | string;
};

type HfTokenStatusResponse = {
  ok?: boolean;
  has_token?: boolean;
};

export function HfAuthProvider({ children }: { children: React.ReactNode }) {
  const hfUsername = useLeStudioStore((s) => s.hfUsername);
  const setHfUsername = useLeStudioStore((s) => s.setHfUsername);
  const [hfAuth, setHfAuth] = useState<HfAuthState>(hfUsername ? "ready" : "missing_token");

  const refreshHfAuth = useCallback(async () => {
    const [whoamiResult, tokenResult] = await Promise.allSettled([
      apiGet<HfWhoamiResponse>("/api/hf/whoami"),
      apiGet<HfTokenStatusResponse>("/api/hf/token/status"),
    ]);

    const whoami = whoamiResult.status === "fulfilled" ? whoamiResult.value : null;
    const tokenStatus = tokenResult.status === "fulfilled" ? tokenResult.value : null;
    const username = typeof whoami?.username === "string" && whoami.username.trim() ? whoami.username : null;

    if (whoami?.ok === true && username) {
      setHfUsername(username);
      setHfAuth("ready");
      return;
    }

    setHfUsername(null);

    const explicitNoToken = whoami?.error === "no_token";
    const tokenStatusKnown = tokenResult.status === "fulfilled";
    const hasToken = tokenStatus?.has_token === true;

    if (explicitNoToken || (tokenStatusKnown && !hasToken)) {
      setHfAuth("missing_token");
      return;
    }

    if (whoami?.error === "expired_token") {
      setHfAuth("expired_token");
      return;
    }

    if (whoami?.error === "invalid_token") {
      setHfAuth("invalid_token");
      return;
    }

    if (whoami?.error === "auth_failed" && tokenStatusKnown && hasToken) {
      setHfAuth("invalid_token");
      return;
    }

    if (tokenStatusKnown && hasToken) {
      setHfAuth("ready");
      return;
    }

    setHfAuth((prev) => (prev === "missing_token" ? "missing_token" : "ready"));
  }, [setHfUsername]);

  useEffect(() => {
    void refreshHfAuth();
  }, [refreshHfAuth]);

  return <Ctx.Provider value={{ hfAuth, refreshHfAuth }}>{children}</Ctx.Provider>;
}

export function useHfAuth() {
  return useContext(Ctx);
}
