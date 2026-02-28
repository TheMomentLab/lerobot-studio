import type { LeStudioConfig } from '../../lib/types'

interface EvalRobotConfigProps {
  visible: boolean
  config: LeStudioConfig
  buildConfig: (partial: Partial<LeStudioConfig>) => Promise<LeStudioConfig>
  imageKeysFromCheckpoint: string[]
  mappedCamEntries: [string, string][]
  cameraMapping: Record<string, string>
  setCameraMapping: React.Dispatch<React.SetStateAction<Record<string, string>>>
}

export function EvalRobotConfig({
  visible,
  config,
  buildConfig,
  imageKeysFromCheckpoint,
  mappedCamEntries,
  cameraMapping,
  setCameraMapping,
}: EvalRobotConfigProps) {
  if (!visible) return null

  const mappedCount = Object.values(cameraMapping).filter((v) => v).length
  const missingCount = Math.max(0, imageKeysFromCheckpoint.length - mappedCount)

  return (
    <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--bg2)', borderRadius: 6, border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 8, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Real Robot Config</div>
      <label style={{ fontSize: 12 }}>Robot Type</label>
      <select
        value={config.eval_robot_type || 'so101_follower'}
        onChange={(e) => { void buildConfig({ eval_robot_type: e.target.value }) }}
        style={{ marginBottom: 6 }}
      >
        <option value="so101_follower">SO-101 Follower</option>
        <option value="bi_so_follower">Bi-SO Follower (dual arm)</option>
      </select>
      <label style={{ fontSize: 12 }}>Teleop Type</label>
      <select
        value={config.eval_teleop_type || 'so101_leader'}
        onChange={(e) => { void buildConfig({ eval_teleop_type: e.target.value }) }}
      >
        <option value="so101_leader">SO-101 Leader</option>
        <option value="bi_so_leader">Bi-SO Leader (dual arm)</option>
      </select>
      <div className="field-help" style={{ marginTop: 6 }}>Uses port/ID settings from Device Setup. Robot must be connected.</div>

      {imageKeysFromCheckpoint.length > 0 ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Camera Mapping</div>
          <div className="field-help" style={{ marginBottom: 6 }}>Assign each policy camera to a mapped device. Names must match what the policy was trained on.</div>
          {imageKeysFromCheckpoint.map((imgKey) => (
            <div key={imgKey} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <code style={{ flex: '0 0 auto', fontSize: 11, minWidth: 120 }}>{imgKey}</code>
              <span style={{ fontSize: 11, color: 'var(--text2)' }}>&rarr;</span>
              <select
                style={{ flex: 1, fontSize: 12 }}
                value={cameraMapping[imgKey] ?? ''}
                onChange={(e) => setCameraMapping((prev) => ({ ...prev, [imgKey]: e.target.value }))}
              >
                <option value="">-- none --</option>
                {mappedCamEntries.map(([sym, path]) => (
                  <option key={sym} value={sym}>{sym} ({path})</option>
                ))}
              </select>
            </div>
          ))}
          {mappedCamEntries.length === 0 ? (
            <div className="field-help" style={{ color: 'var(--yellow)', marginTop: 4 }}>No mapped cameras. Set up camera mappings in Device Setup first.</div>
          ) : null}
          {imageKeysFromCheckpoint.length > 0 && mappedCamEntries.length > 0 && missingCount > 0 ? (
            <div className="field-help" style={{ color: 'var(--yellow)', marginTop: 4 }}>
              {missingCount} camera(s) not mapped. Policy may fail without all camera inputs.
            </div>
          ) : null}
        </div>
      ) : mappedCamEntries.length > 0 ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Cameras</div>
          <div className="field-help" style={{ marginBottom: 6 }}>Checkpoint has no image feature metadata. All mapped cameras will be used.</div>
          {mappedCamEntries.map(([sym, path]) => (
            <div key={sym} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <code style={{ fontSize: 11 }}>{sym}</code>
              <span style={{ fontSize: 11, color: 'var(--text2)' }}>{path}</span>
            </div>
          ))}
        </div>
      ) : null}

      <details style={{ marginTop: 8 }}>
        <summary style={{ fontSize: 11, color: 'var(--text2)', cursor: 'pointer' }}>Camera Settings</summary>
        <div className="settings-grid" style={{ marginTop: 6, gap: 6 }}>
          <div className="setting-item">
            <label style={{ fontSize: 11 }}>Resolution</label>
            <select
              style={{ fontSize: 12 }}
              value={`${config.eval_cam_width ?? config.record_cam_width ?? 640}x${config.eval_cam_height ?? config.record_cam_height ?? 480}`}
              onChange={(e) => {
                const [w, h] = e.target.value.split('x')
                void buildConfig({ eval_cam_width: Number(w), eval_cam_height: Number(h) })
              }}
            >
              <option value="1280x720">1280 × 720</option>
              <option value="640x480">640 × 480</option>
              <option value="320x240">320 × 240</option>
            </select>
          </div>
          <div className="setting-item">
            <label style={{ fontSize: 11 }}>FPS</label>
            <select
              style={{ fontSize: 12 }}
              value={String(config.eval_cam_fps ?? config.record_cam_fps ?? 30)}
              onChange={(e) => { void buildConfig({ eval_cam_fps: Number(e.target.value) }) }}
            >
              <option value="30">30</option>
              <option value="15">15</option>
              <option value="10">10</option>
            </select>
          </div>
        </div>
      </details>
    </div>
  )
}
