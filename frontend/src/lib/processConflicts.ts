const PROCESS_KEYS = ['teleop', 'record', 'calibrate', 'motor_setup', 'train', 'train_install', 'eval'] as const

export function getProcessConflict(
  processName: string,
  procStatus: Record<string, boolean>,
): string | null {
  for (const key of PROCESS_KEYS) {
    if (key === processName) continue
    if (processName === 'train' && key === 'train_install') continue
    if (processName === 'train_install' && key === 'train') continue
    if (procStatus[key]) return key
  }
  return null
}
