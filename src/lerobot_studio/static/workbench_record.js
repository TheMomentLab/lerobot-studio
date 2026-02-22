const RecordTab = {
  mode: 'single',
  _lastRunning: false,

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
  },

  async onTabOpen() {
    await this.refreshDeviceOptions();
    this.renderCameraRows();
    this.showFeeds();
    await this.refreshCalibrationIdOptions();
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

      this._setSelectOptions('record-follower-port', armPaths, ['/dev/follower_arm_1', '/dev/follower_arm_2']);
      this._setSelectOptions('record-leader-port', armPaths, ['/dev/leader_arm_1', '/dev/leader_arm_2']);
      this._setSelectOptions('record-left-follower', armPaths, ['/dev/follower_arm_1', '/dev/follower_arm_2']);
      this._setSelectOptions('record-right-follower', armPaths, ['/dev/follower_arm_2', '/dev/follower_arm_1']);
      this._setSelectOptions('record-left-leader', armPaths, ['/dev/leader_arm_1', '/dev/leader_arm_2']);
      this._setSelectOptions('record-right-leader', armPaths, ['/dev/leader_arm_2', '/dev/leader_arm_1']);
    } catch (_) {
      this._setSelectOptions('record-follower-port', [], ['/dev/follower_arm_1', '/dev/follower_arm_2']);
      this._setSelectOptions('record-leader-port', [], ['/dev/leader_arm_1', '/dev/leader_arm_2']);
      this._setSelectOptions('record-left-follower', [], ['/dev/follower_arm_1', '/dev/follower_arm_2']);
      this._setSelectOptions('record-right-follower', [], ['/dev/follower_arm_2', '/dev/follower_arm_1']);
      this._setSelectOptions('record-left-leader', [], ['/dev/leader_arm_1', '/dev/leader_arm_2']);
      this._setSelectOptions('record-right-leader', [], ['/dev/leader_arm_2', '/dev/leader_arm_1']);
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
    const resumeEl = document.getElementById('record-resume');
    if (resumeEl) resumeEl.checked = !!cfg.record_resume;
    document.getElementById('record-ep-total').textContent = '—';
    this.renderCameraRows();
    this.refreshDeviceOptions();
    this.refreshCalibrationIdOptions();
  },

  buildConfig() {
    const ep = parseInt(getVal('record-episodes')) || 50;
    const cfg = {
      robot_mode:    this.mode,
      follower_port: getVal('record-follower-port'),
      robot_id:      getVal('record-robot-id'),
      leader_port:   getVal('record-leader-port'),
      teleop_id:     getVal('record-teleop-id'),
      left_follower_port:  getVal('record-left-follower'),
      right_follower_port: getVal('record-right-follower'),
      left_leader_port:    getVal('record-left-leader'),
      right_leader_port:   getVal('record-right-leader'),
      record_task:         getVal('record-task'),
      record_episodes:     ep,
      record_repo_id:      getVal('record-repo'),
      record_resume:       !!document.getElementById('record-resume')?.checked,
      cameras: collectMappedCameras(),
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

  async showFeeds() {
    const cameras = Object.entries(collectMappedCameras())
      .map(([name, path]) => ({ name, path }))
      .filter(c => c.path);
    if (!cameras.length) { FeedManager.render('record-feeds', []); return; }
    const paths = cameras.map(c => c.path);
    const exists = await api.post('/api/camera/check_paths', { paths });
    const available = cameras.filter(c => exists[c.path]);
    FeedManager.render('record-feeds', available);
  },

  async renderCameraRows() {
    await fetchMappedCameras();
    renderMappedCameraRows('record-cam-rows');
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
