/* ═══════════════════════════════════════════════════════════════════════════════
   DATASET VIEWER TAB
══════════════════════════════════════════════════════════════════════════════ */
const DatasetTab = {
  datasets: [],
  currentDataset: null,
  currentEpisode: 0,
  pushJobId: '',
  pushPollTimer: null,

  _syncRAF: null,
  _isSeeking: false,
  _playbackRate: 1,
  episodeTags: {},  // { episode_index_str: 'good'|'bad'|'review' }

  _escapeInlineArg(value) {
    return String(value || '').replace(/'/g, "\\'");
  },

  _renderActionsMenu(items, summaryLabel = 'Actions ▾') {
    const buttons = items.map((item) => {
      const cls = item.extraClass ? `btn-xs ${item.extraClass}` : 'btn-xs';
      return `<button class="${cls}" onclick="${item.onClick}">${item.label}</button>`;
    }).join('');
    return `
      <details class="ds-actions-menu" onclick="event.stopPropagation()">
        <summary class="btn-xs ds-actions-summary" title="Dataset actions">${summaryLabel}</summary>
        <div class="ds-actions-panel">
          ${buttons}
        </div>
      </details>
    `;
  },

  renderDetailActions() {
    const el = document.getElementById('ds-detail-actions');
    if (!el) return;
    el.innerHTML = this._renderActionsMenu([
      {
        label: 'Quality Check',
        onClick: 'event.stopPropagation(); DatasetTab.inspectQualityCurrent()',
      },
      {
        label: '↑ Push to Hub',
        extraClass: 'ds-action-btn-push',
        onClick: 'event.stopPropagation(); DatasetTab.pushCurrentToHub()',
      },
    ]);
  },

  async refreshList() {
    const el = document.getElementById('dataset-list');
    el.innerHTML = '<div class="device-item">Loading datasets...</div>';
    try {
      const res = await api.get('/api/datasets');
      this.datasets = res.datasets || [];
      this.renderList();
      if (ModeManager.mode === 'guided') ModeManager.scheduleReadinessRefresh(0);
    } catch (e) {
      el.innerHTML = `<div class="device-item"><span style="color:var(--red)">Failed to load datasets: ${e}</span></div>`;
      if (ModeManager.mode === 'guided') ModeManager.scheduleReadinessRefresh(0);
    }
  },

  renderList() {
    const el = document.getElementById('dataset-list');
    if (!this.datasets.length) {
      el.innerHTML = '<div class="device-item"><span class="dname muted">No datasets found in cache</span></div>';
      return;
    }
    el.innerHTML = this.datasets.map(ds => {
      const safeId = this._escapeInlineArg(ds.id);
      const actions = this._renderActionsMenu([
        {
          label: 'Quality',
          onClick: `event.stopPropagation(); DatasetTab.inspectQuality('${safeId}')`,
        },
        {
          label: 'Push',
          extraClass: 'ds-action-btn-push',
          onClick: `event.stopPropagation(); DatasetTab.pushToHub('${safeId}')`,
        },
        {
          label: 'Delete',
          extraClass: 'ds-action-btn-danger',
          onClick: `event.stopPropagation(); DatasetTab.deleteDataset('${safeId}')`,
        },
      ]);
      return `
      <div class="device-item" data-ds-id="${ds.id}" style="cursor:pointer; position:relative; align-items:flex-start;" onclick="DatasetTab.loadDataset('${safeId}')">
        <div style="flex:1;">
          <div style="font-weight:600; font-size:14px; margin-bottom:4px; color:var(--text1)">${ds.id}</div>
          <div style="font-size:11px; color:var(--text2)">
            ${ds.total_episodes} episodes · ${ds.total_frames} frames · ${ds.size_mb} MB
          </div>
          <div style="font-size:11px; color:var(--text2)">Modified: ${ds.modified}</div>
        </div>
        ${actions}
      </div>
    `;
    }).join('');
  },

  parseId(id) {
    const parts = String(id || '').split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    return { user: parts[0], repo: parts[1] };
  },

  showPushStatus(visible) {
    const wrap = document.getElementById('ds-push-status');
    if (!wrap) return;
    wrap.style.display = visible ? 'block' : 'none';
  },

  updatePushStatus(status, phase, progress, note = '') {
    const label = document.getElementById('ds-push-label');
    const pct = document.getElementById('ds-push-percent');
    const fill = document.getElementById('ds-push-fill');
    const msg = document.getElementById('ds-push-note');
    if (label) label.textContent = `Hub Upload · ${phase || status}`;
    if (pct) pct.textContent = `${Math.max(0, Math.min(100, progress || 0))}%`;
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, progress || 0))}%`;
    if (msg) msg.textContent = note || '';
  },

  startPushPolling(jobId) {
    if (this.pushPollTimer) {
      clearInterval(this.pushPollTimer);
      this.pushPollTimer = null;
    }
    this.pushJobId = jobId;
    this.pushPollTimer = setInterval(async () => {
      if (!this.pushJobId) return;
      const res = await api.get(`/api/datasets/push/status/${encodeURIComponent(this.pushJobId)}`);
      if (!res.ok) {
        this.updatePushStatus('error', 'error', 0, res.error || 'Unknown push status error');
        if (this.pushPollTimer) clearInterval(this.pushPollTimer);
        this.pushPollTimer = null;
        return;
      }
      const status = String(res.status || 'running');
      const phase = String(res.phase || status);
      const progress = Number(res.progress || 0);
      const tail = Array.isArray(res.logs) && res.logs.length ? res.logs[res.logs.length - 1] : '';
      const note = status === 'error' ? (res.error || tail || 'Upload failed') : tail;
      this.updatePushStatus(status, phase, progress, note);

      if (status === 'success') {
        showToast(`Dataset pushed to Hub: ${res.repo_id}`, 'success');
        if (this.pushPollTimer) clearInterval(this.pushPollTimer);
        this.pushPollTimer = null;
      }
      if (status === 'error') {
        showToast(`Hub push failed: ${res.error || 'Unknown error'}`, 'error');
        if (this.pushPollTimer) clearInterval(this.pushPollTimer);
        this.pushPollTimer = null;
      }
    }, 1200);
  },

  async pushToHub(id) {
    const parsed = this.parseId(id);
    if (!parsed) {
      showToast('Invalid dataset id format.', 'error');
      return;
    }

    const targetRaw = prompt('Target Hub repo (username/dataset). Leave empty to use same id:', id);
    if (targetRaw === null) return;
    const target = targetRaw.trim() || id;
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(target)) {
      showToast('Target repo must be username/dataset format.', 'error');
      return;
    }

    this.showPushStatus(true);
    this.updatePushStatus('starting', 'starting', 2, 'Preparing upload job...');
    const res = await api.post(`/api/datasets/${parsed.user}/${parsed.repo}/push`, { target_repo_id: target });
    if (!res.ok) {
      this.updatePushStatus('error', 'error', 0, res.error || 'Failed to create upload job');
      showToast(`Hub push failed: ${res.error || 'Unknown error'}`, 'error');
      return;
    }
    this.updatePushStatus('queued', 'queued', 5, 'Upload job queued...');
    this.startPushPolling(res.job_id);
  },

  async pushCurrentToHub() {
    if (!this.currentDataset?.dataset_id) {
      showToast('Select a dataset first.', 'error');
      return;
    }
    await this.pushToHub(this.currentDataset.dataset_id);
  },

  renderQualityResult(res) {
    const panel = document.getElementById('ds-quality-panel');
    const scoreEl = document.getElementById('ds-quality-score');
    const statsEl = document.getElementById('ds-quality-stats');
    const checksEl = document.getElementById('ds-quality-checks');
    if (!panel || !scoreEl || !checksEl || !statsEl) return;

    panel.style.display = 'block';
    const score = Number(res.score || 0);
    scoreEl.textContent = `Score: ${score}`;
    scoreEl.className = `dbadge ${score >= 80 ? 'badge-ok' : score >= 60 ? 'badge-warn' : 'badge-err'}`;

    const stats = res.stats || {};
    const breakdown = res.score_breakdown || {};
    const cameraCounts = stats.camera_file_counts || {};
    const camSummary = Object.keys(cameraCounts).length
      ? Object.entries(cameraCounts).map(([k, v]) => `${k}:${v}`).join(' · ')
      : '--';
    const penaltySummary = Object.keys(breakdown).length
      ? Object.entries(breakdown).map(([k, v]) => `${k}-${v}`).join(' · ')
      : '--';
    statsEl.textContent = `Episodes ${stats.total_detected_episodes ?? '--'} (expected ${stats.total_expected_episodes ?? '--'}) · Frames ${stats.total_frames ?? '--'} · FPS ${stats.fps ?? '--'} · Zero-byte videos ${stats.zero_byte_videos ?? '--'} · Camera files ${camSummary} · Penalty ${penaltySummary}`;

    const checks = Array.isArray(res.checks) ? res.checks : [];
    checksEl.innerHTML = checks.map((c) => {
      const level = c.level || 'ok';
      const cls = level === 'error' ? 'badge-err' : level === 'warn' ? 'badge-warn' : 'badge-ok';
      return `<div class="device-item" style="align-items:flex-start;">
        <span class="dbadge ${cls}" style="margin-top:2px;">${String(level).toUpperCase()}</span>
        <div style="flex:1; min-width:0;">
          <div class="dname">${c.name || 'check'}</div>
          <div class="dsub" style="white-space:normal; line-height:1.45;">${c.message || ''}</div>
        </div>
      </div>`;
    }).join('');
  },

  async inspectQuality(id) {
    const parsed = this.parseId(id);
    if (!parsed) {
      showToast('Invalid dataset id format.', 'error');
      return;
    }
    const res = await api.get(`/api/datasets/${parsed.user}/${parsed.repo}/quality`);
    if (!res.ok) {
      showToast(`Quality check failed: ${res.error || 'Unknown error'}`, 'error');
      return;
    }
    this.renderQualityResult(res);
    showToast('Quality check complete.', 'success');
  },

  async inspectQualityCurrent() {
    if (!this.currentDataset?.dataset_id) {
      showToast('Select a dataset first.', 'error');
      return;
    }
    await this.inspectQuality(this.currentDataset.dataset_id);
  },

  async loadDataset(id) {
    // Highlight selected item in list
    document.querySelectorAll('#dataset-list .device-item').forEach(el => {
      el.classList.toggle('selected', el.dataset.dsId === id);
    });
    document.getElementById('dataset-detail-empty').style.display = 'none';
    const view = document.getElementById('dataset-detail-view');
    view.style.display = 'flex';
    this.renderDetailActions();
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
      this.showPushStatus(false);
      const panel = document.getElementById('ds-quality-panel');
      if (panel) panel.style.display = 'none';
      document.getElementById('ds-title').textContent = ds.dataset_id;
      document.getElementById('ds-stats').textContent =
        `${ds.total_episodes} episodes · ${ds.total_frames} frames · ${ds.fps} FPS · Cameras: ${ds.cameras.join(', ') || 'None'}`;

      const sel = document.getElementById('ds-ep-select');
      sel.innerHTML = ds.episodes.map(e => `<option value="${e.episode_index}">Episode ${e.episode_index} (${e.length} frames)</option>`).join('');

      if (ds.episodes.length > 0) {
        this.selectEpisode(ds.episodes[0].episode_index);
        this.loadTags();
      }
    } catch (e) {
      document.getElementById('ds-title').textContent = 'Error';
      document.getElementById('ds-stats').textContent = String(e);
    }
  },

  async deleteDataset(id) {
    if (!confirm(`Are you sure you want to delete dataset "${id}"?\nThis cannot be undone.`)) return;

    try {
      const parts = id.split('/');
      const user = parts[0];
      const repo = parts[1];
      const res = await fetch(`/api/datasets/${user}/${repo}`, { method: 'DELETE' });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to delete');
      }

      if (this.currentDataset && this.currentDataset.dataset_id === id) {
        document.getElementById('dataset-detail-empty').style.display = 'block';
        document.getElementById('dataset-detail-view').style.display = 'none';
        this.currentDataset = null;
      }
      this.refreshList();
    } catch (e) {
      alert(e);
    }
  },

  selectEpisode(epIdx) {
    this.currentEpisode = parseInt(epIdx, 10);
    const ds = this.currentDataset;
    if (!ds) return;
    this._stopSync();
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
    const episode = (ds.episodes || []).find(e => Number(e.episode_index) === this.currentEpisode) || null;
    const to3 = (v) => String(Math.max(0, parseInt(v, 10) || 0)).padStart(3, '0');
    grid.innerHTML = ds.cameras.map(cam => {
      const vf = episode?.video_files?.[cam] || {};
      const chunk = `chunk-${to3(vf.chunk_index)}`;
      const file = `file-${to3(vf.file_index)}.mp4`;
      const startTs = Number.isFinite(Number(vf.from_timestamp)) ? Number(vf.from_timestamp) : 0;
      const endTs = Number.isFinite(Number(vf.to_timestamp)) ? Number(vf.to_timestamp) : null;
      return `
      <div style="background:var(--bg-app); border:1px solid var(--border); border-radius:6px; overflow:hidden;">
        <div style="padding:6px 10px; font-size:11px; font-family:var(--mono); border-bottom:1px solid var(--border); background:rgba(0,0,0,0.2);">
          ${cam}
        </div>
        <video class="ds-video" data-ep-start="${startTs}" data-ep-end="${endTs === null ? '' : endTs}" src="/api/datasets/${user}/${repo}/videos/${cam}/${chunk}/${file}" preload="metadata" muted playsinline style="width:100%; display:block;"></video>
      </div>
    `;
    }).join('');
    /* Wait for primary video metadata, then seek to episode start */
    const primary = this._primaryVideo();
    if (primary) {
      primary.addEventListener('loadedmetadata', () => {
        this.seekAll(0);
        this._updateScrubber();
      }, { once: true });
    }

    this._initControls();
    this._updatePlayBtn();
    controls.style.display = 'flex';
    this._updateTagUI();
  },
  /* ═══════════════════════════════════════════════════════════════════════════
     SYNCHRONIZED VIDEO REPLAYER
  ═══════════════════════════════════════════════════════════════════════════ */

  _allVideos() {
    return Array.from(document.querySelectorAll('.ds-video'));
  },

  _primaryVideo() {
    return document.querySelector('.ds-video');
  },

  _episodeStart() {
    const v = this._primaryVideo();
    return v ? Number(v.dataset.epStart || '0') : 0;
  },

  _episodeDuration() {
    const v = this._primaryVideo();
    if (!v) return 0;
    const start = Number(v.dataset.epStart || '0');
    const endRaw = v.dataset.epEnd;
    const end = endRaw ? Number(endRaw) : (v.duration || 0);
    return Math.max(0, end - start);
  },

  togglePlay() {
    const primary = this._primaryVideo();
    if (!primary) return;
    if (primary.paused) {
      this._allVideos().forEach(v => {
        v.playbackRate = this._playbackRate;
        v.play().catch(() => {});
      });
      this._startSync();
    } else {
      this._allVideos().forEach(v => v.pause());
      this._stopSync();
    }
    this._updatePlayBtn();
  },

  seekAll(epRelativeTime) {
    const t = Math.max(0, epRelativeTime);
    this._allVideos().forEach(v => {
      const start = Number(v.dataset.epStart || '0');
      v.currentTime = start + t;
    });
  },

  setSpeed(rate) {
    this._playbackRate = Number(rate) || 1;
    this._allVideos().forEach(v => { v.playbackRate = this._playbackRate; });
  },

  stepFrame(dir) {
    const ds = this.currentDataset;
    if (!ds) return;
    const fps = ds.fps || 30;
    const frameDur = 1 / fps;
    const primary = this._primaryVideo();
    if (!primary) return;

    this._allVideos().forEach(v => v.pause());
    this._stopSync();

    const start = this._episodeStart();
    const pos = primary.currentTime - start;
    const dur = this._episodeDuration();
    const next = Math.max(0, Math.min(pos + dir * frameDur, dur));
    this.seekAll(next);
    this._updateScrubber();
    this._updatePlayBtn();
  },

  _startSync() {
    if (this._syncRAF) return;
    const tick = () => {
      this._updateScrubber();
      this._checkEpisodeEnd();
      this._syncRAF = requestAnimationFrame(tick);
    };
    this._syncRAF = requestAnimationFrame(tick);
  },

  _stopSync() {
    if (this._syncRAF) {
      cancelAnimationFrame(this._syncRAF);
      this._syncRAF = null;
    }
  },

  _updateScrubber() {
    const primary = this._primaryVideo();
    const scrubber = document.getElementById('ds-scrubber');
    const curEl = document.getElementById('ds-time-current');
    const totEl = document.getElementById('ds-time-total');
    if (!primary || !scrubber || this._isSeeking) return;

    const start = this._episodeStart();
    const dur = this._episodeDuration();
    const pos = Math.max(0, primary.currentTime - start);

    scrubber.max = String(Math.round(dur * 1000));
    scrubber.value = String(Math.round(pos * 1000));
    if (curEl) curEl.textContent = this._fmtTime(pos);
    if (totEl) totEl.textContent = this._fmtTime(dur);
  },

  _checkEpisodeEnd() {
    const primary = this._primaryVideo();
    if (!primary || primary.paused) return;
    const endRaw = primary.dataset.epEnd;
    if (!endRaw) return;
    const end = Number(endRaw);
    if (Number.isFinite(end) && end > 0 && primary.currentTime >= end) {
      this._allVideos().forEach(v => v.pause());
      this._stopSync();
      this._updatePlayBtn();
    }
  },

  _updatePlayBtn() {
    const btn = document.getElementById('ds-play-btn');
    const primary = this._primaryVideo();
    if (!btn || !primary) return;
    btn.textContent = primary.paused ? '▶ Play' : '⏸ Pause';
  },

  _onScrubInput() {
    const scrubber = document.getElementById('ds-scrubber');
    const curEl = document.getElementById('ds-time-current');
    if (!scrubber || !curEl) return;
    const ms = Number(scrubber.value);
    curEl.textContent = this._fmtTime(ms / 1000);
    this.seekAll(ms / 1000);
  },

  _fmtTime(secs) {
    if (!Number.isFinite(secs) || secs < 0) return '0:00.0';
    const s = Math.floor(secs);
    const m = Math.floor(s / 60);
    const ss = s % 60;
    const frac = Math.floor((secs - s) * 10);
    return m > 0 ? `${m}:${String(ss).padStart(2, '0')}.${frac}` : `0:${String(ss).padStart(2, '0')}.${frac}`;
  },

  _initControls() {
    const scrubber = document.getElementById('ds-scrubber');
    if (!scrubber) return;

    scrubber.addEventListener('mousedown', () => { this._isSeeking = true; });
    scrubber.addEventListener('touchstart', () => { this._isSeeking = true; }, { passive: true });
    scrubber.addEventListener('input', () => this._onScrubInput());
    scrubber.addEventListener('change', () => {
      this._isSeeking = false;
      this._onScrubInput();
    });

    const speedSel = document.getElementById('ds-speed-select');
    if (speedSel) speedSel.value = String(this._playbackRate);
  },

  playAll() {
    this._allVideos().forEach(v => {
      v.playbackRate = this._playbackRate;
      v.play().catch(() => {});
    });
    this._startSync();
    this._updatePlayBtn();
  },

  pauseAll() {
    this._allVideos().forEach(v => v.pause());
    this._stopSync();
    this._updatePlayBtn();
  },

  async loadTags() {
    const ds = this.currentDataset;
    if (!ds?.dataset_id) return;
    const parts = ds.dataset_id.split('/');
    try {
      const res = await api.get(`/api/datasets/${parts[0]}/${parts[1]}/tags`);
      this.episodeTags = (res.ok && res.tags) ? res.tags : {};
    } catch (e) {
      this.episodeTags = {};
    }
    this._updateTagUI();
    this._updateEpisodeDropdown();
  },

  async tagEpisode(tag) {
    const ds = this.currentDataset;
    if (!ds?.dataset_id) return;
    const parts = ds.dataset_id.split('/');
    const epIdx = this.currentEpisode;
    try {
      const res = await api.post(`/api/datasets/${parts[0]}/${parts[1]}/tags`, {
        episode_index: epIdx,
        tag,
      });
      if (res.ok) {
        if (tag === 'untagged') {
          delete this.episodeTags[String(epIdx)];
        } else {
          this.episodeTags[String(epIdx)] = tag;
        }
        this._updateTagUI();
        this._updateEpisodeDropdown();
        if (typeof showToast === 'function') showToast(`Episode ${epIdx} tagged: ${tag}`, 'info');
      } else {
        if (typeof showToast === 'function') showToast(`Tag failed: ${res.error || 'Unknown error'}`, 'error');
      }
    } catch (e) {
      if (typeof showToast === 'function') showToast('Tag request failed', 'error');
    }
  },

  _updateTagUI() {
    const epIdx = String(this.currentEpisode);
    const tag = this.episodeTags[epIdx] || 'untagged';
    const TAG_STYLE = {
      good:     { bg: 'rgba(34,197,94,0.25)',  color: '#86efac', border: 'rgba(34,197,94,0.5)' },
      bad:      { bg: 'rgba(248,81,73,0.25)',   color: '#fca5a5', border: 'rgba(248,81,73,0.5)' },
      review:   { bg: 'rgba(245,158,11,0.25)',  color: '#fcd34d', border: 'rgba(245,158,11,0.5)' },
      untagged: { bg: '',                        color: '',        border: '' },
    };
    const BTN_IDS = { good: 'ds-tag-good', bad: 'ds-tag-bad', review: 'ds-tag-review' };
    for (const [t, btnId] of Object.entries(BTN_IDS)) {
      const btn = document.getElementById(btnId);
      if (!btn) continue;
      if (t === tag) {
        const s = TAG_STYLE[t];
        btn.style.background = s.bg;
        btn.style.color = s.color;
        btn.style.borderColor = s.border;
      } else {
        btn.style.background = '';
        btn.style.color = '';
        btn.style.borderColor = '';
      }
    }
    const statusEl = document.getElementById('ds-tag-status');
    if (statusEl) {
      const EMOJI = { good: '👍 Good', bad: '👎 Bad', review: '🔍 Review', untagged: '' };
      statusEl.textContent = EMOJI[tag] || '';
    }
  },

  _updateEpisodeDropdown() {
    const ds = this.currentDataset;
    if (!ds) return;
    const sel = document.getElementById('ds-ep-select');
    if (!sel) return;
    const EMOJI = { good: '👍 ', bad: '👎 ', review: '🔍 ', untagged: '' };
    sel.innerHTML = ds.episodes.map(e => {
      const tag = this.episodeTags[String(e.episode_index)] || 'untagged';
      const prefix = EMOJI[tag] || '';
      return `<option value="${e.episode_index}">${prefix}Episode ${e.episode_index} (${e.length} frames)</option>`;
    }).join('');
    sel.value = String(this.currentEpisode);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════════
   HUGGINGFACE HUB SEARCH
═══════════════════════════════════════════════════════════════════════════════ */
const HubSearch = {
  _dlJobId: null,
  _dlPollTimer: null,

  _setStatus(text, cls = 'badge-idle') {
    const el = document.getElementById('hub-search-status');
    if (!el) return;
    el.textContent = text;
    el.className = `dbadge ${cls}`;
  },

  async search() {
    const query = (document.getElementById('hub-search-query')?.value || '').trim();
    const tag   = (document.getElementById('hub-search-tag')?.value  || '').trim() || 'lerobot';
    const el    = document.getElementById('hub-search-results');
    if (!el) return;

    this._setStatus('Searching…', 'badge-warn');
    el.innerHTML = '<div class="device-item"><span class="muted">Searching Hub…</span></div>';

    try {
      const params = new URLSearchParams({ query, tag, limit: 30 });
      const res = await api.get(`/api/hub/datasets/search?${params}`);
      if (!res.ok) {
        el.innerHTML = `<div class="device-item"><span style="color:var(--red)">${res.error || 'Search failed'}</span></div>`;
        this._setStatus('Error', 'badge-err');
        return;
      }
      const datasets = res.datasets || [];
      if (!datasets.length) {
        el.innerHTML = '<div class="device-item"><span class="muted">No results found.</span></div>';
        this._setStatus(`0 results`, 'badge-idle');
        return;
      }
      this._setStatus(`${datasets.length} results`, 'badge-ok');
      el.innerHTML = datasets.map(ds => {
        const safeId = ds.id.replace(/'/g, '&#39;');
        const tags = (ds.tags || []).slice(0, 4).join(' · ');
        const meta = [
          ds.downloads > 0 ? `↓ ${ds.downloads.toLocaleString()}` : null,
          ds.likes     > 0 ? `♥ ${ds.likes}`                      : null,
          ds.last_modified ? ds.last_modified.slice(0, 10)         : null,
        ].filter(Boolean).join(' · ');
        return `
          <div class="device-item" style="align-items:flex-start; gap:8px;">
            <div style="flex:1; min-width:0;">
              <div style="font-weight:600; font-size:13px; color:var(--text1); word-break:break-all;">${ds.id}</div>
              <div style="font-size:11px; color:var(--text2); margin-top:2px;">${meta}</div>
              ${tags ? `<div style="font-size:10px; color:var(--text2); margin-top:2px; font-family:var(--mono);">${tags}</div>` : ''}
            </div>
            <div style="display:flex; flex-direction:column; gap:4px; flex-shrink:0;">
              <button class="btn-xs" onclick="HubSearch.download('${safeId}')">↓ Download</button>
            </div>
          </div>
        `;
      }).join('');
    } catch (e) {
      el.innerHTML = `<div class="device-item"><span style="color:var(--red)">Search error: ${e}</span></div>`;
      this._setStatus('Error', 'badge-err');
    }
  },

  async download(repoId) {
    if (!repoId) return;
    if (!confirm(`Download dataset "${repoId}" from HuggingFace Hub?\n\nLarge datasets may take several minutes.`)) return;

    this._stopPoll();
    const panel = document.getElementById('hub-download-panel');
    if (panel) panel.style.display = 'block';
    this._updateDownload('queued', 0, 'Preparing download…');

    try {
      const res = await api.post('/api/hub/datasets/download', { repo_id: repoId });
      if (!res.ok) {
        this._updateDownload('error', 0, res.error || 'Failed to start download');
        if (typeof showToast === 'function') showToast(`Download failed: ${res.error}`, 'error');
        return;
      }
      this._dlJobId = res.job_id;
      this._startPoll(repoId);
    } catch (e) {
      this._updateDownload('error', 0, String(e));
      if (typeof showToast === 'function') showToast('Download request failed', 'error');
    }
  },

  _updateDownload(status, pct, note) {
    const label   = document.getElementById('hub-dl-label');
    const percent = document.getElementById('hub-dl-percent');
    const fill    = document.getElementById('hub-dl-fill');
    const noteEl  = document.getElementById('hub-dl-note');
    const clamped = Math.max(0, Math.min(100, pct || 0));
    if (label)   label.textContent   = `Hub Download · ${status}`;
    if (percent) percent.textContent = `${clamped}%`;
    if (fill)    fill.style.width    = `${clamped}%`;
    if (noteEl)  noteEl.textContent  = note || '';
  },

  _startPoll(repoId) {
    this._dlPollTimer = setInterval(async () => {
      if (!this._dlJobId) return;
      try {
        const res = await api.get(`/api/hub/datasets/download/status/${encodeURIComponent(this._dlJobId)}`);
        if (!res.ok) {
          this._updateDownload('error', 0, res.error || 'Status poll failed');
          this._stopPoll();
          return;
        }
        const status = String(res.status || 'running');
        const tail = Array.isArray(res.logs) && res.logs.length ? res.logs[res.logs.length - 1] : '';
        const note = status === 'error' ? (res.error || tail || 'Download failed') : tail;
        this._updateDownload(status, res.progress || 0, note);

        if (status === 'success') {
          this._stopPoll();
          if (typeof showToast === 'function') showToast(`Downloaded: ${repoId}`, 'success');
          if (typeof DatasetTab !== 'undefined') DatasetTab.refreshList();
        }
        if (status === 'error') {
          this._stopPoll();
          if (typeof showToast === 'function') showToast(`Download failed: ${res.error || 'Unknown error'}`, 'error');
        }
      } catch (e) {
        this._updateDownload('error', 0, String(e));
        this._stopPoll();
      }
    }, 1200);
  },

  _stopPoll() {
    if (this._dlPollTimer) {
      clearInterval(this._dlPollTimer);
      this._dlPollTimer = null;
    }
    this._dlJobId = null;
  },
};
