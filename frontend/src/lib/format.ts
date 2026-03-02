export function formatRobotType(robotType: string): string {
  const raw = String(robotType ?? '').trim()
  if (!raw) return 'Unknown'
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
