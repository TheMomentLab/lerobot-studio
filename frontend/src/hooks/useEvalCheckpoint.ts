import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiGet } from '../lib/api'
import type { LeStudioConfig } from '../lib/types'

export interface CheckpointItem {
  name: string
  path: string
  display?: string
  step?: number | null
  env_type?: string | null
  env_task?: string | null
  image_keys?: string[]
}

export interface EnvTypeItem {
  type: string
  label: string
  module: string
  installed: boolean
}

interface UseEvalCheckpointArgs {
  active: boolean
  policySource: 'local' | 'hf'
  config: LeStudioConfig
  buildConfig: (partial: Partial<LeStudioConfig>) => Promise<LeStudioConfig>
}

export function useEvalCheckpoint({ active, policySource, config, buildConfig }: UseEvalCheckpointArgs) {
  const [checkpoints, setCheckpoints] = useState<CheckpointItem[]>([])
  const [envTypes, setEnvTypes] = useState<EnvTypeItem[]>([])

  const selectedCheckpoint = useMemo(() => {
    if (policySource !== 'local') return undefined
    const path = (config.eval_policy_path as string) ?? ''
    return checkpoints.find((cp) => cp.path === path)
  }, [checkpoints, config.eval_policy_path, policySource])

  const envTypeFromCheckpoint = selectedCheckpoint?.env_type ?? null
  const envTaskFromCheckpoint = selectedCheckpoint?.env_task ?? null
  const imageKeysFromCheckpoint = selectedCheckpoint?.image_keys ?? []

  const applyCheckpointEnv = useCallback((cp: CheckpointItem | undefined) => {
    if (!cp) return
    const updates: Record<string, string> = {}
    if (cp.env_type && !(config.eval_env_type as string)) updates.eval_env_type = cp.env_type
    if (cp.env_task && !(config.eval_task as string)) updates.eval_task = cp.env_task
    if (Object.keys(updates).length > 0) void buildConfig(updates)
  }, [buildConfig, config.eval_env_type, config.eval_task])

  const loadCheckpoints = useCallback(async () => {
    const res = await apiGet<{ ok: boolean; checkpoints: CheckpointItem[] }>('/api/checkpoints')
    if (!res.ok) return
    const list = res.checkpoints ?? []
    setCheckpoints(list)
    if (policySource === 'local' && !(config.eval_policy_path as string) && list.length > 0) {
      void buildConfig({ eval_policy_path: list[0].path })
      applyCheckpointEnv(list[0])
    }
  }, [applyCheckpointEnv, buildConfig, config.eval_policy_path, policySource])

  const loadEnvTypes = useCallback(async () => {
    const res = await apiGet<{ ok: boolean; env_types: EnvTypeItem[] }>('/api/eval/env-types')
    if (res.ok) setEnvTypes(res.env_types ?? [])
  }, [])

  useEffect(() => {
    if (!active) return
    void loadCheckpoints()
    void loadEnvTypes()
  }, [active, loadCheckpoints, loadEnvTypes])

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
  }
}
