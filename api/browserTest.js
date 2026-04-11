// AXIS — Browserless Puppeteer Test

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  const targetUrl = 'https://old.reddit.com/r/freelance/search/?q=struggling&sort=new&restrict_sr=1';

  const puppeteerScript = `export default async function({ page }) {
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.goto('${targetUrl}', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise(r => setTimeout(r, 3000));
  const content = await page.evaluate(() => {
    ['script','style','nav','footer','header','iframe'].forEach(tag => {
      document.querySelectorAll(tag).forEach(el => el.remove());
    });
    const items = [];
    const seen = new Set();
    document.querySelectorAll('a,p,h1,h2,h3,h4,li,article').forEach(el => {
      const t = el.innerText && el.innerText.trim();
      const u = el.href || window.location.href;
      if (t && t.length > 30 && t.length < 800 && !seen.has(t)) {
        seen.add(t);
        items.push({ text: t, url: u });
      }
    });
    return items.slice(0, 10);
  });
  return content;
}`;

  try {
    const response = await fetch(
      `https://production-sfo.browserless.io/chromium/function?token=${process.env.BROWSERLESS_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/javascript' },
        body: puppeteerScript
      }
    );

    const status = response.status;
    const text = await response.text();

    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}

    res.status(200).json({
      browserless_status: status,
      items_found: Array.isArray(parsed) ? parsed.length : 0,
      sample: Array.isArray(parsed) ? parsed.slice(0, 2) : text.slice(0, 500)
    });

  } catch (err) {
    res.status(200).json({ error: err.message });
  }
}
