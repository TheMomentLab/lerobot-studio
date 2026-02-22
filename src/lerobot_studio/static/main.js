/* ─── State ──────────────────────────────────────────────────────────────────── */
const state = {
  devices: { cameras: [], arms: [] },
  config:  {},
  procStatus: {},
  wsReady: false,
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

/* ─── API helpers ────────────────────────────────────────────────────────────── */
const MotorTable = {
  data: {},
  update(process, name, min, pos, max) {
    if (process !== 'calibrate') return;

    const placeholder = document.getElementById('cal-motor-placeholder');
    if (placeholder && placeholder.style.display !== 'none') {
      placeholder.style.display = 'none';
    }

    const list = document.getElementById('cal-motor-list');

    if (!this.data[name]) {
      this.data[name] = true;
      const row = document.createElement('div');
      row.className = 'motor-row';
      row.id = `motor-row-${name}`;
      row.innerHTML = `
        <div class="motor-name">${name}</div>
        <div class="motor-track-wrap">
          <div class="motor-track">
            <div class="motor-range" id="motor-range-${name}"></div>
            <div class="motor-pos" id="motor-pos-${name}"></div>
          </div>
        </div>
        <div class="motor-vals">
          <div><span class="lbl">MIN</span><span class="val-min" id="motor-vmin-${name}"></span></div>
          <div><span class="lbl">POS</span><span class="val-pos" id="motor-vpos-${name}"></span></div>
          <div><span class="lbl">MAX</span><span class="val-max" id="motor-vmax-${name}"></span></div>
        </div>
      `;
      list.appendChild(row);
    }

    document.getElementById(`motor-vmin-${name}`).textContent = min;
    document.getElementById(`motor-vpos-${name}`).textContent = pos;
    document.getElementById(`motor-vmax-${name}`).textContent = max;

    const maxVal = 4095;
    const clamp = (v) => Math.max(0, Math.min(maxVal, v));
    const cMin = clamp(min), cPos = clamp(pos), cMax = clamp(max);

    const rangeEl = document.getElementById(`motor-range-${name}`);
    const posEl = document.getElementById(`motor-pos-${name}`);

    const leftPct = (cMin / maxVal) * 100;
    const widthPct = Math.max(0, ((cMax - cMin) / maxVal) * 100);
    const posPct = (cPos / maxVal) * 100;

    rangeEl.style.left = leftPct + '%';
    rangeEl.style.width = widthPct + '%';
    posEl.style.left = posPct + '%';
  },
  clear() {
    this.data = {};
    const placeholder = document.getElementById('cal-motor-placeholder');
    if (placeholder) placeholder.style.display = 'flex';
    const list = document.getElementById('cal-motor-list');
    if (list) list.innerHTML = '';
  }
};

const api = {
  async get(path) {
    const r = await fetch(path);
    return r.json();
  },
  async post(path, body = {}) {
    const r = await fetch(path, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    return r.json();
  },
};

const NotificationManager = {
  permissionAsked: false,
  cooldownMs: 5000,
  lastSent: new Map(),

  async ensurePermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted' || Notification.permission === 'denied') return;
    if (this.permissionAsked) return;
    this.permissionAsked = true;
    try {
      await Notification.requestPermission();
    } catch (_) {}
  },

  notify(title, body, tag = '') {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    const key = `${title}|${body}|${tag}`;
    const now = Date.now();
    const prev = this.lastSent.get(key) || 0;
    if (now - prev < this.cooldownMs) return;
    this.lastSent.set(key, now);
    try {
      const n = new Notification(title, { body, tag: tag || undefined, silent: false });
      n.onclick = () => window.focus();
    } catch (_) {}
  },
};

const GlobalConsole = {
  buffers: {},
  maxLines: 1200,

  init() {
    CONSOLE_PROCESSES.forEach((p) => this._ensureBuffer(p));
    const sel = document.getElementById('console-process-select');
    if (sel) {
      sel.addEventListener('change', () => {
        this.renderCurrent();
        this.updateInputPlaceholder();
        this.syncStatus(state.procStatus);
      });
    }
    const input = document.getElementById('console-stdin');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.sendInput();
      });
    }
    this.renderCurrent();
    this.updateInputPlaceholder();
    this.syncStatus(state.procStatus);
  },

  currentProcess() {
    const sel = document.getElementById('console-process-select');
    return normalizeProcessName(sel?.value || 'teleop');
  },

  updateInputPlaceholder() {
    const input = document.getElementById('console-stdin');
    if (!input) return;
    input.placeholder = `Send input to ${this.currentProcess()} process`;
  },

  _ensureBuffer(processName) {
    const key = normalizeProcessName(processName);
    if (!this.buffers[key]) this.buffers[key] = [];
    return this.buffers[key];
  },

  _appendLine(el, text, kind = 'stdout') {
    const line = document.createElement('div');
    line.className = `line-${kind}`;
    line.textContent = text;
    el.appendChild(line);
  },

  _renderProcess(processName) {
    const el = document.getElementById('console-log');
    if (!el) return;
    el.innerHTML = '';
    const key = normalizeProcessName(processName);
    const lines = this._ensureBuffer(key);
    lines.forEach((entry) => this._appendLine(el, entry.text, entry.kind));
    el.scrollTop = el.scrollHeight;
  },

  renderCurrent() {
    this._renderProcess(this.currentProcess());
  },

  append(processName, text, kind = 'stdout') {
    const key = normalizeProcessName(processName);
    if (!key) return;
    const lines = this._ensureBuffer(key);
    if (kind === 'translation') {
      const last = lines[lines.length - 1];
      if (last && last.kind === 'translation' && last.text === text) return;
    }
    lines.push({ text, kind });
    if (lines.length > this.maxLines) lines.splice(0, lines.length - this.maxLines);

    if (this.currentProcess() !== key) return;
    const el = document.getElementById('console-log');
    if (!el) return;
    if (kind === 'translation') {
      const last = el.lastElementChild;
      if (last && last.classList.contains('line-translation') && last.textContent === text) return;
    }
    this._appendLine(el, text, kind);
    el.scrollTop = el.scrollHeight;
  },

  clearProcess(processName) {
    const key = normalizeProcessName(processName);
    if (!key) return;
    this.buffers[key] = [];
    if (this.currentProcess() === key) {
      const el = document.getElementById('console-log');
      if (el) el.innerHTML = '';
    }
  },

  clearCurrent() {
    this.clearProcess(this.currentProcess());
  },

  async sendInput() {
    const processName = this.currentProcess();
    const input = document.getElementById('console-stdin');
    if (!input) return;
    const text = input.value ?? '';
    try {
      await api.post(`/api/process/${processName}/input`, { text });
      this.append(processName, text === '' ? '> [ENTER]' : `> ${text}`, 'info');
      input.value = '';
    } catch (e) {
      const msg = e?.message || String(e);
      this.append(processName, `[ERROR] Failed to send input: ${msg}`, 'error');
    }
  },

  syncStatus(procs) {
    const badge = document.getElementById('console-process-state');
    if (!badge) return;
    const processName = this.currentProcess();
    const running = processName === 'train'
      ? !!(procs?.train || procs?.train_install)
      : !!procs?.[processName];
    badge.textContent = running ? 'RUNNING' : 'IDLE';
    badge.className = `dbadge ${running ? 'badge-run' : 'badge-idle'}`;
  },

  syncProcessFromTab(tabName) {
    const processName = TAB_TO_PROCESS[tabName];
    if (!processName) return;
    const sel = document.getElementById('console-process-select');
    if (!sel) return;
    if (sel.value !== processName) sel.value = processName;
    this.renderCurrent();
    this.updateInputPlaceholder();
    this.syncStatus(state.procStatus);
  },
};

const SidebarNav = {
  _isRunning(processName, procs) {
    const key = normalizeProcessName(processName);
    if (!key) return false;
    if (key === 'train') return !!(procs?.train || procs?.train_install);
    return !!procs?.[key];
  },

  _hasRecentError(processName) {
    const key = normalizeProcessName(processName);
    if (!key) return false;
    const now = Date.now();
    const primary = WS.lastErrorAtByProcess[key] || 0;
    const trainInstall = key === 'train' ? (WS.lastErrorAtByProcess.train_install || 0) : 0;
    const lastErrAt = Math.max(primary, trainInstall);
    return now - lastErrAt < SIDEBAR_ERROR_WINDOW_MS;
  },

  _setBadgeState(btn, stateName) {
    const badge = btn.querySelector('.tab-state-badge');
    btn.classList.remove(
      'has-running',
      'has-error',
      'has-needs-root',
      'has-needs-udev',
      'has-missing-dep',
      'has-needs-device'
    );

    const stateMap = {
      running: { className: 'has-running', label: 'RUNNING' },
      error: { className: 'has-error', label: 'ERROR' },
      needs_root: { className: 'has-needs-root', label: 'NEEDS_ROOT' },
      needs_udev: { className: 'has-needs-udev', label: 'UDEV_SETUP' },
      missing_dep: { className: 'has-missing-dep', label: 'MISSING_DEP' },
      needs_device: { className: 'has-needs-device', label: 'NEEDS_DEVICE' },
    };
    const target = stateMap[stateName];
    if (!target) {
      if (badge) badge.textContent = '';
      return;
    }
    btn.classList.add(target.className);
    if (badge) badge.textContent = target.label;
  },

  syncBadges(procs = state.procStatus) {
    document.querySelectorAll('#sidebar-nav .tab-btn').forEach((btn) => {
      const tabName = btn.dataset.tab || '';
      const processName = btn.dataset.proc || '';
      const running = this._isRunning(processName, procs);
      const hasError = !running && this._hasRecentError(processName);
      let nextState = '';
      if (running) {
        nextState = 'running';
      } else if (hasError) {
        nextState = 'error';
      } else {
        nextState = SidebarSignals.getHealthState(tabName);
      }
      this._setBadgeState(btn, nextState);
    });
  },

  isMobileLayout() {
    return window.matchMedia('(max-width: 799px)').matches;
  },

  toggleDrawer() {
    const app = document.getElementById('app');
    if (!app || !this.isMobileLayout()) return;
    app.classList.toggle('sidebar-open');
  },

  closeDrawer() {
    document.getElementById('app')?.classList.remove('sidebar-open');
  },

  onTabActivated() {
    if (this.isMobileLayout()) this.closeDrawer();
  },

  init() {
    const backdrop = document.getElementById('sidebar-backdrop');
    if (backdrop) backdrop.addEventListener('click', () => this.closeDrawer());
    window.addEventListener('resize', () => {
      if (!this.isMobileLayout()) this.closeDrawer();
    });
  },
};

const ModeManager = {
  mode: 'guided',
  dataReady: false,
  mlReady: false,
  _refreshTimer: null,

  init() {
    const saved = localStorage.getItem('lerobot-studio.ui-mode');
    this.mode = saved === 'advanced' ? 'advanced' : 'guided';
    this.applyMode();
  },

  setMode(nextMode) {
    this.mode = nextMode === 'advanced' ? 'advanced' : 'guided';
    localStorage.setItem('lerobot-studio.ui-mode', this.mode);
    this.applyMode();
    SidebarSignals.scheduleRefresh(0);
    if (this.mode === 'guided') this.scheduleReadinessRefresh(0);
  },

  scheduleReadinessRefresh(delayMs = 250) {
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = null;
      this.refreshReadiness();
    }, delayMs);
  },

  async refreshReadiness() {
    try {
      const ds = await api.get('/api/datasets');
      this.dataReady = Array.isArray(ds?.datasets) && ds.datasets.length > 0;
    } catch (_) {
      this.dataReady = false;
    }

    const trainDevice = getVal('train-device').trim() || 'cuda';
    try {
      const res = await api.get(`/api/train/preflight?device=${encodeURIComponent(trainDevice)}`);
      this.mlReady = !!res?.ok;
    } catch (_) {
      this.mlReady = false;
    }

    this.applyMode();
    SidebarSignals.scheduleRefresh(0);
  },

  _isTabAllowed(tabName) {
    if (!tabName || this.mode === 'advanced') return true;
    if (tabName === 'dataset') return this.dataReady;
    if (tabName === 'train' || tabName === 'eval') return this.mlReady;
    return true;
  },

  _ensureAllowedActiveTab() {
    const activeTab = document.querySelector('#sidebar-nav .tab-btn.active')?.dataset?.tab;
    if (this._isTabAllowed(activeTab)) return;
    document.querySelector('#sidebar-nav .tab-btn[data-tab="status"]')?.click();
  },

  applyMode() {
    const guidedBtn = document.getElementById('mode-guided-btn');
    const advancedBtn = document.getElementById('mode-advanced-btn');
    if (guidedBtn) guidedBtn.classList.toggle('active', this.mode === 'guided');
    if (advancedBtn) advancedBtn.classList.toggle('active', this.mode === 'advanced');

    const dataGroup = document.getElementById('sidebar-group-data');
    const mlGroup = document.getElementById('sidebar-group-ml');
    const hideData = this.mode === 'guided' && !this.dataReady;
    const hideMl = this.mode === 'guided' && !this.mlReady;
    if (dataGroup) dataGroup.classList.toggle('hidden', hideData);
    if (mlGroup) mlGroup.classList.toggle('hidden', hideMl);

    this._ensureAllowedActiveTab();
  },
};

const SidebarSignals = {
  rulesNeedsRoot: false,
  rulesNeedsInstall: false,
  hasCameras: true,
  hasArms: true,
  trainMissingDep: false,
  datasetMissingDep: false,
  _timer: null,
  _poller: null,

  init() {
    this.scheduleRefresh(0);
    if (this._poller) clearInterval(this._poller);
    this._poller = setInterval(() => this.scheduleRefresh(0), 15000);
  },

  scheduleRefresh(delayMs = 250) {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._timer = null;
      this.refresh();
    }, delayMs);
  },

  async refresh() {
    const trainDevice = getVal('train-device').trim() || 'cuda';
    const [rulesRes, devicesRes, trainRes, depsRes] = await Promise.all([
      api.get('/api/rules/status').catch(() => null),
      api.get('/api/devices').catch(() => null),
      api.get(`/api/train/preflight?device=${encodeURIComponent(trainDevice)}`).catch(() => null),
      api.get('/api/deps/status').catch(() => null),
    ]);

    if (rulesRes) {
      const rulesInstalled = !!rulesRes.rules_installed;
      const sudoNoninteractive = !!rulesRes.sudo_noninteractive;
      this.rulesNeedsInstall = !rulesInstalled;
      this.rulesNeedsRoot = this.rulesNeedsInstall && !sudoNoninteractive;
    }

    if (devicesRes) {
      this.hasCameras = Array.isArray(devicesRes.cameras) && devicesRes.cameras.length > 0;
      this.hasArms = Array.isArray(devicesRes.arms) && devicesRes.arms.length > 0;
    }

    if (trainRes && typeof trainRes.ok === 'boolean') {
      this.trainMissingDep = !trainRes.ok;
    }

    if (depsRes && depsRes.ok) {
      this.datasetMissingDep = !depsRes.huggingface_cli;
    }

    SidebarNav.syncBadges(state.procStatus);
  },

  getHealthState(tabName) {
    if (tabName === 'device-setup') {
      if (this.rulesNeedsRoot) return 'needs_root';
      if (this.rulesNeedsInstall) return 'needs_udev';
      if (!this.hasCameras || !this.hasArms) return 'needs_device';
      return '';
    }
    if (tabName === 'teleop' || tabName === 'record') {
      return (!this.hasCameras || !this.hasArms) ? 'needs_device' : '';
    }
    if (tabName === 'calibrate' || tabName === 'motor-setup') {
      return this.hasArms ? '' : 'needs_device';
    }
    if (tabName === 'dataset') {
      return this.datasetMissingDep ? 'missing_dep' : '';
    }
    if (tabName === 'train' || tabName === 'eval') {
      return this.trainMissingDep ? 'missing_dep' : '';
    }
    return '';
  },
};

/* ─── WebSocket ──────────────────────────────────────────────────────────────── */
const WS = {
  ws: null,
  reconnectTimer: null,
  lastErrorAtByProcess: {},
  prevRunning: {},

  connect() {
    const url = `ws://${location.host}/ws`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      state.wsReady = true;
      document.getElementById('ws-dot').className   = 'dot green';
      document.getElementById('ws-label').textContent = 'Connected';
    };

    this.ws.onclose = () => {
      state.wsReady = false;
      document.getElementById('ws-dot').className   = 'dot red';
      document.getElementById('ws-label').textContent = 'Disconnected';
      this.reconnectTimer = setTimeout(() => this.connect(), 2000);
    };

    this.ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'output') WS.onOutput(msg);
      if (msg.type === 'metric') WS.onMetric(msg);
      if (msg.type === 'status') WS.onStatus(msg);
    };
  },

  onOutput(msg) {
    if (msg.process === 'teleop') {
      const perfMatch = msg.line.match(/^Teleop loop time:\s*([0-9.]+)ms\s*\((\d+) Hz\)/);
      if (perfMatch) {
        updateTeleopLoopPerf(parseFloat(perfMatch[1]), parseInt(perfMatch[2], 10));
        return;
      }
    }

    const rowMatch = msg.line.match(/^([a-zA-Z0-9_]+)\s+\|\s+(-?\d+)\s+\|\s+(-?\d+)\s+\|\s+(-?\d+)\s*$/);
    const isHeader = /^NAME\s+\|\s+MIN\s+\|\s+POS/.test(msg.line);
    const isSeparator = /^-{10,}\s*$/.test(msg.line);

    if (isHeader || isSeparator || rowMatch) {
      if (rowMatch) {
        MotorTable.update(
          msg.process,
          rowMatch[1],
          parseInt(rowMatch[2], 10),
          parseInt(rowMatch[3], 10),
          parseInt(rowMatch[4], 10)
        );
      }
      return;
    }

    const legacyLogId = PROCESS_TO_LOG_ID[msg.process];
    const el = legacyLogId ? document.getElementById(legacyLogId) : null;
    if (el) {
      if (msg.kind === 'translation') {
        const last = el.lastElementChild;
        if (last && last.classList.contains('line-translation') && last.textContent === msg.line) {
          return;
        }
      }
      const line = document.createElement('div');
      line.className = `line-${msg.kind}`;
      line.textContent = msg.line;
      el.appendChild(line);
      el.scrollTop = el.scrollHeight;
    }
    GlobalConsole.append(msg.process, msg.line, msg.kind);

    const isErrorLine = msg.kind === 'error' || /\[ERROR\]|Traceback|RuntimeError|Exception|failed/i.test(msg.line || '');
    if (isErrorLine) {
      this.lastErrorAtByProcess[msg.process] = Date.now();
      SidebarNav.syncBadges(state.procStatus);
    }

    // Parse episode progress from record output
    if (msg.process === 'record') RecordTab.parseEpisode(msg.line);
    if (msg.process === 'train') TrainTab.ingestLogLine(msg.line, msg.kind);
    if (msg.process === 'train_install') TrainTab.ingestInstallerLog(msg.line, msg.kind);
    if (msg.process === 'eval') EvalTab.ingestLogLine(msg.line, msg.kind);
  },

  onMetric(msg) {
    if (msg.process === 'train') {
      TrainTab.ingestMetric(msg.metric || {});
    }
  },

  onStatus(msg) {
    const now = Date.now();
    const next = msg.processes || {};
    const all = new Set([...Object.keys(this.prevRunning), ...Object.keys(next)]);
    let refreshGuidedReadiness = false;

    all.forEach((proc) => {
      const was = !!this.prevRunning[proc];
      const isNow = !!next[proc];
      if (was && !isNow) {
        if (proc === 'record' || proc === 'train' || proc === 'train_install') {
          refreshGuidedReadiness = true;
        }
        const lastErr = this.lastErrorAtByProcess[proc] || 0;
        const abnormal = now - lastErr < 120000;
        if (abnormal) {
          NotificationManager.notify('LeRobot Studio', `${proc} ended with error. Check logs.`, `proc-${proc}-error`);
        } else if (proc === 'train') {
          NotificationManager.notify('LeRobot Studio', 'Training completed.', 'proc-train-complete');
        } else if (proc === 'record') {
          NotificationManager.notify('LeRobot Studio', 'Recording session ended.', 'proc-record-end');
        }
      }
    });

    this.prevRunning = { ...next };
    state.procStatus = msg.processes;
    TeleopTab.syncBtn();
    RecordTab.syncBtn();
    CalibrateTab.syncBtn();
    MotorSetupTab.syncBtn();
    TrainTab.syncBtn();
    EvalTab.syncBtn();
    StatusTab.updateProcs(msg.processes);
    GlobalConsole.syncStatus(msg.processes);
    SidebarNav.syncBadges(msg.processes);
    if (refreshGuidedReadiness && ModeManager.mode === 'guided') {
      ModeManager.scheduleReadinessRefresh(400);
    }
  },
};

