/* ─── State ──────────────────────────────────────────────────────────────────── */
const state = {
  devices: { cameras: [], arms: [] },
  config:  {},
  procStatus: {},
  wsReady: false,
};

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

/* ─── WebSocket ──────────────────────────────────────────────────────────────── */
const WS = {
  ws: null,
  reconnectTimer: null,

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

    const logMap = {
      teleop:      'teleop-log',
      record:      'record-log',
      calibrate:   'cal-log',
      motor_setup: 'ms-log',
    };
    const el = document.getElementById(logMap[msg.process]);
    if (!el) return;
    const line = document.createElement('div');
    line.className = `line-${msg.kind}`;
    line.textContent = msg.line;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;

    // Parse episode progress from record output
    if (msg.process === 'record') RecordTab.parseEpisode(msg.line);
  },

  onStatus(msg) {
    state.procStatus = msg.processes;
    TeleopTab.syncBtn();
    RecordTab.syncBtn();
    CalibrateTab.syncBtn();
    MotorSetupTab.syncBtn();
    TrainTab.syncBtn();
    StatusTab.updateProcs(msg.processes);
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

    // Lazy-load on tab open
    if (btn.dataset.tab === 'status')       StatusTab.refresh();
    if (btn.dataset.tab === 'device-setup') { DeviceSetupTab.refresh(); DeviceSetupTab.loadStreamSettings(); FeedManager.startStatPolling(); }
    if (btn.dataset.tab === 'calibrate')    { CalibrateTab.refreshArms(); CalibrateTab.checkFile(); CalibrateTab.refreshFiles(); }
    if (btn.dataset.tab === 'motor-setup')  MotorSetupTab.refreshArms();
    if (btn.dataset.tab === 'teleop')       TeleopTab.showFeeds();
    if (btn.dataset.tab === 'record')       RecordTab.showFeeds();
    if (btn.dataset.tab === 'train')        { TrainTab.refreshGpu(); TrainTab.refreshDatasets(); }
    if (btn.dataset.tab === 'dataset')      DatasetTab.refreshList();
  });
});

/* ─── Load initial config ────────────────────────────────────────────────────── */
async function loadConfig() {
  state.config = await api.get('/api/config');
  TeleopTab.applyConfig(state.config);
  RecordTab.applyConfig(state.config);
}

function saveConfig() {
  api.post('/api/config', state.config);
}

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
    const allProcs = ['teleop', 'record', 'calibrate', 'motor_setup'];
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
    const res = await api.post('/api/teleop/start', cfg);
    if (!res.ok) { appendLog('teleop-log', `[ERROR] ${res.error}`, 'error'); return; }
    this.showFeeds();
  },

  async stop() {
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
    syncProcessButtons('teleop', 'teleop-start-btn', 'teleop-stop-btn', () => {
      updateTeleopLoopPerf(null, null);
    });
  },
};

document.getElementById('teleop-stdin').addEventListener('keydown', e => {
  if (e.key === 'Enter') TeleopTab.sendInput();
});

