import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch(existsSync(chrome) ? { executablePath: chrome } : {});
try {
  for (const [width, height, scale] of [[1544, 500, 1], [772, 250, 0.5]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const source = new URL('./banner.html', import.meta.url);
    source.searchParams.set('scale', String(scale));
    await page.goto(source.href);
    await page.evaluate(() => document.fonts.ready);
    await page.locator('.copy img').evaluate(img => img.decode());
    const path = fileURLToPath(new URL(`../assets/banner-${width}x${height}.png`, import.meta.url));
    await page.screenshot({ path });
    console.log(`${path}: ${width}x${height}`);
    await page.close();
  }
} finally {
  await browser.close();
}
