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

  toggleCollapse() {
    const drawer = document.getElementById('console-drawer');
    if (!drawer) return;
    drawer.classList.toggle('collapsed');
  },

  expand() {
    const drawer = document.getElementById('console-drawer');
    if (drawer) drawer.classList.remove('collapsed');
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

const WS = {
  ws: null,
  reconnectTimer: null,
  lastErrorAtByProcess: {},
  prevRunning: {},

  _computeConnectionState() {
    if (!state.wsReady) return { level: 'disconnected', label: 'Disconnected', title: 'Disconnected' };
    const degraded = [];
    if (state.apiSupport?.resources !== false && !state.apiHealth?.resources) degraded.push('system resources');
    if (state.apiSupport?.history !== false && !state.apiHealth?.history) degraded.push('session history');
    if (degraded.length > 0) {
      const reason = degraded.join(', ');
      return {
        level: 'degraded',
        label: 'Degraded',
        title: `Connected (degraded: ${reason})`,
      };
    }
    return { level: 'connected', label: 'Connected', title: 'Connected' };
  },

  syncConnectionBadge() {
    const dot = document.getElementById('ws-dot');
    const lbl = document.getElementById('ws-label');
    const status = this._computeConnectionState();
    if (dot) {
      if (status.level === 'connected') dot.className = 'dot green';
      else if (status.level === 'degraded') dot.className = 'dot yellow';
      else dot.className = 'dot red';
      dot.title = status.title;
    }
    if (lbl) lbl.textContent = status.label;
  },

  setApiHealth(key, healthy) {
    if (!state.apiHealth || !(key in state.apiHealth)) return;
    state.apiHealth[key] = !!healthy;
    this.syncConnectionBadge();
  },

  setApiSupport(key, supported) {
    if (!state.apiSupport || !(key in state.apiSupport)) return;
    const isSupported = !!supported;
    state.apiSupport[key] = isSupported;
    if (!isSupported && key in state.apiHealth) {
      state.apiHealth[key] = true;
    }
    this.syncConnectionBadge();
  },

  connect() {
    const url = `ws://${location.host}/ws`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      state.wsReady = true;
      this.syncConnectionBadge();
    };

    this.ws.onclose = () => {
      state.wsReady = false;
      this.syncConnectionBadge();
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
      if (!was && isNow) {
        const display = normalizeProcessName(proc);
        const sel = document.getElementById('console-process-select');
        if (sel && sel.value !== display) {
          sel.value = display;
          GlobalConsole.renderCurrent();
          GlobalConsole.updateInputPlaceholder();
        }
        GlobalConsole.expand();
      }
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
