const DeviceSetupTab = {
  cameras:     [],
  arms:        [],
  assignments: {},   // kernels → role
  armAssignments: {},
  streamApplyTimer: null,
  rulesApplyTimer: null,
  rulesStatus: null,
  _identifyPollTimer: null,
  _identifySnapshot: null,

  async refresh() {
    const data = await api.get('/api/devices');
    state.devices = data;
    this.cameras = data.cameras;
    this.arms = data.arms;
    // Restore assignments from current symlinks
    this.assignments = {};
    for (const cam of data.cameras) {
      this.assignments[cam.kernels] = cam.symlink || '(none)';
    }
    this.armAssignments = {};
    for (const arm of data.arms) {
      if (!arm.serial) continue;
      this.armAssignments[arm.serial] = arm.symlink || '(none)';
    }
    this.renderGrid();
    this.renderArmsGrid();
    this.validateAssignments();
    this.showCurrent();
    this.refreshRulesStatus();
    this.scheduleRulesApply();
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
        'wrist_cam_1': 'Wrist Camera 1',
        'wrist_cam_2': 'Wrist Camera 2'
      };
      const curRole = this.assignments[cam.kernels] || '(none)';
      
      let opts = '';
      for (const [val, label] of Object.entries(roles)) {
        const sel = (val === curRole) ? 'selected' : '';
        opts += `<option value="${val}" ${sel}>${label}</option>`;
      }

      return `<div class="cam-card" style="box-shadow: 0 2px 8px rgba(0,0,0,0.2); border: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; border-radius: 8px;">
        <div class="cam-preview-wrap" id="cam-wrap-${i}" onclick="DeviceSetupTab.togglePreview(${i}, '${cam.device}')" style="background: #111; height: 220px; display: flex; align-items: center; justify-content: center; cursor: pointer; position: relative;">
          <div style="position:absolute;top:8px;left:8px;padding:3px 8px;border-radius:999px;background:rgba(0,0,0,0.55);color:#fff;font-size:11px;font-weight:600;letter-spacing:0.2px;">Preview 144p · 5fps</div>
          <button class="btn-primary" style="opacity: 0.9; padding: 10px 20px; font-size: 14px; border-radius: 20px; pointer-events: none;">▶ View Preview</button>
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

  renderArmsGrid() {
    const el = document.getElementById('device-arms-grid');
    if (!el) return;
    if (!this.arms.length) {
      el.innerHTML = '<div style="grid-column: 1/-1; padding: 24px; text-align: center; border: 1px dashed var(--border); border-radius: 8px; color: var(--text2);">No arm ports detected. Please connect them and refresh.</div>';
      return;
    }

    const roles = {
      '(none)': 'Not used (skip this arm)',
      'follower_arm_1': 'Follower Arm 1',
      'follower_arm_2': 'Follower Arm 2',
      'leader_arm_1': 'Leader Arm 1',
      'leader_arm_2': 'Leader Arm 2',
    };

    el.innerHTML = this.arms.map((arm) => {
      const serial = arm.serial || '';
      const currentRole = serial ? (this.armAssignments[serial] || '(none)') : '(none)';
      const options = Object.entries(roles).map(([val, label]) => {
        const selected = val === currentRole ? 'selected' : '';
        return `<option value="${val}" ${selected}>${label}</option>`;
      }).join('');

      return `<div class="arm-card" style="box-shadow: 0 2px 8px rgba(0,0,0,0.2); border: 1px solid var(--border); border-radius: 8px; padding: 14px; background: var(--bg-card);">
        <div style="font-weight: 600; margin-bottom: 8px;">/dev/${arm.device}</div>
        <div class="muted" style="font-size: 12px; margin-bottom: 10px;">Serial: <code>${serial || 'N/A'}</code></div>
        <select ${serial ? '' : 'disabled'} style="width:100%;" onchange="DeviceSetupTab.assignArm('${serial}', this.value)">
          ${options}
        </select>
        ${serial ? '' : '<div style="color: var(--red); font-size: 11px; margin-top: 8px;">Cannot map this arm: serial number not available.</div>'}
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
        wrap.innerHTML = '<div style="position:absolute;top:8px;left:8px;padding:3px 8px;border-radius:999px;background:rgba(0,0,0,0.55);color:#fff;font-size:11px;font-weight:600;letter-spacing:0.2px;">Preview 144p · 5fps</div><button class="btn-primary" style="opacity: 0.9; padding: 10px 20px; font-size: 14px; border-radius: 20px; pointer-events: none;">▶ View Preview</button>';
     } else {
       const vid = device.replace('/dev/', '');
       wrap.dataset.vid = vid;
        wrap.innerHTML = `<img src="/stream/${vid}?preview=1" alt="stream" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;" onload="FeedManager._onLoad(this)" onerror="FeedManager._onError(this)" /><div class="feed-loading" id="fload-${vid}"><div class="feed-spinner"></div></div><div class="feed-live-badge" id="flive-${vid}"><div class="feed-live-dot"></div>LIVE</div><div class="feed-fps-badge" id="ffps-${vid}"></div><div class="feed-stalled" id="fstall-${vid}" style="display:none"><span class="feed-stalled-text">⏸ Feed stalled</span><button class="btn-xs feed-overlay-btn" onclick="FeedManager.retry('${vid}')">↺ Retry</button></div>`;
       FeedManager._startWatcher(vid);
     }
   },

  assign(kernels, role) {
    if (kernels) this.assignments[kernels] = role;
    this.validateAssignments();
    this.scheduleRulesApply();
  },

  assignArm(serial, role) {
    if (!serial) return;
    this.armAssignments[serial] = role;
    this.validateAssignments();
    this.scheduleRulesApply();
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

    const armRoleCounts = {};
    const armDuplicates = new Set();
    for (const [serial, role] of Object.entries(this.armAssignments)) {
      if (!role || role === '(none)') continue;
      if (armRoleCounts[role]) {
        armRoleCounts[role].push(serial);
        armDuplicates.add(role);
      } else {
        armRoleCounts[role] = [serial];
      }
    }

    const armCards = document.querySelectorAll('.arm-card');
    armCards.forEach((card, idx) => {
      const arm = this.arms[idx];
      if (!arm || !arm.serial) return;
      const select = card.querySelector('select');
      if (!select) return;

      const existingError = card.querySelector('.dup-error');
      const role = this.armAssignments[arm.serial];
      if (role && role !== '(none)' && armDuplicates.has(role)) {
        select.style.borderColor = 'var(--red)';
        select.style.background = 'rgba(248,81,73,0.1)';
        if (!existingError) {
          const errorDiv = document.createElement('div');
          errorDiv.className = 'dup-error';
          errorDiv.style.cssText = 'color:var(--red); font-size:11px; margin-top:6px; padding:4px 8px; background:rgba(248,81,73,0.1); border-radius:4px;';
          errorDiv.textContent = `⚠️ "${role}" is assigned to multiple arms`;
          card.appendChild(errorDiv);
        }
      } else {
        select.style.borderColor = 'var(--border)';
        select.style.background = 'var(--bg-app)';
        if (existingError) existingError.remove();
      }
    });
    
    return duplicates.size === 0 && armDuplicates.size === 0;
  },

  hasDuplicateAssignments() {
    const roles = Object.values(this.assignments).filter(r => r && r !== '(none)');
    const armRoles = Object.values(this.armAssignments).filter(r => r && r !== '(none)');
    return new Set(roles).size !== roles.length || new Set(armRoles).size !== armRoles.length;
  },

  scheduleRulesApply(delay = 250) {
    if (this.hasDuplicateAssignments()) return;
    if (this.rulesApplyTimer !== null) clearTimeout(this.rulesApplyTimer);
    this.rulesApplyTimer = setTimeout(() => {
      this.rulesApplyTimer = null;
      this.applyRules({ silent: true });
    }, delay);
  },


  async previewRules() {
    const res = await api.post('/api/rules/preview', {
      assignments: this.assignments,
      arm_assignments: this.armAssignments,
    });
    this.renderReadableRules(res.content);
    this.refreshRulesStatus();
  },

  async applyRules({ silent = false } = {}) {
    if (this.hasDuplicateAssignments()) {
      if (!silent) {
        alert('Fix duplicate role assignments before applying mapping.');
      }
      return;
    }

    const res = await api.post('/api/rules/apply', {
      assignments: this.assignments,
      arm_assignments: this.armAssignments,
    });
    if (!res.ok && !silent) {
      const detail = res.error ? `\n\n${res.error}` : '';
      alert(`Failed to apply mapping directly.${detail}`);
      showToast('Direct apply failed. Use CLI install commands.', 'error');
    } else if (res.ok) {
      showToast('Mapping rules applied.', 'success');
      this.showCurrent();
    }
    this.refreshRulesStatus();
  },

  async refreshRulesStatus() {
    const statusEl = document.getElementById('rules-install-status');
    const hintEl = document.getElementById('rules-install-hint');
    const detailEl = document.getElementById('rules-detail');
    if (!statusEl || !hintEl) return;
    try {
      const res = await api.get('/api/rules/status');
      this.rulesStatus = res;
      const rulesInstalled = !!res.rules_installed;
      const sudoNoninteractive = !!res.sudo_noninteractive;
      const needsRootForInstall = !rulesInstalled && !sudoNoninteractive;
      const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      if (rulesInstalled) {
        statusEl.innerHTML = `<span style="color:var(--green); font-weight:600;">✓</span> udev rules installed at <code style="font-family:var(--mono); font-size:11px; background:var(--bg); border:1px solid var(--border); border-radius:3px; padding:1px 6px;">${esc(res.rules_path)}</code>`;
        statusEl.style.color = 'var(--text)';
      } else if (needsRootForInstall) {
        statusEl.innerHTML = `<span style="color:var(--yellow); font-weight:600;">⚠</span> udev rules are not installed. Root permission required. Run: <code style="font-family:var(--mono); font-size:11px; background:var(--bg); border:1px solid var(--border); border-radius:3px; padding:1px 6px;">lestudio install-udev</code>`;
        statusEl.style.color = 'var(--text)';
      } else {
        statusEl.innerHTML = `<span style="color:var(--text2);">⏳</span> Installing udev rules…`;
        statusEl.style.color = 'var(--text)';
      }

      // Compact vs expanded: hide detail when installed, show when not
      if (detailEl) {
        detailEl.style.display = needsRootForInstall ? '' : 'none';
      }
      hintEl.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:8px;">
          <span style="font-size:11px; color:var(--text2); font-weight:600; text-transform:uppercase; letter-spacing:0.5px; flex-shrink:0;">Recommended</span>
          <code style="background:var(--bg); border:1px solid var(--border); border-radius:4px; padding:2px 10px; font-size:12px; color:var(--text); font-family:var(--mono);">lestudio install-udev</code>
        </div>
      `;
      SidebarSignals.scheduleRefresh(0);
    } catch (err) {
      statusEl.textContent = 'Failed to read udev install status';
      statusEl.style.color = 'var(--red)';
      hintEl.textContent = String(err || 'Unknown error');
      if (detailEl) detailEl.style.display = '';
      SidebarSignals.scheduleRefresh(0);
    }
  },


  async showCurrent() {
    const res = await api.get('/api/udev/rules');
    this.renderReadableRules(res.content, res);
  },

  renderReadableRules(content, parsed = null) {
    const readable = document.getElementById('rules-readable');
    if (!readable) return;

    const lines = (content || '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));

    const parseTextRules = () => {
      const cameraRules = [];
      const armRules = [];
      const seenCam = new Set();
      const seenArm = new Set();
      for (const line of lines) {
        if (line.includes('SUBSYSTEM=="video4linux"')) {
          const kernel = (line.match(/KERNELS=="([^"]+)"/) || [null, '?'])[1];
          const symlink = (line.match(/SYMLINK\+="([^"]+)"/) || [null, '?'])[1];
          const mode = (line.match(/MODE="([^"]+)"/) || [null, '?'])[1];
          const key = `${kernel}:${symlink}`;
          if (!seenCam.has(key)) {
            seenCam.add(key);
            cameraRules.push({ kernel, symlink, mode, exists: null });
          }
        } else if (line.includes('SUBSYSTEM=="tty"')) {
          const serial = (line.match(/ATTRS\{serial\}=="([^"]+)"/) || [null, '?'])[1];
          const symlink = (line.match(/SYMLINK\+="([^"]+)"/) || [null, '?'])[1];
          const mode = (line.match(/MODE="([^"]+)"/) || [null, '?'])[1];
          const key = `${serial}:${symlink}`;
          if (!seenArm.has(key)) {
            seenArm.add(key);
            armRules.push({ serial, symlink, mode, exists: null });
          }
        }
      }
      return { cameraRules, armRules };
    };

    const hasStructuredRules = parsed
      && Array.isArray(parsed.camera_rules)
      && Array.isArray(parsed.arm_rules);

    const cameraRules = hasStructuredRules
      ? parsed.camera_rules.map((r) => ({
          kernel: r.kernel || '?',
          symlink: r.symlink || '?',
          mode: r.mode || '?',
          exists: typeof r.exists === 'boolean' ? r.exists : null,
        }))
      : parseTextRules().cameraRules;
    const armRules = hasStructuredRules
      ? parsed.arm_rules.map((r) => ({
          serial: r.serial || '?',
          symlink: r.symlink || '?',
          mode: r.mode || '?',
          exists: typeof r.exists === 'boolean' ? r.exists : null,
        }))
      : parseTextRules().armRules;

    const renderMode = (mode) => {
      if (mode === '0666') {
        return '<span style="display:inline-flex; align-items:center; border:1px solid color-mix(in srgb, var(--green) 35%, transparent); background:color-mix(in srgb, var(--green) 12%, transparent); color:var(--green); border-radius:999px; padding:2px 8px; font-size:11px; font-weight:600;">✅ r/w</span>';
      }
      return `<span style="display:inline-flex; align-items:center; border:1px solid var(--border); background:var(--bg); color:var(--text2); border-radius:999px; padding:2px 8px; font-size:11px; font-family:var(--mono);">${mode || '?'}</span>`;
    };

    const renderStatus = (exists) => {
      if (exists === true) {
        return '<span style="display:inline-flex; align-items:center; border:1px solid color-mix(in srgb, var(--green) 35%, transparent); background:color-mix(in srgb, var(--green) 12%, transparent); color:var(--green); border-radius:999px; padding:2px 8px; font-size:11px; font-weight:600;">Active</span>';
      }
      if (exists === false) {
        return '<span style="display:inline-flex; align-items:center; border:1px solid color-mix(in srgb, var(--yellow) 35%, transparent); background:color-mix(in srgb, var(--yellow) 12%, transparent); color:var(--yellow); border-radius:999px; padding:2px 8px; font-size:11px; font-weight:600;">Inactive</span>';
      }
      return '<span style="display:inline-flex; align-items:center; border:1px solid var(--border); background:var(--bg); color:var(--text2); border-radius:999px; padding:2px 8px; font-size:11px;">Unknown</span>';
    };

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
          <div class="rules-table-wrap" style="overflow-x:auto; border:1px solid var(--border); border-radius:6px; background:var(--bg2);">
            <table style="width:100%; border-collapse:collapse; text-align:left; font-size:12px;">
              <thead>
                <tr style="border-bottom:1px solid var(--border); background:var(--bg3);">
                  <th style="padding:8px 12px; color:var(--text2); font-weight:600;">${keyLabel}</th>
                  <th style="padding:8px 12px; color:var(--text2); font-weight:600;">SYMLINK</th>
                  <th style="padding:8px 12px; color:var(--text2); font-weight:600;">MODE</th>
                  <th style="padding:8px 12px; color:var(--text2); font-weight:600;">STATUS</th>
                </tr>
              </thead>
              <tbody>
                ${items.map((r, i) => `
                  <tr style="${i !== items.length - 1 ? 'border-bottom:1px solid var(--border);' : ''}${r.exists === false ? 'opacity:0.5;' : ''}">
                    <td style="padding:8px 12px; font-family:var(--mono);">${r[keyField]}</td>
                    <td style="padding:8px 12px; font-family:var(--mono); color:var(--text); font-weight:600;">${r.symlink}</td>
                    <td style="padding:8px 12px;">${renderMode(r.mode)}</td>
                    <td style="padding:8px 12px;">${renderStatus(r.exists)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    };

    if (!cameraRules.length && !armRules.length) {
      readable.innerHTML = '<div class="rules-empty" style="color:var(--text2); text-align:center; padding:24px;">No rules found or rules could not be parsed.</div>';
      return;
    }

    readable.innerHTML = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start;">
        ${section('Camera Rules', cameraRules, 'USB PORT (KERNELS)', 'kernel')}
        ${section('Arm Rules', armRules, 'SERIAL', 'serial')}
      </div>
    `;
  },

  async loadStreamSettings() {
    const s = await api.get('/api/camera_settings');
    const codecStr = s.codec || 'MJPG';
    const resStr = `${s.width}x${s.height}`;
    const fps = s.fps || 30;
    const q = s.jpeg_quality || 70;

    document.querySelectorAll('.cam-codec-sync').forEach(el => el.value = codecStr);
    document.querySelectorAll('.cam-resolution-sync').forEach(el => el.value = resStr);
    updateFpsOptions();
    document.querySelectorAll('.cam-fps-sync').forEach(el => el.value = String(fps));
    document.querySelectorAll('.cam-jpeg-quality-sync').forEach(el => el.value = q);
    document.querySelectorAll('.cam-quality-val-sync').forEach(el => el.textContent = q + '%');
    document.querySelectorAll('.feed-fps-badge').forEach(el => {
      el.textContent = `${fps} fps`;
      el.classList.add('visible');
    });
  },

  scheduleStreamApply(delay = 250) {
    if (this.streamApplyTimer !== null) clearTimeout(this.streamApplyTimer);
    this.streamApplyTimer = setTimeout(() => {
      this.streamApplyTimer = null;
      this.applyStreamSettings();
    }, delay);
  },

  initStreamControls() {
    const codecEls = document.querySelectorAll('.cam-codec-sync');
    const resEls = document.querySelectorAll('.cam-resolution-sync');
    const fpsEls = document.querySelectorAll('.cam-fps-sync');
    const qEls = document.querySelectorAll('.cam-jpeg-quality-sync');

    codecEls.forEach(el => {
      el.addEventListener('change', () => {
        codecEls.forEach(x => x.value = el.value);
        updateFpsOptions();
        this.scheduleStreamApply(0);
      });
    });

    resEls.forEach(el => {
      el.addEventListener('change', () => {
        resEls.forEach(x => x.value = el.value);
        updateFpsOptions();
        this.scheduleStreamApply(0);
      });
    });

    fpsEls.forEach(el => {
      el.addEventListener('change', () => {
        fpsEls.forEach(x => x.value = el.value);
        this.scheduleStreamApply(200);
      });
    });

    qEls.forEach(el => {
      el.addEventListener('input', () => {
        qEls.forEach(x => x.value = el.value);
        document.querySelectorAll('.cam-quality-val-sync').forEach(x => x.textContent = el.value + '%');
      });
      el.addEventListener('change', () => this.scheduleStreamApply(200));
    });
  },

  async applyStreamSettings() {
    const codecEl = document.querySelector('.cam-codec-sync');
    const resEl = document.querySelector('.cam-resolution-sync');
    const fpsEl = document.querySelector('.cam-fps-sync');
    const qEl = document.querySelector('.cam-jpeg-quality-sync');

    if (!codecEl || !resEl || !fpsEl || !qEl) return;

    const [w, h] = resEl.value.split('x').map(Number);
    const body = {
      codec:        codecEl.value,
      width:        w,
      height:       h,
      fps:          parseInt(fpsEl.value, 10),
      jpeg_quality: parseInt(qEl.value, 10),
    };

    FeedManager.suppressStall(8000);
    const res = await api.post('/api/camera_settings', body);

    if (res.ok) {
      document.querySelectorAll('.feed-card').forEach(card => {
        const vid = card.dataset.vid;
        if (!vid || FeedManager._paused.has(vid)) return;
        const loadEl = document.getElementById(`fload-${vid}`);
        if (loadEl) {
           loadEl.innerHTML = '<div class="feed-spinner"></div>';
           loadEl.style.display = 'flex';
        }
        const img = card.querySelector('img');
        if (img) img.src = `/stream/${vid}?_=${Date.now()}`;
      });
      
      await this.loadStreamSettings();
    }
  },


  /* ── Arm Identify Wizard ── */
  startArmIdentify() {
    // Snapshot current arms list
    this._identifySnapshot = (this.arms || []).map(a => ({ device: a.device, serial: a.serial, kernels: a.kernels }));

    const msgEl = document.getElementById('arm-identify-msg');
    const startBtn = document.getElementById('arm-identify-start-btn');
    const stopBtn = document.getElementById('arm-identify-stop-btn');
    const resultEl = document.getElementById('arm-identify-result');

    if (msgEl)    msgEl.textContent = 'Reconnect the arm now… Waiting for changes…';
    if (startBtn) startBtn.style.display = 'none';
    if (stopBtn)  stopBtn.style.display = '';
    if (resultEl) { resultEl.style.display = 'none'; resultEl.innerHTML = ''; }

    // Poll /api/devices every 1.5s to detect arm diff
    this._identifyPollTimer = setInterval(async () => {
      try {
        const data = await api.get('/api/devices');
        this._detectArmDiff(data.arms || []);
      } catch (e) {
        // ignore transient network errors during polling
      }
    }, 1500);
  },

  stopArmIdentify() {
    if (this._identifyPollTimer) {
      clearInterval(this._identifyPollTimer);
      this._identifyPollTimer = null;
    }
    this._identifySnapshot = null;

    const msgEl = document.getElementById('arm-identify-msg');
    const startBtn = document.getElementById('arm-identify-start-btn');
    const stopBtn = document.getElementById('arm-identify-stop-btn');

    if (msgEl)    msgEl.textContent = 'Disconnect one arm, then click Start to begin identification.';
    if (startBtn) startBtn.style.display = '';
    if (stopBtn)  stopBtn.style.display = 'none';
  },

  _detectArmDiff(newArms) {
    if (!this._identifySnapshot) return;

    const oldDevices = new Set(this._identifySnapshot.map(a => a.device));
    const appeared = newArms.filter(a => !oldDevices.has(a.device));

    if (!appeared.length) return;

    // Found new arm(s) — stop polling
    if (this._identifyPollTimer) {
      clearInterval(this._identifyPollTimer);
      this._identifyPollTimer = null;
    }

    const arm = appeared[0];
    const msgEl = document.getElementById('arm-identify-msg');
    const startBtn = document.getElementById('arm-identify-start-btn');
    const stopBtn = document.getElementById('arm-identify-stop-btn');
    const resultEl = document.getElementById('arm-identify-result');

    if (msgEl) msgEl.textContent = 'Arm detected! Assign a role below.';
    if (startBtn) startBtn.style.display = '';
    if (stopBtn)  stopBtn.style.display = 'none';

    if (!resultEl) return;
    resultEl.style.display = 'block';

    const roles = {
      '(none)':          'Not used',
      'follower_arm_1':  'Follower Arm 1',
      'follower_arm_2':  'Follower Arm 2',
      'leader_arm_1':    'Leader Arm 1',
      'leader_arm_2':    'Leader Arm 2',
    };
    const roleOpts = Object.entries(roles).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

    const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    resultEl.innerHTML = `
      <div style="background:var(--bg-card); border:1px solid var(--border); border-radius:6px; padding:14px; margin-top:10px;">
        <div style="font-weight:600; margin-bottom:8px; color:var(--green);">✓ Identified: /dev/${esc(arm.device)}</div>
        <div style="display:grid; grid-template-columns:auto 1fr; gap:4px 12px; font-size:12px; margin-bottom:12px;">
          <span style="color:var(--text2);">Serial:</span>  <code>${esc(arm.serial) || 'N/A'}</code>
          <span style="color:var(--text2);">Kernels:</span> <code>${esc(arm.kernels) || 'N/A'}</code>
          <span style="color:var(--text2);">Path:</span>    <code>${esc(arm.path) || '/dev/' + esc(arm.device)}</code>
        </div>
        ${arm.serial ? `
          <div style="display:flex; align-items:center; gap:8px;">
            <select id="arm-identify-role" style="flex:1; padding:8px; border-radius:6px; border:1px solid var(--border); background:var(--bg-app); color:var(--text1);">${roleOpts}</select>
            <button class="btn-primary" onclick="DeviceSetupTab._assignIdentifiedArm('${esc(arm.serial)}')">Assign</button>
          </div>
        ` : '<div style="color:var(--yellow); font-size:12px;">⚠ No serial number — cannot auto-assign. Use manual mapping above.</div>'}
      </div>
    `;

    // Also refresh the main arms list
    this.refresh();
  },

  _assignIdentifiedArm(serial) {
    const select = document.getElementById('arm-identify-role');
    if (!select) return;
    const role = select.value;
    if (!role || role === '(none)') {
      showToast('Select a role before assigning.', 'error');
      return;
    }

    this.armAssignments[serial] = role;
    this.validateAssignments();
    this.applyRules({ silent: true });
    this.renderArmsGrid();

    showToast(`Assigned serial ${serial} → ${role}`, 'success');

    // Reset identify panel
    const resultEl = document.getElementById('arm-identify-result');
    if (resultEl) {
      resultEl.innerHTML = `<div style="color:var(--green); padding:8px; font-weight:600;">✓ ${role} assigned successfully.</div>`;
    }
    this._identifySnapshot = null;
  },
};
