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
      running: { className: 'has-running', label: 'Running' },
      error: { className: 'has-error', label: 'Error' },
      needs_root: { className: 'has-needs-root', label: 'Needs Root' },
      needs_udev: { className: 'has-needs-udev', label: 'Setup Needed' },
      missing_dep: { className: 'has-missing-dep', label: 'Install Needed' },
      needs_device: { className: 'has-needs-device', label: 'No Device' },
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
