import { chromium } from "playwright";
import fs from "fs";

const BASE_URL = "http://127.0.0.1:5174";
const OUT_DIR = "ux_audit";

const round = (n) => (typeof n === "number" ? Math.round(n * 100) / 100 : n);
const bbToObj = (bb) => (bb ? { x: round(bb.x), y: round(bb.y), width: round(bb.width), height: round(bb.height) } : null);

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  const results = {
    datasetHoverDesktop: {},
    datasetDeleteMobile: {},
    focusStateEvaluation: {},
    trainingAdvancedExpand: {},
    teleopConsoleDrag: {},
    mobileSidebar: {},
    mobileHeader: {},
  };

  const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  await desktop.goto(`${BASE_URL}/dataset`, { waitUntil: "domcontentloaded" });
  await desktop.waitForTimeout(700);

  const placeCupText = desktop.getByText("place_cup").first();
  const row = placeCupText.locator("xpath=ancestor::div[contains(@class,'group') and contains(@class,'cursor-pointer')]").first();
  const deleteBtn = row.locator("button[title='Delete']").first();

  let beforeOpacity = null;
  let afterOpacity = null;
  if (await row.count()) {
    beforeOpacity = await deleteBtn.evaluate((el) => getComputedStyle(el).opacity).catch(() => null);
    await row.hover();
    await desktop.waitForTimeout(120);
    afterOpacity = await deleteBtn.evaluate((el) => getComputedStyle(el).opacity).catch(() => null);
  }

  await desktop.screenshot({ path: `${OUT_DIR}/01_dataset_hover_desktop.png`, fullPage: true });
  results.datasetHoverDesktop = {
    rowFound: (await row.count()) > 0,
    deleteButtonFound: (await deleteBtn.count()) > 0,
    opacityBeforeHover: beforeOpacity,
    opacityAfterHover: afterOpacity,
    screenshot: `${OUT_DIR}/01_dataset_hover_desktop.png`,
  };

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(`${BASE_URL}/dataset`, { waitUntil: "domcontentloaded" });
  await mobile.waitForTimeout(800);

  const placeCupTextM = mobile.getByText("place_cup").first();
  const rowM = placeCupTextM.locator("xpath=ancestor::div[contains(@class,'group') and contains(@class,'cursor-pointer')]").first();
  const deleteBtnM = rowM.locator("button[title='Delete']").first();

  let mobileOpacity = null;
  if (await deleteBtnM.count()) {
    mobileOpacity = await deleteBtnM.evaluate((el) => getComputedStyle(el).opacity).catch(() => null);
  }

  await mobile.screenshot({ path: `${OUT_DIR}/02_dataset_mobile.png`, fullPage: true });
  results.datasetDeleteMobile = {
    rowFound: (await rowM.count()) > 0,
    deleteButtonFound: (await deleteBtnM.count()) > 0,
    opacityDefaultMobile: mobileOpacity,
    screenshot: `${OUT_DIR}/02_dataset_mobile.png`,
  };

  await desktop.goto(`${BASE_URL}/evaluation`, { waitUntil: "domcontentloaded" });
  await desktop.waitForTimeout(700);

  const focusInput = desktop.locator("input[type='text']").first();
  let focusStyles = null;
  if (await focusInput.count()) {
    await focusInput.focus();
    await desktop.waitForTimeout(120);
    focusStyles = await focusInput.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { borderColor: cs.borderColor, boxShadow: cs.boxShadow, outline: cs.outline };
    });
  }
  await desktop.screenshot({ path: `${OUT_DIR}/03_evaluation_focus.png`, fullPage: true });
  results.focusStateEvaluation = {
    inputFound: (await focusInput.count()) > 0,
    styles: focusStyles,
    screenshot: `${OUT_DIR}/03_evaluation_focus.png`,
  };

  await desktop.goto(`${BASE_URL}/training`, { waitUntil: "domcontentloaded" });
  await desktop.waitForTimeout(700);

  const colabHeader = desktop.getByText("Colab 학습").first();
  const advBtn = desktop.locator("button").filter({ hasText: "고급" }).first();

  const beforeBox = await colabHeader.boundingBox();
  await desktop.screenshot({ path: `${OUT_DIR}/04_training_before.png`, fullPage: true });

  let clicked = false;
  if (await advBtn.count()) {
    await advBtn.click();
    clicked = true;
    await desktop.waitForTimeout(300);
  }

  const afterBox = await colabHeader.boundingBox();
  await desktop.screenshot({ path: `${OUT_DIR}/05_training_after.png`, fullPage: true });
  results.trainingAdvancedExpand = {
    advancedButtonFound: (await advBtn.count()) > 0,
    clicked,
    colabBefore: bbToObj(beforeBox),
    colabAfter: bbToObj(afterBox),
    yShift: beforeBox && afterBox ? round(afterBox.y - beforeBox.y) : null,
    screenshots: [`${OUT_DIR}/04_training_before.png`, `${OUT_DIR}/05_training_after.png`],
  };

  await desktop.goto(`${BASE_URL}/teleop`, { waitUntil: "domcontentloaded" });
  await desktop.waitForTimeout(700);

  const dragHandle = desktop.locator(".cursor-ns-resize").first();
  const stickyButton = desktop.locator("button", { hasText: "Start Teleop" }).first();
  const consoleLabel = desktop.getByText("Console").first();

  let stickyAfter = null;
  let consoleAfter = null;
  let overlap = null;
  let dragged = false;

  if (await dragHandle.count()) {
    const box = await dragHandle.boundingBox();
    if (box) {
      await desktop.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await desktop.mouse.down();
      await desktop.mouse.move(box.x + box.width / 2, Math.max(140, box.y - 260));
      await desktop.mouse.up();
      dragged = true;
      await desktop.waitForTimeout(260);
    }
  }

  const stickyBb = await stickyButton.boundingBox();
  const consoleBb = await consoleLabel.boundingBox();
  if (stickyBb && consoleBb) {
    stickyAfter = bbToObj(stickyBb);
    consoleAfter = bbToObj(consoleBb);
    overlap = stickyBb.y + stickyBb.height > consoleBb.y;
  }

  await desktop.screenshot({ path: `${OUT_DIR}/06_teleop_console_drag.png`, fullPage: true });
  results.teleopConsoleDrag = {
    dragHandleFound: (await dragHandle.count()) > 0,
    dragged,
    stickyButtonBox: stickyAfter,
    consoleLabelBox: consoleAfter,
    overlap,
    screenshot: `${OUT_DIR}/06_teleop_console_drag.png`,
  };

  await mobile.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await mobile.waitForTimeout(600);
  const toggleBtn = mobile.locator("button[title='Toggle sidebar']").first();
  if (await toggleBtn.count()) {
    await toggleBtn.click();
    await mobile.waitForTimeout(220);
  }

  const overlay = mobile.locator('div.absolute.inset-0[class*="bg-black/50"]').first();
  const mobileSidebarShell = mobile.locator('div[class*="md:hidden fixed inset-0 z-50 flex"]').first();

  await mobile.screenshot({ path: `${OUT_DIR}/07_mobile_sidebar_toggle.png`, fullPage: true });
  results.mobileSidebar = {
    toggleButtonFound: (await toggleBtn.count()) > 0,
    overlayVisible: (await overlay.count()) > 0,
    mobileSidebarShellVisible: (await mobileSidebarShell.count()) > 0,
    screenshot: `${OUT_DIR}/07_mobile_sidebar_toggle.png`,
  };

  await mobile.goto(`${BASE_URL}/motor-setup`, { waitUntil: "domcontentloaded" });
  await mobile.waitForTimeout(600);

  const header = mobile.locator("header").first();
  const wsBadge = mobile.getByText("WS").first();
  const userChip = mobile.getByText("lerobot-user").first();

  const headerBox = await header.boundingBox();
  const wsBox = await wsBadge.boundingBox();
  const userBox = await userChip.boundingBox();

  let clipped = null;
  if (headerBox && wsBox && userBox) {
    clipped = (wsBox.x + wsBox.width > 390) || (userBox.x + userBox.width > 390);
  }

  await mobile.screenshot({ path: `${OUT_DIR}/08_mobile_header.png`, fullPage: true });
  results.mobileHeader = {
    headerBox: bbToObj(headerBox),
    wsBox: bbToObj(wsBox),
    userBox: bbToObj(userBox),
    clipped,
    screenshot: `${OUT_DIR}/08_mobile_header.png`,
  };

  fs.writeFileSync(`${OUT_DIR}/audit_results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));

  await desktop.close();
  await mobile.close();
  await browser.close();
})();
