// AXIS — Indie Hackers Read Test

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  const targetUrl = 'https://www.indiehackers.com/posts?filter=top';

  const puppeteerScript = `export default async function({ page }) {
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.goto('${targetUrl}', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 4000));
  
  const content = await page.evaluate(() => {
    const items = [];
    const seen = new Set();
    
    // Indie Hackers specific selectors
    const selectors = [
      '.feed-item__title',
      '.post-title',
      'h2',
      'h3',
      '[class*="title"]',
      '[class*="post"]',
      'a[href*="/post"]'
    ];
    
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach(el => {
        const t = el.innerText && el.innerText.trim();
        const u = el.href || el.closest('a')?.href || window.location.href;
        if (t && t.length > 10 && t.length < 300 && !seen.has(t)) {
          seen.add(t);
          items.push({ text: t, url: u });
        }
      });
    }
    
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

    const items = Array.isArray(parsed) ? parsed : (parsed?.data || []);

    res.status(200).json({
      browserless_status: status,
      items_found: items.length,
      sample: items.slice(0, 3),
      raw_preview: !items.length ? text.slice(0, 500) : null
    });

  } catch (err) {
    res.status(200).json({ error: err.message });
  }
}