/* ─── Tab switching ──────────────────────────────────────────────────────────── */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cam-preview-wrap img').forEach(img => { img.removeAttribute('src'); });
    document.querySelectorAll('.cam-preview-wrap').forEach(w => w.innerHTML = '<span class="play-hint">▶ Click to preview</span>');
    
    const tf = document.getElementById('teleop-feeds'); 
    if (tf) { tf.querySelectorAll('img').forEach(img => img.removeAttribute('src')); tf.innerHTML = ''; }
    
    const rf = document.getElementById('record-feeds'); 
    if (rf) { rf.querySelectorAll('img').forEach(img => img.removeAttribute('src')); rf.innerHTML = ''; }

    FeedManager._stopWatchers();
    FeedManager.clearPaused();
    FeedManager.stopStatPolling();

    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    GlobalConsole.syncProcessFromTab(btn.dataset.tab);
    SidebarNav.onTabActivated();
    SidebarSignals.scheduleRefresh(0);

    // Lazy-load on tab open
    if (btn.dataset.tab === 'status')       StatusTab.refresh();
    if (btn.dataset.tab === 'device-setup') { DeviceSetupTab.refresh(); FeedManager.startStatPolling(); }
    if (btn.dataset.tab === 'calibrate')    { CalibrateTab.refreshArms(); CalibrateTab.checkFile(); CalibrateTab.refreshFiles(); }
    if (btn.dataset.tab === 'motor-setup')  MotorSetupTab.refreshArms();
    if (btn.dataset.tab === 'teleop')       { TeleopTab.showFeeds(); DeviceSetupTab.loadStreamSettings(); }
    if (btn.dataset.tab === 'record')       { RecordTab.onTabOpen(); DeviceSetupTab.loadStreamSettings(); }
    if (btn.dataset.tab === 'train')        { TrainTab.refreshGpu(); TrainTab.refreshDatasets(); TrainTab.refreshPreflight(); }
    if (btn.dataset.tab === 'eval')         EvalTab.loadDefaults();
    if (btn.dataset.tab === 'dataset')      DatasetTab.refreshList();
  });
});

/* ─── Load initial config ────────────────────────────────────────────────────── */
async function loadConfig() {
  state.config = await api.get('/api/config');
  TeleopTab.applyConfig(state.config);
  RecordTab.applyConfig(state.config);
  TrainTab.applyConfig(state.config);
  EvalTab.applyConfig(state.config);
}

function saveConfig() {
  api.post('/api/config', state.config);
}

const _toastState = {
  lastKey: '',
  lastTs: 0,
  active: new Map(),
};

function showToast(message, kind = 'success') {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const key = `${kind}:${message}`;
  const now = Date.now();

  const existing = _toastState.active.get(key);
  if (existing) {
    clearTimeout(existing.hideTimer);
    clearTimeout(existing.removeTimer);
    existing.el.classList.add('show');
    existing.hideTimer = setTimeout(() => {
      existing.el.classList.remove('show');
      existing.removeTimer = setTimeout(() => {
        existing.el.remove();
        _toastState.active.delete(key);
      }, 180);
    }, 2300);
    _toastState.lastKey = key;
    _toastState.lastTs = now;
    return;
  }

  if (_toastState.lastKey === key && now - _toastState.lastTs < 1500) {
    return;
  }

  _toastState.lastKey = key;
  _toastState.lastTs = now;
  const toast = document.createElement('div');
  toast.className = `toast ${kind}`;
  toast.textContent = message;
  root.appendChild(toast);
  const toastRef = { el: toast, hideTimer: 0, removeTimer: 0 };
  _toastState.active.set(key, toastRef);

  requestAnimationFrame(() => toast.classList.add('show'));

  toastRef.hideTimer = setTimeout(() => {
    toast.classList.remove('show');
    toastRef.removeTimer = setTimeout(() => {
      toast.remove();
      _toastState.active.delete(key);
    }, 180);
  }, 2300);
}

function isJsonProfileFile(file) {
  if (!file) return false;
  const nameOk = /\.json$/i.test(file.name || '');
  const type = (file.type || '').toLowerCase();
  const typeOk = type === '' || type.includes('json') || type.includes('text/plain');
  return nameOk && typeOk;
}

