const ModeManager = {
  mode: 'guided',
  dataReady: false,
  mlReady: false,
  _refreshTimer: null,

  init() {
    const saved = localStorage.getItem('lestudio.ui-mode');
    this.mode = saved === 'advanced' ? 'advanced' : 'guided';
    this.applyMode();
  },

  setMode(nextMode) {
    this.mode = nextMode === 'advanced' ? 'advanced' : 'guided';
    localStorage.setItem('lestudio.ui-mode', this.mode);
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
    const activeTab = getActiveTabId();
    if (this._isTabAllowed(activeTab)) return;
    showToast('Complete previous steps first to unlock this tab.', 'error');
    setActiveTab('status');
  },

  applyMode() {
    const guidedBtn = document.getElementById('mode-guided-btn');
    const advancedBtn = document.getElementById('mode-advanced-btn');
    if (guidedBtn) guidedBtn.classList.toggle('active', this.mode === 'guided');
    if (advancedBtn) advancedBtn.classList.toggle('active', this.mode === 'advanced');
    const dataGroup = document.getElementById('sidebar-group-data');
    const mlGroup = document.getElementById('sidebar-group-ml');
    const dimData = this.mode === 'guided' && !this.dataReady;
    const dimMl = this.mode === 'guided' && !this.mlReady;

    if (dataGroup) {
      dataGroup.classList.toggle('sidebar-group-dimmed', dimData);
      dataGroup.classList.remove('hidden');
    }
    if (mlGroup) {
      mlGroup.classList.toggle('sidebar-group-dimmed', dimMl);
      mlGroup.classList.remove('hidden');
    }
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
      this.rulesNeedsInstall = !rulesInstalled;
      if (typeof rulesRes.needs_root_for_install === 'boolean') {
        this.rulesNeedsRoot = rulesRes.needs_root_for_install;
      } else {
        const sudoNoninteractive = !!rulesRes.sudo_noninteractive;
        this.rulesNeedsRoot = this.rulesNeedsInstall && !sudoNoninteractive;
      }
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
      // Don't show NEEDS_DEVICE badge in sidebar - preflight checks inside tab handle device warnings
      return '';
    }
    if (tabName === 'calibrate' || tabName === 'motor-setup') {
      // Don't show NEEDS_DEVICE badge in sidebar - preflight checks inside tab handle device warnings
      return '';
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
