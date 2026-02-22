function getActiveTabId() {
  return document.querySelector('#sidebar-nav .tab-btn.active')?.dataset?.tab
    || document.querySelector('.tab-btn.active')?.dataset?.tab
    || '';
}

function _clearTabScopedMedia() {
  document.querySelectorAll('.cam-preview-wrap img').forEach((img) => { img.removeAttribute('src'); });
  document.querySelectorAll('.cam-preview-wrap').forEach((w) => {
    w.innerHTML = '<span class="play-hint">▶ Click to preview</span>';
  });

  const teleopFeeds = document.getElementById('teleop-feeds');
  if (teleopFeeds) {
    teleopFeeds.querySelectorAll('img').forEach((img) => img.removeAttribute('src'));
    teleopFeeds.innerHTML = '';
  }

  const recordFeeds = document.getElementById('record-feeds');
  if (recordFeeds) {
    recordFeeds.querySelectorAll('img').forEach((img) => img.removeAttribute('src'));
    recordFeeds.innerHTML = '';
  }

  FeedManager._stopWatchers();
  FeedManager.clearPaused();
  FeedManager.stopStatPolling();
}

function _runTabLazyLoad(tabName) {
  if (tabName === 'status') StatusTab.refresh();
  if (tabName === 'device-setup') { DeviceSetupTab.refresh(); FeedManager.startStatPolling(); }
  if (tabName === 'calibrate') { CalibrateTab.refreshArms(); CalibrateTab.checkFile(); CalibrateTab.refreshFiles(); }
  if (tabName === 'motor-setup') MotorSetupTab.refreshArms();
  if (tabName === 'teleop') { TeleopTab.refreshDeviceOptions(); TeleopTab.refreshCalibrationIdOptions(); TeleopTab.showFeeds(); DeviceSetupTab.loadStreamSettings(); }
  if (tabName === 'record') { RecordTab.onTabOpen(); DeviceSetupTab.loadStreamSettings(); }
  if (tabName === 'train') { TrainTab.refreshGpu(); TrainTab.refreshDatasets(); TrainTab.refreshPreflight(); }
  if (tabName === 'eval') EvalTab.loadDefaults();
  if (tabName === 'dataset') DatasetTab.refreshList();
}

function setActiveTab(tabName) {
  if (!tabName) return false;
  const targetBtn = Array.from(document.querySelectorAll('.tab-btn')).find((btn) => btn.dataset.tab === tabName);
  const targetTab = document.getElementById(`tab-${tabName}`);
  if (!targetBtn || !targetTab) return false;

  _clearTabScopedMedia();

  document.querySelectorAll('.tab-btn').forEach((btn) => btn.classList.remove('active'));
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('active'));
  targetBtn.classList.add('active');
  targetTab.classList.add('active');
  GlobalConsole.syncProcessFromTab(tabName);
  SidebarNav.onTabActivated();
  SidebarSignals.scheduleRefresh(0);
  _runTabLazyLoad(tabName);
  return true;
}

function bindTabButtons() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    if (btn.dataset.boundTabClick === '1') return;
    btn.dataset.boundTabClick = '1';
    btn.addEventListener('click', () => {
      setActiveTab(btn.dataset.tab);
    });
  });
}

function bindGlobalShortcuts() {
  if (window.__lerobotShortcutsBound) return;
  window.__lerobotShortcutsBound = true;

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (!t) return;
    const tag = (t.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) {
      return;
    }

    const activeTab = getActiveTabId();
    if (!activeTab) return;

    if (e.code === 'Space') {
      if (activeTab === 'teleop') {
        e.preventDefault();
        if (state.procStatus.teleop) TeleopTab.stop();
        else TeleopTab.start();
        return;
      }
      if (activeTab === 'record') {
        e.preventDefault();
        if (state.procStatus.record) RecordTab.stop();
        else RecordTab.start();
        return;
      }
    }

    if (activeTab !== 'record' || !state.procStatus.record) return;

    if (e.code === 'ArrowRight') {
      e.preventDefault();
      RecordTab.sendKey('right');
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      RecordTab.sendKey('left');
    } else if (e.code === 'Escape') {
      e.preventDefault();
      RecordTab.sendKey('escape');
    }
  });
}
