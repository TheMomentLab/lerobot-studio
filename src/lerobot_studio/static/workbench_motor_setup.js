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
