/* ═══════════════════════════════════════════════════════════════════════════════
   TRAIN TAB
══════════════════════════════════════════════════════════════════════════════ */
const TrainTab = {
  datasetSource: 'local',
  preflightOk: true,
  preflightReason: '',
  preflightAction: '',
  preflightCommand: '',
  progressRunning: false,
  progressHadError: false,
  progressTotalSteps: null,
  progressCurrentStep: null,
  progressLoss: null,
  progressLr: null,
  progressStartMs: null,
  lossHistory: [],
  lrHistory: [],
  stepHistory: [],
  lossHistoryMax: 300,
  _gpuPollTimer: null,

  applyConfig(cfg) {
    const savedSource = cfg && cfg.train_dataset_source === 'hf' ? 'hf' : 'local';
    this.setDatasetSource(savedSource, false);
    setVal('train-policy', cfg.train_policy || 'act');
    setVal('train-steps', String(cfg.train_steps || 100000));
    setVal('train-device', cfg.train_device || 'cuda');
    setVal('train-repo', cfg.train_repo_id || 'user/my-dataset');
    if (cfg.train_batch_size) setVal('train-batch-size', String(cfg.train_batch_size));
    if (cfg.train_lr) setVal('train-lr', String(cfg.train_lr));
  },

  applyPreset(preset) {
    const PRESETS = {
      quick:    { steps: 1000,   batchSize: 8,  lr: '1e-4', label: 'Quick Test (1K)' },
      standard: { steps: 50000,  batchSize: 64, lr: '1e-4', label: 'Standard (50K)' },
      full:     { steps: 100000, batchSize: 64, lr: '1e-4', label: 'Full (100K)' },
    };
    const p = PRESETS[preset];
    if (!p) return;
    setVal('train-steps', String(p.steps));
    setVal('train-batch-size', String(p.batchSize));
    setVal('train-lr', p.lr);
    showToast('Preset applied: ' + p.label, 'success');
  },

  getDatasetSource() {
    return this.datasetSource;
  },

  setDatasetSource(source, persist = true) {
    const next = source === 'hf' ? 'hf' : 'local';
    this.datasetSource = next;

    const localBtn = document.getElementById('train-source-local');
    const hfBtn = document.getElementById('train-source-hf');
    const localWrap = document.getElementById('train-local-wrap');
    const hfWrap = document.getElementById('train-hf-wrap');
    const err = document.getElementById('train-repo-error');

    if (localBtn) localBtn.classList.toggle('active', next === 'local');
    if (hfBtn) hfBtn.classList.toggle('active', next === 'hf');
    if (localWrap) localWrap.classList.toggle('hidden', next !== 'local');
    if (hfWrap) hfWrap.classList.toggle('hidden', next !== 'hf');
    if (err) err.style.display = 'none';

    if (persist && state.config) {
      state.config.train_dataset_source = next;
      saveConfig();
    }

    this.syncRepoFromSource();
  },

  syncRepoFromSource() {
    if (this.getDatasetSource() !== 'local') return;
    const select = document.getElementById('train-local-repo');
    const input = document.getElementById('train-repo');
    if (!select || !input) return;
    const value = select.value.trim();
    if (value && value !== '__none__') {
      input.value = value;
    }
  },

  validateRepoId() {
    const source = this.getDatasetSource();
    const val = getVal('train-repo').trim();
    const input = document.getElementById('train-repo');
    const localSelect = document.getElementById('train-local-repo');
    const err = document.getElementById('train-repo-error');

    if (source === 'local') {
      const localRepoId = localSelect ? localSelect.value.trim() : '';
      if (!localRepoId || localRepoId === '__none__') {
        if (localSelect) localSelect.style.borderColor = 'var(--red)';
        if (err) {
          err.textContent = 'No local dataset found. Switch to Hugging Face or create a local dataset first.';
          err.style.display = 'block';
        }
        return false;
      }
      if (localSelect) localSelect.style.borderColor = 'var(--border)';
      if (input) input.style.borderColor = 'var(--border)';
      if (err) err.style.display = 'none';
      return true;
    }

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
      const select = document.getElementById('train-local-repo');
      const datasets = Array.isArray(res.datasets) ? res.datasets : [];
      if (select) {
        if (datasets.length) {
          select.innerHTML = datasets.map(ds => `<option value="${ds.id}">${ds.id}</option>`).join('');
          select.disabled = false;
          if (!datasets.some(ds => ds.id === select.value)) {
            select.value = datasets[0].id;
          }
        } else {
          select.innerHTML = '<option value="__none__">No local datasets found</option>';
          select.value = '__none__';
          select.disabled = true;
        }
      }

      if (datasets.length === 0 && this.getDatasetSource() === 'local') {
        this.setDatasetSource('hf');
      } else {
        this.syncRepoFromSource();
      }
      this.validateRepoId();
    } catch (e) {
      console.warn("Failed to load datasets for train tab", e);
    }
  },

  async start() {
    this.clearLog();
    this.resetProgress('starting');

    try {
      if (!(await this.refreshPreflight())) {
        appendLog('train-log', '[ERROR] Device compatibility check failed. See warning above.', 'error');
        this.setProgressStatus('blocked');
        return;
      }

      if (!this.validateRepoId()) {
        appendLog('train-log', '[ERROR] Invalid dataset selection. Check Dataset Source and Repo ID.', 'error');
        this.setProgressStatus('blocked');
        return;
      }

      const repoId = this.getDatasetSource() === 'local'
        ? (document.getElementById('train-local-repo')?.value || '').trim()
        : getVal('train-repo').trim();

      const body = {
        train_policy: getVal('train-policy'),
        train_repo_id: repoId,
        train_steps: parseInt(getVal('train-steps'), 10) || 100000,
        train_device: getVal('train-device'),
      };
      const batchSizeVal = parseInt(getVal('train-batch-size'), 10);
      const lrVal = (getVal('train-lr') || '').trim();
      if (batchSizeVal > 0) body.train_batch_size = batchSizeVal;
      if (lrVal) body.train_lr = lrVal;
      this.progressTotalSteps = body.train_steps;
      this.progressStartMs = Date.now();
      this.setProgressStatus('starting');
      this.updateProgressUI();

      appendLog('train-log', `[INFO] Starting training: ${body.train_policy} · ${body.train_repo_id} · ${body.train_device}`, 'info');
      const res = await api.post('/api/train/start', body);

      if (!res || !res.ok) {
        appendLog('train-log', `[ERROR] ${res?.error || 'Failed to start training process.'}`, 'error');
        this.progressHadError = true;
        this.setProgressStatus('error');
        return;
      }

      appendLog('train-log', '[INFO] Train process started. Waiting for logs...', 'info');
      this.progressRunning = true;
      this.setProgressStatus('running');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendLog('train-log', `[ERROR] Start request failed: ${msg}`, 'error');
      console.error('Train start failed', e);
      this.progressHadError = true;
      this.setProgressStatus('error');
    }
  },

  async stop() {
    await api.post('/api/process/train/stop');
    this.progressRunning = false;
    this.setProgressStatus('stopped');
  },

  async onDeviceChange() {
    await this.refreshPreflight();
  },

  applyPreflightResult(res) {
    const startBtn = document.getElementById('train-start-btn');
    const warn = document.getElementById('train-device-warning');
    const actionWrap = document.getElementById('train-device-actions');
    const actionBtn = document.getElementById('train-install-btn');
    const ok = !!(res && res.ok);
    const reason = (res && res.reason) ? String(res.reason) : '';
    this.preflightOk = ok;
    this.preflightReason = reason;
    this.preflightAction = (res && res.action) ? String(res.action) : '';
    this.preflightCommand = (res && res.command) ? String(res.command) : '';
    if (ModeManager.mode === 'guided') {
      ModeManager.mlReady = ok;
      ModeManager.applyMode();
    }

    if (startBtn) {
      startBtn.disabled = !ok;
      startBtn.title = ok ? '' : reason;
    }

    if (warn) {
      if (ok) {
        warn.classList.add('hidden');
        warn.textContent = '';
      } else {
        warn.classList.remove('hidden');
        warn.textContent = reason;
      }
    }

    if (actionWrap) {
      const canInstall = !ok && this.preflightAction === 'install_torch_cuda';
      actionWrap.classList.toggle('hidden', !canInstall);
      if (actionBtn) {
        actionBtn.disabled = !canInstall;
        actionBtn.title = canInstall && this.preflightCommand ? this.preflightCommand : '';
      }
    }

    if (!ok && (getVal('train-device').trim() || 'cuda') === 'cuda') {
      this.setProgressStatus('blocked');
    }
    SidebarSignals.scheduleRefresh(0);
  },

  async refreshPreflight() {
    const device = getVal('train-device').trim() || 'cuda';
    try {
      const res = await api.get(`/api/train/preflight?device=${encodeURIComponent(device)}`);
      this.applyPreflightResult(res);
      return !!res.ok;
    } catch (e) {
      this.applyPreflightResult({ ok: false, reason: 'Failed to run device compatibility preflight. Check server status.' });
      return false;
    }
  },

  ingestInstallerLog(line, kind = 'stdout') {
    if (!line) return;
    if (/\[ERROR\]|Traceback|RuntimeError|Exception/i.test(line) || kind === 'error') {
      this.setProgressStatus('error');
    }
    if (/\[train_install process ended\]/i.test(line)) {
      appendLog('train-log', '[INFO] Installer finished. Re-checking CUDA compatibility...', 'info');
      this.refreshPreflight();
    }
  },

  ingestMetric(metric) {
    if (!metric || typeof metric !== 'object') return;
    const total = Number(metric.total);
    if (Number.isFinite(total) && total > 0) {
      this.progressTotalSteps = Math.floor(total);
    }
    const step = Number(metric.step);
    if (Number.isFinite(step) && step >= 0) {
      this.progressCurrentStep = Math.floor(step);
      if (!this.progressStartMs) this.progressStartMs = Date.now();
      this.progressRunning = true;
      if (!this.progressHadError) this.setProgressStatus('running');
    }
    const loss = Number(metric.loss);
    if (Number.isFinite(loss)) {
      this.progressLoss = loss;
      this.lossHistory.push(loss);
      if (this.lossHistory.length > this.lossHistoryMax) {
        this.lossHistory = this.lossHistory.slice(-this.lossHistoryMax);
      }
    }
    const lr = Number(metric.lr);
    if (Number.isFinite(lr)) {
      this.progressLr = lr;
      this.lrHistory.push(lr);
      if (this.lrHistory.length > this.lossHistoryMax) {
        this.lrHistory = this.lrHistory.slice(-this.lossHistoryMax);
      }
    }
    if (Number.isFinite(step) && step >= 0) {
      this.stepHistory.push(Math.floor(step));
      if (this.stepHistory.length > this.lossHistoryMax) {
        this.stepHistory = this.stepHistory.slice(-this.lossHistoryMax);
      }
    }
      this.renderLossCanvas();
    this.updateProgressUI();
  },

  async installCudaTorch() {
    if (this.preflightAction !== 'install_torch_cuda') return;
    const ok = confirm('Install/upgrade PyTorch CUDA build in the current environment now? This may take several minutes.');
    if (!ok) return;

    appendLog('train-log', '[INFO] Starting PyTorch installer from GUI...', 'info');
    if (this.preflightCommand) {
      appendLog('train-log', `[INFO] Command: ${this.preflightCommand}`, 'info');
    }

    const res = await api.post('/api/train/install_pytorch', { nightly: true, cuda_tag: 'cu128' });
    if (!res || !res.ok) {
      appendLog('train-log', `[ERROR] ${res?.error || 'Failed to start installer process.'}`, 'error');
      return;
    }

    appendLog('train-log', '[INFO] Installer process started. Follow logs below. Training is disabled until compatibility is restored.', 'info');
  },

  ingestLogLine(line, kind = 'stdout') {
    if (!line) return;

    if (/\[ERROR\]|Traceback|RuntimeError|CUDA error|Exception/i.test(line) || kind === 'error') {
      this.progressHadError = true;
      this.setProgressStatus('error');
    }

    const totalMatch = line.match(/cfg\.steps=([0-9_,]+)/);
    if (totalMatch) {
      const total = parseInt(totalMatch[1].replace(/[, _]/g, ''), 10);
      if (Number.isFinite(total) && total > 0) this.progressTotalSteps = total;
    }

    const stepMatch = line.match(/step:([0-9]+(?:\.[0-9]+)?[KMBTQ]?)/i);
    if (stepMatch) {
      const parsed = this.parseCompactNumber(stepMatch[1]);
      if (Number.isFinite(parsed)) {
        this.progressCurrentStep = Math.max(0, Math.floor(parsed));
        if (!this.progressStartMs) this.progressStartMs = Date.now();
        this.progressRunning = true;
        if (!this.progressHadError) this.setProgressStatus('running');
      }
    }

    const lossMatch = line.match(/\bloss:([+-]?[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)/i);
    if (lossMatch) {
      const loss = Number(lossMatch[1]);
      if (Number.isFinite(loss)) this.progressLoss = loss;
    }

    if (/Start offline training/i.test(line)) {
      this.progressRunning = true;
      if (!this.progressHadError) this.setProgressStatus('running');
    }
    if (/End of training/i.test(line)) {
      this.progressRunning = false;
      if (!this.progressHadError) this.setProgressStatus('completed');
      this.refreshCheckpoints();
    }
    if (/\[train process ended\]/i.test(line)) {
      this.progressRunning = false;
      if (this.progressHadError) this.setProgressStatus('error');
      else if (this.progressCurrentStep && this.progressTotalSteps && this.progressCurrentStep >= this.progressTotalSteps) this.setProgressStatus('completed');
      else this.setProgressStatus('stopped');
    }

    this.updateProgressUI();
  },

  parseCompactNumber(token) {
    if (!token) return NaN;
    const raw = String(token).trim().toUpperCase();
    const m = raw.match(/^([0-9]+(?:\.[0-9]+)?)([KMBTQ]?)$/);
    if (!m) return Number(raw.replace(/,/g, ''));
    const base = Number(m[1]);
    const expMap = { '': 0, K: 1, M: 2, B: 3, T: 4, Q: 5 };
    return base * (1000 ** (expMap[m[2]] ?? 0));
  },

  formatEta(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '--';
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${ss}s`;
    return `${ss}s`;
  },

  setProgressStatus(status) {
    const el = document.getElementById('train-progress-status');
    if (!el) return;
    const map = {
      idle: { label: 'IDLE', bg: 'rgba(148,163,184,0.18)', color: 'var(--text2)' },
      starting: { label: 'STARTING', bg: 'rgba(59,130,246,0.18)', color: '#93c5fd' },
      running: { label: 'RUNNING', bg: 'rgba(34,197,94,0.18)', color: '#86efac' },
      blocked: { label: 'BLOCKED', bg: 'rgba(245,158,11,0.20)', color: '#fcd34d' },
      stopped: { label: 'STOPPED', bg: 'rgba(148,163,184,0.18)', color: 'var(--text2)' },
      completed: { label: 'COMPLETED', bg: 'rgba(16,185,129,0.20)', color: '#6ee7b7' },
      error: { label: 'ERROR', bg: 'rgba(248,81,73,0.20)', color: '#fca5a5' },
    };
    const preset = map[status] || map.idle;
    el.textContent = preset.label;
    el.style.background = preset.bg;
    el.style.color = preset.color;
  },

  updateProgressUI() {
    const fill = document.getElementById('train-progress-fill');
    const stepEl = document.getElementById('train-progress-step');
    const lossEl = document.getElementById('train-progress-loss');
    const etaEl = document.getElementById('train-progress-eta');

    let pct = 0;
    const cur = Number.isFinite(this.progressCurrentStep) ? this.progressCurrentStep : null;
    const total = Number.isFinite(this.progressTotalSteps) ? this.progressTotalSteps : null;
    if (cur !== null && total && total > 0) {
      pct = Math.max(0, Math.min(100, (cur / total) * 100));
    }

    if (fill) fill.style.width = `${pct}%`;
    if (stepEl) {
      stepEl.textContent = `Step: ${cur !== null ? cur.toLocaleString() : '--'} / ${total ? total.toLocaleString() : '--'}`;
    }
    if (lossEl) {
      const lossTxt = Number.isFinite(this.progressLoss) ? this.progressLoss.toFixed(4) : '--';
      const lrTxt = Number.isFinite(this.progressLr) ? this.progressLr.toExponential(2) : null;
      lossEl.textContent = lrTxt ? `Loss: ${lossTxt} (lr ${lrTxt})` : `Loss: ${lossTxt}`;
    }

    if (etaEl) {
      let eta = '--';
      if (this.progressRunning && cur !== null && total && total > cur && this.progressStartMs) {
        const elapsed = (Date.now() - this.progressStartMs) / 1000;
        if (elapsed > 0 && cur > 0) {
          const sps = cur / elapsed;
          if (sps > 0) eta = this.formatEta((total - cur) / sps);
        }
      }
      etaEl.textContent = `ETA: ${eta}`;
    }
  },

  renderLossCanvas() {
    const canvas = document.getElementById('train-loss-canvas');
    if (!canvas || !(canvas instanceof HTMLCanvasElement)) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = Math.max(1, Math.floor(canvas.clientWidth || canvas.width));
    const h = Math.max(1, Math.floor(canvas.clientHeight || canvas.height));
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const loss = this.lossHistory;
    const hasLr = this.lrHistory.length > 1;

    if (!loss.length) {
      ctx.fillStyle = 'rgba(148,163,184,0.45)';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for training metrics\u2026', w / 2, h / 2);
      ctx.textAlign = 'start';
      return;
    }

    /* \u2500\u2500 layout \u2500\u2500 */
    const padL = 52;
    const padR = hasLr ? 52 : 14;
    const padT = 22;
    const padB = 22;
    const iw = w - padL - padR;
    const ih = h - padT - padB;
    if (iw < 20 || ih < 20) return;

    /* \u2500\u2500 loss range (with 8% padding) \u2500\u2500 */
    let lMin = Infinity, lMax = -Infinity;
    for (const v of loss) { if (v < lMin) lMin = v; if (v > lMax) lMax = v; }
    if (!Number.isFinite(lMin) || !Number.isFinite(lMax)) return;
    const lSpan = lMax - lMin || 1;
    lMin -= lSpan * 0.08;
    lMax += lSpan * 0.08;

    /* \u2500\u2500 lr range \u2500\u2500 */
    let rMin = 0, rMax = 1;
    if (hasLr) {
      rMin = Infinity; rMax = -Infinity;
      for (const v of this.lrHistory) { if (v < rMin) rMin = v; if (v > rMax) rMax = v; }
      const rSpan = rMax - rMin || rMax * 0.1 || 1e-6;
      rMin = Math.max(0, rMin - rSpan * 0.08);
      rMax += rSpan * 0.08;
    }

    /* \u2500\u2500 coordinate helpers \u2500\u2500 */
    const lossY = (v) => padT + ih - ((v - lMin) / (lMax - lMin)) * ih;
    const lrYfn = (v) => padT + ih - ((v - rMin) / (rMax - rMin)) * ih;
    const dataX = (i, len) => padL + (i / Math.max(1, len - 1)) * iw;

    /* \u2500\u2500 grid lines (4 divisions) \u2500\u2500 */
    const gridN = 4;
    ctx.font = '10px monospace';
    for (let g = 0; g <= gridN; g++) {
      const gy = padT + (g / gridN) * ih;
      ctx.strokeStyle = 'rgba(148,163,184,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, gy);
      ctx.lineTo(padL + iw, gy);
      ctx.stroke();
      /* left Y label (loss) */
      const lVal = lMax - (g / gridN) * (lMax - lMin);
      ctx.fillStyle = 'rgba(134,239,172,0.55)';
      ctx.textAlign = 'right';
      ctx.fillText(lVal < 0.01 ? lVal.toExponential(1) : lVal.toFixed(3), padL - 6, gy + 3);
      /* right Y label (lr) */
      if (hasLr) {
        const rVal = rMax - (g / gridN) * (rMax - rMin);
        ctx.fillStyle = 'rgba(147,197,253,0.55)';
        ctx.textAlign = 'left';
        ctx.fillText(rVal.toExponential(1), padL + iw + 6, gy + 3);
      }
    }

    /* \u2500\u2500 X-axis step labels \u2500\u2500 */
    const steps = this.stepHistory;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(148,163,184,0.45)';
    if (steps.length >= 2) {
      const idxs = [0, Math.floor(steps.length * 0.25), Math.floor(steps.length * 0.5),
        Math.floor(steps.length * 0.75), steps.length - 1];
      const seen = new Set();
      for (const idx of idxs) {
        if (idx >= steps.length || seen.has(idx)) continue;
        seen.add(idx);
        const x = dataX(idx, steps.length);
        const sv = steps[idx];
        const label = sv >= 1000 ? (sv / 1000).toFixed(sv >= 10000 ? 0 : 1) + 'K' : String(sv);
        ctx.fillText(label, x, padT + ih + 14);
      }
    }

    /* \u2500\u2500 EMA smoothed loss \u2500\u2500 */
    const ema = [];
    const alpha = 0.12;
    if (loss.length > 0) {
      ema.push(loss[0]);
      for (let i = 1; i < loss.length; i++) {
        ema.push(alpha * loss[i] + (1 - alpha) * ema[i - 1]);
      }
    }

    /* \u2500\u2500 draw raw loss (faded) \u2500\u2500 */
    ctx.beginPath();
    for (let i = 0; i < loss.length; i++) {
      const x = dataX(i, loss.length);
      const y = lossY(loss[i]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(134,239,172,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
    /* \u2500\u2500 draw EMA loss (prominent) \u2500\u2500 */
    if (ema.length > 1) {
      ctx.beginPath();
      for (let i = 0; i < ema.length; i++) {
        const x = dataX(i, ema.length);
        const y = lossY(ema[i]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#86efac';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    /* \u2500\u2500 draw LR curve \u2500\u2500 */
    if (hasLr) {
      ctx.beginPath();
      for (let i = 0; i < this.lrHistory.length; i++) {
        const x = dataX(i, this.lrHistory.length);
        const y = lrYfn(this.lrHistory[i]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(147,197,253,0.65)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    /* \u2500\u2500 legend \u2500\u2500 */
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    let lx = padL + 4;
    const ly = padT - 8;
    /* loss indicator */
    ctx.fillStyle = '#86efac';
    ctx.fillRect(lx, ly - 4, 12, 2);
    lx += 16;
    ctx.fillStyle = 'rgba(203,213,225,0.85)';
    const lastLoss = loss[loss.length - 1];
    const lossTxt = `Loss ${lastLoss < 0.001 ? lastLoss.toExponential(2) : lastLoss.toFixed(4)}`;
    ctx.fillText(lossTxt, lx, ly);
    lx += ctx.measureText(lossTxt).width + 16;
    /* lr indicator */
    if (hasLr) {
      ctx.fillStyle = 'rgba(147,197,253,0.7)';
      ctx.fillRect(lx, ly - 4, 12, 2);
      lx += 16;
      ctx.fillStyle = 'rgba(203,213,225,0.85)';
      ctx.fillText(`LR ${this.lrHistory[this.lrHistory.length - 1].toExponential(2)}`, lx, ly);
    }

    /* \u2500\u2500 chart border \u2500\u2500 */
    ctx.strokeStyle = 'rgba(148,163,184,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(padL, padT, iw, ih);
  },

  resetProgress(status = 'idle') {
    this.progressRunning = false;
    this.progressHadError = false;
    this.progressTotalSteps = null;
    this.progressCurrentStep = null;
    this.progressLoss = null;
    this.progressLr = null;
    this.progressStartMs = null;
    this.lossHistory = [];
    this.lrHistory = [];
    this.stepHistory = [];
    this.setProgressStatus(status);
    this.updateProgressUI();
    this.renderLossCanvas();
  },

  clearLog() { clearProcessLog('train-log'); },

  syncBtn() {
    syncProcessButtons('train', 'train-start-btn', 'train-stop-btn');
    const running = !!state.procStatus.train;
    if (running && !this.progressRunning) {
      this.progressRunning = true;
      if (!this.progressHadError) this.setProgressStatus('running');
      this._startGpuPoll();
    }
    if (!running && this.progressRunning) {
      this.progressRunning = false;
      this._stopGpuPoll();
      if (this.progressHadError) this.setProgressStatus('error');
      else if (this.progressCurrentStep && this.progressTotalSteps && this.progressCurrentStep >= this.progressTotalSteps) this.setProgressStatus('completed');
      else this.setProgressStatus('stopped');
    }
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
  },

  _startGpuPoll() {
    if (this._gpuPollTimer) return;
    this.refreshGpu();
    this._gpuPollTimer = setInterval(() => this.refreshGpu(), 5000);
  },

  _stopGpuPoll() {
    if (this._gpuPollTimer) {
      clearInterval(this._gpuPollTimer);
      this._gpuPollTimer = null;
    }
  },


  async refreshCheckpoints() {
    const list = document.getElementById('train-checkpoints-list');
    if (!list) return;
    list.innerHTML = '<div class="muted">Loading checkpoints…</div>';
    try {
      const res = await api.get('/api/checkpoints');
      if (!res.ok || !res.checkpoints || res.checkpoints.length === 0) {
        list.innerHTML = '<div class="muted">No checkpoints found. Train a model first.</div>';
        return;
      }
      list.innerHTML = res.checkpoints.map(cp => {
        const badge = cp.is_symlink ? `<span class="dbadge" style="font-size:10px; padding:1px 6px; background:rgba(59,130,246,0.18); color:#93c5fd;">${cp.display}</span>` : '';
        const stepText = cp.step != null ? `Step ${cp.step.toLocaleString()}` : '';
        const sizeText = cp.size_mb != null ? `${cp.size_mb.toFixed(1)} MB` : '';
        const policyText = cp.policy ? cp.policy.toUpperCase() : '';
        const meta = [stepText, policyText, sizeText].filter(Boolean).join(' · ');
        return `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; border:1px solid var(--border); border-radius:6px; background:var(--bg3); margin-bottom:6px;">
            <div>
              <div style="font-weight:600; font-size:13px;">${cp.name} ${badge}</div>
              <div style="font-size:11px; color:var(--text2); margin-top:2px;">${meta}</div>
            </div>
            <button class="btn-xs" onclick="EvalTab.selectCheckpoint('${cp.path.replace(/'/g, "\\'")}')">Use in Eval →</button>
          </div>`;
      }).join('');
      // Also refresh eval dropdown if available
      if (typeof EvalTab !== 'undefined' && EvalTab.loadCheckpoints) {
        EvalTab.loadCheckpoints();
      }
    } catch (e) {
      list.innerHTML = '<div class="muted">Failed to load checkpoints.</div>';
    }
  },
};
