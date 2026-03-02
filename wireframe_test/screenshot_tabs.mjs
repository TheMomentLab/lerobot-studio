import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TABS = [
  { name: 'System Status', path: '/' },
  { name: 'Motor Setup', path: '/motor-setup' },
  { name: 'Camera Setup', path: '/camera-setup' },
  { name: 'Teleop', path: '/teleop' },
  { name: 'Recording', path: '/recording' },
  { name: 'Dataset', path: '/dataset' },
  { name: 'Training', path: '/training' },
  { name: 'Evaluation', path: '/evaluation' },
];

const BASE_URL = 'http://127.0.0.1:5174';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  for (const tab of TABS) {
    try {
      console.log(`Navigating to ${tab.name}...`);
      await page.goto(`${BASE_URL}${tab.path}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      
      const filename = `${tab.name.toLowerCase().replace(/\s+/g, '_')}.png`;
      const filepath = path.join(SCREENSHOT_DIR, filename);
      
      await page.screenshot({ path: filepath, fullPage: true });
      console.log(`✓ Screenshot saved: ${filepath}`);
    } catch (error) {
      console.error(`✗ Error on ${tab.name}: ${error.message}`);
    }
  }
  
  await browser.close();
  console.log('\nAll screenshots completed!');
})();