const ProfileManager = {
  setActiveBadge(name) {
    const badge = document.getElementById('profile-active-badge');
    if (badge) badge.textContent = `Active: ${name || 'default'}`;
  },

  async refresh() {
    const res = await api.get('/api/profiles');
    const select = document.getElementById('profile-select');
    if (!select) return;
    const profiles = Array.isArray(res.profiles) ? res.profiles : [];
    select.innerHTML = profiles.map((name) => `<option value="${name}">${name}</option>`).join('');
    if (res.active && profiles.includes(res.active)) {
      select.value = res.active;
    } else if (profiles.length > 0) {
      select.value = profiles[0];
    }
    this.setActiveBadge(select.value || res.active || 'default');
  },

  currentName() {
    return document.getElementById('profile-select')?.value || 'default';
  },

  collectCurrentConfig() {
    const teleopCfg = TeleopTab.buildConfig();
    const recordCfg = RecordTab.buildConfig();
    const evalCfg = EvalTab.buildConfig();
    const cfg = {
      ...state.config,
      ...teleopCfg,
      ...recordCfg,
      ...evalCfg,
      train_dataset_source: TrainTab.getDatasetSource(),
      train_policy: getVal('train-policy') || 'act',
      train_steps: parseInt(getVal('train-steps'), 10) || 100000,
      train_device: getVal('train-device') || 'cuda',
      train_repo_id: getVal('train-repo') || 'user/my-dataset',
      profile_name: this.currentName(),
    };
    state.config = cfg;
    return cfg;
  },

  async saveCurrent() {
    const name = this.currentName();
    const cfg = this.collectCurrentConfig();
    const res = await api.post(`/api/profiles/${encodeURIComponent(name)}`, cfg);
    if (res.ok) {
      saveConfig();
      await this.refresh();
      this.setActiveBadge(name);
    } else {
      alert(`Failed to save profile: ${res.error || 'Unknown error'}`);
    }
  },

  async saveAs() {
    const raw = prompt('New profile name (letters, numbers, dot, dash, underscore):', this.currentName());
    const name = (raw || '').trim();
    if (!name) return;
    const cfg = this.collectCurrentConfig();
    cfg.profile_name = name;
    const res = await api.post(`/api/profiles/${encodeURIComponent(name)}`, cfg);
    if (!res.ok) {
      alert(`Failed to save profile: ${res.error || 'Unknown error'}`);
      return;
    }
    state.config.profile_name = name;
    saveConfig();
    await this.refresh();
    this.setActiveBadge(name);
  },

  async applySelected() {
    const name = this.currentName();
    const res = await api.get(`/api/profiles/${encodeURIComponent(name)}`);
    if (!res.ok || !res.config) {
      alert(`Failed to load profile: ${res.error || 'Unknown error'}`);
      return;
    }
    const cfg = { ...res.config, profile_name: name };
    state.config = cfg;
    TeleopTab.applyConfig(cfg);
    RecordTab.applyConfig(cfg);
    TrainTab.applyConfig(cfg);
    EvalTab.applyConfig(cfg);
    setVal('train-policy', cfg.train_policy || 'act');
    setVal('train-steps', String(cfg.train_steps || 100000));
    setVal('train-device', cfg.train_device || 'cuda');
    setVal('train-repo', cfg.train_repo_id || 'user/my-dataset');
    await TrainTab.refreshPreflight();
    saveConfig();
    this.setActiveBadge(name);
  },

  async deleteCurrent() {
    const name = this.currentName();
    if (!name || name === 'default') {
      alert('Cannot delete default profile.');
      return;
    }
    if (!confirm(`Delete profile '${name}'?`)) return;
    const r = await fetch(`/api/profiles/${encodeURIComponent(name)}`, { method: 'DELETE' });
    const res = await r.json();
    if (!res.ok) {
      alert(`Failed to delete profile: ${res.error || 'Unknown error'}`);
      return;
    }
    await this.refresh();
    await this.applySelected();
  },

  async exportCurrent() {
    const name = this.currentName();
    const res = await api.get(`/api/profiles/${encodeURIComponent(name)}`);
    if (!res.ok || !res.config) {
      alert(`Failed to export profile: ${res.error || 'Unknown error'}`);
      return;
    }
    const content = JSON.stringify(res.config, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  triggerImport() {
    const input = document.getElementById('profile-import-input');
    if (input) input.click();
  },

  async importFromFile(file, suggestedName = '') {
    if (!file) return;
    if (!isJsonProfileFile(file)) {
      showToast('Only .json profile files are supported.', 'error');
      return;
    }
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      showToast('Invalid JSON file.', 'error');
      return;
    }

    const baseName = suggestedName || file.name.replace(/\.json$/i, '') || 'imported-profile';
    const raw = prompt('Profile name for import:', baseName);
    const name = (raw || '').trim();
    if (!name) return;

    const res = await api.post('/api/profiles-import', { name, config: parsed });
    if (!res.ok) {
      showToast(`Import failed: ${res.error || 'Unknown error'}`, 'error');
      return;
    }

    await this.refresh();
    const select = document.getElementById('profile-select');
    if (select) select.value = name;
    await this.applySelected();
    this.setActiveBadge(name);
    showToast(`Profile imported: ${name}`, 'success');
  },

  async handleImportFile(input) {
    const file = input?.files?.[0];
    if (file) await this.importFromFile(file);
    input.value = '';
  },

  bindDropzone() {
    const zone = document.getElementById('profile-dropzone');
    if (!zone) return;

    zone.addEventListener('click', () => this.triggerImport());
    const prevent = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((evt) => {
      zone.addEventListener(evt, prevent);
    });

    ['dragenter', 'dragover'].forEach((evt) => {
      zone.addEventListener(evt, () => zone.classList.add('active'));
    });
    ['dragleave', 'drop'].forEach((evt) => {
      zone.addEventListener(evt, () => zone.classList.remove('active'));
    });

    zone.addEventListener('drop', async (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (!isJsonProfileFile(file)) {
        showToast('Drop a .json profile file.', 'error');
        return;
      }
      const suggested = file.name.replace(/\.json$/i, '') || 'imported-profile';
      await this.importFromFile(file, suggested);
    });
  },
};

/* ═══════════════════════════════════════════════════════════════════════════════
   STATUS TAB
══════════════════════════════════════════════════════════════════════════════ */
const StatusTab = {
  async refresh() {
    const btn = document.getElementById('status-refresh-btn');
    if (btn) { btn.disabled = true; btn.textContent = '↺ Refreshing…'; }

    const data = await api.get('/api/devices');
    state.devices = data;
    this.renderCameras(data.cameras);
    this.renderArms(data.arms);

    const ts = new Date().toLocaleTimeString();
    const updateEl = document.getElementById('status-last-update');
    if (updateEl) updateEl.textContent = `Last updated: ${ts}`;
    if (btn) { btn.disabled = false; btn.textContent = '↺ Refresh'; }
  },

  renderCameras(cameras) {
    const el = document.getElementById('status-cameras');
    if (!cameras.length) { el.innerHTML = '<div class="device-item"><span class="dname">No cameras detected</span></div>'; return; }
    el.innerHTML = cameras.map(c => {
      const hasLink = !!c.symlink;
      return `<div class="device-item">
        <span class="dot ${hasLink ? 'green' : 'yellow'}"></span>
        <div>
          <div class="dname">${c.symlink || c.device}</div>
          <div class="dsub">/dev/${c.device} · port ${c.kernels || '?'} · ${c.model}</div>
        </div>
        <span class="dbadge ${hasLink ? 'badge-ok' : 'badge-warn'}">${hasLink ? 'linked' : 'no link'}</span>
      </div>`;
    }).join('');
  },

  renderArms(arms) {
    const el = document.getElementById('status-arms');
    if (!arms.length) { el.innerHTML = '<div class="device-item"><span class="dname">No arm ports detected</span></div>'; return; }
    el.innerHTML = arms.map(a => {
      const hasLink = !!a.symlink;
      return `<div class="device-item">
        <span class="dot ${hasLink ? 'green' : 'yellow'}"></span>
        <div>
          <div class="dname">${a.symlink || a.device}</div>
          <div class="dsub">/dev/${a.device}</div>
        </div>
        <span class="dbadge ${hasLink ? 'badge-ok' : 'badge-warn'}">${hasLink ? 'linked' : 'no link'}</span>
      </div>`;
    }).join('');
  },

  updateProcs(procs) {
    const el = document.getElementById('status-procs');
    const allProcs = ['teleop', 'record', 'calibrate', 'motor_setup', 'train', 'eval'];
    el.innerHTML = allProcs.map(name => {
      const running = !!procs[name];
      return `<div class="device-item">
        <span class="dot ${running ? 'green pulse' : 'gray'}"></span>
        <div class="dname">${name}</div>
        <span class="dbadge ${running ? 'badge-run' : 'badge-idle'}">${running ? 'running' : 'idle'}</span>
      </div>`;
    }).join('');
  },
};

/* ═══════════════════════════════════════════════════════════════════════════════
   TELEOP TAB
══════════════════════════════════════════════════════════════════════════════ */
const TeleopTab = {
  _lastRunning: false,

  mode: 'single',

  setMode(m) {
    this.mode = m;
    document.getElementById('teleop-mode-single').classList.toggle('active', m === 'single');
    document.getElementById('teleop-mode-bi').classList.toggle('active',     m === 'bi');
    document.getElementById('teleop-single-cfg').classList.toggle('hidden',  m !== 'single');
    document.getElementById('teleop-bi-cfg').classList.toggle('hidden',      m !== 'bi');
  },

  applyConfig(cfg) {
    this.mode = cfg.robot_mode || 'single';
    this.setMode(this.mode);
    setVal('teleop-follower-port',  cfg.follower_port);
    setVal('teleop-robot-id',       cfg.robot_id);
    setVal('teleop-leader-port',    cfg.leader_port);
    setVal('teleop-teleop-id',      cfg.teleop_id);
    setVal('teleop-left-follower',  cfg.left_follower_port);
    setVal('teleop-right-follower', cfg.right_follower_port);
    setVal('teleop-left-leader',    cfg.left_leader_port);
    setVal('teleop-right-leader',   cfg.right_leader_port);
    if (cfg.cameras) {
      setVal('tc-front1', cfg.cameras.front_1 || '');
      setVal('tc-top1',   cfg.cameras.top_1   || '');
      setVal('tc-top2',   cfg.cameras.top_2   || '');
    }
  },

  buildConfig() {
    const cfg = {
      robot_mode:          this.mode,
      follower_port:       getVal('teleop-follower-port'),
      robot_id:            getVal('teleop-robot-id'),
      leader_port:         getVal('teleop-leader-port'),
      teleop_id:           getVal('teleop-teleop-id'),
      left_follower_port:  getVal('teleop-left-follower'),
      right_follower_port: getVal('teleop-right-follower'),
      left_leader_port:    getVal('teleop-left-leader'),
      right_leader_port:   getVal('teleop-right-leader'),
      cameras: {
        front_1: getVal('tc-front1'),
        top_1: getVal('tc-top1'),
        top_2: getVal('tc-top2'),
      },
    };
    Object.assign(state.config, cfg);
    saveConfig();
    return cfg;
  },

  async start() {
    const cfg = this.buildConfig();
    const errors = [];

    if (this.mode === 'single') {
      if (!cfg.follower_port || !cfg.follower_port.startsWith('/dev/'))
        errors.push('Follower arm port is missing or invalid');
      if (!cfg.robot_id)
        errors.push('Follower arm ID is required');
      if (!cfg.leader_port || !cfg.leader_port.startsWith('/dev/'))
        errors.push('Leader arm port is missing or invalid');
      if (!cfg.teleop_id)
        errors.push('Leader arm ID is required');
    } else {
      if (!cfg.left_follower_port || !cfg.left_follower_port.startsWith('/dev/'))
        errors.push('Left follower port is missing or invalid');
      if (!cfg.right_follower_port || !cfg.right_follower_port.startsWith('/dev/'))
        errors.push('Right follower port is missing or invalid');
      if (!cfg.left_leader_port || !cfg.left_leader_port.startsWith('/dev/'))
        errors.push('Left leader port is missing or invalid');
      if (!cfg.right_leader_port || !cfg.right_leader_port.startsWith('/dev/'))
        errors.push('Right leader port is missing or invalid');
    }

    if (errors.length) {
      this.clearLog();
      errors.forEach(e => appendLog('teleop-log', `[ERROR] ${e}`, 'error'));
      return;
    }

    this.clearLog();
    if (!(await runPreflight(cfg, 'teleop-log'))) return;
    const res = await api.post('/api/teleop/start', cfg);
    if (!res.ok) { appendLog('teleop-log', `[ERROR] ${res.error}`, 'error'); return; }
    this.showFeeds();
  },

  async stop() {
    FeedManager.suppressStall(8000);
    await api.post('/api/process/teleop/stop');
  },

  async sendInput() {
    await sendProcessInput('teleop', 'teleop-stdin', 'teleop-log', { allowEmpty: true });
  },

  showFeeds() {
    const cameras = [
      { name: 'front_1', path: getVal('tc-front1') },
      { name: 'top_1',   path: getVal('tc-top1')   },
      { name: 'top_2',   path: getVal('tc-top2')   },
    ].filter(c => c.path);
    FeedManager.render('teleop-feeds', cameras);
  },

  clearLog() { clearProcessLog('teleop-log'); },

  syncBtn() {
    const running = !!state.procStatus['teleop'];
    if (running !== this._lastRunning) {
      this.showFeeds();
      this._lastRunning = running;
    }
    syncProcessButtons('teleop', 'teleop-start-btn', 'teleop-stop-btn', () => {
      updateTeleopLoopPerf(null, null);
    });
  },
};

/* ═══════════════════════════════════════════════════════════════════════════════
   RECORD TAB
══════════════════════════════════════════════════════════════════════════════ */
const RecordTab = {
  mode: 'single',
  _lastRunning: false,
  useMappedDevices: true,

  resetProgress() {
    const currentEl = document.getElementById('record-ep-current');
    if (currentEl) currentEl.textContent = '—';
    const totalEl = document.getElementById('record-ep-total');
    if (totalEl) totalEl.textContent = '—';
    const bar = document.getElementById('record-ep-bar');
    if (bar) bar.style.width = '0%';
  },

  setMode(m) {
    this.mode = m;
    document.getElementById('record-mode-single').classList.toggle('active', m === 'single');
    document.getElementById('record-mode-bi').classList.toggle('active',     m === 'bi');
    document.getElementById('record-single-cfg').classList.toggle('hidden',  m !== 'single');
    document.getElementById('record-bi-cfg').classList.toggle('hidden',      m !== 'bi');
    this.applyMappedDevicePreference();
  },

  async onTabOpen() {
    await this.refreshDeviceOptions();
    this.applyMappedDevicePreference();
    this.showFeeds();
    await this.refreshCalibrationIdOptions();
  },

  onUseMappedToggle() {
    const useMapped = !!document.getElementById('record-use-mapped')?.checked;
    this.useMappedDevices = useMapped;
    state.config.record_use_mapped_devices = useMapped;
    saveConfig();
    this.applyMappedDevicePreference();
    this.showFeeds();
  },

  getMappedValues() {
    const single = {
      follower_port: '/dev/follower_arm_1',
      leader_port: '/dev/leader_arm_1',
    };
    const bi = {
      left_follower_port: '/dev/follower_arm_1',
      right_follower_port: '/dev/follower_arm_2',
      left_leader_port: '/dev/leader_arm_1',
      right_leader_port: '/dev/leader_arm_2',
    };
    return {
      ...(this.mode === 'single' ? single : bi),
      cameras: {
        front_1: '/dev/follower_cam_1',
        top_1: '/dev/top_cam_1',
        top_2: '/dev/top_cam_2',
      },
    };
  },

  _setSelectOptions(selectId, values, preferred = []) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const current = select.value || '';
    const uniq = [];
    const seen = new Set();
    [...preferred, ...values, current].forEach((val) => {
      const v = String(val || '').trim();
      if (!v || seen.has(v)) return;
      seen.add(v);
      uniq.push(v);
    });
    const optionsHtml = uniq.map((v) => `<option value="${v}">${v}</option>`).join('');
    select.innerHTML = optionsHtml;
    if (current && uniq.includes(current)) {
      select.value = current;
    } else if (uniq.length > 0) {
      select.value = uniq[0];
    }
  },

  async refreshDeviceOptions() {
    try {
      const data = await api.get('/api/devices');
      const arms = Array.isArray(data?.arms) ? data.arms : [];
      const cams = Array.isArray(data?.cameras) ? data.cameras : [];

      const armPaths = arms.flatMap((a) => {
        const out = [];
        if (a?.symlink) out.push(`/dev/${a.symlink}`);
        if (a?.path) out.push(a.path);
        return out;
      });
      const camPaths = cams.flatMap((c) => {
        const out = [];
        if (c?.symlink) out.push(`/dev/${c.symlink}`);
        if (c?.path) out.push(c.path);
        return out;
      });

      this._setSelectOptions('record-follower-port', armPaths, ['/dev/follower_arm_1', '/dev/follower_arm_2']);
      this._setSelectOptions('record-leader-port', armPaths, ['/dev/leader_arm_1', '/dev/leader_arm_2']);
      this._setSelectOptions('record-left-follower', armPaths, ['/dev/follower_arm_1', '/dev/follower_arm_2']);
      this._setSelectOptions('record-right-follower', armPaths, ['/dev/follower_arm_2', '/dev/follower_arm_1']);
      this._setSelectOptions('record-left-leader', armPaths, ['/dev/leader_arm_1', '/dev/leader_arm_2']);
      this._setSelectOptions('record-right-leader', armPaths, ['/dev/leader_arm_2', '/dev/leader_arm_1']);
      this._setSelectOptions('rc-front1', camPaths, ['/dev/follower_cam_1']);
      this._setSelectOptions('rc-top1', camPaths, ['/dev/top_cam_1']);
      this._setSelectOptions('rc-top2', camPaths, ['/dev/top_cam_2']);
    } catch (_) {
      this._setSelectOptions('record-follower-port', [], ['/dev/follower_arm_1', '/dev/follower_arm_2']);
      this._setSelectOptions('record-leader-port', [], ['/dev/leader_arm_1', '/dev/leader_arm_2']);
      this._setSelectOptions('record-left-follower', [], ['/dev/follower_arm_1', '/dev/follower_arm_2']);
      this._setSelectOptions('record-right-follower', [], ['/dev/follower_arm_2', '/dev/follower_arm_1']);
      this._setSelectOptions('record-left-leader', [], ['/dev/leader_arm_1', '/dev/leader_arm_2']);
      this._setSelectOptions('record-right-leader', [], ['/dev/leader_arm_2', '/dev/leader_arm_1']);
      this._setSelectOptions('rc-front1', [], ['/dev/follower_cam_1']);
      this._setSelectOptions('rc-top1', [], ['/dev/top_cam_1']);
      this._setSelectOptions('rc-top2', [], ['/dev/top_cam_2']);
    }
  },

  applyMappedDevicePreference() {
    const useMappedEl = document.getElementById('record-use-mapped');
    const summaryEl = document.getElementById('record-mapped-summary');
    const useMapped = useMappedEl ? !!useMappedEl.checked : (state.config.record_use_mapped_devices !== false);
    this.useMappedDevices = useMapped;
    if (useMappedEl) useMappedEl.checked = useMapped;

    const mapped = this.getMappedValues();
    if (useMapped) {
      if (this.mode === 'single') {
        setVal('record-follower-port', mapped.follower_port);
        setVal('record-leader-port', mapped.leader_port);
      } else {
        setVal('record-left-follower', mapped.left_follower_port);
        setVal('record-right-follower', mapped.right_follower_port);
        setVal('record-left-leader', mapped.left_leader_port);
        setVal('record-right-leader', mapped.right_leader_port);
      }
      setVal('rc-front1', mapped.cameras.front_1);
      setVal('rc-top1', mapped.cameras.top_1);
      setVal('rc-top2', mapped.cameras.top_2);
    }

    [
      'record-follower-port', 'record-leader-port',
      'record-left-follower', 'record-right-follower',
      'record-left-leader', 'record-right-leader',
      'rc-front1', 'rc-top1', 'rc-top2',
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = useMapped;
    });

    if (summaryEl) {
      if (!useMapped) {
        summaryEl.style.display = 'none';
      } else if (this.mode === 'single') {
        summaryEl.style.display = 'block';
        summaryEl.innerHTML = `
          <div><b>Mapped devices in use:</b></div>
          <div style="margin-top:4px">Arms: <code>${mapped.follower_port}</code>, <code>${mapped.leader_port}</code></div>
          <div style="margin-top:4px">Cameras: <code>${mapped.cameras.front_1}</code>, <code>${mapped.cameras.top_1}</code>, <code>${mapped.cameras.top_2}</code></div>
        `;
      } else {
        summaryEl.style.display = 'block';
        summaryEl.innerHTML = `
          <div><b>Mapped devices in use:</b></div>
          <div style="margin-top:4px">Followers: <code>${mapped.left_follower_port}</code>, <code>${mapped.right_follower_port}</code></div>
          <div style="margin-top:4px">Leaders: <code>${mapped.left_leader_port}</code>, <code>${mapped.right_leader_port}</code></div>
          <div style="margin-top:4px">Cameras: <code>${mapped.cameras.front_1}</code>, <code>${mapped.cameras.top_1}</code>, <code>${mapped.cameras.top_2}</code></div>
        `;
      }
    }
  },

  async refreshCalibrationIdOptions() {
    const followerSelect = document.getElementById('record-robot-id');
    const leaderSelect = document.getElementById('record-teleop-id');
    if (!followerSelect || !leaderSelect) return;
    try {
      const res = await api.get('/api/calibrate/list');
      const files = Array.isArray(res?.files) ? res.files : [];
      const followerIds = [...new Set(files.filter((f) => String(f.guessed_type || '').includes('follower')).map((f) => f.id))].sort();
      const leaderIds = [...new Set(files.filter((f) => String(f.guessed_type || '').includes('leader')).map((f) => f.id))].sort();
      this._setSelectOptions('record-robot-id', followerIds, ['my_so101_follower_1']);
      this._setSelectOptions('record-teleop-id', leaderIds, ['my_so101_leader_1']);
    } catch (_) {
      this._setSelectOptions('record-robot-id', [], ['my_so101_follower_1']);
      this._setSelectOptions('record-teleop-id', [], ['my_so101_leader_1']);
    }
  },

  applyConfig(cfg) {
    this.mode = cfg.robot_mode || 'single';
    this.setMode(this.mode);
    setVal('record-follower-port',  cfg.follower_port);
    setVal('record-robot-id',       cfg.robot_id);
    setVal('record-leader-port',    cfg.leader_port);
    setVal('record-teleop-id',      cfg.teleop_id);
    setVal('record-left-follower',  cfg.left_follower_port);
    setVal('record-right-follower', cfg.right_follower_port);
    setVal('record-left-leader',    cfg.left_leader_port);
    setVal('record-right-leader',   cfg.right_leader_port);
    setVal('record-task',     cfg.record_task     || '');
    setVal('record-episodes', cfg.record_episodes || 50);
    setVal('record-repo',     cfg.record_repo_id  || 'user/my-dataset');
    const useMappedEl = document.getElementById('record-use-mapped');
    const useMapped = cfg.record_use_mapped_devices !== false;
    if (useMappedEl) useMappedEl.checked = useMapped;
    this.useMappedDevices = useMapped;
    const resumeEl = document.getElementById('record-resume');
    if (resumeEl) resumeEl.checked = !!cfg.record_resume;
    document.getElementById('record-ep-total').textContent = '—';
    if (cfg.cameras) {
      setVal('rc-front1', cfg.cameras.front_1 || '');
      setVal('rc-top1',   cfg.cameras.top_1   || '');
      setVal('rc-top2',   cfg.cameras.top_2   || '');
    }
    this.applyMappedDevicePreference();
    this.refreshDeviceOptions();
    this.refreshCalibrationIdOptions();
  },

  buildConfig() {
    const ep = parseInt(getVal('record-episodes')) || 50;
    const useMapped = !!document.getElementById('record-use-mapped')?.checked;
    const mapped = this.getMappedValues();
    const cfg = {
      robot_mode:    this.mode,
      follower_port: useMapped ? mapped.follower_port : getVal('record-follower-port'),
      robot_id:      getVal('record-robot-id'),
      leader_port:   useMapped ? mapped.leader_port : getVal('record-leader-port'),
      teleop_id:     getVal('record-teleop-id'),
      left_follower_port:  useMapped ? mapped.left_follower_port : getVal('record-left-follower'),
      right_follower_port: useMapped ? mapped.right_follower_port : getVal('record-right-follower'),
      left_leader_port:    useMapped ? mapped.left_leader_port : getVal('record-left-leader'),
      right_leader_port:   useMapped ? mapped.right_leader_port : getVal('record-right-leader'),
      record_task:         getVal('record-task'),
      record_episodes:     ep,
      record_repo_id:      getVal('record-repo'),
      record_resume:       !!document.getElementById('record-resume')?.checked,
      record_use_mapped_devices: useMapped,
      cameras: {
        front_1: useMapped ? mapped.cameras.front_1 : getVal('rc-front1'),
        top_1:   useMapped ? mapped.cameras.top_1 : getVal('rc-top1'),
        top_2:   useMapped ? mapped.cameras.top_2 : getVal('rc-top2'),
      },
    };
    document.getElementById('record-ep-total').textContent = ep;
    Object.assign(state.config, cfg);
    saveConfig();
    return cfg;
  },

  async start() {
    if (!this.validateRepoId()) {
      appendLog('record-log', '[ERROR] Repo ID must be in "user/dataset" format (e.g. yourname/my-dataset)', 'error');
      return;
    }
    const cfg = this.buildConfig();
    this.clearLog();
    if (!(await runPreflight(cfg, 'record-log'))) return;
    const currentEl = document.getElementById('record-ep-current');
    if (currentEl) currentEl.textContent = '0';
    const bar = document.getElementById('record-ep-bar');
    if (bar) bar.style.width = '0%';
    const res = await api.post('/api/record/start', cfg);
    if (!res.ok) {
      this.resetProgress();
      appendLog('record-log', `[ERROR] ${res.error}`, 'error');
      return;
    }
    if (res.resume_requested && !res.resume_enabled) {
      appendLog('record-log', '[INFO] Resume was disabled because target dataset does not exist yet. Starting a fresh dataset.', 'info');
    }
    this.showFeeds();
  },

  async stop() {
    FeedManager.suppressStall(8000);
    await api.post('/api/process/record/stop');
  },

  async sendKey(key) {
    const res = await api.post('/api/process/record/input', { text: key });
    if (!res?.ok) {
      showToast('Failed to send capture control input.', 'error');
      return;
    }

    const { current, total, label } = this.readEpisodeProgress();
    const feedback = {
      right: {
        message: label
          ? `Episode ${label} saved. Recording continues.`
          : 'Episode saved. Recording continues.',
        kind: 'success',
        flash: 'save',
      },
      left: {
        message: label
          ? `Episode ${label} discarded. Re-record this attempt.`
          : 'Episode discarded. Re-record this attempt.',
        kind: 'error',
        flash: 'discard',
      },
      escape: {
        message: (Number.isInteger(current) && Number.isInteger(total) && total > 0)
          ? `Recording ended at ${current}/${total} episodes.`
          : 'Recording ended.',
        kind: 'success',
        flash: 'end',
      },
    };
    const entry = feedback[key] || { message: 'Capture command sent', kind: 'success', flash: 'save' };
    showToast(entry.message, entry.kind);
    this.flashCaptureAction(entry.flash);
  },

  readEpisodeProgress() {
    const currentText = document.getElementById('record-ep-current')?.textContent?.trim() || '';
    const totalText = document.getElementById('record-ep-total')?.textContent?.trim() || '';
    const current = parseInt(currentText, 10);
    const total = parseInt(totalText, 10);
    const hasCurrent = Number.isInteger(current) && current >= 0;
    const hasTotal = Number.isInteger(total) && total > 0;
    return {
      current: hasCurrent ? current : null,
      total: hasTotal ? total : null,
      label: hasCurrent && hasTotal ? `${current}/${total}` : null,
    };
  },

  flashCaptureAction(type) {
    const card = document.querySelector('.episode-progress-card');
    if (!card) return;
    card.classList.remove('ep-flash-save', 'ep-flash-discard', 'ep-flash-end');
    const className = `ep-flash-${type}`;
    card.classList.add(className);
    setTimeout(() => {
      card.classList.remove(className);
    }, 520);
  },

  validateRepoId() {
    const repo = getVal('record-repo').trim();
    const input = document.getElementById('record-repo');
    const errorEl = document.getElementById('record-repo-error');
    const valid = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(repo);

    if (!repo) {
      input.style.borderColor = 'var(--red)';
      if (errorEl) { errorEl.style.display = 'block'; errorEl.textContent = 'Repo ID is required'; }
      return false;
    }
    if (!valid) {
      input.style.borderColor = 'var(--red)';
      if (errorEl) { errorEl.style.display = 'block'; errorEl.textContent = 'Must be "user/dataset" format (e.g. yourname/my-dataset)'; }
      return false;
    }

    input.style.borderColor = 'var(--border)';
    if (errorEl) errorEl.style.display = 'none';
    return true;
  },

  showFeeds() {
    const cameras = [
      { name: 'front_1', path: getVal('rc-front1') || state.config.cameras?.front_1 || '' },
      { name: 'top_1',   path: getVal('rc-top1')   || state.config.cameras?.top_1   || '' },
      { name: 'top_2',   path: getVal('rc-top2')   || state.config.cameras?.top_2   || '' },
    ].filter(c => c.path);
    FeedManager.render('record-feeds', cameras);
  },

  parseEpisode(line) {
    // Match patterns like "Episode 3/50" or "episode_index=3"
    let m = line.match(/[Ee]pisode[\s_](?:index=)?(\d+)/);
    if (m) {
      const current = parseInt(m[1]);
      const total   = parseInt(document.getElementById('record-ep-total').textContent) || 0;
      document.getElementById('record-ep-current').textContent = current;
      if (total > 0) {
        const pct = (current / total * 100).toFixed(1);
        const bar = document.getElementById('record-ep-bar');
        if (bar) bar.style.width = pct + '%';
      }
    }
  },

  clearLog() { clearProcessLog('record-log'); },

  syncBtn() {
    const running = !!state.procStatus['record'];
    if (running !== this._lastRunning) {
      this.showFeeds();
      this._lastRunning = running;
    }
    const progressCard = document.querySelector('.episode-progress-card');
    const startBtn = document.getElementById('record-start-btn');
    const stopBtn = document.getElementById('record-stop-btn');
    const statePill = document.getElementById('record-state-pill');
    if (startBtn) {
      startBtn.disabled = running;
      startBtn.textContent = '▶ Start Recording';
      startBtn.classList.remove('recording');
    }
    if (statePill) {
      statePill.textContent = running ? 'Recording' : 'Idle';
      statePill.classList.toggle('running', running);
      statePill.classList.toggle('idle', !running);
    }
    if (progressCard) {
      progressCard.classList.toggle('running', running);
    }
    if (stopBtn) {
      stopBtn.classList.toggle('hidden', !running);
      stopBtn.disabled = !running;
    }
    const controls = document.getElementById('record-ep-controls');
    const guard = document.getElementById('record-ep-guard');
    if (controls) {
      controls.querySelectorAll('.record-ep-action').forEach(btn => { btn.disabled = !running; });
      if (guard) guard.style.display = running ? 'none' : 'block';
    }
    if (!running) {
      this.resetProgress();
    }
  },
};

