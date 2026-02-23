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
  const processName = LOG_ID_TO_PROCESS[logId];
  if (processName) GlobalConsole.clearProcess(processName);
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
  const lineText = text === '' ? '> [ENTER]' : `> ${text}`;
  appendLog(logId, lineText, 'info');
  input.value = '';
}

async function runPreflight(cfg, logId) {
  const res = await api.post('/api/preflight', cfg);
  const checks = Array.isArray(res.checks) ? res.checks : [];

  checks.forEach((c) => {
    const icon = c.status === 'ok' ? 'OK' : c.status === 'warn' ? 'WARN' : 'ERROR';
    const kind = c.status === 'error' ? 'error' : c.status === 'warn' ? 'info' : 'stdout';
    appendLog(logId, `[${icon}] ${c.label}: ${c.msg}`, kind);
  });

  if (!res.ok) {
    appendLog(logId, '[ERROR] Preflight failed. Fix errors before starting.', 'error');
    return false;
  }

  const hasWarn = checks.some((c) => c.status === 'warn');
  if (hasWarn) {
    appendLog(logId, '[INFO] Preflight passed with warnings.', 'info');
  } else {
    appendLog(logId, '[INFO] Preflight passed.', 'info');
  }
  return true;
}

function appendLog(logId, text, kind = 'stdout') {
  const processName = LOG_ID_TO_PROCESS[logId];
  const el = document.getElementById(logId);
  if (el) {
    const line = document.createElement('div');
    line.className  = `line-${kind}`;
    line.textContent = text;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }
  if (processName) GlobalConsole.append(processName, text, kind);
}

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

const CAMERA_ROLE_OPTIONS = ['top_1', 'top_2', 'top_3', 'wrist_1', 'wrist_2'];
/* ─── Mapped-only camera system ─────────────────────────────────────────────── */
/* Cameras are sourced exclusively from udev symlinks set in the Mapping tab.  */
/* No manual add/remove/edit — single source of truth.                         */

let _mappedCameras = {};  // { role: '/dev/symlink', ... }

async function fetchMappedCameras() {
  try {
    const res = await api.get('/api/devices');
    const cameras = Array.isArray(res?.cameras) ? res.cameras : [];
    const mapped = {};
    for (const cam of cameras) {
      if (cam.symlink) {
        mapped[cam.symlink] = `/dev/${cam.symlink}`;
      }
    }
    _mappedCameras = mapped;
  } catch (_) {
    _mappedCameras = {};
  }
  return _mappedCameras;
}

function getMappedCameras() {
  return { ..._mappedCameras };
}

function renderMappedCameraRows(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  const entries = Object.entries(_mappedCameras);
  if (!entries.length) {
    container.innerHTML = `
      <div class="no-cameras-empty">
        <div class="no-cam-text">
          No mapped cameras found.<br>
          <span style="font-size:12px; color:var(--text2);">Set up camera mappings in the <b>Mapping</b> tab first.</span>
        </div>
      </div>`;
    return;
  }
  for (const [role, path] of entries) {
    const row = document.createElement('div');
    row.className = 'cam-row mapped-cam-row';
    row.style.cssText = 'grid-template-columns:1fr 1fr; gap:8px;';

    const roleEl = document.createElement('div');
    roleEl.className = 'mapped-cam-role';
    roleEl.textContent = role;
    roleEl.dataset.role = role;
    roleEl.dataset.path = path;

    const pathEl = document.createElement('div');
    pathEl.className = 'mapped-cam-path';
    pathEl.textContent = path;

    row.appendChild(roleEl);
    row.appendChild(pathEl);
    container.appendChild(row);
  }
}

function collectMappedCameras() {
  return { ..._mappedCameras };
}