import type { DatasetListItem, LeStudioConfig } from '../../lib/types'
import type { CheckpointItem, EnvTypeItem } from '../../hooks/useEvalCheckpoint'
import { Accordion, Button, NativeSelect, NumberInput, Paper, Text, TextInput } from '@mantine/core'
import { EvalRobotConfig } from './EvalRobotConfig'

interface EvalConfigPanelProps {
  policySource: 'local' | 'hf'
  onSetPolicySource: (source: 'local' | 'hf') => void
  checkpoints: CheckpointItem[]
  config: LeStudioConfig
  buildConfig: (partial: Partial<LeStudioConfig>) => Promise<LeStudioConfig>
  applyCheckpointEnv: (cp: CheckpointItem | undefined) => void
  totalEpisodes: number
  preflightOk: boolean
  preflightReason: string
  preflightAction: string
  preflightCommand: string
  preflightFixLabel: string
  installCudaTorch: () => void
  runPreflightFix: () => void
  installing: boolean
  stopInstallProcess: () => void
  gymInstallCommand: string
  gymModuleName: string
  installGymPlugin: () => void
  envTypeFromCheckpoint: string | null
  envTaskFromCheckpoint: string | null
  envTypeValue: string
  envTaskValue: string
  envTypeMissing: boolean
  envTaskMissing: boolean
  envTypes: EnvTypeItem[]
  imageKeysFromCheckpoint: string[]
  mappedCamEntries: [string, string][]
  cameraMapping: Record<string, string>
  setCameraMapping: React.Dispatch<React.SetStateAction<Record<string, string>>>
  datasetOverrideActive: boolean
  datasetSource: 'local' | 'hf'
  onSetDatasetSource: (source: 'local' | 'hf') => void
  datasets: DatasetListItem[]
  localDatasetId: string
  configuredDatasetId: string
  repoError: string
  hfUsername: string | null
}