/* ═══════════════════════════════════════════════════════════════════════════════
   RECORD TAB
══════════════════════════════════════════════════════════════════════════════ */
const RecordTab = {
  mode: 'single',

  setMode(m) {
    this.mode = m;
    document.getElementById('record-mode-single').classList.toggle('active', m === 'single');
    document.getElementById('record-mode-bi').classList.toggle('active',     m === 'bi');
    document.getElementById('record-single-cfg').classList.toggle('hidden',  m !== 'single');
    document.getElementById('record-bi-cfg').classList.toggle('hidden',      m !== 'bi');
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
    document.getElementById('record-ep-total').textContent = cfg.record_episodes || '—';
    if (cfg.cameras) {
      setVal('rc-front1', cfg.cameras.front_1 || '');
      setVal('rc-top1',   cfg.cameras.top_1   || '');
      setVal('rc-top2',   cfg.cameras.top_2   || '');
    }
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
      cameras: {
        front_1: getVal('rc-front1'),
        top_1:   getVal('rc-top1'),
        top_2:   getVal('rc-top2'),
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
    const res = await api.post('/api/record/start', cfg);
    if (!res.ok) { appendLog('record-log', `[ERROR] ${res.error}`, 'error'); return; }
    if (res.resume_requested && !res.resume_enabled) {
      appendLog('record-log', '[INFO] Resume was disabled because target dataset does not exist yet. Starting a fresh dataset.', 'info');
    }
    this.showFeeds();
  },

  async stop() {
    await api.post('/api/process/record/stop');
  },

  async sendKey(key) {
    await api.post('/api/process/record/input', { text: key });
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
    syncProcessButtons('record', 'record-start-btn', 'record-stop-btn');
    const controls = document.getElementById('record-ep-controls');
    const guard = document.getElementById('record-ep-guard');
    if (controls) {
      controls.querySelectorAll('button').forEach(btn => { btn.disabled = !running; });
      if (guard) guard.style.display = running ? 'none' : 'flex';
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

document.getElementById('cal-stdin').addEventListener('keydown', e => {
  if (e.key === 'Enter') CalibrateTab.sendInput();
});

/* ═══════════════════════════════════════════════════════════════════════════════
   DEVICE SETUP TAB
══════════════════════════════════════════════════════════════════════════════ */
const DeviceSetupTab = {
  cameras:     [],
  assignments: {},   // kernels → role

  async refresh() {
    const data = await api.get('/api/devices');
    state.devices = data;
    this.cameras = data.cameras;
    // Restore assignments from current symlinks
    this.assignments = {};
    for (const cam of data.cameras) {
      this.assignments[cam.kernels] = cam.symlink || '(none)';
    }
    this.renderGrid();
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
          <button class="btn-primary" style="opacity: 0.9; padding: 10px 20px; font-size: 14px; border-radius: 20px; pointer-events: none;">▶ View Stream</button>
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

   togglePreview(idx, device) {
     const wrap = document.getElementById(`cam-wrap-${idx}`);
     const existing = wrap.querySelector('img');
     if (existing) {
       const vid = device.replace('/dev/', '');
       FeedManager._stopWatcher(vid);
       wrap.removeAttribute('data-vid');
       wrap.innerHTML = '<button class="btn-primary" style="opacity: 0.9; padding: 10px 20px; font-size: 14px; border-radius: 20px; pointer-events: none;">▶ View Stream</button>';
     } else {
       const vid = device.replace('/dev/', '');
       wrap.dataset.vid = vid;
       wrap.innerHTML = `<img src="/stream/${vid}" alt="stream" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;" onload="FeedManager._onLoad(this)" onerror="FeedManager._onError(this)" /><div class="feed-loading" id="fload-${vid}"><div class="feed-spinner"></div></div><div class="feed-live-badge" id="flive-${vid}"><div class="feed-live-dot"></div>LIVE</div><div class="feed-stalled" id="fstall-${vid}" style="display:none"><span class="feed-stalled-text">⏸ Feed stalled</span><button class="btn-xs feed-overlay-btn" onclick="FeedManager.retry('${vid}')">↺ Retry</button></div>`;
       FeedManager._startWatcher(vid);
     }
   },

  assign(kernels, role) {
    if (kernels) this.assignments[kernels] = role;
    this.validateAssignments();
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
    
    return duplicates.size === 0;
  },

  hasDuplicateAssignments() {
    const roles = Object.values(this.assignments).filter(r => r && r !== '(none)');
    return new Set(roles).size !== roles.length;
  },

  toggleRulesPanel() {
    const panel = document.getElementById('rules-advanced-panel');
    const icon = document.getElementById('rules-toggle-icon');
    if (panel.style.display === 'none') {
      panel.style.display = 'block';
      icon.textContent = '▼';
      this.previewRules();
    } else {
      panel.style.display = 'none';
      icon.textContent = '▶';
    }
  },

  async previewRules() {
    const res = await api.post('/api/rules/preview', { assignments: this.assignments });
    document.getElementById('rules-preview').textContent = res.content;
    this.renderReadableRules(res.content);
    document.getElementById('rules-status').textContent  = '';
    document.getElementById('rules-status').className    = 'rules-status';
  },

  async applyRules() {
    if (this.hasDuplicateAssignments()) {
      const el = document.getElementById('rules-status');
      el.textContent = '✗ Fix duplicate role assignments before saving.';
      el.className = 'rules-status err';
      el.style.color = 'var(--red)';
      return;
    }
    await this.previewRules();
    const el  = document.getElementById('rules-status');
    el.textContent = 'Applying…';
    const res = await api.post('/api/rules/apply', { assignments: this.assignments });
    if (res.ok) {
      el.textContent = '✓ Assignments applied successfully (udev reloaded).';
      el.className   = 'rules-status ok';
      el.style.color = 'var(--green)';
      setTimeout(() => { el.textContent = ''; this.refresh(); }, 2500);
    } else {
      el.textContent = `✗ Error: ${res.error}`;
      el.className   = 'rules-status err';
      el.style.color = 'var(--red)';
    }
  },

  async showCurrent() {
    const res = await api.get('/api/rules/current');
    document.getElementById('rules-preview').textContent = res.content;
    this.renderReadableRules(res.content);
    document.getElementById('rules-status').textContent  = '';
    document.getElementById('rules-status').className    = 'rules-status';
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
          ${items.map((r) => `
            <div class="rules-item">
              <div class="rules-item-key">${keyLabel}</div>
              <div class="rules-item-value">${r[keyField]}</div>
              <div class="rules-item-key">SYMLINK</div>
              <div class="rules-item-value">${r.link}</div>
              <div class="rules-item-key">MODE</div>
              <div class="rules-item-value">${r.mode}</div>
            </div>
          `).join('')}
        </div>
      `;
    };

    if (!cameraRules.length && !armRules.length) {
      readable.innerHTML = '<div class="rules-empty">Could not parse readable rules. Use raw view below.</div>';
      return;
    }

    readable.innerHTML =
      section('Camera Rules', cameraRules, 'USB PORT (KERNELS)', 'kernel') +
      section('Arm Rules', armRules, 'SERIAL', 'serial');
  },

  async loadStreamSettings() {
    const s = await api.get('/api/camera_settings');
    document.getElementById('cam-codec').value = s.codec || 'MJPG';
    document.getElementById('cam-resolution').value = `${s.width}x${s.height}`;
    document.getElementById('cam-fps').value = String(s.fps || 30);
    const q = s.jpeg_quality || 70;
    document.getElementById('cam-jpeg-quality').value = q;
    document.getElementById('cam-quality-val').textContent = q;
  },

  async applyStreamSettings() {
    const [w, h] = document.getElementById('cam-resolution').value.split('x').map(Number);
    const body = {
      codec:        document.getElementById('cam-codec').value,
      width:        w,
      height:       h,
      fps:          parseInt(document.getElementById('cam-fps').value, 10),
      jpeg_quality: parseInt(document.getElementById('cam-jpeg-quality').value, 10),
    };
    const el = document.getElementById('cam-settings-status');
    el.textContent = 'Applying…';
    const res = await api.post('/api/camera_settings', body);
    if (res.ok) {
      el.textContent = '✓ Applied — streams restarting';
      setTimeout(() => { el.textContent = ''; }, 3000);
      FeedManager.syncQualityButtons(body.fps, body.jpeg_quality);
    } else {
      el.textContent = '✗ Failed';
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

document.getElementById('ms-stdin').addEventListener('keydown', e => {
  if (e.key === 'Enter') MotorSetupTab.sendInput();
});

/* ═══════════════════════════════════════════════════════════════════════════════
   TRAIN TAB
══════════════════════════════════════════════════════════════════════════════ */
const TrainTab = {
  validateRepoId() {
    const val = getVal('train-repo').trim();
    const input = document.getElementById('train-repo');
    const err = document.getElementById('train-repo-error');
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
      const dl = document.getElementById('train-dataset-list');
      if (dl && res.datasets) {
        dl.innerHTML = res.datasets.map(ds => `<option value="${ds.id}"></option>`).join('');
      }
    } catch (e) {
      console.warn("Failed to load datasets for train tab", e);
    }
  },

  async start() {
    if (!this.validateRepoId()) {
      appendLog('train-log', '[ERROR] Invalid Dataset Repo ID format.', 'error');
      return;
    }
    const repoId = getVal('train-repo').trim();

    const body = {
      train_policy: getVal('train-policy'),
      train_repo_id: repoId,
      train_steps: parseInt(getVal('train-steps'), 10) || 100000,
      train_device: getVal('train-device'),
    };
    
    this.clearLog();
    const res = await api.post('/api/train/start', body);
    if (!res.ok) appendLog('train-log', `[ERROR] ${res.error}`, 'error');
  },

  async stop() {
    await api.post('/api/process/train/stop');
  },

  clearLog() { clearProcessLog('train-log'); },

  syncBtn() {
    syncProcessButtons('train', 'train-start-btn', 'train-stop-btn');
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

/* ═══════════════════════════════════════════════════════════════════════════════
   DATASET VIEWER TAB
══════════════════════════════════════════════════════════════════════════════ */
const DatasetTab = {
  datasets: [],
  currentDataset: null,
  currentEpisode: 0,
  
  async refreshList() {
    const el = document.getElementById('dataset-list');
    el.innerHTML = '<div class="device-item">Loading datasets...</div>';
    try {
      const res = await api.get('/api/datasets');
      this.datasets = res.datasets || [];
      this.renderList();
    } catch (e) {
      el.innerHTML = `<div class="device-item"><span style="color:var(--red)">Failed to load datasets: ${e}</span></div>`;
    }
  },

  renderList() {
    const el = document.getElementById('dataset-list');
    if (!this.datasets.length) {
      el.innerHTML = '<div class="device-item"><span class="dname muted">No datasets found in cache</span></div>';
      return;
    }
    el.innerHTML = this.datasets.map(ds => `
      <div class="device-item" style="cursor:pointer; flex-direction:column; align-items:flex-start;" onclick="DatasetTab.loadDataset('${ds.id}')">
        <div style="font-weight:600; font-size:14px; margin-bottom:4px; color:var(--text1)">${ds.id}</div>
        <div style="font-size:11px; color:var(--text2)">
          ${ds.total_episodes} episodes · ${ds.total_frames} frames · ${ds.size_mb} MB
        </div>
        <div style="font-size:11px; color:var(--text2)">Modified: ${ds.modified}</div>
      </div>
    `).join('');
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
    
    // For LeRobot v3, episodes might be mapped to different chunks.
    // As a simplification for the viewer, we will just play the video chunk corresponding to the episode.
    // In a real scenario, an episode might span chunks, or a chunk might contain multiple episodes.
    // We'll assume chunk-000 and file-000 for simplicity of MVP, but a robust player needs to parse Parquet to seek.
    const chunk = "chunk-000";
    const file = "file-000.mp4";
    
    grid.innerHTML = ds.cameras.map(cam => `
      <div style="background:var(--bg-app); border:1px solid var(--border); border-radius:6px; overflow:hidden;">
        <div style="padding:6px 10px; font-size:11px; font-family:var(--mono); border-bottom:1px solid var(--border); background:rgba(0,0,0,0.2);">
          ${cam}
        </div>
        <video class="ds-video" src="/api/datasets/${user}/${repo}/videos/${cam}/${chunk}/${file}" controls preload="metadata" style="width:100%; display:block;"></video>
      </div>
    `).join('');
    
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
  appendLog(logId, text === '' ? '> [ENTER]' : `> ${text}`, 'info');
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

function appendLog(logId, text, kind = 'stdout') {
  const el = document.getElementById(logId);
  if (!el) return;
  const line = document.createElement('div');
  line.className  = `line-${kind}`;
  line.textContent = text;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

/* ─── Feed Manager ───────────────────────────────────────────────────────────── */
const FeedManager = {
  _paused:       new Set(),
  _watchers:     new Map(),
  _watcherState: new Map(),
  _statTimer:    null,

  QUALITY: {
    high:   { fps: 30, jpeg_quality: 80 },
    medium: { fps: 15, jpeg_quality: 60 },
    low:    { fps: 8,  jpeg_quality: 40 },
  },

  render(containerId, cameras) {
    this.stopStatPolling();
    this._stopWatchers();
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!cameras.length) { el.innerHTML = ''; return; }

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
    const STALL_MS       = 5000;
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
            document.getElementById(`flive-${vid}`)?.classList.remove('visible');
            const stallEl = document.getElementById(`fstall-${vid}`);
            if (stallEl) stallEl.style.display = 'flex';
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
      const el = document.getElementById(`fstat-${vid}`);
      if (el) el.textContent = `${stats.fps}fps · ${stats.mbps}MB/s`;
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

    ['device-setup-usb-bars', 'teleop-usb-bars', 'record-usb-bars'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = busHtml;
    });
  },

  clearPaused() { this._paused.clear(); },

  syncQualityButtons(fps, jpeg_quality) {
    const match = Object.entries(this.QUALITY)
      .find(([, cfg]) => cfg.fps === fps && cfg.jpeg_quality === jpeg_quality)?.[0] ?? null;
    ['teleop', 'record'].forEach(tab =>
      Object.keys(this.QUALITY).forEach(p => {
        document.getElementById(`${tab}-qbtn-${p}`)?.classList.toggle('active', p === match);
      })
    );
  },

  async setQuality(preset, statusId) {
    const cfg = this.QUALITY[preset];
    if (!cfg) return;
    this.syncQualityButtons(cfg.fps, cfg.jpeg_quality);
    // Preserve existing codec/resolution, only change fps+quality
    const current = await api.get('/api/camera_settings');
    await api.post('/api/camera_settings', { ...current, ...cfg });
    await DeviceSetupTab.loadStreamSettings();
    const el = document.getElementById(statusId);
    if (el) {
      el.textContent = '✓ Applied';
      el.classList.add('visible');
      setTimeout(() => el.classList.remove('visible'), 2500);
    }
  },
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
  WS.connect();
  await loadConfig();
  StatusTab.refresh();
})();
