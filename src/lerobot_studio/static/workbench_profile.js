const ProfileManager = {
  setActiveBadge(name) {
    const badge = document.getElementById('profile-active-badge');
    if (badge) badge.textContent = `Active: ${name || 'default'}`;
  },

  async refresh() {
    const res = await api.get('/api/profiles');
    const select = document.getElementById('profile-select');
    if (!select) return;
    const profiles = Array.isArray(res.profiles) ? res.profiles : [];
    select.innerHTML = profiles.map((name) => `<option value="${name}">${name}</option>`).join('');
    if (res.active && profiles.includes(res.active)) {
      select.value = res.active;
    } else if (profiles.length > 0) {
      select.value = profiles[0];
    }
    this.setActiveBadge(select.value || res.active || 'default');
  },

  currentName() {
    return document.getElementById('profile-select')?.value || 'default';
  },

  collectCurrentConfig() {
    const teleopCfg = TeleopTab.buildConfig();
    const recordCfg = RecordTab.buildConfig();
    const evalCfg = EvalTab.buildConfig();
    const cfg = {
      ...state.config,
      ...teleopCfg,
      ...recordCfg,
      ...evalCfg,
      train_dataset_source: TrainTab.getDatasetSource(),
      train_policy: getVal('train-policy') || 'act',
      train_steps: parseInt(getVal('train-steps'), 10) || 100000,
      train_device: getVal('train-device') || 'cuda',
      train_repo_id: getVal('train-repo') || 'user/my-dataset',
      profile_name: this.currentName(),
    };
    state.config = cfg;
    return cfg;
  },

  async saveCurrent() {
    const name = this.currentName();
    const cfg = this.collectCurrentConfig();
    const res = await api.post(`/api/profiles/${encodeURIComponent(name)}`, cfg);
    if (res.ok) {
      saveConfig();
      await this.refresh();
      this.setActiveBadge(name);
    } else {
      alert(`Failed to save profile: ${res.error || 'Unknown error'}`);
    }
  },

  async saveAs() {
    const raw = prompt('New profile name (letters, numbers, dot, dash, underscore):', this.currentName());
    const name = (raw || '').trim();
    if (!name) return;
    const cfg = this.collectCurrentConfig();
    cfg.profile_name = name;
    const res = await api.post(`/api/profiles/${encodeURIComponent(name)}`, cfg);
    if (!res.ok) {
      alert(`Failed to save profile: ${res.error || 'Unknown error'}`);
      return;
    }
    state.config.profile_name = name;
    saveConfig();
    await this.refresh();
    this.setActiveBadge(name);
  },

  async applySelected() {
    const name = this.currentName();
    const res = await api.get(`/api/profiles/${encodeURIComponent(name)}`);
    if (!res.ok || !res.config) {
      alert(`Failed to load profile: ${res.error || 'Unknown error'}`);
      return;
    }
    const cfg = { ...res.config, profile_name: name };
    state.config = cfg;
    TeleopTab.applyConfig(cfg);
    RecordTab.applyConfig(cfg);
    TrainTab.applyConfig(cfg);
    EvalTab.applyConfig(cfg);
    setVal('train-policy', cfg.train_policy || 'act');
    setVal('train-steps', String(cfg.train_steps || 100000));
    setVal('train-device', cfg.train_device || 'cuda');
    setVal('train-repo', cfg.train_repo_id || 'user/my-dataset');
    await TrainTab.refreshPreflight();
    saveConfig();
    this.setActiveBadge(name);
  },

  async deleteCurrent() {
    const name = this.currentName();
    if (!name || name === 'default') {
      alert('Cannot delete default profile.');
      return;
    }
    if (!confirm(`Delete profile '${name}'?`)) return;
    const r = await fetch(`/api/profiles/${encodeURIComponent(name)}`, { method: 'DELETE' });
    const res = await r.json();
    if (!res.ok) {
      alert(`Failed to delete profile: ${res.error || 'Unknown error'}`);
      return;
    }
    await this.refresh();
    await this.applySelected();
  },

  async exportCurrent() {
    const name = this.currentName();
    const res = await api.get(`/api/profiles/${encodeURIComponent(name)}`);
    if (!res.ok || !res.config) {
      alert(`Failed to export profile: ${res.error || 'Unknown error'}`);
      return;
    }
    const content = JSON.stringify(res.config, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  triggerImport() {
    const input = document.getElementById('profile-import-input');
    if (input) input.click();
  },

  async importFromFile(file, suggestedName = '') {
    if (!file) return;
    if (!isJsonProfileFile(file)) {
      showToast('Only .json profile files are supported.', 'error');
      return;
    }
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      showToast('Invalid JSON file.', 'error');
      return;
    }

    const baseName = suggestedName || file.name.replace(/\.json$/i, '') || 'imported-profile';
    const raw = prompt('Profile name for import:', baseName);
    const name = (raw || '').trim();
    if (!name) return;

    const res = await api.post('/api/profiles-import', { name, config: parsed });
    if (!res.ok) {
      showToast(`Import failed: ${res.error || 'Unknown error'}`, 'error');
      return;
    }

    await this.refresh();
    const select = document.getElementById('profile-select');
    if (select) select.value = name;
    await this.applySelected();
    this.setActiveBadge(name);
    showToast(`Profile imported: ${name}`, 'success');
  },

  async handleImportFile(input) {
    const file = input?.files?.[0];
    if (file) await this.importFromFile(file);
    input.value = '';
  },

  toggleMoreMenu() {
    const menu = document.getElementById('profile-more-menu');
    if (!menu) return;
    const isOpen = menu.style.display !== 'none';
    if (isOpen) {
      menu.style.display = 'none';
    } else {
      menu.style.display = 'flex';
      // Close when clicking outside
      const close = (e) => {
        const wrap = document.getElementById('profile-more-wrap');
        if (wrap && !wrap.contains(e.target)) {
          menu.style.display = 'none';
          document.removeEventListener('click', close, true);
        }
      };
      setTimeout(() => document.addEventListener('click', close, true), 0);
    }
  },

  closeMoreMenu() {
    const menu = document.getElementById('profile-more-menu');
    if (menu) menu.style.display = 'none';
  },

  bindDropzone() {
    const zone = document.getElementById('profile-dropzone');
    if (!zone) return;

    zone.addEventListener('click', () => this.triggerImport());
    const prevent = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((evt) => {
      zone.addEventListener(evt, prevent);
    });

    ['dragenter', 'dragover'].forEach((evt) => {
      zone.addEventListener(evt, () => zone.classList.add('active'));
    });
    ['dragleave', 'drop'].forEach((evt) => {
      zone.addEventListener(evt, () => zone.classList.remove('active'));
    });

    zone.addEventListener('drop', async (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (!isJsonProfileFile(file)) {
        showToast('Drop a .json profile file.', 'error');
        return;
      }
      const suggested = file.name.replace(/\.json$/i, '') || 'imported-profile';
      await this.importFromFile(file, suggested);
    });
  },
};
