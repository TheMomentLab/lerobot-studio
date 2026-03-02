/**
 * Workflow Audit Script
 * 각 탭에 대해 사용자의 실제 워크플로우를 정의하고 순서대로 조작하면서 점검
 *
 * 워크플로우 순서 (LeRobot 실사용 기준):
 * 1. System Status - 하드웨어 상태 확인
 * 2. Motor Setup - 모터 연결 및 설정
 * 3. Camera Setup - 카메라 설정
 * 4. Teleop - 원격 조작 테스트
 * 5. Recording - 에피소드 녹화
 * 6. Dataset - 데이터셋 관리/점검
 * 7. Training - 학습 실행
 * 8. Evaluation - 정책 평가
 */

import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_DIR = path.join(__dirname, "workflow_audit");
const BASE = "http://localhost:5173";

if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });

const results = {};

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(AUDIT_DIR, `${name}.png`), fullPage: false });
  log(`  📸 ${name}`);
}

async function waitStable(page, ms = 500) {
  await page.waitForTimeout(ms);
}

/** 클릭 가능 여부 + 실제 클릭 후 상태 변화 감지 */
async function tryClick(page, selector, label) {
  try {
    const el = page.locator(selector).first();
    const isVisible = await el.isVisible({ timeout: 3000 }).catch(() => false);
    if (!isVisible) {
      return { ok: false, reason: `not visible: ${label}` };
    }
    const box = await el.boundingBox();
    if (!box) return { ok: false, reason: `no bounding box: ${label}` };
    if (box.width < 2 || box.height < 2) {
      return { ok: false, reason: `too small (${box.width}x${box.height}): ${label}` };
    }
    await el.click({ timeout: 3000 });
    return { ok: true, box };
  } catch (e) {
    return { ok: false, reason: `click failed: ${label} — ${e.message}` };
  }
}

/** 네비게이션 (사이드바 클릭) */
async function navigateTo(page, path, label) {
  const link = page.locator(`nav a[href="${path}"]`).first();
  const isVisible = await link.isVisible({ timeout: 2000 }).catch(() => false);
  if (isVisible) {
    await link.click();
  } else {
    await page.goto(`${BASE}${path}`);
  }
  await waitStable(page, 800);
  log(`📍 Navigated to ${label}`);
}

