// Dev helper: screenshots of the web app against the simulator (Playwright, Chromium).
// Usage: node scripts/shoot.cjs <url-path> <out.png> [width] [height] [--seed] [--theme=light] [--lang=en] [--wait=ms] [--click=text]...
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const path = args[0] || '/';
const out = args[1] || 'captures/app/shot.png';
const width = Number(args[2]) || 1440;
const height = Number(args[3]) || 900;
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const seed = args.includes('--seed');
const theme = flag('theme', 'dark');
const lang = flag('lang', 'fr');
const wait = Number(flag('wait', '4000'));
const base = flag('base', 'http://localhost:8081');
const clicks = args.filter((a) => a.startsWith('--click=')).map((a) => a.slice(8));
const taps = args.filter((a) => a.startsWith('--tap=')).map((a) => a.slice(6));
const pipelineFile = flag('pipeline', '');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const logs = [];
  page.on('console', (msg) => {
    if (['error', 'warning'].includes(msg.type())) logs.push(`${msg.type()}: ${msg.text().slice(0, 300)}`);
  });
  page.on('pageerror', (err) => logs.push(`pageerror: ${err.message.slice(0, 300)}`));
  if (seed) {
    let pipelines = {};
    if (pipelineFile) pipelines = JSON.parse(require('fs').readFileSync(pipelineFile, 'utf8'));
    await page.addInitScript(({ theme, lang, pipelines }) => {
      if (localStorage.getItem('pf.seeded')) return;
      const machines = [
        { key: 'm1', label: 'Workstation', baseUrl: 'http://127.0.0.1:3101', color: '#92400e', addedAt: 1 },
        { key: 'm2', label: 'Laptop', baseUrl: 'http://127.0.0.1:3102', color: '#0891b2', addedAt: 2 },
        { key: 'm3', label: 'Buildbox', baseUrl: 'http://127.0.0.1:3103', color: '#64748b', addedAt: 3 },
      ];
      localStorage.setItem('pf.v1.state', JSON.stringify({ machines, pipelines, prefs: { theme, language: lang } }));
      localStorage.setItem('pf.token.m1', 'sim-workstation-token');
      localStorage.setItem('pf.token.m2', 'sim-laptop-token');
      localStorage.setItem('pf.token.m3', 'sim-buildbox-token');
      localStorage.setItem('pf.seeded', '1');
    }, { theme, lang, pipelines });
  }
  await page.goto(base + path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(wait);
  for (const text of clicks) {
    try {
      await page.getByText(text, { exact: false }).first().click({ timeout: 5000 });
      await page.waitForTimeout(1200);
    } catch (e) {
      logs.push(`click failed: ${text}`);
    }
  }
  for (const text of taps) {
    // Canvas items (node editor) get raw pointer events, not element clicks.
    const box = await page.getByText(text, { exact: false }).first().boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(1200);
    } else logs.push(`tap failed: ${text}`);
  }
  await page.screenshot({ path: out });
  console.log(JSON.stringify({ out, url: page.url(), logs: logs.slice(0, 25) }));
  await browser.close();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
