const CalibrateTab = {
  async refreshRobotTypeOptions() {
    try {
      const [robotsData, teleopsData] = await Promise.all([
        api.get('/api/robots'),
        api.get('/api/teleops'),
      ]);
      const allTypes = [
        ...(Array.isArray(robotsData?.types) ? robotsData.types : []),
        ...(Array.isArray(teleopsData?.types) ? teleopsData.types : []),
      ];
      const preferred = ['so101_follower', 'so100_follower', 'so101_leader', 'so100_leader'];
      const select = document.getElementById('cal-type');
      if (!select) return;
      const current = select.value || 'so101_follower';
      const uniq = [];
      const seen = new Set();
      [...preferred, ...allTypes, current].forEach(v => {
        if (v && !seen.has(v)) { seen.add(v); uniq.push(v); }
      });
      select.innerHTML = uniq.map(v => `<option value="${v}">${v}</option>`).join('');
      select.value = uniq.includes(current) ? current : uniq[0];
    } catch (_) { /* keep existing HTML options */ }
  },

  async onTabOpen() {
    await this.refreshRobotTypeOptions();
    await this.refreshArms();
    await this.refreshFiles();
    this.checkFile();
  },
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
