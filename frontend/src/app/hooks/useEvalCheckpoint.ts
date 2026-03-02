/**
 * useEvalCheckpoint — Fetch checkpoints + env-types from backend,
 * extract metadata (env_type, env_task, image_keys) from selected checkpoint.
 *
 * Ported from frontend_legacy/src/hooks/useEvalCheckpoint.ts
 * adapted to current frontend apiClient conventions.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet } from "../services/apiClient";
import type { LeStudioConfig } from "../store/types";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CheckpointItem {
  name: string;
  path: string;
  display?: string;
  step?: number | null;
  env_type?: string | null;
  env_task?: string | null;
  image_keys?: string[];
}

export interface EnvTypeItem {
  type: string;
  label: string;
  module: string;
  installed: boolean;
  description?: string;
}

interface UseEvalCheckpointArgs {
  active: boolean;
  policySource: "local" | "hf";
  config: LeStudioConfig;
  updateConfig: (partial: Partial<LeStudioConfig>) => void;
}

const EMPTY_IMAGE_KEYS: string[] = [];

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useEvalCheckpoint({
  active,
  policySource,
  config,
  updateConfig,
}: UseEvalCheckpointArgs) {
  const [checkpoints, setCheckpoints] = useState<CheckpointItem[]>([]);
  const [envTypes, setEnvTypes] = useState<EnvTypeItem[]>([]);

  const selectedCheckpoint = useMemo(() => {
    if (policySource !== "local") return undefined;
    const path = (config.eval_policy_path as string) ?? "";
    return checkpoints.find((cp) => cp.path === path);
  }, [checkpoints, config.eval_policy_path, policySource]);

  const envTypeFromCheckpoint = selectedCheckpoint?.env_type ?? null;
  const envTaskFromCheckpoint = selectedCheckpoint?.env_task ?? null;
  const imageKeysFromCheckpoint = selectedCheckpoint?.image_keys ?? EMPTY_IMAGE_KEYS;

  const applyCheckpointEnv = useCallback(
    (cp: CheckpointItem | undefined) => {
      if (!cp) return;
      const updates: Record<string, string> = {};
      if (cp.env_type && !(config.eval_env_type as string))
        updates.eval_env_type = cp.env_type;
      if (cp.env_task && !(config.eval_task as string))
        updates.eval_task = cp.env_task;
      if (Object.keys(updates).length > 0) updateConfig(updates);
    },
    [updateConfig, config.eval_env_type, config.eval_task],
  );

  const loadCheckpoints = useCallback(async () => {
    const res = await apiGet<{
      ok: boolean;
      checkpoints?: CheckpointItem[];
    }>("/api/checkpoints");
    const list = res.checkpoints ?? [];
    setCheckpoints(list);
    if (
      policySource === "local" &&
      !(config.eval_policy_path as string) &&
      list.length > 0
    ) {
      updateConfig({ eval_policy_path: list[0].path });
      applyCheckpointEnv(list[0]);
    }
  }, [applyCheckpointEnv, updateConfig, config.eval_policy_path, policySource]);

  const loadEnvTypes = useCallback(async () => {
    const res = await apiGet<{
      ok: boolean;
      env_types?: EnvTypeItem[];
      envs?: EnvTypeItem[];
    }>("/api/eval/env-types");
    setEnvTypes(res.env_types ?? res.envs ?? []);
  }, []);

  useEffect(() => {
    if (!active) return;
    void loadCheckpoints();
    void loadEnvTypes();
  }, [active, loadCheckpoints, loadEnvTypes]);

  return {
    checkpoints,
    envTypes,
    selectedCheckpoint,
    envTypeFromCheckpoint,
    envTaskFromCheckpoint,
    imageKeysFromCheckpoint,
    applyCheckpointEnv,
    loadCheckpoints,
    loadEnvTypes,
  };
}
