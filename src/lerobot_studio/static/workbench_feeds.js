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

/* ─── Feed Manager ───────────────────────────────────────────────────────────── */
const FeedManager = {
  _paused: new Set(),
  _watchers: new Map(),
  _watcherState: new Map(),
  _statTimer: null,
  _lastFps: new Map(),
  _lastFpsTs: new Map(),
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
    if (!cameras.length) { el.innerHTML = '<div class="no-cameras-empty"><div class="no-cam-text">No cameras detected.<br>Connect a camera and refresh.</div></div>'; return; }

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
    const STALL_MS = 12000;
    const TICK_MS = 2000;
    const NO_FRAME_TICKS = 8;
    this._watcherState.set(vid, { lastHash: null, stalledAt: null, noFrameTicks: 0 });

    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
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
        for (let i = 0; i < px.length; i += 32) h = (h * 31 + px[i] + px[i + 1] + px[i + 2]) >>> 0;

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
      } catch (_) {}
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
