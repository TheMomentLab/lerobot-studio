const EvalTab = {
  runActive: false,
  hadError: false,
  runSeq: 0,
  activeRunSeq: 0,
  targetEpisodes: null,
  doneEpisodes: 0,
  successRate: null,
  meanReward: null,
  finalReward: null,
  finalSuccess: null,
  finalConfirmed: false,
  startedAtMs: null,
  endedAtMs: null,
  bestEpisode: null,
  worstEpisode: null,
  perEpisodeReward: {},

  applyConfig(cfg) {
    if (!cfg) return;
    setVal('eval-policy-path', cfg.eval_policy_path || 'outputs/train/checkpoints/last/pretrained_model');
    setVal('eval-repo-id', cfg.eval_repo_id || cfg.train_repo_id || 'user/my-dataset');
    setVal('eval-episodes', String(cfg.eval_episodes || 10));
    setVal('eval-device', cfg.eval_device || cfg.train_device || 'cuda');
    setVal('eval-task', cfg.eval_task || '');
  },

  loadDefaults() {
    if (!getVal('eval-policy-path')) {
      setVal('eval-policy-path', 'outputs/train/checkpoints/last/pretrained_model');
    }
    if (!getVal('eval-repo-id')) {
      setVal('eval-repo-id', getVal('train-repo') || 'user/my-dataset');
    }
    this.resetProgress('idle');    this.loadCheckpoints();
  },

  buildConfig() {
    return {
      eval_policy_path: getVal('eval-policy-path').trim(),
      eval_repo_id: getVal('eval-repo-id').trim(),
      eval_episodes: parseInt(getVal('eval-episodes'), 10) || 10,
      eval_device: getVal('eval-device').trim() || 'cuda',
      eval_task: getVal('eval-task').trim(),
      train_repo_id: getVal('train-repo').trim() || 'user/my-dataset',
      train_device: getVal('train-device').trim() || 'cuda',
    };
  },

  validate(cfg) {
    if (!cfg.eval_policy_path) {
      appendLog('eval-log', '[ERROR] Policy path is required.', 'error');
      return false;
    }
    if (!cfg.eval_repo_id || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(cfg.eval_repo_id)) {
      appendLog('eval-log', '[ERROR] Dataset Repo ID must be username/dataset format.', 'error');
      return false;
    }
    if (!Number.isFinite(cfg.eval_episodes) || cfg.eval_episodes < 1) {
      appendLog('eval-log', '[ERROR] Episodes must be >= 1.', 'error');
      return false;
    }
    return true;
  },

  async start() {
    this.clearLog();
    const cfg = this.buildConfig();
    if (!this.validate(cfg)) return;
    this.runSeq += 1;
    this.activeRunSeq = this.runSeq;
    this.targetEpisodes = cfg.eval_episodes;
    this.resetProgress('starting');
    this.startedAtMs = Date.now();
    this.endedAtMs = null;

    state.config.eval_policy_path = cfg.eval_policy_path;
    state.config.eval_repo_id = cfg.eval_repo_id;
    state.config.eval_episodes = cfg.eval_episodes;
    state.config.eval_device = cfg.eval_device;
    state.config.eval_task = cfg.eval_task;
    saveConfig();

    appendLog('eval-log', `[INFO] Starting eval: ${cfg.eval_repo_id} · ${cfg.eval_device} · ${cfg.eval_episodes} episodes`, 'info');
    const res = await api.post('/api/eval/start', cfg);
    if (!res.ok) {
      appendLog('eval-log', `[ERROR] ${res.error || 'Failed to start eval process.'}`, 'error');
      this.hadError = true;
      this.setProgressStatus('error');
      this.endedAtMs = Date.now();
      this.updateSummaryUI();
      return;
    }
    appendLog('eval-log', '[INFO] Eval process started.', 'info');
    this.runActive = true;
    this.setProgressStatus('running');
    this.updateSummaryUI();
  },

  async stop() {
    await api.post('/api/process/eval/stop');
    this.runActive = false;
    if (this.hadError) this.setProgressStatus('error');
    else this.setProgressStatus('stopped');
    this.endedAtMs = Date.now();
    this.updateSummaryUI();
  },

  clearLog() {
    clearProcessLog('eval-log');
  },

  ingestLogLine(line, kind = 'stdout') {
    if (!line) return;
    const endMarker = /\[eval process ended\]/i;
    const completeMarker = /evaluation complete|end of evaluation|eval complete/i;
    if (!state.procStatus.eval && !this.runActive && !endMarker.test(line) && !completeMarker.test(line)) {
      return;
    }
    if (!this.startedAtMs && state.procStatus.eval) {
      this.startedAtMs = Date.now();
    }

    if (kind === 'error' || /\[ERROR\]|Traceback|RuntimeError|Exception|failed/i.test(line)) {
      this.hadError = true;
      this.setProgressStatus('error');
    }

    const epTotalMatch = line.match(/(?:^|\s)(?:n_episodes|episodes)\s*[:=]\s*([0-9]+)/i)
      || line.match(/episode\s*\d+\s*\/\s*([0-9]+)/i)
      || line.match(/completed\s*episodes\s*[:=]\s*\d+\s*\/\s*([0-9]+)/i);
    if (epTotalMatch) {
      const total = parseInt(epTotalMatch[1], 10);
      if (Number.isFinite(total) && total > 0) this.targetEpisodes = total;
    }

    const doneMatch = line.match(/episode\s*([0-9]+)\s*\/\s*([0-9]+)/i)
      || line.match(/completed\s*episodes\s*[:=]\s*([0-9]+)\s*\/\s*([0-9]+)/i)
      || line.match(/\bepisode\s*[:#]\s*([0-9]+)\b/i);
    if (doneMatch) {
      const done = parseInt(doneMatch[1], 10);
      if (Number.isFinite(done) && done >= 0) {
        this.doneEpisodes = Math.max(this.doneEpisodes || 0, done);
        this.runActive = true;
        if (!this.hadError) this.setProgressStatus('running');
      }
      if (doneMatch[2]) {
        const total = parseInt(doneMatch[2], 10);
        if (Number.isFinite(total) && total > 0) this.targetEpisodes = total;
      }
    }

    const successMatch = line.match(/\bsuccess(?:[_\s-]?rate)?\s*[:=]\s*([0-9]*\.?[0-9]+)\s*%?/i);
    if (successMatch) {
      const raw = Number(successMatch[1]);
      if (Number.isFinite(raw)) {
        this.successRate = raw > 1 ? Math.min(100, raw) : Math.max(0, raw * 100);
      }
    }

    const rewardMatch = line.match(/\b(?:mean[_\s-]?reward|avg[_\s-]?reward|episode[_\s-]?reward)\s*[:=]\s*([+-]?[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)/i);
    if (rewardMatch) {
      const reward = Number(rewardMatch[1]);
      if (Number.isFinite(reward)) this.meanReward = reward;

      const epForReward = line.match(/episode\s*([0-9]+)\b/i);
      if (epForReward) {
        const epIdx = parseInt(epForReward[1], 10);
        if (Number.isFinite(epIdx)) {
          this.perEpisodeReward[epIdx] = reward;
          this.recomputeBestWorst();
        }
      }
    }

    const finalRewardMatch = line.match(/(?:final|overall|eval)\s*(?:mean[_\s-]?reward|avg[_\s-]?reward|reward)\s*[:=]\s*([+-]?[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)/i);
    if (finalRewardMatch) {
      const v = Number(finalRewardMatch[1]);
      if (Number.isFinite(v)) this.finalReward = v;
    }

    const finalSuccessMatch = line.match(/(?:final|overall|eval)\s*(?:success(?:[_\s-]?rate)?)\s*[:=]\s*([0-9]*\.?[0-9]+)\s*%?/i);
    if (finalSuccessMatch) {
      const raw = Number(finalSuccessMatch[1]);
      if (Number.isFinite(raw)) {
        this.finalSuccess = raw > 1 ? Math.min(100, raw) : Math.max(0, raw * 100);
      }
    }

    if (completeMarker.test(line)) {
      this.runActive = false;
      if (this.hadError) this.setProgressStatus('error');
      else this.setProgressStatus('completed');
      if (!Number.isFinite(this.finalReward) && Number.isFinite(this.meanReward)) this.finalReward = this.meanReward;
      if (!Number.isFinite(this.finalSuccess) && Number.isFinite(this.successRate)) this.finalSuccess = this.successRate;
      this.finalConfirmed = this.targetEpisodes ? this.doneEpisodes >= this.targetEpisodes : true;
      this.endedAtMs = Date.now();
    }

    if (endMarker.test(line)) {
      this.runActive = false;
      if (this.hadError) this.setProgressStatus('error');
      else if (this.targetEpisodes && this.doneEpisodes >= this.targetEpisodes) this.setProgressStatus('completed');
      else this.setProgressStatus('stopped');
      this.endedAtMs = Date.now();
      if (!this.hadError && this.targetEpisodes && this.doneEpisodes >= this.targetEpisodes) {
        this.finalConfirmed = true;
      }
    }

    this.updateProgressUI();
    this.updateSummaryUI();
  },

  recomputeBestWorst() {
    const entries = Object.entries(this.perEpisodeReward)
      .map(([ep, reward]) => ({ ep: Number(ep), reward: Number(reward) }))
      .filter((v) => Number.isFinite(v.ep) && Number.isFinite(v.reward));
    if (!entries.length) {
      this.bestEpisode = null;
      this.worstEpisode = null;
      return;
    }
    entries.sort((a, b) => a.reward - b.reward);
    this.worstEpisode = entries[0];
    this.bestEpisode = entries[entries.length - 1];
  },

  setProgressStatus(status) {
    const el = document.getElementById('eval-progress-status');
    if (!el) return;
    const map = {
      idle: { label: 'IDLE', bg: 'rgba(148,163,184,0.18)', color: 'var(--text2)' },
      starting: { label: 'STARTING', bg: 'rgba(59,130,246,0.18)', color: '#93c5fd' },
      running: { label: 'RUNNING', bg: 'rgba(34,197,94,0.18)', color: '#86efac' },
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
    const fill = document.getElementById('eval-progress-fill');
    const epEl = document.getElementById('eval-progress-episodes');
    const rewardEl = document.getElementById('eval-progress-reward');
    const successEl = document.getElementById('eval-progress-success');

    const done = Number.isFinite(this.doneEpisodes) ? this.doneEpisodes : 0;
    const total = Number.isFinite(this.targetEpisodes) && this.targetEpisodes > 0 ? this.targetEpisodes : null;
    const pct = total ? Math.max(0, Math.min(100, (done / total) * 100)) : 0;

    if (fill) fill.style.width = `${pct}%`;
    if (epEl) epEl.textContent = `Episodes: ${done || '--'} / ${total || '--'}`;
    if (rewardEl) rewardEl.textContent = `Reward: ${Number.isFinite(this.meanReward) ? this.meanReward.toFixed(4) : '--'}`;
    if (successEl) successEl.textContent = `Success: ${Number.isFinite(this.successRate) ? `${this.successRate.toFixed(1)}%` : '--'}`;
  },

  updateSummaryUI() {
    const finalRewardEl = document.getElementById('eval-summary-final-reward');
    const finalSuccessEl = document.getElementById('eval-summary-final-success');
    const bestEl = document.getElementById('eval-summary-best');
    const worstEl = document.getElementById('eval-summary-worst');
    const confidenceEl = document.getElementById('eval-summary-confidence');
    const timeEl = document.getElementById('eval-summary-time');
    if (finalRewardEl) {
      finalRewardEl.textContent = `Final Reward: ${Number.isFinite(this.finalReward) ? this.finalReward.toFixed(4) : '--'}`;
    }
    if (finalSuccessEl) {
      finalSuccessEl.textContent = `Final Success: ${Number.isFinite(this.finalSuccess) ? `${this.finalSuccess.toFixed(1)}%` : '--'}`;
    }
    if (bestEl) {
      bestEl.textContent = this.bestEpisode
        ? `Best Episode: #${this.bestEpisode.ep} (${this.bestEpisode.reward.toFixed(4)})`
        : 'Best Episode: --';
    }
    if (worstEl) {
      worstEl.textContent = this.worstEpisode
        ? `Worst Episode: #${this.worstEpisode.ep} (${this.worstEpisode.reward.toFixed(4)})`
        : 'Worst Episode: --';
    }
    if (confidenceEl) {
      if (!this.startedAtMs) {
        confidenceEl.style.display = 'none';
        confidenceEl.textContent = '';
      } else {
        confidenceEl.style.display = '';
        confidenceEl.textContent = this.finalConfirmed ? 'FINAL' : 'PARTIAL';
        confidenceEl.className = `dbadge ${this.finalConfirmed ? 'badge-ok' : 'badge-warn'}`;
      }
    }
    if (timeEl) {
      const start = this.startedAtMs ? new Date(this.startedAtMs).toLocaleTimeString() : '--';
      const end = this.endedAtMs ? new Date(this.endedAtMs).toLocaleTimeString() : '--';
      let elapsed = '--';
      if (this.startedAtMs) {
        const endMs = this.endedAtMs || Date.now();
        const sec = Math.max(0, Math.floor((endMs - this.startedAtMs) / 1000));
        const mm = String(Math.floor(sec / 60)).padStart(2, '0');
        const ss = String(sec % 60).padStart(2, '0');
        elapsed = `${mm}:${ss}`;
      }
      timeEl.textContent = `Start ${start} · Elapsed ${elapsed} · End ${end}`;
    }
  },

  resetProgress(status = 'idle') {
    this.runActive = false;
    this.hadError = false;
    this.doneEpisodes = 0;
    this.successRate = null;
    this.meanReward = null;
    this.finalReward = null;
    this.finalSuccess = null;
    this.finalConfirmed = false;
    this.bestEpisode = null;
    this.worstEpisode = null;
    this.perEpisodeReward = {};
    this.setProgressStatus(status);
    this.updateProgressUI();
    this.updateSummaryUI();
  },

  syncBtn() {
    syncProcessButtons('eval', 'eval-start-btn', 'eval-stop-btn');
    const running = !!state.procStatus.eval;
    if (running && !this.runActive) {
      this.runActive = true;
      if (!this.hadError) this.setProgressStatus('running');
    }
    if (!running && this.runActive) {
      this.runActive = false;
      if (this.hadError) this.setProgressStatus('error');
      else if (this.targetEpisodes && this.doneEpisodes >= this.targetEpisodes) this.setProgressStatus('completed');
      else this.setProgressStatus('stopped');
    }
  },

  async loadCheckpoints() {
    const select = document.getElementById('eval-checkpoint-select');
    if (!select) return;
    const prev = select.value;
    try {
      const res = await api.get('/api/checkpoints');
      select.innerHTML = '<option value="">(manual path below)</option>';
      if (res.ok && res.checkpoints && res.checkpoints.length > 0) {
        for (const cp of res.checkpoints) {
          const label = cp.step != null ? `${cp.name} (step ${cp.step.toLocaleString()})` : cp.name;
          const opt = document.createElement('option');
          opt.value = cp.path;
          opt.textContent = label;
          select.appendChild(opt);
        }
      }
      if (prev && [...select.options].some(o => o.value === prev)) {
        select.value = prev;
      }
    } catch (e) {
      // silently keep manual-only mode
    }
  },

  onCheckpointSelect(path) {
    if (!path) return;
    const input = document.getElementById('eval-policy-path');
    if (input) input.value = path;
  },

  selectCheckpoint(path) {
    if (!path) return;
    const input = document.getElementById('eval-policy-path');
    if (input) input.value = path;
    const select = document.getElementById('eval-checkpoint-select');
    if (select) {
      const match = [...select.options].find(o => o.value === path);
      if (match) select.value = path;
    }
    if (typeof showToast === 'function') showToast('Checkpoint selected for eval', 'info');
  },
};