/* ═══════════════════════════════════════════════════════════════════════════════
   CALIBRATE TAB
══════════════════════════════════════════════════════════════════════════════ */
const CalibrateTab = {
  checkTimer: null,
  cachedFiles: [],

  async checkFile() {
    clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(async () => {
      const type = getVal('cal-type');
      const id = getVal('cal-id');
      if (!type || !id) return;
      
      const res = await api.get(`/api/calibrate/file?robot_type=${type}&robot_id=${id}`);
      const statusEl = document.getElementById('cal-file-status');
      const metaEl = document.getElementById('cal-file-meta');
      
      if (res.exists) {
        statusEl.textContent = 'Found';
        statusEl.className = 'dbadge badge-ok';
        metaEl.innerHTML = `${res.path}<br/>Modified: ${res.modified} (${res.size} bytes)`;
      } else {
        statusEl.textContent = 'Missing';
        statusEl.className = 'dbadge badge-warn';
        metaEl.innerHTML = `Will create new file:<br/>${res.path}`;
      }
    }, 300);
  },

  async start() {
    const body = {
      robot_type: getVal('cal-type'),
      robot_id:   getVal('cal-id'),
      port:       getVal('cal-port'),
    };
    this.clearLog();
    const res = await api.post('/api/calibrate/start', body);
    if (!res.ok) appendLog('cal-log', `[ERROR] ${res.error}`, 'error');
  },

  async stop() {
    await api.post('/api/process/calibrate/stop');
    setTimeout(() => {
      this.checkFile();
      this.refreshFiles();
    }, 1500);
  },

  async sendInput() {
    await sendProcessInput('calibrate', 'cal-stdin', 'cal-log');
  },

  clearLog() { 
    clearProcessLog('cal-log', () => MotorTable.clear());
  },

  syncBtn() {
    syncProcessButtons('calibrate', 'cal-start-btn', 'cal-stop-btn');
  },

  async refreshArms() {
    const data = await api.get('/api/devices');
    const el   = document.getElementById('cal-arms-list');
    renderArmList(el, data.arms);
    // Auto-fill port with first detected arm
    if (data.arms.length && !getVal('cal-port')) {
      setVal('cal-port', data.arms[0].path);
    }
  },

  async refreshFiles() {
    const res = await api.get('/api/calibrate/list');
    this.cachedFiles = res.files || [];
    this.renderFiles();
  },

  renderFiles() {
    const el = document.getElementById('cal-file-list');
    const filter = document.getElementById('cal-file-filter')?.value || 'all';

    if (!this.cachedFiles.length) {
      el.innerHTML = '<div class="device-item"><span class="dname muted" style="color:var(--text2)">No calibration files found</span></div>';
      return;
    }

    const filtered = filter === 'all' 
      ? this.cachedFiles 
      : this.cachedFiles.filter(f => f.guessed_type === filter);

    if (!filtered.length) {
      el.innerHTML = '<div class="device-item"><span class="dname muted" style="color:var(--text2)">No files for selected type</span></div>';
      return;
    }

    let html = '';
    if (filter === 'all') {
      const groups = {};
      for (const f of filtered) {
        if (!groups[f.guessed_type]) groups[f.guessed_type] = [];
        groups[f.guessed_type].push(f);
      }
      for (const [gtype, files] of Object.entries(groups)) {
        html += `<div style="font-size:10px; color:var(--text2); margin:12px 0 6px 4px; text-transform:uppercase; letter-spacing:0.8px; font-weight:600;">${gtype}</div>`;
        html += files.map(f => this._fileCard(f)).join('');
      }
    } else {
      html += filtered.map(f => this._fileCard(f)).join('');
    }
    el.innerHTML = html;
  },

  _fileCard(f) {
    return `
      <div class="device-item" style="cursor:pointer; flex-wrap:wrap; position:relative; margin-bottom:4px; padding-right:70px;" onclick="CalibrateTab.selectFile('${f.id}', '${f.guessed_type}')">
        <span class="dot green"></span>
        <div style="flex:1;">
          <div class="dname">${f.id}</div>
          <div class="dsub">${f.modified}</div>
        </div>
        <div style="position:absolute; right:12px; top:12px; display:flex; gap:4px;">
          <button class="btn-xs" style="color:var(--red); border:1px solid rgba(248,81,73,0.3);" onclick="event.stopPropagation(); CalibrateTab.deleteFile('${f.id}', '${f.guessed_type}', '${f.modified}')">Delete…</button>
        </div>
      </div>
    `;
  },

  selectFile(id, guessedType) {
    setVal('cal-id', id);
    setVal('cal-type', guessedType);
    this.checkFile();
  },

  async deleteFile(id, guessedType, modified) {
    const msg = `Delete calibration file?\n\nFile: ${id}\nType: ${guessedType}\nLast modified: ${modified || 'unknown'}\n\nThis cannot be undone. You will need to recalibrate.`;
    if (!confirm(msg)) return;
    
    const res = await fetch(`/api/calibrate/file?robot_type=${guessedType}&robot_id=${id}`, {
      method: 'DELETE'
    });
    
    if (res.ok) {
      await this.refreshFiles();
      this.checkFile();
    } else {
      const data = await res.json();
      alert(`Failed to delete: ${data.error}`);
    }
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   DEVICE SETUP TAB
══════════════════════════════════════════════════════════════════════════════ */
const DeviceSetupTab = {
  cameras:     [],
  arms:        [],
  assignments: {},   // kernels → role
  armAssignments: {},
  streamApplyTimer: null,
  rulesApplyTimer: null,
  installCommands: [],
  rulesStatus: null,

  async refresh() {
    const data = await api.get('/api/devices');
    state.devices = data;
    this.cameras = data.cameras;
    this.arms = data.arms;
    // Restore assignments from current symlinks
    this.assignments = {};
    for (const cam of data.cameras) {
      this.assignments[cam.kernels] = cam.symlink || '(none)';
    }
    this.armAssignments = {};
    for (const arm of data.arms) {
      if (!arm.serial) continue;
      this.armAssignments[arm.serial] = arm.symlink || '(none)';
    }
    this.renderGrid();
    this.renderArmsGrid();
    this.validateAssignments();
    this.showCurrent();
    this.refreshRulesStatus();
  },

  renderGrid() {
    const el = document.getElementById('device-cameras-grid');
    if (!this.cameras.length) {
      el.innerHTML = '<div style="grid-column: 1/-1; padding: 32px; text-align: center; border: 1px dashed var(--border); border-radius: 8px; color: var(--text2);">No cameras detected. Please connect them and refresh.</div>';
      return;
    }
    el.innerHTML = this.cameras.map((cam, i) => {
      const roles = {
        '(none)': 'Not used (skip this camera)',
        'top_cam_1': 'Top Camera 1',
        'top_cam_2': 'Top Camera 2',
        'top_cam_3': 'Top Camera 3',
        'follower_cam_1': 'Follower Camera 1',
        'follower_cam_2': 'Follower Camera 2'
      };
      const curRole = this.assignments[cam.kernels] || '(none)';
      
      let opts = '';
      for (const [val, label] of Object.entries(roles)) {
        const sel = (val === curRole) ? 'selected' : '';
        opts += `<option value="${val}" ${sel}>${label}</option>`;
      }

      return `<div class="cam-card" style="box-shadow: 0 2px 8px rgba(0,0,0,0.2); border: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; border-radius: 8px;">
        <div class="cam-preview-wrap" id="cam-wrap-${i}" onclick="DeviceSetupTab.togglePreview(${i}, '${cam.device}')" style="background: #111; height: 220px; display: flex; align-items: center; justify-content: center; cursor: pointer; position: relative;">
          <div style="position:absolute;top:8px;left:8px;padding:3px 8px;border-radius:999px;background:rgba(0,0,0,0.55);color:#fff;font-size:11px;font-weight:600;letter-spacing:0.2px;">Preview 144p · 5fps</div>
          <button class="btn-primary" style="opacity: 0.9; padding: 10px 20px; font-size: 14px; border-radius: 20px; pointer-events: none;">▶ View Preview</button>
        </div>
        <div class="cam-info" style="padding: 16px; background: var(--bg-card); flex: 1; display: flex; flex-direction: column;">
          <div style="font-weight: 600; font-size: 15px; margin-bottom: 6px; color: var(--text1);">Where is this camera?</div>
          <div style="font-size: 12px; color: var(--text2); margin-bottom: 10px;">If this camera is not needed, choose "Not used".</div>
          <select style="width: 100%; font-size: 15px; padding: 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-app); color: var(--text1); cursor: pointer;" onchange="DeviceSetupTab.assign('${cam.kernels}', this.value)">
            ${opts}
          </select>
          <div style="margin-top: 16px; display: flex; justify-content: space-between; font-size: 12px; color: var(--text2); background: var(--bg-app); padding: 8px; border-radius: 4px; border: 1px solid var(--border);">
            <span title="USB Port ID">🔌 Port: <strong style="color:var(--text1)">${cam.kernels || '?'}</strong></span>
            <span>/dev/${cam.device}</span>
          </div>
        </div>
      </div>`;
    }).join('');
  },

  renderArmsGrid() {
    const el = document.getElementById('device-arms-grid');
    if (!el) return;
    if (!this.arms.length) {
      el.innerHTML = '<div style="grid-column: 1/-1; padding: 24px; text-align: center; border: 1px dashed var(--border); border-radius: 8px; color: var(--text2);">No arm ports detected. Please connect them and refresh.</div>';
      return;
    }

    const roles = {
      '(none)': 'Not used (skip this arm)',
      'follower_arm_1': 'Follower Arm 1',
      'follower_arm_2': 'Follower Arm 2',
      'leader_arm_1': 'Leader Arm 1',
      'leader_arm_2': 'Leader Arm 2',
    };

    el.innerHTML = this.arms.map((arm) => {
      const serial = arm.serial || '';
      const currentRole = serial ? (this.armAssignments[serial] || '(none)') : '(none)';
      const options = Object.entries(roles).map(([val, label]) => {
        const selected = val === currentRole ? 'selected' : '';
        return `<option value="${val}" ${selected}>${label}</option>`;
      }).join('');

      return `<div class="arm-card" style="box-shadow: 0 2px 8px rgba(0,0,0,0.2); border: 1px solid var(--border); border-radius: 8px; padding: 14px; background: var(--bg-card);">
        <div style="font-weight: 600; margin-bottom: 8px;">/dev/${arm.device}</div>
        <div class="muted" style="font-size: 12px; margin-bottom: 10px;">Serial: <code>${serial || 'N/A'}</code></div>
        <select ${serial ? '' : 'disabled'} style="width:100%;" onchange="DeviceSetupTab.assignArm('${serial}', this.value)">
          ${options}
        </select>
        ${serial ? '' : '<div style="color: var(--red); font-size: 11px; margin-top: 8px;">Cannot map this arm: serial number not available.</div>'}
      </div>`;
    }).join('');
  },

   togglePreview(idx, device) {
     const wrap = document.getElementById(`cam-wrap-${idx}`);
     const existing = wrap.querySelector('img');
     if (existing) {
       const vid = device.replace('/dev/', '');
       FeedManager._stopWatcher(vid);
       wrap.removeAttribute('data-vid');
        wrap.innerHTML = '<div style="position:absolute;top:8px;left:8px;padding:3px 8px;border-radius:999px;background:rgba(0,0,0,0.55);color:#fff;font-size:11px;font-weight:600;letter-spacing:0.2px;">Preview 144p · 5fps</div><button class="btn-primary" style="opacity: 0.9; padding: 10px 20px; font-size: 14px; border-radius: 20px; pointer-events: none;">▶ View Preview</button>';
     } else {
       const vid = device.replace('/dev/', '');
       wrap.dataset.vid = vid;
        wrap.innerHTML = `<img src="/stream/${vid}?preview=1" alt="stream" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;" onload="FeedManager._onLoad(this)" onerror="FeedManager._onError(this)" /><div class="feed-loading" id="fload-${vid}"><div class="feed-spinner"></div></div><div class="feed-live-badge" id="flive-${vid}"><div class="feed-live-dot"></div>LIVE</div><div class="feed-fps-badge" id="ffps-${vid}"></div><div class="feed-stalled" id="fstall-${vid}" style="display:none"><span class="feed-stalled-text">⏸ Feed stalled</span><button class="btn-xs feed-overlay-btn" onclick="FeedManager.retry('${vid}')">↺ Retry</button></div>`;
       FeedManager._startWatcher(vid);
     }
   },

  assign(kernels, role) {
    if (kernels) this.assignments[kernels] = role;
    this.validateAssignments();
    this.scheduleRulesApply();
  },

  assignArm(serial, role) {
    if (!serial) return;
    this.armAssignments[serial] = role;
    this.validateAssignments();
    this.scheduleRulesApply();
  },

  validateAssignments() {
    const roleCounts = {};
    const duplicates = new Set();
    
    for (const [kernels, role] of Object.entries(this.assignments)) {
      if (role && role !== '(none)') {
        if (roleCounts[role]) {
          roleCounts[role].push(kernels);
          duplicates.add(role);
        } else {
          roleCounts[role] = [kernels];
        }
      }
    }
    
    const cards = document.querySelectorAll('.cam-card');
    cards.forEach((card, idx) => {
      const cam = this.cameras[idx];
      if (!cam) return;
      
      const select = card.querySelector('select');
      const existingError = card.querySelector('.dup-error');
      const role = this.assignments[cam.kernels];
      
      if (role && role !== '(none)' && duplicates.has(role)) {
        select.style.borderColor = 'var(--red)';
        select.style.background = 'rgba(248,81,73,0.1)';
        
        if (!existingError) {
          const errorDiv = document.createElement('div');
          errorDiv.className = 'dup-error';
          errorDiv.style.cssText = 'color:var(--red); font-size:11px; margin-top:6px; padding:4px 8px; background:rgba(248,81,73,0.1); border-radius:4px;';
          errorDiv.textContent = `⚠️ "${role}" is assigned to multiple cameras`;
          select.parentNode.appendChild(errorDiv);
        }
      } else {
        select.style.borderColor = 'var(--border)';
        select.style.background = 'var(--bg-app)';
        if (existingError) existingError.remove();
      }
    });

    const armRoleCounts = {};
    const armDuplicates = new Set();
    for (const [serial, role] of Object.entries(this.armAssignments)) {
      if (!role || role === '(none)') continue;
      if (armRoleCounts[role]) {
        armRoleCounts[role].push(serial);
        armDuplicates.add(role);
      } else {
        armRoleCounts[role] = [serial];
      }
    }

    const armCards = document.querySelectorAll('.arm-card');
    armCards.forEach((card, idx) => {
      const arm = this.arms[idx];
      if (!arm || !arm.serial) return;
      const select = card.querySelector('select');
      if (!select) return;

      const existingError = card.querySelector('.dup-error');
      const role = this.armAssignments[arm.serial];
      if (role && role !== '(none)' && armDuplicates.has(role)) {
        select.style.borderColor = 'var(--red)';
        select.style.background = 'rgba(248,81,73,0.1)';
        if (!existingError) {
          const errorDiv = document.createElement('div');
          errorDiv.className = 'dup-error';
          errorDiv.style.cssText = 'color:var(--red); font-size:11px; margin-top:6px; padding:4px 8px; background:rgba(248,81,73,0.1); border-radius:4px;';
          errorDiv.textContent = `⚠️ "${role}" is assigned to multiple arms`;
          card.appendChild(errorDiv);
        }
      } else {
        select.style.borderColor = 'var(--border)';
        select.style.background = 'var(--bg-app)';
        if (existingError) existingError.remove();
      }
    });
    
    return duplicates.size === 0 && armDuplicates.size === 0;
  },

  hasDuplicateAssignments() {
    const roles = Object.values(this.assignments).filter(r => r && r !== '(none)');
    const armRoles = Object.values(this.armAssignments).filter(r => r && r !== '(none)');
    return new Set(roles).size !== roles.length || new Set(armRoles).size !== armRoles.length;
  },

  scheduleRulesApply(delay = 250) {
    if (this.hasDuplicateAssignments()) return;
    if (this.rulesApplyTimer !== null) clearTimeout(this.rulesApplyTimer);
    this.rulesApplyTimer = setTimeout(() => {
      this.rulesApplyTimer = null;
      this.previewRules();
    }, delay);
  },

  toggleRulesPanel() {
    const panel = document.getElementById('rules-advanced-panel');
    const icon = document.getElementById('rules-toggle-icon');
    if (panel.style.display === 'none') {
      panel.style.display = 'block';
      icon.textContent = '▼';
      this.showCurrent();
    } else {
      panel.style.display = 'none';
      icon.textContent = '▶';
    }
  },

  async previewRules() {
    const res = await api.post('/api/rules/preview', {
      assignments: this.assignments,
      arm_assignments: this.armAssignments,
    });
    this.renderReadableRules(res.content);
    this.refreshRulesStatus();
  },

  async applyRules({ silent = false } = {}) {
    if (this.hasDuplicateAssignments()) {
      if (!silent) {
        alert('Fix duplicate role assignments before applying mapping.');
      }
      return;
    }

    const res = await api.post('/api/rules/apply', {
      assignments: this.assignments,
      arm_assignments: this.armAssignments,
    });
    this.installCommands = Array.isArray(res.manual_commands) ? res.manual_commands : [];
    if (!res.ok && !silent) {
      const detail = res.error ? `\n\n${res.error}` : '';
      alert(`Failed to apply mapping directly.${detail}`);
      showToast('Direct apply failed. Use CLI install commands.', 'error');
    } else if (res.ok) {
      showToast('Mapping rules applied.', 'success');
      this.showCurrent();
    }
    this.refreshRulesStatus();
  },

  async refreshRulesStatus() {
    const statusEl = document.getElementById('rules-install-status');
    const hintEl = document.getElementById('rules-install-hint');
    if (!statusEl || !hintEl) return;

    try {
      const res = await api.get('/api/rules/status');
      this.rulesStatus = res;
      this.installCommands = Array.isArray(res.manual_commands) ? res.manual_commands : [];
      const rulesInstalled = !!res.rules_installed;
      const sudoNoninteractive = !!res.sudo_noninteractive;
      const needsRootForInstall = !rulesInstalled && !sudoNoninteractive;

      if (rulesInstalled) {
        statusEl.textContent = `udev rules installed at ${res.rules_path} (install-udev not required now)`;
        statusEl.style.color = 'var(--green)';
      } else if (needsRootForInstall) {
        statusEl.textContent = 'udev rules are not installed. Root permission is required. Run: lerobot-studio install-udev';
        statusEl.style.color = 'var(--yellow)';
      } else {
        statusEl.textContent = `udev rules are not installed (${res.rules_path}). Apply Rules or run: lerobot-studio install-udev`;
        statusEl.style.color = 'var(--yellow)';
      }

      const cmdText = this.installCommands.length
        ? this.installCommands.join('\n')
        : 'No manual commands available.';
      hintEl.textContent =
        `Recommended command: lerobot-studio install-udev\n` +
        `Fallback rules file: ${res.fallback_rules_path}\n\n` +
        `Note: [MISSING] symlink entries are normal for devices that are not currently connected.\n\n` +
        `Manual commands:\n${cmdText}`;
      SidebarSignals.scheduleRefresh(0);
    } catch (err) {
      statusEl.textContent = 'Failed to read udev install status';
      statusEl.style.color = 'var(--red)';
      hintEl.textContent = String(err || 'Unknown error');
      SidebarSignals.scheduleRefresh(0);
    }
  },

  copyInstallCommands() {
    const cmds = this.installCommands.length
      ? this.installCommands
      : ['lerobot-studio install-udev'];
    const text = cmds.join('\n');

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => showToast('Install commands copied.', 'success'))
        .catch(() => {
          showToast('Clipboard unavailable. Commands shown in mapping panel.', 'error');
        });
      return;
    }
    showToast('Clipboard unavailable. Commands shown in mapping panel.', 'error');
  },

  async showCurrent() {
    const res = await api.get('/api/rules/current');
    this.renderReadableRules(res.content);
  },

  renderReadableRules(content) {
    const readable = document.getElementById('rules-readable');
    if (!readable) return;

    const lines = (content || '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));

    const cameraRules = [];
    const armRules = [];

    for (const line of lines) {
      if (line.includes('SUBSYSTEM=="video4linux"')) {
        const kernel = (line.match(/KERNELS=="([^"]+)"/) || [null, '?'])[1];
        const link = (line.match(/SYMLINK\+="([^"]+)"/) || [null, '?'])[1];
        const mode = (line.match(/MODE="([^"]+)"/) || [null, '?'])[1];
        cameraRules.push({ kernel, link, mode });
      } else if (line.includes('SUBSYSTEM=="tty"')) {
        const serial = (line.match(/ATTRS\{serial\}=="([^"]+)"/) || [null, '?'])[1];
        const link = (line.match(/SYMLINK\+="([^"]+)"/) || [null, '?'])[1];
        const mode = (line.match(/MODE="([^"]+)"/) || [null, '?'])[1];
        armRules.push({ serial, link, mode });
      }
    }

    const section = (title, items, keyLabel, keyField) => {
      if (!items.length) {
        return `
          <div class="rules-section">
            <div class="rules-section-title">${title}</div>
            <div class="rules-empty">No ${title.toLowerCase()} found.</div>
          </div>
        `;
      }
      return `
        <div class="rules-section">
          <div class="rules-section-title">${title}</div>
          <div class="rules-table-wrap" style="overflow-x:auto; border:1px solid var(--border); border-radius:6px; background:var(--bg2);">
            <table style="width:100%; border-collapse:collapse; text-align:left; font-size:12px;">
              <thead>
                <tr style="border-bottom:1px solid var(--border); background:var(--bg3);">
                  <th style="padding:8px 12px; color:var(--text2); font-weight:600;">${keyLabel}</th>
                  <th style="padding:8px 12px; color:var(--text2); font-weight:600;">SYMLINK</th>
                  <th style="padding:8px 12px; color:var(--text2); font-weight:600;">MODE</th>
                </tr>
              </thead>
              <tbody>
                ${items.map((r, i) => `
                  <tr style="\${i !== items.length - 1 ? 'border-bottom:1px solid var(--border);' : ''}">
                    <td style="padding:8px 12px; font-family:var(--mono);">${r[keyField]}</td>
                    <td style="padding:8px 12px; font-family:var(--mono); color:var(--text); font-weight:600;">${r.link}</td>
                    <td style="padding:8px 12px; font-family:var(--mono); color:var(--text2);">${r.mode}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    };

    if (!cameraRules.length && !armRules.length) {
      readable.innerHTML = '<div class="rules-empty" style="color:var(--text2); text-align:center; padding:24px;">No rules found or rules could not be parsed.</div>';
      return;
    }

    readable.innerHTML = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start;">
        ${section('Camera Rules', cameraRules, 'USB PORT (KERNELS)', 'kernel')}
        ${section('Arm Rules', armRules, 'SERIAL', 'serial')}
      </div>
    `;
  },

  async loadStreamSettings() {
    const s = await api.get('/api/camera_settings');
    const codecStr = s.codec || 'MJPG';
    const resStr = `${s.width}x${s.height}`;
    const fps = s.fps || 30;
    const q = s.jpeg_quality || 70;

    document.querySelectorAll('.cam-codec-sync').forEach(el => el.value = codecStr);
    document.querySelectorAll('.cam-resolution-sync').forEach(el => el.value = resStr);
    updateFpsOptions();
    document.querySelectorAll('.cam-fps-sync').forEach(el => el.value = String(fps));
    document.querySelectorAll('.cam-jpeg-quality-sync').forEach(el => el.value = q);
    document.querySelectorAll('.cam-quality-val-sync').forEach(el => el.textContent = q);
    document.querySelectorAll('.feed-fps-badge').forEach(el => {
      el.textContent = `${fps} fps`;
      el.classList.add('visible');
    });
  },

  scheduleStreamApply(delay = 250) {
    if (this.streamApplyTimer !== null) clearTimeout(this.streamApplyTimer);
    this.streamApplyTimer = setTimeout(() => {
      this.streamApplyTimer = null;
      this.applyStreamSettings();
    }, delay);
  },

  initStreamControls() {
    const codecEls = document.querySelectorAll('.cam-codec-sync');
    const resEls = document.querySelectorAll('.cam-resolution-sync');
    const fpsEls = document.querySelectorAll('.cam-fps-sync');
    const qEls = document.querySelectorAll('.cam-jpeg-quality-sync');

    codecEls.forEach(el => {
      el.addEventListener('change', () => {
        codecEls.forEach(x => x.value = el.value);
        updateFpsOptions();
        this.scheduleStreamApply(0);
      });
    });

    resEls.forEach(el => {
      el.addEventListener('change', () => {
        resEls.forEach(x => x.value = el.value);
        updateFpsOptions();
        this.scheduleStreamApply(0);
      });
    });

    fpsEls.forEach(el => {
      el.addEventListener('change', () => {
        fpsEls.forEach(x => x.value = el.value);
        this.scheduleStreamApply(200);
      });
    });

    qEls.forEach(el => {
      el.addEventListener('input', () => {
        qEls.forEach(x => x.value = el.value);
        document.querySelectorAll('.cam-quality-val-sync').forEach(x => x.textContent = el.value);
      });
      el.addEventListener('change', () => this.scheduleStreamApply(200));
    });
  },

  async applyStreamSettings() {
    const codecEl = document.querySelector('.cam-codec-sync');
    const resEl = document.querySelector('.cam-resolution-sync');
    const fpsEl = document.querySelector('.cam-fps-sync');
    const qEl = document.querySelector('.cam-jpeg-quality-sync');

    if (!codecEl || !resEl || !fpsEl || !qEl) return;

    const [w, h] = resEl.value.split('x').map(Number);
    const body = {
      codec:        codecEl.value,
      width:        w,
      height:       h,
      fps:          parseInt(fpsEl.value, 10),
      jpeg_quality: parseInt(qEl.value, 10),
    };

    FeedManager.suppressStall(8000);
    const res = await api.post('/api/camera_settings', body);

    if (res.ok) {
      document.querySelectorAll('.feed-card').forEach(card => {
        const vid = card.dataset.vid;
        if (!vid || FeedManager._paused.has(vid)) return;
        const loadEl = document.getElementById(`fload-${vid}`);
        if (loadEl) {
           loadEl.innerHTML = '<div class="feed-spinner"></div>';
           loadEl.style.display = 'flex';
        }
        const img = card.querySelector('img');
        if (img) img.src = `/stream/${vid}?_=${Date.now()}`;
      });
      
      await this.loadStreamSettings();
    }
  },
};

/* ═══════════════════════════════════════════════════════════════════════════════
   MOTOR SETUP TAB
══════════════════════════════════════════════════════════════════════════════ */
const MotorSetupTab = {
  async start() {
    const port = getVal('ms-port').trim();
    if (!port) {
      appendLog('ms-log', '[ERROR] Arm port is required.', 'error');
      return;
    }
    if (!port.startsWith('/dev/')) {
      appendLog('ms-log', '[ERROR] Port must start with /dev/ (e.g. /dev/ttyUSB0)', 'error');
      return;
    }

    const body = {
      robot_type: getVal('ms-type'),
      port:       port,
    };
    this.clearLog();
    const res = await api.post('/api/motor_setup/start', body);
    if (!res.ok) appendLog('ms-log', `[ERROR] ${res.error}`, 'error');
  },

  async stop() {
    await api.post('/api/process/motor_setup/stop');
  },

  async sendInput() {
    await sendProcessInput('motor_setup', 'ms-stdin', 'ms-log');
  },

  clearLog() { clearProcessLog('ms-log'); },

  syncBtn() {
    syncProcessButtons('motor_setup', 'ms-start-btn', 'ms-stop-btn');
  },

  async refreshArms() {
    const data = await api.get('/api/devices');
    const el   = document.getElementById('cal-arms-list');
    renderArmList(el, data.arms);
    if (data.arms.length && !getVal('cal-port')) {
      setVal('cal-port', data.arms[0].path);
    }
  },

  async refreshFiles() {
    const res = await api.get('/api/calibrate/list');
    const el = document.getElementById('cal-file-list');
    if (!res.files || !res.files.length) {
      el.innerHTML = '<div class="device-item"><span class="dname muted">No calibration files found</span></div>';
      return;
    }
    el.innerHTML = res.files.map(f => `
      <div class="device-item" style="cursor:pointer; flex-wrap:wrap; position:relative;" onclick="CalibrateTab.selectFile('${f.id}', '${f.guessed_type}')">
        <span class="dot green"></span>
        <div style="flex:1;">
          <div class="dname">${f.id}</div>
          <div class="dsub">${f.modified}</div>
        </div>
        <button class="btn-xs" style="position:absolute; right:12px; top:12px;">Load</button>
      </div>
    `).join('');
  },

  selectFile(id, guessedType) {
    setVal('cal-id', id);
    setVal('cal-type', guessedType);
    this.checkFile();
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   TRAIN TAB
══════════════════════════════════════════════════════════════════════════════ */
const TrainTab = {
  datasetSource: 'local',
  preflightOk: true,
  preflightReason: '',
  preflightAction: '',
  preflightCommand: '',
  progressRunning: false,
  progressHadError: false,
  progressTotalSteps: null,
  progressCurrentStep: null,
  progressLoss: null,
  progressLr: null,
  progressStartMs: null,
  lossHistory: [],
  lossHistoryMax: 180,

  applyConfig(cfg) {
    const savedSource = cfg && cfg.train_dataset_source === 'hf' ? 'hf' : 'local';
    this.setDatasetSource(savedSource, false);
    setVal('train-policy', cfg.train_policy || 'act');
    setVal('train-steps', String(cfg.train_steps || 100000));
    setVal('train-device', cfg.train_device || 'cuda');
    setVal('train-repo', cfg.train_repo_id || 'user/my-dataset');
  },

  getDatasetSource() {
    return this.datasetSource;
  },

  setDatasetSource(source, persist = true) {
    const next = source === 'hf' ? 'hf' : 'local';
    this.datasetSource = next;

    const localBtn = document.getElementById('train-source-local');
    const hfBtn = document.getElementById('train-source-hf');
    const localWrap = document.getElementById('train-local-wrap');
    const hfWrap = document.getElementById('train-hf-wrap');
    const err = document.getElementById('train-repo-error');

    if (localBtn) localBtn.classList.toggle('active', next === 'local');
    if (hfBtn) hfBtn.classList.toggle('active', next === 'hf');
    if (localWrap) localWrap.classList.toggle('hidden', next !== 'local');
    if (hfWrap) hfWrap.classList.toggle('hidden', next !== 'hf');
    if (err) err.style.display = 'none';

    if (persist && state.config) {
      state.config.train_dataset_source = next;
      saveConfig();
    }

    this.syncRepoFromSource();
  },

  syncRepoFromSource() {
    if (this.getDatasetSource() !== 'local') return;
    const select = document.getElementById('train-local-repo');
    const input = document.getElementById('train-repo');
    if (!select || !input) return;
    const value = select.value.trim();
    if (value && value !== '__none__') {
      input.value = value;
    }
  },

  validateRepoId() {
    const source = this.getDatasetSource();
    const val = getVal('train-repo').trim();
    const input = document.getElementById('train-repo');
    const localSelect = document.getElementById('train-local-repo');
    const err = document.getElementById('train-repo-error');

    if (source === 'local') {
      const localRepoId = localSelect ? localSelect.value.trim() : '';
      if (!localRepoId || localRepoId === '__none__') {
        if (localSelect) localSelect.style.borderColor = 'var(--red)';
        if (err) {
          err.textContent = 'No local dataset found. Switch to Hugging Face or create a local dataset first.';
          err.style.display = 'block';
        }
        return false;
      }
      if (localSelect) localSelect.style.borderColor = 'var(--border)';
      if (input) input.style.borderColor = 'var(--border)';
      if (err) err.style.display = 'none';
      return true;
    }

    if (!val) {
      input.style.borderColor = 'var(--red)';
      if (err) { err.textContent = 'Repo ID cannot be empty'; err.style.display = 'block'; }
      return false;
    }
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(val)) {
      input.style.borderColor = 'var(--red)';
      if (err) { err.textContent = 'Must be in format: username/dataset-name'; err.style.display = 'block'; }
      return false;
    }
    input.style.borderColor = 'var(--border)';
    if (err) err.style.display = 'none';
    return true;
  },

  async refreshDatasets() {
    try {
      const res = await api.get('/api/datasets');
      const select = document.getElementById('train-local-repo');
      const datasets = Array.isArray(res.datasets) ? res.datasets : [];
      if (select) {
        if (datasets.length) {
          select.innerHTML = datasets.map(ds => `<option value="${ds.id}">${ds.id}</option>`).join('');
          select.disabled = false;
          if (!datasets.some(ds => ds.id === select.value)) {
            select.value = datasets[0].id;
          }
        } else {
          select.innerHTML = '<option value="__none__">No local datasets found</option>';
          select.value = '__none__';
          select.disabled = true;
        }
      }

      if (datasets.length === 0 && this.getDatasetSource() === 'local') {
        this.setDatasetSource('hf');
      } else {
        this.syncRepoFromSource();
      }
      this.validateRepoId();
    } catch (e) {
      console.warn("Failed to load datasets for train tab", e);
    }
  },

  async start() {
    this.clearLog();
    this.resetProgress('starting');

    try {
      if (!(await this.refreshPreflight())) {
        appendLog('train-log', '[ERROR] Device compatibility check failed. See warning above.', 'error');
        this.setProgressStatus('blocked');
        return;
      }

      if (!this.validateRepoId()) {
        appendLog('train-log', '[ERROR] Invalid dataset selection. Check Dataset Source and Repo ID.', 'error');
        this.setProgressStatus('blocked');
        return;
      }

      const repoId = this.getDatasetSource() === 'local'
        ? (document.getElementById('train-local-repo')?.value || '').trim()
        : getVal('train-repo').trim();

      const body = {
        train_policy: getVal('train-policy'),
        train_repo_id: repoId,
        train_steps: parseInt(getVal('train-steps'), 10) || 100000,
        train_device: getVal('train-device'),
      };
      this.progressTotalSteps = body.train_steps;
      this.progressStartMs = Date.now();
      this.setProgressStatus('starting');
      this.updateProgressUI();

      appendLog('train-log', `[INFO] Starting training: ${body.train_policy} · ${body.train_repo_id} · ${body.train_device}`, 'info');
      const res = await api.post('/api/train/start', body);

      if (!res || !res.ok) {
        appendLog('train-log', `[ERROR] ${res?.error || 'Failed to start training process.'}`, 'error');
        this.progressHadError = true;
        this.setProgressStatus('error');
        return;
      }

      appendLog('train-log', '[INFO] Train process started. Waiting for logs...', 'info');
      this.progressRunning = true;
      this.setProgressStatus('running');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendLog('train-log', `[ERROR] Start request failed: ${msg}`, 'error');
      console.error('Train start failed', e);
      this.progressHadError = true;
      this.setProgressStatus('error');
    }
  },

  async stop() {
    await api.post('/api/process/train/stop');
    this.progressRunning = false;
    this.setProgressStatus('stopped');
  },

  async onDeviceChange() {
    await this.refreshPreflight();
  },

  applyPreflightResult(res) {
    const startBtn = document.getElementById('train-start-btn');
    const warn = document.getElementById('train-device-warning');
    const actionWrap = document.getElementById('train-device-actions');
    const actionBtn = document.getElementById('train-install-btn');
    const ok = !!(res && res.ok);
    const reason = (res && res.reason) ? String(res.reason) : '';
    this.preflightOk = ok;
    this.preflightReason = reason;
    this.preflightAction = (res && res.action) ? String(res.action) : '';
    this.preflightCommand = (res && res.command) ? String(res.command) : '';
    if (ModeManager.mode === 'guided') {
      ModeManager.mlReady = ok;
      ModeManager.applyMode();
    }

    if (startBtn) {
      startBtn.disabled = !ok;
      startBtn.title = ok ? '' : reason;
    }

    if (warn) {
      if (ok) {
        warn.classList.add('hidden');
        warn.textContent = '';
      } else {
        warn.classList.remove('hidden');
        warn.textContent = reason;
      }
    }

    if (actionWrap) {
      const canInstall = !ok && this.preflightAction === 'install_torch_cuda';
      actionWrap.classList.toggle('hidden', !canInstall);
      if (actionBtn) {
        actionBtn.disabled = !canInstall;
        actionBtn.title = canInstall && this.preflightCommand ? this.preflightCommand : '';
      }
    }

    if (!ok && (getVal('train-device').trim() || 'cuda') === 'cuda') {
      this.setProgressStatus('blocked');
    }
    SidebarSignals.scheduleRefresh(0);
  },

  async refreshPreflight() {
    const device = getVal('train-device').trim() || 'cuda';
    try {
      const res = await api.get(`/api/train/preflight?device=${encodeURIComponent(device)}`);
      this.applyPreflightResult(res);
      return !!res.ok;
    } catch (e) {
      this.applyPreflightResult({ ok: false, reason: 'Failed to run device compatibility preflight. Check server status.' });
      return false;
    }
  },

  ingestInstallerLog(line, kind = 'stdout') {
    if (!line) return;
    if (/\[ERROR\]|Traceback|RuntimeError|Exception/i.test(line) || kind === 'error') {
      this.setProgressStatus('error');
    }
    if (/\[train_install process ended\]/i.test(line)) {
      appendLog('train-log', '[INFO] Installer finished. Re-checking CUDA compatibility...', 'info');
      this.refreshPreflight();
    }
  },

  ingestMetric(metric) {
    if (!metric || typeof metric !== 'object') return;

    const total = Number(metric.total_steps);
    if (Number.isFinite(total) && total > 0) {
      this.progressTotalSteps = Math.floor(total);
    }

    const step = Number(metric.step);
    if (Number.isFinite(step) && step >= 0) {
      this.progressCurrentStep = Math.floor(step);
      if (!this.progressStartMs) this.progressStartMs = Date.now();
      this.progressRunning = true;
      if (!this.progressHadError) this.setProgressStatus('running');
    }

    const loss = Number(metric.loss);
    if (Number.isFinite(loss)) {
      this.progressLoss = loss;
      this.lossHistory.push(loss);
      if (this.lossHistory.length > this.lossHistoryMax) {
        this.lossHistory = this.lossHistory.slice(-this.lossHistoryMax);
      }
      this.renderLossCanvas();
    }

    const lr = Number(metric.lr);
    if (Number.isFinite(lr)) {
      this.progressLr = lr;
    }

    this.updateProgressUI();
  },

  async installCudaTorch() {
    if (this.preflightAction !== 'install_torch_cuda') return;
    const ok = confirm('Install/upgrade PyTorch CUDA build in the current environment now? This may take several minutes.');
    if (!ok) return;

    appendLog('train-log', '[INFO] Starting PyTorch installer from GUI...', 'info');
    if (this.preflightCommand) {
      appendLog('train-log', `[INFO] Command: ${this.preflightCommand}`, 'info');
    }

    const res = await api.post('/api/train/install_pytorch', { nightly: true, cuda_tag: 'cu128' });
    if (!res || !res.ok) {
      appendLog('train-log', `[ERROR] ${res?.error || 'Failed to start installer process.'}`, 'error');
      return;
    }

    appendLog('train-log', '[INFO] Installer process started. Follow logs below. Training is disabled until compatibility is restored.', 'info');
  },

  ingestLogLine(line, kind = 'stdout') {
    if (!line) return;

    if (/\[ERROR\]|Traceback|RuntimeError|CUDA error|Exception/i.test(line) || kind === 'error') {
      this.progressHadError = true;
      this.setProgressStatus('error');
    }

    const totalMatch = line.match(/cfg\.steps=([0-9_,]+)/);
    if (totalMatch) {
      const total = parseInt(totalMatch[1].replace(/[, _]/g, ''), 10);
      if (Number.isFinite(total) && total > 0) this.progressTotalSteps = total;
    }

    const stepMatch = line.match(/step:([0-9]+(?:\.[0-9]+)?[KMBTQ]?)/i);
    if (stepMatch) {
      const parsed = this.parseCompactNumber(stepMatch[1]);
      if (Number.isFinite(parsed)) {
        this.progressCurrentStep = Math.max(0, Math.floor(parsed));
        if (!this.progressStartMs) this.progressStartMs = Date.now();
        this.progressRunning = true;
        if (!this.progressHadError) this.setProgressStatus('running');
      }
    }

    const lossMatch = line.match(/\bloss:([+-]?[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)/i);
    if (lossMatch) {
      const loss = Number(lossMatch[1]);
      if (Number.isFinite(loss)) this.progressLoss = loss;
    }

    if (/Start offline training/i.test(line)) {
      this.progressRunning = true;
      if (!this.progressHadError) this.setProgressStatus('running');
    }
    if (/End of training/i.test(line)) {
      this.progressRunning = false;
      if (!this.progressHadError) this.setProgressStatus('completed');
    }
    if (/\[train process ended\]/i.test(line)) {
      this.progressRunning = false;
      if (this.progressHadError) this.setProgressStatus('error');
      else if (this.progressCurrentStep && this.progressTotalSteps && this.progressCurrentStep >= this.progressTotalSteps) this.setProgressStatus('completed');
      else this.setProgressStatus('stopped');
    }

    this.updateProgressUI();
  },

  parseCompactNumber(token) {
    if (!token) return NaN;
    const raw = String(token).trim().toUpperCase();
    const m = raw.match(/^([0-9]+(?:\.[0-9]+)?)([KMBTQ]?)$/);
    if (!m) return Number(raw.replace(/,/g, ''));
    const base = Number(m[1]);
    const expMap = { '': 0, K: 1, M: 2, B: 3, T: 4, Q: 5 };
    return base * (1000 ** (expMap[m[2]] ?? 0));
  },

  formatEta(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '--';
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${ss}s`;
    return `${ss}s`;
  },

  setProgressStatus(status) {
    const el = document.getElementById('train-progress-status');
    if (!el) return;
    const map = {
      idle: { label: 'IDLE', bg: 'rgba(148,163,184,0.18)', color: 'var(--text2)' },
      starting: { label: 'STARTING', bg: 'rgba(59,130,246,0.18)', color: '#93c5fd' },
      running: { label: 'RUNNING', bg: 'rgba(34,197,94,0.18)', color: '#86efac' },
      blocked: { label: 'BLOCKED', bg: 'rgba(245,158,11,0.20)', color: '#fcd34d' },
      stopped: { label: 'STOPPED', bg: 'rgba(148,163,184,0.18)', color: 'var(--text2)' },
      completed: { label: 'COMPLETED', bg: 'rgba(16,185,129,0.20)', color: '#6ee7b7' },
      error: { label: 'ERROR', bg: 'rgba(248,81,73,0.20)', color: '#fca5a5' },
    };
    const preset = map[status] || map.idle;
    el.textContent = preset.label;
    el.style.background = preset.bg;
    el.style.color = preset.color;
  },

  updateProgressUI() {
    const fill = document.getElementById('train-progress-fill');
    const stepEl = document.getElementById('train-progress-step');
    const lossEl = document.getElementById('train-progress-loss');
    const etaEl = document.getElementById('train-progress-eta');

    let pct = 0;
    const cur = Number.isFinite(this.progressCurrentStep) ? this.progressCurrentStep : null;
    const total = Number.isFinite(this.progressTotalSteps) ? this.progressTotalSteps : null;
    if (cur !== null && total && total > 0) {
      pct = Math.max(0, Math.min(100, (cur / total) * 100));
    }

    if (fill) fill.style.width = `${pct}%`;
    if (stepEl) {
      stepEl.textContent = `Step: ${cur !== null ? cur.toLocaleString() : '--'} / ${total ? total.toLocaleString() : '--'}`;
    }
    if (lossEl) {
      const lossTxt = Number.isFinite(this.progressLoss) ? this.progressLoss.toFixed(4) : '--';
      const lrTxt = Number.isFinite(this.progressLr) ? this.progressLr.toExponential(2) : null;
      lossEl.textContent = lrTxt ? `Loss: ${lossTxt} (lr ${lrTxt})` : `Loss: ${lossTxt}`;
    }

    if (etaEl) {
      let eta = '--';
      if (this.progressRunning && cur !== null && total && total > cur && this.progressStartMs) {
        const elapsed = (Date.now() - this.progressStartMs) / 1000;
        if (elapsed > 0 && cur > 0) {
          const sps = cur / elapsed;
          if (sps > 0) eta = this.formatEta((total - cur) / sps);
        }
      }
      etaEl.textContent = `ETA: ${eta}`;
    }
  },

  renderLossCanvas() {
    const canvas = document.getElementById('train-loss-canvas');
    if (!canvas || !(canvas instanceof HTMLCanvasElement)) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(canvas.clientWidth || canvas.width));
    const h = Math.max(1, Math.floor(canvas.clientHeight || canvas.height));
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const data = this.lossHistory;
    if (!data.length) {
      ctx.fillStyle = 'rgba(148,163,184,0.7)';
      ctx.font = '12px monospace';
      ctx.fillText('No loss data yet', 10, 18);
      return;
    }

    let min = Infinity;
    let max = -Infinity;
    for (const v of data) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;
    if (min === max) {
      min -= 1;
      max += 1;
    }

    const pad = 8;
    const iw = w - pad * 2;
    const ih = h - pad * 2;

    ctx.strokeStyle = 'rgba(148,163,184,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(pad, pad, iw, ih);

    ctx.beginPath();
    for (let i = 0; i < data.length; i += 1) {
      const x = pad + (i / Math.max(1, data.length - 1)) * iw;
      const y = pad + ih - ((data[i] - min) / (max - min)) * ih;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#86efac';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const last = data[data.length - 1];
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '11px monospace';
    ctx.fillText(`min ${min.toFixed(4)}  max ${max.toFixed(4)}  last ${last.toFixed(4)}`, pad + 4, pad + 14);
  },

  resetProgress(status = 'idle') {
    this.progressRunning = false;
    this.progressHadError = false;
    this.progressTotalSteps = null;
    this.progressCurrentStep = null;
    this.progressLoss = null;
    this.progressLr = null;
    this.progressStartMs = null;
    this.lossHistory = [];
    this.setProgressStatus(status);
    this.updateProgressUI();
    this.renderLossCanvas();
  },

  clearLog() { clearProcessLog('train-log'); },

  syncBtn() {
    syncProcessButtons('train', 'train-start-btn', 'train-stop-btn');
    const running = !!state.procStatus.train;
    if (running && !this.progressRunning) {
      this.progressRunning = true;
      if (!this.progressHadError) this.setProgressStatus('running');
    }
    if (!running && this.progressRunning) {
      this.progressRunning = false;
      if (this.progressHadError) this.setProgressStatus('error');
      else if (this.progressCurrentStep && this.progressTotalSteps && this.progressCurrentStep >= this.progressTotalSteps) this.setProgressStatus('completed');
      else this.setProgressStatus('stopped');
    }
  },

  async refreshGpu() {
    const el = document.getElementById('train-gpu-status');
    if (!el) return;
    
    el.innerHTML = '<div class="muted">Loading GPU info...</div>';
    
    try {
      const res = await api.get('/api/gpu/status');
      if (res.exists) {
        el.innerHTML = `
          <div style="display:flex; flex-direction:column; gap:8px;">
            <div style="display:flex; justify-content:space-between;">
              <span>GPU Utilization</span>
              <span style="font-family:var(--mono); font-weight:bold;">${res.utilization}%</span>
            </div>
            <div class="usb-bus-bar-track">
              <div class="usb-bar-fill ${res.utilization > 80 ? 'danger' : res.utilization > 50 ? 'warn' : 'good'}" style="width:${res.utilization}%"></div>
            </div>
            
            <div style="display:flex; justify-content:space-between; margin-top:8px;">
              <span>VRAM Usage</span>
              <span style="font-family:var(--mono);">${res.memory_used}MB / ${res.memory_total}MB</span>
            </div>
            <div class="usb-bus-bar-track">
              <div class="usb-bar-fill ${res.memory_percent > 85 ? 'danger' : res.memory_percent > 70 ? 'warn' : 'good'}" style="width:${res.memory_percent}%"></div>
            </div>
          </div>
        `;
      } else {
        el.innerHTML = `<div class="muted">NVIDIA GPU info unavailable: ${res.error || 'Check nvidia-smi'}</div>`;
      }
    } catch (e) {
      el.innerHTML = `<div style="color:var(--red);">Failed to load GPU info</div>`;
    }
  }
};

const EvalTab = {
  runActive: false,
  hadError: false,
  runSeq: 0,
  activeRunSeq: 0,
  targetEpisodes: null,
  doneEpisodes: 0,
  successRate: null,
  meanReward: null,
  finalReward: null,
  finalSuccess: null,
  finalConfirmed: false,
  startedAtMs: null,
  endedAtMs: null,
  bestEpisode: null,
  worstEpisode: null,
  perEpisodeReward: {},

  applyConfig(cfg) {
    if (!cfg) return;
    setVal('eval-policy-path', cfg.eval_policy_path || 'outputs/train/checkpoints/last/pretrained_model');
    setVal('eval-repo-id', cfg.eval_repo_id || cfg.train_repo_id || 'user/my-dataset');
    setVal('eval-episodes', String(cfg.eval_episodes || 10));
    setVal('eval-device', cfg.eval_device || cfg.train_device || 'cuda');
    setVal('eval-task', cfg.eval_task || '');
  },

  loadDefaults() {
    if (!getVal('eval-policy-path')) {
      setVal('eval-policy-path', 'outputs/train/checkpoints/last/pretrained_model');
    }
    if (!getVal('eval-repo-id')) {
      setVal('eval-repo-id', getVal('train-repo') || 'user/my-dataset');
    }
    this.resetProgress('idle');
  },

  buildConfig() {
    return {
      eval_policy_path: getVal('eval-policy-path').trim(),
      eval_repo_id: getVal('eval-repo-id').trim(),
      eval_episodes: parseInt(getVal('eval-episodes'), 10) || 10,
      eval_device: getVal('eval-device').trim() || 'cuda',
      eval_task: getVal('eval-task').trim(),
      train_repo_id: getVal('train-repo').trim() || 'user/my-dataset',
      train_device: getVal('train-device').trim() || 'cuda',
    };
  },

  validate(cfg) {
    if (!cfg.eval_policy_path) {
      appendLog('eval-log', '[ERROR] Policy path is required.', 'error');
      return false;
    }
    if (!cfg.eval_repo_id || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(cfg.eval_repo_id)) {
      appendLog('eval-log', '[ERROR] Dataset Repo ID must be username/dataset format.', 'error');
      return false;
    }
    if (!Number.isFinite(cfg.eval_episodes) || cfg.eval_episodes < 1) {
      appendLog('eval-log', '[ERROR] Episodes must be >= 1.', 'error');
      return false;
    }
    return true;
  },

  async start() {
    this.clearLog();
    const cfg = this.buildConfig();
    if (!this.validate(cfg)) return;
    this.runSeq += 1;
    this.activeRunSeq = this.runSeq;
    this.targetEpisodes = cfg.eval_episodes;
    this.resetProgress('starting');
    this.startedAtMs = Date.now();
    this.endedAtMs = null;

    state.config.eval_policy_path = cfg.eval_policy_path;
    state.config.eval_repo_id = cfg.eval_repo_id;
    state.config.eval_episodes = cfg.eval_episodes;
    state.config.eval_device = cfg.eval_device;
    state.config.eval_task = cfg.eval_task;
    saveConfig();

    appendLog('eval-log', `[INFO] Starting eval: ${cfg.eval_repo_id} · ${cfg.eval_device} · ${cfg.eval_episodes} episodes`, 'info');
    const res = await api.post('/api/eval/start', cfg);
    if (!res.ok) {
      appendLog('eval-log', `[ERROR] ${res.error || 'Failed to start eval process.'}`, 'error');
      this.hadError = true;
      this.setProgressStatus('error');
      this.endedAtMs = Date.now();
      this.updateSummaryUI();
      return;
    }
    appendLog('eval-log', '[INFO] Eval process started.', 'info');
    this.runActive = true;
    this.setProgressStatus('running');
    this.updateSummaryUI();
  },

  async stop() {
    await api.post('/api/process/eval/stop');
    this.runActive = false;
    if (this.hadError) this.setProgressStatus('error');
    else this.setProgressStatus('stopped');
    this.endedAtMs = Date.now();
    this.updateSummaryUI();
  },

  clearLog() {
    clearProcessLog('eval-log');
  },

  ingestLogLine(line, kind = 'stdout') {
    if (!line) return;
    const endMarker = /\[eval process ended\]/i;
    const completeMarker = /evaluation complete|end of evaluation|eval complete/i;
    if (!state.procStatus.eval && !this.runActive && !endMarker.test(line) && !completeMarker.test(line)) {
      return;
    }
    if (!this.startedAtMs && state.procStatus.eval) {
      this.startedAtMs = Date.now();
    }

    if (kind === 'error' || /\[ERROR\]|Traceback|RuntimeError|Exception|failed/i.test(line)) {
      this.hadError = true;
      this.setProgressStatus('error');
    }

    const epTotalMatch = line.match(/(?:^|\s)(?:n_episodes|episodes)\s*[:=]\s*([0-9]+)/i)
      || line.match(/episode\s*\d+\s*\/\s*([0-9]+)/i)
      || line.match(/completed\s*episodes\s*[:=]\s*\d+\s*\/\s*([0-9]+)/i);
    if (epTotalMatch) {
      const total = parseInt(epTotalMatch[1], 10);
      if (Number.isFinite(total) && total > 0) this.targetEpisodes = total;
    }

    const doneMatch = line.match(/episode\s*([0-9]+)\s*\/\s*([0-9]+)/i)
      || line.match(/completed\s*episodes\s*[:=]\s*([0-9]+)\s*\/\s*([0-9]+)/i)
      || line.match(/\bepisode\s*[:#]\s*([0-9]+)\b/i);
    if (doneMatch) {
      const done = parseInt(doneMatch[1], 10);
      if (Number.isFinite(done) && done >= 0) {
        this.doneEpisodes = Math.max(this.doneEpisodes || 0, done);
        this.runActive = true;
        if (!this.hadError) this.setProgressStatus('running');
      }
      if (doneMatch[2]) {
        const total = parseInt(doneMatch[2], 10);
        if (Number.isFinite(total) && total > 0) this.targetEpisodes = total;
      }
    }

    const successMatch = line.match(/\bsuccess(?:[_\s-]?rate)?\s*[:=]\s*([0-9]*\.?[0-9]+)\s*%?/i);
    if (successMatch) {
      const raw = Number(successMatch[1]);
      if (Number.isFinite(raw)) {
        this.successRate = raw > 1 ? Math.min(100, raw) : Math.max(0, raw * 100);
      }
    }

    const rewardMatch = line.match(/\b(?:mean[_\s-]?reward|avg[_\s-]?reward|episode[_\s-]?reward)\s*[:=]\s*([+-]?[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)/i);
    if (rewardMatch) {
      const reward = Number(rewardMatch[1]);
      if (Number.isFinite(reward)) this.meanReward = reward;

      const epForReward = line.match(/episode\s*([0-9]+)\b/i);
      if (epForReward) {
        const epIdx = parseInt(epForReward[1], 10);
        if (Number.isFinite(epIdx)) {
          this.perEpisodeReward[epIdx] = reward;
          this.recomputeBestWorst();
        }
      }
    }

    const finalRewardMatch = line.match(/(?:final|overall|eval)\s*(?:mean[_\s-]?reward|avg[_\s-]?reward|reward)\s*[:=]\s*([+-]?[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)/i);
    if (finalRewardMatch) {
      const v = Number(finalRewardMatch[1]);
      if (Number.isFinite(v)) this.finalReward = v;
    }

    const finalSuccessMatch = line.match(/(?:final|overall|eval)\s*(?:success(?:[_\s-]?rate)?)\s*[:=]\s*([0-9]*\.?[0-9]+)\s*%?/i);
    if (finalSuccessMatch) {
      const raw = Number(finalSuccessMatch[1]);
      if (Number.isFinite(raw)) {
        this.finalSuccess = raw > 1 ? Math.min(100, raw) : Math.max(0, raw * 100);
      }
    }

    if (completeMarker.test(line)) {
      this.runActive = false;
      if (this.hadError) this.setProgressStatus('error');
      else this.setProgressStatus('completed');
      if (!Number.isFinite(this.finalReward) && Number.isFinite(this.meanReward)) this.finalReward = this.meanReward;
      if (!Number.isFinite(this.finalSuccess) && Number.isFinite(this.successRate)) this.finalSuccess = this.successRate;
      this.finalConfirmed = this.targetEpisodes ? this.doneEpisodes >= this.targetEpisodes : true;
      this.endedAtMs = Date.now();
    }

    if (endMarker.test(line)) {
      this.runActive = false;
      if (this.hadError) this.setProgressStatus('error');
      else if (this.targetEpisodes && this.doneEpisodes >= this.targetEpisodes) this.setProgressStatus('completed');
      else this.setProgressStatus('stopped');
      this.endedAtMs = Date.now();
      if (!this.hadError && this.targetEpisodes && this.doneEpisodes >= this.targetEpisodes) {
        this.finalConfirmed = true;
      }
    }

    this.updateProgressUI();
    this.updateSummaryUI();
  },

  recomputeBestWorst() {
    const entries = Object.entries(this.perEpisodeReward)
      .map(([ep, reward]) => ({ ep: Number(ep), reward: Number(reward) }))
      .filter((v) => Number.isFinite(v.ep) && Number.isFinite(v.reward));
    if (!entries.length) {
      this.bestEpisode = null;
      this.worstEpisode = null;
      return;
    }
    entries.sort((a, b) => a.reward - b.reward);
    this.worstEpisode = entries[0];
    this.bestEpisode = entries[entries.length - 1];
  },

  setProgressStatus(status) {
    const el = document.getElementById('eval-progress-status');
    if (!el) return;
    const map = {
      idle: { label: 'IDLE', bg: 'rgba(148,163,184,0.18)', color: 'var(--text2)' },
      starting: { label: 'STARTING', bg: 'rgba(59,130,246,0.18)', color: '#93c5fd' },
      running: { label: 'RUNNING', bg: 'rgba(34,197,94,0.18)', color: '#86efac' },
      stopped: { label: 'STOPPED', bg: 'rgba(148,163,184,0.18)', color: 'var(--text2)' },
      completed: { label: 'COMPLETED', bg: 'rgba(16,185,129,0.20)', color: '#6ee7b7' },
      error: { label: 'ERROR', bg: 'rgba(248,81,73,0.20)', color: '#fca5a5' },
    };
    const preset = map[status] || map.idle;
    el.textContent = preset.label;
    el.style.background = preset.bg;
    el.style.color = preset.color;
  },

  updateProgressUI() {
    const fill = document.getElementById('eval-progress-fill');
    const epEl = document.getElementById('eval-progress-episodes');
    const rewardEl = document.getElementById('eval-progress-reward');
    const successEl = document.getElementById('eval-progress-success');

    const done = Number.isFinite(this.doneEpisodes) ? this.doneEpisodes : 0;
    const total = Number.isFinite(this.targetEpisodes) && this.targetEpisodes > 0 ? this.targetEpisodes : null;
    const pct = total ? Math.max(0, Math.min(100, (done / total) * 100)) : 0;

    if (fill) fill.style.width = `${pct}%`;
    if (epEl) epEl.textContent = `Episodes: ${done || '--'} / ${total || '--'}`;
    if (rewardEl) rewardEl.textContent = `Reward: ${Number.isFinite(this.meanReward) ? this.meanReward.toFixed(4) : '--'}`;
    if (successEl) successEl.textContent = `Success: ${Number.isFinite(this.successRate) ? `${this.successRate.toFixed(1)}%` : '--'}`;
  },

  updateSummaryUI() {
    const finalRewardEl = document.getElementById('eval-summary-final-reward');
    const finalSuccessEl = document.getElementById('eval-summary-final-success');
    const bestEl = document.getElementById('eval-summary-best');
    const worstEl = document.getElementById('eval-summary-worst');
    const confidenceEl = document.getElementById('eval-summary-confidence');
    const timeEl = document.getElementById('eval-summary-time');
    if (finalRewardEl) {
      finalRewardEl.textContent = `Final Reward: ${Number.isFinite(this.finalReward) ? this.finalReward.toFixed(4) : '--'}`;
    }
    if (finalSuccessEl) {
      finalSuccessEl.textContent = `Final Success: ${Number.isFinite(this.finalSuccess) ? `${this.finalSuccess.toFixed(1)}%` : '--'}`;
    }
    if (bestEl) {
      bestEl.textContent = this.bestEpisode
        ? `Best Episode: #${this.bestEpisode.ep} (${this.bestEpisode.reward.toFixed(4)})`
        : 'Best Episode: --';
    }
    if (worstEl) {
      worstEl.textContent = this.worstEpisode
        ? `Worst Episode: #${this.worstEpisode.ep} (${this.worstEpisode.reward.toFixed(4)})`
        : 'Worst Episode: --';
    }
    if (confidenceEl) {
      confidenceEl.textContent = this.finalConfirmed ? 'FINAL' : 'PARTIAL';
      confidenceEl.className = `dbadge ${this.finalConfirmed ? 'badge-ok' : 'badge-warn'}`;
    }
    if (timeEl) {
      const start = this.startedAtMs ? new Date(this.startedAtMs).toLocaleTimeString() : '--';
      const end = this.endedAtMs ? new Date(this.endedAtMs).toLocaleTimeString() : '--';
      let elapsed = '--';
      if (this.startedAtMs) {
        const endMs = this.endedAtMs || Date.now();
        const sec = Math.max(0, Math.floor((endMs - this.startedAtMs) / 1000));
        const mm = String(Math.floor(sec / 60)).padStart(2, '0');
        const ss = String(sec % 60).padStart(2, '0');
        elapsed = `${mm}:${ss}`;
      }
      timeEl.textContent = `Start ${start} · Elapsed ${elapsed} · End ${end}`;
    }
  },

  resetProgress(status = 'idle') {
    this.runActive = false;
    this.hadError = false;
    this.doneEpisodes = 0;
    this.successRate = null;
    this.meanReward = null;
    this.finalReward = null;
    this.finalSuccess = null;
    this.finalConfirmed = false;
    this.bestEpisode = null;
    this.worstEpisode = null;
    this.perEpisodeReward = {};
    this.setProgressStatus(status);
    this.updateProgressUI();
    this.updateSummaryUI();
  },

  syncBtn() {
    syncProcessButtons('eval', 'eval-start-btn', 'eval-stop-btn');
    const running = !!state.procStatus.eval;
    if (running && !this.runActive) {
      this.runActive = true;
      if (!this.hadError) this.setProgressStatus('running');
    }
    if (!running && this.runActive) {
      this.runActive = false;
      if (this.hadError) this.setProgressStatus('error');
      else if (this.targetEpisodes && this.doneEpisodes >= this.targetEpisodes) this.setProgressStatus('completed');
      else this.setProgressStatus('stopped');
    }
  },
};

/* ═══════════════════════════════════════════════════════════════════════════════
   DATASET VIEWER TAB
══════════════════════════════════════════════════════════════════════════════ */
const DatasetTab = {
  datasets: [],
  currentDataset: null,
  currentEpisode: 0,
  pushJobId: '',
  pushPollTimer: null,
  
  async refreshList() {
    const el = document.getElementById('dataset-list');
    el.innerHTML = '<div class="device-item">Loading datasets...</div>';
    try {
      const res = await api.get('/api/datasets');
      this.datasets = res.datasets || [];
      this.renderList();
      if (ModeManager.mode === 'guided') ModeManager.scheduleReadinessRefresh(0);
    } catch (e) {
      el.innerHTML = `<div class="device-item"><span style="color:var(--red)">Failed to load datasets: ${e}</span></div>`;
      if (ModeManager.mode === 'guided') ModeManager.scheduleReadinessRefresh(0);
    }
  },

  renderList() {
    const el = document.getElementById('dataset-list');
    if (!this.datasets.length) {
      el.innerHTML = '<div class="device-item"><span class="dname muted">No datasets found in cache</span></div>';
      return;
    }
    el.innerHTML = this.datasets.map(ds => `
      <div class="device-item" style="cursor:pointer; position:relative; align-items:flex-start;" onclick="DatasetTab.loadDataset('${ds.id}')">
        <div style="flex:1;">
          <div style="font-weight:600; font-size:14px; margin-bottom:4px; color:var(--text1)">${ds.id}</div>
          <div style="font-size:11px; color:var(--text2)">
            ${ds.total_episodes} episodes · ${ds.total_frames} frames · ${ds.size_mb} MB
          </div>
          <div style="font-size:11px; color:var(--text2)">Modified: ${ds.modified}</div>
        </div>
        <div style="display:flex; flex-direction:column; gap:6px; margin-top:2px;">
          <button class="btn-xs" onclick="event.stopPropagation(); DatasetTab.inspectQuality('${ds.id}')">Quality</button>
          <button class="btn-xs" onclick="event.stopPropagation(); DatasetTab.pushToHub('${ds.id}')">Push</button>
          <button class="btn-xs" style="color:var(--red); border:1px solid rgba(248,81,73,0.3);" onclick="event.stopPropagation(); DatasetTab.deleteDataset('${ds.id}')">Delete</button>
        </div>
      </div>
    `).join('');
  },

  parseId(id) {
    const parts = String(id || '').split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    return { user: parts[0], repo: parts[1] };
  },

  showPushStatus(visible) {
    const wrap = document.getElementById('ds-push-status');
    if (!wrap) return;
    wrap.style.display = visible ? 'block' : 'none';
  },

  updatePushStatus(status, phase, progress, note = '') {
    const label = document.getElementById('ds-push-label');
    const pct = document.getElementById('ds-push-percent');
    const fill = document.getElementById('ds-push-fill');
    const msg = document.getElementById('ds-push-note');
    if (label) label.textContent = `Hub Upload · ${phase || status}`;
    if (pct) pct.textContent = `${Math.max(0, Math.min(100, progress || 0))}%`;
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, progress || 0))}%`;
    if (msg) msg.textContent = note || '';
  },

  startPushPolling(jobId) {
    if (this.pushPollTimer) {
      clearInterval(this.pushPollTimer);
      this.pushPollTimer = null;
    }
    this.pushJobId = jobId;
    this.pushPollTimer = setInterval(async () => {
      if (!this.pushJobId) return;
      const res = await api.get(`/api/datasets/push/status/${encodeURIComponent(this.pushJobId)}`);
      if (!res.ok) {
        this.updatePushStatus('error', 'error', 0, res.error || 'Unknown push status error');
        if (this.pushPollTimer) clearInterval(this.pushPollTimer);
        this.pushPollTimer = null;
        return;
      }
      const status = String(res.status || 'running');
      const phase = String(res.phase || status);
      const progress = Number(res.progress || 0);
      const tail = Array.isArray(res.logs) && res.logs.length ? res.logs[res.logs.length - 1] : '';
      const note = status === 'error' ? (res.error || tail || 'Upload failed') : tail;
      this.updatePushStatus(status, phase, progress, note);

      if (status === 'success') {
        showToast(`Dataset pushed to Hub: ${res.repo_id}`, 'success');
        if (this.pushPollTimer) clearInterval(this.pushPollTimer);
        this.pushPollTimer = null;
      }
      if (status === 'error') {
        showToast(`Hub push failed: ${res.error || 'Unknown error'}`, 'error');
        if (this.pushPollTimer) clearInterval(this.pushPollTimer);
        this.pushPollTimer = null;
      }
    }, 1200);
  },

  async pushToHub(id) {
    const parsed = this.parseId(id);
    if (!parsed) {
      showToast('Invalid dataset id format.', 'error');
      return;
    }

    const targetRaw = prompt('Target Hub repo (username/dataset). Leave empty to use same id:', id);
    if (targetRaw === null) return;
    const target = targetRaw.trim() || id;
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(target)) {
      showToast('Target repo must be username/dataset format.', 'error');
      return;
    }

    this.showPushStatus(true);
    this.updatePushStatus('starting', 'starting', 2, 'Preparing upload job...');
    const res = await api.post(`/api/datasets/${parsed.user}/${parsed.repo}/push`, { target_repo_id: target });
    if (!res.ok) {
      this.updatePushStatus('error', 'error', 0, res.error || 'Failed to create upload job');
      showToast(`Hub push failed: ${res.error || 'Unknown error'}`, 'error');
      return;
    }
    this.updatePushStatus('queued', 'queued', 5, 'Upload job queued...');
    this.startPushPolling(res.job_id);
  },

  async pushCurrentToHub() {
    if (!this.currentDataset?.dataset_id) {
      showToast('Select a dataset first.', 'error');
      return;
    }
    await this.pushToHub(this.currentDataset.dataset_id);
  },

  renderQualityResult(res) {
    const panel = document.getElementById('ds-quality-panel');
    const scoreEl = document.getElementById('ds-quality-score');
    const statsEl = document.getElementById('ds-quality-stats');
    const checksEl = document.getElementById('ds-quality-checks');
    if (!panel || !scoreEl || !checksEl || !statsEl) return;

    panel.style.display = 'block';
    const score = Number(res.score || 0);
    scoreEl.textContent = `Score: ${score}`;
    scoreEl.className = `dbadge ${score >= 80 ? 'badge-ok' : score >= 60 ? 'badge-warn' : 'badge-err'}`;

    const stats = res.stats || {};
    const breakdown = res.score_breakdown || {};
    const cameraCounts = stats.camera_file_counts || {};
    const camSummary = Object.keys(cameraCounts).length
      ? Object.entries(cameraCounts).map(([k, v]) => `${k}:${v}`).join(' · ')
      : '--';
    const penaltySummary = Object.keys(breakdown).length
      ? Object.entries(breakdown).map(([k, v]) => `${k}-${v}`).join(' · ')
      : '--';
    statsEl.textContent = `Episodes ${stats.total_detected_episodes ?? '--'} (expected ${stats.total_expected_episodes ?? '--'}) · Frames ${stats.total_frames ?? '--'} · FPS ${stats.fps ?? '--'} · Zero-byte videos ${stats.zero_byte_videos ?? '--'} · Camera files ${camSummary} · Penalty ${penaltySummary}`;

    const checks = Array.isArray(res.checks) ? res.checks : [];
    checksEl.innerHTML = checks.map((c) => {
      const level = c.level || 'ok';
      const cls = level === 'error' ? 'badge-err' : level === 'warn' ? 'badge-warn' : 'badge-ok';
      return `<div class="device-item" style="align-items:flex-start;">
        <span class="dbadge ${cls}" style="margin-top:2px;">${String(level).toUpperCase()}</span>
        <div style="flex:1; min-width:0;">
          <div class="dname">${c.name || 'check'}</div>
          <div class="dsub" style="white-space:normal; line-height:1.45;">${c.message || ''}</div>
        </div>
      </div>`;
    }).join('');
  },

  async inspectQuality(id) {
    const parsed = this.parseId(id);
    if (!parsed) {
      showToast('Invalid dataset id format.', 'error');
      return;
    }
    const res = await api.get(`/api/datasets/${parsed.user}/${parsed.repo}/quality`);
    if (!res.ok) {
      showToast(`Quality check failed: ${res.error || 'Unknown error'}`, 'error');
      return;
    }
    this.renderQualityResult(res);
    showToast('Quality check complete.', 'success');
  },

  async inspectQualityCurrent() {
    if (!this.currentDataset?.dataset_id) {
      showToast('Select a dataset first.', 'error');
      return;
    }
    await this.inspectQuality(this.currentDataset.dataset_id);
  },

  async loadDataset(id) {
    document.getElementById('dataset-detail-empty').style.display = 'none';
    const view = document.getElementById('dataset-detail-view');
    view.style.display = 'flex';
    document.getElementById('ds-title').textContent = 'Loading...';
    document.getElementById('ds-stats').textContent = '';
    document.getElementById('ds-video-grid').innerHTML = '';
    
    try {
      const parts = id.split('/');
      const user = parts[0];
      const repo = parts[1];
      const ds = await api.get(`/api/datasets/${user}/${repo}`);
      if (!ds.dataset_id) throw new Error(ds.detail || 'Failed to load dataset');
      
      this.currentDataset = ds;
      this.showPushStatus(false);
      const panel = document.getElementById('ds-quality-panel');
      if (panel) panel.style.display = 'none';
      document.getElementById('ds-title').textContent = ds.dataset_id;
      document.getElementById('ds-stats').textContent = 
        `${ds.total_episodes} episodes · ${ds.total_frames} frames · ${ds.fps} FPS · Cameras: ${ds.cameras.join(', ') || 'None'}`;
        
      const sel = document.getElementById('ds-ep-select');
      sel.innerHTML = ds.episodes.map(e => `<option value="${e.episode_index}">Episode ${e.episode_index} (${e.length} frames)</option>`).join('');
      
      if (ds.episodes.length > 0) {
        this.selectEpisode(ds.episodes[0].episode_index);
      }
    } catch (e) {
      document.getElementById('ds-title').textContent = 'Error';
      document.getElementById('ds-stats').textContent = String(e);
    }
  },

  async deleteDataset(id) {
    if (!confirm(`Are you sure you want to delete dataset "${id}"?\nThis cannot be undone.`)) return;

    try {
      const parts = id.split('/');
      const user = parts[0];
      const repo = parts[1];
      const res = await fetch(`/api/datasets/${user}/${repo}`, { method: 'DELETE' });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to delete');
      }
      
      if (this.currentDataset && this.currentDataset.dataset_id === id) {
        document.getElementById('dataset-detail-empty').style.display = 'block';
        document.getElementById('dataset-detail-view').style.display = 'none';
        this.currentDataset = null;
      }
      this.refreshList();
    } catch (e) {
      alert(e);
    }
  },

  selectEpisode(epIdx) {
    this.currentEpisode = parseInt(epIdx, 10);
    const ds = this.currentDataset;
    if (!ds) return;
    
    const parts = ds.dataset_id.split('/');
    const user = parts[0];
    const repo = parts[1];
    
    const grid = document.getElementById('ds-video-grid');
    const controls = document.getElementById('ds-video-controls');
    
    if (!ds.cameras || ds.cameras.length === 0) {
      grid.innerHTML = '<div class="muted" style="grid-column: 1/-1;">No video data in this dataset.</div>';
      controls.style.display = 'none';
      return;
    }

    const episode = (ds.episodes || []).find(e => Number(e.episode_index) === this.currentEpisode) || null;
    const to3 = (v) => String(Math.max(0, parseInt(v, 10) || 0)).padStart(3, '0');

    grid.innerHTML = ds.cameras.map(cam => {
      const vf = episode?.video_files?.[cam] || {};
      const chunk = `chunk-${to3(vf.chunk_index)}`;
      const file = `file-${to3(vf.file_index)}.mp4`;
      const startTs = Number.isFinite(Number(vf.from_timestamp)) ? Number(vf.from_timestamp) : 0;
      const endTs = Number.isFinite(Number(vf.to_timestamp)) ? Number(vf.to_timestamp) : null;
      return `
      <div style="background:var(--bg-app); border:1px solid var(--border); border-radius:6px; overflow:hidden;">
        <div style="padding:6px 10px; font-size:11px; font-family:var(--mono); border-bottom:1px solid var(--border); background:rgba(0,0,0,0.2);">
          ${cam}
        </div>
        <video class="ds-video" data-ep-start="${startTs}" data-ep-end="${endTs === null ? '' : endTs}" src="/api/datasets/${user}/${repo}/videos/${cam}/${chunk}/${file}" controls preload="metadata" style="width:100%; display:block;"></video>
      </div>
    `;
    }).join('');

    grid.querySelectorAll('.ds-video').forEach(v => {
      const start = Number(v.dataset.epStart || '0');
      const endRaw = v.dataset.epEnd;
      const end = endRaw ? Number(endRaw) : NaN;

      v.addEventListener('loadedmetadata', () => {
        if (Number.isFinite(start) && start >= 0) {
          const maxStart = Math.max(0, (v.duration || 0) - 0.05);
          v.currentTime = Math.min(start, maxStart);
        }
      }, { once: true });

      v.addEventListener('timeupdate', () => {
        if (Number.isFinite(end) && end > 0 && v.currentTime >= end) {
          v.pause();
        }
      });
    });
    
    controls.style.display = 'flex';
  },
  
  playAll() {
    document.querySelectorAll('.ds-video').forEach(v => v.play());
  },
  
  pauseAll() {
    document.querySelectorAll('.ds-video').forEach(v => v.pause());
  }
};

/* ─── Shared helpers ─────────────────────────────────────────────────────────── */
function getVal(id) {
  return document.getElementById(id)?.value ?? '';
}
function setVal(id, val) {
  const el = document.getElementById(id);
  if (el && val !== undefined && val !== null) el.value = val;
}

function clearProcessLog(logId, afterClear) {
  const el = document.getElementById(logId);
  if (el) el.innerHTML = '';
  const processName = LOG_ID_TO_PROCESS[logId];
  if (processName) GlobalConsole.clearProcess(processName);
  if (afterClear) afterClear();
}

function syncProcessButtons(processName, startBtnId, stopBtnId, onStopped) {
  const running = !!state.procStatus[processName];
  document.getElementById(startBtnId).classList.toggle('hidden', running);
  document.getElementById(stopBtnId).classList.toggle('hidden', !running);
  if (!running && onStopped) onStopped();
}

async function sendProcessInput(processName, inputId, logId, options = {}) {
  const { allowEmpty = false } = options;
  const input = document.getElementById(inputId);
  if (!input) return;
  const text = input.value ?? '';
  if (!allowEmpty && text.trim() === '') return;
  await api.post(`/api/process/${processName}/input`, { text });
  const lineText = text === '' ? '> [ENTER]' : `> ${text}`;
  appendLog(logId, lineText, 'info');
  input.value = '';
}

function updateTeleopLoopPerf(ms, hz) {
  const el = document.getElementById('teleop-loop-pill');
  if (!el) return;
  if (ms === null || hz === null || Number.isNaN(ms) || Number.isNaN(hz)) {
    el.className = 'perf-pill idle';
    el.textContent = 'Loop: --';
    return;
  }

  el.textContent = `Loop: ${ms.toFixed(2)}ms (${hz}Hz)`;
  if (hz >= 58) {
    el.className = 'perf-pill good';
  } else if (hz >= 54) {
    el.className = 'perf-pill warn';
  } else {
    el.className = 'perf-pill bad';
  }
}

async function runPreflight(cfg, logId) {
  const res = await api.post('/api/preflight', cfg);
  const checks = Array.isArray(res.checks) ? res.checks : [];

  checks.forEach((c) => {
    const icon = c.status === 'ok' ? 'OK' : c.status === 'warn' ? 'WARN' : 'ERROR';
    const kind = c.status === 'error' ? 'error' : c.status === 'warn' ? 'info' : 'stdout';
    appendLog(logId, `[${icon}] ${c.label}: ${c.msg}`, kind);
  });

  if (!res.ok) {
    appendLog(logId, '[ERROR] Preflight failed. Fix errors before starting.', 'error');
    return false;
  }

  const hasWarn = checks.some((c) => c.status === 'warn');
  if (hasWarn) {
    appendLog(logId, '[INFO] Preflight passed with warnings.', 'info');
  } else {
    appendLog(logId, '[INFO] Preflight passed.', 'info');
  }
  return true;
}

document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (!t) return;
  const tag = (t.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) {
    return;
  }

  const activeTab = document.querySelector('.tab-btn.active')?.dataset?.tab;
  if (!activeTab) return;

  if (e.code === 'Space') {
    if (activeTab === 'teleop') {
      e.preventDefault();
      if (state.procStatus.teleop) TeleopTab.stop();
      else TeleopTab.start();
      return;
    }
    if (activeTab === 'record') {
      e.preventDefault();
      if (state.procStatus.record) RecordTab.stop();
      else RecordTab.start();
      return;
    }
  }

  if (activeTab !== 'record' || !state.procStatus.record) return;

  if (e.code === 'ArrowRight') {
    e.preventDefault();
    RecordTab.sendKey('right');
  } else if (e.code === 'ArrowLeft') {
    e.preventDefault();
    RecordTab.sendKey('left');
  } else if (e.code === 'Escape') {
    e.preventDefault();
    RecordTab.sendKey('escape');
  }
});

function appendLog(logId, text, kind = 'stdout') {
  const processName = LOG_ID_TO_PROCESS[logId];
  const el = document.getElementById(logId);
  if (el) {
    const line = document.createElement('div');
    line.className  = `line-${kind}`;
    line.textContent = text;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }
  if (processName) GlobalConsole.append(processName, text, kind);
}

/* ─── Feed Manager ───────────────────────────────────────────────────────────── */
const FeedManager = {
  _paused:       new Set(),
  _watchers:     new Map(),
  _watcherState: new Map(),
  _statTimer:    null,
  _lastFps:      new Map(),
  _lastFpsTs:    new Map(),
  _stallSuppressedUntil: 0,

  suppressStall(ms = 8000) {
    this._stallSuppressedUntil = Math.max(this._stallSuppressedUntil, Date.now() + ms);
    document.querySelectorAll('.feed-stalled').forEach(el => { el.style.display = 'none'; });
  },

  isStallSuppressed() {
    return Date.now() < this._stallSuppressedUntil;
  },

  render(containerId, cameras) {
    this.stopStatPolling();
    this._stopWatchers();
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!cameras.length) { el.innerHTML = ''; return; }

    const configuredFps = parseInt(document.querySelector('.cam-fps-sync')?.value || '30', 10);
    el.innerHTML = cameras.map(c => {
      const vid = c.path.replace('/dev/', '');
      return `
        <div class="feed-card" data-vid="${vid}">
          <img src="/stream/${vid}"
               alt="${c.name}"
               style="width:100%;height:150px;object-fit:cover;display:block;"
               onload="FeedManager._onLoad(this)"
               onerror="FeedManager._onError(this)" />
          <div class="feed-loading" id="fload-${vid}">
            <div class="feed-spinner"></div>
          </div>
          <div class="feed-stalled" id="fstall-${vid}" style="display:none">
            <span class="feed-stalled-text">⏸ Feed stalled</span>
            <button class="btn-xs feed-overlay-btn" onclick="FeedManager.retry('${vid}')">↺ Retry</button>
          </div>
          <div class="feed-paused-ov" id="fpause-${vid}" style="display:none">
            <span style="font-size:20px;opacity:0.4">⏸</span>
            <span class="feed-paused-text">${c.name} — paused</span>
            <button class="btn-xs feed-overlay-btn" onclick="FeedManager.resume('${vid}')">▶ Resume</button>
          </div>
          <div class="feed-live-badge" id="flive-${vid}">
            <div class="feed-live-dot"></div>LIVE
          </div>
          <div class="feed-fps-badge visible" id="ffps-${vid}">${configuredFps} fps</div>
          <button class="feed-close-btn" title="Pause this feed" onclick="FeedManager.pause('${vid}')">×</button>
          <div class="feed-label">
            <span>${c.name} — /dev/${vid}</span>
            <span class="feed-stat" id="fstat-${vid}"></span>
          </div>
        </div>`;
    }).join('');

    cameras.forEach(c => this._startWatcher(c.path.replace('/dev/', '')));
    if (cameras.length) this.startStatPolling();
  },

  _onLoad(img) {
    const vid = img.closest('[data-vid]')?.dataset.vid;
    if (!vid) return;
    const el = document.getElementById(`fload-${vid}`);
    if (el) el.style.display = 'none';
  },

  _onError(img) {
    const card = img.closest('[data-vid]');
    if (!card) return;
    if (card.getAttribute('data-pausing') === '1') return;
    const vid = card.dataset.vid;
    const el = document.getElementById(`fload-${vid}`);
    if (el) el.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px;">
        <span style="font-size:22px;opacity:0.35">📷</span>
        <span style="font-size:11px;color:var(--red);text-align:center;">Stream unavailable</span>
        <button class="btn-xs feed-overlay-btn" onclick="FeedManager.retry('${vid}')">↺ Retry</button>
      </div>`;
    document.getElementById(`flive-${vid}`)?.classList.remove('visible');
  },

  _startWatcher(vid) {
    const STALL_MS       = 12000;
    const TICK_MS        = 2000;
    const NO_FRAME_TICKS = 8;
    this._watcherState.set(vid, { lastHash: null, stalledAt: null, noFrameTicks: 0 });

    const canvas = document.createElement('canvas');
    canvas.width = 16; canvas.height = 16;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const id = setInterval(() => {
      const card = document.querySelector(`[data-vid="${vid}"]`);
      if (!card) { clearInterval(id); this._watchers.delete(vid); return; }

      const img = card.querySelector('img');
      if (!img || !img.complete || img.naturalWidth === 0) {
        const ws = this._watcherState.get(vid);
        if (ws && img && img.naturalWidth === 0) {
          if (this.isStallSuppressed() || state.procStatus.record || state.procStatus.teleop) {
            return;
          }
          ws.noFrameTicks += 1;
          if (ws.noFrameTicks >= NO_FRAME_TICKS) {
            this._onError(img);
            clearInterval(id);
            this._watchers.delete(vid);
            this._watcherState.delete(vid);
          }
        }
        return;
      }

      try {
        ctx.drawImage(img, 0, 0, 16, 16);
        const px = ctx.getImageData(0, 0, 16, 16).data;
        let h = 0;
        for (let i = 0; i < px.length; i += 32) h = (h * 31 + px[i] + px[i+1] + px[i+2]) >>> 0;

        const ws = this._watcherState.get(vid);
        if (!ws) return;
        const now = Date.now();

        if (h !== ws.lastHash) {
          ws.lastHash = h;
          ws.stalledAt = null;
          document.getElementById(`flive-${vid}`)?.classList.add('visible');
          const stallEl = document.getElementById(`fstall-${vid}`);
          if (stallEl) stallEl.style.display = 'none';
          const loadEl = document.getElementById(`fload-${vid}`);
          if (loadEl && loadEl.style.display !== 'none') loadEl.style.display = 'none';
        } else {
          if (!ws.stalledAt) ws.stalledAt = now;
          if (now - ws.stalledAt > STALL_MS) {
            if (state.procStatus.record || state.procStatus.teleop) {
              const stallEl = document.getElementById(`fstall-${vid}`);
              if (stallEl) stallEl.style.display = 'none';
              document.getElementById(`flive-${vid}`)?.classList.add('visible');
              return;
            }
            if (this.isStallSuppressed()) {
              const stallEl = document.getElementById(`fstall-${vid}`);
              if (stallEl) stallEl.style.display = 'none';
              return;
            }

            const fps = this._lastFps.get(vid) ?? 0;
            const fpsTs = this._lastFpsTs.get(vid) ?? 0;
            const statsFresh = now - fpsTs < 8000;
            const probablyAlive = statsFresh && fps > 0.2;

            if (!probablyAlive) {
              document.getElementById(`flive-${vid}`)?.classList.remove('visible');
              const stallEl = document.getElementById(`fstall-${vid}`);
              if (stallEl) stallEl.style.display = 'flex';
            }
          }
        }
      } catch (_) { /* canvas taint – skip */ }
    }, TICK_MS);

    this._watchers.set(vid, id);
  },

  _stopWatcher(vid) {
    const id = this._watchers.get(vid);
    if (id !== undefined) { clearInterval(id); this._watchers.delete(vid); }
    this._watcherState.delete(vid);
  },

  _stopWatchers() {
    this._watchers.forEach(id => clearInterval(id));
    this._watchers.clear();
    this._watcherState.clear();
    this._lastFps.clear();
    this._lastFpsTs.clear();
  },

  pause(vid) {
    this._paused.add(vid);
    this._stopWatcher(vid);
    const card = document.querySelector(`.feed-card[data-vid="${vid}"]`);
    if (!card) return;
    card.setAttribute('data-pausing', '1');
    const img = card.querySelector('img');
    if (img) img.src = '';
    document.getElementById(`flive-${vid}`)?.classList.remove('visible');
    const stallEl = document.getElementById(`fstall-${vid}`);
    if (stallEl) stallEl.style.display = 'none';
    const pEl = document.getElementById(`fpause-${vid}`);
    if (pEl) pEl.style.display = 'flex';
  },

  resume(vid) {
    this._paused.delete(vid);
    const card = document.querySelector(`.feed-card[data-vid="${vid}"]`);
    if (!card) return;
    card.removeAttribute('data-pausing');
    const pEl = document.getElementById(`fpause-${vid}`);
    if (pEl) pEl.style.display = 'none';
    const loadEl = document.getElementById(`fload-${vid}`);
    if (loadEl) { loadEl.innerHTML = '<div class="feed-spinner"></div>'; loadEl.style.display = 'flex'; }
    const img = card.querySelector('img');
    if (img) img.src = `/stream/${vid}?_=${Date.now()}`;
    this._startWatcher(vid);
  },

  retry(vid) {
    const card = document.querySelector(`[data-vid="${vid}"]`);
    if (!card) return;
    const stallEl = document.getElementById(`fstall-${vid}`);
    if (stallEl) stallEl.style.display = 'none';
    const loadEl = document.getElementById(`fload-${vid}`);
    if (loadEl) { loadEl.innerHTML = '<div class="feed-spinner"></div>'; loadEl.style.display = 'flex'; }
    const ws = this._watcherState.get(vid);
    if (ws) { ws.lastHash = null; ws.stalledAt = null; }
    const img = card.querySelector('img');
    if (img) img.src = `/stream/${vid}?_=${Date.now()}`;
  },

  startStatPolling() {
    this.stopStatPolling();
    this._pollStats();
    this._statTimer = setInterval(() => this._pollStats(), 2000);
  },

  stopStatPolling() {
    if (this._statTimer !== null) { clearInterval(this._statTimer); this._statTimer = null; }
  },

  async _pollStats() {
    let data;
    try { data = await api.get('/api/camera/stats'); } catch (_) { return; }

    for (const [vid, stats] of Object.entries(data.cameras || {})) {
      const fpsNum = Number(stats.fps || 0);
      this._lastFps.set(vid, fpsNum);
      this._lastFpsTs.set(vid, Date.now());

      const el = document.getElementById(`fstat-${vid}`);
      if (el) el.textContent = `${stats.fps}fps · ${stats.mbps}MB/s`;
      const fpsBadge = document.getElementById(`ffps-${vid}`);
      if (fpsBadge) {
        fpsBadge.textContent = `${stats.fps} fps`;
        fpsBadge.classList.add('visible');
      }

      if (fpsNum > 0.2) {
        const stallEl = document.getElementById(`fstall-${vid}`);
        if (stallEl) stallEl.style.display = 'none';
      }
    }

    const busHtml = Object.entries(data.buses || {}).map(([bus, info]) => {
      const pct = Math.min(info.pct, 100);
      const cls = info.pct > 85 ? 'danger' : info.pct > 60 ? 'warn' : '';
      const gen = info.max_mb_per_sec > 300 ? '3' : '2.0';
      return `<div class="usb-bus-bar-wrap">
        <div class="usb-bus-bar-label">
          <span>USB Bus ${bus} (USB ${gen})</span>
          <span>${info.used_mb_per_sec} / ${info.max_mb_per_sec} MB/s &nbsp;<b>${info.pct}%</b></span>
        </div>
        <div class="usb-bus-bar-track">
          <div class="usb-bar-fill ${cls}" style="width:${pct}%"></div>
        </div>
      </div>`;
    }).join('');

    ['device-setup-usb-bars'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = busHtml;
    });
  },

  clearPaused() { this._paused.clear(); }
};

function renderArmList(el, arms) {
  if (!arms.length) { el.innerHTML = '<div class="device-item"><span class="dname" style="color:var(--text2)">No arm ports found</span></div>'; return; }
  el.innerHTML = arms.map(a =>
    `<div class="device-item" onclick="setVal('${el.closest('section').id === 'tab-calibrate' ? 'cal-port' : 'ms-port'}', '${a.path}')" style="cursor:pointer">
      <span class="dot ${a.symlink ? 'green' : 'yellow'}"></span>
      <div>
        <div class="dname">${a.symlink || a.device}</div>
        <div class="dsub">${a.path}</div>
      </div>
    </div>`
  ).join('');
}

/* ─── Init ───────────────────────────────────────────────────────────────────── */
(async () => {
  DeviceSetupTab.initStreamControls();
  ProfileManager.bindDropzone();
  SidebarNav.init();
  SidebarSignals.init();
  ModeManager.init();
  GlobalConsole.init();
  SidebarNav.syncBadges();
  NotificationManager.ensurePermission();
  WS.connect();
  await loadConfig();
  await ModeManager.refreshReadiness();
  await ProfileManager.refresh();
  StatusTab.refresh();
})();