export function EvalConfigPanel({
  policySource,
  onSetPolicySource,
  checkpoints,
  config,
  buildConfig,
  applyCheckpointEnv,
  totalEpisodes,
  preflightOk,
  preflightReason,
  preflightAction,
  preflightCommand,
  preflightFixLabel,
  installCudaTorch,
  runPreflightFix,
  installing,
  stopInstallProcess,
  gymInstallCommand,
  gymModuleName,
  installGymPlugin,
  envTypeFromCheckpoint,
  envTaskFromCheckpoint,
  envTypeValue,
  envTaskValue,
  envTypeMissing,
  envTaskMissing,
  envTypes,
  imageKeysFromCheckpoint,
  mappedCamEntries,
  cameraMapping,
  setCameraMapping,
  datasetOverrideActive,
  datasetSource,
  onSetDatasetSource,
  datasets,
  localDatasetId,
  configuredDatasetId,
  repoError,
  hfUsername,
}: EvalConfigPanelProps) {
  return (
    <Paper withBorder p="md" mb="md" className="card">
      <Text size="sm" fw={600} c="dimmed" mb="xs">Configuration</Text>
      <Text size="xs" c="dimmed" mt="xs" mb={4} style={{ display: 'block' }}>Policy Source</Text>
      <div className="mode-toggle" style={{ marginLeft: 0, marginBottom: 8 }}>
        <Button variant={policySource === 'local' ? 'light' : 'default'} onClick={() => onSetPolicySource('local')}>Local</Button>
        <Button variant={policySource === 'hf' ? 'light' : 'default'} onClick={() => onSetPolicySource('hf')}>Hugging Face</Button>
      </div>

      {policySource === 'local' ? (
        <>
          <NativeSelect
            label="Checkpoint"
            value={config.eval_policy_path ?? ''}
            onChange={(e) => {
              const path = e.target.value
              void buildConfig({ eval_policy_path: path, eval_env_type: '', eval_task: '' })
              const cp = checkpoints.find((c) => c.path === path)
              if (cp) applyCheckpointEnv(cp)
            }}
            data={checkpoints.length === 0
              ? [{ value: '', label: 'No checkpoints — train first' }]
              : checkpoints.map((cp) => ({
                value: cp.path,
                label: cp.display ?? (cp.step ? `${cp.name} (step ${cp.step.toLocaleString()})` : cp.name),
              }))
            }
          />
          <div className="field-help">Choose from locally trained checkpoints.</div>
        </>
      ) : (
        <>
          <TextInput
            label="Policy Repo ID"
            value={config.eval_policy_path ?? ''}
            placeholder="e.g. lerobot/act_pusht_diffusion"
            onChange={(e) => { void buildConfig({ eval_policy_path: e.target.value }) }}
          />
        </>
      )}

      <NumberInput label="Episodes" min={1} value={totalEpisodes} onChange={(value) => { void buildConfig({ eval_episodes: Number(value) }) }} mt="xs" />
      <NativeSelect
        label="Compute Device"
        value={config.eval_device ?? 'cuda'}
        onChange={(e) => { void buildConfig({ eval_device: e.target.value }) }}
        data={[
          { value: 'cuda', label: 'CUDA (GPU)' },
          { value: 'cpu', label: 'CPU' },
          { value: 'mps', label: 'MPS (Apple Silicon)' },
        ]}
        mt="xs"
      />

      {!preflightOk ? <div id="eval-device-warning" className="train-device-warning">{preflightReason || 'Device preflight failed. Evaluation is blocked.'}</div> : null}
      {!preflightOk && preflightAction === 'install_torch_cuda' ? (
        <div id="eval-device-actions" className="recovery-action" style={{ marginTop: 8 }}>
          <div className="field-help" style={{ marginBottom: 6 }}>Recommended next step to unblock evaluation:</div>
          <Button variant="filled" onClick={installCudaTorch}>Install CUDA PyTorch (Nightly)</Button>
        </div>
      ) : null}

      {!preflightOk && preflightCommand && preflightAction !== 'install_torch_cuda' ? (
        <div id="eval-device-actions" className="recovery-action" style={{ marginTop: 8 }}>
          <div className="field-help" style={{ marginBottom: 6 }}>
            {preflightAction === 'install_python_dep' ? 'Missing Python packages detected. Auto-install starts automatically.' : 'Recommended next step to unblock evaluation:'}
          </div>
          {preflightAction !== 'install_python_dep' ? <div className="field-help" style={{ marginBottom: 8, fontFamily: 'var(--mono)' }}>{preflightCommand}</div> : null}
          <Button variant="filled" onClick={runPreflightFix} disabled={installing}>{installing ? 'Fix Running...' : preflightFixLabel}</Button>
          {installing ? <Button variant="default" size="sm" style={{ marginLeft: 8 }} onClick={stopInstallProcess}>Stop Fix</Button> : null}
        </div>
      ) : null}

      {gymInstallCommand ? (
        <div className="recovery-action" style={{ marginTop: 8 }}>
          <div className="field-help" style={{ marginBottom: 6 }}>Environment plugin <strong>{gymModuleName}</strong> is required but not installed.</div>
          <div className="field-help" style={{ marginBottom: 8, fontFamily: 'var(--mono)' }}>{gymInstallCommand}</div>
          <Button variant="filled" onClick={installGymPlugin} disabled={installing}>{installing ? 'Installing...' : `Install ${gymModuleName}`}</Button>
          {installing ? <Button variant="default" size="sm" style={{ marginLeft: 8 }} onClick={stopInstallProcess}>Stop Install</Button> : null}
        </div>
      ) : null}

      <NativeSelect
        label={<>Env Type{envTypeFromCheckpoint ? <span className="dbadge" style={{ fontSize: 10, marginLeft: 4 }}>from checkpoint</span> : envTypeMissing ? <span style={{ color: 'var(--red)', fontSize: 11 }}> (required)</span> : null}</>}
        value={envTypeValue || envTypeFromCheckpoint || ''}
        onChange={(e) => { void buildConfig({ eval_env_type: e.target.value }) }}
        styles={envTypeMissing ? { input: { borderColor: 'var(--red)' } } : undefined}
        mt="xs"
        data={[
          { value: '', label: '— Select env type —' },
          ...envTypes.map((et) => ({ value: et.type, label: `${et.label}${et.installed ? '' : ' (not installed)'}` }))
        ]}
      />

      {envTypeMissing ? (
        <div className="field-help" style={{ color: 'var(--yellow)', marginBottom: 4 }}>No env metadata found. For Hugging Face or real-robot policies, select 'gym_manipulator'.</div>
      ) : (() => {
        const selected = envTypes.find((et) => et.type === (envTypeValue || envTypeFromCheckpoint))
        return selected && !selected.installed
          ? <div className="field-help" style={{ color: 'var(--yellow)', marginBottom: 4 }}><code>{selected.module}</code> is not installed. Click Install below or run: <code>{`pip install ${selected.module}`}</code></div>
          : <div className="field-help" style={{ marginBottom: 4 }}><code>{selected?.module || `gym_${envTypeValue || envTypeFromCheckpoint || '...'}`}</code> plugin will be used.</div>
      })()}

      <TextInput
        label={<>Task{envTaskFromCheckpoint ? <span className="dbadge" style={{ fontSize: 10, marginLeft: 4 }}>from checkpoint</span> : envTaskMissing ? <span style={{ color: 'var(--red)', fontSize: 11 }}> (required)</span> : null}</>}
        value={envTaskValue || envTaskFromCheckpoint || ''}
        placeholder="e.g. Pick up the block"
        onChange={(e) => { void buildConfig({ eval_task: e.target.value }) }}
        styles={envTaskMissing ? { input: { borderColor: 'var(--red)' } } : undefined}
        mt="xs"
      />
      {envTaskMissing ? <div className="field-help" style={{ color: 'var(--yellow)', marginBottom: 4 }}>Checkpoint has no task metadata. Describe the evaluation task.</div> : null}

      <EvalRobotConfig
        visible={(envTypeValue || envTypeFromCheckpoint) === 'gym_manipulator'}
        config={config}
        buildConfig={buildConfig}
        imageKeysFromCheckpoint={imageKeysFromCheckpoint}
        mappedCamEntries={mappedCamEntries}
        cameraMapping={cameraMapping}
        setCameraMapping={setCameraMapping}
      />

      <Accordion variant="contained" className="advanced-panel" style={{ marginTop: 10 }}>
        <Accordion.Item value="advanced">
          <Accordion.Control style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1 }}>Advanced Overrides</span>
            <span
              className="dbadge"
              style={{
                background: datasetOverrideActive ? 'rgba(34,197,94,0.18)' : 'rgba(148,163,184,0.18)',
                color: datasetOverrideActive ? '#86efac' : 'var(--text2)',
              }}
            >
              {datasetOverrideActive ? 'Dataset override ON' : 'Dataset override OFF'}
            </span>
            {datasetOverrideActive ? (
              <Button
                type="button"
                variant="subtle"
                size="compact-xs"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); void buildConfig({ eval_repo_id: '' }) }}
              >
                Clear
              </Button>
            ) : null}
          </Accordion.Control>
          <Accordion.Panel>
            <div style={{ marginTop: 8 }}>
          <Text size="xs" c="dimmed" mb={4} style={{ display: 'block' }}>Dataset Source</Text>
          <div className="mode-toggle" style={{ marginLeft: 0, marginBottom: 8 }}>
            <Button type="button" variant={datasetSource === 'local' ? 'light' : 'default'} onClick={() => onSetDatasetSource('local')}>Local</Button>
            <Button type="button" variant={datasetSource === 'hf' ? 'light' : 'default'} onClick={() => onSetDatasetSource('hf')}>Hugging Face</Button>
          </div>

          {datasetSource === 'local' ? (
            <>
              <NativeSelect
                label="Local Dataset"
                value={localDatasetId}
                onChange={(e) => { void buildConfig({ eval_repo_id: e.target.value === '__none__' ? '' : e.target.value }) }}
                data={[
                  { value: '__none__', label: 'None (no override)' },
                  ...datasets.map((ds) => ({ value: ds.id, label: ds.id })),
                ]}
              />
              <div className="field-help">Optional override. Leave empty to evaluate without dataset repo override.</div>
            </>
          ) : (
            <>
              <TextInput
                label="Dataset Repo ID (Optional)"
                value={configuredDatasetId}
                placeholder={hfUsername ? `${hfUsername}/my-dataset` : 'username/dataset'}
                onChange={(e) => { void buildConfig({ eval_repo_id: e.target.value }) }}
                styles={repoError ? { input: { borderColor: 'var(--red)' } } : undefined}
              />
              {repoError ? <div className="ep-guard-hint" style={{ marginTop: 4 }}>{repoError}</div> : null}
            </>
          )}
            </div>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Paper>
  )
}
