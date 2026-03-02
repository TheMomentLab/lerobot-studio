interface MappedCameraRowsProps {
  mappedCameras: Record<string, string>
}

export function MappedCameraRows({ mappedCameras }: MappedCameraRowsProps) {
  const entries = Object.entries(mappedCameras)
  if (!entries.length) {
    return (
      <div className="no-cameras-empty">
        <div className="no-cam-text">
          No mapped cameras found.
          <br />
          Set up camera mappings in the Mapping tab first.
        </div>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {entries.map(([role, path]) => (
        <div className="mapped-cam-row" key={role}>
          <div className="mapped-cam-role">{role}</div>
          <div className="mapped-cam-path">{path}</div>
        </div>
      ))}
    </div>
  )
}
