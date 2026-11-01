// שרת בדיקה קטן ל-Render: GET /test?url=<קישור מודעה>  → JSON עם התוצאה
// GET /shot → צילום המסך האחרון
const http = require('http');
const { chromium } = require('playwright');

const DEFAULT_URL = 'https://www.yad2.co.il/realestate/item/center-and-sharon/noyk3f6k';
const PHONE_RE = /\b0(?:5\d|7\d|[2-4]|[89])[-\s]?\d{3}[-\s]?\d{4}\b/g;
let lastShot = null;
let busy = false;

async function runTest(url) {
  const out = { url, log: [] };
  const t0 = Date.now();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await (await browser.newContext({
      locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: { width: 1366, height: 900 },
    })).newPage();

    const netPhones = new Set();
    page.on('response', async (r) => {
      try {
        if (!(r.headers()['content-type'] || '').includes('json')) return;
        const t = await r.text();
        if (/phone/i.test(t)) {
          (t.match(PHONE_RE) || []).forEach((p) => netPhones.add(p));
          out.log.push(`[net] ${r.status()} ${r.url().slice(0, 120)}`);
        }
      } catch {}
    });

    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    out.httpStatus = res && res.status();
    await page.waitForTimeout(3000);
    out.title = await page.title();

    const html = await page.content();
    if (/captcha|shieldsquare|are you for real|perimeterx|radware|access denied/i.test(html)) {
      out.result = 'BLOCKED';
      lastShot = await page.screenshot();
      return out;
    }

    const before = new Set((await page.innerText('body')).match(PHONE_RE) || []);
    let btn = page.getByRole('button', { name: /הצג(ת)?\s*(מספר|טלפון)|מספר טלפון/ }).first();
    if (!(await btn.count())) btn = page.locator('text=/הצג(ת)?\\s*(מספר|טלפון)/').first();
    if (!(await btn.count())) {
      out.result = 'NO_BUTTON';
      lastShot = await page.screenshot({ fullPage: true });
      return out;
    }

    await btn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800 + Math.random() * 700);
    await btn.click();
    await page.waitForTimeout(3000);

    const after = (await page.innerText('body')).match(PHONE_RE) || [];
    out.phones = [...new Set([...after.filter((p) => !before.has(p)), ...netPhones])];
    out.result = out.phones.length ? 'OK' : 'CLICKED_NO_PHONE';
    lastShot = await page.screenshot();
    return out;
  } finally {
    out.seconds = ((Date.now() - t0) / 1000).toFixed(1);
    await browser.close();
  }
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/shot') {
    if (!lastShot) { res.writeHead(404); return res.end('no screenshot yet'); }
    res.writeHead(200, { 'Content-Type': 'image/png' });
    return res.end(lastShot);
  }
  if (u.pathname === '/test') {
    if (busy) { res.writeHead(429); return res.end('busy, try again in a few seconds'); }
    busy = true;
    try {
      const out = await runTest(u.searchParams.get('url') || DEFAULT_URL);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(out, null, 2));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('ERROR: ' + e.message);
    } finally { busy = false; }
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('yad2-test up. use /test and then /shot');
}).listen(process.env.PORT || 10000, () => console.log('listening'));
