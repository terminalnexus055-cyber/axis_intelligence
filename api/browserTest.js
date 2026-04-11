// AXIS — Indie Hackers Read Test with consent handling

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  const targetUrl = 'https://www.indiehackers.com/posts?filter=top';

  const puppeteerScript = `export default async function({ page }) {
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.goto('${targetUrl}', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  // Dismiss cookie consent if present
  try {
    const consentSelectors = [
      'button[id*="accept"]',
      'button[class*="accept"]',
      'button[title*="Accept"]',
      '[aria-label*="Accept"]',
      'button:contains("Accept")',
      '.accept-btn',
      '#accept-all'
    ];
    for (const sel of consentSelectors) {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click();
        await new Promise(r => setTimeout(r, 1000));
        break;
      }
    }
  } catch(e) {}

  // Also try clicking via evaluate
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const acceptBtn = buttons.find(b => 
      b.innerText && (
        b.innerText.toLowerCase().includes('accept all') ||
        b.innerText.toLowerCase().includes('accept cookies') ||
        b.innerText.toLowerCase().includes('agree') ||
        b.innerText.toLowerCase().includes('got it')
      )
    );
    if (acceptBtn) acceptBtn.click();
  });

  await new Promise(r => setTimeout(r, 3000));

  const content = await page.evaluate(() => {
    const items = [];
    const seen = new Set();

    const selectors = [
      '.feed-item__title',
      '.post-title', 
      'h2 a',
      'h3 a',
      '[class*="title"] a',
      'a[href*="/post/"]',
      'a[href*="/posts/"]'
    ];

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach(el => {
        const t = el.innerText && el.innerText.trim();
        const u = el.href || window.location.href;
        if (t && t.length > 15 && t.length < 300 && !seen.has(t)) {
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
      sample: items.slice(0, 5),
      raw_preview: !items.length ? text.slice(0, 800) : null
    });

  } catch (err) {
    res.status(200).json({ error: err.message });
  }
}
