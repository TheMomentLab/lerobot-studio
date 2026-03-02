import { chromium } from 'playwright';
import fs from 'fs';

(async () => {
  console.log("Starting interactive UI/UX test...");
  const browser = await chromium.launch();
  
  // 1. Desktop Test Context
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  // Test A: Dataset list interactions (Hover & Focus)
  console.log("Testing Dataset tab (hover/focus)...");
  await page.goto('http://127.0.0.1:5174/dataset');
  await page.waitForTimeout(500);
  
  // Hover over the second item to check the delete button reveal
  const datasetItems = await page.$$('.group.cursor-pointer');
  if (datasetItems.length > 1) {
    await datasetItems[1].hover();
  }
  await page.screenshot({ path: 'test_1_dataset_hover.png' });

  // Focus an input field to check focus rings
  const input = await page.$('input[placeholder="새 Repo ID"]');
  if (input) {
    await input.focus();
    await page.screenshot({ path: 'test_2_input_focus.png' });
  }

  // Test B: Training tab (Layout shift on expand)
  console.log("Testing Training tab (Layout shift)...");
  await page.goto('http://127.0.0.1:5174/training');
  await page.waitForTimeout(500);
  // Expand advanced settings
  const advButton = await page.$('text=고급 설정');
  if (advButton) {
    await advButton.click();
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: 'test_3_training_expanded.png' });

  // Test C: Console Drawer Dragging (Flex layout integrity)
  console.log("Testing Console Drawer drag...");
  await page.goto('http://127.0.0.1:5174/teleop');
  await page.waitForTimeout(500);
  
  const dragHandle = await page.$('.cursor-ns-resize');
  if (dragHandle) {
    const box = await dragHandle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // Drag it way up to see if the main scroll area gets squished properly
    await page.mouse.move(box.x + box.width / 2, box.y - 300);
    await page.mouse.up();
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: 'test_4_console_dragged.png' });

  // 2. Mobile Test Context
  console.log("Testing Mobile layout...");
  const mobilePage = await browser.newPage({ viewport: { width: 375, height: 667 } });
  await mobilePage.goto('http://127.0.0.1:5174/');
  await mobilePage.waitForTimeout(500);
  
  // Toggle sidebar on mobile
  const menuBtn = await mobilePage.$('button[title="Toggle sidebar"]');
  if (menuBtn) {
    await menuBtn.click();
    await mobilePage.waitForTimeout(300);
  }
  await mobilePage.screenshot({ path: 'test_5_mobile_sidebar.png' });

  // Check mobile Header wrapping (HF Auth, Theme, GitHub)
  await mobilePage.goto('http://127.0.0.1:5174/motor-setup');
  await mobilePage.waitForTimeout(500);
  await mobilePage.screenshot({ path: 'test_6_mobile_header.png' });

  await browser.close();
  console.log("Interactive tests complete.");
})();
