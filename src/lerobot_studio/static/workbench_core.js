/* ─── State ──────────────────────────────────────────────────────────────────── */
const state = {
  devices: { cameras: [], arms: [] },
  config:  {},
  procStatus: {},
  wsReady: false,
  apiHealth: {
    resources: true,
    history: true,
  },
  apiSupport: {
    resources: true,
    history: true,
  },
};

const PROCESS_TO_LOG_ID = {
  teleop: 'teleop-log',
  record: 'record-log',
  calibrate: 'cal-log',
  motor_setup: 'ms-log',
  train: 'train-log',
  train_install: 'train-log',
  eval: 'eval-log',
};

const LOG_ID_TO_PROCESS = Object.fromEntries(
  Object.entries(PROCESS_TO_LOG_ID).map(([processName, logId]) => [logId, processName])
);

const CONSOLE_PROCESSES = ['teleop', 'record', 'calibrate', 'motor_setup', 'train', 'eval'];
const TAB_TO_PROCESS = {
  teleop: 'teleop',
  record: 'record',
  calibrate: 'calibrate',
  'motor-setup': 'motor_setup',
  train: 'train',
  eval: 'eval',
};
const SIDEBAR_ERROR_WINDOW_MS = 120000;

function normalizeProcessName(processName) {
  if (!processName) return '';
  return processName === 'train_install' ? 'train' : processName;
}

/* ─── Camera FPS capability map (per codec + resolution) ─────────────────── */
const CAMERA_FPS_MAP = {
  MJPG: { '1280x720': [30], '800x600': [30], '640x480': [30], '320x240': [30] },
  YUYV: { '1280x720': [10], '800x600': [20], '640x480': [30], '320x240': [30] },
};

function updateFpsOptions() {
  const codec = document.querySelector('.cam-codec-sync')?.value || 'MJPG';
  const res = document.querySelector('.cam-resolution-sync')?.value || '640x480';
  const fpsOptions = (CAMERA_FPS_MAP[codec] && CAMERA_FPS_MAP[codec][res]) || [30];
  document.querySelectorAll('.cam-fps-sync').forEach(sel => {
    const prev = sel.value;
    sel.innerHTML = fpsOptions.map(f => `<option value="${f}">${f}</option>`).join('');
    sel.value = fpsOptions.includes(parseInt(prev)) ? prev : String(fpsOptions[0]);
  });
}
