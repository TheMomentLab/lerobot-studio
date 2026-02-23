/* ─── Theme Manager ──────────────────────────────────────────────────────────── */
const ThemeManager = {
  _STORAGE_KEY: 'lestudio-theme',

  init() {
    const saved = localStorage.getItem(this._STORAGE_KEY) || 'dark';
    this._apply(saved);
  },

  toggle() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    this._apply(next);
    localStorage.setItem(this._STORAGE_KEY, next);
  },

  _apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) {
      btn.textContent = theme === 'dark' ? '🌙' : '☀️';
      btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    }
  },
};

/* ─── Init ───────────────────────────────────────────────────────────────────── */
(async () => {
  bindTabButtons();
  ThemeManager.init();
  bindGlobalShortcuts();
  DeviceSetupTab.initStreamControls();
  // ProfileManager.bindDropzone() — removed: dropzone element removed from header
  SidebarNav.init();
  SidebarSignals.init();
  ModeManager.init();
  GlobalConsole.init();
  SidebarNav.syncBadges();
  NotificationManager.ensurePermission();
  WS.connect();
  await loadConfig();
  await ModeManager.refreshReadiness();
  await ProfileManager.refresh();
  StatusTab.refresh();
})();
