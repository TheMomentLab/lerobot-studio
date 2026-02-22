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

      const armPaths = arms.flatMap((a) => {
        const out = [];
        if (a?.symlink) out.push(`/dev/${a.symlink}`);
        if (a?.path) out.push(a.path);
        return out;
      });

      this._setSelectOptions('teleop-follower-port', armPaths, ['/dev/follower_arm_1', '/dev/follower_arm_2']);
      this._setSelectOptions('teleop-leader-port', armPaths, ['/dev/leader_arm_1', '/dev/leader_arm_2']);
      this._setSelectOptions('teleop-left-follower', armPaths, ['/dev/follower_arm_1', '/dev/follower_arm_2']);
      this._setSelectOptions('teleop-right-follower', armPaths, ['/dev/follower_arm_2', '/dev/follower_arm_1']);
      this._setSelectOptions('teleop-left-leader', armPaths, ['/dev/leader_arm_1', '/dev/leader_arm_2']);
      this._setSelectOptions('teleop-right-leader', armPaths, ['/dev/leader_arm_2', '/dev/leader_arm_1']);
    } catch (_) {
      this._setSelectOptions('teleop-follower-port', [], ['/dev/follower_arm_1', '/dev/follower_arm_2']);
      this._setSelectOptions('teleop-leader-port', [], ['/dev/leader_arm_1', '/dev/leader_arm_2']);
      this._setSelectOptions('teleop-left-follower', [], ['/dev/follower_arm_1', '/dev/follower_arm_2']);
      this._setSelectOptions('teleop-right-follower', [], ['/dev/follower_arm_2', '/dev/follower_arm_1']);
      this._setSelectOptions('teleop-left-leader', [], ['/dev/leader_arm_1', '/dev/leader_arm_2']);
      this._setSelectOptions('teleop-right-leader', [], ['/dev/leader_arm_2', '/dev/leader_arm_1']);
    }
  },


  async refreshCalibrationIdOptions() {
    try {
      const res = await api.get('/api/calibrate/list');
      const files = Array.isArray(res?.files) ? res.files : [];
      const followerIds = [...new Set(files.filter((f) => String(f.guessed_type || '').includes('follower')).map((f) => f.id))].sort();
      const leaderIds = [...new Set(files.filter((f) => String(f.guessed_type || '').includes('leader')).map((f) => f.id))].sort();
      this._setSelectOptions('teleop-robot-id', followerIds, ['my_so101_follower_1']);
      this._setSelectOptions('teleop-teleop-id', leaderIds, ['my_so101_leader_1']);
    } catch (_) {
      this._setSelectOptions('teleop-robot-id', [], ['my_so101_follower_1']);
      this._setSelectOptions('teleop-teleop-id', [], ['my_so101_leader_1']);
    }
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
    this.renderCameraRows();
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
      cameras: collectMappedCameras(),
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

  async showFeeds() {
    const cameras = Object.entries(collectMappedCameras())
      .map(([name, path]) => ({ name, path }))
      .filter(c => c.path);
    if (!cameras.length) { FeedManager.render('teleop-feeds', []); return; }
    const paths = cameras.map(c => c.path);
    const exists = await api.post('/api/camera/check_paths', { paths });
    const available = cameras.filter(c => exists[c.path]);
    FeedManager.render('teleop-feeds', available);
  },

  async renderCameraRows() {
    await fetchMappedCameras();
    renderMappedCameraRows('teleop-cam-rows');
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
