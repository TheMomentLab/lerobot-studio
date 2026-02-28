import type { DatasetListItem, LeStudioConfig } from '../../lib/types'
import type { CheckpointItem, EnvTypeItem } from '../../hooks/useEvalCheckpoint'
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
    <div className="card">
      <h3>Configuration</h3>
      <label>Policy Source</label>
      <div className="mode-toggle" style={{ marginLeft: 0, marginBottom: 8 }}>
        <button className={`toggle ${policySource === 'local' ? 'active' : ''}`} onClick={() => onSetPolicySource('local')}>Local</button>
        <button className={`toggle ${policySource === 'hf' ? 'active' : ''}`} onClick={() => onSetPolicySource('hf')}>Hugging Face</button>
      </div>

      {policySource === 'local' ? (
        <>
          <label>Checkpoint</label>
          {checkpoints.length === 0 ? <div className="field-help" style={{ marginBottom: 8, color: 'var(--yellow)' }}>No checkpoints found. Train a model first.</div> : null}
          <select
            value={(config.eval_policy_path as string) ?? ''}
            onChange={(e) => {
              const path = e.target.value
              void buildConfig({ eval_policy_path: path, eval_env_type: '', eval_task: '' })
              const cp = checkpoints.find((c) => c.path === path)
              if (cp) applyCheckpointEnv(cp)
            }}
          >
            {checkpoints.length === 0 ? <option value="">No checkpoints — train first</option> : null}
            {checkpoints.map((cp) => (
              <option key={cp.path} value={cp.path}>
                {cp.display ?? (cp.step ? `${cp.name} (step ${cp.step.toLocaleString()})` : cp.name)}
              </option>
            ))}
          </select>
          <div className="field-help">Choose from locally trained checkpoints.</div>
        </>
      ) : (
        <>
          <label>Policy Repo ID</label>
          <input
            type="text"
            value={(config.eval_policy_path as string) ?? ''}
            placeholder="e.g. lerobot/act_pusht_diffusion"
            onChange={(e) => { void buildConfig({ eval_policy_path: e.target.value }) }}
          />
          <div className="field-help">Hugging Face Hub model ID to evaluate.</div>
        </>
      )}

      <label>Episodes</label>
      <input type="number" min={1} value={totalEpisodes} onChange={(e) => { void buildConfig({ eval_episodes: Number(e.target.value) }) }} />
      <label>Compute Device</label>
      <select value={(config.eval_device as string) ?? 'cuda'} onChange={(e) => { void buildConfig({ eval_device: e.target.value }) }}>
        <option value="cuda">CUDA (GPU)</option>
        <option value="cpu">CPU</option>
        <option value="mps">MPS (Apple Silicon)</option>
      </select>

      {!preflightOk ? <div id="eval-device-warning" className="train-device-warning">{preflightReason || 'Device preflight failed. Evaluation is blocked.'}</div> : null}
      {!preflightOk && preflightAction === 'install_torch_cuda' ? (
        <div id="eval-device-actions" className="recovery-action" style={{ marginTop: 8 }}>
          <div className="field-help" style={{ marginBottom: 6 }}>Recommended next step to unblock evaluation:</div>
          <button className="btn-primary" onClick={installCudaTorch}>Install CUDA PyTorch (Nightly)</button>
        </div>
      ) : null}

      {!preflightOk && preflightCommand && preflightAction !== 'install_torch_cuda' ? (
        <div id="eval-device-actions" className="recovery-action" style={{ marginTop: 8 }}>
          <div className="field-help" style={{ marginBottom: 6 }}>
            {preflightAction === 'install_python_dep' ? 'Missing Python packages detected. Auto-install starts automatically.' : 'Recommended next step to unblock evaluation:'}
          </div>
          {preflightAction !== 'install_python_dep' ? <div className="field-help" style={{ marginBottom: 8, fontFamily: 'var(--mono)' }}>{preflightCommand}</div> : null}
          <button className="btn-primary" onClick={runPreflightFix} disabled={installing}>{installing ? 'Fix Running...' : preflightFixLabel}</button>
          {installing ? <button className="btn-sm" style={{ marginLeft: 8 }} onClick={stopInstallProcess}>Stop Fix</button> : null}
        </div>
      ) : null}

      {gymInstallCommand ? (
        <div className="recovery-action" style={{ marginTop: 8 }}>
          <div className="field-help" style={{ marginBottom: 6 }}>Environment plugin <strong>{gymModuleName}</strong> is required but not installed.</div>
          <div className="field-help" style={{ marginBottom: 8, fontFamily: 'var(--mono)' }}>{gymInstallCommand}</div>
          <button className="btn-primary" onClick={installGymPlugin} disabled={installing}>{installing ? 'Installing...' : `Install ${gymModuleName}`}</button>
          {installing ? <button className="btn-sm" style={{ marginLeft: 8 }} onClick={stopInstallProcess}>Stop Install</button> : null}
        </div>
      ) : null}

      <label>
        Env Type
        {envTypeFromCheckpoint ? <span className="dbadge" style={{ fontSize: 10, marginLeft: 4 }}>from checkpoint</span> : envTypeMissing ? <span style={{ color: 'var(--red)', fontSize: 11 }}>(required)</span> : null}
      </label>
      <select
        value={envTypeValue || envTypeFromCheckpoint || ''}
        onChange={(e) => { void buildConfig({ eval_env_type: e.target.value }) }}
        style={envTypeMissing ? { borderColor: 'var(--red)' } : undefined}
      >
        <option value="">— Select env type —</option>
        {envTypes.map((et) => (
          <option key={et.type} value={et.type}>{et.label}{et.installed ? '' : ' (not installed)'}</option>
        ))}
      </select>

      {envTypeMissing ? (
        <div className="field-help" style={{ color: 'var(--yellow)', marginBottom: 4 }}>No env metadata found. For Hugging Face or real-robot policies, select 'gym_manipulator'.</div>
      ) : (() => {
        const selected = envTypes.find((et) => et.type === (envTypeValue || envTypeFromCheckpoint))
        return selected && !selected.installed
          ? <div className="field-help" style={{ color: 'var(--yellow)', marginBottom: 4 }}><code>{selected.module}</code> is not installed. Click Install below or run: <code>{`pip install ${selected.module}`}</code></div>
          : <div className="field-help" style={{ marginBottom: 4 }}><code>{selected?.module || `gym_${envTypeValue || envTypeFromCheckpoint || '...'}`}</code> plugin will be used.</div>
      })()}

      <label>
        Task
        {envTaskFromCheckpoint ? <span className="dbadge" style={{ fontSize: 10, marginLeft: 4 }}>from checkpoint</span> : envTaskMissing ? <span style={{ color: 'var(--red)', fontSize: 11 }}>(required)</span> : null}
      </label>
      <input
        type="text"
        value={envTaskValue || envTaskFromCheckpoint || ''}
        placeholder="e.g. Pick up the block"
        onChange={(e) => { void buildConfig({ eval_task: e.target.value }) }}
        style={envTaskMissing ? { borderColor: 'var(--red)' } : undefined}
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

      <details className="advanced-panel advanced-panel-clickable" style={{ marginTop: 10 }}>
        <summary style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
            <button type="button" className="btn-xs" onClick={(e) => { e.preventDefault(); void buildConfig({ eval_repo_id: '' }) }}>Clear</button>
          ) : null}
        </summary>
        <div style={{ marginTop: 8 }}>
          <label>Dataset Source</label>
          <div className="mode-toggle" style={{ marginLeft: 0, marginBottom: 8 }}>
            <button type="button" className={`toggle ${datasetSource === 'local' ? 'active' : ''}`} onClick={() => onSetDatasetSource('local')}>Local</button>
            <button type="button" className={`toggle ${datasetSource === 'hf' ? 'active' : ''}`} onClick={() => onSetDatasetSource('hf')}>Hugging Face</button>
          </div>

          {datasetSource === 'local' ? (
            <>
              <label>Local Dataset</label>
              {datasets.length === 0 ? <div className="field-help" style={{ marginBottom: 8, color: 'var(--yellow)' }}>No local datasets found. This field is optional for eval.</div> : null}
              <select value={localDatasetId} onChange={(e) => { void buildConfig({ eval_repo_id: e.target.value === '__none__' ? '' : e.target.value }) }}>
                <option value="__none__">None (no override)</option>
                {datasets.map((ds) => <option key={ds.id} value={ds.id}>{ds.id}</option>)}
              </select>
              <div className="field-help">Optional override. Leave empty to evaluate without dataset repo override.</div>
            </>
          ) : (
            <>
              <label>Dataset Repo ID (Optional)</label>
              <input
                type="text"
                value={configuredDatasetId}
                placeholder={hfUsername ? `${hfUsername}/my-dataset` : 'username/dataset'}
                onChange={(e) => { void buildConfig({ eval_repo_id: e.target.value }) }}
                style={repoError ? { borderColor: 'var(--red)' } : undefined}
              />
              {repoError ? <div className="ep-guard-hint" style={{ marginTop: 4 }}>{repoError}</div> : null}
            </>
          )}
        </div>
      </details>
    </div>
  )
}
