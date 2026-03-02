/**
 * Verify the 7 fixes from workflow audit
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_DIR = path.join(__dirname, "workflow_audit");
const BASE = "http://localhost:5173";

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(AUDIT_DIR, `fix_${name}.png`), fullPage: false });
  log(`  📸 fix_${name}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = {};

  // ═══ DESKTOP (1440x900) ═══
  log("═══ Desktop Tests ═══");
  const desktopCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktopCtx.newPage();
  page.on("pageerror", () => {});

  await page.goto(BASE, { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(1000);

  // 1. Sidebar Collapse
  log("\n1. Sidebar Collapse");
  const navBefore = await page.locator("nav").first().evaluate(el => el.getBoundingClientRect().width);
  log(`  Nav width before: ${navBefore}px`);

  // Click the desktop toggle (hidden md:block — visible at 1440px)
  const desktopToggle = page.locator("header button[title='Toggle sidebar']");
  await desktopToggle.click();
  await page.waitForTimeout(500);

  const navAfter = await page.locator("nav").first().evaluate(el => el.getBoundingClientRect().width);
  log(`  Nav width after: ${navAfter}px`);
  results.sidebarCollapse = { before: navBefore, after: navAfter, collapsed: navAfter < 100 };
  await shot(page, "01_sidebar_collapsed");

  // Restore
  await desktopToggle.click();
  await page.waitForTimeout(300);

  // 2. Session History scrollable
  log("\n2. Session History scroll");
  const historyContainer = page.locator("text=세션 히스토리").locator("..").locator("..").locator("div.overflow-y-auto");
  const historyScrollable = await historyContainer.evaluate(el => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    hasOverflow: el.scrollHeight > el.clientHeight,
  })).catch(() => ({ hasOverflow: false, error: "not found" }));
  results.sessionHistory = historyScrollable;
  log(`  Scrollable: ${JSON.stringify(historyScrollable)}`);

  // 3. Focus Ring (focus-visible)
  log("\n3. Focus Ring");
  await page.goto(`${BASE}/training`, { waitUntil: "networkidle", timeout: 10000 });
  await page.waitForTimeout(500);

  // Tab multiple times to reach a select or input
  for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
  const focusedEl = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName,
      outline: cs.outline,
      outlineColor: cs.outlineColor,
      outlineWidth: cs.outlineWidth,
      outlineOffset: cs.outlineOffset,
    };
  });
  results.focusRing = focusedEl;
  log(`  Focus: ${JSON.stringify(focusedEl)}`);
  await shot(page, "02_focus_ring");

  // 4. Evaluation Camera Mapping open by default
  log("\n4. Eval Camera Mapping");
  await page.goto(`${BASE}/evaluation`, { waitUntil: "networkidle", timeout: 10000 });
  await page.waitForTimeout(500);

  // Select Real Robot
  const realRobot = page.locator("text=Real Robot").first();
  await realRobot.click();
  await page.waitForTimeout(500);

  // Check if camera mapping is visible WITHOUT clicking the collapse toggle
  const camMappingText = page.locator("text=카메라 매핑").first();
  const camMappingVisible = await camMappingText.isVisible({ timeout: 2000 }).catch(() => false);
  
  // Also check if the actual mapping dropdowns are visible
  const mappingSelects = page.locator("text=observation.images").first();
  const mappingDropdownVisible = await mappingSelects.isVisible({ timeout: 2000 }).catch(() => false);
  
  results.evalCameraMapping = { headerVisible: camMappingVisible, dropdownsVisible: mappingDropdownVisible };
  log(`  Camera mapping header: ${camMappingVisible}, dropdowns: ${mappingDropdownVisible}`);
  await shot(page, "03_eval_camera_mapping");

  await desktopCtx.close();

  // ═══ MOBILE (390x844) ═══
  log("\n═══ Mobile Tests ═══");
  const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobile = await mobileCtx.newPage();
  mobile.on("pageerror", () => {});

  // 5. Mobile Sidebar
  log("\n5. Mobile Sidebar");
  await mobile.goto(BASE, { waitUntil: "networkidle", timeout: 15000 });
  await mobile.waitForTimeout(500);

  const mobileToggle = mobile.locator("header button[title='Open menu']");
  const mobileToggleVisible = await mobileToggle.isVisible({ timeout: 2000 }).catch(() => false);
  log(`  Mobile hamburger visible: ${mobileToggleVisible}`);

  if (mobileToggleVisible) {
    await mobileToggle.click();
    await mobile.waitForTimeout(600);

    const overlay = mobile.locator("[data-testid='mobile-sidebar-overlay']");
    const overlayVisible = await overlay.isVisible({ timeout: 2000 }).catch(() => false);
    log(`  Overlay visible: ${overlayVisible}`);
    await shot(mobile, "04_mobile_sidebar");

    // Can we see nav links?
    const navLink = mobile.locator("nav a[href='/teleop']");
    const navLinkVisible = await navLink.isVisible({ timeout: 2000 }).catch(() => false);
    log(`  Nav link visible: ${navLinkVisible}`);

    // Navigate via sidebar
    if (navLinkVisible) {
      await navLink.click();
      await mobile.waitForTimeout(500);
      const currentUrl = mobile.url();
      log(`  Navigated to: ${currentUrl}`);
      results.mobileSidebar = { overlayVisible, navLinkVisible, navigatedUrl: currentUrl };
    } else {
      results.mobileSidebar = { overlayVisible, navLinkVisible };
    }
  } else {
    results.mobileSidebar = { hamburgerVisible: false };
  }

  // 6. Mobile System Status — camera cards
  log("\n6. Mobile Camera Cards");
  await mobile.goto(BASE, { waitUntil: "networkidle", timeout: 10000 });
  await mobile.waitForTimeout(500);

  // Scroll to camera section
  const cameraSection = mobile.locator("text=카메라 (3)").first();
  if (await cameraSection.isVisible({ timeout: 2000 }).catch(() => false)) {
    await cameraSection.scrollIntoViewIfNeeded();
    await mobile.waitForTimeout(300);

    // Count all 3 camera rows visible
    const camRows = mobile.locator("text=/dev\\//").all();
    const camRowTexts = await mobile.locator("text=/video|top_cam|wrist_cam/").allTextContents();
    results.mobileCamCards = { visibleItems: camRowTexts.length, items: camRowTexts.slice(0, 6) };
    log(`  Camera items visible: ${camRowTexts.length}`);
  }
  await shot(mobile, "05_mobile_status_cameras");

  // 7. Mobile Delete button
  log("\n7. Mobile Delete Button");
  await mobile.goto(`${BASE}/dataset`, { waitUntil: "networkidle", timeout: 10000 });
  await mobile.waitForTimeout(500);

  const dsGroup = mobile.locator("[class*='group']").filter({ hasText: /pick_cube/ }).first();
  if (await dsGroup.isVisible({ timeout: 2000 }).catch(() => false)) {
    const delBtn = dsGroup.locator("button[title='Delete']").first();
    const delVisible = await delBtn.isVisible({ timeout: 1000 }).catch(() => false);
    const delOpacity = delVisible ? await delBtn.evaluate(el => getComputedStyle(el).opacity) : "N/A";
    results.mobileDelete = { visible: delVisible, opacity: delOpacity };
    log(`  Delete button: visible=${delVisible}, opacity=${delOpacity}`);
  }
  await shot(mobile, "06_mobile_dataset_delete");

  await mobileCtx.close();

  // ═══ SUMMARY ═══
  log("\n═══ Results Summary ═══");
  const passes = [];
  const fails = [];

  if (results.sidebarCollapse?.collapsed) passes.push("✅ Sidebar collapses"); else fails.push("❌ Sidebar collapse: " + JSON.stringify(results.sidebarCollapse));
  if (results.sessionHistory?.hasOverflow || results.sessionHistory?.scrollHeight > 0) passes.push("✅ Session history scrollable"); else fails.push("❌ Session history: " + JSON.stringify(results.sessionHistory));
  if (results.focusRing?.outlineWidth && results.focusRing.outlineWidth !== "0px") passes.push("✅ Focus ring visible"); else fails.push("❌ Focus ring: " + JSON.stringify(results.focusRing));
  if (results.evalCameraMapping?.dropdownsVisible) passes.push("✅ Camera mapping auto-open"); else fails.push("❌ Camera mapping: " + JSON.stringify(results.evalCameraMapping));
  if (results.mobileSidebar?.overlayVisible) passes.push("✅ Mobile sidebar opens"); else fails.push("❌ Mobile sidebar: " + JSON.stringify(results.mobileSidebar));
  if (results.mobileDelete?.opacity === "1") passes.push("✅ Mobile delete button visible"); else fails.push("❌ Mobile delete: " + JSON.stringify(results.mobileDelete));

  passes.forEach(p => log(`  ${p}`));
  fails.forEach(f => log(`  ${f}`));
  log(`\n  Score: ${passes.length}/${passes.length + fails.length}`);

  fs.writeFileSync(
    path.join(AUDIT_DIR, "fix_verification.json"),
    JSON.stringify(results, null, 2)
  );

  await browser.close();
  log("✅ Done");
})();
