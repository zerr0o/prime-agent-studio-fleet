// Dev helper: drive the pipeline flow in the web app against the simulator and take screenshots.
const { chromium } = require('playwright');
const fs = require('fs');
const [path, pipelineFile, outPrefix] = process.argv.slice(2);

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const logs = [];
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && logs.push(`${m.type()}: ${m.text().slice(0, 200)}`));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 200)}`));
  const pipelines = JSON.parse(fs.readFileSync(pipelineFile, 'utf8'));
  await page.addInitScript(({ pipelines, LANG }) => {
    if (localStorage.getItem('pf.seeded')) return;
    const machines = [
      { key: 'm1', label: 'Workstation', baseUrl: 'http://127.0.0.1:3101', color: '#92400e', addedAt: 1 },
      { key: 'm2', label: 'Laptop', baseUrl: 'http://127.0.0.1:3102', color: '#0891b2', addedAt: 2 },
      { key: 'm3', label: 'Buildbox', baseUrl: 'http://127.0.0.1:3103', color: '#64748b', addedAt: 3 },
    ];
    localStorage.setItem('pf.v1.state', JSON.stringify({ machines, pipelines, prefs: { theme: 'dark', language: LANG } }));
    localStorage.setItem('pf.token.m1', 'sim-workstation-token');
    localStorage.setItem('pf.token.m2', 'sim-laptop-token');
    localStorage.setItem('pf.token.m3', 'sim-buildbox-token');
    localStorage.setItem('pf.seeded', '1');
  }, { pipelines, LANG: process.env.PF_LANG || 'fr' });
  const BASE = process.env.PF_BASE || 'http://localhost:8081';
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(7000);
  // Turn auto on and confirm.
  await page.getByRole('switch').first().click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${outPrefix}-1-confirm.png` });
  await page.getByText(process.env.PF_LANG === 'en' ? 'Turn on' : 'Activer', { exact: true }).click();
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${outPrefix}-2-running.png` });
  await page.waitForTimeout(12000);
  await page.screenshot({ path: `${outPrefix}-3-after-first.png` });
  await page.waitForTimeout(14000);
  await page.screenshot({ path: `${outPrefix}-4-later.png` });
  await page.goto(BASE + path.replace('/pipeline', ''), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${outPrefix}-5-overview.png` });
  console.log(JSON.stringify({ logs: logs.slice(0, 30) }));
  await browser.close();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