// ─── MAIN ──────────────────────────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  // Suppress API errors (wireframe has no real backend)
  page.on("pageerror", () => {});
  page.on("console", () => {});

  log("🚀 Starting workflow audit...");
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 15000 });
  await waitStable(page, 1000);

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. SYSTEM STATUS — 사용자 워크플로우: 페이지 열기 → 상태 확인 → 문제있으면 해당 탭으로 이동
  // ═══════════════════════════════════════════════════════════════════════════
  log("\n═══ 1/8: System Status ═══");
  results.systemStatus = { issues: [] };

  await shot(page, "01_status_initial");

  // a) 카드들이 보이는지
  const cards = page.locator("[class*='border-zinc']").filter({ hasText: /Camera|Arm|Process|Resource/ });
  const cardCount = await cards.count();
  log(`  Cards visible: ${cardCount}`);
  if (cardCount < 1) results.systemStatus.issues.push("Expected at least 1 status card, found " + cardCount);

  // b) Refresh 버튼 클릭
  const refreshResult = await tryClick(page, "button:has-text('Refresh'), button[title*='Refresh'], button:has(svg)", "Refresh button");
  if (!refreshResult.ok) {
    // Try finding by RefreshCw icon
    const refreshAlt = await tryClick(page, "button >> svg", "Refresh icon button");
    results.systemStatus.refreshButton = refreshAlt;
  } else {
    results.systemStatus.refreshButton = refreshResult;
  }

  // c) "Camera Setup" 등의 링크가 있다면 클릭 가능한지
  const setupLink = page.locator("a:has-text('Camera Setup'), a:has-text('카메라')").first();
  const setupLinkVisible = await setupLink.isVisible({ timeout: 1000 }).catch(() => false);
  results.systemStatus.quickLinks = { cameraSetupLink: setupLinkVisible };
  log(`  Camera Setup quick-link visible: ${setupLinkVisible}`);

  // d) History 섹션 스크롤
  const historySection = page.locator("text=Session History, text=History").first();
  const historyVisible = await historySection.isVisible({ timeout: 1000 }).catch(() => false);
  results.systemStatus.historyVisible = historyVisible;

  await shot(page, "01_status_after_interact");

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. MOTOR SETUP — 워크플로우: 포트 선택 → 모터 스캔 → 개별 모터 제어 테스트 → 칼리브레이션 파일 확인
  // ═══════════════════════════════════════════════════════════════════════════
  log("\n═══ 2/8: Motor Setup ═══");
  results.motorSetup = { issues: [] };
  await navigateTo(page, "/motor-setup", "Motor Setup");
  await shot(page, "02_motor_initial");

  // a) 포트 선택 드롭다운
  const motorSelect = page.locator("select").first();
  const motorSelectVisible = await motorSelect.isVisible({ timeout: 2000 }).catch(() => false);
  results.motorSetup.portSelectVisible = motorSelectVisible;
  if (motorSelectVisible) {
    await motorSelect.selectOption({ index: 0 }).catch(() => {});
    log("  Port select: interacted");
  }

  // b) Scan / Connect 버튼
  const scanBtn = await tryClick(page, "button:has-text('Scan'), button:has-text('스캔'), button:has-text('Connect')", "Scan/Connect");
  results.motorSetup.scanButton = scanBtn;

  // c) 슬라이더 또는 숫자 입력 (모터 제어)
  const numberInput = page.locator("input[type='number']").first();
  const numInputVisible = await numberInput.isVisible({ timeout: 2000 }).catch(() => false);
  if (numInputVisible) {
    const curVal = await numberInput.inputValue();
    await numberInput.fill("2048");
    await waitStable(page, 300);
    const newVal = await numberInput.inputValue();
    results.motorSetup.motorControl = { before: curVal, after: newVal, changed: curVal !== newVal };
    log(`  Motor value input: ${curVal} → ${newVal}`);
  } else {
    results.motorSetup.motorControl = { visible: false };
  }

  // d) 캘리브레이션 파일 목록
  const calibFiles = page.locator("text=.json, text=calibration").first();
  const calibVisible = await calibFiles.isVisible({ timeout: 1000 }).catch(() => false);
  results.motorSetup.calibrationFilesVisible = calibVisible;

  await shot(page, "02_motor_after_interact");

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. CAMERA SETUP — 워크플로우: 카메라 목록 확인 → 역할 지정 → 프리뷰 확인
  // ═══════════════════════════════════════════════════════════════════════════
  log("\n═══ 3/8: Camera Setup ═══");
  results.cameraSetup = { issues: [] };
  await navigateTo(page, "/camera-setup", "Camera Setup");
  await shot(page, "03_camera_initial");

  // a) 카메라 행 목록
  const cameraRows = page.locator("[class*='group']").filter({ hasText: /video|cam|C920|C270/ });
  const camRowCount = await cameraRows.count();
  results.cameraSetup.cameraRowCount = camRowCount;
  log(`  Camera rows: ${camRowCount}`);

  // b) 역할 드롭다운 선택
  const roleSelect = page.locator("select").first();
  const roleSelectVisible = await roleSelect.isVisible({ timeout: 2000 }).catch(() => false);
  if (roleSelectVisible) {
    const options = await roleSelect.locator("option").allTextContents();
    results.cameraSetup.roleOptions = options;
    log(`  Role select options: ${options.join(", ")}`);
  }

  // c) Refresh 버튼
  const camRefresh = await tryClick(page, "button:has-text('Refresh'), button[title*='efresh']", "Camera Refresh");
  results.cameraSetup.refreshButton = camRefresh;

  await shot(page, "03_camera_after_interact");

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. TELEOP — 워크플로우: 모드 선택 → 포트/카메라 설정 탭 확인 → Start → 로딩 → Running 상태 → Stop
  // ═══════════════════════════════════════════════════════════════════════════
  log("\n═══ 4/8: Teleop ═══");
  results.teleop = { issues: [] };
  await navigateTo(page, "/teleop", "Teleop");
  await shot(page, "04_teleop_initial");

  // a) 모드 토글 (Single Arm / Bi-Arm)
  const biArmBtn = await tryClick(page, "button:has-text('Bi-Arm')", "Bi-Arm toggle");
  results.teleop.biArmToggle = biArmBtn;
  if (biArmBtn.ok) {
    await waitStable(page, 500);
    await shot(page, "04_teleop_biarm_mode");
    // 복원
    await tryClick(page, "button:has-text('Single Arm')", "Single Arm toggle");
    await waitStable(page, 300);
  }

  // b) 서브탭 전환 (Motor Setting → Camera Setting)
  const cameraTabBtn = await tryClick(page, "button:has-text('Camera Setting'), button:has-text('카메라')", "Camera Setting tab");
  results.teleop.cameraSettingTab = cameraTabBtn;
  if (cameraTabBtn.ok) {
    await waitStable(page, 400);
    await shot(page, "04_teleop_camera_tab");
    // 복원
    await tryClick(page, "button:has-text('Motor Setting'), button:has-text('모터')", "Motor Setting tab");
    await waitStable(page, 300);
  }

  // c) Start 버튼 클릭
  const startBtn = await tryClick(page, "button:has-text('Start Teleop'), button:has-text('시작')", "Start Teleop");
  results.teleop.startButton = startBtn;
  if (startBtn.ok) {
    await waitStable(page, 500);
    await shot(page, "04_teleop_loading");

    // 로딩 시퀀스 대기 (최대 5초)
    await page.waitForTimeout(4000);
    await shot(page, "04_teleop_running");

    // d) Running 상태에서 카메라 피드 확인
    const feedBoxes = page.locator("[class*='bg-zinc-900'], [class*='bg-black']");
    const feedCount = await feedBoxes.count();
    results.teleop.cameraFeedBoxes = feedCount;
    log(`  Camera feed boxes: ${feedCount}`);

    // e) Stop 버튼
    const stopBtn = await tryClick(page, "button:has-text('Stop'), button:has-text('정지')", "Stop Teleop");
    results.teleop.stopButton = stopBtn;
    await waitStable(page, 500);
    await shot(page, "04_teleop_stopped");
  }

  // f) breadcrumb 네비게이션 확인 (→ Recording 링크)
  const breadcrumbRecording = page.locator("a:has-text('Recording')").first();
  const breadcrumbVisible = await breadcrumbRecording.isVisible({ timeout: 1000 }).catch(() => false);
  results.teleop.breadcrumbToRecording = breadcrumbVisible;

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. RECORDING — 워크플로우: 서브탭 확인 → 에피소드 수 설정 → Start → 녹화중 UI → Save/Discard → Stop
  // ═══════════════════════════════════════════════════════════════════════════
  log("\n═══ 5/8: Recording ═══");
  results.recording = { issues: [] };
  await navigateTo(page, "/recording", "Recording");
  await shot(page, "05_recording_initial");

  // a) 서브탭 전환 (녹화 계획 → 디바이스 → 카메라)
  const deviceTab = await tryClick(page, "button:has-text('디바이스')", "Device tab");
  results.recording.deviceTab = deviceTab;
  if (deviceTab.ok) {
    await waitStable(page, 400);
    await shot(page, "05_recording_device_tab");
  }
  const cameraTab = await tryClick(page, "button:has-text('카메라')", "Camera tab");
  results.recording.cameraTab = cameraTab;
  if (cameraTab.ok) {
    await waitStable(page, 400);
    await shot(page, "05_recording_camera_tab");
  }
  // 녹화 계획 탭 복원
  await tryClick(page, "button:has-text('녹화 계획')", "Plan tab");
  await waitStable(page, 300);

  // b) 에피소드 수 입력
  const epInput = page.locator("input[type='number']").first();
  const epInputVisible = await epInput.isVisible({ timeout: 2000 }).catch(() => false);
  if (epInputVisible) {
    await epInput.fill("30");
    const epVal = await epInput.inputValue();
    results.recording.episodeInput = { visible: true, value: epVal };
    log(`  Episode input set to: ${epVal}`);
  }

  // c) Start Recording 버튼
  const recStartBtn = await tryClick(page, "button:has-text('Start Recording'), button:has-text('녹화 시작')", "Start Recording");
  results.recording.startButton = recStartBtn;
  if (recStartBtn.ok) {
    await waitStable(page, 500);
    await shot(page, "05_recording_loading");

    // 로딩 시퀀스 대기
    await page.waitForTimeout(4000);
    await shot(page, "05_recording_running");

    // d) 녹화 중 UI: Save/Discard 버튼
    const saveBtn = page.locator("button:has-text('Save'), button:has-text('저장'), button:has-text('Next')").first();
    const saveBtnVisible = await saveBtn.isVisible({ timeout: 2000 }).catch(() => false);
    results.recording.saveButtonInRunning = saveBtnVisible;
    log(`  Save button visible during recording: ${saveBtnVisible}`);

    if (saveBtnVisible) {
      await saveBtn.click();
      await waitStable(page, 500);
      await shot(page, "05_recording_after_save");
    }

    // e) Stop
    const recStopBtn = await tryClick(page, "button:has-text('Stop'), button:has-text('녹화 중지')", "Stop Recording");
    results.recording.stopButton = recStopBtn;
    await waitStable(page, 500);
  }

  await shot(page, "05_recording_final");

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. DATASET — 워크플로우: 데이터셋 목록 확인 → 선택 → 에피소드 탐색 → Hub 검색 → 다운로드
  // ═══════════════════════════════════════════════════════════════════════════
  log("\n═══ 6/8: Dataset ═══");
  results.dataset = { issues: [] };
  await navigateTo(page, "/dataset", "Dataset");
  await shot(page, "06_dataset_initial");

  // a) 데이터셋 목록에서 첫 번째 항목 클릭
  const dsItem = page.locator("[class*='group']").filter({ hasText: /pick_cube|place_cup/ }).first();
  const dsItemVisible = await dsItem.isVisible({ timeout: 2000 }).catch(() => false);
  if (dsItemVisible) {
    await dsItem.click();
    await waitStable(page, 500);
    await shot(page, "06_dataset_selected");
    results.dataset.datasetSelect = { ok: true };
    log("  Dataset item selected");
  } else {
    results.dataset.datasetSelect = { ok: false, reason: "No dataset items found" };
  }

  // b) 에피소드 목록/상세 확인
  const episodeElements = page.locator("text=Episode, text=에피소드, text=ep").first();
  const epVisible = await episodeElements.isVisible({ timeout: 1000 }).catch(() => false);
  results.dataset.episodeDetailsVisible = epVisible;

  // c) Hub 탭 전환
  const hubTab = await tryClick(page, "button:has-text('Hub'), button:has-text('Search')", "Hub tab");
  results.dataset.hubTab = hubTab;
  if (hubTab.ok) {
    await waitStable(page, 500);
    await shot(page, "06_dataset_hub_tab");

    // d) Hub 검색
    const searchInput = page.locator("input[placeholder*='검색'], input[placeholder*='Hub'], input[placeholder*='search']").first();
    const searchVisible = await searchInput.isVisible({ timeout: 2000 }).catch(() => false);
    if (searchVisible) {
      await searchInput.fill("pick cube");
      await searchInput.press("Enter");
      await waitStable(page, 500);
      await shot(page, "06_dataset_hub_search_results");
      results.dataset.hubSearch = { ok: true };

      // e) 다운로드 버튼
      const downloadBtn = page.locator("button:has-text('Download'), button:has-text('다운로드'), button >> svg").first();
      const dlVisible = await downloadBtn.isVisible({ timeout: 1000 }).catch(() => false);
      results.dataset.downloadButtonVisible = dlVisible;
    }
  }

  // f) 삭제 버튼 hover 테스트
  if (dsItemVisible) {
    // Local 탭 복원
    await tryClick(page, "button:has-text('Local'), button:has-text('로컬')", "Local tab");
    await waitStable(page, 300);
    const firstGroup = page.locator("[class*='group']").filter({ hasText: /pick_cube/ }).first();
    if (await firstGroup.isVisible().catch(() => false)) {
      await firstGroup.hover();
      await waitStable(page, 300);
      const deleteBtn = firstGroup.locator("button[title='Delete'], button:has(svg)").last();
      const deleteVisible = await deleteBtn.isVisible({ timeout: 1000 }).catch(() => false);
      const deleteOpacity = deleteVisible ? await deleteBtn.evaluate(el => getComputedStyle(el).opacity) : "N/A";
      results.dataset.deleteButtonOnHover = { visible: deleteVisible, opacity: deleteOpacity };
      log(`  Delete button on hover — visible: ${deleteVisible}, opacity: ${deleteOpacity}`);
      await shot(page, "06_dataset_hover_delete");
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. TRAINING — 워크플로우: Policy/Dataset 선택 → Device 확인 → Preset 선택 → CUDA 상태 확인 → Start → 학습 진행 UI → Stop
  // ═══════════════════════════════════════════════════════════════════════════
  log("\n═══ 7/8: Training ═══");
  results.training = { issues: [] };
  await navigateTo(page, "/training", "Training");
  await shot(page, "07_training_initial");

  // a) Policy Type 선택
  const policySelect = page.locator("select").first();
  const policySelectVisible = await policySelect.isVisible({ timeout: 2000 }).catch(() => false);
  if (policySelectVisible) {
    const policyOptions = await policySelect.locator("option").allTextContents();
    results.training.policyOptions = policyOptions;
    log(`  Policy options: ${policyOptions.join(", ")}`);
  }

  // b) Preset 버튼 (Quick / Standard / Full)
  const quickPreset = await tryClick(page, "button:has-text('Quick')", "Quick preset");
  results.training.quickPreset = quickPreset;
  if (quickPreset.ok) {
    await waitStable(page, 300);
    await shot(page, "07_training_quick_preset");
  }

  const fullPreset = await tryClick(page, "button:has-text('Full')", "Full preset");
  results.training.fullPreset = fullPreset;
  if (fullPreset.ok) {
    await waitStable(page, 300);
  }

  // Standard로 복원
  await tryClick(page, "button:has-text('Standard')", "Standard preset");
  await waitStable(page, 300);

  // c) 고급 오버라이드 열기
  const advToggle = await tryClick(page, "button:has-text('고급'), button:has-text('Advanced')", "Advanced toggle");
  results.training.advancedToggle = advToggle;
  if (advToggle.ok) {
    await waitStable(page, 400);
    await shot(page, "07_training_advanced_open");

    // Learning Rate 입력 확인
    const lrInput = page.locator("input[type='text']").filter({ hasText: /1e|0\.000/ }).first();
    const lrVisible = await lrInput.isVisible({ timeout: 1000 }).catch(() => false);
    results.training.lrInputVisible = lrVisible;
  }

  // d) CUDA status card
  const cudaCard = page.locator("text=CUDA, text=GPU").first();
  const cudaVisible = await cudaCard.isVisible({ timeout: 1000 }).catch(() => false);
  results.training.cudaStatusVisible = cudaVisible;

  // e) Start Training 버튼
  const trainStartBtn = await tryClick(page, "button:has-text('Start Training'), button:has-text('학습 시작')", "Start Training");
  results.training.startButton = trainStartBtn;
  if (trainStartBtn.ok) {
    await waitStable(page, 500);
    await shot(page, "07_training_loading");

    // 로딩 대기
    await page.waitForTimeout(3000);
    await shot(page, "07_training_running");

    // f) 학습 중 차트/메트릭 확인
    const chart = page.locator("[class*='recharts'], svg:has(path)").first();
    const chartVisible = await chart.isVisible({ timeout: 2000 }).catch(() => false);
    results.training.chartVisible = chartVisible;
    log(`  Training chart visible: ${chartVisible}`);

    // g) Stop 버튼
    const trainStopBtn = await tryClick(page, "button:has-text('Stop'), button:has-text('중지')", "Stop Training");
    results.training.stopButton = trainStopBtn;
    await waitStable(page, 500);
  }

  await shot(page, "07_training_final");

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. EVALUATION — 워크플로우: Policy 선택 → Env 선택 → 에피소드/설정 → Start → 결과 확인
  // ═══════════════════════════════════════════════════════════════════════════
  log("\n═══ 8/8: Evaluation ═══");
  results.evaluation = { issues: [] };
  await navigateTo(page, "/evaluation", "Evaluation");
  await shot(page, "08_eval_initial");

  // a) Policy Source 선택
  const evalPolicySelect = page.locator("select").first();
  const evalPolicyVisible = await evalPolicySelect.isVisible({ timeout: 2000 }).catch(() => false);
  if (evalPolicyVisible) {
    const evalPolicyOptions = await evalPolicySelect.locator("option").allTextContents();
    results.evaluation.policyOptions = evalPolicyOptions;
    log(`  Eval policy options: ${evalPolicyOptions.join(", ")}`);
  }

  // b) Env / Gym 선택
  const envSelector = page.locator("text=PushT, text=Aloha, text=Real Robot").first();
  const envVisible = await envSelector.isVisible({ timeout: 1000 }).catch(() => false);
  results.evaluation.envSelectorVisible = envVisible;

  // Env 카드 클릭 가능한지
  const pushTBtn = await tryClick(page, "button:has-text('PushT'), [class*='border']:has-text('PushT')", "PushT env");
  results.evaluation.pushTEnv = pushTBtn;
  if (pushTBtn.ok) {
    await waitStable(page, 400);
    await shot(page, "08_eval_pusht_selected");
  }

  // c) 에피소드 수 입력
  const evalEpInput = page.locator("input[type='number']").first();
  const evalEpVisible = await evalEpInput.isVisible({ timeout: 2000 }).catch(() => false);
  if (evalEpVisible) {
    await evalEpInput.fill("5");
    results.evaluation.episodeInput = { visible: true, value: "5" };
  }

  // d) 고급 설정
  const evalAdvToggle = await tryClick(page, "button:has-text('고급'), button:has-text('Advanced')", "Eval Advanced toggle");
  results.evaluation.advancedToggle = evalAdvToggle;
  if (evalAdvToggle.ok) {
    await waitStable(page, 300);
    await shot(page, "08_eval_advanced_open");
  }

  // e) Camera Mapping 섹션
  const cameraMappingSection = page.locator("text=Camera Mapping, text=카메라 매핑").first();
  const camMapVisible = await cameraMappingSection.isVisible({ timeout: 1000 }).catch(() => false);
  results.evaluation.cameraMappingVisible = camMapVisible;

  // f) Start Evaluation 버튼
  const evalStartBtn = await tryClick(page, "button:has-text('Start'), button:has-text('평가 시작')", "Start Evaluation");
  results.evaluation.startButton = evalStartBtn;
  if (evalStartBtn.ok) {
    await waitStable(page, 500);
    await shot(page, "08_eval_loading");

    await page.waitForTimeout(3000);
    await shot(page, "08_eval_running");

    // g) 결과 차트 (BarChart)
    const evalChart = page.locator("[class*='recharts'], svg:has(rect)").first();
    const evalChartVisible = await evalChart.isVisible({ timeout: 2000 }).catch(() => false);
    results.evaluation.resultChartVisible = evalChartVisible;
    log(`  Eval result chart: ${evalChartVisible}`);

    // h) Stop
    const evalStopBtn = await tryClick(page, "button:has-text('Stop'), button:has-text('중지')", "Stop Evaluation");
    results.evaluation.stopButton = evalStopBtn;
    await waitStable(page, 500);
  }

  await shot(page, "08_eval_final");

  // ═══════════════════════════════════════════════════════════════════════════
  // CROSS-TAB CHECKS — 전체 워크플로우 흐름 점검
  // ═══════════════════════════════════════════════════════════════════════════
  log("\n═══ Cross-Tab Checks ═══");
  results.crossTab = { issues: [] };

  // a) 사이드바 네비게이션 전 탭 순회
  const navPaths = ["/", "/motor-setup", "/camera-setup", "/teleop", "/recording", "/dataset", "/training", "/evaluation"];
  for (const p of navPaths) {
    const link = page.locator(`nav a[href="${p}"]`).first();
    const vis = await link.isVisible({ timeout: 1000 }).catch(() => false);
    if (!vis) {
      results.crossTab.issues.push(`Sidebar link not visible: ${p}`);
      log(`  ⚠ Sidebar link missing: ${p}`);
    }
  }

  // b) 사이드바 collapse 토글
  const collapseBtn = page.locator("header button").first();
  if (await collapseBtn.isVisible().catch(() => false)) {
    await collapseBtn.click();
    await waitStable(page, 500);
    await shot(page, "09_sidebar_collapsed");

    // collapsed 상태에서 nav 아이콘 확인
    const collapsedNav = page.locator("nav");
    const navWidth = await collapsedNav.evaluate(el => el.getBoundingClientRect().width).catch(() => 0);
    results.crossTab.collapsedNavWidth = navWidth;
    log(`  Collapsed nav width: ${navWidth}px`);

    // 복원
    await collapseBtn.click();
    await waitStable(page, 500);
  }

  // c) 테마 토글
  const themeBtn = page.locator("button[title='Toggle theme']").first();
  if (await themeBtn.isVisible().catch(() => false)) {
    const bgBefore = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await themeBtn.click();
    await waitStable(page, 500);
    const bgAfter = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    results.crossTab.themeToggle = { before: bgBefore, after: bgAfter, changed: bgBefore !== bgAfter };
    log(`  Theme toggle: bg ${bgBefore} → ${bgAfter}`);
    await shot(page, "09_dark_mode");

    // 복원
    await themeBtn.click();
    await waitStable(page, 500);
  }

  // d) Focus ring 점검 (아무 input에 Tab으로 진입)
  await navigateTo(page, "/training", "Training (focus test)");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  
  const activeEl = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName,
      type: el.getAttribute("type"),
      borderColor: cs.borderColor,
      outline: cs.outline,
      boxShadow: cs.boxShadow,
      className: el.className?.slice(0, 80),
    };
  });
  results.crossTab.focusRingTest = activeEl;
  log(`  Focus ring test: ${JSON.stringify(activeEl)}`);
  await shot(page, "09_focus_ring_test");

  // ═══════════════════════════════════════════════════════════════════════════
  // MOBILE VIEWPORT TEST — 주요 탭 모바일 워크플로우
  // ═══════════════════════════════════════════════════════════════════════════
  log("\n═══ Mobile Viewport Test ═══");
  results.mobile = { issues: [] };

  await page.setViewportSize({ width: 390, height: 844 });
  await waitStable(page, 500);

  // a) 모바일 햄버거 → 사이드바 열림
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 10000 });
  await waitStable(page, 500);
  await shot(page, "10_mobile_initial");

  const mobileHamburger = page.locator("header button").first();
  if (await mobileHamburger.isVisible().catch(() => false)) {
    await mobileHamburger.click();
    await waitStable(page, 500);
    await shot(page, "10_mobile_sidebar_open");

    // 오버레이/사이드바 보이는지
    const overlay = page.locator("[class*='bg-black/50'], [class*='bg-black\\/50']").first();
    const overlayVisible = await overlay.isVisible({ timeout: 1000 }).catch(() => false);
    results.mobile.sidebarOverlay = overlayVisible;
    log(`  Mobile sidebar overlay: ${overlayVisible}`);
    if (!overlayVisible) results.mobile.issues.push("Mobile sidebar overlay not visible after hamburger click");

    // 사이드바 메뉴에서 다른 탭으로 이동
    const mobileNavLink = page.locator("nav a[href='/teleop']").first();
    const navLinkVisible = await mobileNavLink.isVisible({ timeout: 2000 }).catch(() => false);
    if (navLinkVisible) {
      await mobileNavLink.click();
      await waitStable(page, 500);
      await shot(page, "10_mobile_teleop");
      results.mobile.navFromSidebar = { ok: true };
    } else {
      results.mobile.navFromSidebar = { ok: false, reason: "Nav link not visible in mobile sidebar" };
    }
  }

  // b) 모바일 Dataset — 삭제 버튼 접근성
  await page.goto(`${BASE}/dataset`, { waitUntil: "networkidle", timeout: 10000 });
  await waitStable(page, 500);
  const mobileDs = page.locator("[class*='group']").filter({ hasText: /pick_cube/ }).first();
  if (await mobileDs.isVisible().catch(() => false)) {
    const mobileDsDeleteBtn = mobileDs.locator("button[title='Delete'], button:has(svg.lucide-trash-2)").first();
    const mobileDelVisible = await mobileDsDeleteBtn.isVisible({ timeout: 1000 }).catch(() => false);
    const mobileDelOpacity = mobileDelVisible ? await mobileDsDeleteBtn.evaluate(el => getComputedStyle(el).opacity) : "N/A";
    results.mobile.deleteButton = { visible: mobileDelVisible, opacity: mobileDelOpacity };
    log(`  Mobile delete button — visible: ${mobileDelVisible}, opacity: ${mobileDelOpacity}`);
    await shot(page, "10_mobile_dataset_delete");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  log("\n═══ Audit Complete ═══");
  
  // Collect all issues
  const allIssues = [];
  for (const [tab, data] of Object.entries(results)) {
    if (data.issues && data.issues.length > 0) {
      for (const issue of data.issues) {
        allIssues.push({ tab, issue });
      }
    }
  }

  results._summary = {
    totalTabs: 8,
    totalScreenshots: fs.readdirSync(AUDIT_DIR).filter(f => f.endsWith(".png")).length,
    totalIssues: allIssues.length,
    issues: allIssues,
  };

  fs.writeFileSync(
    path.join(AUDIT_DIR, "audit_results.json"),
    JSON.stringify(results, null, 2)
  );

  log(`\n📊 Results: ${results._summary.totalScreenshots} screenshots, ${allIssues.length} issues`);
  if (allIssues.length > 0) {
    log("Issues found:");
    allIssues.forEach(i => log(`  ⚠ [${i.tab}] ${i.issue}`));
  }

  await browser.close();
  log("✅ Done");
})();
