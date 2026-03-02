import React, { createContext, useContext, useState, useCallback } from "react";

export type HfAuthState = "ready" | "missing_token" | "invalid_token";

type HfAuthCtx = {
  hfAuth: HfAuthState;
  cycleHfAuth: () => void;
};

const Ctx = createContext<HfAuthCtx>({ hfAuth: "ready", cycleHfAuth: () => {} });

export function HfAuthProvider({ children }: { children: React.ReactNode }) {
  const [hfAuth, setHfAuth] = useState<HfAuthState>("ready");
  const cycleHfAuth = useCallback(() => {
    setHfAuth((prev) =>
      prev === "ready"
        ? "missing_token"
        : prev === "missing_token"
          ? "invalid_token"
          : "ready"
    );
  }, []);
  return <Ctx.Provider value={{ hfAuth, cycleHfAuth }}>{children}</Ctx.Provider>;
}

export function useHfAuth() {
  return useContext(Ctx);
}
