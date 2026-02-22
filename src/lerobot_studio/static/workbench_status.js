const StatusTab = {
  _resourceTimer: null,
  _historyTimer: null,
  _resourceFailCount: 0,
  _historyFailCount: 0,

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

    this.refreshResources();
    this.startResourcePolling();
    this.refreshHistory();
    this.startHistoryPolling();
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

  /* ═══════════════════════════════════════════════════════════════════════
     SYSTEM RESOURCE DASHBOARD
  ═══════════════════════════════════════════════════════════════════════ */

  async refreshResources() {
    const el = document.getElementById('status-resources');
    if (!el) return;
    if (state.apiSupport?.resources === false) {
      el.innerHTML = `<div class="device-item"><span class="dname muted">System resources endpoint is not available in this server version.</span></div>`;
      return;
    }
    try {
      const r = await fetch('/api/system/resources');
      if (r.status === 404) {
        WS.setApiSupport('resources', false);
        WS.setApiHealth('resources', true);
        this.stopResourcePolling();
        el.innerHTML = `<div class="device-item"><span class="dname muted">System resources endpoint is not available in this server version.</span></div>`;
        return;
      }
      const res = await r.json();
      if (!res.ok) {
        this._resourceFailCount++;
        WS.setApiSupport('resources', true);
        WS.setApiHealth('resources', false);
        el.innerHTML = `<div class="device-item"><span class="dname" style="color:var(--red)">Could not load system resources</span></div>`;
        return;
      }
      this._resourceFailCount = 0;
      WS.setApiSupport('resources', true);
      WS.setApiHealth('resources', true);
      this.renderResources(el, res);
    } catch (e) {
      this._resourceFailCount++;
      WS.setApiSupport('resources', true);
      WS.setApiHealth('resources', false);
      el.innerHTML = `<div class="device-item"><span class="dname muted">System resources unavailable — retrying...</span></div>`;
    }
  },

  renderResources(el, res) {
    const mkBar = (pct, color) => {
      const w = Math.max(0, Math.min(100, pct));
      const fill = pct >= 90 ? 'var(--red)' : pct >= 75 ? '#f59e0b' : color;
      return `<div style="height:4px;background:var(--bg3);border-radius:2px;margin-top:4px;overflow:hidden;"><div style="width:${w}%;height:100%;background:${fill};border-radius:2px;transition:width .4s;"></div></div>`;
    };

    const fmt = (mb) => mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;

    const cpuColor = res.cpu_percent >= 90 ? 'var(--red)' : res.cpu_percent >= 75 ? '#f59e0b' : 'var(--accent)';
    const ramColor = res.ram_percent >= 90 ? 'var(--red)' : res.ram_percent >= 75 ? '#f59e0b' : '#6ee7b7';
    const diskColor = res.disk_percent >= 90 ? 'var(--red)' : res.disk_percent >= 75 ? '#f59e0b' : '#a78bfa';

    const rows = [
      `<div class="device-item" style="flex-direction:column;align-items:stretch;gap:2px;">
        <div style="display:flex;justify-content:space-between;">
          <span class="dname">CPU</span>
          <span style="font-size:12px;color:${cpuColor};font-weight:600;">${res.cpu_percent}%</span>
        </div>
        ${mkBar(res.cpu_percent, 'var(--accent)')}
      </div>`,
      `<div class="device-item" style="flex-direction:column;align-items:stretch;gap:2px;">
        <div style="display:flex;justify-content:space-between;">
          <span class="dname">RAM</span>
          <span style="font-size:12px;color:${ramColor};font-weight:600;">${fmt(res.ram_used_mb)} / ${fmt(res.ram_total_mb)}</span>
        </div>
        ${mkBar(res.ram_percent, '#6ee7b7')}
      </div>`,
      `<div class="device-item" style="flex-direction:column;align-items:stretch;gap:2px;">
        <div style="display:flex;justify-content:space-between;">
          <span class="dname">Disk (home)</span>
          <span style="font-size:12px;color:${diskColor};font-weight:600;">${res.disk_used_gb} / ${res.disk_total_gb} GB</span>
        </div>
        ${mkBar(res.disk_percent, '#a78bfa')}
      </div>`,
    ];

    if (res.lerobot_cache_mb !== null && res.lerobot_cache_mb !== undefined) {
      rows.push(`<div class="device-item">
        <div>
          <div class="dname">LeRobot Cache</div>
          <div class="dsub">~/.cache/huggingface/lerobot</div>
        </div>
        <span style="font-size:12px;color:var(--text2);">${fmt(res.lerobot_cache_mb)}</span>
      </div>`);
    }

    el.innerHTML = rows.join('');
  },

  startResourcePolling() {
    if (state.apiSupport?.resources === false) return;
    if (this._resourceTimer) return;
    const interval = Math.min(5000 * Math.pow(2, this._resourceFailCount), 60000);
    this._resourceTimer = setInterval(() => {
      this.refreshResources();
      if (this._resourceFailCount > 0) {
        this.stopResourcePolling();
        this.startResourcePolling();
      }
    }, interval);
  },

  stopResourcePolling() {
    if (this._resourceTimer) {
      clearInterval(this._resourceTimer);
      this._resourceTimer = null;
    }
  },

  /* ═══════════════════════════════════════════════════════════════════════
     SESSION HISTORY
  ═══════════════════════════════════════════════════════════════════════ */

  async refreshHistory() {
    const el = document.getElementById('status-history');
    if (!el) return;
    if (state.apiSupport?.history === false) {
      el.innerHTML = `<div class="device-item"><span class="dname muted">Session history endpoint is not available in this server version.</span></div>`;
      return;
    }
    try {
      const r = await fetch('/api/history?limit=50');
      if (r.status === 404) {
        WS.setApiSupport('history', false);
        WS.setApiHealth('history', true);
        this.stopHistoryPolling();
        el.innerHTML = `<div class="device-item"><span class="dname muted">Session history endpoint is not available in this server version.</span></div>`;
        return;
      }
      const res = await r.json();
      if (!res.ok) {
        this._historyFailCount++;
        WS.setApiSupport('history', true);
        WS.setApiHealth('history', false);
        el.innerHTML = `<div class="device-item"><span class="dname muted">Session history temporarily unavailable</span></div>`;
        return;
      }
      this._historyFailCount = 0;
      WS.setApiSupport('history', true);
      WS.setApiHealth('history', true);
      this.renderHistory(el, res.entries || []);
    } catch (e) {
      this._historyFailCount++;
      WS.setApiSupport('history', true);
      WS.setApiHealth('history', false);
      el.innerHTML = `<div class="device-item"><span class="dname muted">Could not load history — retrying...</span></div>`;
    }
  },

  renderHistory(el, entries) {
    if (!entries.length) {
      el.innerHTML = `<div class="device-item"><span class="dname muted">No session events yet. Start calibration, recording, training, or eval to see history here.</span></div>`;
      return;
    }
    const TYPE_META = {
      calibrate_start: { icon: '🔧', label: 'Calibration started', color: '#93c5fd' },
      calibrate_end:   { icon: '✅', label: 'Calibration ended',   color: 'var(--text2)' },
      record_start:    { icon: '🎬', label: 'Recording started',   color: '#6ee7b7' },
      record_end:      { icon: '⏹',  label: 'Recording ended',    color: 'var(--text2)' },
      train_start:     { icon: '🧠', label: 'Training started',    color: '#a78bfa' },
      train_end:       { icon: '🏁', label: 'Training ended',      color: 'var(--text2)' },
      eval_start:      { icon: '🎯', label: 'Evaluation started',  color: '#fcd34d' },
      eval_end:        { icon: '🎯', label: 'Evaluation ended',    color: 'var(--text2)' },
    };
    const reversed = [...entries].reverse();
    el.innerHTML = reversed.map(e => {
      const m = TYPE_META[e.type] || { icon: '📌', label: e.type, color: 'var(--text2)' };
      const meta = e.meta || {};
      const subtitle = Object.entries(meta)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' · ');
      return `<div class="device-item" style="flex-direction:column;align-items:flex-start;gap:2px;padding:6px 8px;">
        <div style="display:flex;align-items:center;gap:8px;width:100%;">
          <span style="font-size:14px;">${m.icon}</span>
          <span class="dname" style="color:${m.color};flex:1;">${m.label}</span>
          <span style="font-size:10px;color:var(--text2);font-family:var(--mono);">${e.ts}</span>
        </div>
        ${subtitle ? `<div class="dsub" style="margin-left:22px;font-size:10px;">${subtitle}</div>` : ''}
      </div>`;
    }).join('');
  },

  async clearHistory() {
    if (!confirm('Clear all session history?')) return;
    try {
      await api.post('/api/history/clear', {});
      this.refreshHistory();
      if (typeof showToast === 'function') showToast('History cleared', 'info');
    } catch (e) {
      if (typeof showToast === 'function') showToast('Failed to clear history', 'error');
    }
  },

  startHistoryPolling() {
    if (state.apiSupport?.history === false) return;
    if (this._historyTimer) return;
    const interval = Math.min(30000 * Math.pow(2, this._historyFailCount), 120000);
    this._historyTimer = setInterval(() => {
      this.refreshHistory();
      if (this._historyFailCount > 0) {
        this.stopHistoryPolling();
        this.startHistoryPolling();
      }
    }, interval);
  },

  stopHistoryPolling() {
    if (this._historyTimer) {
      clearInterval(this._historyTimer);
      this._historyTimer = null;
    }
  },
};
